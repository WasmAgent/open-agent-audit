# OpenAgentAudit — Project Constraints

This document constrains all code, documentation, reports, profiles, and
generated artifacts in OpenAgentAudit. Pull requests that violate these
constraints will be blocked by lint or rejected at review.

Every contributor — human or AI agent — must read this file before opening
a PR.

---

## 1. Phrasing constraints (lint-enforced)

`scripts/verify-disclaimers.mjs` scans all markdown, YAML, JSON, and rendered
report templates for the following forbidden phrases.

### Forbidden

- `certified compliant`
- `legally compliant`
- `regulator approved`
- `regulator-approved`
- `EU AI Act compliant`
- `ISO 42001 compliant`
- `ISO 42001 certified`
- `guarantees compliance`
- `satisfies the AI Act`
- `meets regulatory requirements`
- `legally binding evidence`
- `automatic compliance`

### Recommended

- `technical evidence support`
- `mapped evidence`
- `audit-ready trace evidence`
- `defensible technical documentation support`
- `not legal advice`
- `may support selected requirements`

### Hard requirements

- Every regulatory profile MUST include a top-level `disclaimer` field.
- Every generated report MUST include a `Limitations` section.
- Every regulatory mapping MUST include a `limitation` field per requirement.

---

## 2. Public / private boundary

### The public repository (`WasmAgent/open-agent-audit`) MAY contain

- `SPEC.md`, schemas, profiles, docs, RFCs.
- TypeScript reference implementation (`packages/*`).
- Synthetic fixtures (no real customer data).
- `wrangler.example.*` with placeholder IDs only.
- `d1-schema.sql` containing only DDL, no data.
- Sample reports generated from synthetic traces.

### The public repository MUST NOT contain

- Real customer traces, reports, screenshots, or names.
- Real `wrangler.toml` or `.dev.vars`.
- Real Cloudflare account IDs, R2 bucket IDs, D1 database IDs.
- API keys, signing private keys, webhook secrets.
- Pricing details, sales scripts, outreach lists.
- Unpublished blog drafts.
- Internal hardware model names, internal company names, internal proxy
  addresses, or personal absolute paths (`/Users/<name>/`).

Sensitive operational content belongs in the private companion repository
`WasmAgent/agentaudit-ops`.

---

## 3. Schema versioning

- Specification version follows `open-agent-audit/v{major}.{minor}.{patch}`.
- A **breaking change** requires:
  1. A new RFC in `rfcs/`.
  2. A major version bump.
  3. A migration guide in `docs/migrations/`.
  4. A deprecation window of at least 4 weeks.
- After each major release, the schema MUST be frozen for at least 6 months
  before another breaking change is accepted.
- The `AEP → OAA canonical` adapter is a versioned contract. AEP evolution
  is absorbed by the adapter; `packages/core` only consumes canonical
  evidence.

See `docs/schema-versioning.md` for the freeze gate that gates Phase 2.

---

## 4. Implementation constraints

- **TypeScript-first.** Production paths do not introduce Python.
- `packages/core` is Worker-compatible. It MUST NOT use:
  - `node:fs`, `node:path` (file-system semantics)
  - `node:child_process`, `node:os`
  - Native dependencies (`node-gyp`, `node-pre-gyp`, etc.)
  - SQLite, PostgreSQL, or other DB clients
  - Direct Cloudflare bindings (storage/index/sink interfaces are injected)
  - Node-only crypto (use Web Crypto API)
- Local development uses Bun.
- Production uses Cloudflare Workers.
- All side effects (storage, index, reporting sink) are dependency-injected.

---

## 5. Cloudflare-native constraints

- No dependency on external VPS, Cloud Run, or Kubernetes.
- Heavy tasks: chunked Queue + R2 + Durable Objects.
- PDF: Browser Run for P1; Cloudflare Containers only for enterprise heavy.
- All artifacts land in R2.
- All metadata lands in D1.
- All run state lives in a Durable Object.

---

## 6. Evidence-first constraints (lint-enforced)

`scripts/verify-evidence-ids.mjs` and `scripts/verify-spec-consistency.mjs`
enforce:

- Every `finding` object MUST include a non-empty `evidence_ids[]` array.
- Every regulatory mapping requirement MUST include a `limitation` field.
- Subjective severity language without rubric reference is forbidden.
- Every report template MUST include `Limitations` and `Methodology` sections.

---

## 7. CPU-only default path

- Default install does not require GPU.
- LLM-as-judge results are **advisory only**, never primary evidence; they
  must be labeled as such in any output.
- Vector databases are not required components.
- Embedding-based contamination is P2 and opt-in only.

---

## 8. Testing discipline

- Statistical test vectors are imported from `trace-pipeline` to guarantee
  agreement with the scipy reference implementation.
- All report templates have golden tests.
- Bun handles unit tests; Worker integration uses Miniflare / Vitest.
- Required adversarial fixtures: corrupted trace, schema-violating events,
  missing fields, forged signatures, replay attacks, chain breaks.

---

## 9. Sensitive information (inherits global rules)

- No specific hardware models (e.g. CPU/GPU SKU names).
- No internal company names or domains.
- No internal network or proxy addresses.
- No personal absolute paths (`/Users/<name>/`); use relative paths or
  `$(git rev-parse --show-toplevel)`.
- All examples use synthetic data; none derived from real customer traces.

---

## 10. Release discipline

- Releases go through changesets and npm.
- Each release records the SPEC version, schema version, and profile versions
  it ships with.
- Each generated report records: core version, schema version, profile
  versions, and generation timestamp.
- Silently-incompatible changes are forbidden.
- A package marked `stability: stable` requires major-version bumps for
  breaking changes; `alpha` and `beta` follow the same maturity scale as
  `wasmagent-js`.

---

## 11. AI agent contributors

When an AI agent (Claude Code, Codex, Cursor, etc.) edits this repository:

- Read this file before opening a PR.
- Do not relax these constraints to make tests pass.
- Do not introduce forbidden phrases into reports, even when asked to
  "make the wording stronger."
- Do not commit secrets, real customer data, or internal addresses, even
  if they appear in your prompt context.
- If a constraint blocks legitimate work, open an issue proposing an RFC
  rather than silently working around it.
