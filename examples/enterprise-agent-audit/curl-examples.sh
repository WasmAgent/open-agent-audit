#!/bin/sh
# Submit a trace to the OpenAgentAudit API
#
# Usage:
#   OAA_BASE_URL=https://trustavo.com sh curl-examples.sh
#
# Environment variables:
#   OAA_BASE_URL  Base URL of the OpenAgentAudit deployment (default: https://trustavo.com)
#   OAA_API_KEY   Bearer token — leave unset for demo/unauthenticated mode

BASE_URL="${OAA_BASE_URL:-https://trustavo.com}"
API_KEY="${OAA_API_KEY:-}"

# ---------------------------------------------------------------------------
# Submit JSONL trace (no auth required in demo mode)
# ---------------------------------------------------------------------------
curl -X POST "${BASE_URL}/api/v1/runs" \
  -H "Content-Type: application/x-ndjson" \
  -H "x-source-file: golden-trace.jsonl" \
  --data-binary @examples/traces/golden-trace.jsonl

# ---------------------------------------------------------------------------
# Submit with auth (when OAA_API_KEY is configured)
# ---------------------------------------------------------------------------
# curl -X POST "${BASE_URL}/api/v1/runs" \
#   -H "Authorization: Bearer ${API_KEY}" \
#   -H "Content-Type: application/x-ndjson" \
#   -H "x-source-file: golden-trace.jsonl" \
#   --data-binary @examples/traces/golden-trace.jsonl

# ---------------------------------------------------------------------------
# Submit with a capability manifest (enables OAA-R-CAP-001 checks)
# ---------------------------------------------------------------------------
# curl -X POST "${BASE_URL}/api/v1/runs" \
#   -H "Content-Type: application/x-ndjson" \
#   -H "x-source-file: golden-trace.jsonl" \
#   -H "x-manifest: $(cat examples/enterprise-agent-audit/sample-manifest.json | base64)" \
#   --data-binary @examples/traces/golden-trace.jsonl

# ---------------------------------------------------------------------------
# List all runs
# ---------------------------------------------------------------------------
# curl "${BASE_URL}/api/v1/runs"

# ---------------------------------------------------------------------------
# Fetch a specific run report as JSON
# ---------------------------------------------------------------------------
# curl "${BASE_URL}/api/v1/runs/golden-run-001/report"
