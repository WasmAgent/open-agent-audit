# Runtime Assurance

Operational model for the WasmAgent runtime assurance program (post-static-freeze).
The authoritative plan lives outside the repository; this document records the
model, the current truth, and the contracts runtime tooling asserts.

## Status

```text
R0 exact deployment identity          CLOSED
R0.5 deployment toolchain             CLOSED
R1 production smoke                   READY (PR merge gated on D1 quota recovery)
R2 dependency fault injection         NOT STARTED (local harness in progress)
R3 concurrency / recovery / region    NOT STARTED
R4 runtime release provenance         NOT RUN
R5 sustained / external evidence      NOT RUN
```

`release_provenance` remains `not_run` until a real relayed runtime artifact
exists (R4). A schema, a validator, or closed R0 gates do not upgrade it.

## Gates

```text
R0   deployment identity      live build SHA == deployed GitHub SHA
R0.5 deployment toolchain     pinned wrangler/bun; no runtime installs; full config understood
R1   production smoke         read-only probes + synthetic canary transaction in production
R2   dependency fault injection  D1 / KV / R2 / Queue / DO under deterministic failures
R3   concurrency / recovery / multi-region
R4   runtime release provenance
R5   sustained / external evidence
```

Do not collapse gates into a single boolean. Each gate closes on its own
machine-readable evidence.

## Evidence classes

```text
PASS       observed and asserted
FAIL       observed and violated
PARTIAL    some scenarios passed, some failed or were skipped
NOT_RUN    never executed
UNKNOWN    observed state could not be determined (treated as NOT pass)
```

## Runtime finding classes

```text
R-A   deployment identity mismatch
R-B   unsafe fail-open
R-C   atomicity / race failure
R-D   eventual-consistency exposure
R-E   recovery / retry non-idempotency
R-F   provenance-only gap
R-G   secure fail-closed availability failure
```

**R-G does not mean "healthy". R-G means the system remained secure while
unavailable.** An R-G finding still carries an availability cost and is tracked
until capacity or behaviour is restored (see
[runbooks/d1-quota-exhaustion.md](runbooks/d1-quota-exhaustion.md)).

## Authentication / read matrix

Normative contract asserted by the R1 production smoke; the smoke derives its
expectations from the live `GET /health` `auth_mode` and records which contract
it asserted.

```text
Mode           Anonymous SPA reads     Writes     Org risk rollup
--------------------------------------------------------------------
open           allowed                 allowed*   allowed
api_key        allowed (TI-05b)        auth       auth
fail_closed    denied                  denied     denied
multi_tenant   auth                    auth       auth
```

- `*` `open` exists only outside production; production resolves principals
  fail-closed when no auth material is configured.
- In single-tenant API-key mode, public SPA reads are a **documented product
  decision and are not treated as an authentication bypass** (regression test
  `TI-05b`, contract documented at `resolvePrincipal`). Writes and the
  cross-project org-risk-rollup require the bearer key in every mode.
- Passport trust artifacts are publicly readable by design
  (`GET /passport/:id`, `GET /passport/:id/status`); all Passport **writes**
  (issue / revoke / renew) are authenticated.

## Canary data lifecycle

Production smoke and future R2 exercises use synthetic canaries only. Rules:

```text
- every canary identifier begins with rt-  (runs: rt-<timestamp>-<nonce>,
  agents: rt-canary-<nonce>)
- canary data never contains customer identifiers or real traces
- canary artifacts redact credentials (hard scan before write)
- a revoked canary Passport is left REVOKED as terminal evidence
- canary cleanup failure never rewrites an original smoke verdict
```

Lifecycle states: `created → completed → cleanup_pending → cleaned |
cleanup_failed`. Enough metadata (workflow run, canary ids, source SHA,
timestamps, verdict) is retained in the smoke artifact to correlate evidence
without keeping customer data.

Cleanup policy: synthetic transient payloads may be deleted after evidence
capture; machine-readable smoke artifacts follow Actions retention; minimal D1
canary rows may be kept (rt- tagged) for diagnosis — cleanup must not consume
production D1 quota during an exhaustion window.
