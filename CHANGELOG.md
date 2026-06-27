# Changelog

All notable changes to OpenAgentAudit are recorded in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The specification version (`open-agent-audit/v{major}.{minor}.{patch}`) and
the package versions evolve together but are tracked separately within each
release entry.

## [Unreleased]

### Added

- Phase 2 implementation: `@openagentaudit/schema` now ships Zod runtime
  validation alongside TypeScript types (`CanonicalEventSchema`, `AuditRunSchema`,
  `FindingSchema`, `RiskScoreSchema`, `parseEvents()`, `validateEvents()`).
- Phase 2 implementation: `@openagentaudit/adapters` — AEP v0.2 adapter
  (`aep-v0.2`) and bscode rollout-wire adapter (`bscode-rollout-v1`) implemented.
- Phase 2 implementation: `@openagentaudit/core` — all engines implemented:
  `validate` (schema + hash chain), `scoring` (EAS formula, 6 components),
  `inventory` (tool/capability/approval inventory), `policy-audit` (6 rules:
  OAA-R-CAP-001/002, OAA-R-OVERSIGHT-001, OAA-R-POLICY-001/002, OAA-R-INTEGRITY-001),
  `report` (Markdown/HTML/JSON/CSV renderer).
- Phase 2 implementation: `@openagentaudit/cli` — all 7 commands wired:
  `validate`, `inventory`, `policy-audit`, `score`, `report`, `from-aep`, `from-bscode`.
- Phase 2 implementation: `@openagentaudit/dashboard` — React + Tailwind SPA
  with JSONL upload, event table, EAS summary cards; deployed via Cloudflare
  Workers Static Assets.
- Phase 2 implementation: `@openagentaudit/worker` — Cloudflare Worker with
  full REST API (`POST /api/v1/runs`, `GET /api/v1/runs/:id/report`, etc.),
  synchronous audit pipeline, R2 storage for all report formats.
- AEP v0.2 adapter validation: real-world fixtures from both upstream emitters
  committed to `examples/traces/` (`aep-wasmagent-fixture.json` signed with
  `wasmagent-js@1.3.4`, `aep-bscode-fixture.json` signed with `bscode@0.4.2`
  via `buildAEPEvidence()` after `WasmAgent/bscode@17cf674`).
- AEP adapter required-field validation: `validateRecord()` throws an actionable
  error naming missing fields (`run_id`, `schema_version`, `created_at_ms`,
  `signature.*`) instead of silently partial-parsing.
- `ReportMeta.aep_provenance` field added to carry the eight AEP run-provenance
  fields (`repo_commit`, `runtime_version`, `policy_bundle_digest`,
  `tool_manifest_digest`, `mcp_server_card_digest`, `parent_trace_id`,
  `delegation_chain`, `model_provider`) from `getProvenance()` into the report.
- Reports now render an "AEP Run Provenance" section (Markdown + HTML) when
  AEP provenance is present, citing EU AI Act Art. 12(3)(c) / Art. 19.
- Worker auto-detects AEP JSON uploads: `POST /api/v1/runs` accepts a single
  AEP JSON record (as well as JSONL), converts via adapter, and extracts
  provenance without requiring client-side pre-conversion.
- EAS `provenance_integrity` bonus: each of the four AEP traceability fields
  populated adds +5 points (max +20) to the base signature score, capped at 100.
  Exported as `AepProvenanceForScoring` from `@openagentaudit/core`.
- `bun:test` test suites: `packages/adapters/src/aep-v0_2.test.ts` (18 tests
  covering both fixtures end-to-end) and `packages/core/src/scoring/index.test.ts`
  (7 tests including `base=60 + AEP bonus` cases). CI installs bun via
  `oven-sh/setup-bun@v2`.
- `packages/adapters/README.md` expanded with preserve/reject/boundary
  documentation and a fixture table.
- `docs/adapter-contract.md` updated: Rule 4 changed from "MUST emit coverage"
  to "required-field validation" (MUST); coverage reporting moved to Rule 5
  (SHOULD); fixtures section reflects actual paths.
- `docs/evidence-admission-score.md` updated: `provenance_integrity` scoring
  rewritten to match implementation (100/60/0 logic + AEP provenance bonus).
- `rfcs/0004-aep-adapter-contract.md` updated: Status Draft → Implemented;
  field mapping table corrected to match actual AEP v0.2 schema; run-provenance
  fields documented; conformance fixtures section updated to real paths.
- `.github/workflows/ci.yml` updated to install bun for adapter/core test steps.

### Changed

- `README.md` status table updated: all packages now show `implemented`.
- Stale synthetic smoke JSONL fixtures (`bscode-smoke.jsonl`, `erp-smoke.jsonl`,
  `error-recovery-smoke.jsonl`, `minimal-oaa.jsonl`, `signed-chain-smoke.jsonl`)
  removed; replaced by real AEP fixtures.
- `packages/adapters/package.json` and `packages/core/package.json` test scripts
  changed from `echo 'no tests yet'` to `bun test ./src`.
- `docs/schema-versioning.md` updated to reflect the "implement against draft"
  approach (removed blocking freeze-gate language).

## [0.1.0-alpha.0] — 2026-06-26

### Added

- Initial repository scaffold: SPEC skeleton, JSON schema skeleton, profile
  placeholders, TypeScript package skeletons, Cloudflare reference deployment
  skeleton.
- `CONSTRAINTS.md` defining the project's hard rules.
- `docs/relationship-to-wasmagent.md` clarifying how OpenAgentAudit relates to
  `wasmagent-js`, `bscode`, `trace-pipeline`.
- `docs/schema-versioning.md` defining the Phase 2 freeze gate (now superseded).
