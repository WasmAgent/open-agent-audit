#!/usr/bin/env bash
# bash-guard.sh — PreToolUse hook that blocks dangerous Bash commands.
# Exit 2 = block. Exit 0 = allow.
set -euo pipefail

INPUT="$(cat)"
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // .tool_input.cmd // ""' 2>/dev/null || true)"

if [ -z "$CMD" ]; then
    echo "Blocked: empty Bash command" >&2
    exit 2
fi

# Normalize to single line for matching
CMD_ONE_LINE="$(printf '%s' "$CMD" | tr '\n' ' ')"

# ----- Block patterns -----
BLOCK_PATTERNS=(
    '(^|[;&|[:space:]])git[[:space:]]+(push|commit|tag|reset|clean|checkout|switch|branch|merge|rebase|worktree)([[:space:]]|$)'
    '(^|[;&|[:space:]])gh([[:space:]]|$)'
    '(^|[;&|[:space:]])curl([[:space:]]|$)'
    '(^|[;&|[:space:]])wget([[:space:]]|$)'
    '(^|[;&|[:space:]])ssh([[:space:]]|$)'
    '(^|[;&|[:space:]])scp([[:space:]]|$)'
    '(^|[;&|[:space:]])rsync([[:space:]]|$)'
    '(^|[;&|[:space:]])nc([[:space:]]|$)'
    '(^|[;&|[:space:]])telnet([[:space:]]|$)'
    '(^|[;&|[:space:]])rm[[:space:]]+-rf[[:space:]]+(/|\*|\.|\.\.)'
    '(^|[;&|[:space:]])(env|printenv)([[:space:]]|$)'
    '/proc/self/environ'
    '(^|[;&|[:space:]])find[[:space:]].*(-delete|-exec)'
    '(^|[;&|[:space:]])npx[[:space:]].*--yes'
    'npm[[:space:]]+publish'
    'bun[[:space:]]+publish'
    'pnpm[[:space:]]+publish'
    'yarn[[:space:]]+publish'
    '/dev/tcp/'
    'ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|GITHUB_TOKEN|GH_TOKEN|NPM_TOKEN|ZAI|SECRET|PASSWORD|PRIVATE_KEY|ACCESS_KEY'
    '(^|[[:space:]])(~/.ssh|\.env|\.npmrc|\.pypirc|credentials|id_rsa|id_ed25519)([[:space:]]|$)'
)

for pat in "${BLOCK_PATTERNS[@]}"; do
    if printf '%s' "$CMD_ONE_LINE" | grep -Eiq "$pat"; then
        echo "Blocked unsafe Bash command: $CMD" >&2
        exit 2
    fi
done

# ----- Allow patterns -----
ALLOW_PATTERNS=(
    '^(npm|pnpm|yarn|bun)[[:space:]]+(test|run[[:space:]]+(test|lint|build|typecheck|check|verify[^ ]*)|exec[[:space:]])'
    '^node[[:space:]]+'
    '^python3?[[:space:]]+'
    '^pytest([[:space:]]|$)'
    '^cargo[[:space:]]+(test|check|build|fmt|clippy)([[:space:]]|$)'
    '^go[[:space:]]+(test|vet|build)([[:space:]]|$)'
    '^rg[[:space:]]+'
    '^grep[[:space:]]+'
    '^ls([[:space:]]|$)'
    '^find[[:space:]]+'
    '^cat[[:space:]]+'
    '^sed[[:space:]]+'
    '^awk[[:space:]]+'
    '^head([[:space:]]|$)'
    '^tail([[:space:]]|$)'
    '^wc([[:space:]]|$)'
    '^sort([[:space:]]|$)'
    '^uniq([[:space:]]|$)'
    '^jq[[:space:]]+'
    '^echo[[:space:]]+'
    '^printf[[:space:]]+'
    '^mkdir[[:space:]]+'
    '^cp[[:space:]]+'
    '^mv[[:space:]]+'
    '^diff[[:space:]]+'
    '^git[[:space:]]+(status|log|diff|show|ls-files|rev-parse)([[:space:]]|$)'
    '^npx[[:space:]]+(tsc|eslint|prettier|biome)[[:space:]]+'
)

for pat in "${ALLOW_PATTERNS[@]}"; do
    if printf '%s' "$CMD_ONE_LINE" | grep -Eq "$pat"; then
        exit 0
    fi
done

echo "Blocked by default (not allowlisted): $CMD" >&2
exit 2
