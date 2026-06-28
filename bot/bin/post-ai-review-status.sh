#!/usr/bin/env bash
# post-ai-review-status.sh — post a GitHub commit status for ai-review.
# Usage: POST_STATE=success|failure PR_NUMBER=42 REPO=owner/repo HEAD_SHA=abc ./post-ai-review-status.sh
set -euo pipefail

STATE="${POST_STATE:-success}"
REPO="${REPO:?REPO required}"
HEAD_SHA="${HEAD_SHA:?HEAD_SHA required}"
PR_URL="${PR_URL:-}"

if [ -z "$GH_TOKEN" ]; then
    echo "GH_TOKEN not set" >&2
    exit 1
fi

if [ "$STATE" = "success" ]; then
    DESCRIPTION="AI reviewer approved"
else
    DESCRIPTION="AI reviewer found blocking issues"
fi

gh api \
    --method POST \
    -H "Accept: application/vnd.github+json" \
    "/repos/${REPO}/statuses/${HEAD_SHA}" \
    -f "state=${STATE}" \
    -f "context=ai-review" \
    -f "description=${DESCRIPTION}" \
    -f "target_url=${PR_URL}"

echo "Posted ai-review status=${STATE} for ${HEAD_SHA}"
