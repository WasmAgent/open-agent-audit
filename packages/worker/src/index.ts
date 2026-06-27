/**
 * @openagentaudit/worker — Cloudflare Worker reference deployment.
 *
 * A thin orchestration layer over @openagentaudit/core engines.
 * Storage bindings (R2, D1, Queues, DO) are injected via WorkerEnv.
 */

import {
  validate,
  inventory,
  policyAudit,
  computeRiskScore,
  renderReport,
} from '@openagentaudit/core';
import type { PolicyAuditContext, ReportMeta } from '@openagentaudit/core';
import { validateEvents } from '@openagentaudit/schema';
import type { CanonicalEvent, Finding, RiskScore } from '@openagentaudit/schema';

// ---------------------------------------------------------------------------
// Job message shapes
// ---------------------------------------------------------------------------

export interface AuditJobMessage {
  run_id: string;
  tenant_id: string;
  r2_key: string;
  profiles: string[];
  manifest?: {
    declared_capabilities: string[];
    high_risk_capabilities: string[];
    denied_capabilities: string[];
  };
}

export interface ChunkJobMessage {
  run_id: string;
  tenant_id: string;
  r2_key: string;
  chunk_index: number;
  chunk_total: number;
}

export interface ReportJobMessage {
  run_id: string;
  tenant_id: string;
  format: 'md' | 'html' | 'json';
}

// ---------------------------------------------------------------------------
// WorkerEnv — mirrors examples/cloudflare/wrangler.example.jsonc
// ---------------------------------------------------------------------------

export interface WorkerEnv {
  RAW_TRACES: R2Bucket;
  ARTIFACTS: R2Bucket;
  REPORTS: R2Bucket;
  DB: D1Database;
  AUDIT_JOBS: Queue<AuditJobMessage>;
  CHUNK_JOBS: Queue<ChunkJobMessage>;
  REPORT_JOBS: Queue<ReportJobMessage>;
  AUDIT_RUN_COORDINATOR: DurableObjectNamespace;
  TENANT_LIMITER: DurableObjectNamespace;
  OAA_ENV: string;
  MAX_UPLOAD_MB: string;
  DEFAULT_PROFILES: string;
  ASSETS: Fetcher;
}

// ---------------------------------------------------------------------------
// CORS helpers
// ---------------------------------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function corsJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
  });
}

function corsError(message: string, status: number): Response {
  return corsJson({ error: message }, status);
}

// ---------------------------------------------------------------------------
// Routing helpers
// ---------------------------------------------------------------------------

/** Extract a named capture from a URL pathname using a simple pattern. */
function matchRoute(
  pathname: string,
  pattern: RegExp,
): RegExpExecArray | null {
  return pattern.exec(pathname);
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleGetRuns(env: WorkerEnv): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT run_id, agent_id, model_id, created_at, eas_score, eas_grade, finding_count
     FROM audit_runs
     ORDER BY created_at DESC
     LIMIT 50`,
  ).all();
  return corsJson({ runs: result.results });
}

async function handleGetRun(runId: string, env: WorkerEnv): Promise<Response> {
  const row = await env.DB.prepare(
    'SELECT * FROM audit_runs WHERE run_id = ?',
  )
    .bind(runId)
    .first();
  if (row === null) {
    return corsError('Run not found', 404);
  }
  return corsJson({ run: row });
}

async function handleGetFindings(runId: string, env: WorkerEnv): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT * FROM findings WHERE run_id = ? ORDER BY severity DESC LIMIT 100`,
  )
    .bind(runId)
    .all();
  return corsJson({ findings: result.results });
}

async function handleGetReport(
  runId: string,
  format: string,
  env: WorkerEnv,
): Promise<Response> {
  const validFormats = new Set(['md', 'html', 'json']);
  const fmt = validFormats.has(format) ? format : 'md';

  const key = `runs/${runId}/report.${fmt}`;
  const object = await env.REPORTS.get(key);
  if (object === null) {
    return corsError('Report not found', 404);
  }

  let contentType = 'text/markdown; charset=utf-8';
  if (fmt === 'html') contentType = 'text/html; charset=utf-8';
  else if (fmt === 'json') contentType = 'application/json; charset=utf-8';

  return new Response(object.body, {
    headers: { 'content-type': contentType, ...CORS_HEADERS },
  });
}

async function handlePostRun(request: Request, env: WorkerEnv): Promise<Response> {
  const maxMb = parseInt(env.MAX_UPLOAD_MB, 10) || 100;
  const maxBytes = maxMb * 1024 * 1024;

  const contentType = request.headers.get('content-type') ?? '';
  let jsonlContent: string;

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const traceField = form.get('trace');
    if (typeof traceField !== 'string') {
      return corsError('Missing "trace" field in multipart form', 400);
    }
    if (traceField.length > maxBytes) {
      return corsError(`Payload exceeds ${maxMb}MB limit`, 413);
    }
    jsonlContent = traceField;
  } else {
    const bodyBuf = await request.arrayBuffer();
    if (bodyBuf.byteLength > maxBytes) {
      return corsError(`Payload exceeds ${maxMb}MB limit`, 413);
    }
    jsonlContent = new TextDecoder().decode(bodyBuf);
  }

  const run_id = crypto.randomUUID();
  const r2Key = `runs/${run_id}/raw.jsonl`;

  // Store raw trace
  await env.RAW_TRACES.put(r2Key, jsonlContent, {
    httpMetadata: { contentType: 'application/x-ndjson' },
  });

  // Run full audit pipeline synchronously so reports are available immediately
  const lines = jsonlContent.split('\n').filter((l) => l.trim().length > 0);
  const rawEvents: unknown[] = [];
  for (const line of lines) {
    try { rawEvents.push(JSON.parse(line)); } catch { /* skip */ }
  }

  const { valid: events } = validateEvents(rawEvents);
  const sourceFile = request.headers.get('x-source-file') ?? undefined;

  const ctx: PolicyAuditContext = {
    manifest: {
      declared_capabilities: [],
      high_risk_capabilities: [],
      denied_capabilities: [],
    },
  };

  const [validationResult, inv, findings, score] = await Promise.all([
    validate(events),
    inventory(events),
    policyAudit(events, ctx),
    computeRiskScore(events, run_id),
  ]);

  const meta: ReportMeta = {
    issuer: 'Trustavo (trustavo.com)',
    issuer_email: 'issuer@trustavo.com',
    report_url: `https://trustavo.com/r/${run_id}`,
  };
  if (sourceFile !== undefined) {
    meta.source_files = [sourceFile];
  }

  const bundle = await renderReport(events, findings, score, inv, meta);

  // Store all report formats in R2
  await Promise.all([
    env.REPORTS.put(`runs/${run_id}/report.html`, bundle.html, { httpMetadata: { contentType: 'text/html; charset=utf-8' } }),
    env.REPORTS.put(`runs/${run_id}/report.md`, bundle.markdown, { httpMetadata: { contentType: 'text/markdown; charset=utf-8' } }),
    env.REPORTS.put(`runs/${run_id}/report.json`, bundle.json, { httpMetadata: { contentType: 'application/json; charset=utf-8' } }),
    env.REPORTS.put(`runs/${run_id}/report.csv`, bundle.csv, { httpMetadata: { contentType: 'text/csv; charset=utf-8' } }),
    env.ARTIFACTS.put(`runs/${run_id}/findings.json`, JSON.stringify(findings, null, 2)),
    env.ARTIFACTS.put(`runs/${run_id}/score.json`, JSON.stringify(score, null, 2)),
  ]);

  return corsJson({
    run_id,
    status: 'completed',
    event_count: events.length,
    error_count: validationResult.errors.length,
    finding_count: findings.length,
    eas_score: score.evidence_admission_score.score,
    eas_grade: score.evidence_admission_score.grade,
  }, 201);
}

async function handlePublicReportLink(runId: string, env: WorkerEnv): Promise<Response> {
  // QR code URLs contain the run_id directly: trustavo.com/r/{run_id}
  // Serve the HTML report straight from R2 — no D1 lookup needed.
  const key = `runs/${runId}/report.html`;
  const object = await env.REPORTS.get(key);

  if (object === null) {
    return new Response(
      `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Report Not Found — Trustavo</title>` +
      `<style>body{font-family:sans-serif;max-width:520px;margin:80px auto;text-align:center;color:#374151;padding:0 20px}` +
      `h1{color:#4f46e5;font-size:1.6rem;margin-bottom:8px}p{color:#6b7280;margin:8px 0}` +
      `a{color:#4f46e5;text-decoration:none}a:hover{text-decoration:underline}` +
      `code{background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:.85em}</style></head><body>` +
      `<h1>OpenAgentAudit</h1>` +
      `<p>Report <code>${runId.slice(0, 8)}…</code> was not found.</p>` +
      `<p>It may have expired or the ID may be incorrect.</p>` +
      `<p>Contact: <a href="mailto:issuer@trustavo.com">issuer@trustavo.com</a></p>` +
      `<p style="margin-top:24px"><a href="/">← Go to Trustavo</a></p>` +
      `</body></html>`,
      { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  }

  return new Response(object.body, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'x-run-id': runId,
    },
  });
}

// ---------------------------------------------------------------------------
// Fetch handler
// ---------------------------------------------------------------------------

async function handleFetch(request: Request, env: WorkerEnv): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method.toUpperCase();

  // OPTIONS pre-flight for CORS
  if (method === 'OPTIONS' && pathname.startsWith('/api/')) {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // GET /health
  if (method === 'GET' && pathname === '/health') {
    return new Response(
      JSON.stringify({ status: 'ok', version: '0.1.0', env: env.OAA_ENV }),
      { headers: { 'content-type': 'application/json' } },
    );
  }

  // GET /api/v1/runs
  if (method === 'GET' && pathname === '/api/v1/runs') {
    return handleGetRuns(env);
  }

  // POST /api/v1/runs
  if (method === 'POST' && pathname === '/api/v1/runs') {
    return handlePostRun(request, env);
  }

  // GET /api/v1/runs/:runId
  const runMatch = matchRoute(pathname, /^\/api\/v1\/runs\/([^/]+)$/);
  if (runMatch !== null && method === 'GET') {
    const runId = runMatch[1];
    if (runId === undefined) return corsError('Bad route', 400);
    return handleGetRun(runId, env);
  }

  // GET /api/v1/runs/:runId/findings
  const findingsMatch = matchRoute(pathname, /^\/api\/v1\/runs\/([^/]+)\/findings$/);
  if (findingsMatch !== null && method === 'GET') {
    const runId = findingsMatch[1];
    if (runId === undefined) return corsError('Bad route', 400);
    return handleGetFindings(runId, env);
  }

  // GET /api/v1/runs/:runId/report
  const reportMatch = matchRoute(pathname, /^\/api\/v1\/runs\/([^/]+)\/report$/);
  if (reportMatch !== null && method === 'GET') {
    const runId = reportMatch[1];
    if (runId === undefined) return corsError('Bad route', 400);
    const format = url.searchParams.get('format') ?? 'md';
    return handleGetReport(runId, format, env);
  }

  // GET /r/:reportId — public short link for QR code scan
  // Serves the HTML report directly; no auth required (reports are public by design)
  const shortLinkMatch = matchRoute(pathname, /^\/r\/([A-Za-z0-9_-]+)$/);
  if (shortLinkMatch !== null && method === 'GET') {
    const reportId = shortLinkMatch[1];
    if (reportId === undefined) return corsError('Bad route', 400);
    return handlePublicReportLink(reportId, env);
  }

  // Fall through: serve SPA for all other GET requests (client-side routing)
  // We fetch the asset directly; if not found (SPA route), serve index.html instead.
  const assetResp = await env.ASSETS.fetch(request);
  if (assetResp.status === 404 && method === 'GET') {
    const indexReq = new Request(new URL('/', request.url).toString(), request);
    return env.ASSETS.fetch(indexReq);
  }
  return assetResp;
}

// ---------------------------------------------------------------------------
// Queue consumer helpers
// ---------------------------------------------------------------------------

async function processAuditJob(
  msg: AuditJobMessage,
  env: WorkerEnv,
): Promise<void> {
  const { run_id, r2_key, manifest } = msg;

  // 1. Fetch JSONL from R2
  const object = await env.RAW_TRACES.get(r2_key);
  if (object === null) {
    throw new Error(`R2 object not found: ${r2_key}`);
  }
  const text = await object.text();

  // 2. Parse lines as CanonicalEvent[]
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  const rawParsed: unknown[] = lines.map((line) => JSON.parse(line) as unknown);
  const { valid: events } = validateEvents(rawParsed);

  // 3. Run engines
  const validationResult = await validate(events);
  const inv = await inventory(events);

  const policyCtx: PolicyAuditContext = {
    manifest: manifest ?? {
      declared_capabilities: [],
      high_risk_capabilities: [],
      denied_capabilities: [],
    },
  };
  const findings: Finding[] = await policyAudit(events, policyCtx);
  const score: RiskScore = await computeRiskScore(events, run_id);
  const reportBundle = await renderReport(events, findings, score, inv);

  // 4. Store results in ARTIFACTS R2
  await env.ARTIFACTS.put(
    `runs/${run_id}/inventory.json`,
    JSON.stringify(inv),
    { httpMetadata: { contentType: 'application/json' } },
  );
  await env.ARTIFACTS.put(
    `runs/${run_id}/findings.json`,
    JSON.stringify(findings),
    { httpMetadata: { contentType: 'application/json' } },
  );
  await env.ARTIFACTS.put(
    `runs/${run_id}/score.json`,
    JSON.stringify(score),
    { httpMetadata: { contentType: 'application/json' } },
  );
  await env.ARTIFACTS.put(
    `runs/${run_id}/validation.json`,
    JSON.stringify(validationResult),
    { httpMetadata: { contentType: 'application/json' } },
  );

  // 5. Store reports in REPORTS R2
  await env.REPORTS.put(
    `runs/${run_id}/report.md`,
    reportBundle.markdown,
    { httpMetadata: { contentType: 'text/markdown' } },
  );
  await env.REPORTS.put(
    `runs/${run_id}/report.html`,
    reportBundle.html,
    { httpMetadata: { contentType: 'text/html' } },
  );
  await env.REPORTS.put(
    `runs/${run_id}/report.json`,
    reportBundle.json,
    { httpMetadata: { contentType: 'application/json' } },
  );

  const completedAt = new Date().toISOString();
  const easScore = score.evidence_admission_score.score;
  const easGrade = score.evidence_admission_score.grade;
  const findingCount = findings.length;

  // 6. Upsert audit_runs in D1
  await env.DB.prepare(
    `INSERT INTO audit_runs
       (run_id, tenant_id, project_id, status, input_format, schema_version,
        profile_ids, raw_r2_key, event_count, finding_count,
        risk_score, evidence_admission_score, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(run_id) DO UPDATE SET
       status = 'completed',
       finding_count = excluded.finding_count,
       risk_score = excluded.risk_score,
       evidence_admission_score = excluded.evidence_admission_score,
       updated_at = excluded.updated_at,
       completed_at = excluded.completed_at`,
  )
    .bind(
      run_id,
      msg.tenant_id,
      'default',
      'completed',
      'jsonl',
      'open-agent-audit/v0.1',
      JSON.stringify(msg.profiles),
      r2_key,
      events.length,
      findingCount,
      easScore,
      easGrade,
      completedAt,
      completedAt,
      completedAt,
    )
    .run();

  // 7. Batch insert findings into D1
  if (findings.length > 0) {
    const stmts = findings.map((f) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO findings
           (finding_id, run_id, tenant_id, severity, category, title,
            evidence_ids, standard_mappings, recommendation, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        f.finding_id,
        run_id,
        msg.tenant_id,
        f.severity,
        f.category,
        f.title,
        JSON.stringify(f.evidence_ids),
        f.standard_mappings !== undefined ? JSON.stringify(f.standard_mappings) : null,
        f.recommendation,
        completedAt,
      ),
    );
    await env.DB.batch(stmts);
  }
}

async function processReportJob(
  msg: ReportJobMessage,
  env: WorkerEnv,
): Promise<void> {
  const { run_id, format } = msg;

  // Fetch findings and score from ARTIFACTS
  const [findingsObj, scoreObj] = await Promise.all([
    env.ARTIFACTS.get(`runs/${run_id}/findings.json`),
    env.ARTIFACTS.get(`runs/${run_id}/score.json`),
  ]);

  if (findingsObj === null || scoreObj === null) {
    throw new Error(`Missing artifacts for run ${run_id}`);
  }

  const findings = JSON.parse(await findingsObj.text()) as Finding[];
  const score = JSON.parse(await scoreObj.text()) as RiskScore;

  // Re-render report in the requested format
  const reportBundle = await renderReport([], findings, score);

  let content: string;
  let contentType: string;
  if (format === 'html') {
    content = reportBundle.html;
    contentType = 'text/html';
  } else if (format === 'json') {
    content = reportBundle.json;
    contentType = 'application/json';
  } else {
    content = reportBundle.markdown;
    contentType = 'text/markdown';
  }

  await env.REPORTS.put(`runs/${run_id}/report.${format}`, content, {
    httpMetadata: { contentType },
  });
}

// ---------------------------------------------------------------------------
// Queue handler
// ---------------------------------------------------------------------------

async function handleQueue(
  batch: MessageBatch<AuditJobMessage | ChunkJobMessage | ReportJobMessage>,
  env: WorkerEnv,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      if (batch.queue === 'oaa-audit-jobs') {
        await processAuditJob(message.body as AuditJobMessage, env);
      } else if (batch.queue === 'oaa-report-jobs') {
        await processReportJob(message.body as ReportJobMessage, env);
      }
      message.ack();
    } catch (err) {
      // Retry on failure — do not ack
      console.error(`Queue processing error for queue ${batch.queue}:`, err);
      message.retry();
    }
  }
}

// ---------------------------------------------------------------------------
// Worker export
// ---------------------------------------------------------------------------

export default {
  fetch: handleFetch,
  queue: handleQueue,
};

export { AuditRunCoordinator } from './durable-objects/AuditRunCoordinator.js';
export { TenantLimiter } from './durable-objects/TenantLimiter.js';
