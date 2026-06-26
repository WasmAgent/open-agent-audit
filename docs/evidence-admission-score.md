# Evidence Admission Score (EAS)

The Evidence Admission Score answers: **how strong is this audit trail as
evidence?**

It is a 0–100 score with a letter grade. Lower scores indicate that the
trace is missing fields, has integrity gaps, or has poor coverage.

## Formula

```
EAS = 0.20 · trace_completeness
    + 0.20 · provenance_integrity
    + 0.20 · objective_verification
    + 0.15 · policy_coverage
    + 0.15 · human_oversight_evidence
    + 0.10 · contamination_risk_inverted
```

Each component is a 0..100 value.

## Components

### Trace completeness (20%)

Fraction of expected canonical fields actually populated, weighted by the
importance of each field type.

Penalties:

- Missing `evidence_id` on any event: -5 points.
- Missing `timestamp` on any event: -10 points.
- Unpaired `tool_call` start/end: -2 points per occurrence.

### Provenance integrity (20%)

Cryptographic and chain checks.

- Hash chain unbroken across events: +60 baseline.
- Signatures present and verify: +40.
- One or more signature failures: floor to 0.
- One or more chain breaks: floor to 0.

### Objective verification (20%)

Fraction of conclusions backed by deterministic verifiers (build-passes,
ledger-balance, schema-validates) vs. LLM-as-judge.

- Deterministic verifier ratio ≥ 0.8: 100.
- 0.5–0.8: 60–90.
- < 0.5: ≤ 60.

LLM-as-judge contributions are **advisory only** and count for at most
30% of this component.

### Policy coverage (15%)

Whether the audit run includes a capability manifest, policy decisions, and
evidence of policy evaluation per high-risk action.

### Human oversight evidence (15%)

Whether human approval records are present for actions tagged as requiring
oversight, and whether reviewer identity is recorded.

### Contamination risk inverted (10%)

`100 - contamination_risk_score`. High contamination risk reduces EAS.

## Grade boundaries

| Score | Grade | Meaning |
|---|---|---|
| 90–100 | **A** | Strong audit evidence; ready for external review. |
| 75–89 | **B** | Generally acceptable; documented gaps remain. |
| 60–74 | **C** | Internal diagnostic only; not for external delivery. |
| 40–59 | **D** | Evidence is materially incomplete. |
| 0–39 | **F** | Do not use for compliance or training data pipelines. |

## Reporting

The EAS MUST appear in the Executive Summary of every audit report. The
report MUST include a breakdown of the six components, not just the
aggregate score.

## Limitations

EAS measures **evidence quality**, not **agent behavior quality**. A
well-behaved agent with a poor trace gets a low EAS; a misbehaving agent
with a perfect trace gets a high EAS. Both signals are necessary.
