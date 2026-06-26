# Schema Versioning and Phase 2 Freeze Gate

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

## Breaking-change policy

A breaking change requires **all** of:

1. A new RFC in `rfcs/` describing the motivation, alternatives, and
   migration plan.
2. A major version bump.
3. A migration guide in `docs/migrations/v{from}-to-v{to}.md`.
4. A deprecation window of at least 4 weeks before the new major becomes
   `stable`.
5. After release, the new major remains `stable` for at least 6 months
   before another breaking change is accepted.

## The Phase 2 freeze gate

Phase 2 (TypeScript core + Worker MVP implementation) is **blocked** until
the following conditions are met. The gate covers OAA's own artifacts; it
does **not** constrain the evolution of upstream projects (`wasmagent-js`,
`bscode`, `trace-pipeline`, AEP, ComplianceEvalRecord), which continue to
iterate freely.

- **G1.** `open-agent-audit/v0.1` reaches `release-candidate` status with
  no proposed breaking changes for 4 consecutive weeks.
- **G2.** The AEP adapter contract (`docs/adapter-contract.md`) is at
  version 0.1.0 and pinned to a specific AEP minor version. The adapter,
  not AEP, is what must be stable.
- **G3.** At least 10 synthetic smoke traces are committed to
  `examples/traces/` and validate against `schemas/v0.1/canonical-event.schema.json`.
  These are **synthetic** so they do not depend on any wasmagent-js
  release cadence.
- **G4.** Either trace-pipeline test vectors are imported, OR the
  benchmark-audit statistics have their own native test vectors in
  `packages/core/benchmark-audit/__fixtures__/`. We do not block on a
  trace-pipeline release.

When all four conditions hold, the spec advances to `stable` and Phase 2
is unblocked.

There is intentionally no gate of the form "AEP must freeze" or
"wasmagent-js must reach version X." OAA is a **downstream consumer**
of those projects; it adapts to whatever they ship.

Status of each gate is tracked in the private ops repo
(`agentaudit-ops/governance/schema-freeze-decisions.md`) but the
**decision criteria** are public and live here.

## Why the gate exists

Building TypeScript engines, report templates, and a Cloudflare data model
against an unstable internal spec would generate churn within OAA itself.
The gate keeps OAA's *own* canonical model stable before we commit code
to it. AEP and other upstream formats remain free to iterate; their
changes are absorbed by versioned adapters and never reach the engines.

## Asymmetry: OAA adapts, upstream evolves

OAA has no users yet. The three main projects (`wasmagent-js`, `bscode`,
`trace-pipeline`) are in active iteration and serve concrete needs. The
correct dependency direction is:

```
wasmagent-js / bscode / trace-pipeline  (free to evolve)
        │
        ▼  (whatever they emit)
adapters/  (catch up — versioned, replaceable)
        │
        ▼
OAA canonical model  (stable interior, internal contract)
```

This document does NOT impose:

- A freeze on AEP, ComplianceEvalRecord, or any wasmagent-js schema.
- A required version for `@wasmagent/aep`.
- A coordination ritual with the main project release cadence.
- Any backpressure that slows the main projects.

If upstream ships a breaking change, OAA's response is a new adapter
version, not a complaint. The internal stable interior is OAA's problem
to maintain.

## Exceptions

A "spec-bug fix" that does not change observable behavior may land without
gating (e.g. fixing a typo, tightening a regex, clarifying a description).
These are patch-level changes.
