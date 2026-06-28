# Audit your first AI agent trace in 5 minutes

This guide walks you through submitting an agent trace to OpenAgentAudit and reading the resulting report.

---

## Prerequisites

- [Bun](https://bun.sh) v1.0+ **or** Node.js v18+ with `tsx` installed
- The repository cloned locally and dependencies installed:

  ```sh
  bun install
  # or: npm install
  ```

---

## Step 1 — Obtain a trace

An agent trace is a newline-delimited JSON (JSONL) file where every line is one `CanonicalEvent`.

A ready-to-use example is included at:

```
examples/traces/golden-trace.jsonl
```

It contains 7 events covering the full happy-path lifecycle:
`policy_decision` → `tool_call (read)` → `observation` → `tool_call (write)` →
`human_approval` → `observation` → `final_answer`.

To use your own trace, produce a `.jsonl` file following the
`open-agent-audit/v0.1` schema (see `packages/schema/`).

---

## Step 2 — Run the CLI locally

```sh
bun packages/cli/src/main.ts audit examples/traces/golden-trace.jsonl
```

Optional: pass a capability manifest to enable undeclared-capability checks:

```sh
bun packages/cli/src/main.ts audit examples/traces/golden-trace.jsonl \
  --manifest examples/enterprise-agent-audit/sample-manifest.json
```

The CLI prints a Markdown report to stdout and exits with code `0` (pass) or `1` (findings).

---

## Step 3 — POST to the production API

The API accepts the same JSONL file via HTTP.

**Demo mode (no auth required):**

```sh
curl -X POST "https://trustavo.com/api/v1/runs" \
  -H "Content-Type: application/x-ndjson" \
  -H "x-source-file: golden-trace.jsonl" \
  --data-binary @examples/traces/golden-trace.jsonl
```

**With an API key (when your deployment requires auth):**

```sh
curl -X POST "https://trustavo.com/api/v1/runs" \
  -H "Authorization: Bearer ${OAA_API_KEY}" \
  -H "Content-Type: application/x-ndjson" \
  -H "x-source-file: golden-trace.jsonl" \
  --data-binary @examples/traces/golden-trace.jsonl
```

The response body contains the `run_id` assigned to this submission, for example:

```json
{ "run_id": "golden-run-001", "status": "queued" }
```

See `examples/enterprise-agent-audit/curl-examples.sh` for a ready-to-run script.

---

## Step 4 — Read the report

Once processing completes (usually under 5 seconds), open the public report page:

```
https://trustavo.com/r/<run_id>
```

Replace `<run_id>` with the value returned in Step 3, e.g.:

```
https://trustavo.com/r/golden-run-001
```

The page shows the full audit report — EAS grade, findings, evidence chain, and a
downloadable PDF. No login is required for reports produced in demo mode.

You can also fetch the report as JSON:

```sh
curl "https://trustavo.com/api/v1/runs/golden-run-001/report"
```

---

## Step 5 — Interpret the findings

### EAS grade

The **Enterprise Audit Score (EAS)** is a letter grade (A–F) summarising the overall
trust posture of the run:

| Grade | Meaning |
|-------|---------|
| A | No findings; all capabilities declared and approved |
| B | Minor informational findings only |
| C | At least one medium-severity finding |
| D | At least one high-severity finding |
| F | Critical finding or evidence-chain break |

### Key rule: OAA-R-CAP-001

**Undeclared capability usage** — an agent invoked a tool whose capability was not
listed in the manifest submitted at run time.

- **Trigger:** a `tool_call` event references a `capability` value absent from
  `declared_capabilities` in the manifest.
- **Severity:** HIGH (downgrades EAS to D or below).
- **Remediation:** add the capability to the agent's manifest before deployment,
  or remove the tool call if it was unintended.

In the golden trace, `file_write` is declared as a high-risk capability and is
gated by a `human_approval` event — this is the correct pattern and produces no
OAA-R-CAP-001 finding.

### Evidence chain

Every event includes an `evidence` block with a SHA-256 hash chained to the
previous event (`prev_hash`). The auditor verifies this chain; a broken chain
(mismatched hash) triggers a **CRITICAL** finding and an F grade regardless of
other results.
