# @openagentaudit/cli

Local developer CLI for OpenAgentAudit. Bun-first; production uses `@openagentaudit/worker`.

**Status:** implemented — all commands operational.

## Commands

```
openagentaudit validate      <trace.jsonl>
openagentaudit inventory     <trace.jsonl>
openagentaudit policy-audit  <trace.jsonl> [--manifest <json>] [--profile <id>]
openagentaudit score         <trace.jsonl>
openagentaudit report        <trace.jsonl> [--format md|html|json|csv] [--meta <json>]
openagentaudit from-aep      <record.json>
openagentaudit from-bscode   <record.json>
```

Commands delegate to `@openagentaudit/core` engines. `validate`, `inventory`,
`policy-audit`, `score`, and `report` read `CanonicalEvent` JSONL from stdin or
a file path. `from-aep` and `from-bscode` read a single source-format JSON record
and emit `CanonicalEvent` JSONL to stdout.

### from-aep

Converts an AEP v0.2 JSON record directly to canonical event JSONL:

```bash
openagentaudit from-aep examples/traces/aep-wasmagent-fixture.json
# pipe into report
openagentaudit from-aep record.json | openagentaudit report --format html > report.html
```

## Run

```bash
bunx openagentaudit --help
```

