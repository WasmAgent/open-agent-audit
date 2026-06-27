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

- **JSONL** (`CanonicalEvent` records, one per line) — standard OAA format.
- **AEP JSON** (a single `AEPRecord` with `schema_version: "aep/v0.2"`) — the worker
  auto-detects this format, converts via the adapter, and extracts run-provenance
  for scoring and report rendering. No pre-conversion needed.

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

## References

- [`docs/cloudflare-native.md`](../../docs/cloudflare-native.md) — deployment architecture
- [`examples/cloudflare/wrangler.example.jsonc`](../../examples/cloudflare/wrangler.example.jsonc) — config template
- [`examples/cloudflare/d1-schema.sql`](../../examples/cloudflare/d1-schema.sql) — D1 schema

