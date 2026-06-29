#!/usr/bin/env python3
"""
patrol.py — Idle-time patrol for full-mode repos.

Runs only when no jobs are active. Rotates through registered full-mode repos,
performs three kinds of inspection, and files GitHub issues (with 'claude' label)
so the normal bot pipeline can implement them.

Patrols:
  1. code-review   — glm-5.2 scans the repo for bugs, anti-patterns, outdated deps
  2. research      — searches for relevant advisories, RFCs, ecosystem updates
  3. iteration     — looks at recent merged PRs to suggest next improvement steps
"""

import json
import logging
import os
import sqlite3
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import yaml

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [patrol] %(levelname)s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("patrol")

DB_PATH = os.environ.get("DB_PATH", "/srv/claude-bot/db.sqlite3")
REPOS_CONFIG_PATH = os.environ.get("REPOS_CONFIG_PATH", "/srv/claude-bot/repos.yml")
GH_TOKEN = os.environ.get("GH_TOKEN", "")
ANTHROPIC_AUTH_TOKEN = os.environ.get("ANTHROPIC_AUTH_TOKEN", "")
ANTHROPIC_BASE_URL = os.environ.get("ANTHROPIC_BASE_URL", "https://api.z.ai/api/anthropic").rstrip("/")

# How many issues to file per patrol run per repo (avoid flooding)
MAX_ISSUES_PER_PATROL = int(os.environ.get("MAX_PATROL_ISSUES", "3"))
# Minimum hours between patrol runs on the same repo
PATROL_COOLDOWN_HOURS = int(os.environ.get("PATROL_COOLDOWN_HOURS", "6"))
# State file tracking last patrol time per repo
PATROL_STATE_FILE = os.environ.get("PATROL_STATE_FILE", "/srv/claude-bot/patrol-state.json")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def open_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def is_idle(conn: sqlite3.Connection) -> bool:
    """Return True if no job is currently running or in a work stage."""
    row = conn.execute("""
        SELECT COUNT(*) FROM jobs
        WHERE state IN ('running', 'reviewing', 'merging', 'remote_ci_waiting')
    """).fetchone()
    return row[0] == 0


def load_repos_yml() -> list[dict]:
    path = Path(REPOS_CONFIG_PATH)
    if not path.exists():
        return []
    with open(path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    return [r for r in cfg.get("repositories", []) if r.get("enabled", True)]


def full_mode_repos() -> list[dict]:
    return [r for r in load_repos_yml() if r.get("mode", "full") == "full"]


def load_patrol_state() -> dict:
    if Path(PATROL_STATE_FILE).exists():
        try:
            with open(PATROL_STATE_FILE, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save_patrol_state(state: dict):
    with open(PATROL_STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)


def next_repo_to_patrol(repos: list[dict]) -> dict | None:
    """Pick the repo that was patrolled longest ago (round-robin with cooldown)."""
    state = load_patrol_state()
    now_ts = time.time()
    cooldown_secs = PATROL_COOLDOWN_HOURS * 3600

    candidates = []
    for repo_cfg in repos:
        repo = repo_cfg["repo"]
        last_patrol = state.get(repo, 0)
        age = now_ts - last_patrol
        if age >= cooldown_secs:
            candidates.append((age, repo_cfg))

    if not candidates:
        return None
    # Pick the one patrolled longest ago
    candidates.sort(key=lambda x: x[0], reverse=True)
    return candidates[0][1]


def mark_patrolled(repo: str):
    state = load_patrol_state()
    state[repo] = time.time()
    save_patrol_state(state)


# ---------------------------------------------------------------------------
# GitHub helpers
# ---------------------------------------------------------------------------

def gh(args: list[str]) -> str | None:
    env = os.environ.copy()
    if GH_TOKEN:
        env["GH_TOKEN"] = GH_TOKEN
    try:
        result = subprocess.run(
            ["gh"] + args, capture_output=True, text=True, timeout=30, env=env,
        )
        return result.stdout.strip() if result.returncode == 0 else None
    except Exception:
        return None


def get_repo_file_tree(repo_path: str, max_files: int = 120) -> str:
    """Get a compact file tree from the local clone."""
    try:
        result = subprocess.run(
            ["git", "ls-files"],
            capture_output=True, text=True, cwd=repo_path, timeout=15,
        )
        files = result.stdout.strip().splitlines()[:max_files]
        return "\n".join(files)
    except Exception:
        return ""


def get_recent_merged_prs(repo: str, limit: int = 10) -> list[dict]:
    out = gh([
        "pr", "list", "--repo", repo,
        "--state", "merged", "--limit", str(limit),
        "--json", "number,title,mergedAt,body",
    ])
    if not out:
        return []
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return []


def get_open_issues(repo: str) -> list[dict]:
    out = gh([
        "issue", "list", "--repo", repo,
        "--state", "open", "--limit", "30",
        "--json", "number,title,labels",
    ])
    if not out:
        return []
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return []


def issue_already_exists(open_issues: list[dict], title_keyword: str) -> bool:
    """Avoid filing duplicate issues."""
    kw = title_keyword.lower()
    return any(kw in i["title"].lower() for i in open_issues)


def file_issue(repo: str, title: str, body: str, labels: list[str]) -> str | None:
    label_args = []
    for lbl in labels:
        label_args += ["--label", lbl]
    out = gh(["issue", "create", "--repo", repo, "--title", title, "--body", body] + label_args)
    if out:
        log.info("Filed issue: %s — %s", repo, title)
    return out


# ---------------------------------------------------------------------------
# AI helpers
# ---------------------------------------------------------------------------

def call_ai(prompt: str, max_tokens: int = 2048) -> str | None:
    if not ANTHROPIC_AUTH_TOKEN:
        log.warning("No ANTHROPIC_AUTH_TOKEN — skipping AI call")
        return None
    try:
        payload = json.dumps({
            "model": "glm-5.2",
            "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": prompt}],
        }).encode()
        req = urllib.request.Request(
            f"{ANTHROPIC_BASE_URL}/v1/messages",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "x-api-key": ANTHROPIC_AUTH_TOKEN,
                "anthropic-version": "2023-06-01",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())
        return data["content"][0]["text"].strip()
    except Exception as e:
        log.warning("AI call failed: %s", e)
        return None


def parse_issues_from_ai(text: str) -> list[dict]:
    """Parse AI output into [{title, body, priority}] list."""
    if not text:
        return []
    import re
    # Strip markdown fences
    text = re.sub(r"```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```\s*$", "", text.strip())
    try:
        data = json.loads(text)
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and "issues" in data:
            return data["issues"]
    except json.JSONDecodeError:
        pass
    # Fallback: extract JSON array
    m = re.search(r'\[.*\]', text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            pass
    return []


# ---------------------------------------------------------------------------
# Patrol 1: Code review
# ---------------------------------------------------------------------------

CODE_REVIEW_PROMPT = """\
You are a senior engineer doing a proactive code review patrol on a GitHub repository.

Repository: {repo}
Project description: {description}

File tree (up to 120 files):
{file_tree}

Recent merged PRs (context on what has changed):
{recent_prs}

Your task:
Identify up to 3 concrete, actionable improvements. Focus on:
- Bugs or logic errors that might exist
- Security concerns (auth, input validation, secrets handling)
- Outdated dependencies with known issues
- Code patterns that will cause problems at scale
- Missing tests for critical paths
- Performance issues
- Technical debt that is actively causing friction

Each issue should be specific enough that a developer (or automated bot) can implement it
without additional clarification. Include file paths and function names where possible.

Do NOT suggest vague cleanups like "improve code quality" or "add more tests."
Do NOT suggest issues that are already in the recent PRs.

Return ONLY a JSON array:
[
  {{
    "title": "fix: <specific problem> in <file/module>",
    "body": "<2-4 sentences: what the problem is, where it is, what to change, acceptance criteria>",
    "priority": <1-100, lower=higher priority>
  }},
  ...
]

Return an empty array [] if there are no actionable issues.
"""


def patrol_code_review(repo_cfg: dict, repo_path: str) -> list[dict]:
    repo = repo_cfg["repo"]
    log.info("[%s] Running code review patrol", repo)

    file_tree = get_repo_file_tree(repo_path)
    recent_prs = get_recent_merged_prs(repo, limit=8)
    prs_text = "\n".join(
        f"- PR #{p['number']}: {p['title']} ({p.get('mergedAt','')[:10]})"
        for p in recent_prs
    ) or "(none)"

    # Read README for project description
    readme_path = Path(repo_path) / "README.md"
    description = readme_path.read_text(encoding="utf-8")[:800] if readme_path.exists() else "(no README)"

    prompt = CODE_REVIEW_PROMPT.format(
        repo=repo,
        description=description,
        file_tree=file_tree[:3000],
        recent_prs=prs_text,
    )
    text = call_ai(prompt, max_tokens=1500)
    return parse_issues_from_ai(text)


# ---------------------------------------------------------------------------
# Patrol 2: Research — trends and advisories
# ---------------------------------------------------------------------------

RESEARCH_PROMPT = """\
You are a technical researcher monitoring the ecosystem for a GitHub project.

Repository: {repo}
Tech stack: {tech_stack}
Recent merged work: {recent_prs}

Your task:
Identify up to 2 concrete improvements based on:
- New versions of key dependencies with important changes or security fixes
- Relevant security advisories (CVEs, GHSA) for dependencies in this stack
- New best practices that have emerged in this ecosystem (past 6 months)
- Relevant RFC or spec changes that should be reflected in the code
- Tooling improvements (linters, formatters, CI tools) that would meaningfully help

Each suggestion must be specific: name the dependency, version, CVE id, or RFC number.
Do NOT suggest vague "stay up to date" issues.
Do NOT suggest things already visible in recent PRs.

Return ONLY a JSON array:
[
  {{
    "title": "<chore/fix/feat>: <specific change with version/CVE/RFC reference>",
    "body": "<2-4 sentences: what changed, why it matters, what to do, acceptance criteria>",
    "priority": <1-100>
  }},
  ...
]

Return [] if there is nothing actionable.
"""


def infer_tech_stack(repo_path: str) -> str:
    """Infer tech stack from package.json, pyproject.toml, Cargo.toml, go.mod."""
    stack = []
    pkg_json = Path(repo_path) / "package.json"
    if pkg_json.exists():
        try:
            d = json.loads(pkg_json.read_text())
            deps = list(d.get("dependencies", {}).keys())[:12]
            dev_deps = list(d.get("devDependencies", {}).keys())[:8]
            stack.append(f"Node.js/TypeScript. deps: {', '.join(deps)}. devDeps: {', '.join(dev_deps)}")
        except Exception:
            stack.append("Node.js/TypeScript")
    for toml in ["pyproject.toml", "requirements.txt"]:
        if (Path(repo_path) / toml).exists():
            stack.append("Python")
            break
    if (Path(repo_path) / "Cargo.toml").exists():
        stack.append("Rust")
    if (Path(repo_path) / "go.mod").exists():
        stack.append("Go")
    return "; ".join(stack) if stack else "unknown"


def patrol_research(repo_cfg: dict, repo_path: str) -> list[dict]:
    repo = repo_cfg["repo"]
    log.info("[%s] Running research patrol", repo)

    tech_stack = infer_tech_stack(repo_path)
    recent_prs = get_recent_merged_prs(repo, limit=5)
    prs_text = "\n".join(
        f"- {p['title']}" for p in recent_prs
    ) or "(none)"

    prompt = RESEARCH_PROMPT.format(
        repo=repo,
        tech_stack=tech_stack,
        recent_prs=prs_text,
    )
    text = call_ai(prompt, max_tokens=1000)
    return parse_issues_from_ai(text)


# ---------------------------------------------------------------------------
# Patrol 3: Iteration — what to build next
# ---------------------------------------------------------------------------

ITERATION_PROMPT = """\
You are a product-minded engineer reviewing recent work on a GitHub project to suggest next steps.

Repository: {repo}
Project description: {description}

Recent merged PRs:
{recent_prs}

Current open issues (already planned):
{open_issues}

Your task:
Based on what was recently merged, suggest up to 2 natural next iteration steps that:
- Build on or complete the recent work
- Fill obvious gaps left by recent changes
- Improve robustness, observability, or developer experience
- Are scoped to 1-2 hours of implementation work

Do NOT suggest things already in open issues.
Do NOT suggest large architecture changes.
Be specific: name the functions, files, or behaviors to improve.

Return ONLY a JSON array:
[
  {{
    "title": "<feat/fix/chore>: <specific next step>",
    "body": "<2-4 sentences: what to build, why it follows naturally from recent work, acceptance criteria>",
    "priority": <1-100>
  }},
  ...
]

Return [] if there are no clear next steps.
"""


def patrol_iteration(repo_cfg: dict, repo_path: str) -> list[dict]:
    repo = repo_cfg["repo"]
    log.info("[%s] Running iteration patrol", repo)

    recent_prs = get_recent_merged_prs(repo, limit=10)
    if not recent_prs:
        log.info("[%s] No recent merged PRs — skipping iteration patrol", repo)
        return []

    prs_text = "\n".join(
        f"- PR #{p['number']}: {p['title']}\n  {(p.get('body') or '')[:200]}"
        for p in recent_prs[:6]
    )
    open_issues = get_open_issues(repo)
    issues_text = "\n".join(f"- #{i['number']}: {i['title']}" for i in open_issues[:15]) or "(none)"

    readme_path = Path(repo_path) / "README.md"
    description = readme_path.read_text(encoding="utf-8")[:600] if readme_path.exists() else ""

    prompt = ITERATION_PROMPT.format(
        repo=repo,
        description=description,
        recent_prs=prs_text,
        open_issues=issues_text,
    )
    text = call_ai(prompt, max_tokens=1000)
    return parse_issues_from_ai(text)


# ---------------------------------------------------------------------------
# Main patrol run
# ---------------------------------------------------------------------------

def run_patrol(repo_cfg: dict):
    repo = repo_cfg["repo"]
    repo_id = repo_cfg["id"]
    log.info("=== Patrol start: %s ===", repo)

    # Find local clone
    repo_path = f"/root/github/{repo_id}"
    if not Path(repo_path).exists():
        # Try alternative paths
        for candidate in [f"/root/github/{repo.split('/')[-1]}", f"/root/github/{repo_id}"]:
            if Path(candidate).exists():
                repo_path = candidate
                break
        else:
            log.warning("[%s] No local clone found at %s — skipping", repo, repo_path)
            return

    # Pull latest
    try:
        subprocess.run(["git", "pull", "--ff-only"], cwd=repo_path, capture_output=True, timeout=30)
        log.info("[%s] Pulled latest", repo)
    except Exception as e:
        log.warning("[%s] Pull failed: %s", repo, e)

    # Run all three patrols
    open_issues = get_open_issues(repo)
    all_suggestions: list[dict] = []

    for patrol_fn in (patrol_code_review, patrol_research, patrol_iteration):
        try:
            suggestions = patrol_fn(repo_cfg, repo_path)
            all_suggestions.extend(suggestions)
        except Exception as e:
            log.exception("[%s] Patrol %s failed: %s", repo, patrol_fn.__name__, e)

    if not all_suggestions:
        log.info("[%s] No actionable suggestions from patrol", repo)
        mark_patrolled(repo)
        return

    # Sort by priority, deduplicate against open issues, cap at max
    all_suggestions.sort(key=lambda x: x.get("priority", 100))
    filed = 0
    for s in all_suggestions:
        if filed >= MAX_ISSUES_PER_PATROL:
            break
        title = s.get("title", "").strip()
        body = s.get("body", "").strip()
        if not title or not body:
            continue
        # Deduplicate: skip if a similar issue already exists
        keyword = title.split(":")[-1].strip()[:40]
        if issue_already_exists(open_issues, keyword):
            log.info("[%s] Skipping duplicate: %r", repo, title[:60])
            continue

        body_with_context = (
            f"{body}\n\n"
            f"---\n"
            f"_Filed by automated patrol ({patrol_fn_name(s)}) on "
            f"{datetime.now(timezone.utc).strftime('%Y-%m-%d')}._"
        )
        result = file_issue(repo, title, body_with_context, labels=["claude", "patrol"])
        if result:
            filed += 1
            # Add to open_issues so next iteration checks dedup
            open_issues.append({"number": 0, "title": title, "labels": []})

    log.info("[%s] Filed %d issue(s) from patrol", repo, filed)
    mark_patrolled(repo)


def patrol_fn_name(suggestion: dict) -> str:
    """Guess which patrol type generated this suggestion based on title prefix."""
    title = suggestion.get("title", "").lower()
    if any(w in title for w in ("chore:", "dep", "update", "upgrade", "cve", "advisory")):
        return "research"
    if any(w in title for w in ("feat:", "next", "follow")):
        return "iteration"
    return "code-review"


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    conn = open_db()

    if not is_idle(conn):
        log.info("Jobs are active — patrol skipped")
        sys.exit(0)

    repos = full_mode_repos()
    if not repos:
        log.info("No full-mode repos configured")
        sys.exit(0)

    repo_cfg = next_repo_to_patrol(repos)
    if repo_cfg is None:
        log.info("All repos patrolled recently — cooldown active")
        sys.exit(0)

    # Create patrol labels if needed
    for label_def in [
        ("patrol", "Filed by automated patrol", "8b5cf6"),
    ]:
        subprocess.run(
            ["gh", "label", "create", label_def[0],
             "--repo", repo_cfg["repo"],
             "--description", label_def[1],
             "--color", label_def[2],
             "--force"],
            capture_output=True,
            env={**os.environ, "GH_TOKEN": GH_TOKEN},
        )

    run_patrol(repo_cfg)


if __name__ == "__main__":
    main()
