/**
 * R0 post-deploy verification CLI (WasmAgent runtime assurance).
 *
 * Reads the captured /health response, evaluates the live deployment identity
 * against the deploying workflow's expected tuple, and writes the
 * `runtime-deployment-attestation.json` artifact.
 *
 * Fail-closed contract: the artifact is ALWAYS written (also on failing
 * verdicts, so a failed verification leaves machine-readable evidence), and
 * the process exits non-zero so the deploy job fails. Run by
 * `.github/workflows/deploy.yml` immediately after `wrangler deploy`.
 *
 * Usage (bun):
 *   bun packages/worker/scripts/verify-deployment.ts \
 *     --health-file health.json \
 *     --expect-sha "$GITHUB_SHA" \
 *     --expect-repository "$GITHUB_REPOSITORY" \
 *     --expect-workflow-run "$GITHUB_RUN_ID" \
 *     --deployment-target trustavo.com \
 *     --out runtime-deployment-attestation.json
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  buildDeploymentAttestation,
  evaluateDeploymentIdentity,
} from '../src/deployment-identity.js';

interface CliArgs {
  healthFile: string;
  expectSha: string;
  expectRepository: string;
  expectWorkflowRun: string;
  deploymentTarget: string;
  out: string;
}

const USAGE = `Usage: bun verify-deployment.ts --health-file <file> --expect-sha <sha> \\
  --expect-repository <owner/repo> --expect-workflow-run <run-id> \\
  --deployment-target <host> --out <artifact.json>`;

function parseArgs(argv: string[]): CliArgs | null {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === undefined || value === undefined || !flag.startsWith('--')) return null;
    args[flag.slice(2)] = value;
  }
  if (
    args['health-file'] === undefined ||
    args['expect-sha'] === undefined ||
    args['expect-repository'] === undefined ||
    args['expect-workflow-run'] === undefined ||
    args['deployment-target'] === undefined ||
    args.out === undefined
  ) {
    return null;
  }
  return {
    healthFile: args['health-file'],
    expectSha: args['expect-sha'],
    expectRepository: args['expect-repository'],
    expectWorkflowRun: args['expect-workflow-run'],
    deploymentTarget: args['deployment-target'],
    out: args.out,
  };
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  if (args === null) {
    console.error(USAGE);
    return 2;
  }

  // A missing file (curl failed before writing a body) and an unparseable body
  // (proxy error page, truncated response) both land on payload=undefined and
  // fail every R0 verdict — never read "no answer" as a healthy deployment.
  let payload: unknown;
  if (existsSync(args.healthFile)) {
    try {
      payload = JSON.parse(readFileSync(args.healthFile, 'utf8')) as unknown;
    } catch {
      payload = undefined;
    }
  }

  const evaluation = evaluateDeploymentIdentity(payload, {
    sha: args.expectSha,
    repository: args.expectRepository,
    workflowRun: args.expectWorkflowRun,
  });

  const attestation = buildDeploymentAttestation({
    repository: args.expectRepository,
    sourceSha: args.expectSha,
    workflowRun: args.expectWorkflowRun,
    deploymentTarget: args.deploymentTarget,
    observedAt: new Date().toISOString(),
    evaluation,
    payload,
  });

  writeFileSync(args.out, `${JSON.stringify(attestation, null, 2)}\n`);

  for (const check of evaluation.checks) {
    console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.id} ${check.description} — ${check.detail}`);
  }
  for (const [verdict, outcome] of Object.entries(evaluation.verdicts)) {
    console.log(`${verdict}: ${outcome}`);
  }
  console.log(`attestation written to ${args.out}`);
  console.log(
    evaluation.ok
      ? 'R0 deployment identity: PASS'
      : 'R0 deployment identity: FAIL (deploy job fails closed)',
  );
  return evaluation.ok ? 0 : 1;
}

process.exit(main());
