/**
 * @openagentaudit/core — Worker-compatible audit engines.
 *
 * This package MUST NOT import:
 *   - node:fs, node:path, node:child_process, node:os
 *   - SQLite/Postgres clients
 *   - Cloudflare bindings (interfaces are injected)
 *   - Node-only crypto (use Web Crypto API)
 *   - native dependencies
 *
 * See CONSTRAINTS.md §4.
 *
 * Status: alpha skeleton. Implementation is blocked on the Phase 2
 * freeze gate; see docs/schema-versioning.md.
 */

export const ENGINE_VERSION = '0.1.0-alpha.0' as const;

// Engines are implemented per `docs/architecture.md` Layer 3.
// They are stubbed here so the workspace builds.

export { validate } from './validate/index.js';
export { inventory } from './inventory/index.js';
export { policyAudit } from './policy-audit/index.js';
export { benchmarkAudit } from './benchmark-audit/index.js';
export { contamination } from './contamination/index.js';
export { driftGuard } from './drift-guard/index.js';
export { computeRiskScore } from './scoring/index.js';
export { renderReport } from './report/index.js';
