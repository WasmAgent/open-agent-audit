# Milestones

## Milestone 1: Canonical Evidence Schema and Validation

### Deliverables
- [x] Implement canonical event schemas for tool calls, policy decisions, human approvals, benchmark results, training manifests, and runtime traces.
- [x] Add schema versioning support for `aepV0_2` events with strict validation rules.
- [x] Implement `validateEvents(raw)` to parse unknown input and return valid events plus structured validation errors.
- [x] Add fixture-based tests for valid, invalid, partial, and mixed evidence payloads.
- [x] Add JSON Schema export support for external integrators.
- [x] Implement migration helpers for upgrading older event payloads to the current schema.

## Milestone 2: Audit Core Pipeline

### Deliverables
- [x] Implement `validate(events)` to run integrity checks and produce a cryptographic summary.
- [x] Implement tool and permission inventory reconstruction from runtime trace events.
- [x] Add policy boundary violation detection for unauthorized tools, excessive permissions, and missing approvals.
- [x] Implement benchmark claim auditing with paired evidence checks.
- [x] Implement `computeRiskScore(events, runId)` with configurable risk weights.
- [x] Add unit tests covering risk scoring, policy violations, and evidence integrity failures.
- [x] Refactor core pipeline outputs into stable typed result objects.

## Milestone 3: Report Rendering and Export

### Deliverables
- [x] Implement `renderReport(events, findings, score)` to generate HTML, Markdown, JSON, and CSV bundles.
- [x] Add report sections for evidence summary, risk score, findings, framework coverage, and open risks.
- [x] Implement deterministic report IDs and content hashes for generated reports.
- [x] Add template tests to verify report output structure across all supported formats.
- [x] Implement redaction utilities for sensitive evidence fields before rendering.
- [x] Add export fixtures for auditor-facing sample reports.

## Milestone 4: Adapter Integrations

### Deliverables
- [x] Implement adapter normalization for OpenTelemetry traces.
- [x] Implement adapter normalization for Langfuse events.
- [x] Implement adapter normalization for LangSmith runs.
- [x] Add adapter conformance tests to verify output matches canonical event schemas.
- [x] Implement adapter error handling for malformed, incomplete, and unsupported source payloads.
- [x] Add example ingestion scripts for each supported adapter.
- [x] Refactor adapter shared mapping logic into reusable typed utilities.

## Milestone 5: Trust Passport and Cloudflare Deployment

### Deliverables
- [x] Implement `issue`, `renew`, `revoke`, and `status` APIs for `@openagentaudit/passport`.
- [x] Add passport validity window, framework coverage, evidence quality, and open risk fields.
- [x] Implement hash-linked passport attestation metadata with `signing_method: "none"`.
- [x] Add REST endpoints for `/passport/issue`, `/passport/:id`, `/passport/:id/revoke`, and `/passport/:id/status`.
- [x] Add Cloudflare Worker route tests for passport issue, fetch, revoke, and status flows.
- [x] Implement persistent passport storage using Cloudflare-native bindings.
- [x] Add deployment checks for Trustavo production configuration.

## Milestone 6 — Continuous Monitoring & Alerting

- [ ] Implement scheduled audit runner with configurable cadence (hourly/daily/weekly) per monitoring profile
- [ ] Add alerting integration for Slack, webhooks, and email notifications on risk score threshold breaches
- [ ] Implement drift detection between consecutive audits to flag permission escalations, new tool usage, and policy changes
- [ ] Add dashboard API for querying audit history, risk trends, and open finding counts over time
- [ ] Implement baseline snapshot comparison to detect regressions in framework coverage and evidence quality
- [ ] Add configurable alert rules with severity tiers and suppression windows for benign drift
- [ ] Implement evidence retention policies with automatic pruning and archival for historical audit data
- [ ] Add multi-project monitoring support with unified org-wide risk rollup views
- [ ] Implement CI/CD integration harness for automated audits on deploy/publish events
- [ ] Add alert rate limiting and de-duplication to prevent notification fatigue from batch findings
