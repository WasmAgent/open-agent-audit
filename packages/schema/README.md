# @openagentaudit/schema

TypeScript types and Zod runtime validation for the OpenAgentAudit
canonical evidence model.

The authoritative JSON schemas live at `schemas/v0.1/*.schema.json` in
the repository root. This package mirrors them as TypeScript types and
adds Zod-powered runtime validation.

## Exports

| Export | Description |
|---|---|
| `CanonicalEvent` | TypeScript type for a single trace event |
| `AuditRun` | TypeScript type for an audit run record |
| `Finding` | TypeScript type for a policy/audit finding |
| `RiskScore` | TypeScript type for EAS + ARS score output |
| `CanonicalEventSchema` | Zod schema — use for runtime parsing |
| `AuditRunSchema` | Zod schema |
| `FindingSchema` | Zod schema |
| `RiskScoreSchema` | Zod schema |
| `parseEvents(raw)` | Parse `unknown[]` → `CanonicalEvent[]`, throws on error |
| `validateEvents(raw)` | Validate `unknown[]` → `{ valid, errors }`, never throws |
| `SPEC_VERSION` | `"open-agent-audit/v0.1"` |

## Usage

\`\`\`ts
import { validateEvents, parseEvents } from '@openagentaudit/schema';

const { valid, errors } = validateEvents(rawJsonLines);
// valid: CanonicalEvent[]
// errors: Array<{ index: number; message: string }>
\`\`\`

## Constraints

Worker-compatible — no Node.js APIs. Uses Zod 3.x only.
