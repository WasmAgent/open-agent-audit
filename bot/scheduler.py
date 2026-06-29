#!/usr/bin/env python3
"""
Claude Bot Scheduler — polls GitHub for labeled issues and enqueues jobs.

Permission model:
- Organization members: issues with 'claude' label are enqueued immediately.
- External contributors: bot enters a discussion loop, evaluates maturity and
  long-term alignment, and only enqueues if the proposal is approved.
"""

import json
import logging
import os
import re
import sqlite3
import subprocess
import sys
import time
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

# Minimum seconds between re-evaluating the same external discussion
DISCUSSION_REEVAL_INTERVAL = int(os.environ.get("DISCUSSION_REEVAL_INTERVAL", "21600"))  # 6h

# Membership cache: {(org, login): (is_member: bool, timestamp: float)}
_member_cache: dict = {}
MEMBER_CACHE_TTL = 3600  # 1 hour


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

  author_login TEXT DEFAULT '',
  author_is_member INTEGER DEFAULT 1,
  discussion_state TEXT DEFAULT NULL,
  bot_comment_id TEXT DEFAULT NULL,
  discussion_last_checked_at TEXT DEFAULT NULL,
  discussion_comment_count INTEGER DEFAULT 0,

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

CREATE INDEX IF NOT EXISTS idx_jobs_issue      ON jobs(repo, issue_number);
CREATE INDEX IF NOT EXISTS idx_jobs_claim      ON jobs(state, priority, created_at, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_jobs_lease      ON jobs(state, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_jobs_provider   ON jobs(provider, model_tier, state);

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

MIGRATIONS = [
    "ALTER TABLE jobs ADD COLUMN priority_reason TEXT DEFAULT ''",
    "ALTER TABLE jobs ADD COLUMN author_login TEXT DEFAULT ''",
    "ALTER TABLE jobs ADD COLUMN author_is_member INTEGER DEFAULT 1",
    "ALTER TABLE jobs ADD COLUMN discussion_state TEXT DEFAULT NULL",
    "ALTER TABLE jobs ADD COLUMN bot_comment_id TEXT DEFAULT NULL",
    "ALTER TABLE jobs ADD COLUMN discussion_last_checked_at TEXT DEFAULT NULL",
    "ALTER TABLE jobs ADD COLUMN discussion_comment_count INTEGER DEFAULT 0",
    "ALTER TABLE jobs ADD COLUMN depends_on_jobs TEXT DEFAULT '[]'",
    "ALTER TABLE jobs ADD COLUMN token_input INTEGER DEFAULT 0",
    "ALTER TABLE jobs ADD COLUMN token_output INTEGER DEFAULT 0",
]


def open_db() -> sqlite3.Connection:
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    for migration in MIGRATIONS:
        try:
            conn.execute(migration)
            conn.commit()
        except sqlite3.OperationalError:
            pass
    # Create discussion index after columns are guaranteed to exist
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_jobs_discussion
        ON jobs(author_is_member, discussion_state, discussion_last_checked_at)
    """)
    conn.commit()
    return conn


# ---------------------------------------------------------------------------
# GitHub helpers
# ---------------------------------------------------------------------------

def _gh_env() -> dict:
    env = os.environ.copy()
    if GH_TOKEN:
        env["GH_TOKEN"] = GH_TOKEN
    return env


def gh(args: list[str], capture: bool = True, check: bool = False) -> str | None:
    try:
        result = subprocess.run(
            ["gh"] + args,
            capture_output=capture,
            text=True,
            timeout=30,
            env=_gh_env(),
        )
        if check and result.returncode != 0:
            raise RuntimeError(f"gh failed: {result.stderr.strip()}")
        if result.returncode != 0:
            log.warning("gh %s failed: %s", " ".join(args[:3]), (result.stderr or "").strip())
            return None
        return result.stdout.strip() if capture else None
    except subprocess.TimeoutExpired:
        log.warning("gh %s timed out", " ".join(args[:3]))
        return None
    except FileNotFoundError:
        log.error("gh CLI not found in PATH")
        return None


def gh_issue_list(repo: str, label: str) -> list[dict]:
    out = gh([
        "issue", "list", "--repo", repo, "--label", label,
        "--state", "open", "--json", "number,title,body,labels,author",
        "--limit", "50",
    ])
    if not out:
        return []
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        log.warning("Failed to parse issue list for %s", repo)
        return []


def gh_issue_comments(repo: str, issue_number: int) -> list[dict]:
    out = gh([
        "issue", "view", str(issue_number), "--repo", repo,
        "--json", "comments",
        "--jq", ".comments",
    ])
    if not out:
        return []
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return []


def has_human_member_comment(comments: list[dict], org: str, bot_login: str = "github-actions[bot]") -> bool:
    """Return True if any comment is from a human org member (not a bot)."""
    for c in comments:
        author = (c.get("author") or {}).get("login", "")
        if not author:
            continue
        # Skip known bots
        if author.endswith("[bot]") or author == bot_login:
            continue
        # Check if this commenter is an org member
        if is_org_member(org, author):
            return True
    return False


def gh_post_comment(repo: str, issue_number: int, body: str) -> str | None:
    """Post a comment and return its node_id/URL."""
    out = gh([
        "issue", "comment", str(issue_number),
        "--repo", repo,
        "--body", body,
    ])
    return out


def gh_close_issue(repo: str, issue_number: int, comment: str):
    gh_post_comment(repo, issue_number, comment)
    gh(["issue", "close", str(issue_number), "--repo", repo])


# ---------------------------------------------------------------------------
# Org membership check
# ---------------------------------------------------------------------------

def org_from_repo(repo: str) -> str:
    return repo.split("/")[0]


def is_org_member(org: str, login: str) -> bool:
    """Check if login is a member of the org. Fails open (returns True) on API errors."""
    cache_key = (org, login)
    cached = _member_cache.get(cache_key)
    if cached:
        result, ts = cached
        if time.time() - ts < MEMBER_CACHE_TTL:
            return result

    result = subprocess.run(
        ["gh", "api", f"orgs/{org}/members/{login}"],
        capture_output=True, text=True, timeout=15, env=_gh_env(),
    )

    if result.returncode == 0:
        is_member = True
    elif "404" in (result.stderr or "") or "Not Found" in (result.stderr or ""):
        is_member = False
    else:
        # API error / insufficient permissions — fail open to avoid blocking legit contributors
        log.warning("Membership check failed for %s/%s (%s) — treating as member",
                    org, login, (result.stderr or "").strip()[:100])
        is_member = True

    _member_cache[cache_key] = (is_member, time.time())
    log.debug("Membership %s/%s: %s", org, login, is_member)
    return is_member


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
# AI helpers (shared by scoring + discussion evaluation)
# ---------------------------------------------------------------------------

def call_ai(prompt: str, max_tokens: int = 1024, model: str = "glm-5.2") -> str | None:
    """Call Z.AI directly. Uses glm-5.2 by default for all planning/analysis tasks."""
    if not ANTHROPIC_AUTH_TOKEN:
        return None
    try:
        import urllib.request
        payload = json.dumps({
            "model": model,
            "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": prompt}],
        }).encode()
        req = urllib.request.Request(
            f"{ANTHROPIC_BASE_URL.rstrip('/')}/v1/messages",
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
        return data["content"][0]["text"].strip()
    except Exception as e:
        log.warning("AI call failed: %s", e)
        return None


def parse_json_from_ai(text: str) -> dict | list | None:
    if not text:
        return None
    cleaned = re.sub(r"^```(?:json)?\s*", "", text.strip())
    cleaned = re.sub(r"\s*```$", "", cleaned).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        m = re.search(r'\{.*\}', cleaned, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                pass
    return None


# ---------------------------------------------------------------------------
# AI priority + dependency analysis (single batch call)
# ---------------------------------------------------------------------------

SCORE_AND_DEPS_PROMPT = """\
You are a task scheduler for an autonomous software development bot.
Given a list of GitHub issues (possibly from multiple repos), do two things:

1. Score each issue with a priority from 1 to 100 (lower = execute first).
   Scoring:
    1–15:  Production incident / crash / security / blocks other work
   16–30:  Important bug affecting core functionality
   31–50:  Normal feature or bug, clear acceptance criteria
   51–70:  Improvement, refactor, lower urgency
   71–85:  Documentation, README, minor cleanup
   86–100: Nice-to-have, cosmetic
   Cross-repo: treat issues equally regardless of repo.
   Prefer issues that unblock others or complete quickly.

2. Identify dependencies: if issue B cannot start until issue A is merged
   (because B builds on A's code, schema, or output), list A's id in B's depends_on.
   Only list DIRECT blocking dependencies (not "nice to have" ordering).
   If there are no dependencies, use an empty array.
   Only reference ids that appear in this list.

Return ONLY a JSON array, no other text:
[
  {
    "id": <issue id from input>,
    "priority": <1-100>,
    "reason": "<one sentence>",
    "depends_on": [<id>, ...]
  },
  ...
]

Issues:
"""


def score_and_analyze_deps(issues: list[dict]) -> dict[int, dict]:
    """
    Single AI call: returns {job_id: {"priority": int, "reason": str, "depends_on": [job_id, ...]}}
    """
    if not issues:
        return {}
    issue_text = json.dumps([
        {
            "id": i["job_id"],
            "repo": i["repo"],
            "issue_number": i["issue_number"],
            "title": i["title"],
            "body": (i["body"] or "")[:400],
            "labels": i["labels"],
            "model_tier": i["model_tier"],
        }
        for i in issues
    ], ensure_ascii=False, indent=2)

    text = call_ai(SCORE_AND_DEPS_PROMPT + issue_text, max_tokens=2048)
    parsed = parse_json_from_ai(text)
    if not isinstance(parsed, list):
        return {}

    result = {}
    valid_ids = {i["job_id"] for i in issues}
    for item in parsed:
        try:
            job_id = int(item["id"])
            priority = max(1, min(100, int(item.get("priority", 100))))
            reason = str(item.get("reason", ""))[:200]
            depends_on = [
                int(d) for d in item.get("depends_on", [])
                if int(d) in valid_ids and int(d) != job_id
            ]
            result[job_id] = {"priority": priority, "reason": reason, "depends_on": depends_on}
        except (KeyError, ValueError, TypeError):
            pass

    log.info("AI scored %d issue(s) with dependency analysis", len(result))
    return result


def heuristic_priority(title: str, model_tier: str) -> tuple[int, str]:
    t = title.lower()
    if any(w in t for w in ("crash", "critical", "urgent", "security", "data loss")):
        return 15, "heuristic: critical keyword"
    if any(w in t for w in ("bug", "fix", "error", "fail", "regression")):
        return 35, "heuristic: bug/fix keyword"
    if model_tier == "docs":
        return 75, "heuristic: docs label"
    if model_tier == "hard":
        return 55, "heuristic: hard label"
    return 60, "heuristic: normal task"


def assign_priorities(conn: sqlite3.Connection, new_jobs: list[dict]):
    """Score new jobs and write priority + dependency graph to DB."""
    if not new_jobs:
        return

    if len(new_jobs) == 1:
        job = new_jobs[0]
        priority, reason = heuristic_priority(job["title"], job["model_tier"])
        conn.execute(
            "UPDATE jobs SET priority=?, priority_reason=?, depends_on_jobs=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
            (priority, reason, "[]", job["job_id"]),
        )
        conn.commit()
        log.info("Priority job %d → %d (%s)", job["job_id"], priority, reason)
        return

    scores = score_and_analyze_deps(new_jobs)

    for job in new_jobs:
        job_id = job["job_id"]
        if "priority:critical" in job.get("labels", []):
            conn.execute("UPDATE jobs SET priority=1, priority_reason='priority:critical label', updated_at=CURRENT_TIMESTAMP WHERE id=?", (job_id,))
            log.info("Critical priority override: job %d → p=1", job_id)
            continue
        if job_id in scores:
            s = scores[job_id]
            priority, reason = s["priority"], s["reason"]
            depends_on = s["depends_on"]
        else:
            priority, reason = heuristic_priority(job["title"], job["model_tier"])
            depends_on = []

        conn.execute(
            "UPDATE jobs SET priority=?, priority_reason=?, depends_on_jobs=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
            (priority, reason, json.dumps(depends_on), job_id),
        )
        dep_str = f" depends_on={depends_on}" if depends_on else ""
        log.info("Priority %s#%d → %d%s: %s",
                 job["repo"], job["issue_number"], priority, dep_str, reason)

    conn.commit()

    # Log dependency graph summary
    deps_found = [(j["job_id"], scores[j["job_id"]]["depends_on"])
                  for j in new_jobs if j["job_id"] in scores and scores[j["job_id"]]["depends_on"]]
    if deps_found:
        log.info("Dependency graph:")
        for job_id, deps in deps_found:
            log.info("  job %d depends on: %s", job_id, deps)


# ---------------------------------------------------------------------------
# External contributor discussion flow
# ---------------------------------------------------------------------------

INITIAL_RESPONSE_PROMPT = """\
You are a helpful bot for an open-source project. An external contributor has opened an issue.

Repository: {repo}
Issue title: {title}
Issue body:
{body}

Write a friendly, concise GitHub comment (in English) that:
1. Thanks the contributor and acknowledges their proposal.
2. Briefly summarizes your understanding of what they are proposing.
3. Asks 1–3 focused clarifying questions if the proposal needs more context,
   or confirms it is clear and says what additional discussion is needed before automation can proceed.
4. Explains transparently that this project uses an automated bot, and that
   external contributions go through a discussion review before being scheduled.

Keep it under 200 words. Do not make any promises about implementation.
Return only the comment text, no JSON wrapper.
"""

EVALUATION_PROMPT = """\
You are a senior maintainer reviewing an external contributor's GitHub issue proposal.

Repository: {repo}
Project context: This is an automated software development bot infrastructure project.

Issue title: {title}
Issue body:
{body}

Discussion so far (comments):
{comments}

Evaluate whether this proposal should be accepted for automated implementation.

Criteria:
1. Is the proposal well-defined with clear, testable acceptance criteria?
2. Does it align with the project's long-term interests (reliability, security, maintainability)?
3. Is the scope reasonable (not a massive refactor without justification)?
4. Has the contributor engaged constructively with questions?
5. Are there any security, quality, or scope concerns?

Return JSON only:
{{
  "decision": "approve" | "reject" | "needs_more_info",
  "reason": "<one or two sentences explaining the decision>",
  "response_comment": "<friendly GitHub comment to post, in English, max 150 words>"
}}

Be fair but maintain high standards. Reject proposals that are vague, out of scope, or potentially harmful.
"""


def generate_initial_response(repo: str, title: str, body: str) -> str:
    prompt = INITIAL_RESPONSE_PROMPT.format(repo=repo, title=title, body=(body or "")[:800])
    text = call_ai(prompt, max_tokens=512)
    if text:
        return text
    # Fallback
    return (
        f"Thank you for opening this issue! 👋\n\n"
        f"This project uses an automated development bot. External contributions go through "
        f"a discussion review before being scheduled for implementation.\n\n"
        f"Could you clarify:\n"
        f"- What specific problem does this solve?\n"
        f"- What would a successful implementation look like?\n\n"
        f"Once we have enough context, this will be evaluated for inclusion."
    )


def evaluate_discussion(repo: str, title: str, body: str, comments: list[dict]) -> dict:
    """
    Returns {"decision": "approve"|"reject"|"needs_more_info",
             "reason": str, "response_comment": str}
    """
    comments_text = "\n\n".join(
        f"@{c.get('author', {}).get('login', '?')} ({c.get('createdAt', '')}):\n{c.get('body', '')[:400]}"
        for c in comments[-20:]  # last 20 comments
    ) or "(no comments yet)"

    prompt = EVALUATION_PROMPT.format(
        repo=repo, title=title,
        body=(body or "")[:800],
        comments=comments_text,
    )
    text = call_ai(prompt, max_tokens=600)
    parsed = parse_json_from_ai(text)

    if isinstance(parsed, dict) and "decision" in parsed:
        return parsed

    # Fallback: needs more info
    return {
        "decision": "needs_more_info",
        "reason": "Could not evaluate automatically.",
        "response_comment": "Thanks for the discussion so far. We need a bit more context before this can be scheduled.",
    }


def reanalyze_existing_deps(conn: sqlite3.Connection):
    """
    For repos that have multiple pending jobs but no dependency data yet,
    re-run the AI analysis to fill in depends_on_jobs.
    Runs at most once per scheduler cycle, only if there are unanalyzed jobs.
    """
    # Find repos with 2+ pending jobs that haven't been dependency-analyzed
    rows = conn.execute("""
        SELECT repo, COUNT(*) as cnt
        FROM jobs
        WHERE state IN ('pending','fixing','remote_ci_failed','review_failed')
          AND (depends_on_jobs IS NULL OR depends_on_jobs = '[]')
          AND author_is_member = 1
        GROUP BY repo
        HAVING cnt >= 2
    """).fetchall()

    for repo_row in rows:
        repo = repo_row["repo"]
        jobs = conn.execute("""
            SELECT id, issue_number, title, body, model_tier, labels_json
            FROM jobs
            WHERE repo=? AND state IN ('pending','fixing','remote_ci_failed','review_failed')
              AND author_is_member = 1
            ORDER BY priority ASC, created_at ASC
            LIMIT 30
        """, (repo,)).fetchall()

        if len(jobs) < 2:
            continue

        issues = [
            {
                "job_id": j["id"],
                "repo": repo,
                "issue_number": j["issue_number"],
                "title": j["title"],
                "body": j["body"] or "",
                "labels": json.loads(j["labels_json"] or "[]"),
                "model_tier": j["model_tier"],
            }
            for j in jobs
        ]

        log.info("Re-analyzing dependencies for %s (%d jobs)", repo, len(issues))
        scores = score_and_analyze_deps(issues)

        for job in jobs:
            job_id = job["id"]
            if job_id in scores and scores[job_id]["depends_on"]:
                depends_on = scores[job_id]["depends_on"]
                conn.execute(
                    "UPDATE jobs SET depends_on_jobs=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                    (json.dumps(depends_on), job_id),
                )
                log.info("  job %d depends on: %s", job_id, depends_on)

        conn.commit()


def process_external_discussions(conn: sqlite3.Connection, new_external_ids: set[int]):
    """
    Advance the discussion state machine for all open external issues.
    - New issues: post initial bot comment.
    - Existing issues: re-evaluate if new comments appeared or interval elapsed.
    """
    now_ts = time.time()
    now_str = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(now_ts))

    # Fetch all open external issues (not yet approved/rejected)
    rows = conn.execute("""
        SELECT id, repo, issue_number, title, body,
               discussion_state, bot_comment_id,
               discussion_last_checked_at, discussion_comment_count
        FROM jobs
        WHERE author_is_member = 0
          AND discussion_state NOT IN ('approved', 'rejected', 'member_handling')
          AND state NOT IN ('merged', 'blocked', 'max_retry_exceeded')
    """).fetchall()

    for row in rows:
        job_id = row["id"]
        repo = row["repo"]
        issue_number = row["issue_number"]
        title = row["title"]
        body = row["body"] or ""
        discussion_state = row["discussion_state"]

        # --- Step 1: Post initial response for brand-new external issues ---
        if discussion_state is None or job_id in new_external_ids:
            org = org_from_repo(repo)
            comments = gh_issue_comments(repo, issue_number)

            if has_human_member_comment(comments, org):
                # A team member already replied — don't pile on with bot response
                log.info("Skipping bot reply for %s#%d — member already commented", repo, issue_number)
                conn.execute("""
                    UPDATE jobs
                    SET discussion_state='member_handling',
                        discussion_comment_count=?,
                        discussion_last_checked_at=?,
                        updated_at=CURRENT_TIMESTAMP
                    WHERE id=?
                """, (len(comments), now_str, job_id))
                conn.commit()
                continue

            log.info("External issue %s#%d — posting initial response", repo, issue_number)
            response = generate_initial_response(repo, title, body)
            gh_post_comment(repo, issue_number, response)
            comments = gh_issue_comments(repo, issue_number)
            conn.execute("""
                UPDATE jobs
                SET discussion_state='bot_responded',
                    discussion_comment_count=?,
                    discussion_last_checked_at=?,
                    updated_at=CURRENT_TIMESTAMP
                WHERE id=?
            """, (len(comments), now_str, job_id))
            conn.commit()
            log.info("Posted initial response for %s#%d", repo, issue_number)
            continue

        # --- Step 2: Check if re-evaluation is due ---
        last_checked = row["discussion_last_checked_at"]
        if last_checked:
            last_ts = time.mktime(time.strptime(last_checked, "%Y-%m-%dT%H:%M:%S"))
            if now_ts - last_ts < DISCUSSION_REEVAL_INTERVAL:
                log.debug("Skipping re-eval for %s#%d (checked %dh ago)",
                          repo, issue_number, int((now_ts - last_ts) / 3600))
                continue

        # Fetch current comments
        comments = gh_issue_comments(repo, issue_number)
        current_count = len(comments)
        prev_count = row["discussion_comment_count"] or 0

        # If a member has now commented, hand off to them
        org = org_from_repo(repo)
        if has_human_member_comment(comments, org):
            log.info("Member took over discussion for %s#%d — bot stepping back", repo, issue_number)
            conn.execute("""
                UPDATE jobs SET discussion_state='member_handling',
                    discussion_last_checked_at=?, discussion_comment_count=?,
                    updated_at=CURRENT_TIMESTAMP WHERE id=?
            """, (now_str, current_count, job_id))
            conn.commit()
            continue

        # Skip if no new comments and not enough time has passed (double-guard)
        if current_count == prev_count and now_ts - last_ts < DISCUSSION_REEVAL_INTERVAL * 2:
            conn.execute("""
                UPDATE jobs SET discussion_last_checked_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
            """, (now_str, job_id))
            conn.commit()
            continue

        # --- Step 3: AI evaluation ---
        log.info("Evaluating discussion for external issue %s#%d (%d comments)",
                 repo, issue_number, current_count)
        result = evaluate_discussion(repo, title, body, comments)
        decision = result.get("decision", "needs_more_info")
        reason = result.get("reason", "")
        response_comment = result.get("response_comment", "")

        log.info("Discussion decision for %s#%d: %s — %s", repo, issue_number, decision, reason)

        if decision == "approve":
            if response_comment:
                gh_post_comment(repo, issue_number, response_comment)

            # Check if this repo allows code changes
            repo_mode = conn.execute(
                "SELECT labels_json FROM jobs WHERE id=?", (job_id,)
            ).fetchone()
            # Look up mode from repos.yml via a fresh load (cheap, small file)
            repos_cfg = load_repos_yml()
            repo_mode_val = next(
                (r.get("mode", "full") for r in repos_cfg if r["repo"] == repo), "full"
            )

            if repo_mode_val == "discuss_only":
                # Approved but no code changes allowed — just mark resolved
                gh_post_comment(repo, issue_number,
                    "✅ This proposal has been reviewed and approved in principle. "
                    "A team member will schedule implementation manually.")
                conn.execute("""
                    UPDATE jobs SET discussion_state='approved',
                        state='blocked', stage='discuss_only_approved',
                        discussion_last_checked_at=?, discussion_comment_count=?,
                        updated_at=CURRENT_TIMESTAMP
                    WHERE id=?
                """, (now_str, current_count, job_id))
            else:
                conn.execute("""
                    UPDATE jobs
                    SET discussion_state='approved',
                        author_is_member=1,
                        state='pending', stage='queued',
                        discussion_last_checked_at=?,
                        discussion_comment_count=?,
                        priority_reason='external contribution approved: ' || ?,
                        updated_at=CURRENT_TIMESTAMP
                    WHERE id=?
                """, (now_str, current_count, reason[:100], job_id))
            conn.commit()
            log.info("External issue %s#%d APPROVED (mode=%s)", repo, issue_number, repo_mode_val)

        elif decision == "reject":
            close_comment = response_comment or (
                f"Thank you for your contribution. After review, we've decided not to proceed "
                f"with this proposal at this time: {reason}\n\nFeel free to open a new issue "
                f"if you have a different proposal."
            )
            gh_close_issue(repo, issue_number, close_comment)
            conn.execute("""
                UPDATE jobs
                SET discussion_state='rejected',
                    state='blocked', stage='discussion_rejected',
                    discussion_last_checked_at=?,
                    discussion_comment_count=?,
                    last_error=?,
                    updated_at=CURRENT_TIMESTAMP
                WHERE id=?
            """, (now_str, current_count, reason[:500], job_id))
            conn.commit()
            log.info("External issue %s#%d REJECTED — closed", repo, issue_number)

        else:  # needs_more_info
            if response_comment and current_count > prev_count:
                gh_post_comment(repo, issue_number, response_comment)
            conn.execute("""
                UPDATE jobs
                SET discussion_state='bot_responded',
                    discussion_last_checked_at=?,
                    discussion_comment_count=?,
                    updated_at=CURRENT_TIMESTAMP
                WHERE id=?
            """, (now_str, current_count, job_id))
            conn.commit()
            log.info("External issue %s#%d needs more info — waiting", repo, issue_number)


# ---------------------------------------------------------------------------
# Job upsert
# ---------------------------------------------------------------------------

def upsert_job(conn: sqlite3.Connection, repo: str, issue: dict,
               repo_cfg: dict, author_login: str, author_is_member: bool) -> int | None:
    """Returns job_id if newly inserted, None if updated/skipped."""
    number = issue["number"]
    title = issue["title"]
    body = issue.get("body") or ""
    labels = {lbl["name"] for lbl in issue.get("labels", [])}
    base_branch = repo_cfg.get("base_branch", "main")
    repo_mode = repo_cfg.get("mode", "full")  # full | discuss_only

    model_tier, review_tier, automerge = determine_tiers(labels, repo_cfg)
    model_alias, effective_model = model_for_tier(model_tier)
    max_retries = 7 if model_tier == "hard" else 5
    max_ci_retries = 4 if model_tier == "hard" else 3
    max_review_retries = 3 if model_tier == "hard" else 2

    is_critical = "priority:critical" in labels
    initial_priority = 1 if is_critical else 100

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
        conn.commit()
        return None

    # discuss_only repos: always go to discussion regardless of membership
    if repo_mode == "discuss_only":
        initial_state = "discussion"
        initial_stage = "awaiting_discussion"
        effective_is_member = False  # force discussion path
        log.info("Queued [discuss_only] %s#%d: %r", repo, number, title[:60])
    elif author_is_member:
        initial_state = "pending"
        initial_stage = "queued"
        effective_is_member = True
        log.info("Enqueued [member] %s#%d [%s] %r", repo, number, model_tier, title[:60])
    else:
        initial_state = "discussion"
        initial_stage = "awaiting_discussion"
        effective_is_member = False
        log.info("Queued [external @%s] %s#%d for discussion: %r", author_login, repo, number, title[:60])

    cursor = conn.execute("""
        INSERT INTO jobs (
          repo, issue_number, title, body, labels_json,
          author_login, author_is_member, discussion_state,
          base_branch, state, stage, priority,
          model_tier, review_tier, automerge,
          model_alias, effective_model, provider,
          max_retries, max_ci_retries, max_review_retries
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (
        repo, number, title, body, json.dumps(sorted(labels)),
        author_login, int(effective_is_member), None,
        base_branch, initial_state, initial_stage, initial_priority,
        model_tier, review_tier, int(automerge),
        model_alias, effective_model, "zai-glm",
        max_retries, max_ci_retries, max_review_retries,
    ))
    conn.commit()
    return cursor.lastrowid


# ---------------------------------------------------------------------------
# Lease recovery
# ---------------------------------------------------------------------------

def recover_expired_leases(conn: sqlite3.Connection):
    rows = conn.execute("""
        SELECT id, repo, issue_number, lease_owner FROM jobs
        WHERE state='running' AND lease_expires_at < datetime('now')
    """).fetchall()
    for row in rows:
        log.warning("Recovering expired lease: job %d (%s#%s, worker %s)",
                    row["id"], row["repo"], row["issue_number"], row["lease_owner"])
        conn.execute("""
            UPDATE jobs SET state='pending', stage='lease_recovered',
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
        "Scheduler started. DB=%s repos=%s poll=%ss ai_scoring=%s",
        DB_PATH, REPOS_CONFIG_PATH, POLL_INTERVAL,
        "enabled" if ANTHROPIC_AUTH_TOKEN else "disabled",
    )

    while True:
        try:
            recover_expired_leases(conn)

            repos = load_repos_yml()
            new_member_jobs: list[dict] = []
            new_external_ids: set[int] = set()

            for repo_cfg in repos:
                repo = repo_cfg["repo"]
                org = org_from_repo(repo)
                label = repo_cfg.get("enqueue_label", "claude")
                try:
                    issues = gh_issue_list(repo, label)
                    log.info("Repo %s: %d open issue(s) with label '%s'", repo, len(issues), label)
                    for issue in issues:
                        author_login = (issue.get("author") or {}).get("login", "")
                        author_is_member = is_org_member(org, author_login) if author_login else True

                        job_id = upsert_job(conn, repo, issue, repo_cfg, author_login, author_is_member)

                        if job_id is not None:
                            labels = [lbl["name"] for lbl in issue.get("labels", [])]
                            label_set = set(labels)
                            model_tier, _, _ = determine_tiers(label_set, repo_cfg)
                            if author_is_member:
                                new_member_jobs.append({
                                    "job_id": job_id, "repo": repo,
                                    "issue_number": issue["number"],
                                    "title": issue["title"],
                                    "body": issue.get("body") or "",
                                    "labels": labels, "model_tier": model_tier,
                                })
                            else:
                                new_external_ids.add(job_id)
                except Exception:
                    log.exception("Error processing repo %s", repo)

            # Batch-score new member jobs (includes dependency analysis)
            if new_member_jobs:
                log.info("Scoring %d new member job(s) with dependency analysis...", len(new_member_jobs))
                assign_priorities(conn, new_member_jobs)
            else:
                # Re-analyze existing pending jobs that lack dependency data
                reanalyze_existing_deps(conn)

            # Advance external discussion state machines
            process_external_discussions(conn, new_external_ids)

            # Log execution queue with dependency info
            queue = conn.execute("""
                SELECT repo, issue_number, priority, priority_reason, title, depends_on_jobs
                FROM jobs
                WHERE state IN ('pending','fixing','remote_ci_failed','review_failed')
                ORDER BY priority ASC, created_at ASC LIMIT 10
            """).fetchall()
            if queue:
                log.info("Execution queue (%d job(s)):", len(queue))
                for i, row in enumerate(queue, 1):
                    deps = json.loads(row["depends_on_jobs"] or "[]")
                    dep_str = f" [blocks={deps}]" if deps else ""
                    log.info("  %d. [p=%d] %s#%d%s %r — %s",
                             i, row["priority"], row["repo"], row["issue_number"],
                             dep_str, row["title"][:40], row["priority_reason"])

            # Log pending external discussions
            ext = conn.execute("""
                SELECT repo, issue_number, title, discussion_state, author_login
                FROM jobs WHERE author_is_member=0
                  AND discussion_state NOT IN ('approved','rejected')
                  AND state NOT IN ('merged','blocked','max_retry_exceeded')
            """).fetchall()
            if ext:
                log.info("External discussions open (%d):", len(ext))
                for row in ext:
                    log.info("  @%s %s#%d [%s] %r",
                             row["author_login"], row["repo"], row["issue_number"],
                             row["discussion_state"], row["title"][:45])

        except Exception:
            log.exception("Scheduler loop error")

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    scheduler_loop()
