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
| `report` | Markdown / HTML / JSON renderer | **implemented** |
| `benchmark-audit` | McNemar + Wilson CI over paired benchmark samples | skeleton |
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

## Usage

\`\`\`ts
import { validate, computeRiskScore } from '@openagentaudit/core';

const { total, errors, warnings } = await validate(events);
const score = await computeRiskScore(events);
console.log(score.evidence_admission_score); // { score: 87, grade: 'B' }
\`\`\`
