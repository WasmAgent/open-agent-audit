#!/usr/bin/env python3
"""
Claude Bot Scheduler — polls GitHub for labeled issues and enqueues jobs.
Reads monitored repos from /srv/claude-bot/repos.yml (or REPOS_CONFIG_PATH).
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

CREATE INDEX IF NOT EXISTS idx_jobs_issue   ON jobs(repo, issue_number);
CREATE INDEX IF NOT EXISTS idx_jobs_claim   ON jobs(state, priority, created_at, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_jobs_lease   ON jobs(state, lease_expires_at);
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


def open_db() -> sqlite3.Connection:
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    conn.commit()
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
    """Returns (model_tier, review_tier, automerge)."""
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
    """Returns (model_alias, effective_model)."""
    if model_tier == "hard":
        return "opus", "glm-5.2[1m]"
    if model_tier == "docs":
        return "haiku", "glm-4.7"
    return "sonnet", "glm-4.7"


# ---------------------------------------------------------------------------
# Job upsert
# ---------------------------------------------------------------------------

def upsert_job(conn: sqlite3.Connection, repo: str, issue: dict, repo_cfg: dict):
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
        "SELECT id, state FROM jobs WHERE repo=? AND issue_number=?",
        (repo, number),
    ).fetchone()

    if existing:
        if existing["state"] in ("merged", "max_retry_exceeded", "provider_blocked", "blocked"):
            log.debug("Skipping issue #%d in terminal state %s", number, existing["state"])
            return
        # Update labels/tier in case they changed, but don't reset state.
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
    else:
        conn.execute("""
            INSERT INTO jobs (
              repo, issue_number, title, body, labels_json,
              base_branch, state, stage, priority,
              model_tier, review_tier, automerge,
              model_alias, effective_model, provider,
              max_retries, max_ci_retries, max_review_retries
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            repo, number, title, body, json.dumps(sorted(labels)),
            base_branch, "pending", "queued", 100,
            model_tier, review_tier, int(automerge),
            model_alias, effective_model, "zai-glm",
            max_retries, max_ci_retries, max_review_retries,
        ))
        log.info("Enqueued new job: %s#%d [%s] %r", repo, number, model_tier, title[:60])

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
    log.info("Scheduler started. DB=%s, repos=%s, poll=%ss", DB_PATH, REPOS_CONFIG_PATH, POLL_INTERVAL)

    while True:
        try:
            recover_expired_leases(conn)

            repos = load_repos_yml()
            if not repos:
                log.warning("No enabled repositories in repos.yml")
            else:
                for repo_cfg in repos:
                    repo = repo_cfg["repo"]
                    label = repo_cfg.get("enqueue_label", "claude")
                    try:
                        issues = gh_issue_list(repo, label)
                        log.info("Repo %s: found %d open issue(s) with label '%s'", repo, len(issues), label)
                        for issue in issues:
                            upsert_job(conn, repo, issue, repo_cfg)
                    except Exception:
                        log.exception("Error processing repo %s", repo)

        except Exception:
            log.exception("Scheduler loop error")

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    scheduler_loop()
