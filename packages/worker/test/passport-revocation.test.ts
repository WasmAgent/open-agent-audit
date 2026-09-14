import { describe, expect, it } from 'bun:test';
import worker from '../src/index.js';
import type { WorkerEnv } from '../src/index.js';
import { createEnv } from './harness.js';

const AUTH = { Authorization: 'Bearer secret' };

function call(
  env: WorkerEnv,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
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

describe('N2-PP — worker passport revocation', () => {
  it('external revocation does not mutate the stored passport', async () => {
    const env = passportEnv();
    const id = await issuePassport(env);

    const before = await json<Record<string, unknown>>(await call(env, 'GET', `/passport/${id}`));

    const revoke = await call(env, 'POST', `/passport/${id}/revoke`, { reason: 'compromised' });
    expect(revoke.status).toBe(200);
    const record = await json<{ type: string; status: string; passport_id: string }>(revoke);
    expect(record.type).toBe('TrustPassportRevocation');
    expect(record.status).toBe('revoked');
    expect(record.passport_id).toBe(id);

    const after = await json<Record<string, unknown>>(await call(env, 'GET', `/passport/${id}`));
    expect(after).toEqual(before);
    expect((after.revocation as { revoked?: boolean }).revoked).toBe(false);
  });

  it('status reports layered revoked state after external revocation', async () => {
    const env = passportEnv();
    const id = await issuePassport(env);
    await call(env, 'POST', `/passport/${id}/revoke`, { reason: 'x' });

    const body = await json<{
      status: string;
      verification: {
        issuance_authenticity: string;
        revocation_status: string;
        revocation_authenticity: string;
        status_freshness: string;
      };
      revocation: { sequence: number };
    }>(await call(env, 'GET', `/passport/${id}/status`));

    expect(body.status).toBe('revoked');
    expect(body.verification.revocation_status).toBe('revoked');
    expect(body.verification.revocation_authenticity).toBe('not-present');
    expect(body.verification.status_freshness).toBe('current');
    expect(body.revocation.sequence).toBe(1);
  });

  it('double revoke is rejected and cannot resurrect', async () => {
    const env = passportEnv();
    const id = await issuePassport(env);
    expect((await call(env, 'POST', `/passport/${id}/revoke`, { reason: 'a' })).status).toBe(200);
    expect((await call(env, 'POST', `/passport/${id}/revoke`, { reason: 'b' })).status).toBe(409);
  });

  it('a revoked passport cannot be renewed', async () => {
    const env = passportEnv();
    const id = await issuePassport(env);
    await call(env, 'POST', `/passport/${id}/revoke`, { reason: 'x' });
    const renew = await call(env, 'POST', `/passport/${id}/renew`, { validityDays: 30 });
    expect(renew.status).toBe(409);
  });

  it('revoking an unknown passport returns 404', async () => {
    const env = passportEnv();
    const res = await call(env, 'POST', '/passport/does-not-exist/revoke', { reason: 'x' });
    expect(res.status).toBe(404);
  });

  it('status is active before revocation', async () => {
    const env = passportEnv();
    const id = await issuePassport(env);
    const body = await json<{ status: string; verification: { revocation_status: string } }>(
      await call(env, 'GET', `/passport/${id}/status`),
    );
    expect(body.status).toBe('valid');
    expect(body.verification.revocation_status).toBe('active');
  });

  it('N3-P1-07 unsigned worker issuance reports issuance authenticity not-present', async () => {
    const env = passportEnv();
    const id = await issuePassport(env);
    const body = await json<{ verification: { issuance_authenticity: string } }>(
      await call(env, 'GET', `/passport/${id}/status`),
    );
    expect(body.verification.issuance_authenticity).toBe('not-present');
  });

  it('N3-P1-08 renewal mints a new issuance and leaves the original untouched', async () => {
    const env = passportEnv();
    const id = await issuePassport(env);
    const before = await json<{ validity: { expires_at: string } }>(
      await call(env, 'GET', `/passport/${id}`),
    );

    const renewRes = await call(env, 'POST', `/passport/${id}/renew`, { validityDays: 30 });
    expect(renewRes.status).toBe(200);
    const renewed = await json<{ identity: { passport_id: string; renewed_from?: string } }>(renewRes);
    expect(renewed.identity.passport_id).not.toBe(id);
    expect(renewed.identity.renewed_from).toBe(id);

    // The original issuance is immutable; the new issuance is separately stored.
    const after = await json<{ validity: { expires_at: string } }>(
      await call(env, 'GET', `/passport/${id}`),
    );
    expect(after.validity.expires_at).toBe(before.validity.expires_at);
    expect((await call(env, 'GET', `/passport/${renewed.identity.passport_id}`)).status).toBe(200);
  });
});
