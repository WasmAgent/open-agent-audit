# @openagentaudit/adapters

Source-format adapters that map external trace formats into the
OpenAgentAudit canonical event model.

Each adapter is a versioned pure function: `(source) → CanonicalEvent[]`.
Adapters never fabricate data and never call out to the network.
See [`docs/adapter-contract.md`](../../docs/adapter-contract.md) for the full contract.

## Adapters

| Adapter id | Source format | File | Status |
|---|---|---|---|
| `aep-v0.2` | `@wasmagent/aep` AEPRecord (aep/v0.2) | `src/aep-v0_2.ts` | **implemented** |
| `bscode-rollout-v1` | bscode RolloutWireRecord | `src/bscode.ts` | **implemented** |
| `compliance-eval-record-v0.1` | `@wasmagent/compliance` records | `src/compliance-eval-record.ts` | **implemented** |
| `otel-genai-v0.1` | OpenTelemetry GenAI spans | `src/otel.ts` | **implemented** |
| `langfuse-export-v0.1` | Langfuse trace export | `src/langfuse.ts` | **implemented** |
| `langsmith-export-v0.1` | LangSmith trace export | `src/langsmith.ts` | **implemented** |

## Usage

```ts
import { aepV0_2, bscode } from '@openagentaudit/adapters';

// AEP v0.2
const run = aepV0_2.AepV0_2Adapter.beginRun(aepRecord);
const events = aepV0_2.AepV0_2Adapter.toEvents(aepRecord);

// Extract run-provenance metadata and attach to ReportMeta
const prov = aepV0_2.getProvenance(aepRecord);
const meta: ReportMeta = { ..., aep_provenance: prov };

// bscode rollout
const run = bscode.BscodeAdapter.beginRun(rolloutRecord);
const events = bscode.BscodeAdapter.toEvents(rolloutRecord);
```

## AEP v0.2 adapter — what is preserved, what is rejected, where the boundary is

### What the adapter preserves

| AEP field | Canonical field | Notes |
|---|---|---|
| `actions[].tool_name` | `event.tool.name` | Direct mapping |
| `actions[].capability_decision.capability` | `event.tool.capability` | Only when present |
| `actions[].input_taint_labels` + `output_taint_labels` | `event.tool.risk_tags` | Merged into single array |
| `capability_decisions[].decision` | `event.policy.decision` | `dry_run` → `allow` (closest semantic) |
| `capability_decisions[].reason_code` | `event.policy.reason` | Empty string when absent |
| `verifier_results[]` (failed only) | `event` type `observation` | Passed verifiers are silent |
| `signature.sig` / `signature.key_id` | `event.evidence.signature` / `signer_key_id` | Carried on every event |
| `run_id`, `model_id`, `run_context.agent_id` | `run.run_id`, `run.model_id`, `run.agent_id` | Via `beginRun()` |
| `repo_commit`, `runtime_version`, `policy_bundle_digest`, `tool_manifest_digest` | `AepProvenance` struct | Via `getProvenance()` |

### What is rejected (silently dropped)

- `input_refs`, `output_refs` — not yet mapped to a canonical field
- `budget_ledger` — inventory data, not an event
- `run_context.environment_digest`, `dependency_lock_digest` — no canonical equivalent yet
- Passing verifier results — only failures emit an `observation` event

### Schema mismatch boundary

The adapter accepts both `aep/v0.1` and `aep/v0.2` records. Missing required fields
(`run_id`, `schema_version`, `created_at_ms`, `signature.*`) cause an actionable error
rather than a silent partial parse:

```
AEP adapter: missing required fields [run_id]. Ensure the AEPRecord was
produced by a compliant emitter (aep/v0.2).
```

## Mapping

```
AEPRecord.actions[]               → CanonicalEvent type:"tool_call"
AEPRecord.capability_decisions[]  → CanonicalEvent type:"policy_decision"
AEPRecord.verifier_results[] (failed only) → CanonicalEvent type:"observation"

RolloutWireRecord.tool_call_sequence[] → CanonicalEvent type:"tool_call" / "observation"
RolloutWireRecord.final_answer    → CanonicalEvent type:"final_answer"
RolloutWireRecord.build_result    → CanonicalEvent type:"observation" source:"build_verifier"
```

## Test fixtures

Real-world AEPRecord fixtures from both upstream emitters are committed under
[`examples/traces/`](../../examples/traces/):

| File | Source | Key fields |
|---|---|---|
| `aep-wasmagent-fixture.json` | `wasmagent-js@1.3.4` — signed with Ed25519 | 2 actions, 1 cap-decision, 2 verifier results (1 failed), all 4 traceability fields |
| `aep-bscode-fixture.json` | `bscode@0.4.2` via `buildAEPEvidence()` — signed with Ed25519 | 2 actions, 1 cap-decision, 1 verifier result (passed), all 4 traceability fields via `resolveRunProvenance()` |

The adapter test suite (`src/aep-v0_2.test.ts`) exercises both fixtures end-to-end and
asserts canonical-event output shape, taint propagation, provenance extraction, and
error messages for invalid inputs.

