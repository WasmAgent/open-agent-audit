# CanonicalEvent — v0.1

This file describes the `CanonicalEvent` object field by field. It complements
the [JSON Schema](../../../schemas/v0.1/canonical-event.schema.json).

## Common fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `schema_version` | string | yes | MUST be `"open-agent-audit/v0.1"`. |
| `run_id` | string | yes | Opaque, unique within tenant. |
| `session_id` | string | no | Groups multiple runs within one user session. |
| `agent_id` | string | yes | Stable identifier for the agent. |
| `model_id` | string | yes | Model identifier; MAY be `"unknown"`. |
| `event_id` | string | yes | Unique within `run_id`. |
| `timestamp` | string | yes | RFC 3339 with timezone offset. |
| `type` | enum | yes | See §Event types. |
| `actor` | enum | yes | `agent \| user \| system \| tool \| human_reviewer`. |

## Event types

- `tool_call` — agent invoked a tool.
- `policy_decision` — the firewall/policy engine evaluated a request.
- `human_approval` — a human reviewer approved or denied an action.
- `observation` — agent received observable input (tool result, user message).
- `model_output` — model generated text or structured output.
- `final_answer` — agent's terminal output for the task.
- `error` — failure during agent execution.

## Conditional payload — `tool`

Present when `type === "tool_call"`.

| Field | Type | Required | Notes |
|---|---|---|---|
| `tool.name` | string | yes | Canonical tool name. |
| `tool.capability` | string | no | Capability the tool requires (e.g. `filesystem.write`). |
| `tool.args_hash` | string | no | Hex sha256 of canonicalized args. |
| `tool.result_hash` | string | no | Hex sha256 of canonicalized result. |
| `tool.risk_tags` | string[] | no | e.g. `["shell", "network"]`. |

## Conditional payload — `policy`

Present when `type === "policy_decision"`.

| Field | Type | Required | Notes |
|---|---|---|---|
| `policy.decision` | enum | yes | `allow \| deny \| ask_user`. |
| `policy.reason` | string | yes | Human-readable explanation. |
| `policy.rule_id` | string | no | ID of the rule that fired. |

## Conditional payload — `human`

Present when `type === "human_approval"`.

| Field | Type | Required | Notes |
|---|---|---|---|
| `human.reviewer_id` | string | yes | Stable reviewer ID. |
| `human.decision` | enum | yes | `approve \| deny \| escalate`. |
| `human.justification` | string | no | Reviewer-provided rationale. |

## Conditional payload — `error`

Present when `type === "error"`.

| Field | Type | Required | Notes |
|---|---|---|---|
| `error.kind` | string | yes | Category (e.g. `tool_failure`, `policy_violation`). |
| `error.message` | string | yes | Human-readable. |

## Evidence integrity

Optional but RECOMMENDED:

| Field | Type | Notes |
|---|---|---|
| `evidence.evidence_id` | string | Stable identifier for cross-referencing. |
| `evidence.hash` | string | Hex sha256 of canonicalized event. |
| `evidence.prev_hash` | string | Hash of previous event for chain integrity. |
| `evidence.signature` | string | Detached signature over `hash`. |
| `evidence.signature_algorithm` | enum | `ed25519 \| ecdsa-p256`. |
| `evidence.signer_key_id` | string | Public key reference. |

## AuditRun

(See [`SPEC.md`](./SPEC.md) §4 for the AuditRun object.)
