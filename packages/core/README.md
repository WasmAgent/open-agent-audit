# @openagentaudit/core

Worker-compatible audit engines. Consumes `CanonicalEvent[]` from
`@openagentaudit/schema` and produces structured findings, scores, and reports.

This package MUST NOT use Node.js APIs. See [`CONSTRAINTS.md`](../../CONSTRAINTS.md) §4.

## Engines

| Module | Purpose | Status |
|---|---|---|
| `validate` | Schema integrity, hash chain, duplicate detection | **implemented** |
| `scoring` | Evidence Admission Score (EAS) + Agent Risk Score (ARS) | **implemented** |
| `inventory` | Tool / capability / data inventory from trace | **implemented** |
| `policy-audit` | Rule engine against regulatory profiles (6 rules) | **implemented** |
| `report` | Markdown / HTML / JSON / CSV renderer with 4-framework compliance mapping | **implemented** |
| `benchmark-audit` | Paired McNemar + Wilson CI (paired mode) or aggregate comparison (aggregate mode) | **implemented** (not wired into compliance mapping by default — pass `BenchmarkAuditResult` to `renderReport()` to unlock 3 controls) |
| `contamination` | MinHash / LSH train-test overlap detection | skeleton |
| `drift-guard` | Statistical drift between time windows | skeleton |

## EAS formula

```
EAS = 0.20 * trace_completeness
    + 0.20 * provenance_integrity
    + 0.20 * objective_verification
    + 0.15 * policy_coverage
    + 0.15 * human_oversight_evidence
    + 0.10 * contamination_risk_inverted
```

Grade: A ≥ 90, B ≥ 75, C ≥ 60, D ≥ 40, F < 40.

See [`docs/evidence-admission-score.md`](../../docs/evidence-admission-score.md) for component definitions.

## Compliance coverage

The report engine maps trace evidence to four regulatory frameworks automatically:

| Framework | Controls mapped | Notes |
|---|---|---|
| OWASP Top 10 for Agentic Applications 2026 | 10 / 10 | AAI01–AAI10; all controls evaluated per run |
| EU AI Act Annex IV | 13 controls | Annex IV Items 1–7 + Art. 12, 13, 14, 17 obligations |
| NIST AI RMF 1.0 | 25 / 72 | Govern, Map, Measure, Manage sub-categories |
| ISO/IEC 42001:2023 | 16 controls | Annex A controls A.5–A.10 |

Each control receives one of: `supported`, `partial`, `not_applicable`, or `not_evaluated`,
with a linked evidence event list and a limitation note.

Three controls are only activated when a `BenchmarkAuditResult` is supplied:

- `annex-iv-testing-validation` (EU AI Act Annex IV Item 7)
- `MEASURE-2.9` (NIST AI RMF)
- `A.8.2` (ISO/IEC 42001)

Without benchmark data these controls default to `not_evaluated`.

## Usage

### Basic report (no benchmark data)

```ts
import { validate, computeRiskScore } from '@openagentaudit/core';
import { renderReport } from '@openagentaudit/core/report';

const { total, errors, warnings } = await validate(events);
const score = await computeRiskScore(events);

const bundle = await renderReport(events, findings, score);
// bundle.markdown, bundle.html, bundle.json, bundle.csv
```

### Report with benchmark data (unlocks 3 compliance controls)

**Paired mode** (preferred — enables McNemar significance test):

```ts
import { benchmarkAudit } from '@openagentaudit/core/benchmark-audit';
import { renderReport } from '@openagentaudit/core/report';

const benchmarkResult = await benchmarkAudit({
  mode: 'paired',
  samples: [
    { sample_id: 'task-001', baseline_pass: true,  candidate_pass: true  },
    { sample_id: 'task-002', baseline_pass: true,  candidate_pass: false },
    // ...one entry per evaluation sample
  ],
  claim: 'candidate improves on baseline',
});

const bundle = await renderReport(events, findings, score, meta, benchmarkResult);
// annex-iv-testing-validation, MEASURE-2.9, and A.8.2 are now populated
// statistics.audit_sufficiency === 'paired'
// McNemar p-value computed when discordant pair count >= 10
```

**Aggregate mode** (backward-compatible, no McNemar):

```ts
const benchmarkResult = await benchmarkAudit({
  candidate: { samples_total: 200, samples_pass: 174 },
  baseline:  { samples_total: 200, samples_pass: 160 },
  claim: 'candidate improves on baseline',
});
// statistics.audit_sufficiency === 'aggregate_only'
// OAA-B-004 finding generated when claim is set (McNemar not possible)
```

### `renderReport()` signature

```ts
function renderReport(
  events:          CanonicalEvent[],
  findings:        Finding[],
  score:           RiskScore,
  meta?:           ReportMeta,
  benchmarkResult?: BenchmarkAuditResult,
): Promise<ReportBundle>
```

`meta` and `benchmarkResult` are both optional. All `ReportMeta` fields are optional;
defaults are applied for issuer, report ID, timestamps, and profiles.

## AEP provenance bonus

Traces produced by AEP v0.2 emitters carry run-provenance fields
(`repo_commit`, `runtime_version`, `policy_bundle_digest`, `tool_manifest_digest`,
`mcp_server_card_digest`, `parent_trace_id`, `delegation_chain`).

When these are populated via `ReportMeta.aep_provenance`, the report engine:

- Renders a dedicated **AEP Run Provenance** section anchoring the record to the
  exact code, runtime, policy ruleset, and tool manifest in effect at run time.
- Upgrades `annex-iv-lifecycle-changes` (EU AI Act Annex IV Item 6 / Art. 19)
  from `partial` to `supported` when the full version anchor is present.

See [`packages/adapters/src/aep-v0_2.ts`](../adapters/src/aep-v0_2.ts) for the adapter
that extracts these fields from AEP source records.
