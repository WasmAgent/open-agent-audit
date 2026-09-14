/**
 * R2 local fault-injection scenarios (Track C harness).
 *
 * Each scenario drives the REAL worker handlers through worker.fetch against
 * deterministic fakes (test/faults.ts), asserts the fail-closed invariant, and
 * returns a `wasmagent-runtime-fault/v1` artifact with mode 'local'.
 *
 * These artifacts are LOCAL verification only — never production evidence.
 * Pure module (no bun:test imports) so the CLI harness and the unit tests
 * share the exact same scenarios.
 */
import worker from '../src/index.js';
import type { WorkerEnv } from '../src/index.js';
import { buildFaultArtifact, type FaultArtifact } from '../src/runtime-faults.js';
import type { MemoryKV, MemoryR2, SqliteD1 } from './harness.js';
import { createEnv, dbOf } from './harness.js';
import { FaultD1, FaultKV, FaultR2, fakeBatch } from './faults.js';

const KEY = 'rt-local-key';
export const LOCAL_SOURCE_SHA = 'local-fault-harness';

const UNAVAILABLE = new Error('D1_ERROR: database unavailable');
const R2_UNAVAILABLE = new Error('R2_ERROR: object storage unavailable');

function baseEnv(): WorkerEnv {
  return createEnv({ OAA_ENV: 'production', API_KEY: KEY, TENANT_ID: 'default' });
}

/** Minimal local canary trace — same shape as the production smoke uses. */
export function localTrace(runId: string, agentId: string): string {
  const base = {
    schema_version: 'open-agent-audit/v0.1',
    run_id: runId,
    session_id: `rt-session-${runId}`,
    agent_id: agentId,
    model_id: 'runtime-canary-model',
    timestamp: '2026-09-14T12:00:00.000Z',
  };
  return [
    JSON.stringify({
      ...base,
      event_id: `${runId}-evt-1`,
      type: 'tool_call',
      actor: 'agent',
      tool: { name: 'canary.read', capability: 'read', args_hash: 'ca11ary' },
    }),
    JSON.stringify({ ...base, event_id: `${runId}-evt-2`, type: 'final_answer', actor: 'agent' }),
  ].join('\n');
}

async function fetchJson(
  env: WorkerEnv,
  method: string,
  path: string,
  body?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await worker.fetch(
    new Request(`https://example.com${path}`, {
      method,
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      ...(body !== undefined ? { body } : {}),
    }),
    env,
  );
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* non-JSON body */
  }
  return { status: response.status, body: parsed };
}

/** Ingest a canary run through the real pipeline (R2 + D1 writes included). */
async function ingestRun(env: WorkerEnv, agentId: string): Promise<string> {
  const response = await worker.fetch(
    new Request('https://example.com/api/v1/runs', {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: localTrace(`rt-${agentId}`, agentId),
    }),
    env,
  );
  if (response.status !== 201) throw new Error(`fixture: run ingestion failed (${response.status})`);
  const body = (await response.json()) as { run_id: string };
  return body.run_id;
}

interface Issuance {
  status: number;
  body: Record<string, unknown>;
  passportId: string | null;
}

async function issuePassport(env: WorkerEnv, runId: string, agentId: string): Promise<Issuance> {
  const { status, body } = await fetchJson(
    env,
    'POST',
    '/passport/issue',
    JSON.stringify({ runId, agentId, agentName: 'Runtime Canary (local)', validityDays: 30 }),
  );
  const passportId =
    (body as { identity?: { passport_id?: string } }).identity?.passport_id ?? null;
  return { status, body, passportId };
}

async function revokePassport(env: WorkerEnv, passportId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  return fetchJson(env, 'POST', `/passport/${passportId}/revoke`, '{"reason":"rt-local-fault-scenario"}');
}

async function passportStatus(env: WorkerEnv, passportId: string): Promise<Record<string, unknown>> {
  const { status, body } = await fetchJson(env, 'GET', `/passport/${passportId}/status`);
  return { http_status: status, ...body };
}

async function kvKeyCount(env: WorkerEnv): Promise<number> {
  const kv = env.PASSPORTS as unknown as { list(): Promise<{ keys: Array<{ name: string }> }> };
  const { keys } = await kv.list();
  return keys.length;
}

function db(env: WorkerEnv): SqliteD1 {
  return dbOf(env);
}

/** Full healthy happy path: run ingested, Passport issued (ACTIVE). */
async function happyPassport(env: WorkerEnv, agentId: string): Promise<{ runId: string; passportId: string }> {
  const runId = await ingestRun(env, agentId);
  const issued = await issuePassport(env, runId, agentId);
  if (issued.status !== 201 || issued.passportId === null) {
    throw new Error(`fixture: happy-path issuance failed (${issued.status})`);
  }
  return { runId, passportId: issued.passportId };
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

/** R2-D1-01 — D1 unavailable before the ownership write: no false success. */
export async function r2D101(): Promise<FaultArtifact> {
  const env = baseEnv();
  const runId = await ingestRun(env, 'rt-canary-d1-01');
  const kvBefore = await kvKeyCount(env);
  const healthy = db(env);
  env.DB = new FaultD1(healthy, 'before_owner_write', /INSERT INTO passport_issuances/, UNAVAILABLE) as unknown as WorkerEnv['DB'];

  const issued = await issuePassport(env, runId, 'rt-canary-d1-01');
  const kvAfter = await kvKeyCount(env);

  env.DB = healthy as unknown as WorkerEnv['DB'];
  const owners = await healthy.prepare('SELECT COUNT(*) AS n FROM passport_issuances').first<{ n: number }>();

  const pass =
    issued.status === 503 && issued.passportId === null && kvAfter === kvBefore && owners?.n === 0;
  return buildFaultArtifact({
    sourceSha: LOCAL_SOURCE_SHA,
    scenario: 'R2-D1-01',
    dependency: 'd1',
    checkpoint: 'before_owner_write',
    kind: 'unavailable',
    expectedHttp: 503,
    observed: {
      issue_status: issued.status,
      issue_body: issued.body,
      kv_documents_before: kvBefore,
      kv_documents_after: kvAfter,
      ownership_rows: owners?.n ?? null,
      recovery_ownership:
        'caller receives 503; KV document rolled back by the handler; no orphan owner row; the stored run remains reusable for a retry',
    },
    pass,
  });
}

/** R2-D1-02 — D1 unavailable during status lookup: UNKNOWN, never ACTIVE. */
export async function r2D102(): Promise<FaultArtifact> {
  const env = baseEnv();
  const { passportId } = await happyPassport(env, 'rt-canary-d1-02');
  const healthy = db(env);
  env.DB = new FaultD1(healthy, 'status_lookup', /FROM passport_revocations/, UNAVAILABLE) as unknown as WorkerEnv['DB'];

  const status = await passportStatus(env, passportId);

  env.DB = healthy as unknown as WorkerEnv['DB'];
  const pass = status.http_status === 200 && status.status === 'unknown';
  return buildFaultArtifact({
    sourceSha: LOCAL_SOURCE_SHA,
    scenario: 'R2-D1-02',
    dependency: 'd1',
    checkpoint: 'revocation_status_lookup',
    kind: 'unavailable',
    expectedHttp: 200,
    observed: { status_summary: status.status },
    pass,
  });
}

/** R2-D1-03 — D1 unavailable during revoke: fails closed, state unchanged. */
export async function r2D103(): Promise<FaultArtifact> {
  const env = baseEnv();
  const { passportId } = await happyPassport(env, 'rt-canary-d1-03');
  const healthy = db(env);
  env.DB = new FaultD1(healthy, 'revoke_owner_guard', /FROM passport_issuances/, UNAVAILABLE) as unknown as WorkerEnv['DB'];

  const revoked = await revokePassport(env, passportId);

  env.DB = healthy as unknown as WorkerEnv['DB'];
  const status = await passportStatus(env, passportId);
  const pass = revoked.status === 503 && status.status === 'valid';
  return buildFaultArtifact({
    sourceSha: LOCAL_SOURCE_SHA,
    scenario: 'R2-D1-03',
    dependency: 'd1',
    checkpoint: 'revoke_owner_guard',
    kind: 'unavailable',
    expectedHttp: 503,
    observed: { revoke_status: revoked.status, status_after_recovery: status.status },
    pass,
  });
}

/** R2-D1-04 — retry after a successful authoritative transition: deterministic conflict. */
export async function r2D104(): Promise<FaultArtifact> {
  const env = baseEnv();
  const { passportId } = await happyPassport(env, 'rt-canary-d1-04');

  const first = await revokePassport(env, passportId);
  const retry = await revokePassport(env, passportId);
  const status = await passportStatus(env, passportId);

  const pass = first.status === 200 && retry.status === 409 && status.status === 'revoked';
  return buildFaultArtifact({
    sourceSha: LOCAL_SOURCE_SHA,
    scenario: 'R2-D1-04',
    dependency: 'd1',
    checkpoint: 'post_transition_retry',
    kind: 'duplicate_delivery',
    expectedHttp: 409,
    observed: { first_status: first.status, retry_status: retry.status, status_after: status.status },
    pass,
  });
}

/** R2-KV-01 — D1 revoked + KV stale-negative: REVOKED stays authoritative. */
export async function r2KV01(): Promise<FaultArtifact> {
  const env = baseEnv();
  const { passportId } = await happyPassport(env, 'rt-canary-kv-01');
  await revokePassport(env, passportId);
  const kv = env.PASSPORTS as unknown as { delete(key: string): Promise<void> };
  await kv.delete(`revocation:${passportId}`);

  const status = await passportStatus(env, passportId);
  const pass = status.status === 'revoked';
  return buildFaultArtifact({
    sourceSha: LOCAL_SOURCE_SHA,
    scenario: 'R2-KV-01',
    dependency: 'kv',
    checkpoint: 'stale_negative_mirror',
    kind: 'stale_read',
    expectedHttp: 200,
    observed: { status_summary: status.status },
    pass,
  });
}

/** R2-KV-02 — KV mirror write failure after a successful D1 revoke. */
export async function r2KV02(): Promise<FaultArtifact> {
  const env = baseEnv();
  const { passportId } = await happyPassport(env, 'rt-canary-kv-02');
  const inner = env.PASSPORTS as unknown as MemoryKV;
  env.PASSPORTS = new FaultKV(
    inner,
    'mirror_write_after_revoke',
    { failOnPut: (key) => key.startsWith('revocation:'), error: UNAVAILABLE },
  ) as unknown as WorkerEnv['PASSPORTS'];

  const revoked = await revokePassport(env, passportId);

  env.PASSPORTS = inner as unknown as WorkerEnv['PASSPORTS'];
  const status = await passportStatus(env, passportId);
  const row = await db(env)
    .prepare('SELECT record FROM passport_revocations WHERE passport_id = ?')
    .bind(passportId)
    .first<{ record: string }>();

  const pass = revoked.status === 200 && status.status === 'revoked' && row !== null;
  return buildFaultArtifact({
    sourceSha: LOCAL_SOURCE_SHA,
    scenario: 'R2-KV-02',
    dependency: 'kv',
    checkpoint: 'mirror_write_after_revoke',
    kind: 'unavailable',
    expectedHttp: 200,
    observed: {
      revoke_status: revoked.status,
      status_summary: status.status,
      authoritative_d1_row: row !== null,
      note: 'revocation KV mirror is best-effort; authoritative state lives in D1 only',
    },
    pass,
  });
}

/** R2-KV-03 — legacy KV mirror positive + D1 absent: deterministic backfill. */
export async function r2KV03(): Promise<FaultArtifact> {
  const env = baseEnv();
  const { passportId } = await happyPassport(env, 'rt-canary-kv-03');
  const revoked = await revokePassport(env, passportId);
  if (revoked.status !== 200) throw new Error('fixture: revoke failed');
  const record = revoked.body;

  // Simulate the legacy world: authoritative D1 rows gone, KV mirror present.
  db(env).seed('DELETE FROM passport_revocations');
  const kv = env.PASSPORTS as unknown as { put(key: string, value: string): Promise<void> };
  await kv.put(`revocation:${passportId}`, JSON.stringify(record));

  const status = await passportStatus(env, passportId);
  const backfilled = await db(env)
    .prepare('SELECT passport_id FROM passport_revocations WHERE passport_id = ?')
    .bind(passportId)
    .first<{ passport_id: string }>();

  const pass = status.status === 'revoked' && backfilled !== null;
  return buildFaultArtifact({
    sourceSha: LOCAL_SOURCE_SHA,
    scenario: 'R2-KV-03',
    dependency: 'kv',
    checkpoint: 'legacy_mirror_with_d1_absent',
    kind: 'stale_read',
    expectedHttp: 200,
    observed: {
      status_summary: status.status,
      d1_backfilled: backfilled !== null,
      note: 'mirror consulted only after D1 authoritatively reports absence, then backfilled',
    },
    pass,
  });
}

/** R2-KV-04 — KV mirror unavailable: no security-state downgrade. */
export async function r2KV04(): Promise<FaultArtifact> {
  const env = baseEnv();
  const { passportId } = await happyPassport(env, 'rt-canary-kv-04');
  await revokePassport(env, passportId);
  const inner = env.PASSPORTS as unknown as MemoryKV;
  env.PASSPORTS = new FaultKV(
    inner,
    'mirror_read_unavailable',
    { failOnGet: (key) => key.startsWith('revocation:'), error: UNAVAILABLE },
  ) as unknown as WorkerEnv['PASSPORTS'];

  const status = await passportStatus(env, passportId);

  env.PASSPORTS = inner as unknown as WorkerEnv['PASSPORTS'];
  const pass = status.status === 'revoked';
  return buildFaultArtifact({
    sourceSha: LOCAL_SOURCE_SHA,
    scenario: 'R2-KV-04',
    dependency: 'kv',
    checkpoint: 'mirror_read_unavailable',
    kind: 'unavailable',
    expectedHttp: 200,
    observed: { status_summary: status.status, note: 'D1-authoritative revocation never consulted the broken mirror' },
    pass,
  });
}

/** R2-R2-01 — canonical report missing: issuance fails closed. */
export async function r2R201(): Promise<FaultArtifact> {
  const env = baseEnv();
  const runId = await ingestRun(env, 'rt-canary-r2-01');
  const reports = env.REPORTS as unknown as { delete(key: string): Promise<void> };
  await reports.delete(`runs/${runId}/report.json`);

  const issued = await issuePassport(env, runId, 'rt-canary-r2-01');
  const pass = issued.status === 409 && issued.passportId === null;
  return buildFaultArtifact({
    sourceSha: LOCAL_SOURCE_SHA,
    scenario: 'R2-R2-01',
    dependency: 'r2',
    checkpoint: 'canonical_report_missing',
    kind: 'unavailable',
    expectedHttp: 409,
    observed: { issue_status: issued.status, issue_body: issued.body },
    pass,
  });
}

/** R2-R2-02 — canonical report malformed: fail closed, never mint from junk. */
export async function r2R202(): Promise<FaultArtifact> {
  const env = baseEnv();
  const runId = await ingestRun(env, 'rt-canary-r2-02');
  const reports = env.REPORTS as unknown as { put(key: string, value: string): Promise<void> };
  await reports.put(`runs/${runId}/report.json`, '{"truncated": ');

  const issued = await issuePassport(env, runId, 'rt-canary-r2-02');
  const pass = issued.status === 409 && issued.passportId === null;
  return buildFaultArtifact({
    sourceSha: LOCAL_SOURCE_SHA,
    scenario: 'R2-R2-02',
    dependency: 'r2',
    checkpoint: 'canonical_report_malformed',
    kind: 'stale_read',
    expectedHttp: 409,
    observed: { issue_status: issued.status, issue_body: issued.body },
    pass,
  });
}

/** R2-R2-03 — R2 read unavailable: no fabricated evidence (fail closed 409). */
export async function r2R203(): Promise<FaultArtifact> {
  const env = baseEnv();
  const runId = await ingestRun(env, 'rt-canary-r2-03');
  const inner = env.REPORTS as unknown as MemoryR2;
  env.REPORTS = new FaultR2(
    inner,
    'get_canonical_report',
    { failOnGet: (key) => key === `runs/${runId}/report.json`, error: R2_UNAVAILABLE },
  ) as unknown as WorkerEnv['REPORTS'];

  const issued = await issuePassport(env, runId, 'rt-canary-r2-03');
  const kvAfter = await kvKeyCount(env);

  env.REPORTS = inner as unknown as WorkerEnv['REPORTS'];
  const pass = issued.status === 409 && issued.passportId === null && kvAfter === 0;
  return buildFaultArtifact({
    sourceSha: LOCAL_SOURCE_SHA,
    scenario: 'R2-R2-03',
    dependency: 'r2',
    checkpoint: 'get_canonical_report',
    kind: 'unavailable',
    expectedHttp: 409,
    observed: { issue_status: issued.status, kv_documents_after: kvAfter },
    pass,
  });
}

/** R2-R2-04 — R2 evidence stored, D1 ownership write fails: no false success. */
export async function r2R204(): Promise<FaultArtifact> {
  const env = baseEnv();
  const runId = await ingestRun(env, 'rt-canary-r2-04');
  const reportPresent = (await env.REPORTS.get(`runs/${runId}/report.json`)) !== null;
  const kvBefore = await kvKeyCount(env);
  const healthy = db(env);
  env.DB = new FaultD1(healthy, 'owner_write_after_r2_store', /INSERT INTO passport_issuances/, UNAVAILABLE) as unknown as WorkerEnv['DB'];

  const issued = await issuePassport(env, runId, 'rt-canary-r2-04');

  env.DB = healthy as unknown as WorkerEnv['DB'];
  const owners = await healthy.prepare('SELECT COUNT(*) AS n FROM passport_issuances').first<{ n: number }>();
  const pass = reportPresent && issued.status === 503 && issued.passportId === null && owners?.n === 0;
  return buildFaultArtifact({
    sourceSha: LOCAL_SOURCE_SHA,
    scenario: 'R2-R2-04',
    dependency: 'r2',
    checkpoint: 'owner_write_after_r2_store',
    kind: 'fail_after_write',
    expectedHttp: 503,
    observed: {
      report_stored: reportPresent,
      issue_status: issued.status,
      ownership_rows: owners?.n ?? null,
      recovery_ownership:
        'the stored canonical report is content-owned by the run and reusable; issuance is retriable and no caller-facing success was produced',
    },
    pass,
  });
}

/**
 * R2-Q-01 — duplicate audit job delivery. Observed (honest) result: the
 * current pipeline is NOT idempotent — the redelivered job hits the
 * audit_runs PK constraint and is retried forever instead of converging.
 * Tracked in R2_FAULT_LEDGER; the artifact records verdict 'fail'.
 */
export async function r2Q01(): Promise<FaultArtifact> {
  const env = baseEnv();
  const runId = 'rt-dup-audit-run';
  const traces = env.RAW_TRACES as unknown as { put(key: string, value: string): Promise<void> };
  await traces.put(`runs/${runId}/raw.jsonl`, localTrace(runId, 'rt-canary-q-01'));

  const message = { run_id: runId, tenant_id: 'default', r2_key: `runs/${runId}/raw.jsonl`, profiles: [] };
  const first = fakeBatch('oaa-audit-jobs', [message]);
  await worker.queue(first as unknown as Parameters<typeof worker.queue>[0], env);
  const second = fakeBatch('oaa-audit-jobs', [message]);
  await worker.queue(second as unknown as Parameters<typeof worker.queue>[0], env);

  const pass = first.events.acked === 1 && second.events.acked === 1 && second.events.retried === 0;
  return buildFaultArtifact({
    sourceSha: LOCAL_SOURCE_SHA,
    scenario: 'R2-Q-01',
    dependency: 'queue',
    checkpoint: 'duplicate_delivery',
    kind: 'duplicate_delivery',
    expectedHttp: null,
    observed: {
      first_delivery: first.events,
      duplicate_delivery: second.events,
      note: 'writeRunToD1 upserts (audit_runs ON CONFLICT DO UPDATE, findings INSERT OR IGNORE), so a redelivered audit job converges on the same D1 row and is acked',
    },
    pass,
  });
}

/** All executable local scenarios. */
export const SCENARIOS: Array<{ id: string; run: () => Promise<FaultArtifact> }> = [
  { id: 'R2-D1-01', run: r2D101 },
  { id: 'R2-D1-02', run: r2D102 },
  { id: 'R2-D1-03', run: r2D103 },
  { id: 'R2-D1-04', run: r2D104 },
  { id: 'R2-KV-01', run: r2KV01 },
  { id: 'R2-KV-02', run: r2KV02 },
  { id: 'R2-KV-03', run: r2KV03 },
  { id: 'R2-KV-04', run: r2KV04 },
  { id: 'R2-R2-01', run: r2R201 },
  { id: 'R2-R2-02', run: r2R202 },
  { id: 'R2-R2-03', run: r2R203 },
  { id: 'R2-R2-04', run: r2R204 },
  { id: 'R2-Q-01', run: r2Q01 },
];
