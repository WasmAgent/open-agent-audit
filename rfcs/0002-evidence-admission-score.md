# RFC 0002 — Evidence Admission Score

- **Status:** Implemented
- **Date:** 2026-06-26
- **Last updated:** 2026-06-28

## Summary

Define a 0–100 score that summarizes the **evidential quality** of an
audit run. Distinct from agent behavior risk.

## Motivation

Reviewers need a one-number indicator of "is this trace good enough to
defend?" before they invest time in reading findings.

## Detailed design

See `docs/evidence-admission-score.md` for the formula, components, and
grade boundaries.

## Why these six components

- **Trace completeness** — most audit findings are blocked by missing fields.
- **Provenance integrity** — signatures and chain are the strongest claim.
- **Objective verification** — separates LLM-judge noise from deterministic verifier signal.
- **Policy coverage** — distinguishes governed agents from ungoverned ones.
- **Human oversight evidence** — many regulations require it explicitly.
- **Contamination risk** — affects whether benchmark results can be cited.

## Weights

The weights (0.20 / 0.20 / 0.20 / 0.15 / 0.15 / 0.10) are an initial
heuristic. They will be reviewed after the first 100 real audit runs.

## Alternatives

- A boolean "auditable / not auditable" — rejected as too coarse.
- A per-finding confidence score — kept on Finding, separate from EAS.
- LLM-judge-derived score — rejected as unreproducible.

## Open questions

- Should EAS be calibrated separately per industry (high-regulated vs.
  low-regulated)? Probably yes, deferred to v0.2.

## Implementation status

Implemented in `packages/core/src/scoring/index.ts`. The formula and weights are as specified.

One post-implementation addition: the `provenance_integrity` component accepts an optional `AepProvenanceForScoring` argument that adds +5 points per populated AEP traceability field (repo_commit, runtime_version, policy_bundle_digest, tool_manifest_digest), capped at 100. This does not change the formula weights.

The "calibrate per industry" open question is deferred to v0.2.
