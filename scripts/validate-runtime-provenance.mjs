#!/usr/bin/env node
/**
 * Offline validator for wasmagent-runtime-release-provenance/v1 artifacts (R4).
 *
 * TWO DISTINCT CONCEPTS — never conflate them:
 *
 *   artifact_valid      schema/structure + internal consistency.
 *   provenance_verdict  pass|fail — whether the artifact GRANTS release
 *                       provenance (artifact verdict pass AND R0 AND R1 gates
 *                       pass). An honestly failing artifact is still valid,
 *                       but grants nothing.
 *
 * Modes:
 *   (default)          = --validate-only: check artifact_valid, report
 *                        provenance_verdict informationally. Exit 0 for a
 *                        valid artifact even when the verdict is fail.
 *   --require-pass     R4 GATE MODE: exit 0 only when artifact_valid AND
 *                        provenance_verdict == pass. Any future gate that
 *                        upgrades release_provenance MUST use this flag.
 *
 * The authoritative, unit-tested truth rules live in
 * packages/worker/src/runtime-provenance.ts (validated by the worker test
 * suite). This CLI mirrors the core rules so an artifact can be checked
 * standalone without a build.
 *
 * Usage:
 *   node scripts/validate-runtime-provenance.mjs <artifact.json> [--validate-only]
 *   node scripts/validate-runtime-provenance.mjs <artifact.json> --require-pass
 *
 * Exit codes: 0 = ok under the selected mode; 1 = invalid or (in
 * --require-pass mode) verdict not pass; 2 = usage error.
 *
 * Truth rule: passing this tool does NOT by itself upgrade the organization
 * `release_provenance` — that requires a real relayed runtime artifact (R4)
 * produced from actual deployment evidence.
 */
import { readFileSync } from 'node:fs';

const GIT_SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const args = process.argv.slice(2);
const path = args.find((arg) => !arg.startsWith('--'));
const requirePass = args.includes('--require-pass');
const validateOnly = args.includes('--validate-only');
if (path === undefined || (requirePass && validateOnly)) {
  console.error(
    'Usage: node scripts/validate-runtime-provenance.mjs <artifact.json> [--validate-only | --require-pass]',
  );
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
    artifact.verdict !== 'pass' ||
      (artifact.runtime.r0_verdict === 'pass' && artifact.runtime.r1_verdict === 'pass'),
    'pass verdict requires passing R0 AND R1 gates',
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

const artifactValid = failures.length === 0;

// provenance_verdict is independent of artifact validity: an honestly failing
// artifact is valid, but grants nothing.
const provenanceVerdict =
  artifactValid &&
  artifact.verdict === 'pass' &&
  artifact.runtime.r0_verdict === 'pass' &&
  artifact.runtime.r1_verdict === 'pass'
    ? 'pass'
    : 'fail';

console.log(`artifact_valid: ${artifactValid}`);
console.log(`provenance_verdict: ${provenanceVerdict}`);

if (requirePass) {
  if (artifactValid && provenanceVerdict === 'pass') {
    console.log('R4 GATE: PASS — this artifact supports release_provenance pass (for the exact source/deployment tuple it contains)');
    process.exit(0);
  }
  console.log('R4 GATE: FAIL — do NOT upgrade release_provenance from this artifact');
  process.exit(1);
}

// validate-only (default): validity is the exit criterion; the verdict is
// reported informationally and must NOT be read as a release gate result.
console.log(
  provenanceVerdict === 'pass'
    ? 'VALID: an R4 gate would still require --require-pass to enforce the verdict'
    : `VALID (validate-only): artifact is well-formed; provenance_verdict=${provenanceVerdict} — rerun with --require-pass to enforce`,
);
process.exit(artifactValid ? 0 : 1);
