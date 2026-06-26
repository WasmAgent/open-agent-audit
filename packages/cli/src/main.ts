#!/usr/bin/env -S bun
/**
 * @openagentaudit/cli — Local developer CLI.
 *
 * Status: skeleton. Wires up the core engines for local Bun runs.
 * Production deployments use packages/worker.
 */

const COMMANDS = [
  'validate',
  'inventory',
  'policy-audit',
  'benchmark-audit',
  'contamination',
  'drift-guard',
  'report',
] as const;

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(
    [
      'openagentaudit — OpenAgentAudit local CLI',
      '',
      'usage: openagentaudit <command> [options]',
      '',
      'commands:',
      ...COMMANDS.map((c) => `  ${c}`),
      '',
      'this is a skeleton; commands are not yet implemented.',
      'see docs/schema-versioning.md for the Phase 2 gate.',
    ].join('\n'),
  );
}

const [, , cmd] = process.argv;
if (!cmd || cmd === '--help' || cmd === '-h') {
  printHelp();
  process.exit(0);
}

if (!(COMMANDS as readonly string[]).includes(cmd)) {
  // eslint-disable-next-line no-console
  console.error(`unknown command: ${cmd}`);
  printHelp();
  process.exit(2);
}

// eslint-disable-next-line no-console
console.error(`command '${cmd}' is not implemented yet (Phase 2 blocked).`);
process.exit(0);
