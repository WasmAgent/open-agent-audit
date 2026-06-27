# RFC 0004 — AEP Adapter Contract

- **Status:** Implemented
- **Date:** 2026-06-26
- **Last updated:** 2026-06-27

## Summary

Define the contract between `@wasmagent/aep` and OpenAgentAudit. AEP
records are translated into OAA canonical events by a versioned adapter.

## Motivation

AEP is in active iteration in `wasmagent-js`. OAA must not be a reason
AEP slows down. The adapter layer is the shock absorber: whenever AEP
ships a new minor or major, OAA responds with a new adapter version, not
with a request that AEP wait.

Without an adapter layer, every AEP field change would force a change in
`packages/core`. With one, the canonical model stays put.

## Detailed design

See `docs/adapter-contract.md` for the general adapter rules.

For AEP v0.2 specifically, the adapter maps as follows:

### Event mapping

| AEP v0.2 source | OAA canonical field | Notes |
|---|---|---|
| `actions[].tool_name` | `event.tool.name` | Direct |
| `actions[].capability_decision.capability` | `event.tool.capability` | Only when present |
| `actions[].input_taint_labels` + `output_taint_labels` | `event.tool.risk_tags` | Merged |
| `actions[].timestamp_ms` | `event.timestamp` | ms → ISO-8601 |
| `capability_decisions[].decision` | `event.policy.decision` | `dry_run` → `allow` |
| `capability_decisions[].reason_code` | `event.policy.reason` | Empty string when absent |
| `verifier_results[]` (failed only) | `event` type `observation` | Passed verifiers silent |
| `signature.sig` | `event.evidence.signature` + `event.evidence.hash` (first event) | Carried on every event |
| `signature.key_id` | `event.evidence.signer_key_id` | Carried on every event |
| `run_id` | `run.run_id`, `event.run_id` | |
| `model_id` | `run.model_id`, `event.model_id` | Defaults to `"unknown"` |
| `run_context.agent_id` | `run.agent_id`, `event.agent_id` | Falls back to `run_id` |

### Run-provenance fields (AEP v0.2)

The four traceability fields are extracted via `getProvenance()` and are NOT
mapped to canonical events — they are attached to `AepProvenance` / `ReportMeta`
for scoring and report rendering:

| AEP v0.2 field | Destination |
|---|---|
| `repo_commit` | `ReportMeta.aep_provenance.repo_commit` |
| `runtime_version` | `ReportMeta.aep_provenance.runtime_version` |
| `policy_bundle_digest` | `ReportMeta.aep_provenance.policy_bundle_digest` |
| `tool_manifest_digest` | `ReportMeta.aep_provenance.tool_manifest_digest` |
| `model_provider` | `ReportMeta.aep_provenance.model_provider` |
| `parent_trace_id` | `ReportMeta.aep_provenance.parent_trace_id` |
| `mcp_server_card_digest` | `ReportMeta.aep_provenance.mcp_server_card_digest` |
| `run_context.delegation_chain` | `ReportMeta.aep_provenance.delegation_chain` |

These fields are rendered in the "AEP Run Provenance" section of every report
and contribute a bonus of up to +20 to the EAS `provenance_integrity` component.

### Fields not mapped (silently dropped)

- `input_refs`, `output_refs` — no canonical equivalent yet
- `budget_ledger` — inventory data, not an event
- `run_context.environment_digest`, `dependency_lock_digest` — no canonical equivalent
- Passing verifier results — only failures emit an `observation` event

Adapter lives at `packages/adapters/src/aep-v0_2.ts`.

## Validation

The adapter validates required fields (`run_id`, `schema_version`, `created_at_ms`,
`signature.*`) before mapping. Missing required fields throw an actionable error
naming the missing fields rather than silently partial-parsing.

## Versioning

- `aep-v0.2 adapter v0.1.0` targets `open-agent-audit/v0.1` and consumes
  `@wasmagent/aep` v0.2.x.
- AEP v0.3 will get its own adapter file (`aep-v0_3.ts`) with its own
  version, mapping to whichever OAA spec is current at that time.

## Conformance fixtures

Real-world fixtures are committed under `examples/traces/`:

| File | Source | Signature |
|---|---|---|
| `aep-wasmagent-fixture.json` | `wasmagent-js@1.3.4` AEPEmitter | Ed25519, key `wasmagent-fixture-key-v1` |
| `aep-bscode-fixture.json` | `bscode@0.4.2` `buildAEPEvidence()` | Ed25519, key `bscode-aep-key-v1` |

The adapter test suite (`packages/adapters/src/aep-v0_2.test.ts`) exercises
both fixtures end-to-end. CI runs these tests on every change.

## Open questions

- Whether to ship a back-adapter (OAA → AEP) for AEP-only consumers.
  Probably not in v0.1.
