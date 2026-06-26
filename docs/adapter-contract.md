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

### 4. Coverage reporting

Adapters MUST emit a coverage summary describing which canonical fields
were populated and which were left empty. The scoring engine uses this
to compute the trace_completeness component of EAS.

```ts
export interface AdapterCoverage {
  source_records_total: number;
  events_emitted: number;
  fields_populated: Record<keyof CanonicalEvent, number>;
  fields_missing: Record<keyof CanonicalEvent, number>;
  notes: string[];
}
```

### 5. No side effects

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

Every adapter MUST ship with conformance fixtures in
`packages/adapters/fixtures/<source-id>/`:

- `input.<source-format>` — source records.
- `expected-events.jsonl` — expected canonical output.
- `coverage.json` — expected coverage summary.

Fixtures are run in CI on every change to the adapter.
