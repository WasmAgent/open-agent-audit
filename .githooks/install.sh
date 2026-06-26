#!/usr/bin/env bash
# Install the project pre-push hook into .git/hooks.
# Re-run after `git clone`.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
SRC="$ROOT/.githooks/pre-push"
DST="$ROOT/.git/hooks/pre-push"

if [[ ! -f "$SRC" ]]; then
  echo "expected hook at $SRC" >&2
  exit 1
fi

cp "$SRC" "$DST"
chmod +x "$DST"
echo "installed $DST"
