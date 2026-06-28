# Schema Versioning

## Versioning scheme

OpenAgentAudit uses a three-part version on the specification:

```
open-agent-audit/v{major}.{minor}.{patch}
```

- **major** — breaking changes (field removal, type change, semantic change).
- **minor** — backward-compatible additions (new optional field, new enum value).
- **patch** — clarifications, documentation fixes, schema bug fixes.

Package versions in `packages/*` follow standard semver and are aligned via
changesets `linked: [['@openagentaudit/*']]`.

## Spec lifecycle

Each spec version moves through the following states:

| State | Description |
|---|---|
| `draft` | Active development; fields may change without notice. |
| `release-candidate` | Frozen during a 4-week review window; only fixes accepted. |
| `stable` | Released; breaking changes require a new major version. |
| `deprecated` | Superseded by a newer major; bug fixes only. |

The current state of each version is recorded in `schemas/index.json`.

## Implementation approach

OAA implements against the current `draft` spec rather than waiting for
a freeze gate. This is safe because of the adapter layer:

```
wasmagent-js / bscode / trace-pipeline  (free to evolve)
        │
        ▼  (whatever they emit)
adapters/  (versioned, replaceable — absorbs upstream changes)
        │
        ▼
OAA canonical model  (stable interior — only OAA engines depend on this)
```

If the canonical model needs a breaking change before reaching `stable`,
a new adapter version absorbs the delta. The audit engines stay unchanged.

This document does NOT impose:

- A freeze on AEP, ComplianceEvalRecord, or any wasmagent-js schema.
- A required version for `@wasmagent/aep`.
- A coordination ritual with the main project release cadence.
- Any backpressure that slows the main projects.

## Breaking-change policy

A breaking change to the canonical model requires **all** of:

1. A new RFC in `rfcs/` describing the motivation, alternatives, and
   migration plan.
2. A major version bump.
3. A migration guide in `docs/migrations/v{from}-to-v{to}.md`.
4. A deprecation window of at least 4 weeks before the new major becomes
   `stable`.
5. After release, the new major remains `stable` for at least 6 months
   before another breaking change is accepted.

## Exceptions

A "spec-bug fix" that does not change observable behavior may land without
a full RFC (e.g. fixing a typo, tightening a regex, clarifying a description).
These are patch-level changes.

---

## Current version

The canonical schema currently in production is **`open-agent-audit/v0.1`** (status: `stable`).

All `CanonicalEvent` records written to R2 and D1 carry
`"schema_version": "open-agent-audit/v0.1"` as their top-level identifier.
All `Finding` records written by the audit engines use the same version string.

The D1 `audit_runs` table also records the version in `schema_version` for
each run, enabling version-filtered queries as new majors are introduced.

## What changes between versions

### Minor version (e.g. v0.1 → v0.2)

- New **optional** fields may be added to `CanonicalEvent`, `Finding`, or `RiskScore`.
- New enum values may be added to existing string-union fields.
- No existing field is removed or renamed.
- No semantic meaning of an existing field changes.
- Engines that do not recognise a new optional field silently ignore it — the
  record is still valid and scores unchanged.

### Major version (e.g. v0.x → v1.0)

- One or more fields may be removed, renamed, or have their type changed.
- A semantic meaning of an existing field may change.
- All five steps in the **Breaking-change policy** section above must be
  followed before a new major reaches `stable`.

### Patch version

- Schema documentation is corrected.
- A regex constraint is tightened to close an unintentional gap.
- No observable behaviour change for well-formed records.

## Migration policy — old events remain valid

Events stored under an older minor version remain fully valid until the **next
major version** is released and the older major enters `deprecated` state.

Once a major is `deprecated`:

- The corresponding adapter is frozen (no new features, security fixes only).
- Events written under that major can still be _read_ and _scored_ for a
  minimum of **6 months** after `deprecated` status is assigned.
- After that window, support may be dropped in a subsequent major bump.

This means a deployment that has not been updated will continue to accept and
score legacy events without loss of data or audit continuity throughout the
deprecation window.

## How adapters handle version differences

Each adapter in `packages/adapters/` is responsible for mapping an external
event format to the current canonical model:

```
external format (AEP v0.2, bscode rollout, …)
        │
        ▼
adapter (packages/adapters/src/<name>.ts)
        │   - reads the external schema_version field
        │   - maps to CanonicalEvent with schema_version = 'open-agent-audit/v0.1'
        │   - drops unknown fields; fills missing optional fields with undefined
        ▼
CanonicalEvent[]  →  audit engines (validate / inventory / policyAudit / computeRiskScore)
```

Adapter versioning rules:

1. **One adapter per external format family** — `aep-v0_2.ts` covers AEP
   schema_version `aep/v0.1` and `aep/v0.2` (backward-compatible reads).
2. **When the canonical model gets a new minor**, adapters are updated to
   populate the new optional fields if the upstream data carries them; old
   adapters that do not populate the new fields remain valid.
3. **When the canonical model gets a new major**, a new adapter version is
   created (e.g. `aep-v0_2-to-oaa-v2.ts`). The old adapter is kept and
   continues to emit v1 records until the v1 deprecation window closes.
4. **Unknown external fields** are never passed through to the canonical
   model; they are silently discarded. This prevents accidental schema
   pollution across version boundaries.
5. **The `schema_version` field on the emitted `CanonicalEvent` always
   reflects the canonical model version**, not the external format version,
   so downstream consumers can rely on a single version axis.
