#!/usr/bin/env python3
"""
Claude Bot Scheduler — polls GitHub for labeled issues and enqueues jobs.
Reads monitored repos from /srv/claude-bot/repos.yml (or REPOS_CONFIG_PATH).
After each poll cycle, newly enqueued jobs are batch-scored by glm-4.7 and
assigned a priority (1–100, lower = higher priority) for cross-repo ordering.
"""

import json
import logging
import os
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import yaml

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [scheduler] %(levelname)s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("scheduler")

DB_PATH = os.environ.get("DB_PATH", "/srv/claude-bot/db.sqlite3")
REPOS_CONFIG_PATH = os.environ.get("REPOS_CONFIG_PATH", "/srv/claude-bot/repos.yml")
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL", "120"))
GH_TOKEN = os.environ.get("GH_TOKEN", "")

ANTHROPIC_AUTH_TOKEN = os.environ.get("ANTHROPIC_AUTH_TOKEN", "")
ANTHROPIC_BASE_URL = os.environ.get("ANTHROPIC_BASE_URL", "https://api.z.ai/api/anthropic")


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  repo TEXT NOT NULL,
  issue_number INTEGER,
  pr_number INTEGER,
  title TEXT NOT NULL,
  body TEXT DEFAULT '',
  labels_json TEXT DEFAULT '[]',

  base_branch TEXT NOT NULL DEFAULT 'main',
  branch TEXT,
  worktree_path TEXT,

  state TEXT NOT NULL DEFAULT 'pending',
  stage TEXT NOT NULL DEFAULT 'queued',
  priority INTEGER NOT NULL DEFAULT 100,
  priority_reason TEXT DEFAULT '',

  model_tier TEXT NOT NULL DEFAULT 'normal',
  review_tier TEXT NOT NULL DEFAULT 'light',
  automerge INTEGER NOT NULL DEFAULT 1,

  retry_count INTEGER NOT NULL DEFAULT 0,
  ci_retry_count INTEGER NOT NULL DEFAULT 0,
  review_retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 5,
  max_ci_retries INTEGER NOT NULL DEFAULT 3,
  max_review_retries INTEGER NOT NULL DEFAULT 2,

  provider TEXT NOT NULL DEFAULT 'zai-glm',
  model_alias TEXT DEFAULT 'sonnet',
  effective_model TEXT DEFAULT 'glm-4.7',
  provider_status TEXT NOT NULL DEFAULT 'ok',
  next_retry_at TEXT,
  last_provider_error_code TEXT,
  last_provider_error_message TEXT,
  provider_retry_count INTEGER NOT NULL DEFAULT 0,
  rate_limit_count INTEGER NOT NULL DEFAULT 0,

  lease_owner TEXT,
  lease_expires_at TEXT,
  claimed_at TEXT,
  started_at TEXT,
  finished_at TEXT,

  pr_head_sha TEXT,
  reviewed_head_sha TEXT,
  last_wip_commit TEXT,
  last_error TEXT,
  last_ci_log_path TEXT,
  last_review_json TEXT,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_jobs_issue    ON jobs(repo, issue_number);
CREATE INDEX IF NOT EXISTS idx_jobs_claim    ON jobs(state, priority, created_at, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_jobs_lease    ON jobs(state, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_jobs_provider ON jobs(provider, model_tier, state);

CREATE TABLE IF NOT EXISTS provider_account_state (
  provider TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'ok',
  effective_concurrency INTEGER NOT NULL DEFAULT 1,
  paused_until TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  consecutive_successes INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS provider_model_state (
  provider TEXT NOT NULL,
  model_tier TEXT NOT NULL,
  model_alias TEXT NOT NULL,
  effective_model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  effective_concurrency INTEGER NOT NULL DEFAULT 1,
  fallback_model_alias TEXT,
  fallback_effective_model TEXT,
  paused_until TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(provider, model_tier)
);

INSERT OR IGNORE INTO provider_account_state(provider, status, effective_concurrency)
VALUES ('zai-glm', 'ok', 1);

INSERT OR IGNORE INTO provider_model_state
  (provider, model_tier, model_alias, effective_model, effective_concurrency)
VALUES
  ('zai-glm', 'docs',   'haiku',  'glm-4.7',     1),
  ('zai-glm', 'normal', 'sonnet', 'glm-4.7',     1),
  ('zai-glm', 'hard',   'opus',   'glm-5.2[1m]', 1);
"""

# Migration: add priority_reason column if it doesn't exist yet
MIGRATION = """
ALTER TABLE jobs ADD COLUMN priority_reason TEXT DEFAULT '';
"""


def open_db() -> sqlite3.Connection:
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    try:
        conn.execute(MIGRATION)
        conn.commit()
    except sqlite3.OperationalError:
        pass  # column already exists
    return conn


# ---------------------------------------------------------------------------
# GitHub helpers
# ---------------------------------------------------------------------------

def gh(args: list[str], capture: bool = True) -> str | None:
    env = os.environ.copy()
    if GH_TOKEN:
        env["GH_TOKEN"] = GH_TOKEN
    try:
        result = subprocess.run(
            ["gh"] + args,
            capture_output=capture,
            text=True,
            timeout=30,
            env=env,
        )
        if result.returncode != 0:
            log.warning("gh %s failed: %s", " ".join(args), result.stderr.strip())
            return None
        return result.stdout.strip() if capture else None
    except subprocess.TimeoutExpired:
        log.warning("gh %s timed out", " ".join(args))
        return None
    except FileNotFoundError:
        log.error("gh CLI not found in PATH")
        return None


def gh_issue_list(repo: str, label: str) -> list[dict]:
    out = gh([
        "issue", "list",
        "--repo", repo,
        "--label", label,
        "--state", "open",
        "--json", "number,title,body,labels",
        "--limit", "50",
    ])
    if not out:
        return []
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        log.warning("Failed to parse issue list for %s", repo)
        return []


# ---------------------------------------------------------------------------
# Tier helpers
# ---------------------------------------------------------------------------

def determine_tiers(labels: set[str], repo_cfg: dict) -> tuple[str, str, bool]:
    model_tier = "normal"
    if repo_cfg.get("docs_label", "claude-docs") in labels:
        model_tier = "docs"
    elif repo_cfg.get("hard_label", "claude-hard") in labels:
        model_tier = "hard"

    review_tier = "deep" if repo_cfg.get("deep_review_label", "claude-deep-review") in labels else "light"

    automerge = (
        repo_cfg.get("automerge_default", True)
        and repo_cfg.get("no_automerge_label", "claude-no-automerge") not in labels
    )

    return model_tier, review_tier, automerge


def model_for_tier(model_tier: str) -> tuple[str, str]:
    if model_tier == "hard":
        return "opus", "glm-5.2[1m]"
    if model_tier == "docs":
        return "haiku", "glm-4.7"
    return "sonnet", "glm-4.7"


# ---------------------------------------------------------------------------
# AI priority scoring — single batch call to glm-4.7
# ---------------------------------------------------------------------------

PRIORITY_PROMPT = """You are a task scheduler for an autonomous software development bot.
You will receive a list of GitHub issues from multiple repositories.
Score each issue with a priority from 1 to 100 (lower = execute first).

Scoring guidelines:
- 1–15:  Production incident / crash / data loss / security vulnerability / blocks other work
- 16–30: Important bug affecting core functionality, regression, broken CI
- 31–50: Normal feature or bug with clear acceptance criteria, moderate complexity
- 51–70: Improvement, refactor, or feature with lower urgency
- 71–85: Documentation, README, comments, minor cleanup
- 86–100: Nice-to-have, low urgency, cosmetic

Cross-repo ordering: treat all issues equally regardless of repo.
Prefer issues that unblock other issues or are quick to complete over slow complex ones.

Return ONLY a JSON array, no other text:
[
  {"id": <issue id from input>, "priority": <1-100>, "reason": "<one sentence>"},
  ...
]

Issues to score:
"""


def score_issues_with_ai(issues: list[dict]) -> dict[int, tuple[int, str]]:
    """
    Call glm-4.7 once to score all issues.
    Returns {job_id: (priority, reason)}.
    Falls back to heuristic scoring on any error.
    """
    if not issues:
        return {}

    # Build compact issue list for the prompt
    issue_text = json.dumps([
        {
            "id": item["job_id"],
            "repo": item["repo"],
            "title": item["title"],
            "body": (item["body"] or "")[:300],
            "labels": item["labels"],
            "model_tier": item["model_tier"],
        }
        for item in issues
    ], ensure_ascii=False, indent=2)

    prompt = PRIORITY_PROMPT + issue_text

    try:
        import urllib.request
        import urllib.error

        payload = json.dumps({
            "model": "glm-4.7",
            "max_tokens": 1024,
            "messages": [{"role": "user", "content": prompt}],
        }).encode()

        base_url = ANTHROPIC_BASE_URL.rstrip("/")
        req = urllib.request.Request(
            f"{base_url}/v1/messages",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "x-api-key": ANTHROPIC_AUTH_TOKEN,
                "anthropic-version": "2023-06-01",
            },
            method="POST",
        )

        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())

        text = data["content"][0]["text"].strip()

        # Strip markdown fences if present
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        text = text.strip()

        scores = json.loads(text)
        result = {}
        for item in scores:
            job_id = int(item["id"])
            priority = max(1, min(100, int(item.get("priority", 100))))
            reason = str(item.get("reason", ""))[:200]
            result[job_id] = (priority, reason)

        log.info("AI scored %d issue(s)", len(result))
        return result

    except Exception as e:
        log.warning("AI scoring failed (%s), using heuristic fallback", e)
        return {}


def heuristic_priority(title: str, body: str, model_tier: str, labels: list[str]) -> tuple[int, str]:
    """Fallback when AI scoring is unavailable."""
    title_lower = title.lower()
    body_lower = (body or "").lower()

    if any(w in title_lower for w in ("crash", "critical", "urgent", "production", "security", "data loss", "broken")):
        return 15, "heuristic: critical keyword in title"
    if any(w in title_lower for w in ("bug", "fix", "error", "fail", "regression", "broken")):
        return 35, "heuristic: bug/fix keyword"
    if model_tier == "docs":
        return 75, "heuristic: docs label"
    if model_tier == "hard":
        return 55, "heuristic: hard label (complex task)"
    return 60, "heuristic: default normal task"


# ---------------------------------------------------------------------------
# Job upsert
# ---------------------------------------------------------------------------

def upsert_job(conn: sqlite3.Connection, repo: str, issue: dict, repo_cfg: dict) -> int | None:
    """
    Insert or update a job. Returns job_id if newly inserted, None if updated/skipped.
    """
    number = issue["number"]
    title = issue["title"]
    body = issue.get("body") or ""
    labels = {lbl["name"] for lbl in issue.get("labels", [])}
    base_branch = repo_cfg.get("base_branch", "main")

    model_tier, review_tier, automerge = determine_tiers(labels, repo_cfg)
    model_alias, effective_model = model_for_tier(model_tier)
    max_retries = 7 if model_tier == "hard" else 5
    max_ci_retries = 4 if model_tier == "hard" else 3
    max_review_retries = 3 if model_tier == "hard" else 2

    existing = conn.execute(
        "SELECT id, state, priority FROM jobs WHERE repo=? AND issue_number=?",
        (repo, number),
    ).fetchone()

    if existing:
        if existing["state"] in ("merged", "max_retry_exceeded", "provider_blocked", "blocked"):
            log.debug("Skipping issue #%d in terminal state %s", number, existing["state"])
            return None
        conn.execute("""
            UPDATE jobs
            SET title=?, body=?, labels_json=?,
                model_tier=?, review_tier=?, automerge=?,
                model_alias=?, effective_model=?,
                updated_at=CURRENT_TIMESTAMP
            WHERE repo=? AND issue_number=?
        """, (
            title, body, json.dumps(sorted(labels)),
            model_tier, review_tier, int(automerge),
            model_alias, effective_model,
            repo, number,
        ))
        log.debug("Updated job for %s#%d", repo, number)
        conn.commit()
        return None  # not new, skip scoring

    cursor = conn.execute("""
        INSERT INTO jobs (
          repo, issue_number, title, body, labels_json,
          base_branch, state, stage, priority,
          model_tier, review_tier, automerge,
          model_alias, effective_model, provider,
          max_retries, max_ci_retries, max_review_retries
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (
        repo, number, title, body, json.dumps(sorted(labels)),
        base_branch, "pending", "queued", 100,  # temporary priority
        model_tier, review_tier, int(automerge),
        model_alias, effective_model, "zai-glm",
        max_retries, max_ci_retries, max_review_retries,
    ))
    conn.commit()
    log.info("Enqueued new job: %s#%d [%s] %r", repo, number, model_tier, title[:60])
    return cursor.lastrowid


# ---------------------------------------------------------------------------
# Batch priority assignment
# ---------------------------------------------------------------------------

def assign_priorities(conn: sqlite3.Connection, new_jobs: list[dict]):
    """Score all new jobs in one AI call, then update DB."""
    if not new_jobs:
        return

    if len(new_jobs) == 1:
        # Single job: use heuristic to avoid API call overhead
        job = new_jobs[0]
        priority, reason = heuristic_priority(
            job["title"], job["body"], job["model_tier"], job["labels"]
        )
        conn.execute(
            "UPDATE jobs SET priority=?, priority_reason=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
            (priority, reason, job["job_id"]),
        )
        conn.commit()
        log.info("Priority job %d → %d (%s)", job["job_id"], priority, reason)
        return

    # Multiple new jobs: batch AI scoring
    scores = score_issues_with_ai(new_jobs)

    for job in new_jobs:
        job_id = job["job_id"]
        if job_id in scores:
            priority, reason = scores[job_id]
        else:
            # AI didn't return this job or call failed — use heuristic
            priority, reason = heuristic_priority(
                job["title"], job["body"], job["model_tier"], job["labels"]
            )
        conn.execute(
            "UPDATE jobs SET priority=?, priority_reason=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
            (priority, reason, job_id),
        )
        log.info(
            "Priority %s#%d → %d: %s",
            job["repo"], job["issue_number"], priority, reason,
        )

    conn.commit()


# ---------------------------------------------------------------------------
# Lease recovery
# ---------------------------------------------------------------------------

def recover_expired_leases(conn: sqlite3.Connection):
    rows = conn.execute("""
        SELECT id, repo, issue_number, lease_owner
        FROM jobs
        WHERE state='running'
          AND lease_expires_at < datetime('now')
    """).fetchall()

    for row in rows:
        log.warning(
            "Recovering expired lease for job %d (%s#%s, worker %s)",
            row["id"], row["repo"], row["issue_number"], row["lease_owner"],
        )
        conn.execute("""
            UPDATE jobs
            SET state='pending', stage='lease_recovered',
                lease_owner=NULL, lease_expires_at=NULL,
                updated_at=CURRENT_TIMESTAMP
            WHERE id=?
        """, (row["id"],))

    if rows:
        conn.commit()


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def load_repos_yml() -> list[dict]:
    path = Path(REPOS_CONFIG_PATH)
    if not path.exists():
        log.error("repos.yml not found at %s", REPOS_CONFIG_PATH)
        return []
    with open(path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    return [r for r in cfg.get("repositories", []) if r.get("enabled", True)]


def scheduler_loop():
    conn = open_db()
    log.info(
        "Scheduler started. DB=%s, repos=%s, poll=%ss, ai_scoring=%s",
        DB_PATH, REPOS_CONFIG_PATH, POLL_INTERVAL,
        "enabled" if ANTHROPIC_AUTH_TOKEN else "disabled (no token)",
    )

    while True:
        try:
            recover_expired_leases(conn)

            repos = load_repos_yml()
            new_jobs: list[dict] = []  # collect all new jobs this cycle for batch scoring

            if not repos:
                log.warning("No enabled repositories in repos.yml")
            else:
                for repo_cfg in repos:
                    repo = repo_cfg["repo"]
                    label = repo_cfg.get("enqueue_label", "claude")
                    try:
                        issues = gh_issue_list(repo, label)
                        log.info(
                            "Repo %s: found %d open issue(s) with label '%s'",
                            repo, len(issues), label,
                        )
                        for issue in issues:
                            job_id = upsert_job(conn, repo, issue, repo_cfg)
                            if job_id is not None:
                                labels = [lbl["name"] for lbl in issue.get("labels", [])]
                                label_set = set(labels)
                                model_tier, _, _ = determine_tiers(label_set, repo_cfg)
                                new_jobs.append({
                                    "job_id": job_id,
                                    "repo": repo,
                                    "issue_number": issue["number"],
                                    "title": issue["title"],
                                    "body": issue.get("body") or "",
                                    "labels": labels,
                                    "model_tier": model_tier,
                                })
                    except Exception:
                        log.exception("Error processing repo %s", repo)

            # Batch-score all new jobs from this cycle in one AI call
            if new_jobs:
                log.info("Scoring %d new job(s) for priority...", len(new_jobs))
                assign_priorities(conn, new_jobs)

                # Log final queue order
                queue = conn.execute("""
                    SELECT repo, issue_number, priority, priority_reason, title
                    FROM jobs
                    WHERE state IN ('pending','fixing','remote_ci_failed','review_failed')
                    ORDER BY priority ASC, created_at ASC
                    LIMIT 20
                """).fetchall()
                if queue:
                    log.info("Current execution queue (%d pending):", len(queue))
                    for i, row in enumerate(queue, 1):
                        log.info(
                            "  %d. [p=%d] %s#%d %r — %s",
                            i, row["priority"], row["repo"], row["issue_number"],
                            row["title"][:50], row["priority_reason"],
                        )

        except Exception:
            log.exception("Scheduler loop error")

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    scheduler_loop()
