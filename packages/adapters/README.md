# @openagentaudit/adapters

Source-format adapters that map external trace formats into the
OpenAgentAudit canonical event model.

**Status:** alpha skeleton. Implementation begins after the schema
freeze gate clears.

| Adapter | Source format | File |
|---|---|---|
| `aep-v0.2` | `@wasmagent/aep` v0.2 | `src/aep-v0_2.ts` |
| `compliance-eval-record-v0.1` | `@wasmagent/compliance` records | `src/compliance-eval-record.ts` |
| `bscode-rollout-v0.1` | bscode rollout JSONL | `src/bscode.ts` |
| `otel-genai-v0.1` | OpenTelemetry GenAI spans | `src/otel.ts` |
| `langfuse-export-v0.1` | Langfuse trace export | `src/langfuse.ts` |
| `langsmith-export-v0.1` | LangSmith trace export | `src/langsmith.ts` |

See [`docs/adapter-contract.md`](../../docs/adapter-contract.md) for the
adapter rules.
