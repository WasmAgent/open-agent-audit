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
