# @openagentaudit/cli

Local developer CLI for OpenAgentAudit. Bun-first; production uses `@openagentaudit/worker`.

## Commands

```
openagentaudit validate      <trace.jsonl>
openagentaudit inventory     <trace.jsonl>
openagentaudit policy-audit  <trace.jsonl> [--profile owasp-agentic-top10-2026]
openagentaudit benchmark-audit <candidate.json> <baseline.json>
openagentaudit contamination  <trace.jsonl>
openagentaudit drift-guard    <trace.jsonl>
openagentaudit report         <trace.jsonl>
```

Commands delegate to `@openagentaudit/core` engines. All commands read
`CanonicalEvent` JSONL from stdin or a file path. AEP or bscode input is
first converted via `@openagentaudit/adapters`.

**Status:** implementing — engine wiring in progress.

## Run

```bash
bunx openagentaudit --help
```
