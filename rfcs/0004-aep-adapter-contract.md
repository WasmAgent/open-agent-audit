# RFC 0004 — AEP Adapter Contract

- **Status:** Draft
- **Date:** 2026-06-26

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

For AEP specifically:

| AEP v0.2 field | OAA canonical field |
|---|---|
| `record_id` | `event_id` |
| `run_id` | `run_id` |
| `actor.type` | `actor` |
| `action.kind = "tool_call"` | `type = "tool_call"`, `tool.*` |
| `action.kind = "policy_decision"` | `type = "policy_decision"`, `policy.*` |
| `evidence.hash` | `evidence.hash` |
| `evidence.signature` | `evidence.signature` |
| `evidence.prev_hash` | `evidence.prev_hash` |
| `timestamp` | `timestamp` |

Adapter lives at `packages/adapters/src/aep-v0_2.ts`.

## Versioning

- `aep-v0.2 adapter v0.1.0` targets `open-agent-audit/v0.1` and consumes
  `@wasmagent/aep` v0.2.x.
- AEP v0.3 will get its own adapter file (`aep-v0_3.ts`) with its own
  version, mapping to whichever OAA spec is current at that time.

## Conformance fixtures

`packages/adapters/fixtures/aep-v0.2/`:
- `input.aep.jsonl`
- `expected-events.jsonl`
- `coverage.json`

CI runs the adapter against these fixtures on every change.

## Open questions

- Whether to ship a back-adapter (OAA → AEP) for AEP-only consumers.
  Probably not in v0.1.
