#!/usr/bin/env bash
# bash-guard.sh — PreToolUse hook: blocks only operations that must never run.
# Everything else is allowed — Claude Code needs broad access to do real development.
# Exit 2 = block. Exit 0 = allow.
set -euo pipefail

INPUT="$(cat)"
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // .tool_input.cmd // ""' 2>/dev/null || true)"

if [ -z "$CMD" ]; then
    echo "Blocked: empty Bash command" >&2
    exit 2
fi

CMD_ONE_LINE="$(printf '%s' "$CMD" | tr '\n' ' ')"

# Hard blocks — operations that must NEVER run in any context
BLOCK_PATTERNS=(
    '(^|[;&|[:space:]])git[[:space:]]+(push|commit|tag|worktree)([[:space:]]|$)'
    '(^|[;&|[:space:]])git[[:space:]]+reset[[:space:]]+--hard'
    '(^|[;&|[:space:]])git[[:space:]]+clean[[:space:]]+-fd'
    '(^|[;&|[:space:]])gh[[:space:]]+pr[[:space:]]+merge'
    '(^|[;&|[:space:]])gh[[:space:]]+repo[[:space:]]+delete'
    '(^|[;&|[:space:]])gh[[:space:]]+secret'
    '(npm|bun|pnpm|yarn)[[:space:]]+publish'
    '(^|[;&|[:space:]])(ssh|scp|rsync|nc|netcat|telnet)([[:space:]]|$)'
    'rm[[:space:]]+-rf[[:space:]]+-'
    'ANTHROPIC_AUTH_TOKEN|GITHUB_TOKEN|GH_TOKEN|NPM_TOKEN|PRIVATE_KEY'
    '/dev/tcp/'
)

for pat in "${BLOCK_PATTERNS[@]}"; do
    if printf '%s' "$CMD_ONE_LINE" | grep -Eiq "$pat"; then
        echo "Blocked unsafe command: $CMD" >&2
        exit 2
    fi
done

# Everything else is allowed
exit 0
