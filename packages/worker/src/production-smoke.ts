/**
 * R1 — production smoke (WasmAgent runtime assurance).
 *
 * Pure logic behind the production smoke runner (`scripts/production-smoke.ts`):
 * canary identity construction, the synthetic trace, verdict aggregation, and
 * the `runtime-smoke.json` artifact. Kept dependency-free so the smoke
 * semantics (R1-RO-01..05 + the synthetic Passport transaction) stay
 * unit-testable; the CLI owns all network and D1 access.
 *
 * Single-tenant deployments (API_KEY) exercise tenant isolation as far as the
 * deployment model allows: every write surface requires the bearer key and
 * foreign/unknown objects are non-enumerable (404). True cross-tenant
 * isolation smokes require a multi-tenant deployment (TENANT_API_KEYS) and are
 * recorded as `not_run`, never as a silent pass.
 */

import type { DeploymentIdentityCheck } from './deployment-identity.js';

// ---------------------------------------------------------------------------
// Canary identity
// ---------------------------------------------------------------------------

export interface CanaryIds {
  /** Synthetic audit run id, e.g. `rt-20260914T120000Z-a1b2c3`. */
  runId: string;
  /** Synthetic agent id, e.g. `rt-canary-a1b2c3`. */
  agentId: string;
  nonce: string;
}

function nonce(now: Date): string {
  return now.getTime().toString(36).slice(-6);
}

function stamp(now: Date): string {
  // "2026-09-14T12:00:00.000Z" → "20260914T120000Z"
  return `${now.toISOString().replace(/[-:.]/g, '').slice(0, 15)}Z`;
}

/** `rt-` prefix marks every synthetic object so operators can spot canaries. */
export function newCanaryIds(now: Date = new Date()): CanaryIds {
  const n = nonce(now);
  return {
    runId: `rt-${stamp(now)}-${n}`,
    agentId: `rt-canary-${n}`,
    nonce: n,
  };
}

/**
 * Minimal valid canonical trace (open-agent-audit/v0.1) for the synthetic
 * run: one benign tool call. Exercise the full ingestion pipeline (R2 + D1)
 * without touching any real customer data.
 */
export function syntheticTrace(runId: string, agentId: string, now: Date = new Date()): string {
  const base = {
    schema_version: 'open-agent-audit/v0.1',
    run_id: runId,
    session_id: `rt-session-${runId}`,
    agent_id: agentId,
    model_id: 'runtime-canary-model',
    timestamp: now.toISOString(),
  };
  const events = [
    {
      ...base,
      event_id: `${runId}-evt-1`,
      type: 'tool_call',
      actor: 'agent',
      tool: { name: 'canary.read', capability: 'read', args_hash: 'ca11ary' },
    },
    {
      ...base,
      event_id: `${runId}-evt-2`,
      type: 'final_answer',
      actor: 'agent',
    },
  ];
  return events.map((event) => JSON.stringify(event)).join('\n');
}

// ---------------------------------------------------------------------------
// Smoke results
// ---------------------------------------------------------------------------

/** One recorded check/operation. Reuses the R0 check shape. */
export type SmokeCheck = DeploymentIdentityCheck;

export interface SmokeOperation {
  id: string;
  method: string;
  path: string;
  /** `-` when the operation is a local D1 verification. */
  expected: string;
  actual: string;
  pass: boolean;
  detail?: string;
  at: string;
}

export interface SmokeVerdicts {
  deployment_identity: 'pass' | 'fail';
  read_only_smoke: 'pass' | 'fail';
  synthetic_transaction: 'pass' | 'fail';
  /** `not_run` when no D1 credential/database was provided. */
  d1_state_verification: 'pass' | 'fail' | 'not_run';
}

export interface RuntimeSmokeArtifact {
  format: 'wasmagent-runtime-smoke/v1';
  repository: string;
  source_sha: string;
  deployment_target: string;
  observed: {
    health_status: string | null;
    environment: string | null;
    auth_mode: string | null;
    build_sha: string | null;
  };
  synthetic: {
    tenant: string;
    run_id: string | null;
    agent_id: string;
    passport_id: string | null;
  };
  operations: SmokeOperation[];
  verdicts: SmokeVerdicts;
  observed_at: string;
}

/** True when every recorded operation passed. */
export function operationsPass(operations: SmokeOperation[]): boolean {
  return operations.length > 0 && operations.every((op) => op.pass);
}

export function buildSmokeVerdicts(
  operations: SmokeOperation[],
  d1: { enabled: boolean; unauthorized?: boolean },
): SmokeVerdicts {
  // A phase passes only when it actually ran (non-empty) and every recorded
  // operation passed — an absent phase must fail closed, never pass vacuously.
  const byId = (id: string): boolean => {
    const phase = operations.filter((op) => op.id.startsWith(id));
    return phase.length > 0 && phase.every((op) => op.pass);
  };

  // A transport-level authorization failure (deploy token without D1 API
  // scope) is an infrastructure gap: direct-SQL evidence is not_run (never a
  // silent pass, never a false fail), and the authoritative app-surface
  // transitions (TX-07b/08/09) remain the D1 evidence of record.
  const d1NotRun = !d1.enabled || d1.unauthorized === true;

  return {
    deployment_identity: byId('R1-DEP') ? 'pass' : 'fail',
    read_only_smoke: byId('R1-RO') ? 'pass' : 'fail',
    synthetic_transaction: byId('R1-TX') ? 'pass' : 'fail',
    d1_state_verification: d1NotRun ? 'not_run' : byId('R1-D1') ? 'pass' : 'fail',
  };
}

/** Defense in depth: the artifact must never carry the smoke credential. */
export function containsSecret(artifact: RuntimeSmokeArtifact, secrets: string[]): boolean {
  const serialized = JSON.stringify(artifact);
  return secrets.some((secret) => secret !== '' && serialized.includes(secret));
}
