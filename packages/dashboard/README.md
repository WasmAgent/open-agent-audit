# @openagentaudit/dashboard

React SPA for OpenAgentAudit, deployed at [trustavo.com](https://trustavo.com).

Served via **Cloudflare Workers Static Assets** — no separate Cloudflare Pages project needed.

**Status:** implemented — full routing, AEP support, compliance mapping.

## Features

### Routing

Client-side routing powered by **wouter 3**:

| Route | Description |
|---|---|
| `/` | Home — file upload and example loader |
| `/audit` | Trace view — event breakdown and paginated events table |
| `/runs/:runId` | Report view — audit report for a specific run |

Breadcrumb navigation is present on all non-home routes.

### File upload

- Drag-and-drop or click-to-select upload accepting `.jsonl` or `.json` AEP files
- AEP auto-detection: when an AEP trace is recognized, metadata cards are shown (`run_id`, model, action count, schema version)
- JSONL mode: event type breakdown (color-coded pills) and a paginated events table (50 rows/page) with `event_id`, type, actor, timestamp, and details columns

### Example loading

One-click loading of bundled AEP samples fetched from raw GitHub:

- **wasmagent-js** sample trace
- **bscode** rollout sample trace

No file selection required — examples load instantly in the browser.

### Audit report

After a trace is processed:

- **Post-report summary card**: EAS score, letter grade, event count, finding count
- **"Audit Report Ready" download card** with four export formats:
  - Full Report (HTML)
  - CSV
  - JSON
  - Markdown
- EU AI Act Art. 26(6) retention notice included in all generated reports

### Compliance mapping

Findings are mapped to the following frameworks displayed in the report:

- OWASP LLM Top 10
- EU AI Act
- NIST AI RMF
- ISO 42001

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
- wouter 3 (client-side routing)
- No external UI component library
