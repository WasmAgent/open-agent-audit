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
| `compliance-eval-record-v0.1` | `@wasmagent/compliance` records | `src/compliance-eval-record.ts` | skeleton |
| `otel-genai-v0.1` | OpenTelemetry GenAI spans | `src/otel.ts` | skeleton |
| `langfuse-export-v0.1` | Langfuse trace export | `src/langfuse.ts` | skeleton |
| `langsmith-export-v0.1` | LangSmith trace export | `src/langsmith.ts` | skeleton |

## Usage

\`\`\`ts
import { aepV0_2, bscode } from '@openagentaudit/adapters';

// AEP v0.2
const run = aepV0_2.AepV0_2Adapter.beginRun(aepRecord);
const events = aepV0_2.AepV0_2Adapter.toEvents(aepRecord);

// bscode rollout
const run = bscode.BscodeAdapter.beginRun(rolloutRecord);
const events = bscode.BscodeAdapter.toEvents(rolloutRecord);
\`\`\`

## Mapping

```
AEPRecord.actions[]          → CanonicalEvent type:"tool_call"
AEPRecord.capability_decisions[] → CanonicalEvent type:"policy_decision"
AEPRecord.verifier_results[] (failed) → CanonicalEvent type:"observation"

RolloutWireRecord.tool_call_sequence[] → CanonicalEvent type:"tool_call" / "observation"
RolloutWireRecord.final_answer  → CanonicalEvent type:"final_answer"
RolloutWireRecord.build_result  → CanonicalEvent type:"observation" source:"build_verifier"
```
