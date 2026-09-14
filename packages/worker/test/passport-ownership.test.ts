import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import worker from '../src/index.js';
import type { WorkerEnv } from '../src/index.js';
import { createEnv, dbOf, seedRun } from './harness.js';

const MULTI_KEYS = JSON.stringify({ 'key-a': 'tenant-a', 'key-b': 'tenant-b' });

function req(path: string, init: RequestInit = {}): Request {
  return new Request(`https://example.com${path}`, init);
}

function call(
  env: WorkerEnv,
  method: string,
  path: string,
  token: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, ...extraHeaders };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers['content-type'] = 'application/json';
  }
  return worker.fetch(req(path, init), env);
}

async function json<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

interface CanonicalReport {
  schema_version: string;
  generated_at: string;
  run_id: string;
  risk_score: { evidence_admission_score: { score: number; grade: string } };
  findings: Array<Record<string, unknown>>;
  meta: { profiles_applied: string[] };
}

async function seedCanonicalRun(
  env: WorkerEnv,
  options: {
    runId: string;
    tenantId: string;
    eas?: number;
    findings?: Array<Record<string, unknown>>;
  },
): Promise<CanonicalReport> {
  const { runId, tenantId, eas = 55, findings = [] } = options;
  seedRun(env, { runId, tenantId, eas });
  const report: CanonicalReport = {
    schema_version: 'open-agent-audit/v0.1',
    generated_at: '2026-09-01T00:00:01.000Z',
    run_id: runId,
    risk_score: { evidence_admission_score: { score: eas, grade: 'C' } },
    findings,
    meta: { profiles_applied: ['owasp-agentic-top10-2026'] },
  };
  await env.REPORTS.put(`runs/${runId}/report.json`, JSON.stringify(report));
  return report;
}

async function issueViaRun(
  env: WorkerEnv,
  token: string,
  runId: string,
  extra: Record<string, unknown> = {},
): Promise<Response> {
  return call(env, 'POST', '/passport/issue', token, {
    runId,
    agentId: 'agent-1',
    ...extra,
  });
}

async function passportIdOf(env: WorkerEnv, token: string, runId: string): Promise<string> {
  const res = await issueViaRun(env, token, runId);
  expect(res.status).toBe(201);
  const body = await json<{ identity: { passport_id: string } }>(res);
  return body.identity.passport_id;
}

function ownerRow(env: WorkerEnv, passportId: string): { tenant_id: string } | null {
  return dbOf(env)
    .db.query('SELECT tenant_id FROM passport_issuances WHERE passport_id = ?')
    .get(passportId) as { tenant_id: string } | null;
}

function multiTenantEnv(): WorkerEnv {
  return createEnv({ OAA_ENV: 'production', TENANT_API_KEYS: MULTI_KEYS });
}

/** Force any D1 statement touching the ownership table to fail. */
function breakOwnershipRegistry(env: WorkerEnv): void {
  const real = env.DB;
  env.DB = {
    prepare(sql: string) {
      if (sql.includes('passport_issuances')) throw new Error('ownership registry unavailable');
      return real.prepare(sql);
    },
    exec(sql: string) {
      if (sql.includes('passport_issuances')) throw new Error('ownership registry unavailable');
      return real.exec(sql);
    },
  } as unknown as D1Database;
}

describe('N5-PT — passport tenant write authority (N5-P0-01)', () => {
  it('N5-PT-01 tenant A issues Passport -> D1 owner = tenant A', async () => {
    const env = multiTenantEnv();
    await seedCanonicalRun(env, { runId: 'run-a', tenantId: 'tenant-a' });

    const id = await passportIdOf(env, 'key-a', 'run-a');
    expect(ownerRow(env, id)?.tenant_id).toBe('tenant-a');
  });

  it('N5-PT-02 tenant A cannot revoke tenant B Passport -> 404', async () => {
    const env = multiTenantEnv();
    await seedCanonicalRun(env, { runId: 'run-a', tenantId: 'tenant-a' });
    await seedCanonicalRun(env, { runId: 'run-b', tenantId: 'tenant-b' });

    const id = await passportIdOf(env, 'key-b', 'run-b');
    const res = await call(env, 'POST', `/passport/${id}/revoke`, 'key-a', { reason: 'hostile' });
    expect(res.status).toBe(404);

    const revocations = dbOf(env)
      .db.query('SELECT COUNT(*) AS c FROM passport_revocations WHERE passport_id = ?')
      .get(id) as { c: number };
    expect(revocations.c).toBe(0);

    // The legitimate owner can still revoke.
    expect((await call(env, 'POST', `/passport/${id}/revoke`, 'key-b', { reason: 'ok' })).status).toBe(
      200,
    );
  });

  it('N5-PT-03 tenant A cannot renew tenant B Passport -> 404', async () => {
    const env = multiTenantEnv();
    await seedCanonicalRun(env, { runId: 'run-a', tenantId: 'tenant-a' });
    await seedCanonicalRun(env, { runId: 'run-b', tenantId: 'tenant-b' });

    const id = await passportIdOf(env, 'key-b', 'run-b');
    const res = await call(env, 'POST', `/passport/${id}/renew`, 'key-a', { validityDays: 10 });
    expect(res.status).toBe(404);

    const stamped = dbOf(env)
      .db.query('SELECT COUNT(*) AS c FROM passport_issuances WHERE passport_id != ?')
      .get(id) as { c: number };
    expect(stamped.c).toBe(0);
  });

  it('N5-PT-04 forged X-Tenant-Id cannot change Passport authority', async () => {
    const env = multiTenantEnv();
    await seedCanonicalRun(env, { runId: 'run-a', tenantId: 'tenant-a' });
    await seedCanonicalRun(env, { runId: 'run-b', tenantId: 'tenant-b' });

    // A issues while claiming tenant-b: ownership must follow the key, not the header.
    const forgedIssue = await call(
      env,
      'POST',
      '/passport/issue',
      'key-a',
      { runId: 'run-a', agentId: 'agent-2' },
      { 'X-Tenant-Id': 'tenant-b' },
    );
    expect(forgedIssue.status).toBe(201);
    const forgedId = (await json<{ identity: { passport_id: string } }>(forgedIssue)).identity
      .passport_id;
    expect(ownerRow(env, forgedId)?.tenant_id).toBe('tenant-a');

    // A revoking B's passport while claiming tenant-b must still fail.
    const bId = await passportIdOf(env, 'key-b', 'run-b');
    const forgedRevoke = await call(
      env,
      'POST',
      `/passport/${bId}/revoke`,
      'key-a',
      { reason: 'forged' },
      { 'X-Tenant-Id': 'tenant-b' },
    );
    expect(forgedRevoke.status).toBe(404);
  });

  it('N5-PT-05 tenant A cannot issue from tenant B audit run/report', async () => {
    const env = multiTenantEnv();
    await seedCanonicalRun(env, { runId: 'run-a', tenantId: 'tenant-a' });
    await seedCanonicalRun(env, { runId: 'run-b', tenantId: 'tenant-b' });

    const res = await issueViaRun(env, 'key-a', 'run-b');
    expect(res.status).toBe(404);

    const count = dbOf(env).db.query('SELECT COUNT(*) AS c FROM passport_issuances').get() as {
      c: number;
    };
    expect(count.c).toBe(0);
  });

  it('N5-PT-06 unowned Passport in multi-tenant write path fails closed', async () => {
    const env = multiTenantEnv();
    // A Passport document with no authoritative owner row (legacy / orphan).
    const orphan = {
      passport_version: '0.1',
      identity: { passport_id: 'tp-orphan', agent_id: 'a', issuer: 'trustavo.com' },
      audit_ref: { report_id: 'run-x', report_hash: 'deadbeef', generated_at: 't' },
      validity: { issued_at: '2026-01-01T00:00:00.000Z', expires_at: '2027-01-01T00:00:00.000Z' },
      revocation: { revoked: false },
      attestation: { issuer: 'trustavo.com', signing_method: 'none' },
    };
    await env.PASSPORTS.put('tp-orphan', JSON.stringify(orphan));

    expect((await call(env, 'POST', '/passport/tp-orphan/revoke', 'key-a', { reason: 'x' })).status)
      .toBe(404);
    expect((await call(env, 'POST', '/passport/tp-orphan/renew', 'key-a', { validityDays: 5 }))
      .status).toBe(404);
  });

  it('N5-PT-07 ownership registry unavailable -> issue/revoke/renew fail closed', async () => {
    const env = multiTenantEnv();
    await seedCanonicalRun(env, { runId: 'run-a', tenantId: 'tenant-a' });

    // Issue fails closed and rolls back the stored document.
    breakOwnershipRegistry(env);
    const issueRes = await issueViaRun(env, 'key-a', 'run-a');
    expect(issueRes.status).toBe(503);
    const keys = await env.PASSPORTS.list();
    expect(keys.keys).toHaveLength(0);

    // Revoke/renew fail closed on an existing, owned Passport.
    const env2 = multiTenantEnv();
    await seedCanonicalRun(env2, { runId: 'run-a', tenantId: 'tenant-a' });
    const id = await passportIdOf(env2, 'key-a', 'run-a');
    breakOwnershipRegistry(env2);
    expect((await call(env2, 'POST', `/passport/${id}/revoke`, 'key-a', { reason: 'x' })).status)
      .toBe(503);
    expect((await call(env2, 'POST', `/passport/${id}/renew`, 'key-a', { validityDays: 5 }))
      .status).toBe(503);
  });

  it('N5-PT-08 renewal preserves tenant owner on new Passport', async () => {
    const env = multiTenantEnv();
    await seedCanonicalRun(env, { runId: 'run-a', tenantId: 'tenant-a' });

    const id = await passportIdOf(env, 'key-a', 'run-a');
    const res = await call(env, 'POST', `/passport/${id}/renew`, 'key-a', { validityDays: 30 });
    expect(res.status).toBe(200);
    const renewed = await json<{ identity: { passport_id: string; renewed_from: string } }>(res);

    expect(renewed.identity.renewed_from).toBe(id);
    expect(ownerRow(env, renewed.identity.passport_id)?.tenant_id).toBe('tenant-a');
  });

  it('N5-PT-09 concurrent cross-tenant revoke attempts never mutate foreign Passport', async () => {
    const env = multiTenantEnv();
    await seedCanonicalRun(env, { runId: 'run-a', tenantId: 'tenant-a' });
    await seedCanonicalRun(env, { runId: 'run-b', tenantId: 'tenant-b' });

    const id = await passportIdOf(env, 'key-b', 'run-b');

    const attempts = await Promise.all([
      ...Array.from({ length: 20 }, () =>
        call(env, 'POST', `/passport/${id}/revoke`, 'key-a', { reason: 'foreign' }),
      ),
      ...Array.from({ length: 20 }, () =>
        call(env, 'POST', `/passport/${id}/revoke`, 'key-b', { reason: 'owner' }),
      ),
    ]);
    const codes = attempts.map((r) => r.status);
    expect(codes.filter((c) => c === 404)).toHaveLength(20);
    expect(codes.filter((c) => c === 200)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(19);

    const rows = dbOf(env)
      .db.query('SELECT COUNT(*) AS c FROM passport_revocations WHERE passport_id = ?')
      .get(id) as { c: number };
    expect(rows.c).toBe(1);
  });

  it('N5-PT-10 single-tenant existing behavior remains valid', async () => {
    const env = createEnv({ API_KEY: 'secret', TENANT_ID: 'tenant-a', OAA_ENV: 'test' });

    // Single-tenant direct (dev/self-asserted) issuance still works.
    const issueRes = await call(env, 'POST', '/passport/issue', 'secret', {
      report: { run_id: 'run-1', evidence_admission_score: { score: 85, grade: 'B' }, findings: [] },
      agentId: 'agent-1',
    });
    expect(issueRes.status).toBe(201);
    const id = (await json<{ identity: { passport_id: string } }>(issueRes)).identity.passport_id;
    expect(ownerRow(env, id)?.tenant_id).toBe('tenant-a');

    expect((await call(env, 'POST', `/passport/${id}/revoke`, 'secret', { reason: 'x' })).status).toBe(
      200,
    );
    const status = await json<{ verification: { revocation_status: string } }>(
      await call(env, 'GET', `/passport/${id}/status`, 'secret'),
    );
    expect(status.verification.revocation_status).toBe('revoked');
  });
});

describe('N5-EV — production issuance evidence provenance (N5-P1-01)', () => {
  it('N5-EV-01 unknown runId cannot issue production Passport', async () => {
    const env = multiTenantEnv();
    const res = await issueViaRun(env, 'key-a', 'run-does-not-exist');
    expect(res.status).toBe(404);
  });

  it('N5-EV-01b production rejects caller-supplied report', async () => {
    const env = multiTenantEnv();
    const res = await call(env, 'POST', '/passport/issue', 'key-a', {
      report: { run_id: 'run-a', evidence_admission_score: { score: 100 }, findings: [] },
      agentId: 'agent-1',
    });
    expect(res.status).toBe(400);
  });

  it('N5-EV-02 foreign-tenant runId cannot issue', async () => {
    const env = multiTenantEnv();
    await seedCanonicalRun(env, { runId: 'run-b', tenantId: 'tenant-b' });
    expect((await issueViaRun(env, 'key-a', 'run-b')).status).toBe(404);
  });

  it('owned run without a canonical report fails closed', async () => {
    const env = multiTenantEnv();
    seedRun(env, { runId: 'run-a', tenantId: 'tenant-a' });
    // No runs/run-a/report.json persisted yet.
    expect((await issueViaRun(env, 'key-a', 'run-a')).status).toBe(409);
  });

  it('N5-EV-03 persisted canonical report digest == Passport audit_ref.report_hash', async () => {
    const env = multiTenantEnv();
    const report = await seedCanonicalRun(env, { runId: 'run-a', tenantId: 'tenant-a', eas: 72 });

    const res = await issueViaRun(env, 'key-a', 'run-a');
    expect(res.status).toBe(201);
    const passport = await json<{ audit_ref: { report_id: string; report_hash: string } }>(res);

    const expected = createHash('sha256').update(JSON.stringify(report)).digest('hex');
    expect(passport.audit_ref.report_id).toBe('run-a');
    expect(passport.audit_ref.report_hash).toBe(expected);
  });

  it('N5-EV-04 caller-modified report cannot override stored evidence', async () => {
    const env = multiTenantEnv();
    await seedCanonicalRun(env, { runId: 'run-a', tenantId: 'tenant-a', eas: 42 });

    const res = await issueViaRun(env, 'key-a', 'run-a', {
      report: {
        run_id: 'run-a',
        evidence_admission_score: { score: 100, grade: 'A' },
        findings: [{ severity: 'critical' }, { severity: 'critical' }],
      },
    });
    expect(res.status).toBe(201);
    const passport = await json<{
      evidence_summary: { eas_score: number; evidence_quality: string };
      risk_summary: { critical: number; open_findings: number };
      audit_ref: { report_hash: string };
    }>(res);

    expect(passport.evidence_summary.eas_score).toBe(42);
    expect(passport.evidence_summary.evidence_quality).toBe('low');
    expect(passport.risk_summary.critical).toBe(0);
    expect(passport.risk_summary.open_findings).toBe(0);

    const stored = await env.REPORTS.get('runs/run-a/report.json');
    const expected = createHash('sha256')
      .update(JSON.stringify(JSON.parse((await stored?.text()) ?? '{}')))
      .digest('hex');
    expect(passport.audit_ref.report_hash).toBe(expected);
  });
});
