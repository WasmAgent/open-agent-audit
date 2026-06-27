# Adapter Contract

Adapters transform source-format records into OpenAgentAudit canonical events.

## Adapter interface

```ts
import type { CanonicalEvent, AuditRun } from '@openagentaudit/schema';

export interface SourceFormatAdapter<TSource> {
  /** The source format this adapter handles, e.g. "aep-v0.2". */
  readonly id: string;

  /** Version of this adapter's contract. */
  readonly version: string;

  /** Bind run-level metadata before consuming events. */
  beginRun(input: TSource): AuditRun;

  /** Map one source record into zero or more canonical events. */
  toEvents(record: TSource): CanonicalEvent[];

  /** Optional: finalize the run when the source is exhausted. */
  finalizeRun?(run: AuditRun): AuditRun;
}
```

## Adapter rules

### 1. No fabrication

If a field is not present in the source, the adapter MUST NOT invent it.
Missing data is represented by:

- Omitting the field (when optional in the canonical schema).
- Using a documented `unknown` placeholder (e.g. `model_id = "unknown"`).
- Recording the omission so the EAS scorer can deduct.

### 2. Versioned coupling

Each adapter declares a version pinned against a source-format version:

```ts
export const AepV0_2Adapter = {
  id: 'aep-v0.2',
  version: '0.1.0',
  // ...
};
```

Source-format upgrades require a new adapter version with a documented
mapping change.

### 3. Deterministic event IDs

Event IDs MUST be deterministic given the same source record. Adapters
MUST NOT use random IDs or timestamps as IDs.

A typical strategy: derive `event_id` from `sha256(source_record_id || canonical_position)`.

### 4. Required-field validation

Adapters MUST validate required fields before mapping. Missing required
fields MUST throw an actionable error that names the missing fields — not
a silent partial parse that produces incomplete events.

Example error format:
```
AEP adapter: missing required fields [run_id, signature.sig]. Ensure the
AEPRecord was produced by a compliant emitter (aep/v0.2).
```

### 5. Coverage reporting

Adapters SHOULD document which canonical fields they populate and which
they leave empty. The `AdapterCoverage` interface is available for this
purpose but is not yet required by the scoring engine:

```ts
export interface AdapterCoverage {
  source_records_total: number;
  events_emitted: number;
  fields_populated: Record<string, number>;
  fields_missing: Record<string, number>;
  notes: string[];
}
```

### 6. No side effects

Adapters MUST be pure. They MUST NOT:

- Call out to network.
- Read files outside their input parameter.
- Write to logs (logging is the engine's job).
- Mutate the source record.

## Versioning relationship

```
AEP v0.2          ─────► aep-v0.2 adapter v0.1
                          ─────►  open-agent-audit/v0.1

AEP v0.3 (future) ─────► aep-v0.3 adapter v0.2
                          ─────►  open-agent-audit/v0.1   (still!)
```

The canonical model is stable. Adapter versions absorb source changes.

## Conformance test fixtures

Adapter fixtures live under `examples/traces/` (real-world records) and
`packages/adapters/src/` (test files):

| Adapter | Fixture | Test file |
|---|---|---|
| `aep-v0.2` | `examples/traces/aep-wasmagent-fixture.json`, `examples/traces/aep-bscode-fixture.json` | `packages/adapters/src/aep-v0_2.test.ts` |

CI runs adapter tests (`bun test ./src` in `packages/adapters`) on every change.
