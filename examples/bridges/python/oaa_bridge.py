#!/usr/bin/env python3
"""
OpenAgentAudit Python bridge.

Thin wrapper that invokes the Node.js bridge via subprocess.
Use this pattern when your agent runtime is Python but you want to
leverage the full TypeScript audit engine without porting it.

Exit codes mirror the Node bridge:
  0 — success (analysis JSON printed to stdout)
  2 — bad input
  3 — adapter error
  4 — engine error
  5 — bridge invocation error (node not found, bridge missing, etc.)

Usage:
  echo '{"schema_version":"aep/v0.2",...}' | python oaa_bridge.py
  cat records.jsonl | python oaa_bridge.py --manifest '{"declared_capabilities":["fs.read"]}'
"""

import json
import subprocess
import sys
from pathlib import Path

# Resolve the Node.js bridge relative to this file
BRIDGE_PATH = Path(__file__).resolve().parent.parent / "node-stdin-jsonl" / "bridge.mjs"


def main() -> int:
    # Pass through --manifest if provided
    extra_args: list[str] = []
    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--manifest" and i + 1 < len(args):
            extra_args.extend(["--manifest", args[i + 1]])
            i += 2
        else:
            i += 1

    if not BRIDGE_PATH.exists():
        print(f"Error: Node bridge not found at {BRIDGE_PATH}", file=sys.stderr)
        return 5

    # Read stdin and pipe to node bridge
    stdin_data = sys.stdin.buffer.read()
    if not stdin_data.strip():
        print("Error: empty input", file=sys.stderr)
        return 2

    try:
        result = subprocess.run(
            ["node", str(BRIDGE_PATH)] + extra_args,
            input=stdin_data,
            capture_output=True,
            timeout=60,
        )
    except FileNotFoundError:
        print("Error: 'node' not found in PATH", file=sys.stderr)
        return 5
    except subprocess.TimeoutExpired:
        print("Error: bridge timed out after 60s", file=sys.stderr)
        return 4

    # Forward stderr from the node bridge
    if result.stderr:
        sys.stderr.buffer.write(result.stderr)

    # Forward stdout (the analysis JSON)
    if result.stdout:
        sys.stdout.buffer.write(result.stdout)

    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
