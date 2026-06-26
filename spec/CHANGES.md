# Spec Changes

This file records changes to the OpenAgentAudit specification across versions.

## v0.1 — 2026-06-26 (Draft)

Initial draft. Defines:

- `CanonicalEvent`, `AuditRun`, `Finding`, `EvidenceBundle`, `RiskScore`.
- Seven event types: `tool_call`, `policy_decision`, `human_approval`,
  `observation`, `model_output`, `final_answer`, `error`.
- Five actor types: `agent`, `user`, `system`, `tool`, `human_reviewer`.
- Severity rubric: `info | low | medium | high | critical`.
- Adapter contract for AEP v0.2, ComplianceEvalRecord, bscode, OTel,
  Langfuse, LangSmith.

The schema is in draft until the freeze gate documented in
[`docs/schema-versioning.md`](../docs/schema-versioning.md) is satisfied.
The gate covers OAA's own model only; upstream projects (`wasmagent-js`,
`bscode`, `trace-pipeline`, AEP) are not constrained by this freeze.
