/**
 * @openagentaudit/worker — Cloudflare Worker reference deployment.
 *
 * Status: skeleton. The worker is a thin orchestration layer over
 * @openagentaudit/core engines. Production wiring is added after the
 * Phase 2 freeze gate clears.
 */

// Bindings shape — mirrors examples/cloudflare/wrangler.example.jsonc.
export interface WorkerEnv {
  RAW_TRACES: unknown;
  ARTIFACTS: unknown;
  REPORTS: unknown;
  DB: unknown;
  AUDIT_JOBS: unknown;
  CHUNK_JOBS: unknown;
  REPORT_JOBS: unknown;
  AUDIT_RUN_COORDINATOR: unknown;
  TENANT_LIMITER: unknown;
  OAA_ENV: string;
  MAX_UPLOAD_MB: string;
  DEFAULT_PROFILES: string;
}

export default {
  async fetch(request: Request, _env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'skeleton', version: '0.1.0' }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('OpenAgentAudit worker skeleton — not implemented', { status: 501 });
  },
};

export { AuditRunCoordinator } from './durable-objects/AuditRunCoordinator.js';
export { TenantLimiter } from './durable-objects/TenantLimiter.js';
