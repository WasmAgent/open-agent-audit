#!/usr/bin/env bash
# watchdog.sh — monitors claude-bot services and auto-recovers on failure.
# Runs every 5 minutes via systemd timer.
# Posts a GitHub issue if a service stays down after recovery attempts.
set -euo pipefail

SERVICES=("claude-scheduler" "claude-worker@1")
DB_PATH="${DB_PATH:-/srv/claude-bot/db.sqlite3}"
GH_TOKEN="${GH_TOKEN:-}"
ALERT_REPO="${ALERT_REPO:-WasmAgent/open-agent-audit}"
MAX_RESTART_ATTEMPTS=3
WATCHDOG_STATE_DIR="/srv/claude-bot/watchdog"
mkdir -p "$WATCHDOG_STATE_DIR"

alert_github() {
    local service="$1" reason="$2"
    [ -z "$GH_TOKEN" ] && return
    local state_file="$WATCHDOG_STATE_DIR/${service//\//_}.alerted"
    # Only alert once per hour
    if [ -f "$state_file" ]; then
        local age=$(( $(date +%s) - $(stat -c %Y "$state_file" 2>/dev/null || echo 0) ))
        [ "$age" -lt 3600 ] && return
    fi
    local body="## Service failure: \`$service\`

**Time:** $(date -u '+%Y-%m-%d %H:%M:%S UTC')
**Reason:** $reason

The watchdog attempted automatic recovery but the service did not come back up.

**Manual steps:**
\`\`\`bash
ssh vps-bigmen
systemctl status $service
journalctl -u $service -n 50
systemctl restart $service
\`\`\`"
    GH_TOKEN="$GH_TOKEN" gh issue create \
        --repo "$ALERT_REPO" \
        --title "watchdog: $service is down" \
        --label "bug" \
        --body "$body" 2>/dev/null || true
    touch "$state_file"
    echo "$(date -u) ALERT posted for $service" >> "$WATCHDOG_STATE_DIR/watchdog.log"
}

resolve_github_alert() {
    local service="$1"
    local state_file="$WATCHDOG_STATE_DIR/${service//\//_}.alerted"
    [ -f "$state_file" ] && rm -f "$state_file"
}

check_db_health() {
    # Detect stuck running jobs (lease expired but still running in DB)
    local stuck
    stuck=$(sqlite3 "$DB_PATH" \
        "SELECT COUNT(*) FROM jobs WHERE state='running' AND lease_expires_at < datetime('now','-10 minutes');" \
        2>/dev/null || echo 0)
    if [ "$stuck" -gt 0 ]; then
        echo "$(date -u) WARNING: $stuck stuck job(s) with expired leases" >> "$WATCHDOG_STATE_DIR/watchdog.log"
        sqlite3 "$DB_PATH" \
            "UPDATE jobs SET state='pending', stage='watchdog_recovered',
             lease_owner=NULL, lease_expires_at=NULL, updated_at=CURRENT_TIMESTAMP
             WHERE state='running' AND lease_expires_at < datetime('now','-10 minutes');" \
            2>/dev/null || true
        echo "$(date -u) Recovered $stuck stuck job(s)" >> "$WATCHDOG_STATE_DIR/watchdog.log"
    fi

    # Detect orphaned running jobs: job is 'running' but worker process is gone
    # This catches the SIGTERM-mid-job scenario where lease hasn't expired yet
    local running_jobs
    running_jobs=$(sqlite3 "$DB_PATH" \
        "SELECT COUNT(*) FROM jobs WHERE state='running';" \
        2>/dev/null || echo 0)
    if [ "$running_jobs" -gt 0 ]; then
        local worker_alive=0
        if pgrep -f "worker\.py" > /dev/null 2>&1; then
            worker_alive=1
        fi
        if [ "$worker_alive" -eq 0 ]; then
            echo "$(date -u) WARNING: $running_jobs running job(s) but no worker process — releasing leases" \
                >> "$WATCHDOG_STATE_DIR/watchdog.log"
            sqlite3 "$DB_PATH" \
                "UPDATE jobs SET state='pending', stage='orphan_recovered',
                 lease_owner=NULL, lease_expires_at=NULL, updated_at=CURRENT_TIMESTAMP
                 WHERE state='running';" \
                2>/dev/null || true
            echo "$(date -u) Released $running_jobs orphaned job(s)" >> "$WATCHDOG_STATE_DIR/watchdog.log"
        fi
    fi
}

for service in "${SERVICES[@]}"; do
    state=$(systemctl is-active "$service" 2>/dev/null || echo "unknown")
    if [ "$state" = "active" ]; then
        resolve_github_alert "$service"
        continue
    fi

    echo "$(date -u) WARNING: $service is $state — attempting restart" >> "$WATCHDOG_STATE_DIR/watchdog.log"

    restart_count_file="$WATCHDOG_STATE_DIR/${service//\//_}.restarts"
    count=0
    if [ -f "$restart_count_file" ]; then
        # Reset counter if file is older than 1 hour
        age=$(( $(date +%s) - $(stat -c %Y "$restart_count_file" 2>/dev/null || echo 0) ))
        if [ "$age" -lt 3600 ]; then
            count=$(cat "$restart_count_file" 2>/dev/null || echo 0)
        else
            count=0
        fi
    fi

    if [ "$count" -lt "$MAX_RESTART_ATTEMPTS" ]; then
        systemctl restart "$service" 2>/dev/null || true
        sleep 5
        new_state=$(systemctl is-active "$service" 2>/dev/null || echo "unknown")
        echo $((count + 1)) > "$restart_count_file"
        if [ "$new_state" = "active" ]; then
            echo "$(date -u) $service recovered after restart ($((count+1)))" >> "$WATCHDOG_STATE_DIR/watchdog.log"
            resolve_github_alert "$service"
        else
            echo "$(date -u) $service still down after restart attempt $((count+1))" >> "$WATCHDOG_STATE_DIR/watchdog.log"
        fi
    else
        echo "$(date -u) $service exceeded restart attempts — alerting" >> "$WATCHDOG_STATE_DIR/watchdog.log"
        alert_github "$service" "Service failed $MAX_RESTART_ATTEMPTS restart attempts. State: $state. Check \`journalctl -u $service -n 50\`."
    fi
done

# DB health check
check_db_health

# Daily token report (only once per day)
REPORT_FLAG="$WATCHDOG_STATE_DIR/token-report-$(date +%Y-%m-%d).done"
if [ ! -f "$REPORT_FLAG" ]; then
    if command -v sqlite3 &>/dev/null && [ -f "$DB_PATH" ]; then
        TOKEN_REPORT=$(sqlite3 "$DB_PATH" "
SELECT
  'Today: merged=' || (SELECT COUNT(*) FROM jobs WHERE state='merged' AND DATE(finished_at)=DATE('now')) ||
  ' tokens_in=' || COALESCE((SELECT SUM(token_input) FROM jobs WHERE DATE(finished_at)=DATE('now')),0) ||
  ' tokens_out=' || COALESCE((SELECT SUM(token_output) FROM jobs WHERE DATE(finished_at)=DATE('now')),0) ||
  ' | Total: merged=' || (SELECT COUNT(*) FROM jobs WHERE state='merged') ||
  ' failed=' || (SELECT COUNT(*) FROM jobs WHERE state='max_retry_exceeded') ||
  ' pending=' || (SELECT COUNT(*) FROM jobs WHERE state IN ('pending','fixing'))
;" 2>/dev/null || echo "")
        if [ -n "$TOKEN_REPORT" ]; then
            echo "$(date -u) DAILY REPORT: $TOKEN_REPORT" >> "$WATCHDOG_STATE_DIR/watchdog.log"
        fi
    fi
    touch "$REPORT_FLAG"
    # Clean old report flags (keep 7 days)
    find "$WATCHDOG_STATE_DIR" -name "token-report-*.done" -mtime +7 -delete 2>/dev/null || true
fi

# Rotate log (keep last 500 lines)
if [ -f "$WATCHDOG_STATE_DIR/watchdog.log" ]; then
    tail -500 "$WATCHDOG_STATE_DIR/watchdog.log" > "$WATCHDOG_STATE_DIR/watchdog.log.tmp" \
        && mv "$WATCHDOG_STATE_DIR/watchdog.log.tmp" "$WATCHDOG_STATE_DIR/watchdog.log"
fi
