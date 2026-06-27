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

The schema is in `draft` state. Implementation proceeds against the current
draft per the approach described in
[`docs/schema-versioning.md`](../docs/schema-versioning.md).
Upstream projects (`wasmagent-js`, `bscode`, `trace-pipeline`, AEP) are
not constrained by OAA's own versioning.
