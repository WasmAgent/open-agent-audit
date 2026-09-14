/**
 * R0/R0.5 post-deploy verification CLI (WasmAgent runtime assurance).
 *
 * Reads the captured /health response plus the deployment toolchain evidence,
 * evaluates the live deployment identity against the deploying workflow's
 * expected tuple (R0) and the toolchain reproducibility gates (R0.5), and
 * writes the `runtime-deployment-attestation.json` artifact.
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
 *     --expect-wrangler 4.131.2 \
 *     --lock-pin "wrangler@4.131.2" \
 *     --wrangler-version "$DEPLOYED_WRANGLER_VERSION" \
 *     --wrangler-source locked \
 *     --bun-version "$DEPLOYED_BUN_VERSION" \
 *     --config-file wrangler.jsonc \
 *     --deploy-log deploy-output.log \
 *     --out runtime-deployment-attestation.json
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  buildDeploymentAttestation,
  evaluateDeploymentIdentity,
  evaluateToolchain,
  readCompatibilityDate,
} from '../src/deployment-identity.js';

interface CliArgs {
  healthFile: string;
  expectSha: string;
  expectRepository: string;
  expectWorkflowRun: string;
  deploymentTarget: string;
  expectWrangler: string;
  lockPin: string;
  wranglerVersion: string;
  wranglerSource: 'locked' | 'unknown';
  bunVersion: string;
  configFile: string;
  deployLog: string;
  out: string;
}

const USAGE = `Usage: bun verify-deployment.ts --health-file <file> --expect-sha <sha> \\
  --expect-repository <owner/repo> --expect-workflow-run <run-id> \\
  --deployment-target <host> \\
  --expect-wrangler <version> --lock-pin "wrangler@<version>" \\
  --wrangler-version <version> --wrangler-source <locked|unknown> \\
  --bun-version <version> --config-file <wrangler.jsonc> \\
  --deploy-log <file> --out <artifact.json>`;

const REQUIRED_FLAGS = [
  'health-file',
  'expect-sha',
  'expect-repository',
  'expect-workflow-run',
  'deployment-target',
  'expect-wrangler',
  'lock-pin',
  'wrangler-version',
  'bun-version',
  'config-file',
  'deploy-log',
  'out',
] as const;

function parseArgs(argv: string[]): CliArgs | null {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === undefined || value === undefined || !flag.startsWith('--')) return null;
    args[flag.slice(2)] = value;
  }
  for (const flag of REQUIRED_FLAGS) {
    if (args[flag] === undefined) return null;
  }
  const pick = (flag: (typeof REQUIRED_FLAGS)[number]): string => args[flag] ?? '';
  return {
    healthFile: pick('health-file'),
    expectSha: pick('expect-sha'),
    expectRepository: pick('expect-repository'),
    expectWorkflowRun: pick('expect-workflow-run'),
    deploymentTarget: pick('deployment-target'),
    expectWrangler: pick('expect-wrangler'),
    lockPin: pick('lock-pin'),
    wranglerVersion: pick('wrangler-version'),
    wranglerSource: args['wrangler-source'] === 'locked' ? 'locked' : 'unknown',
    bunVersion: pick('bun-version'),
    configFile: pick('config-file'),
    deployLog: pick('deploy-log'),
    out: pick('out'),
  };
}

/** File contents, or null when missing/unreadable (callers fail closed). */
function readFileOrNull(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
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
  const health = readFileOrNull(args.healthFile);
  if (health !== null) {
    try {
      payload = JSON.parse(health) as unknown;
    } catch {
      payload = undefined;
    }
  }

  const evaluation = evaluateDeploymentIdentity(payload, {
    sha: args.expectSha,
    repository: args.expectRepository,
    workflowRun: args.expectWorkflowRun,
  });

  // R0.5 toolchain evidence. wranglerSource comes from the workflow, which
  // invokes ./node_modules/.bin/wrangler directly (never a runtime install).
  const deployLog = readFileOrNull(args.deployLog);
  const toolchain = evaluateToolchain({
    expectedWrangler: args.expectWrangler,
    lockPin: args.lockPin,
    wranglerVersion: args.wranglerVersion,
    wranglerSource: args.wranglerSource,
    deployLog,
    bunVersion: args.bunVersion,
    compatibilityDate: readCompatibilityDate(readFileOrNull(args.configFile) ?? ''),
  });

  const attestation = buildDeploymentAttestation({
    repository: args.expectRepository,
    sourceSha: args.expectSha,
    workflowRun: args.expectWorkflowRun,
    deploymentTarget: args.deploymentTarget,
    observedAt: new Date().toISOString(),
    evaluation,
    toolchain,
    toolchainIdentity: {
      bun: args.bunVersion,
      wrangler: args.wranglerVersion,
      worker_compatibility_date: readCompatibilityDate(readFileOrNull(args.configFile) ?? ''),
    },
    payload,
  });

  writeFileSync(args.out, `${JSON.stringify(attestation, null, 2)}\n`);

  for (const check of [...evaluation.checks, ...toolchain.checks]) {
    console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.id} ${check.description} — ${check.detail}`);
  }
  for (const [verdict, outcome] of Object.entries(attestation.verdicts)) {
    console.log(`${verdict}: ${outcome}`);
  }
  console.log(`attestation written to ${args.out}`);
  const ok = evaluation.ok && toolchain.ok;
  console.log(
    ok
      ? 'R0 deployment identity + R0.5 toolchain: PASS'
      : 'R0 deployment identity + R0.5 toolchain: FAIL (deploy job fails closed)',
  );
  return ok ? 0 : 1;
}

process.exit(main());
