# OpenAgentAudit

> Open evidence format and Cloudflare-native audit toolkit for enterprise AI agents.

![WasmAgent product matrix](https://raw.githubusercontent.com/WasmAgent/wasmagent/main/assets/product-matrix.webp)

**Agent logs are not audit evidence.** OpenAgentAudit turns tool calls, policy
decisions, human approvals, benchmark results, and runtime traces into
defensible technical evidence reports.

## Live deployment

**https://trustavo.com** — production deployment on Cloudflare Workers.

## What it does

- **Validate** agent evidence records against a canonical schema.
- **Reconstruct** tool and permission inventory from runtime traces.
- **Detect** policy boundary violations and excessive agency.
- **Audit** benchmark claims with paired statistics (McNemar, Wilson CI).
- **Check** contamination risk with CPU-first chunked algorithms.
- **Monitor** behavioral drift over time.
- **Map** evidence to OWASP Agentic Top 10, NIST AI RMF, ISO/IEC 42001, and
  EU AI Act Annex IV technical documentation needs.
- **Run** as a TypeScript/Bun CLI or as a Cloudflare-native service.

## What it does not do

- It does **not** provide legal advice.
- It does **not** certify regulatory compliance.
- It does **not** require GPU.
- It does **not** require Python, scipy, or a traditional backend server.
- It does **not** replace observability tools — it consumes their traces and
  produces audit evidence.

## Where it sits in the WasmAgent ecosystem

```
wasmagent-js (runtime, SDK, AEP emitter)
        │
        ├─── bscode (coding-agent workload)        ──┐
        └─── erp-agent (ERP workload)               ──┤
                                                      │ AEP records
                                                      │ rollout JSONL
                                                      ▼
                            ┌─────────────────────────┴─────────────────────────┐
                            ▼                                                   ▼
                  trace-pipeline                                       open-agent-audit
                  (training data pipeline)                             (audit evidence pipeline)
                  → SFT / DPO / PPO training data                      → audit reports, findings
                  → trust-score                                        → regulatory mappings
                  → TrainingDataExporter                               → Evidence Admission Score
```

OpenAgentAudit is a **peer** of `trace-pipeline`, not a layer inside any other
repo. Both consume AEP records; they serve different downstream customers.

## Cloudflare-native by design

OpenAgentAudit's reference deployment is Cloudflare-only:

- Cloudflare Workers — API and audit engine
- Cloudflare Pages — Dashboard
- Cloudflare R2 — traces, artifacts, reports
- Cloudflare D1 — run / finding / evidence metadata
- Cloudflare Queues — chunked async jobs
- Cloudflare Durable Objects — per-run coordination
- Cloudflare Workflows — durable multi-step orchestration
- Cloudflare Browser Run — HTML → PDF
- Cloudflare Containers — optional heavy enterprise jobs

No external VPS, Cloud Run, or Kubernetes is required.

## Status

**Phase 2 — Active implementation.** The specification, schemas, and
regulatory profiles are complete. TypeScript implementation packages are
being built against the current `open-agent-audit/v0.1` schema.

| Component | Status |
|---|---|
| `spec/versions/v0.1/SPEC.md` | draft |
| `schemas/v0.1/*.schema.json` | draft |
| `profiles/*.yaml` | draft |
| `packages/schema` | implemented — Zod runtime validation |
| `packages/core` | implementing |
| `packages/adapters` | implementing — AEP v0.2, bscode |
| `packages/cli` | implementing |
| `packages/worker` | skeleton |
| `packages/dashboard` | planned — React + Tailwind + CF Static Assets |

## Documents you should read first

1. [`CONSTRAINTS.md`](./CONSTRAINTS.md) — project rules; every contributor must read this.
2. [`spec/SPEC.md`](./spec/SPEC.md) — canonical evidence specification.
3. [`docs/architecture.md`](./docs/architecture.md) — system architecture.
4. [`docs/cloudflare-native.md`](./docs/cloudflare-native.md) — deployment model.
5. [`docs/relationship-to-wasmagent.md`](./docs/relationship-to-wasmagent.md) — how this fits with `wasmagent-js`, `bscode`, `trace-pipeline`.
6. [`docs/schema-versioning.md`](./docs/schema-versioning.md) — versioning policy.
7. [`docs/regulatory-disclaimer.md`](./docs/regulatory-disclaimer.md) — what we do and do not claim.

## Disclaimer

OpenAgentAudit produces **technical evidence** that may support selected
regulatory documentation requirements. It does **not** constitute legal advice,
regulatory certification, or a determination of compliance. Regulatory
interpretations evolve; users are responsible for their own compliance
posture. See [`docs/regulatory-disclaimer.md`](./docs/regulatory-disclaimer.md).

## License

Apache License 2.0 — see [`LICENSE`](./LICENSE).
