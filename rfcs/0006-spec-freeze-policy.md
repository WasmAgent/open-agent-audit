# RFC 0006 — Spec Freeze Policy

- **Status:** Draft
- **Date:** 2026-06-26

## Summary

Specifications progress through `draft → release-candidate → stable →
deprecated`. Breaking changes require a new major version and a 4-week
deprecation window. After a major release, the spec is frozen for at
least 6 months before another breaking change is accepted.

## Motivation

Without a freeze policy, audit reports become unreproducible as the spec
shifts. Auditors and customers need to cite a stable version of the
specification.

## Lifecycle states

| State | Allowed changes | Duration |
|---|---|---|
| `draft` | Any | Until release-candidate |
| `release-candidate` | Patch-level only; no behavior change | 4 weeks |
| `stable` | Patch-level only; minor additions allowed (backward-compatible) | At least 6 months |
| `deprecated` | Patch-level only; bug fixes | Until removed |

## Promotion rules

`draft → release-candidate`:
- All Phase 0–1 deliverables complete.
- All `[STUB]` markers removed.
- At least one external review on the canonical event schema.

`release-candidate → stable`:
- 4 weeks elapsed since RC declaration.
- No breaking-change proposals open.
- At least 10 conformance fixtures pass.

`stable → deprecated`:
- A successor major is `stable`.
- A migration guide is published.

## Breaking changes

A breaking change requires:
1. RFC.
2. Major version bump.
3. Migration guide.
4. 4-week deprecation window.
5. 6-month dwell time on the new major before the next breaking change.

## Patch-level changes (allowed during stable)

- Typo fixes in spec text.
- Tightening of regex patterns that reject previously-invalid data.
- Clarifying language that doesn't change validation behavior.
- Adding optional fields with documented defaults.

## Open questions

- Whether to publish schemas at a versioned URL hosted on Cloudflare
  Pages (`schemas.openagentaudit.org/v0.1/...`). Probably yes after the
  first stable release.
