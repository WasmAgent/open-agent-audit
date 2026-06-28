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

Scoring rules (evaluated in order):

1. No events with `evidence.hash` or `evidence.prev_hash` → **20** (baseline, no chain).
2. Hash chain broken (`prev_hash[i] ≠ hash[i-1]` for any i) → **0**.
3. Any event has `signature_algorithm` set but `signature` missing → **0**.
4. All evidence-bearing events have a `signature` field → base **100**; otherwise base **60**.

**AEP run-provenance bonus** (applied after base, capped at 100):
When an AEP source record is uploaded, each of the four traceability fields
that is populated adds **+5 points** to the base score (maximum +20 total):

| Field | Meaning |
|---|---|
| `repo_commit` | Git commit of the agent code at run time |
| `runtime_version` | Agent runtime version string |
| `policy_bundle_digest` | SHA-256 of the active policy ruleset |
| `tool_manifest_digest` | SHA-256 of the declared tool manifest |

These fields anchor the record to the exact code, runtime, policy, and tool
manifest in effect — satisfying EU AI Act Art. 12(3)(c) / Art. 19 traceability
requirements. A record with a complete hash chain, full signatures, and all four
provenance fields populated scores **100** on this component.

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

Use the **Agent Risk Score (ARS)** — also produced by `computeRiskScore()` —
to assess observed behavioral risk: policy denials, high-risk tool calls,
approval bypasses, errors, and evidence chain breaks. EAS and ARS are
complementary; neither alone is sufficient for a complete audit picture.
