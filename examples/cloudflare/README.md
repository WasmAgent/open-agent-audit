# Cloudflare Reference Configuration

This directory contains reference Cloudflare deployment artifacts.

| File | Purpose |
|---|---|
| `wrangler.example.jsonc` | Wrangler config with all bindings + Static Assets; uses placeholder IDs. |
| `d1-schema.sql` | Initial D1 schema (DDL only). |

## Using these files

These files are **reference artifacts**. They contain placeholder IDs
(e.g. `REPLACE_ME_D1_ID`). Real Cloudflare account / database IDs and
secrets are never committed here.

## First deploy — step by step

**Step 1 — Create Cloudflare resources** (one-time, in your Cloudflare dashboard):

| Resource | Name | Binding |
|---|---|---|
| R2 bucket | `oaa-raw-traces` | `RAW_TRACES` |
| R2 bucket | `oaa-artifacts` | `ARTIFACTS` |
| R2 bucket | `oaa-reports` | `REPORTS` |
| D1 database | `oaa-meta` | `DB` |
| Queue | `oaa-audit-jobs` | `AUDIT_JOBS` |
| Queue | `oaa-chunk-jobs` | `CHUNK_JOBS` |
| Queue | `oaa-report-jobs` | `REPORT_JOBS` |

**Step 2 — Prepare wrangler config**:
```bash
cp examples/cloudflare/wrangler.example.jsonc wrangler.jsonc
# Edit wrangler.jsonc: replace REPLACE_ME_D1_ID with your D1 database ID
```

**Step 3 — Apply D1 schema**:
```bash
wrangler d1 execute oaa-meta --file=examples/cloudflare/d1-schema.sql
```

**Step 4 — Build dashboard**:
```bash
cd packages/dashboard && npm install && npm run build
# Produces packages/dashboard/dist/ — served as Static Assets
```

**Step 5 — Build worker packages**:
```bash
npx tsc -p packages/schema/tsconfig.json
npx tsc -p packages/core/tsconfig.json
npx tsc -p packages/adapters/tsconfig.json
```

**Step 6 — Deploy**:
```bash
wrangler deploy --config wrangler.jsonc
```

Or push to `main` to trigger the GitHub Actions deploy workflow automatically.

See [`docs/cloudflare-native.md`](../../docs/cloudflare-native.md) for the full architecture.
