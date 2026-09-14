import { describe, expect, it } from 'bun:test';
import worker from '../src/index.js';
import type { WorkerEnv } from '../src/index.js';
import {
  buildDeploymentAttestation,
  buildIdentity,
  evaluateDeploymentIdentity,
  evaluateToolchain,
  readCompatibilityDate,
} from '../src/deployment-identity.js';
import { createEnv } from './harness.js';

const SHA = '45ca3d742767199c0deb9b99dc55986afe52d128';
const OTHER_SHA = '0123456789abcdef0123456789abcdef01234567';
const REPO = 'WasmAgent/open-agent-audit';
const RUN = '34826008312';
const OLD_RUN = '34800000000';

const buildEnv = {
  BUILD_SHA: SHA,
  BUILD_REPOSITORY: REPO,
  BUILD_WORKFLOW_RUN: RUN,
  BUILD_TIMESTAMP: '2026-09-14T12:00:00Z',
  BUILD_PROFILE: 'production',
};

const expected = { sha: SHA, repository: REPO, workflowRun: RUN };

/** The /health payload a healthy R0-compliant deployment must return. */
const healthyPayload = {
  status: 'ok',
  version: '0.1.0',
  env: 'production',
  auth_mode: 'multi_tenant',
  build: { sha: SHA, repository: REPO, workflow_run: RUN },
};

function getHealth(env: WorkerEnv): Promise<Response> {
  return worker.fetch(new Request('https://example.com/health', { method: 'GET' }), env);
}

describe('R0 — build identity serialization', () => {
  it('serializes injected BUILD_* env vars for /health', () => {
    expect(buildIdentity(buildEnv)).toEqual({
      sha: SHA,
      repository: REPO,
      workflow_run: RUN,
      timestamp: '2026-09-14T12:00:00Z',
      profile: 'production',
    });
  });

  it('missing BUILD_* yields nulls (stable /health shape)', () => {
    expect(buildIdentity({})).toEqual({
      sha: null,
      repository: null,
      workflow_run: null,
      timestamp: null,
      profile: null,
    });
  });

  it('blank BUILD_SHA is treated as unset, never as an identity', () => {
    expect(buildIdentity({ BUILD_SHA: '   ' }).sha).toBeNull();
  });

  it('/health exposes the exact build identity (R0-ID-01 happy path)', async () => {
    const env = createEnv({ ...buildEnv, OAA_ENV: 'production', API_KEY: 'secret' });
    const res = await getHealth(env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      status: 'ok',
      env: 'production',
      auth_mode: 'api_key',
      build: { sha: SHA, repository: REPO, workflow_run: RUN },
    });
  });

  it('/health without injected build reports null identity — the probe must fail closed on it', async () => {
    const env = createEnv({ OAA_ENV: 'production', API_KEY: 'secret' });
    const body = (await (await getHealth(env)).json()) as { build: Record<string, unknown> };
    expect(body.build).toEqual({
      sha: null,
      repository: null,
      workflow_run: null,
      timestamp: null,
      profile: null,
    });

    // A null live SHA can never satisfy the exact-SHA assertion.
    const evaluation = evaluateDeploymentIdentity(body, expected);
    expect(evaluation.verdicts.deployment_identity).toBe('fail');
    expect(evaluation.ok).toBe(false);
  });
});

describe('R0 — post-deploy identity evaluation (hostile tests)', () => {
  it('R0-ID-01 matching SHA tuple passes every verdict', () => {
    const evaluation = evaluateDeploymentIdentity(healthyPayload, expected);
    expect(evaluation.checks.find((c) => c.id === 'R0-ID-01')?.pass).toBe(true);
    expect(evaluation.verdicts).toEqual({
      deployment_identity: 'pass',
      security_posture: 'pass',
      service_readiness: 'pass',
    });
    expect(evaluation.ok).toBe(true);
  });

  it('R0-ID-02 live SHA != GitHub SHA fails deployment identity', () => {
    const stale = {
      ...healthyPayload,
      build: { sha: OTHER_SHA, repository: REPO, workflow_run: RUN },
    };
    const evaluation = evaluateDeploymentIdentity(stale, expected);
    expect(evaluation.checks.find((c) => c.id === 'R0-ID-01')?.pass).toBe(false);
    expect(evaluation.verdicts.deployment_identity).toBe('fail');
    expect(evaluation.ok).toBe(false);
  });

  it('R0-ID-03 unavailable /health (no response body) fails everything', () => {
    const evaluation = evaluateDeploymentIdentity(undefined, expected);
    expect(evaluation.checks.find((c) => c.id === 'R0-ID-03')?.pass).toBe(false);
    expect(evaluation.verdicts).toEqual({
      deployment_identity: 'fail',
      security_posture: 'fail',
      service_readiness: 'fail',
    });
    expect(evaluation.ok).toBe(false);
  });

  it('R0-ID-04 env != production fails service readiness', () => {
    const dev = { ...healthyPayload, env: 'staging' };
    const evaluation = evaluateDeploymentIdentity(dev, expected);
    expect(evaluation.checks.find((c) => c.id === 'R0-ID-04')?.pass).toBe(false);
    expect(evaluation.verdicts.service_readiness).toBe('fail');
    // Identity and posture are independent of the readiness failure.
    expect(evaluation.verdicts.deployment_identity).toBe('pass');
    expect(evaluation.ok).toBe(false);
  });

  it('R0-ID-05 auth_mode open fails security posture', () => {
    const open = { ...healthyPayload, auth_mode: 'open' };
    const evaluation = evaluateDeploymentIdentity(open, expected);
    expect(evaluation.checks.find((c) => c.id === 'R0-ID-05')?.pass).toBe(false);
    expect(evaluation.verdicts.security_posture).toBe('fail');
    expect(evaluation.ok).toBe(false);
  });

  it('R0-ID-05 missing auth_mode fails security posture (cannot assert what is absent)', () => {
    const { auth_mode: _omitted, ...noAuth } = healthyPayload;
    const evaluation = evaluateDeploymentIdentity(noAuth, expected);
    expect(evaluation.verdicts.security_posture).toBe('fail');
  });

  it('R0-ID-06 malformed /health payload fails everything', () => {
    for (const payload of ['<html>502 Bad Gateway</html>', 'null', '[1, 2]', '']) {
      const evaluation = evaluateDeploymentIdentity(payload, expected);
      expect(evaluation.checks.find((c) => c.id === 'R0-ID-06')?.pass).toBe(false);
      expect(evaluation.ok).toBe(false);
    }
  });

  it('R0-ID-07 stale revision from an older run fails deployment identity even with the right repo', () => {
    const oldRevision = {
      ...healthyPayload,
      build: { sha: OTHER_SHA, repository: REPO, workflow_run: OLD_RUN },
    };
    const evaluation = evaluateDeploymentIdentity(oldRevision, expected);
    expect(evaluation.checks.find((c) => c.id === 'R0-ID-07')?.pass).toBe(false);
    expect(evaluation.verdicts.deployment_identity).toBe('fail');
  });

  it('R0-ID-07 foreign repository fails the stale guard even when SHA matches', () => {
    const foreign = {
      ...healthyPayload,
      build: { sha: SHA, repository: 'other/repo', workflow_run: RUN },
    };
    const evaluation = evaluateDeploymentIdentity(foreign, expected);
    expect(evaluation.checks.find((c) => c.id === 'R0-ID-07')?.pass).toBe(false);
    expect(evaluation.verdicts.deployment_identity).toBe('fail');
  });
});

describe('R0 — runtime deployment attestation artifact', () => {
  const lockedToolchain = {
    expectedWrangler: '4.131.2',
    lockPin: 'wrangler@4.131.2',
    wranglerVersion: '4.131.2',
    wranglerSource: 'locked' as const,
    deployLog: '⛅ wrangler 4.131.2 deploy --config wrangler.jsonc\nTotal Upload: 100 KiB',
    bunVersion: '1.3.14',
    compatibilityDate: '2026-06-26',
  };

  it('builds the machine-readable artifact for a passing deployment', () => {
    const evaluation = evaluateDeploymentIdentity(healthyPayload, expected);
    const toolchain = evaluateToolchain(lockedToolchain);
    const attestation = buildDeploymentAttestation({
      repository: REPO,
      sourceSha: SHA,
      workflowRun: RUN,
      deploymentTarget: 'trustavo.com',
      observedAt: '2026-09-14T12:00:00.000Z',
      evaluation,
      toolchain,
      toolchainIdentity: {
        bun: '1.3.14',
        wrangler: '4.131.2',
        worker_compatibility_date: '2026-06-26',
      },
      payload: healthyPayload,
    });

    expect(attestation.format).toBe('wasmagent-runtime-deployment/v1');
    expect(attestation.repository).toBe(REPO);
    expect(attestation.source_sha).toBe(SHA);
    expect(attestation.workflow_run).toBe(34826008312);
    expect(attestation.deployment_target).toBe('trustavo.com');
    expect(attestation.observed).toEqual({
      health_status: 'ok',
      environment: 'production',
      auth_mode: 'multi_tenant',
      build_sha: SHA,
    });
    expect(attestation.toolchain).toEqual({
      bun: '1.3.14',
      wrangler: '4.131.2',
      worker_compatibility_date: '2026-06-26',
    });
    expect(attestation.verdicts).toEqual({
      deployment_identity: 'pass',
      security_posture: 'pass',
      service_readiness: 'pass',
      toolchain_reproducibility: 'pass',
    });
    expect(attestation.observed_at).toBe('2026-09-14T12:00:00.000Z');
  });

  it('records observed identity nulls and failing verdicts for a mismatched deployment', () => {
    const stale = {
      ...healthyPayload,
      build: { sha: null, repository: null, workflow_run: null },
    };
    const evaluation = evaluateDeploymentIdentity(stale, expected);
    const attestation = buildDeploymentAttestation({
      repository: REPO,
      sourceSha: SHA,
      workflowRun: RUN,
      deploymentTarget: 'trustavo.com',
      observedAt: '2026-09-14T12:00:00.000Z',
      evaluation,
      toolchain: evaluateToolchain(lockedToolchain),
      toolchainIdentity: {
        bun: '1.3.14',
        wrangler: '4.131.2',
        worker_compatibility_date: '2026-06-26',
      },
      payload: stale,
    });

    expect(attestation.observed.build_sha).toBeNull();
    expect(attestation.verdicts.deployment_identity).toBe('fail');
    expect(attestation.checks.length).toBeGreaterThan(0);
  });

  it('records a failing toolchain verdict alongside a passing identity', () => {
    const evaluation = evaluateDeploymentIdentity(healthyPayload, expected);
    const toolchain = evaluateToolchain({
      ...lockedToolchain,
      wranglerVersion: '3.90.0',
    });
    expect(toolchain.verdict).toBe('fail');

    const attestation = buildDeploymentAttestation({
      repository: REPO,
      sourceSha: SHA,
      workflowRun: RUN,
      deploymentTarget: 'trustavo.com',
      observedAt: '2026-09-14T12:00:00.000Z',
      evaluation,
      toolchain,
      toolchainIdentity: { bun: '1.3.14', wrangler: '3.90.0', worker_compatibility_date: null },
      payload: healthyPayload,
    });
    expect(attestation.verdicts.deployment_identity).toBe('pass');
    expect(attestation.verdicts.toolchain_reproducibility).toBe('fail');
    expect(
      attestation.checks.find((c) => c.id === 'R0-TC-01')?.detail,
    ).toContain('3.90.0');
  });

  it('keeps the workflow_run as a string when it is not numeric', () => {
    const evaluation = evaluateDeploymentIdentity(healthyPayload, expected);
    const attestation = buildDeploymentAttestation({
      repository: REPO,
      sourceSha: SHA,
      workflowRun: 'not-a-number',
      deploymentTarget: 'trustavo.com',
      observedAt: '2026-09-14T12:00:00.000Z',
      evaluation,
      toolchain: evaluateToolchain(lockedToolchain),
      toolchainIdentity: {
        bun: '1.3.14',
        wrangler: '4.131.2',
        worker_compatibility_date: '2026-06-26',
      },
      payload: healthyPayload,
    });
    expect(attestation.workflow_run).toBe('not-a-number');
  });
});

describe('R0.5 — deployment toolchain reproducibility (hostile tests)', () => {
  const good = {
    expectedWrangler: '4.131.2',
    lockPin: 'wrangler@4.131.2',
    wranglerVersion: '4.131.2',
    wranglerSource: 'locked' as const,
    deployLog: 'Total Upload: 100 KiB\nDeployed open-agent-audit triggers',
    bunVersion: '1.3.14',
    compatibilityDate: '2026-06-26',
  };

  it('R0-TC-01 exact wrangler version passes when the running binary matches the pin', () => {
    const toolchain = evaluateToolchain(good);
    expect(toolchain.checks.find((c) => c.id === 'R0-TC-01')?.pass).toBe(true);
    expect(toolchain.verdict).toBe('pass');
  });

  it('R0-TC-01 a dynamically installed wrangler (3.90.0) fails the version gate', () => {
    const toolchain = evaluateToolchain({ ...good, wranglerVersion: '3.90.0' });
    expect(toolchain.checks.find((c) => c.id === 'R0-TC-01')?.pass).toBe(false);
    expect(toolchain.verdict).toBe('fail');
  });

  it('R0-TC-02 non-lockfile wrangler source fails', () => {
    const toolchain = evaluateToolchain({ ...good, wranglerSource: 'unknown' });
    expect(toolchain.checks.find((c) => c.id === 'R0-TC-02')?.pass).toBe(false);
    expect(toolchain.verdict).toBe('fail');
  });

  it('R0-TC-03 a clean deploy log passes the config-field scan', () => {
    const toolchain = evaluateToolchain(good);
    expect(toolchain.checks.find((c) => c.id === 'R0-TC-03')?.pass).toBe(true);
  });

  it('R0-TC-03 unexpected config field warnings fail — the exact 3.90.0 signature', () => {
    const log = 'Unexpected fields found in assets field: "run_worker_first"';
    for (const deployLog of [log, `warning: ${log}`, log.toUpperCase(), 'unknown field "foo"']) {
      const toolchain = evaluateToolchain({ ...good, deployLog });
      expect(toolchain.checks.find((c) => c.id === 'R0-TC-03')?.pass).toBe(false);
      expect(toolchain.verdict).toBe('fail');
    }
  });

  it('R0-TC-03 a missing deploy log cannot prove the tool understood the config', () => {
    const toolchain = evaluateToolchain({ ...good, deployLog: null });
    expect(toolchain.checks.find((c) => c.id === 'R0-TC-03')?.pass).toBe(false);
    expect(toolchain.verdict).toBe('fail');
  });

  it('R0-TC-04 lockfile pin drift fails', () => {
    const toolchain = evaluateToolchain({ ...good, lockPin: 'wrangler@3.90.0' });
    expect(toolchain.checks.find((c) => c.id === 'R0-TC-04')?.pass).toBe(false);
    expect(toolchain.verdict).toBe('fail');
  });

  it('readCompatibilityDate parses JSONC with comments and URL values', () => {
    const jsonc = `{
      // deployment target — see https://developers.cloudflare.com/workers
      "name": "open-agent-audit",
      "compatibility_date": "2026-06-26",
      "routes": [{ "pattern": "trustavo.com", "custom_domain": true }]
    }`;
    expect(readCompatibilityDate(jsonc)).toBe('2026-06-26');
    expect(readCompatibilityDate('{"name":"x"}')).toBeNull();
    expect(readCompatibilityDate('not json {')).toBeNull();
  });
});
