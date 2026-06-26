# Mapping Methodology

This document describes how OpenAgentAudit maps technical evidence to
regulatory and security frameworks. It explains what a mapping is, what
it is not, and how mappings are reviewed.

## What a mapping is

A mapping is a declarative statement of the form:

> "Evidence of type `X` collected during agent runtime **may support**
> requirement `Y` of framework `Z`, subject to the limitations stated
> in the mapping."

The mapping is **interpretive**. It does not establish that the evidence
**satisfies** the requirement; only a qualified human reviewer (or in some
frameworks, an accredited certification body) can make that determination.

## What a mapping is not

A mapping is **not**:

- A legal opinion.
- A certification of compliance.
- A guarantee of acceptance by any regulator, court, or auditor.
- A determination that the requirement has been satisfied.

## Anatomy of a mapping

Each regulatory profile entry contains:

```yaml
- id: <control-id>
  label: <framework-readable label>
  evidence:
    - <evidence type 1>
    - <evidence type 2>
  tests:
    - <audit test 1>
    - <audit test 2>
  limitation: <plain-language description of what this mapping does NOT establish>
```

- `id` — the canonical identifier in the source framework (e.g.
  `annex-iv-risk-management`).
- `label` — the framework's own description, paraphrased.
- `evidence` — types of canonical evidence the test consumes.
- `tests` — names of audit tests that produce findings against this control.
- `limitation` — **required**. Must state what the mapping does not cover.

A profile entry without a `limitation` field is non-conformant and is
rejected by `scripts/verify-disclaimers.mjs`.

## Review process

Each profile entry is reviewed by at least one person familiar with the
source framework. Reviews record:

1. The version of the source framework consulted.
2. The interpretation chosen when the source is ambiguous.
3. Alternative interpretations that were considered and rejected, with
   reasoning.

Reviews live in `rfcs/` so they are public and citable.

## Conflict between frameworks

When two frameworks address overlapping topics with different language,
OpenAgentAudit keeps **separate mappings** rather than collapsing them.
A finding may map to entries in multiple profiles; each mapping carries
its own `limitation`.

## Version coupling

A regulatory profile carries a version in its filename (e.g.
`owasp-agentic-top10-2026.yaml`). When the upstream framework releases a
new version, a new profile file is added with the new version suffix; the
old profile is preserved for traceability of past audits.

## What this methodology cannot fix

- Frameworks themselves are sometimes ambiguous; mappings inherit that
  ambiguity.
- Some controls are organizational rather than technical; tooling cannot
  produce evidence for them.
- New attack categories may emerge faster than profile updates; the
  threat taxonomy is the leading edge, the regulatory profiles trail.
