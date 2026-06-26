# @openagentaudit/core

Worker-compatible audit engines.

**Status:** alpha skeleton. Implementation is blocked on the Phase 2
freeze gate; see [`docs/schema-versioning.md`](../../docs/schema-versioning.md).

This package is **Worker-compatible** and MUST NOT use:

- `node:fs`, `node:path`, `node:child_process`, `node:os`
- SQLite/Postgres clients
- Cloudflare bindings directly (interfaces are injected)
- Node-only crypto (use Web Crypto API)
- Native dependencies

See [`CONSTRAINTS.md`](../../CONSTRAINTS.md) §4.

## Engines

| Module | Purpose |
|---|---|
| `validate` | Schema and integrity checks |
| `inventory` | Tool / capability / data inventory |
| `policy-audit` | Rule engine against capability manifest |
| `benchmark-audit` | Paired statistics over benchmark pairs |
| `contamination` | MinHash / LSH overlap detection |
| `drift-guard` | Statistical drift between windows |
| `scoring` | EAS + ARS |
| `report` | Markdown / HTML / JSON renderer |
