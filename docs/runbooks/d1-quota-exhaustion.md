# Runbook — D1 quota exhaustion

Operational runbook for the free-tier D1 daily row-read/write limit being
exhausted on a production deployment.

## Detection

Known provider evidence (from `wrangler tail`):

```text
D1_ERROR: Your account has exceeded D1's free tier daily row read limit.
Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.
```

Symptoms:

```text
- D1-backed endpoints intermittently return 500 (or structured 503 once
  dependency normalization ships)
- non-D1 routes (e.g. /health, static assets) remain healthy
- R1 synthetic transaction cannot complete
- the failure flips between success and failure between requests
  (soft enforcement near the quota boundary)
```

## Classification

```text
Runtime class:     R-G (secure fail-closed availability failure)
Security posture:  fail-closed — no data exposure, no authorization change
Availability:      degraded until quota reset or capacity upgrade
```

R-G means the system remained **secure while unavailable**; it does not mean
healthy. Track availability recovery separately from security posture.

## Immediate response

```text
1. Do not relax authentication.
2. Do not bypass D1 ownership/status checks.
3. Do not treat the KV mirror as an authoritative replacement for D1.
4. Pause R1 (or other production-probing) closure — the smoke fails closed.
5. Do not repeatedly probe production D1 "to see if quota came back";
   every attempt consumes the remaining quota and pollutes evidence.
6. Wait for the UTC-midnight reset or move the account to paid/expanded D1.
```

## Recovery sequence

After the quota window:

```text
1. GET /health                    — service up
2. verify exact live build SHA    — R0 identity still holds
3. verify auth_mode               — expected deployment posture
4. perform ONE minimal D1 read    — quota really reset (not repeated probing)
5. run the local R1 preflight once
6. only then merge the R1 PR (e.g. #303)
7. observe the full deploy: R0 identity + R1 smoke
8. inspect the runtime-smoke artifact (verdicts, canary ids, SHA equality)
```

## Escalation

If quota appears reset but D1 still fails:

```text
- classify as a runtime dependency outage (do not merge the R1 PR)
- collect wrangler tail evidence with the exact D1_ERROR strings
- keep the R1 PR open; do not weaken any gate to force it green
```
