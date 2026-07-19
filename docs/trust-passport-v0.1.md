# Trust Passport v0.1 Specification

> Canonical specification for the Trust Passport schema. This document lives in
> `open-agent-audit` and supersedes any earlier references in `agent-trust-infra`.

## 1. Schema Overview

A `TrustPassport` is a machine-readable attestation of an AI agent's audit posture
at a point in time.

```
TrustPassport
├── passport_version: "0.1"
├── identity            — who the passport belongs to
├── agentbom_ref?       — link to the agent's bill of materials
├── audit_ref?          — link to the audit report
├── posture_ref?        — link to the MCP posture snapshot
├── evidence_summary?   — framework coverage + evidence quality
├── risk_summary?       — finding counts by severity
├── validity            — issued_at, expires_at, renewal_triggers
├── revocation          — revoked flag, reason, triggers
├── attestation         — issuer, signing_method, hash, signature
└── evidence_facts?     — content-addressed evidence store
```

All timestamps are ISO 8601 UTC (ending in `Z`).

## 2. Expiry vs Revocation Semantics

| Concept    | Meaning                                   |
|------------|-------------------------------------------|
| Expiry     | Stale-but-was-valid. The passport aged out without incident. |
| Revocation | Was-valid-but-now-untrusted. An active determination that the passport should no longer be relied upon. |

**Revocation takes precedence.** When a passport is both expired and revoked the
effective status is `revoked`.

## 3. Renewal Triggers

A passport SHOULD be renewed when any of the following occur:

1. **AgentBOM changes** — new tools, capabilities, or dependencies added/removed.
2. **New high/critical finding** — a post-issuance audit surfaces severe issues.
3. **MCP posture drift** — the live posture snapshot diverges from the snapshot at issuance.
4. **Audit report update** — the underlying audit report is regenerated.
5. **Deployment context change** — the agent moves to a new environment or trust boundary.

Renewal produces a new passport with a fresh `passport_id`; the previous passport
remains valid until its own expiry (unless explicitly revoked).

## 4. Revocation Triggers

A passport MUST be revoked when:

1. **Critical security finding post-issuance** — a vulnerability or control failure
   discovered after the passport was issued.
2. **Falsified evidence** — any evidence referenced by the passport is found to be
   fabricated or materially inaccurate.
3. **Agent decommissioned** — the agent is permanently retired.
4. **Issuer determination** — the issuing authority determines the passport should
   no longer be trusted for any other reason.

## 5. `isExpired()` Contract

```ts
function isExpired(passport: TrustPassport): boolean
```

- Returns `true` when `validity.expires_at` is in the past.
- Returns `false` when `expires_at` is absent or undefined.
- Does **NOT** check revocation status. Callers must check `revocation.revoked`
  separately or use `status()` for the combined determination.

## 6. Relationship to AgentBOM and Audit Report

| Field         | Purpose                                          |
|---------------|--------------------------------------------------|
| `agentbom_ref`| Content-addressed pointer to the AgentBOM snapshot used during issuance. Includes `agentbom_id`, `agentbom_hash`, `captured_at`. |
| `audit_ref`   | Pointer to the audit report that produced the evidence backing this passport. Includes `report_id`, `report_hash`, `generated_at`. |
| `posture_ref` | Pointer to the MCP posture snapshot captured at issuance time. Includes `snapshot_id`, `snapshot_hash`, `captured_at`. |

These references allow downstream consumers to trace the passport back to its
source evidence without embedding the full payloads.

## 7. Evidence Facts

The optional `evidence_facts` field provides a content-addressed store for
individual evidence items:

```ts
evidence_facts?: Record<string, {
  content_hash: string;   // "sha256:<hex>"
  recorded_at: string;    // ISO 8601 UTC
}>
```

Use `hashEvidence(content)` to produce deterministic `sha256:<hex>` hashes and
`addFact(passport, factId, content)` to append entries.

## 8. Canonical Home

This specification lives at `docs/trust-passport-v0.1.md` in the
[open-agent-audit](https://github.com/WasmAgent/open-agent-audit) repository.
Any references to this spec in other repositories (including `agent-trust-infra`)
should point here.
