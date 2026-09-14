import { describe, expect, it } from 'bun:test';
import worker from '../src/index.js';
import type { WorkerEnv } from '../src/index.js';
import { createEnv, dbOf } from './harness.js';

const AUTH = { Authorization: 'Bearer secret' };

function call(env: WorkerEnv, method: string, path: string, body?: unknown): Promise<Response> {
  const init: RequestInit = { method, headers: AUTH };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { ...AUTH, 'content-type': 'application/json' };
  }
  return worker.fetch(new Request(`https://example.com${path}`, init), env);
}

async function json<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

const REPORT = {
  run_id: 'run-1',
  evidence_admission_score: { score: 85, grade: 'B' },
  findings: [],
};

function passportEnv(): WorkerEnv {
  return createEnv({ API_KEY: 'secret', TENANT_ID: 'tenant-a', OAA_ENV: 'test' });
}

async function issuePassport(env: WorkerEnv): Promise<string> {
  const res = await call(env, 'POST', '/passport/issue', { report: REPORT, agentId: 'agent-1' });
  expect(res.status).toBe(201);
  const body = await json<{ identity: { passport_id: string } }>(res);
  return body.identity.passport_id;
}

async function statusOf(env: WorkerEnv, id: string) {
  return json<{
    status: string;
    verification: { revocation_status: string };
  }>(await call(env, 'GET', `/passport/${id}/status`));
}

describe('N4-RV — authoritative passport revocation (N4-P1-03)', () => {
  it('N4-RV-01 stale KV-negative cannot yield authoritative ACTIVE', async () => {
    const env = passportEnv();
    const id = await issuePassport(env);
    await call(env, 'POST', `/passport/${id}/revoke`, { reason: 'x' });

    // Simulate an eventually-consistent KV mirror that has not yet observed the
    // revocation (or was purged): D1 remains authoritative.
    await env.PASSPORTS.delete(`revocation:${id}`);

    const body = await statusOf(env, id);
    expect(body.verification.revocation_status).toBe('revoked');
    expect(body.status).toBe('revoked');
  });

  it('N4-RV-02 100 concurrent revokes produce exactly one transition', async () => {
    const env = passportEnv();
    const id = await issuePassport(env);

    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        call(env, 'POST', `/passport/${id}/revoke`, { reason: `race-${i}` }),
      ),
    );
    const codes = results.map((r) => r.status);
    expect(codes.filter((c) => c === 200)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(99);

    const rows = dbOf(env)
      .db.query('SELECT COUNT(*) AS c FROM passport_revocations WHERE passport_id = ?')
      .get(id) as { c: number };
    expect(rows.c).toBe(1);
  });

  it('N4-RV-03 retry is idempotent and cannot resurrect', async () => {
    const env = passportEnv();
    const id = await issuePassport(env);
    expect((await call(env, 'POST', `/passport/${id}/revoke`, { reason: 'a' })).status).toBe(200);
    expect((await call(env, 'POST', `/passport/${id}/revoke`, { reason: 'b' })).status).toBe(409);
    expect((await statusOf(env, id)).verification.revocation_status).toBe('revoked');
  });

  it('N4-RV-04 registry unavailable reports UNKNOWN, not ACTIVE', async () => {
    const env = passportEnv();
    const id = await issuePassport(env);

    // Force the authoritative registry to fail.
    env.DB = {
      prepare() {
        throw new Error('registry unavailable');
      },
    } as unknown as D1Database;

    const body = await statusOf(env, id);
    expect(body.verification.revocation_status).toBe('unknown');
    expect(body.status).toBe('unknown');
  });

  it('self-bootstraps the authoritative table when it is missing', async () => {
    const env = passportEnv();
    const id = await issuePassport(env);

    // Simulate a deployed D1 database without migration 0006 applied.
    dbOf(env).db.run('DROP TABLE IF EXISTS passport_revocations');

    const res = await call(env, 'POST', `/passport/${id}/revoke`, { reason: 'bootstrap' });
    expect(res.status).toBe(200);
    expect((await statusOf(env, id)).verification.revocation_status).toBe('revoked');
  });

  it('legacy KV revocation is still honoured and backfilled into D1', async () => {
    const env = passportEnv();
    const id = await issuePassport(env);

    // Simulate a revocation written before D1 became authoritative.
    await env.PASSPORTS.put(
      `revocation:${id}`,
      JSON.stringify({
        type: 'TrustPassportRevocation',
        passport_id: id,
        status: 'revoked',
        reason: 'legacy',
        effective_at: new Date().toISOString(),
        sequence: 1,
        issuer: 'legacy',
      }),
    );

    const body = await statusOf(env, id);
    expect(body.verification.revocation_status).toBe('revoked');

    const row = dbOf(env)
      .db.query('SELECT passport_id FROM passport_revocations WHERE passport_id = ?')
      .get(id) as { passport_id: string } | null;
    expect(row?.passport_id).toBe(id);
  });
});
