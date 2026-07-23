# Milestones

## Milestone 1: Canonical Evidence Schema and Validation

### Deliverables
- [ ] Implement canonical event schemas for tool calls, policy decisions, human approvals, benchmark results, training manifests, and runtime traces.
- [ ] Add schema versioning support for `aepV0_2` events with strict validation rules.
- [ ] Implement `validateEvents(raw)` to parse unknown input and return valid events plus structured validation errors.
- [ ] Add fixture-based tests for valid, invalid, partial, and mixed evidence payloads.
- [ ] Add JSON Schema export support for external integrators.
- [ ] Implement migration helpers for upgrading older event payloads to the current schema.

## Milestone 2: Audit Core Pipeline

### Deliverables
- [ ] Implement `validate(events)` to run integrity checks and produce a cryptographic summary.
- [ ] Implement tool and permission inventory reconstruction from runtime trace events.
- [ ] Add policy boundary violation detection for unauthorized tools, excessive permissions, and missing approvals.
- [ ] Implement benchmark claim auditing with paired evidence checks.
- [ ] Implement `computeRiskScore(events, runId)` with configurable risk weights.
- [ ] Add unit tests covering risk scoring, policy violations, and evidence integrity failures.
- [ ] Refactor core pipeline outputs into stable typed result objects.

## Milestone 3: Report Rendering and Export

### Deliverables
- [ ] Implement `renderReport(events, findings, score)` to generate HTML, Markdown, JSON, and CSV bundles.
- [ ] Add report sections for evidence summary, risk score, findings, framework coverage, and open risks.
- [ ] Implement deterministic report IDs and content hashes for generated reports.
- [ ] Add template tests to verify report output structure across all supported formats.
- [ ] Implement redaction utilities for sensitive evidence fields before rendering.
- [ ] Add export fixtures for auditor-facing sample reports.

## Milestone 4: Adapter Integrations

### Deliverables
- [ ] Implement adapter normalization for OpenTelemetry traces.
- [ ] Implement adapter normalization for Langfuse events.
- [ ] Implement adapter normalization for LangSmith runs.
- [ ] Add adapter conformance tests to verify output matches canonical event schemas.
- [ ] Implement adapter error handling for malformed, incomplete, and unsupported source payloads.
- [ ] Add example ingestion scripts for each supported adapter.
- [ ] Refactor adapter shared mapping logic into reusable typed utilities.

## Milestone 5: Trust Passport and Cloudflare Deployment

### Deliverables
- [ ] Implement `issue`, `renew`, `revoke`, and `status` APIs for `@openagentaudit/passport`.
- [ ] Add passport validity window, framework coverage, evidence quality, and open risk fields.
- [ ] Implement hash-linked passport attestation metadata with `signing_method: "none"`.
- [ ] Add REST endpoints for `/passport/issue`, `/passport/:id`, `/passport/:id/revoke`, and `/passport/:id/status`.
- [ ] Add Cloudflare Worker route tests for passport issue, fetch, revoke, and status flows.
- [ ] Implement persistent passport storage using Cloudflare-native bindings.
- [ ] Add deployment checks for Trustavo production configuration.