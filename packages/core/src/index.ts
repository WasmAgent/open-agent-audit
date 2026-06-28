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
 */

export const ENGINE_VERSION = '0.1.0-alpha.0' as const;

export { validate } from './validate/index.js';
export type { ValidationResult, Ed25519KeyRegistry } from './validate/index.js';
export { inventory } from './inventory/index.js';
export type { InventoryReport, ToolSummary, HighRiskAction, HumanApprovalRecord, CapabilitySummary } from './inventory/index.js';
export { policyAudit } from './policy-audit/index.js';
export type { PolicyAuditContext, CapabilityManifest } from './policy-audit/index.js';
export { benchmarkAudit } from './benchmark-audit/index.js';
export { contamination } from './contamination/index.js';
export { driftGuard } from './drift-guard/index.js';
export { computeRiskScore } from './scoring/index.js';
export type { AepProvenanceForScoring } from './scoring/index.js';
export { renderReport } from './report/index.js';
export type { ReportBundle, ReportMeta, ComplianceMapping } from './report/index.js';
