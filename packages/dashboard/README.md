# @openagentaudit/dashboard

React + TypeScript + Tailwind CSS SPA for OpenAgentAudit.

Deployed via **Cloudflare Workers Static Assets** — no Cloudflare Pages project needed.

**Status:** implemented — MVP with JSONL upload and event visualization.

## Features

- Drag-and-drop or click-to-select `.jsonl` trace file upload
- Summary cards: total events, run ID, agent ID, model ID
- Event type breakdown (color-coded pills)
- Paginated events table (50 rows/page): event_id, type, actor, timestamp, details
- Color-coding: tool_call=blue, policy_decision=yellow, human_approval=green, error=red
- Footer disclaimer

## Development

```bash
cd packages/dashboard
npm install
npm run dev        # Vite dev server at localhost:5173
npm run build      # Produces dist/ for deployment
```

## Deployment

The built `dist/` is served by the Cloudflare Worker via the `assets` binding
in `wrangler.jsonc`. The worker handles `/api/*` routes; all other requests
fall through to the SPA's `index.html`.

See [`examples/cloudflare/README.md`](../../examples/cloudflare/README.md) for
the full deploy checklist.

## Stack

- React 18 + TypeScript
- Tailwind CSS 3 + PostCSS
- Vite 5
- No external UI component library
