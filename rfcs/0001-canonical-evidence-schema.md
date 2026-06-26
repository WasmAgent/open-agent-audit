# RFC 0001 — Canonical Evidence Schema v0.1

- **Status:** Draft
- **Date:** 2026-06-26
- **Author:** OpenAgentAudit working group

## Summary

Define the canonical evidence schema that audit engines consume. Source
formats (AEP, OTel, Langfuse, LangSmith, bscode rollout JSONL,
ComplianceEvalRecord) are transformed into canonical events by versioned
adapters. The canonical schema is the stable interior.

## Motivation

Three problems make a canonical layer necessary:

1. AEP is still evolving (v0.2 P0 reform underway).
2. We want OpenAgentAudit to consume external formats too.
3. Audit engines must not depend on volatile source-field names.

## Detailed design

See `spec/versions/v0.1/SPEC.md`.

The schema defines five top-level objects: `CanonicalEvent`, `AuditRun`,
`Finding`, `EvidenceBundle`, `RiskScore`.

Event types (7): `tool_call`, `policy_decision`, `human_approval`,
`observation`, `model_output`, `final_answer`, `error`.

## Alternatives considered

- **Reuse AEP as the canonical layer.** Rejected because AEP is still
  evolving and is single-source (WasmAgent-only).
- **Reuse OpenTelemetry GenAI semconv.** Rejected because GENAI_SEMCONV
  does not cover policy decisions, human approvals, or signed evidence
  chains.

## Migration

Not applicable — this is the initial schema.

## Open questions

- Whether to include a top-level `delegation_context` for multi-agent runs
  in v0.1, or defer to v0.2 (currently leaning defer; see RFC 0003).
