#!/usr/bin/env node
/**
 * Offline validator for wasmagent-runtime-release-provenance/v1 artifacts (R4).
 *
 * Usage: node scripts/validate-runtime-provenance.mjs <artifact.json>
 *
 * NOTE: the authoritative, unit-tested truth rules live in
 * packages/worker/src/runtime-provenance.ts (validated by the worker test
 * suite). This CLI mirrors the core rules so an artifact can be checked
 * standalone without a build. Exit 0 = valid, 1 = invalid, 2 = usage error.
 *
 * Truth rule: this tool validates STRUCTURE and internal consistency only.
 * A valid artifact does not by itself upgrade the organization
 * `release_provenance` — that requires a real relayed runtime artifact (R4).
 */
import { readFileSync } from 'node:fs';

const GIT_SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const path = process.argv[2];
if (path === undefined) {
  console.error('Usage: node scripts/validate-runtime-provenance.mjs <artifact.json>');
  process.exit(2);
}

let artifact;
try {
  artifact = JSON.parse(readFileSync(path, 'utf8'));
} catch (error) {
  console.error(`invalid JSON: ${String(error)}`);
  process.exit(1);
}

const failures = [];
const check = (id, pass, detail) => {
  console.log(`${pass ? 'PASS' : 'FAIL'} ${id} ${detail}`);
  if (!pass) failures.push(id);
};

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

check(
  'envelope',
  isRecord(artifact) &&
    artifact.format === 'wasmagent-runtime-release-provenance/v1' &&
    isRecord(artifact.source) &&
    isRecord(artifact.build) &&
    isRecord(artifact.deployment) &&
    isRecord(artifact.runtime) &&
    typeof artifact.observed_at === 'string' &&
    ISO_TS.test(artifact.observed_at),
  'format / source / build / deployment / runtime / observed_at',
);

if (failures.length === 0) {
  check('R4-SCHEMA-01', GIT_SHA.test(artifact.source.sha ?? ''), 'source.sha is 40-hex');
  check(
    'R4-SCHEMA-02',
    artifact.source.sha === artifact.runtime.observed_live_sha,
    'observed live SHA equals source SHA',
  );
  check('R4-SCHEMA-03', SHA256.test(artifact.runtime.r0_artifact_sha256 ?? ''), 'R0 artifact digest');
  check('R4-SCHEMA-03b', SHA256.test(artifact.runtime.r1_artifact_sha256 ?? ''), 'R1 artifact digest');
  check(
    'R4-SCHEMA-04',
    artifact.verdict !== 'pass' || artifact.runtime.r1_verdict === 'pass',
    'pass verdict requires a passing R1 production smoke',
  );
  check('R4-SCHEMA-05', UUID.test(artifact.deployment.version_id ?? ''), 'deployment.version_id is a UUID');
  check(
    'R4-SCHEMA-05b',
    GIT_SHA.test(artifact.build.workflow_sha ?? '') &&
      /^\d+$/.test(artifact.build.workflow_run ?? '') &&
      SHA256.test(artifact.build.lockfile_sha256 ?? ''),
    'build workflow SHA / run id / lockfile hash',
  );
  check('R4-SCHEMA-06', failures.length === 0, 'complete, internally consistent artifact');
}

console.log(failures.length === 0 ? `VALID: ${path}` : `INVALID: ${path} (${failures.join(', ')})`);
process.exit(failures.length === 0 ? 0 : 1);
