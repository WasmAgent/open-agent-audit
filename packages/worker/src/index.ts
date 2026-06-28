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
import type { PolicyAuditContext, ReportMeta, AepProvenanceForScoring } from '@openagentaudit/core';
import { validateEvents } from '@openagentaudit/schema';
import type { CanonicalEvent, Finding, RiskScore } from '@openagentaudit/schema';
import { aepV0_2 } from '@openagentaudit/adapters';

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
  /** Display name of the deploying organisation, e.g. "Trustavo (trustavo.com)" */
  ISSUER_NAME: string;
  /** Contact email shown in reports and 404 pages, e.g. "issuer@trustavo.com" */
  ISSUER_EMAIL: string;
  /** Public base URL of this deployment, e.g. "https://trustavo.com" */
  PUBLIC_URL: string;
  /** Allowed CORS origin. Defaults to '*' if not set. */
  CORS_ORIGIN?: string;
  /** Shared secret for API authentication. If unset, auth is disabled (dev/demo mode). */
  API_KEY?: string;
  /** 'public' (default) serves /r/:id without auth; 'private' requires Bearer API_KEY. */
  REPORT_VISIBILITY?: string;
}

// ---------------------------------------------------------------------------
// CORS helpers
// ---------------------------------------------------------------------------

function corsHeaders(env: WorkerEnv): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.CORS_ORIGIN ?? '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Tenant-Id, X-Source-File',
  };
}

function corsJson(body: unknown, env: WorkerEnv, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders(env) },
  });
}

function corsError(message: string, status: number, env: WorkerEnv): Response {
  return corsJson({ error: message }, env, status);
}

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

function checkAuth(request: Request, env: WorkerEnv): boolean {
  if (!env.API_KEY) return true; // auth disabled in demo mode
  const header = request.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return token === env.API_KEY;
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
    `SELECT run_id, tenant_id, status, input_format, event_count, finding_count,
            risk_score, evidence_admission_score, created_at, completed_at
     FROM audit_runs
     ORDER BY created_at DESC
     LIMIT 50`,
  ).all();
  return corsJson({ runs: result.results }, env);
}

async function handleGetRun(runId: string, env: WorkerEnv): Promise<Response> {
  const row = await env.DB.prepare(
    'SELECT * FROM audit_runs WHERE run_id = ?',
  )
    .bind(runId)
    .first();
  if (row === null) {
    return corsError('Run not found', 404, env);
  }
  return corsJson({ run: row }, env);
}

async function handleGetFindings(runId: string, env: WorkerEnv): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT * FROM findings WHERE run_id = ? ORDER BY severity DESC LIMIT 100`,
  )
    .bind(runId)
    .all();
  return corsJson({ findings: result.results }, env);
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
    return corsError('Report not found', 404, env);
  }

  let contentType = 'text/markdown; charset=utf-8';
  if (fmt === 'html') contentType = 'text/html; charset=utf-8';
  else if (fmt === 'json') contentType = 'application/json; charset=utf-8';

  return new Response(object.body, {
    headers: { 'content-type': contentType, ...corsHeaders(env) },
  });
}

// ---------------------------------------------------------------------------
// Retention helpers
// ---------------------------------------------------------------------------

function retentionDate(fromIso: string): string {
  const d = new Date(fromIso);
  d.setMonth(d.getMonth() + 6); // 6-month default, EU AI Act Art. 26(6)
  return d.toISOString().slice(0, 10);
}

async function handlePostRun(request: Request, env: WorkerEnv): Promise<Response> {
  const maxMb = parseInt(env.MAX_UPLOAD_MB, 10) || 100;
  const maxBytes = maxMb * 1024 * 1024;

  // Rate-limit check via TenantLimiter Durable Object
  const tenant_id = request.headers.get('x-tenant-id') ?? 'default';
  const doId = env.TENANT_LIMITER.idFromName(tenant_id);
  const limiterStub = env.TENANT_LIMITER.get(doId);
  const limiterResp = await limiterStub.fetch('https://do/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenant_id }),
  });
  const { allowed } = await limiterResp.json<{ allowed: boolean; remaining: number; reset_at: number; count: number }>();
  if (!allowed) {
    const errResp = corsError('Rate limit exceeded', 429, env);
    const headers = new Headers(errResp.headers);
    headers.set('Retry-After', '60');
    return new Response(errResp.body, { status: 429, headers });
  }

  const contentType = request.headers.get('content-type') ?? '';
  let jsonlContent: string;

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const traceField = form.get('trace');
    if (typeof traceField !== 'string') {
      return corsError('Missing "trace" field in multipart form', 400, env);
    }
    if (traceField.length > maxBytes) {
      return corsError(`Payload exceeds ${maxMb}MB limit`, 413, env);
    }
    jsonlContent = traceField;
  } else {
    const bodyBuf = await request.arrayBuffer();
    if (bodyBuf.byteLength > maxBytes) {
      return corsError(`Payload exceeds ${maxMb}MB limit`, 413, env);
    }
    jsonlContent = new TextDecoder().decode(bodyBuf);
  }

  const run_id = crypto.randomUUID();
  const r2Key = `runs/${run_id}/raw.jsonl`;

  // Store raw trace
  await env.RAW_TRACES.put(r2Key, jsonlContent, {
    httpMetadata: { contentType: 'application/x-ndjson' },
    customMetadata: { retain_until: retentionDate(new Date().toISOString()) },
  });

  // Detect AEP JSON: try parsing the whole body as a single JSON object first.
  // AEP records are pretty-printed (multi-line), so line-by-line parsing fails.
  let events: CanonicalEvent[];
  let aepProvenance: AepProvenanceForScoring | undefined;
  let inputFormat = 'jsonl';
  let parseFailures: number[] = [];

  let singleObject: Record<string, unknown> | undefined;
  try {
    const parsed = JSON.parse(jsonlContent) as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      singleObject = parsed as Record<string, unknown>;
    }
  } catch { /* not a single JSON object — try JSONL below */ }

  const isAepRecord =
    singleObject !== undefined &&
    (singleObject['schema_version'] === 'aep/v0.2' || singleObject['schema_version'] === 'aep/v0.1');

  if (isAepRecord && singleObject !== undefined) {
    inputFormat = 'aep';
    try {
      const aepRecord = singleObject as unknown as Parameters<typeof aepV0_2.AepV0_2Adapter.toEvents>[0];
      events = aepV0_2.AepV0_2Adapter.toEvents(aepRecord);
      const prov = aepV0_2.getProvenance(aepRecord);
      if (Object.keys(prov).length > 0) {
        aepProvenance = prov;
      }
    } catch {
      // Invalid AEP record — fall through to canonical event path
      events = [];
    }
  } else {
    // JSONL path: parse line-by-line, recording failures
    const lines = jsonlContent.split('\n').filter((l) => l.trim().length > 0);
    const rawEvents: unknown[] = [];
    parseFailures = [];
    for (const [idx, line] of lines.entries()) {
      try { rawEvents.push(JSON.parse(line) as unknown); }
      catch { parseFailures.push(idx + 1); }
    }
    const { valid } = validateEvents(rawEvents);
    events = valid;
  }

  const sourceFile = request.headers.get('x-source-file') ?? undefined;

  const ctx: PolicyAuditContext = {
    manifest: {
      declared_capabilities: [],
      high_risk_capabilities: [],
      denied_capabilities: [],
    },
  };

  // contamination check requires a separate training event set (pass via contamination_result param)
  // currently deferred — computeRiskScore uses neutral score (100) when no result is provided
  const [validationResult, inv, auditFindings] = await Promise.all([
    validate(events),
    inventory(events),
    policyAudit(events, ctx),
  ]);
  const score = await computeRiskScore(events, run_id, aepProvenance, validationResult.crypto_summary);

  const findings: Finding[] = [...auditFindings];

  // Append a parse-failure finding if any JSONL lines could not be parsed
  if (parseFailures.length > 0) {
    const SPEC_VERSION_CONST = 'open-agent-audit/v0.1' as const;
    findings.push({
      schema_version: SPEC_VERSION_CONST,
      finding_id: btoa(`OAA-P-001:${run_id}:parse`),
      rule_id: 'OAA-P-001',
      severity: 'medium' as const,
      category: 'trace_integrity',
      title: 'Trace parse errors',
      description: `${parseFailures.length} line(s) in the uploaded trace could not be parsed as JSON (lines: ${parseFailures.slice(0, 5).join(', ')}${parseFailures.length > 5 ? '…' : ''}).`,
      evidence_ids: [],
      recommendation: 'Review the trace file for malformed JSON lines. Each line must be a complete, valid JSON object.',
    });
  }

  const meta: ReportMeta = {
    issuer: env.ISSUER_NAME,
    issuer_email: env.ISSUER_EMAIL,
    report_url: `${env.PUBLIC_URL}/r/${run_id}`,
    crypto_summary: validationResult.crypto_summary,
  };
  if (sourceFile !== undefined) {
    meta.source_files = [sourceFile];
  }
  if (aepProvenance !== undefined) {
    meta.aep_provenance = aepProvenance;
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

  // Write run and findings to D1 so GET /api/v1/runs reflects this run
  const completedAt = new Date().toISOString();
  await writeRunToD1(env, run_id, tenant_id, r2Key, inputFormat, events.length, findings, score, completedAt);

  return corsJson({
    run_id,
    status: 'completed',
    event_count: events.length,
    error_count: validationResult.errors.length,
    finding_count: findings.length,
    eas_score: score.evidence_admission_score.score,
    eas_grade: score.evidence_admission_score.grade,
  }, env, 201);
}

async function handlePublicReportLink(runId: string, env: WorkerEnv, request: Request): Promise<Response> {
  const isPrivate = (env.REPORT_VISIBILITY ?? 'public') === 'private';
  if (isPrivate && !checkAuth(request, env)) {
    return new Response('Unauthorized', { status: 401 });
  }
  const issuerEmail = env.ISSUER_EMAIL;
  const issuerName = env.ISSUER_NAME;
  const publicUrl = env.PUBLIC_URL;
  const key = `runs/${runId}/report.html`;
  const object = await env.REPORTS.get(key);

  if (object === null) {
    return new Response(
      `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Report Not Found — ${issuerName}</title>` +
      `<style>body{font-family:sans-serif;max-width:520px;margin:80px auto;text-align:center;color:#374151;padding:0 20px}` +
      `h1{color:#4f46e5;font-size:1.6rem;margin-bottom:8px}p{color:#6b7280;margin:8px 0}` +
      `a{color:#4f46e5;text-decoration:none}a:hover{text-decoration:underline}` +
      `code{background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:.85em}</style></head><body>` +
      `<h1>OpenAgentAudit</h1>` +
      `<p>Report <code>${runId.slice(0, 8)}…</code> was not found.</p>` +
      `<p>It may have expired or the ID may be incorrect.</p>` +
      `<p>Contact: <a href="mailto:${issuerEmail}">${issuerEmail}</a></p>` +
      `<p style="margin-top:24px"><a href="${publicUrl}/">← Go to ${issuerName}</a></p>` +
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
    return new Response(null, { status: 204, headers: corsHeaders(env) });
  }

  // GET /health
  if (method === 'GET' && pathname === '/health') {
    const authMode = env.API_KEY ? 'api_key' : 'open';
    return new Response(
      JSON.stringify({ status: 'ok', version: '0.1.0', env: env.OAA_ENV, auth_mode: authMode }),
      { headers: { 'content-type': 'application/json' } },
    );
  }

  // GET /api/v1/config — site branding config for the SPA
  if (method === 'GET' && pathname === '/api/v1/config') {
    const siteName = env.ISSUER_NAME.replace(/\s*\(.*?\)\s*$/, '').trim();
    return corsJson({
      site_name: siteName,
      site_tagline: 'Evidence-grade audit for enterprise AI agents',
      powered_by: 'OpenAgentAudit',
    }, env);
  }

  // GET /api/v1/runs
  if (method === 'GET' && pathname === '/api/v1/runs') {
    return handleGetRuns(env);
  }

  // POST /api/v1/runs
  if (method === 'POST' && pathname === '/api/v1/runs') {
    if (!checkAuth(request, env)) return corsError('Unauthorized', 401, env);
    return handlePostRun(request, env);
  }

  // GET /api/v1/runs/:runId
  const runMatch = matchRoute(pathname, /^\/api\/v1\/runs\/([^/]+)$/);
  if (runMatch !== null && method === 'GET') {
    const runId = runMatch[1];
    if (runId === undefined) return corsError('Bad route', 400, env);
    return handleGetRun(runId, env);
  }

  // GET /api/v1/runs/:runId/findings
  const findingsMatch = matchRoute(pathname, /^\/api\/v1\/runs\/([^/]+)\/findings$/);
  if (findingsMatch !== null && method === 'GET') {
    const runId = findingsMatch[1];
    if (runId === undefined) return corsError('Bad route', 400, env);
    return handleGetFindings(runId, env);
  }

  // GET /api/v1/runs/:runId/report
  const reportMatch = matchRoute(pathname, /^\/api\/v1\/runs\/([^/]+)\/report$/);
  if (reportMatch !== null && method === 'GET') {
    const runId = reportMatch[1];
    if (runId === undefined) return corsError('Bad route', 400, env);
    const format = url.searchParams.get('format') ?? 'md';
    return handleGetReport(runId, format, env);
  }

  // GET /r/:reportId — public short link for QR code scan
  // Serves the HTML report directly; visibility controlled by REPORT_VISIBILITY env var.
  const shortLinkMatch = matchRoute(pathname, /^\/r\/([A-Za-z0-9_-]+)$/);
  if (shortLinkMatch !== null && method === 'GET') {
    const reportId = shortLinkMatch[1];
    if (reportId === undefined) return corsError('Bad route', 400, env);
    return handlePublicReportLink(reportId, env, request);
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

/**
 * Shared helper: upsert an audit run and batch-insert its findings into D1.
 * Called from both handlePostRun (direct upload) and processAuditJob (queue).
 */
async function writeRunToD1(
  env: WorkerEnv,
  run_id: string,
  tenant_id: string,
  r2_key: string,
  inputFormat: string,
  eventCount: number,
  findings: Finding[],
  score: RiskScore,
  completedAt: string,
): Promise<void> {
  const easScore = score.evidence_admission_score.score;
  const easGrade = score.evidence_admission_score.grade;

  // Ensure the tenant and default project exist (single-tenant deployments use 'default').
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO tenants (tenant_id, name, plan, created_at) VALUES (?, ?, ?, ?)`,
    ).bind(tenant_id, tenant_id, 'pilot', completedAt),
    env.DB.prepare(
      `INSERT OR IGNORE INTO projects (project_id, tenant_id, name, created_at) VALUES (?, ?, ?, ?)`,
    ).bind('default', tenant_id, 'default', completedAt),
  ]);

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
      tenant_id,
      'default',
      'completed',
      inputFormat,
      'open-agent-audit/v0.1',
      JSON.stringify([]),
      r2_key,
      eventCount,
      findings.length,
      easScore,
      easGrade,
      completedAt,
      completedAt,
      completedAt,
    )
    .run();

  if (findings.length > 0) {
    const stmts = findings.map((f) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO findings
           (finding_id, run_id, tenant_id, severity, category, title,
            evidence_ids, standard_mappings, recommendation, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        `${run_id}:${f.finding_id}`,
        run_id,
        tenant_id,
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

  // 2. Parse lines as CanonicalEvent[], logging any parse failures
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  const rawParsed: unknown[] = [];
  let parseFailureCount = 0;
  for (const line of lines) {
    try { rawParsed.push(JSON.parse(line) as unknown); }
    catch { parseFailureCount++; }
  }
  if (parseFailureCount > 0) {
    console.warn(`processAuditJob: ${parseFailureCount} line(s) could not be parsed as JSON for run ${run_id}`);
  }
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
  // contamination check requires a separate training event set (pass via contamination_result param)
  // currently deferred — computeRiskScore uses neutral score (100) when no result is provided
  const score: RiskScore = await computeRiskScore(events, run_id, undefined, validationResult.crypto_summary);
  const reportBundle = await renderReport(events, findings, score, inv, { crypto_summary: validationResult.crypto_summary });

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

  // 6. Write run and findings to D1
  await writeRunToD1(env, run_id, msg.tenant_id, r2_key, 'jsonl', events.length, findings, score, completedAt);
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
