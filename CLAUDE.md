# CLAUDE.md — AI Agent Instructions for open-agent-audit

This file contains instructions for AI agents (Claude Code, etc.) working in this repository.

---

## Deployment rules (MANDATORY)

**Never run `wrangler deploy` locally.** All deployments go through CI.

The workflow is always:
1. Make changes
2. `git commit`
3. `git push` → triggers `.github/workflows/deploy.yml` automatically

Local `wrangler deploy` bypasses CI checks, skips the dashboard build step,
and risks deploying stale or untested code. The only exception is debugging
a wrangler config issue that cannot be diagnosed any other way — and even
then, confirm with the user first.

## Build order

When building packages, always follow this dependency order:

```
packages/schema → packages/core → packages/adapters → packages/cli
                                                     → packages/worker
packages/dashboard (independent, Vite build)
```

TypeScript builds: `npx tsc -p packages/<name>/tsconfig.json`

## Testing changes

Before pushing:
```bash
npx tsc -p packages/schema/tsconfig.json --noEmit
npx tsc -p packages/core/tsconfig.json --noEmit
npx tsc -p packages/adapters/tsconfig.json --noEmit
npx tsc -p packages/cli/tsconfig.json --noEmit
npx tsc -p packages/worker/tsconfig.json --noEmit
npx tsc -p packages/dashboard/tsconfig.json --noEmit
```

All six must pass with no errors before committing.

## Branding / deployment configuration

Branding is controlled via `wrangler.jsonc` vars — never hardcode in source:

| Var | Purpose |
|---|---|
| `ISSUER_NAME` | Organisation name in reports and UI (e.g. `"Trustavo (trustavo.com)"`) |
| `ISSUER_EMAIL` | Contact email in reports and 404 pages |
| `PUBLIC_URL` | Base URL for QR code links and report permalinks |

The `wrangler.jsonc` file is gitignored. The template is `examples/cloudflare/wrangler.example.jsonc`.
In CI, `wrangler.jsonc` is generated from the template using the `CF_D1_DATABASE_ID` secret.

## Sensitive information

Never write into any file:
- Internal hostnames, proxy addresses, or corporate network addresses
- Absolute paths with usernames (use relative paths or env vars)
- Cloudflare account IDs, API tokens, or D1 database IDs

These may appear in Bash commands (terminal only) but must never be committed.
See `CONSTRAINTS.md` for the full list.

## Key files

| File | Purpose |
|---|---|
| `packages/core/src/report/index.ts` | Report engine — all output formats (md/html/json/csv) |
| `packages/worker/src/index.ts` | Cloudflare Worker — API routes, queue handlers |
| `packages/dashboard/src/App.tsx` | React SPA dashboard |
| `packages/adapters/src/aep-v0_2.ts` | AEP v0.2 → CanonicalEvent adapter |
| `packages/adapters/src/bscode.ts` | bscode rollout → CanonicalEvent adapter |
| `examples/cloudflare/wrangler.example.jsonc` | Wrangler config template (committed) |
| `.github/workflows/deploy.yml` | CI deploy workflow |
| `.github/workflows/ci.yml` | CI typecheck + verify workflow |

## Repository Boundaries

**This repository owns:**
- AEP, OTel, and adapter ingestion (`@openagentaudit/adapters`)
- Audit evidence validation and risk scoring (`@openagentaudit/core`)
- Audit report generation (md/html/json/csv)
- Regulatory control mapping: OWASP Agentic Top 10, NIST AI RMF, ISO 42001, EU AI Act
- Trust Passport product: issuance, renewal, revocation, Trustavo integration (`@openagentaudit/passport`)
- Cloudflare Worker deployment (Trustavo)
- React dashboard

**Other repositories own — do not duplicate here:**

| Capability | Owner |
|---|---|
| AEP + compliance **schema definitions** | `wasmagent-protocol` (`@wasmagent/protocol`) |
| AEP evidence **emission** at runtime | `wasmagent-js` (`@wasmagent/aep`) |
| AgentBOM / MCP Posture / Trust Passport specifications (schemas) | `agent-trust-infra` |
| Runtime evidence collection (MCP firewall, capability attestation) | `wasmagent-js` |
| Training data pipeline (SFT/DPO export, contamination stats) | `trace-pipeline` |
| Dynamic evaluation protocol (FAEP) | `fresharena` |


## Adapter Addition Checklist (MANDATORY — CI will fail without all steps)

When adding or modifying an adapter in `packages/adapters/src/`:

**1. Create the adapter implementation file**
```
packages/adapters/src/<name>.ts
```
- Export a named function `map<Name>(input: InputType): AEPRecord`
- Import `AEPRecord` from `@open-agent-audit/schema`
- Map all required fields: `schema_version`, `run_id`, `created_at_ms`

**2. Add to `packages/adapters/src/index.ts`**
Export the new adapter:
```typescript
export { mapName } from './<name>';
```

**3. Create a test file** (required for CI to pass):
```
packages/adapters/src/<name>.test.ts
```
Pattern (copy from `langsmith.test.ts`):
```typescript
import { describe, it, expect } from 'bun:test';
import { mapName } from './<name>';

describe('<name> adapter', () => {
  it('maps required fields', () => {
    const result = mapName({ /* minimal input */ });
    expect(result.schema_version).toBeDefined();
    expect(result.run_id).toBeDefined();
    expect(result.created_at_ms).toBeGreaterThan(0);
  });
  it('rejects invalid input', () => {
    expect(() => mapName(null as any)).toThrow();
  });
});
```

**4. Build order is strict** — always build in this order:
```
packages/schema → packages/core → packages/adapters
```
TypeScript check before committing:
```bash
npx tsc -p packages/schema/tsconfig.json --noEmit
npx tsc -p packages/core/tsconfig.json --noEmit
npx tsc -p packages/adapters/tsconfig.json --noEmit
```

**5. Run tests** before pushing:
```bash
bun run test
```
Must exit 0 with all tests passing.

### Common failure modes:
- Missing export in `index.ts` → TypeScript build fails
- Test file absent → CI test step fails (bun:test finds no tests for new file)
- Missing required AEPRecord fields in output → schema validation fails at runtime
- Build order wrong → import resolution errors in packages/adapters
