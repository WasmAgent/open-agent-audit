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

The SPA dashboard at trustavo.com provides a browser-based interface with
client-side routing via wouter. Routes: `/` (home), `/audit` (submit
trace), `/runs/:runId` (run detail with breadcrumb navigation). The worker
accepts both JSONL (streaming events) and AEP JSON (single-document)
formats; the format is auto-detected on ingest.

## Runtime placement

The same engines run in three environments:

- **Bun CLI** (developer workflow, CI).
- **Cloudflare Workers + Queues + DO** (production).
- **Cloudflare Containers** (optional heavy enterprise jobs).
- **Dashboard** — React SPA served at trustavo.com, client-side routing via wouter.

See [`cloudflare-native.md`](./cloudflare-native.md) for the production
deployment architecture.

## Compliance framework integration

The report engine produces compliance mappings for four frameworks simultaneously,
derived from a single audit run:

| Framework | Coverage |
|---|---|
| OWASP Agentic Top 10 | 10/10 controls (AAI01–AAI10) |
| EU AI Act Annex IV | 13 controls (Art. 9, 12, 13, 14, 15, 17) |
| NIST AI RMF 1.0 | 25/72 subcategories (single-run ceiling) |
| ISO/IEC 42001:2023 | 16/37 controls (single-run ceiling) |

All mappings are evidence-linked: every control cites specific `event_id` values
from the submitted trace. This means compliance gaps are traceable back to
individual recorded events rather than inferred from aggregate statistics.
