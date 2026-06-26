# Cloudflare-Native Architecture

OpenAgentAudit's reference deployment is **Cloudflare-only**. This document
describes the production architecture.

## Component map

| Component | Cloudflare product | Role |
|---|---|---|
| Dashboard | Pages | Static UI for projects, runs, findings, downloads |
| Public API | Workers | Ingest, query, auth, lightweight checks |
| Audit engines | Workers + Queues | Chunked job execution |
| Run coordination | Durable Objects (`AuditRunCoordinator`) | Per-run state, progress, idempotency, finalization |
| Tenant rate-limiting | Durable Objects (`TenantLimiter`) | Per-tenant quotas |
| Long workflows | Workflows | Multi-step audits with retry / pause / approval |
| Object storage | R2 | Raw traces, normalized shards, reports, evidence bundles |
| Metadata | D1 | Runs, findings, evidence index, report metadata |
| Browser tasks | Browser Run | HTML → PDF |
| Heavy enterprise | Containers (opt-in) | Heavy jobs that exceed Worker limits |
| Auth | Cloudflare Access | Pilot dashboard access |
| Abuse / WAF | Turnstile, WAF, Rate Limiting | Upload protection |

## Data flow

```
Producer (bscode / erp-agent / external)
        │ AEP JSONL / OTel / Langfuse / etc.
        ▼
Worker: ingest API ─── R2 (raw traces)
        │
        ▼
Queue: normalize ─── R2 (normalized shards)
        │
        ▼
Queue: validate / inventory / policy-audit / benchmark-audit
        │
        │   ╲ Durable Object: AuditRunCoordinator
        │    progress, finalization lock, chunk merge
        │
        ▼
D1: findings index, evidence index, report metadata
R2: findings.json, risk-score.json, audit-report.{md,html}
        │
        ▼
Worker: render-pdf ─── Browser Run ─── R2 (audit-report.pdf)
        │
        ▼
Worker: bundle ─── R2 (evidence-bundle.zip)
        │
        ▼
Dashboard / API consumers
```

## Why the heavy work is chunked

A single Worker invocation has a CPU-time ceiling. OpenAgentAudit treats
that as a design constraint, not a problem to route around:

- Validation reads R2 objects in byte-range chunks.
- Inventory is map/reduce: each chunk emits partial statistics; the DO
  merges them.
- Contamination uses MinHash + LSH so each chunk computes signatures
  independently.
- Drift is summary-comparison: each window is a summary, not a raw scan.
- Reports are rendered from already-reduced artifacts, not from raw traces.

Heavy enterprise tasks that cannot be chunked are routed to Cloudflare
Containers. They are not part of the default path.

## Idempotency and resume

- Every chunk job carries a `job_id`. The DO refuses duplicate `job_id`s.
- All partial artifacts live in R2 under `tenants/.../runs/.../normalized/`.
- Run state lives only in the DO; D1 is a denormalized query index.
- A run can be resumed from any consistent intermediate by replaying jobs
  whose outputs are missing.

## What the Worker does NOT do

- Write to local disk (no filesystem semantics).
- Hold large objects in memory.
- Call out to external VPS / Cloud Run / Kubernetes.
- Run native binaries outside of Containers.
- Use Node-only crypto (Web Crypto only).

## Configuration

See [`examples/cloudflare/wrangler.example.jsonc`](../examples/cloudflare/wrangler.example.jsonc)
for the reference Wrangler configuration with all bindings.

See [`examples/cloudflare/d1-schema.sql`](../examples/cloudflare/d1-schema.sql)
for the initial D1 schema.
