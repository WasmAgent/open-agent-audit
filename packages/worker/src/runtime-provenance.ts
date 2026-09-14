/**
 * R4 — runtime release provenance validator (truth rules).
 *
 * Structural work for R4 only. An artifact that does not exist yet, a passing
 * validator, and closed R0 gates do NOT upgrade `release_provenance` to pass:
 * until a real relayed runtime artifact binds source SHA, deployment identity,
 * and a passing R1 smoke, release provenance stays `not_run`.
 *
 * Pure module — no network, no worker-runtime imports.
 */

export interface ProvenanceCheck {
  id: string;
  pass: boolean;
  detail: string;
}

export interface ProvenanceValidation {
  checks: ProvenanceCheck[];
  ok: boolean;
}

const GIT_SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Validate a runtime release provenance artifact against the R4 truth rules:
 * - R4-SCHEMA-01  source SHA present (40-hex)
 * - R4-SCHEMA-02  observed live SHA equals the source SHA
 * - R4-SCHEMA-03  R0 artifact digest present
 * - R4-SCHEMA-04  a `pass` verdict requires a passing R1 production smoke
 * - R4-SCHEMA-05  Cloudflare deployment/version id is a well-formed UUID
 * - R4-SCHEMA-06  (baseline) a fully valid, complete artifact passes
 */
export function validateRuntimeProvenance(artifact: unknown): ProvenanceValidation {
  const checks: ProvenanceCheck[] = [];

  const wellFormed =
    isRecord(artifact) &&
    artifact.format === 'wasmagent-runtime-release-provenance/v1' &&
    isRecord(artifact.source) &&
    isRecord(artifact.build) &&
    isRecord(artifact.deployment) &&
    isRecord(artifact.runtime) &&
    nonEmpty((artifact as { observed_at?: unknown }).observed_at) &&
    ISO_TS.test(artifact.observed_at as string);

  checks.push({
    id: 'R4-SCHEMA-00',
    pass: wellFormed,
    detail: wellFormed
      ? 'artifact envelope is well-formed (format, sections, observed_at)'
      : 'artifact missing/broken: format, source, build, deployment, runtime, or observed_at',
  });

  if (!wellFormed) {
    return { checks, ok: false };
  }

  const source = artifact.source as Record<string, unknown>;
  const build = artifact.build as Record<string, unknown>;
  const deployment = artifact.deployment as Record<string, unknown>;
  const runtime = artifact.runtime as Record<string, unknown>;

  const sourceSha = source.sha;
  checks.push({
    id: 'R4-SCHEMA-01',
    pass: nonEmpty(sourceSha) && GIT_SHA.test(sourceSha as string),
    detail: `source.sha=${nonEmpty(sourceSha) ? (sourceSha as string) : '<missing>'}`,
  });

  const liveSha = runtime.observed_live_sha;
  const shaEquality =
    nonEmpty(sourceSha) &&
    nonEmpty(liveSha) &&
    GIT_SHA.test(sourceSha as string) &&
    sourceSha === liveSha;
  checks.push({
    id: 'R4-SCHEMA-02',
    pass: shaEquality,
    detail: `live ${nonEmpty(liveSha) ? (liveSha as string) : '<missing>'} vs source ${nonEmpty(sourceSha) ? (sourceSha as string) : '<missing>'}`,
  });

  const r0Digest = runtime.r0_artifact_sha256;
  checks.push({
    id: 'R4-SCHEMA-03',
    pass: nonEmpty(r0Digest) && SHA256.test(r0Digest as string),
    detail: `r0_artifact_sha256 ${nonEmpty(r0Digest) ? 'present' : '<missing>'}`,
  });

  const r1Digest = runtime.r1_artifact_sha256;
  checks.push({
    id: 'R4-SCHEMA-03b',
    pass: nonEmpty(r1Digest) && SHA256.test(r1Digest as string),
    detail: `r1_artifact_sha256 ${nonEmpty(r1Digest) ? 'present' : '<missing>'}`,
  });

  const r1Verdict = runtime.r1_verdict;
  const overall = artifact.verdict;
  const r1Gate = overall !== 'pass' || r1Verdict === 'pass';
  checks.push({
    id: 'R4-SCHEMA-04',
    pass: r1Gate,
    detail: `verdict=${String(overall)} with r1_verdict=${String(r1Verdict)} — provenance cannot be pass without a passing R1 smoke`,
  });

  const versionId = deployment.version_id;
  checks.push({
    id: 'R4-SCHEMA-05',
    pass: nonEmpty(versionId) && UUID.test(versionId as string),
    detail: `deployment.version_id=${nonEmpty(versionId) ? (versionId as string) : '<missing>'}`,
  });

  const workflowRun = build.workflow_run;
  const lockfileHash = build.lockfile_sha256;
  const workflowSha = build.workflow_sha;
  const buildIntegrity =
    nonEmpty(workflowSha) &&
    GIT_SHA.test(workflowSha as string) &&
    nonEmpty(workflowRun) &&
    /^\d+$/.test(workflowRun as string) &&
    nonEmpty(lockfileHash) &&
    SHA256.test(lockfileHash as string);
  checks.push({
    id: 'R4-SCHEMA-05b',
    pass: buildIntegrity,
    detail: 'build section: workflow SHA / run id / lockfile hash well-formed',
  });

  checks.push({
    id: 'R4-SCHEMA-06',
    pass: checks.every((check) => check.id === 'R4-SCHEMA-00' || check.pass),
    detail: 'complete, internally consistent provenance artifact',
  });

  return { checks, ok: checks.every((check) => check.pass) };
}

/** Valid full example, for tests/tools. */
export function completeProvenanceExample(): Record<string, unknown> {
  return {
    format: 'wasmagent-runtime-release-provenance/v1',
    source: {
      repository: 'WasmAgent/open-agent-audit',
      sha: 'a4bdada530757e7442bb35aa60cc84d03cb5c21e',
    },
    build: {
      workflow_sha: '8aa2969a8f9a5a44ec9db6ba3673d23f1f5d4a01',
      workflow_run: '34839394368',
      lockfile_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    },
    deployment: {
      provider: 'cloudflare-workers',
      target: 'trustavo.com',
      version_id: '9f6c4a1e-3f2a-4b8c-9d1e-5a7b8c9d0e1f',
    },
    runtime: {
      observed_live_sha: 'a4bdada530757e7442bb35aa60cc84d03cb5c21e',
      r0_artifact_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      r1_artifact_sha256: 'a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e',
      r0_verdict: 'pass',
      r1_verdict: 'pass',
    },
    verdict: 'pass',
    observed_at: '2026-09-15T00:00:00.000Z',
  };
}
