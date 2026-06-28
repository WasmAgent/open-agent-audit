<p align="center">
  <img src="https://raw.githubusercontent.com/WasmAgent/wasmagent/main/assets/logo.png" width="100" alt="WasmAgent logo"/>
</p>

# OpenAgentAudit

[![CI](https://github.com/WasmAgent/open-agent-audit/actions/workflows/ci.yml/badge.svg)](https://github.com/WasmAgent/open-agent-audit/actions/workflows/ci.yml)
[![Deploy](https://github.com/WasmAgent/open-agent-audit/actions/workflows/deploy.yml/badge.svg)](https://github.com/WasmAgent/open-agent-audit/actions/workflows/deploy.yml)
[![npm @openagentaudit/schema](https://img.shields.io/npm/v/%40openagentaudit%2Fschema?label=%40openagentaudit%2Fschema)](https://www.npmjs.com/package/@openagentaudit/schema)
[![npm @openagentaudit/core](https://img.shields.io/npm/v/%40openagentaudit%2Fcore?label=%40openagentaudit%2Fcore)](https://www.npmjs.com/package/@openagentaudit/core)
[![npm @openagentaudit/adapters](https://img.shields.io/npm/v/%40openagentaudit%2Fadapters?label=%40openagentaudit%2Fadapters)](https://www.npmjs.com/package/@openagentaudit/adapters)

> Open evidence format and Cloudflare-native audit toolkit for enterprise AI agents.
>
> **Trustavo** — *Trust, voiced with authority.* The production deployment at
> **[trustavo.com](https://trustavo.com)** is the reference implementation of
> OpenAgentAudit. In audit, evidence only counts when it is trusted; Trustavo
> exists to make that trust legible.

![WasmAgent product matrix](https://raw.githubusercontent.com/WasmAgent/wasmagent/main/assets/product-matrix.webp)

**Agent logs are not audit evidence.** OpenAgentAudit turns tool calls, policy
decisions, human approvals, benchmark results, training manifests, and runtime
traces into defensible technical evidence reports.

## Live deployment

**[trustavo.com](https://trustavo.com)** — production deployment on Cloudflare Workers.

## Install

```sh
npm install @openagentaudit/schema @openagentaudit/core @openagentaudit/adapters
```

```ts
import { validate, computeRiskScore, renderReport } from '@openagentaudit/core';
import { validateEvents } from '@openagentaudit/schema';
import { aepV0_2, otel, langfuse, langsmith } from '@openagentaudit/adapters';

// Parse and validate canonical events
const { valid: events } = validateEvents(raw);
const { errors, crypto_summary } = await validate(events);

// Run the full audit pipeline
const score = await computeRiskScore(events, runId);
const bundle = await renderReport(events, findings, score);
// bundle.html, bundle.markdown, bundle.json, bundle.csv
```

## What it does

- **Validate** agent evidence records against a canonical schema.
- **Reconstruct** tool and permission inventory from runtime traces.
- **Detect** policy boundary violations and excessive agency.
- **Audit** benchmark claims with paired statistics (McNemar, Wilson CI).
- **Check** contamination risk with CPU-first chunked algorithms.
- **Monitor** behavioral drift over time.
- **Render** training-run audit reports from `trace-pipeline` evidence bundles.
- **Map** evidence to OWASP Agentic Top 10, NIST AI RMF, ISO/IEC 42001, and
  EU AI Act Annex IV technical documentation needs.
- **Run** as a TypeScript/Bun CLI or as a Cloudflare-native service.

## What it does not do

- It does **not** provide legal advice.
- It does **not** certify regulatory compliance.
- It does **not** require GPU.
- It does **not** require Python, scipy, or a traditional backend server.
- It does **not** train models or run benchmarks directly.
- It does **not** replace observability tools — it consumes their traces and
  produces audit evidence.

## Where it sits in the WasmAgent ecosystem

```
wasmagent-js (runtime, SDK, AEP emitter)
        │
        ├─── bscode (real coding-agent workload)  ──┐
        └─── erp-agent (ERP workload, planned)    ──┤
                                                    │ AEP JSONL
                                                    │ (signed runtime evidence)
                                                    ▼
                        ┌────────────────────────────────────────────────────┐
                        ▼                                                    ▼
              trace-pipeline                                       open-agent-audit
              Measurement Trust                                    (this repo)
              Evidence Admission Gate                              ─────────────────
              Training Audit Backend                               audit reports
                │                                                  regulatory maps
                │  AgentTrustScore                                 benchmark claims
                │  + training evidence ──────────────────────────► evidence bundles
                │
                ├── SFT / DPO datasets (gated — regression gate required)
                └── ADAPTER_CARD.md   (promote / hold / reject)

External Observability (OTel, Langfuse, LangSmith) ─── via adapters ──► open-agent-audit
```

OpenAgentAudit is the **reporting and evidence layer** of the WasmAgent
ecosystem. `trace-pipeline` decides whether a benchmark claim is statistically
credible and whether a training run is auditable; OpenAgentAudit turns that
evidence into enterprise-readable reports. Both consume AEP records; they serve
different downstream customers.

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
| `packages/core` | implemented — all engines operational |
| `packages/adapters` | implemented — AEP v0.2, bscode, OTel GenAI, Langfuse, LangSmith; 444 tests |
| `packages/cli` | implemented — 7 commands including `from-aep`, `from-bscode` |
| `packages/worker` | implemented — REST API, deployed at trustavo.com |
| `packages/dashboard` | implemented — React SPA deployed at trustavo.com |
| npm packages | published — `@openagentaudit/schema`, `@openagentaudit/core`, `@openagentaudit/adapters` |

## Documents you should read first

1. [`CONSTRAINTS.md`](./CONSTRAINTS.md) — project rules; every contributor must read this.
2. [`spec/SPEC.md`](./spec/SPEC.md) — canonical evidence specification.
3. [`docs/architecture.md`](./docs/architecture.md) — system architecture.
4. [`docs/cloudflare-native.md`](./docs/cloudflare-native.md) — deployment model.
5. [`docs/relationship-to-wasmagent.md`](./docs/relationship-to-wasmagent.md) — how this fits with `wasmagent-js`, `bscode`, `trace-pipeline`.
6. [`docs/schema-versioning.md`](./docs/schema-versioning.md) — versioning policy.
7. [`docs/regulatory-disclaimer.md`](./docs/regulatory-disclaimer.md) — what we do and do not claim.
8. [`docs/compliance-coverage-report.md`](./docs/compliance-coverage-report.md) — per-framework coverage depth and breadth (OWASP / EU AI Act / NIST AI RMF / ISO 42001), upgrade paths, and ceiling analysis.
9. [`docs/competitive-landscape.md`](./docs/competitive-landscape.md) — market analysis: how OpenAgentAudit compares to ATR, VerifyWise, Credo AI, and other tools in the AI agent audit space.

## Disclaimer

OpenAgentAudit produces **technical evidence** that may support selected
regulatory documentation requirements. It does **not** constitute legal advice,
regulatory certification, or a determination of compliance. Regulatory
interpretations evolve; users are responsible for their own compliance
posture. See [`docs/regulatory-disclaimer.md`](./docs/regulatory-disclaimer.md).

## Acknowledgements

OpenAgentAudit is part of the [WasmAgent](https://github.com/WasmAgent) ecosystem.

Runtime dependencies: [Zod](https://github.com/colinhacks/zod) (MIT),
[React](https://github.com/facebook/react) (MIT),
[Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) (MIT).

See [`NOTICE`](./NOTICE) for full third-party attributions.

## License

Apache License 2.0 — see [`LICENSE`](./LICENSE).
