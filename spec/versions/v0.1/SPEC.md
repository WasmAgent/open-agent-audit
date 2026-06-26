# OpenAgentAudit Specification — v0.1 (Draft)

> Specification version: `open-agent-audit/v0.1`
> Status: **draft**
> Date: 2026-06-26

This document is the normative specification of the OpenAgentAudit canonical
evidence model, version 0.1.

The keywords MUST, MUST NOT, SHOULD, SHOULD NOT, MAY are to be interpreted as
described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) when, and only
when, they appear in all capitals.

---

## 1. Goals and non-goals

### 1.1 Goals

- Provide a single canonical evidence format that downstream audit engines
  can consume without re-implementing source-format parsers.
- Make every conclusion traceable to an evidence ID.
- Preserve cryptographic integrity (hash chain + signatures) where present.
- Allow incomplete traces to be ingested with an explicit coverage score.
- Be implementable in TypeScript without native dependencies.

### 1.2 Non-goals

- Define a transport protocol.
- Define a storage layout.
- Define legal sufficiency for any regulation.
- Replace observability tracing (OTel, LangSmith, Langfuse).

---

## 2. Top-level objects

The specification defines five top-level objects:

| Object | Section | Schema |
|---|---|---|
| `CanonicalEvent` | §3 | [canonical-event.schema.json](../../../schemas/v0.1/canonical-event.schema.json) |
| `AuditRun` | §4 | [audit-run.schema.json](../../../schemas/v0.1/audit-run.schema.json) |
| `Finding` | §5 | [finding.schema.json](../../../schemas/v0.1/finding.schema.json) |
| `EvidenceBundle` | §6 | [evidence-bundle.schema.json](../../../schemas/v0.1/evidence-bundle.schema.json) |
| `RiskScore` | §7 | [risk-score.schema.json](../../../schemas/v0.1/risk-score.schema.json) |

---

## 3. CanonicalEvent

See [`canonical-event.md`](./canonical-event.md) for the field-by-field
description.

A canonical event represents one observable thing the agent did.

Required fields:

- `schema_version` — MUST be `"open-agent-audit/v0.1"`.
- `run_id` — opaque, unique within a tenant.
- `event_id` — opaque, unique within a run.
- `timestamp` — RFC 3339 with timezone.
- `type` — one of `tool_call | policy_decision | human_approval | observation | model_output | final_answer | error`.
- `actor` — one of `agent | user | system | tool | human_reviewer`.

Conditional fields depend on `type`:

- `tool_call` MUST include `tool.name`. SHOULD include `tool.args_hash`
  and `tool.result_hash` if available.
- `policy_decision` MUST include `policy.decision` ∈ `allow | deny | ask_user`.
- `human_approval` MUST include `human.reviewer_id` and `human.decision`.
- `error` MUST include `error.kind` and `error.message`.

Evidence integrity fields are OPTIONAL but RECOMMENDED:

- `evidence.evidence_id`
- `evidence.hash`
- `evidence.prev_hash`
- `evidence.signature`
- `evidence.signature_algorithm`

A trace that lacks evidence integrity fields receives a reduced
Evidence Admission Score; see [`docs/evidence-admission-score.md`](../../../docs/evidence-admission-score.md).

---

## 4. AuditRun

See [`canonical-event.md`](./canonical-event.md) §AuditRun.

An audit run groups a set of canonical events with the metadata required to
audit them. Required fields:

- `schema_version` — MUST match v0.1.
- `run_id`
- `agent_id`
- `model_id` (MAY be `"unknown"` for opaque models).
- `created_at`, `completed_at`.
- `task` — `{ id, description, risk_level: low | medium | high | critical }`.
- `capability_manifest_ref` — OPTIONAL pointer to capability declaration.

Events MAY be inlined or referenced by object key.

---

## 5. Finding

See [`finding.md`](./finding.md).

A finding is the structured output of an audit rule. Required:

- `finding_id`
- `severity` ∈ `info | low | medium | high | critical`
- `category` (from threat taxonomy)
- `title`
- `description`
- `evidence_ids[]` — MUST be non-empty
- `recommendation`

Optional:

- `standard_mappings[]` — `{ profile, control_id, limitation }`

Severity MUST be derived from a rubric documented in
[`docs/threat-taxonomy.md`](../../../docs/threat-taxonomy.md).
Subjective severity without rubric reference is non-conformant.

---

## 6. EvidenceBundle

See [`evidence-bundle.md`](./evidence-bundle.md).

An evidence bundle is a packaged delivery containing:

- A manifest with hashes of all included files.
- The `AuditRun` object.
- The canonical events (inline or as a JSONL file).
- All findings.
- The risk score.
- The report artifacts (md / html / pdf if present).
- A detached signature over the manifest hash.

A bundle MUST be reproducible: re-running an audit on the same canonical
events with the same profile versions and same engine version MUST produce
findings with identical IDs and severities.

---

## 7. RiskScore

Two scores per run:

- **Evidence Admission Score (EAS)** — 0–100, describes evidence quality.
- **Agent Risk Score (ARS)** — 0–100, describes operational risk.

See [`docs/evidence-admission-score.md`](../../../docs/evidence-admission-score.md)
for the formula, components, and grade boundaries.

---

## 8. Conformance

A producer is **OAA-conformant** if every event it emits validates against
the canonical event schema and is internally consistent (timestamps
monotonic per actor, tool_call start/end pairing, hash chain unbroken if
present).

A consumer is **OAA-conformant** if it rejects non-conformant events with a
diagnostic that includes the offending field path.

An auditor is **OAA-conformant** if every finding it emits references at
least one evidence_id and includes a rubric-referenced severity.

---

## 9. Disclaimer

This specification provides a technical evidence format. It does not
constitute legal advice or a regulatory compliance determination. See
[`disclaimer.md`](./disclaimer.md).
