# @openagentaudit/worker

Cloudflare Worker reference deployment for OpenAgentAudit.

A thin orchestration layer over `@openagentaudit/core` engines.
Storage bindings (R2, D1, Queues, Durable Objects) are injected via `WorkerEnv`.

**Status:** implemented — deployed at [trustavo.com](https://trustavo.com).

## API

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/runs` | Upload a trace and run the full audit pipeline |
| `GET` | `/api/v1/runs` | List recent runs |
| `GET` | `/api/v1/runs/:runId` | Get run metadata |
| `GET` | `/api/v1/runs/:runId/findings` | Get findings for a run |
| `GET` | `/api/v1/runs/:runId/report?format=md\|html\|json\|csv` | Get rendered report |
| `GET` | `/api/v1/config` | Site branding config for the SPA |

### Upload formats

`POST /api/v1/runs` accepts two formats:

- **JSONL** (`CanonicalEvent` records, one per line) — standard OAA format. Lines
  that cannot be parsed as JSON generate an `OAA-P-001` finding instead of being
  silently dropped.
- **AEP JSON** (a single `AEPRecord` with `schema_version: "aep/v0.2"`) — the worker
  auto-detects this format, converts via the adapter, and extracts run-provenance
  for scoring and report rendering. No pre-conversion needed.

Every direct `POST /api/v1/runs` response immediately writes the run metadata and
findings to D1, so the run appears in `GET /api/v1/runs` without delay.

## Engine notes

### Contamination risk
The `contamination_risk_inverted` EAS component requires a training event set to compute a real score. In the single-upload API (`POST /api/v1/runs`), no training set is available, so this component always returns a **neutral score (100)**. The rendered report includes a disclosure note. To evaluate real contamination risk, call `contamination()` from `@openagentaudit/core` separately and pass the result to `computeRiskScore()`.

### Drift guard
The `driftGuard` engine compares two time windows and requires two separate event sets. It is not wired into the single-upload API. Use it programmatically via the `@openagentaudit/core` CLI or by calling `driftGuard(windowA, windowB)` directly.

## Architecture

```
HTTP / Queue message
        │
        ▼
  Worker fetch/queue handler
        │
        ├── @openagentaudit/adapters  (AEP auto-detection + conversion)
        ├── @openagentaudit/core      (run engines)
        └── R2 / D1 / DO             (store results)
```

## Bindings (wrangler.jsonc)

| Binding | Type | Purpose |
|---|---|---|
| `RAW_TRACES` | R2 | Incoming trace uploads |
| `ARTIFACTS` | R2 | Intermediate engine artifacts |
| `REPORTS` | R2 | Final audit report bundles |
| `DB` | D1 | Run / finding / evidence metadata |
| `AUDIT_JOBS` | Queue | Async audit job dispatch |
| `AUDIT_RUN_COORDINATOR` | DO | Per-run state coordination |
| `TENANT_LIMITER` | DO | Per-tenant rate limiting |

## Environment vars (wrangler.jsonc `vars`)

| Var | Required | Default | Purpose |
|---|---|---|---|
| `OAA_ENV` | yes | — | Runtime environment label (`production`, `staging`, etc.) |
| `MAX_UPLOAD_MB` | yes | `100` | Maximum trace upload size |
| `DEFAULT_PROFILES` | yes | — | Comma-separated compliance profiles |
| `ISSUER_NAME` | yes | — | Organisation name in reports and UI |
| `ISSUER_EMAIL` | yes | — | Contact email in reports and 404 pages |
| `PUBLIC_URL` | yes | — | Base URL for QR code links and report permalinks |
| `CORS_ORIGIN` | no | `*` | Allowed CORS origin (e.g. `https://app.example.com`); defaults to wildcard |
| `API_KEY` | no | (unset) | Bearer token required on POST /api/v1/runs; omit to run in open/demo mode |

## References

- [`docs/cloudflare-native.md`](../../docs/cloudflare-native.md) — deployment architecture
- [`examples/cloudflare/wrangler.example.jsonc`](../../examples/cloudflare/wrangler.example.jsonc) — config template
- [`examples/cloudflare/d1-schema.sql`](../../examples/cloudflare/d1-schema.sql) — D1 schema

