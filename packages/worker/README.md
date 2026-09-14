# @openagentaudit/worker

Cloudflare Worker reference deployment for OpenAgentAudit.

A thin orchestration layer over `@openagentaudit/core` engines.
Storage bindings (R2, D1, Queues, Durable Objects) are injected via `WorkerEnv`.

**Status:** implemented — deployed at [trustavo.com](https://trustavo.com).

## API

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/runs` | Upload a trace and run the full audit pipeline |
| `GET` | `/api/v1/runs` | List recent runs |
| `GET` | `/api/v1/runs/:runId` | Get run metadata |
| `GET` | `/api/v1/runs/:runId/findings` | Get findings for a run |
| `GET` | `/api/v1/runs/:runId/report?format=md\|html\|json\|csv` | Get rendered report |
| `GET` | `/api/v1/config` | Site branding config for the SPA |

### Upload formats

`POST /api/v1/runs` accepts two formats:

- **JSONL** (`CanonicalEvent` records, one per line) — standard OAA format. Lines
  that cannot be parsed as JSON generate an `OAA-P-001` finding instead of being
  silently dropped.
- **AEP JSON** (a single `AEPRecord`) — the worker auto-detects `schema_version`
  values `aep/v0.1` through `aep/v0.5`, converts via the adapter, and extracts
  run-provenance for scoring and report rendering. No pre-conversion needed.

**Current supported contract: `aep/v0.5`.** Legacy `aep/v0.2` documents are
handled through the explicit legacy adapter path; they are never silently
normalized or "inverse-downgraded" to the current contract.

Every direct `POST /api/v1/runs` response immediately writes the run metadata and
findings to D1, so the run appears in `GET /api/v1/runs` without delay.

### Contract layers — do not conflate

Upload parsing and adapter conversion prove **parsing** only. They do not by
themselves prove:

- **semantic conformance** — canonical schema/contract validation of the record,
- **authenticity / DSSE** — verification of signatures or an in-toto/DSSE envelope,
- **capture completeness** — that the trace contains every event the runtime was
  expected to emit.

Each layer is reported independently; a successful upload must not be read as
proof of the others.

## Engine notes

### Contamination risk
The `contamination_risk_inverted` EAS component requires a training event set to compute a real score. In the single-upload API (`POST /api/v1/runs`), no training set is available, so this component always returns a **neutral score (100)**. The rendered report includes a disclosure note. To evaluate real contamination risk, call `contamination()` from `@openagentaudit/core` separately and pass the result to `computeRiskScore()`.

### Drift guard
The `driftGuard` engine compares two time windows and requires two separate event sets. It is not wired into the single-upload API. Use it programmatically via the `@openagentaudit/core` CLI or by calling `driftGuard(windowA, windowB)` directly.

## Architecture

```
HTTP / Queue message
        │
        ▼
  Worker fetch/queue handler
        │
        ├── @openagentaudit/adapters  (AEP auto-detection + conversion)
        ├── @openagentaudit/core      (run engines)
        └── R2 / D1 / DO             (store results)
```

## Bindings (wrangler.jsonc)

| Binding | Type | Purpose |
|---|---|---|
| `RAW_TRACES` | R2 | Incoming trace uploads |
| `ARTIFACTS` | R2 | Intermediate engine artifacts |
| `REPORTS` | R2 | Final audit report bundles |
| `DB` | D1 | Runs, findings, projects, **approvals**, evidence metadata |
| `PASSPORTS` | KV | Immutable passport issuances and external revocation/status records (see "Passport signing truth") |
| `APPROVALS` | KV | **Deprecated** — approval state now lives in D1 (`approvals` table) |
| `AUDIT_JOBS` | Queue | Async audit job dispatch |
| `AUDIT_RUN_COORDINATOR` | DO | Per-run state coordination |
| `TENANT_LIMITER` | DO | Per-tenant rate limiting |
| `ALERT_GATEKEEPER` | DO (optional) | Alert de-duplication / rate cap |

## Environment vars (wrangler.jsonc `vars`)

| Var | Required | Default | Purpose |
|---|---|---|---|
| `OAA_ENV` | yes | — | Runtime environment label (`production`, `staging`, etc.) |
| `MAX_UPLOAD_MB` | yes | `100` | Maximum trace upload size |
| `DEFAULT_PROFILES` | yes | — | Comma-separated compliance profiles |
| `ISSUER_NAME` | yes | — | Organisation name in reports and UI |
| `ISSUER_EMAIL` | yes | — | Contact email in reports and 404 pages |
| `PUBLIC_URL` | yes | — | Base URL for QR code links and report permalinks |
| `CORS_ORIGIN` | no | `*` | Allowed CORS origin (e.g. `https://app.example.com`); defaults to wildcard |
| `API_KEY` | no | (unset) | Shared secret for write/decision endpoints and the org risk rollup. Unset + `OAA_ENV=production` **fails closed** |
| `TENANT_ID` | no | `default` | Tenant this single-tenant deployment serves. Never taken from a request header |
| `TENANT_API_KEYS` | no | (unset) | JSON `{ "<key>": "<tenant>" }` map. When set, every tenant surface requires a Bearer key and the key selects the tenant |
| `REPORT_VISIBILITY` | no | `public` | `private` requires the Bearer key on `/r/:id` report links |

### Authentication and tenant isolation

Tenant identity is resolved **only** from authentication material — never from
`X-Tenant-Id` or a query parameter. In single-tenant mode, list/detail/report and
dashboard reads are deliberately public (the same-origin SPA renders them) and
are always scoped to `TENANT_ID`; writes, approval decisions, passport
issue/revoke/renew and `GET /api/v1/dashboard/org-risk-rollup` require the key.
In multi-tenant mode (`TENANT_API_KEYS`) every tenant surface requires a key. A
production deployment with no auth material fails closed (`401`, and `/health`
reports `auth_mode: fail_closed`).

### Passport signing truth

The Worker calls `issue()` and `createRevocationRecord()` **without a signer**.
The Worker deployment path is therefore:

```text
immutable issuance (attestation.signing_method: "none")
+ separate external registry status record (unsigned)
```

Concretely:

- `GET /passport/:id/status` reports `issuance_authenticity: "not-present"` for
  Worker-issued passports — an *absent* assertion is never reported as an
  invalid one.
- The Worker owns the status registry, so it marks that registry as trusted and
  treats an unsigned revocation record stored there as authoritative. A verifier
  that does not trust the registry reports the status as `unknown`.
- Renewal mints a **new** immutable issuance (new `passport_id`,
  `identity.renewed_from` lineage, fresh attestation) and never mutates the
  stored issuance in place. A passport already signed with `ed25519` cannot be
  renewed by the Worker without a configured signer.
- Do not describe the Worker deployment path as cryptographically signed until
  production signing/key resolution is actually wired.

## References

- [`docs/cloudflare-native.md`](../../docs/cloudflare-native.md) — deployment architecture
- [`examples/cloudflare/wrangler.example.jsonc`](../../examples/cloudflare/wrangler.example.jsonc) — config template
- [`examples/cloudflare/d1-schema.sql`](../../examples/cloudflare/d1-schema.sql) — D1 schema

