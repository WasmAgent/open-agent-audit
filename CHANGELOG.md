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
- Phase 2 implementation: `@openagentaudit/core` — all 5 engines implemented:
  `validate` (schema + hash chain), `scoring` (EAS formula, 6 components),
  `inventory` (tool/capability/approval inventory), `policy-audit` (6 rules:
  OAA-R-CAP-001/002, OAA-R-OVERSIGHT-001, OAA-R-POLICY-001/002, OAA-R-INTEGRITY-001),
  `report` (Markdown/HTML/JSON renderer).
- Phase 2 implementation: `@openagentaudit/cli` — all 7 commands wired:
  `validate`, `inventory`, `policy-audit`, `score`, `report`, `from-aep`, `from-bscode`.
- Phase 2 implementation: `@openagentaudit/dashboard` — React + Tailwind SPA
  with JSONL upload, event table, EAS summary cards; deployed via Cloudflare
  Workers Static Assets.
- Phase 2 implementation: `@openagentaudit/worker` — Cloudflare Worker with
  REST API, Queue consumer (full audit pipeline), Durable Objects
  (AuditRunCoordinator, TenantLimiter).
- Added synthetic smoke traces: `signed-chain-smoke.jsonl`, `error-recovery-smoke.jsonl`.
- Added `.github/workflows/ci.yml` and `.github/workflows/deploy.yml`.
- `docs/schema-versioning.md` updated to reflect the "implement against draft"
  approach (removed blocking freeze-gate language).

### Changed

- `README.md` status table updated to reflect Phase 2 progress.

## [0.1.0-alpha.0] — 2026-06-26

### Added

- Initial repository scaffold: SPEC skeleton, JSON schema skeleton, profile
  placeholders, TypeScript package skeletons, Cloudflare reference deployment
  skeleton.
- `CONSTRAINTS.md` defining the project's hard rules.
- `docs/relationship-to-wasmagent.md` clarifying how OpenAgentAudit relates to
  `wasmagent-js`, `bscode`, `trace-pipeline`.
- `docs/schema-versioning.md` defining the Phase 2 freeze gate (now superseded).
