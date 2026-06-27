# @openagentaudit/worker

Cloudflare Worker reference deployment for OpenAgentAudit.

A thin orchestration layer over `@openagentaudit/core` engines.
Storage bindings (R2, D1, Queues, Durable Objects) are injected via `WorkerEnv`.

**Status:** skeleton — engine integration in progress.

## Architecture

```
HTTP / Queue message
        │
        ▼
  Worker fetch/queue handler
        │
        ├── @openagentaudit/adapters  (parse source format)
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
