#!/usr/bin/env bash
# deploy.sh — copy bot files to VPS and install systemd services.
# Usage: VPS=root@141.98.198.106 ./bot/deploy.sh
set -euo pipefail

VPS="${VPS:?Set VPS=user@host}"
SSH_KEY="${SSH_KEY:-~/.ssh/vps-greencloud-jp-bigmem.key}"
BOT_SRC="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$BOT_SRC/.." && pwd)"

SSH="ssh -i $SSH_KEY -o StrictHostKeyChecking=accept-new"
SCP="scp -i $SSH_KEY"

echo "==> Deploying to $VPS"

# 1. Create directories on VPS
$SSH "$VPS" bash <<'REMOTE'
set -e
useradd -m -s /bin/bash claudebot 2>/dev/null || true
mkdir -p /srv/claude-bot/{repos,worktrees,bin,logs}
mkdir -p /etc/claude-bot
chown -R claudebot:claudebot /srv/claude-bot
chmod 750 /srv/claude-bot
REMOTE

# 2. Copy Python scripts
$SCP "$BOT_SRC/scheduler.py" "$VPS:/srv/claude-bot/scheduler.py"
$SCP "$BOT_SRC/worker.py"    "$VPS:/srv/claude-bot/worker.py"

# 3. Copy shell scripts and make executable
$SCP "$BOT_SRC/bin/bash-guard.sh"           "$VPS:/srv/claude-bot/bin/bash-guard.sh"
$SCP "$BOT_SRC/bin/post-ai-review-status.sh" "$VPS:/srv/claude-bot/bin/post-ai-review-status.sh"
$SSH "$VPS" chmod +x /srv/claude-bot/bin/bash-guard.sh /srv/claude-bot/bin/post-ai-review-status.sh

# 4. Copy config files
$SCP "$BOT_SRC/repos.yml"      "$VPS:/srv/claude-bot/repos.yml"
$SCP "$BOT_SRC/empty-mcp.json" "$VPS:/srv/claude-bot/empty-mcp.json"

# 5. Copy env template (only if target doesn't exist yet)
$SSH "$VPS" bash <<'REMOTE'
if [ ! -f /etc/claude-bot/claude-bot.env ]; then
    echo "NOTE: /etc/claude-bot/claude-bot.env not found — please copy claude-bot.env.example and fill in tokens"
fi
REMOTE
$SCP "$BOT_SRC/claude-bot.env.example" "$VPS:/etc/claude-bot/claude-bot.env.example"

# 6. Copy .claude/ project files to each registered repo checkout
# (The bare repos don't have working trees, so .claude/ goes into a separate
#  "config overlay" path that the worker injects via --config when it creates worktrees.
#  For now we just upload them to /srv/claude-bot/claude-overlay/ for reference.)
$SSH "$VPS" mkdir -p /srv/claude-bot/claude-overlay/agents
for f in implementer.md reviewer.md deep-reviewer.md; do
    $SCP "$REPO_ROOT/.claude/agents/$f" "$VPS:/srv/claude-bot/claude-overlay/agents/$f"
done
$SCP "$REPO_ROOT/.claude/settings.json" "$VPS:/srv/claude-bot/claude-overlay/settings.json"

# 7. Install systemd units
$SCP "$BOT_SRC/systemd/claude-scheduler.service"  "$VPS:/etc/systemd/system/claude-scheduler.service"
$SCP "$BOT_SRC/systemd/claude-worker@.service"     "$VPS:/etc/systemd/system/claude-worker@.service"

# 8. Install Python deps
$SSH "$VPS" bash <<'REMOTE'
set -e
apt-get install -y python3-yaml 2>/dev/null || pip3 install pyyaml
REMOTE

# 9. Reload systemd (don't start yet — user must fill in tokens first)
$SSH "$VPS" systemctl daemon-reload

echo ""
echo "==> Deploy complete."
echo ""
echo "Next steps on the VPS:"
echo "  1. Fill in /etc/claude-bot/claude-bot.env (GH_TOKEN, etc.)"
echo "  2. Set up /home/claudebot/.claude/settings.json with Z.AI API key"
echo "  3. Clone bare repos:"
echo "       sudo -u claudebot git clone --bare git@github.com:WasmAgent/open-agent-audit.git \\"
echo "         /srv/claude-bot/repos/open-agent-audit.git"
echo "  4. Install Claude Code:"
echo "       curl -fsSL https://claude.ai/install.sh | bash"
echo "  5. Start services:"
echo "       systemctl enable --now claude-scheduler claude-worker@1"
echo "  6. Watch logs:"
echo "       journalctl -fu claude-scheduler"
echo "       journalctl -fu claude-worker@1"
