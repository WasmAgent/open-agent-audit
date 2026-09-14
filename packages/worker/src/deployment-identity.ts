/**
 * R0 — Deployment identity (WasmAgent runtime assurance program).
 *
 * Proves the chain GitHub source SHA → deploy workflow → Cloudflare Worker →
 * live production endpoint by (1) serializing the injected build metadata for
 * GET /health and (2) evaluating the post-deploy /health observation against
 * the deploying workflow's expected identity.
 *
 * Kept dependency-free and worker-import-free so the hostile-test semantics
 * (R0-ID-01..07) stay unit-testable; the CLI in `scripts/verify-deployment.ts`
 * wires this to the network and the attestation file, and
 * `.github/workflows/deploy.yml` fails the deploy job on any failing verdict.
 */

// ---------------------------------------------------------------------------
// Build identity — serialized into /health
// ---------------------------------------------------------------------------

/**
 * Env vars carrying deployment identity. Injected exclusively by
 * `.github/workflows/deploy.yml` from `github.sha` / `github.repository` /
 * `github.run_id` — never from user input. Unset in local dev.
 */
export interface BuildIdentityEnv {
  BUILD_SHA?: string;
  BUILD_REPOSITORY?: string;
  BUILD_WORKFLOW_RUN?: string;
  BUILD_TIMESTAMP?: string;
  BUILD_PROFILE?: string;
}

/** Stable-shape build identity reported by GET /health (`null` when unset). */
export interface BuildIdentity {
  sha: string | null;
  repository: string | null;
  workflow_run: string | null;
  timestamp: string | null;
  profile: string | null;
}

/** Blank/unset vars normalize to `null` so /health always has the same shape. */
export function buildIdentity(env: BuildIdentityEnv): BuildIdentity {
  const field = (raw: string | undefined): string | null => {
    if (raw === undefined) return null;
    const trimmed = raw.trim();
    return trimmed === '' ? null : trimmed;
  };
  return {
    sha: field(env.BUILD_SHA),
    repository: field(env.BUILD_REPOSITORY),
    workflow_run: field(env.BUILD_WORKFLOW_RUN),
    timestamp: field(env.BUILD_TIMESTAMP),
    profile: field(env.BUILD_PROFILE),
  };
}

// ---------------------------------------------------------------------------
// Post-deploy identity evaluation
// ---------------------------------------------------------------------------

/** Identity tuple expected from the deploying GitHub Actions workflow. */
export interface ExpectedDeploymentIdentity {
  /** `github.sha` — the exact source SHA the deploy was triggered for. */
  sha: string;
  /** `github.repository` — guards against serving a revision from another repo. */
  repository: string;
  /** `github.run_id` — guards against a stale revision from an earlier run. */
  workflowRun: string;
}

/** One evaluated R0 hostile test; recorded verbatim in the attestation. */
export interface DeploymentIdentityCheck {
  id: string;
  description: string;
  pass: boolean;
  detail: string;
}

export interface DeploymentIdentityVerdicts {
  deployment_identity: 'pass' | 'fail';
  security_posture: 'pass' | 'fail';
  service_readiness: 'pass' | 'fail';
}

export interface DeploymentIdentityEvaluation {
  verdicts: DeploymentIdentityVerdicts;
  checks: DeploymentIdentityCheck[];
  /** True only when every verdict passes; drives the CLI/job exit code. */
  ok: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Non-empty string, else `null` (a missing identity can never read as a match). */
function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Evaluate a live /health payload against the expected deployment identity.
 *
 * Check ids mirror the R0 hostile tests:
 * - `R0-ID-01` live build.sha == expected source SHA (its failing modes are
 *   R0-ID-02 mismatched SHA and R0-ID-07 stale revision still serving).
 * - `R0-ID-03` /health reachable — a response body was captured at all.
 * - `R0-ID-04` env == production.
 * - `R0-ID-05` auth_mode present and not `open`.
 * - `R0-ID-06` payload is a well-formed JSON object.
 * - `R0-ID-07` repository + workflow_run match (a revision from an older run
 *   or another repo cannot carry this run's pair).
 *
 * Every verdict requires a well-formed payload: an unavailable or malformed
 * /health fails closed across the board instead of proving nothing.
 */
export function evaluateDeploymentIdentity(
  payload: unknown,
  expected: ExpectedDeploymentIdentity,
): DeploymentIdentityEvaluation {
  const captured = payload !== undefined;
  const wellFormed = isRecord(payload);
  const body: Record<string, unknown> = wellFormed ? payload : {};
  const build = isRecord(body.build) ? body.build : {};

  const liveSha = nonEmptyString(build.sha);
  const liveRepository = nonEmptyString(build.repository);
  const liveWorkflowRun = nonEmptyString(build.workflow_run);
  const liveAuthMode = nonEmptyString(body.auth_mode);

  const statusOk = body.status === 'ok';
  const shaMatch = liveSha !== null && liveSha === expected.sha;
  const staleGuardPass = liveRepository === expected.repository && liveWorkflowRun === expected.workflowRun;
  const envProduction = body.env === 'production';
  const authNotOpen = liveAuthMode !== null && liveAuthMode !== 'open';

  const checks: DeploymentIdentityCheck[] = [
    {
      id: 'R0-ID-03',
      description: '/health responded with a body',
      pass: captured,
      detail: captured ? 'response body captured' : 'no response body captured (endpoint unavailable)',
    },
    {
      id: 'R0-ID-06',
      description: '/health payload is a well-formed JSON object',
      pass: wellFormed,
      detail: wellFormed ? 'payload is a JSON object' : 'payload missing or not a JSON object',
    },
    {
      id: 'R0-ID-01',
      description:
        'live build.sha equals the GitHub source SHA (R0-ID-02 mismatch and R0-ID-07 stale revision are its failing modes)',
      pass: shaMatch,
      detail: `expected ${expected.sha}, live ${liveSha ?? '<none>'}`,
    },
    {
      id: 'R0-ID-07',
      description: 'live build.repository/workflow_run equal the deploying workflow (stale-revision guard)',
      pass: staleGuardPass,
      detail: `expected ${expected.repository} @ run ${expected.workflowRun}, live ${liveRepository ?? '<none>'} @ run ${liveWorkflowRun ?? '<none>'}`,
    },
    {
      id: 'R0-ID-04',
      description: '/health env is production',
      pass: envProduction,
      detail: `live env ${nonEmptyString(body.env) ?? '<none>'}`,
    },
    {
      id: 'R0-ID-05',
      description: 'production auth_mode is present and not open',
      pass: authNotOpen,
      detail: `live auth_mode ${liveAuthMode ?? '<none>'}`,
    },
  ];

  const verdicts: DeploymentIdentityVerdicts = {
    // Deployment identity: the live revision is exactly this workflow's build.
    deployment_identity: wellFormed && shaMatch && staleGuardPass ? 'pass' : 'fail',
    // Security posture: production is never served open.
    security_posture: wellFormed && authNotOpen ? 'pass' : 'fail',
    // Service readiness: reachable, healthy, and serving the production env.
    service_readiness: wellFormed && statusOk && envProduction ? 'pass' : 'fail',
  };

  return {
    verdicts,
    checks: [
      ...checks,
      {
        id: 'R0-STATUS',
        description: '/health status is ok',
        pass: statusOk,
        detail: `live status ${nonEmptyString(body.status) ?? '<none>'}`,
      },
    ],
    ok: Object.values(verdicts).every((verdict) => verdict === 'pass'),
  };
}

// ---------------------------------------------------------------------------
// Runtime deployment attestation artifact
// ---------------------------------------------------------------------------

export interface RuntimeDeploymentAttestation {
  format: 'wasmagent-runtime-deployment/v1';
  repository: string;
  source_sha: string;
  workflow_run: number | string;
  deployment_target: string;
  observed: {
    health_status: string | null;
    environment: string | null;
    auth_mode: string | null;
    build_sha: string | null;
  };
  verdicts: DeploymentIdentityVerdicts;
  checks: DeploymentIdentityCheck[];
  observed_at: string;
}

export interface DeploymentAttestationInput {
  repository: string;
  sourceSha: string;
  workflowRun: string;
  deploymentTarget: string;
  observedAt: string;
  evaluation: DeploymentIdentityEvaluation;
  payload: unknown;
}

/**
 * Machine-readable R0 evidence (`runtime-deployment-attestation.json`).
 *
 * This proves deployment identity and security posture for the exact
 * source/SHA tuple below. It is NOT runtime release provenance (R4) — do not
 * upgrade `release_provenance` from this artifact alone.
 */
export function buildDeploymentAttestation(
  input: DeploymentAttestationInput,
): RuntimeDeploymentAttestation {
  const payload: unknown = input.payload;
  const wellFormed = isRecord(payload);
  const body: Record<string, unknown> = wellFormed ? payload : {};
  const build = isRecord(body.build) ? body.build : {};
  const workflowRunNumber = Number.parseInt(input.workflowRun, 10);

  return {
    format: 'wasmagent-runtime-deployment/v1',
    repository: input.repository,
    source_sha: input.sourceSha,
    workflow_run: Number.isFinite(workflowRunNumber) ? workflowRunNumber : input.workflowRun,
    deployment_target: input.deploymentTarget,
    observed: {
      health_status: nonEmptyString(body.status),
      environment: nonEmptyString(body.env),
      auth_mode: nonEmptyString(body.auth_mode),
      build_sha: nonEmptyString(build.sha),
    },
    verdicts: input.evaluation.verdicts,
    checks: input.evaluation.checks,
    observed_at: input.observedAt,
  };
}
