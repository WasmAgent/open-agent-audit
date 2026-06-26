# Architecture

OpenAgentAudit is structured as four layers:

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 4 — Delivery                                          │
│  audit-report.{md,html,pdf}, evidence-bundle.zip, dashboard  │
└─────────────────────────────────────────────────────────────┘
                            ▲
┌─────────────────────────────────────────────────────────────┐
│  Layer 3 — Audit Engines                                     │
│  validate · inventory · policy-audit · benchmark-audit ·     │
│  contamination · drift-guard · scoring · report              │
└─────────────────────────────────────────────────────────────┘
                            ▲
┌─────────────────────────────────────────────────────────────┐
│  Layer 2 — Canonical Evidence (this spec)                    │
│  CanonicalEvent · AuditRun · Finding · EvidenceBundle ·      │
│  RiskScore                                                   │
└─────────────────────────────────────────────────────────────┘
                            ▲
┌─────────────────────────────────────────────────────────────┐
│  Layer 1 — Source-format Adapters                            │
│  AEP · ComplianceEvalRecord · bscode · OTel · Langfuse ·     │
│  LangSmith                                                   │
└─────────────────────────────────────────────────────────────┘
                            ▲
                  External source formats
```

## Why this layering matters

The canonical evidence layer (Layer 2) is the **stable interior** of
OpenAgentAudit. It is the target for adapters and the input to audit
engines.

When upstream formats evolve (e.g. AEP v0.2 → AEP v0.3), only the
relevant adapter changes. Audit engines, report templates, regulatory
profiles, and the dashboard schema all remain stable.

This is the architectural answer to the question "how do we ship audit
tooling while AEP and the main projects are still iterating?" — OAA
does not ask them to slow down. See `docs/schema-versioning.md` for the
freeze gate that operationalizes this principle for OAA's own model.

## Layer 1 — Source-format adapters

Adapters transform source-format records into canonical events.

Each adapter is:

- A pure function `(source) -> CanonicalEvent[]`.
- Versioned against a specific source-format version.
- Required to mark unknown fields explicitly (no fabrication).
- Required to set `source_adapter` and `input_format` on the resulting `AuditRun`.

See `docs/adapter-contract.md`.

## Layer 2 — Canonical evidence

The schema-versioned objects defined in `spec/versions/v0.1/SPEC.md`.

## Layer 3 — Audit engines

Each engine consumes canonical events and produces structured output. All
engines are pure TypeScript with no Cloudflare bindings; storage and
indexing are dependency-injected.

| Engine | Purpose | Output |
|---|---|---|
| `validate` | Schema and integrity checks | validation summary |
| `inventory` | Reconstruct tool / capability / data inventory | inventory.json |
| `policy-audit` | Apply rules against capability manifest | findings |
| `benchmark-audit` | Paired statistics over benchmark pairs | findings |
| `contamination` | Train/test overlap detection | contamination report |
| `drift-guard` | Statistical drift between two windows | drift report |
| `scoring` | EAS + ARS | risk-score.json |
| `report` | Render markdown / HTML / JSON | report artifacts |

## Layer 4 — Delivery

The delivery layer packages findings, risk scores, inventories, and report
artifacts into an evidence bundle. PDF rendering uses Cloudflare Browser
Run; heavy enterprise jobs may use Cloudflare Containers.

## Runtime placement

The same engines run in three environments:

- **Bun CLI** (developer workflow, CI).
- **Cloudflare Workers + Queues + DO** (production).
- **Cloudflare Containers** (optional heavy enterprise jobs).

See [`cloudflare-native.md`](./cloudflare-native.md) for the production
deployment architecture.
