# Changelog

All notable changes to OpenAgentAudit are recorded in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The specification version (`open-agent-audit/v{major}.{minor}.{patch}`) and
the package versions evolve together but are tracked separately within each
release entry.

## [Unreleased]

### Added

**Phase 2 — core implementation**

- `@openagentaudit/schema`: Zod runtime validation alongside TypeScript types
  (`CanonicalEventSchema`, `AuditRunSchema`, `FindingSchema`, `RiskScoreSchema`,
  `parseEvents()`, `validateEvents()`).
- `@openagentaudit/adapters`: AEP v0.2 adapter (`aep-v0.2`) and bscode
  rollout-wire adapter (`bscode-rollout-v1`) implemented.
- `@openagentaudit/core`: all engines implemented — `validate` (schema + hash
  chain), `scoring` (EAS 6-component formula with AEP provenance bonus),
  `inventory` (tool/capability/approval inventory), `policy-audit` (6 rules:
  OAA-R-CAP-001/002, OAA-R-OVERSIGHT-001, OAA-R-POLICY-001/002,
  OAA-R-INTEGRITY-001), `report` (Markdown/HTML/JSON/CSV with compliance mapping
  sections, EAS explanations, AEP provenance section, decoded event IDs, EU AI
  Act Art. 26(6) retention notice).
- `@openagentaudit/cli`: all 7 commands wired — `validate`, `inventory`,
  `policy-audit`, `score`, `report`, `from-aep`, `from-bscode`.
- `@openagentaudit/worker`: Cloudflare Worker with REST API (`POST /api/v1/runs`
  auto-detects AEP JSON and JSONL, `GET` reports in 4 formats), synchronous audit
  pipeline, and AEP auto-detection pipeline.
- `@openagentaudit/dashboard`: React SPA with wouter routing (`/`, `/audit`,
  `/runs/:runId`), breadcrumbs, one-click AEP sample loading, AEP metadata cards,
  post-report EAS summary cards, and new favicon/logo.

**AEP integration**

- Real fixtures: `examples/traces/aep-wasmagent-fixture.json` (wasmagent-js@1.3.4)
  and `aep-bscode-fixture.json` (bscode@0.4.2 via `buildAEPEvidence()`), plus
  `wasmagent-js-runtime.aep.json` and `bscode-session.aep.json`.
- AEP adapter required-field validation: `validateRecord()` throws an actionable
  error naming missing fields (`run_id`, `schema_version`, `created_at_ms`,
  `signature.*`) instead of silently partial-parsing.
- `ReportMeta.aep_provenance` field carries the 8 AEP run-provenance fields
  (`repo_commit`, `runtime_version`, `policy_bundle_digest`,
  `tool_manifest_digest`, `mcp_server_card_digest`, `parent_trace_id`,
  `delegation_chain`, `model_provider`) from `getProvenance()` into the report.
- Reports render an "AEP Run Provenance" section (Markdown + HTML) when AEP
  provenance is present, citing EU AI Act Art. 12(3)(c) / Art. 19.
- Worker auto-detects AEP JSON uploads: `POST /api/v1/runs` accepts a single AEP
  JSON record (as well as JSONL) and extracts provenance without requiring
  client-side pre-conversion.
- EAS `provenance_integrity` bonus: each of the 4 AEP traceability fields
  populated adds +5 pp to the base signature score (max +20, capped at 100).
  Exported as `AepProvenanceForScoring` from `@openagentaudit/core`.

**Compliance framework coverage**

- OWASP Agentic Top 10: all 10 controls mapped (AAI01–AAI10), depth 75%.
- EU AI Act Annex IV: 13 controls mapped including Art. 12/13/14/17 and Annex IV
  Items 1–7.
- NIST AI RMF 1.0: 25 subcategories mapped (at single-run ceiling 34.7%).
- ISO/IEC 42001:2023: 16 controls mapped (at ceiling 43.2%).
- All compliance controls render with a "What this means" EAS column, actionable
  limitation text, and decoded event IDs.

**Report improvements**

- `profiles_applied` auto-populated with all 4 framework IDs.
- Art. 26(6) retention date anchored to `max(trace_end, generatedAt)`.
- EAS component table with 3 columns (score, explanation, ratios).
- `ReportMeta` fields added: `intended_use`, `deployment_context`,
  `transparency_statement`, `qms_reference`.
- `BenchmarkAuditResult` optional parameter in `renderReport()` unlocks
  MEASURE-2.9, annex-iv-testing-validation, and A.8.2.

**Testing**

- `bun:test` test suites: 18 adapter tests (`packages/adapters/src/aep-v0_2.test.ts`)
  and 7 core scoring tests (`packages/core/src/scoring/index.test.ts`), including
  `base=60 + AEP bonus` cases.
- CI installs bun via `oven-sh/setup-bun@v2`.

**Docs**

- `docs/competitive-landscape.md`: market analysis covering ATR, VerifyWise,
  Credo AI, Argus, and Asqav.
- `docs/compliance-coverage-report.md`: per-framework depth/breadth analysis,
  ceiling analysis, and upgrade paths.
- All 7 stale docs updated: CHANGELOG, README, adapter-contract,
  evidence-admission-score, RFCs, CLI README, worker README.

### Changed

- `README.md`: status table updated — all packages show `implemented`; added
  links to `docs/compliance-coverage-report.md` and
  `docs/competitive-landscape.md`.
- Stale synthetic smoke fixtures (`bscode-smoke.jsonl`, `erp-smoke.jsonl`,
  `error-recovery-smoke.jsonl`, `minimal-oaa.jsonl`, `signed-chain-smoke.jsonl`)
  removed; replaced by real AEP fixtures.
- `packages/adapters/package.json` and `packages/core/package.json` test scripts
  changed from `echo 'no tests yet'` to `bun test ./src`.
- `docs/schema-versioning.md`: removed blocking freeze-gate language to reflect
  the "implement against draft" approach.
- `docs/evidence-admission-score.md`: `provenance_integrity` scoring rewritten to
  match implementation (100/60/0 logic + AEP provenance bonus).
- `rfcs/0004-aep-adapter-contract.md`: Status Draft → Implemented; field mapping
  table corrected to actual AEP v0.2 schema; run-provenance fields documented;
  conformance fixtures section updated to real paths.
- `docs/adapter-contract.md`: Rule 4 changed from "MUST emit coverage" to
  required-field validation (MUST); coverage reporting moved to Rule 5 (SHOULD);
  fixtures section corrected to actual paths.

## [0.1.0-alpha.0] — 2026-06-26

### Added

- Initial repository scaffold: SPEC skeleton, JSON schema skeleton, profile
  placeholders, TypeScript package skeletons, Cloudflare reference deployment
  skeleton.
- `CONSTRAINTS.md` defining the project's hard rules.
- `docs/relationship-to-wasmagent.md` clarifying how OpenAgentAudit relates to
  `wasmagent-js`, `bscode`, `trace-pipeline`.
- `docs/schema-versioning.md` defining the Phase 2 freeze gate (now superseded).
