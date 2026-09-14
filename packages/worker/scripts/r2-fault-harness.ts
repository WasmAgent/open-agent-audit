/**
 * R2 local fault-injection harness CLI (offline only — never touches
 * production). Runs every local scenario, writes one
 * `wasmagent-runtime-fault/v1` artifact per scenario, and prints a verdict
 * table. Exit code 0 when every failure is either a pass or a known
 * ledger-tracked finding; non-zero when an UNEXPECTED failure appears.
 *
 * Usage: bun packages/worker/scripts/r2-fault-harness.ts [--out-dir reports/generated] [--source-sha <sha>]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { R2_FAULT_LEDGER } from '../src/runtime-faults.js';
import { LOCAL_SOURCE_SHA, SCENARIOS } from '../test/runtime-fault-scenarios.js';

function parseArg(argv: string[], flag: string, fallback: string): string {
  const index = argv.indexOf(flag);
  return index !== -1 && argv[index + 1] !== undefined ? (argv[index + 1] as string) : fallback;
}

async function main(): Promise<number> {
  const outDir = parseArg(process.argv.slice(2), '--out-dir', 'reports/generated');
  const sourceSha = parseArg(process.argv.slice(2), '--source-sha', LOCAL_SOURCE_SHA);
  mkdirSync(outDir, { recursive: true });

  const knownFailing = new Set(
    R2_FAULT_LEDGER.filter((entry) => entry.status === 'observed_failing').map((e) => e.scenario),
  );

  let unexpected = 0;
  for (const scenario of SCENARIOS) {
    const artifact = await scenario.run();
    if (artifact.source_sha !== sourceSha) artifact.source_sha = sourceSha;
    const path = join(outDir, `${artifact.scenario}.json`);
    writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`);
    const known = knownFailing.has(artifact.scenario);
    if (artifact.verdict !== 'pass' && !known) unexpected++;
    console.log(
      `${artifact.verdict === 'pass' ? 'PASS' : known ? 'FAIL (known finding)' : 'FAIL (unexpected)'} ${artifact.scenario} [${artifact.fault.dependency}/${artifact.fault.checkpoint}] -> ${path}`,
    );
  }

  console.log(`\nledger: ${R2_FAULT_LEDGER.length} scenario(s) pending/covered outside this harness`);
  console.log(unexpected === 0 ? 'R2 local harness: OK' : `R2 local harness: ${unexpected} unexpected failure(s)`);
  return unexpected === 0 ? 0 : 1;
}

process.exit(await main());
