# RFC 0005 — Finding Severity Rubric

- **Status:** Draft
- **Date:** 2026-06-26

## Summary

Define a documented rubric for assigning severity to findings.
Severity is not an LLM-judgement; it is a deterministic function of
the threat category and the observed outcome.

## Motivation

Subjective severities make findings non-reproducible and hard to defend.
Reviewers cannot ask "why is this 'high' instead of 'medium'?" without a
rubric.

## Rubric

See `docs/threat-taxonomy.md` for the full taxonomy and decision tree.

Summary:

- `critical` — sensitive effect realized (network egress with PII tag,
  destructive write, signature failure, hash chain break).
- `high` — capability boundary crossed but blocked, OR oversight bypass
  attempted, OR benchmark claim contradicted by paired statistics.
- `medium` — anomaly or pattern match without realized harm.
- `low` — single recovered failure, minor protocol drift.
- `info` — observational note, no recommendation required.

## Enforcement

`scripts/verify-spec-consistency.mjs` checks that:

- Every `severity` value in profiles or rules is one of the five levels.
- Every finding has a category that maps to a taxonomy entry.
- Every rule documents which severity it can produce.

## Alternatives

- CVSS-derived scores — rejected as a poor fit for agent runtime risks
  (CVSS is vulnerability-shaped).
- LLM-judge severity — rejected as unreproducible.
- Numeric severity (0..10) — rejected because reviewers prefer the
  5-level ordinal.
