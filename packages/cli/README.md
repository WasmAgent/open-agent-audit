# @openagentaudit/cli

Local developer CLI for OpenAgentAudit. Bun-first; production uses `@openagentaudit/worker`.

**Status:** implemented — all commands operational.

## Commands

| Command | Input | Output |
|---|---|---|
| `validate [file]` | CanonicalEvent JSONL | Validation summary; exits 1 on errors |
| `inventory [file]` | CanonicalEvent JSONL | InventoryReport JSON |
| `policy-audit [file] [--manifest <json>] [--profile <id>]` | CanonicalEvent JSONL | Findings list; exits 1 on critical/high |
| `score [file]` | CanonicalEvent JSONL | Evidence Admission Score JSON |
| `report [file] [--format md\|html\|json\|csv] [--meta <json>]` | CanonicalEvent JSONL | Full audit report |
| `from-aep [file]` | AEP v0.2 JSON record | CanonicalEvent JSONL (stdout) |
| `from-bscode [file]` | bscode RolloutWireRecord JSON | CanonicalEvent JSONL (stdout) |

All commands read from a file path or stdin when no file is given. `validate`,
`inventory`, `policy-audit`, `score`, and `report` expect `CanonicalEvent` JSONL.
`from-aep` and `from-bscode` read a single source-format JSON record and emit
`CanonicalEvent` JSONL to stdout, ready to pipe into any of the analysis commands.

## AEP support

`from-aep` accepts a single **AEP v0.2 JSON record** (object, not JSONL). The
adapter converts it to one or more `CanonicalEvent` lines on stdout.

```bash
openagentaudit from-aep record.json
```

The input must be valid JSON. The AEP record is validated against the AEP v0.2
schema during conversion; any missing required fields will produce an error.

### Direct ingest via the worker

If you are sending traces to the hosted worker at `trustavo.com`, you do not
need the `from-aep` CLI step. The worker accepts AEP JSON directly:

```
POST /api/v1/runs
Content-Type: application/json

<AEP v0.2 JSON record>
```

The worker runs the adapter internally, stores the canonical events, and returns
a run ID. Use the CLI `from-aep` command only when you want to inspect or
process the canonical events locally before submitting.

## Pipe examples

### from-aep → report

Convert an AEP trace and produce a full HTML audit report in one pipeline:

```bash
openagentaudit from-aep record.json | openagentaudit report --format html > report.html
```

Produce a Markdown report with custom metadata:

```bash
openagentaudit from-aep record.json \
  | openagentaudit report --format md \
      --meta '{"issuer":"Acme Corp","prepared_by":"Jane Smith","source_files":["record.json"]}'
```

### from-bscode → policy-audit

Convert a bscode rollout record and run a policy audit with a capability manifest:

```bash
openagentaudit from-bscode rollout.json \
  | openagentaudit policy-audit \
      --manifest '{"declared_capabilities":["web_search"],"high_risk_capabilities":["code_execution"],"denied_capabilities":[]}'
```

Run against a specific compliance profile:

```bash
openagentaudit from-bscode rollout.json \
  | openagentaudit policy-audit --profile eu-ai-act-2025
```

## Run

```bash
bunx openagentaudit --help
```
