#!/usr/bin/env -S bun
/**
 * @openagentaudit/cli — Local developer CLI.
 *
 * Wires up the core engines for local Bun runs.
 * Production deployments use packages/worker.
 */

import {
  validate,
  inventory,
  policyAudit,
  computeRiskScore,
  renderReport,
} from '@openagentaudit/core';
import type { ReportMeta } from '@openagentaudit/core';
import { aepV0_2, bscode } from '@openagentaudit/adapters';
import { validateEvents } from '@openagentaudit/schema';
import type { CanonicalEvent, Finding } from '@openagentaudit/schema';

/** Local mirror of CapabilityManifest — keeps the CLI free of deep sub-path imports. */
interface CapabilityManifest {
  declared_capabilities: string[];
  high_risk_capabilities: string[];
  denied_capabilities: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read all text from a file path or stdin. */
async function readText(filePath: string | undefined): Promise<string> {
  if (filePath === undefined) {
    // Read from stdin
    const chunks: Uint8Array[] = [];
    for await (const chunk of Bun.stdin.stream()) {
      chunks.push(chunk);
    }
    const total = chunks.reduce((n, c) => n + c.byteLength, 0);
    const buf = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      buf.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(buf);
  }

  const file = Bun.file(filePath);
  const exists = await file.exists();
  if (!exists) {
    process.stderr.write(`Error: file not found: ${filePath}\n`);
    process.exit(1);
  }
  return file.text();
}

/**
 * Read JSONL from file or stdin.
 * Skips blank lines and lines starting with "//".
 * Warns on invalid JSON lines but continues.
 */
async function readJsonl(filePath?: string): Promise<unknown[]> {
  const text = await readText(filePath);
  const lines = text.split('\n');
  const results: unknown[] = [];

  for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
    const raw = lines[lineNum - 1];
    if (raw === undefined) continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.startsWith('//')) continue;

    try {
      results.push(JSON.parse(trimmed));
    } catch {
      process.stderr.write(`Warning: skipping invalid JSON on line ${lineNum}\n`);
    }
  }

  return results;
}

/**
 * Read JSONL and parse as CanonicalEvent[].
 * For commands other than `validate`, use the valid subset and warn on schema errors.
 */
async function readEvents(filePath?: string): Promise<CanonicalEvent[]> {
  const raw = await readJsonl(filePath);
  const { valid, errors } = validateEvents(raw);
  if (errors.length > 0) {
    process.stderr.write(
      `Warning: ${errors.length} event(s) failed schema validation and will be skipped.\n`,
    );
  }
  return valid;
}

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

/** Escape a single CSV cell value. */
function csvCell(value: string | number | undefined | null): string {
  const s = value === undefined || value === null ? '' : String(value);
  // Quote if the value contains a comma, double-quote, or newline
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Build a CSV export from findings and basic run metadata.
 *
 * Columns: finding_id, rule_id, severity, category, title, description,
 *          evidence_ids, recommendation, standard_mappings, run_id,
 *          eas_score, eas_grade
 */
function buildCsv(
  findings: Finding[],
  runId: string,
  easScore: number,
  easGrade: string,
): string {
  const header = [
    'finding_id',
    'rule_id',
    'severity',
    'category',
    'title',
    'description',
    'evidence_ids',
    'recommendation',
    'standard_mappings',
    'run_id',
    'eas_score',
    'eas_grade',
  ].join(',');

  const rows = findings.map((f) => {
    const evidenceIds = f.evidence_ids.join('; ');
    const standardMappings =
      f.standard_mappings !== undefined && f.standard_mappings.length > 0
        ? f.standard_mappings.map((m) => `${m.profile}:${m.control_id}`).join('; ')
        : '';

    return [
      csvCell(f.finding_id),
      csvCell(f.rule_id),
      csvCell(f.severity),
      csvCell(f.category),
      csvCell(f.title),
      csvCell(f.description),
      csvCell(evidenceIds),
      csvCell(f.recommendation),
      csvCell(standardMappings),
      csvCell(runId),
      csvCell(easScore),
      csvCell(easGrade),
    ].join(',');
  });

  return [header, ...rows].join('\n');
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface ParsedArgs {
  command: string | undefined;
  file: string | undefined;
  flags: Map<string, string | true>;
  positional: string[];
}

function parseArgs(): ParsedArgs {
  const argv = process.argv.slice(2);
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  let command: string | undefined;

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === undefined) {
      i++;
      continue;
    }

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        flags.set(key, next);
        i += 2;
      } else {
        flags.set(key, true);
        i++;
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      flags.set(arg.slice(1), true);
      i++;
    } else {
      positional.push(arg);
      i++;
    }
  }

  command = positional[0];
  // File is the second positional (first non-command positional)
  const file = positional[1];

  return { command, file, flags, positional };
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(
    [
      'openagentaudit — OpenAgentAudit local CLI',
      '',
      'usage: openagentaudit <command> [options] [file]',
      '',
      'If [file] is omitted, reads from stdin.',
      '',
      'commands:',
      '  validate [file]',
      '    Read JSONL, validate CanonicalEvents, report errors and warnings.',
      '',
      '  inventory [file]',
      '    Read JSONL, run inventory engine, print InventoryReport as JSON.',
      '',
      '  policy-audit [file] [--manifest <json>] [--profile <id>]',
      '    Read JSONL, run policy audit, print findings.',
      '',
      '  score [file]',
      '    Read JSONL, compute Evidence Admission Score, print as JSON.',
      '',
      '  report [file] [--format md|html|json|csv] [--meta <json>]',
      '    Read JSONL, run full audit pipeline, print report.',
      '',
      '  from-aep [file]',
      '    Read a single AEP JSON record, convert to CanonicalEvents JSONL.',
      '',
      '  from-bscode [file]',
      '    Read a single bscode RolloutWireRecord JSON, convert to JSONL.',
      '',
      'options:',
      '  --help, -h      Print this help and exit.',
      '  --version, -v   Print version and exit.',
      '  --manifest      JSON string for CapabilityManifest (policy-audit).',
      '  --profile       Profile ID (policy-audit).',
      '  --format        Output format: md, html, json, or csv (report).',
      '  --meta          JSON string with ReportMeta fields (report).',
      '                  Supported fields: issuer, prepared_by, source_files,',
      '                  scope, profiles_applied, report_id, trace_start,',
      '                  trace_end, engine_version, spec_version.',
      '                  Example: --meta \'{"issuer":"Acme Corp","prepared_by":"Jane Smith","source_files":["trace.jsonl"]}\'',
    ].join('\n'),
  );
}

// ---------------------------------------------------------------------------
// Command implementations
// ---------------------------------------------------------------------------

async function cmdValidate(filePath?: string): Promise<void> {
  const raw = await readJsonl(filePath);
  let result;
  try {
    result = await validate(raw as CanonicalEvent[]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }

  console.log(
    `Total events: ${result.total} | Errors: ${result.errors.length} | Warnings: ${result.warnings.length}`,
  );

  for (const e of result.errors) {
    console.log(`[ERROR] ${e.event_id} | ${e.path} | ${e.message}`);
  }
  for (const w of result.warnings) {
    console.log(`[WARN] ${w.event_id} | ${w.path} | ${w.message}`);
  }

  if (result.errors.length > 0) {
    process.exit(1);
  }
}

async function cmdInventory(filePath?: string): Promise<void> {
  const events = await readEvents(filePath);
  let report;
  try {
    report = await inventory(events);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }
  console.log(JSON.stringify(report, null, 2));
}

async function cmdPolicyAudit(
  filePath: string | undefined,
  manifestJson: string | undefined,
  profileId: string | undefined,
): Promise<void> {
  const events = await readEvents(filePath);

  const defaultManifest: CapabilityManifest = {
    declared_capabilities: [],
    high_risk_capabilities: [],
    denied_capabilities: [],
  };

  let manifest: CapabilityManifest = defaultManifest;
  if (manifestJson !== undefined) {
    try {
      manifest = JSON.parse(manifestJson) as CapabilityManifest;
    } catch {
      process.stderr.write('Error: --manifest value is not valid JSON\n');
      process.exit(1);
    }
  }

  const ctx = {
    manifest,
    ...(profileId !== undefined ? { profile_id: profileId } : {}),
  };

  let findings;
  try {
    findings = await policyAudit(events, ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }

  for (const f of findings) {
    console.log(`[${f.severity.toUpperCase()}] ${f.rule_id} — ${f.title}`);
  }
  console.log(`Total findings: ${findings.length}`);

  const hasCriticalOrHigh = findings.some(
    (f) => f.severity === 'critical' || f.severity === 'high',
  );
  if (hasCriticalOrHigh) {
    process.exit(1);
  }
}

async function cmdScore(filePath?: string): Promise<void> {
  const events = await readEvents(filePath);
  let score;
  try {
    score = await computeRiskScore(events);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }
  console.log(JSON.stringify(score, null, 2));
}

async function cmdReport(
  filePath: string | undefined,
  format: string,
  metaJson: string | undefined,
): Promise<void> {
  const events = await readEvents(filePath);

  // Parse --meta flag
  let parsedMeta: ReportMeta = {};
  if (metaJson !== undefined) {
    try {
      parsedMeta = JSON.parse(metaJson) as ReportMeta;
    } catch {
      process.stderr.write('Error: --meta value is not valid JSON\n');
      process.exit(1);
    }
  }

  // Auto-inject source_files from filePath when not already set by --meta
  const meta: ReportMeta =
    filePath !== undefined && parsedMeta.source_files === undefined
      ? { ...parsedMeta, source_files: [filePath] }
      : parsedMeta;

  const defaultManifest: CapabilityManifest = {
    declared_capabilities: [],
    high_risk_capabilities: [],
    denied_capabilities: [],
  };

  let findings;
  let inv;
  let score;
  let bundle;

  try {
    findings = await policyAudit(events, { manifest: defaultManifest });
    inv = await inventory(events);
    score = await computeRiskScore(events);
    bundle = await renderReport(events, findings, score, inv, meta);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }

  switch (format) {
    case 'html':
      console.log(bundle.html);
      break;
    case 'json':
      console.log(bundle.json);
      break;
    case 'csv':
      console.log(
        buildCsv(
          findings,
          score.run_id,
          score.evidence_admission_score.score,
          score.evidence_admission_score.grade,
        ),
      );
      break;
    case 'md':
    default:
      console.log(bundle.markdown);
      break;
  }
}

async function cmdFromAep(filePath?: string): Promise<void> {
  const text = await readText(filePath);
  let record: unknown;
  try {
    record = JSON.parse(text);
  } catch {
    process.stderr.write('Error: input is not valid JSON\n');
    process.exit(1);
  }

  let events;
  try {
    events = aepV0_2.AepV0_2Adapter.toEvents(record as Parameters<typeof aepV0_2.AepV0_2Adapter.toEvents>[0]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }

  for (const ev of events) {
    console.log(JSON.stringify(ev));
  }
}

async function cmdFromBscode(filePath?: string): Promise<void> {
  const text = await readText(filePath);
  let record: unknown;
  try {
    record = JSON.parse(text);
  } catch {
    process.stderr.write('Error: input is not valid JSON\n');
    process.exit(1);
  }

  let events;
  try {
    events = bscode.BscodeAdapter.toEvents(record as Parameters<typeof bscode.BscodeAdapter.toEvents>[0]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Error: ${msg}\n`);
    process.exit(1);
  }

  for (const ev of events) {
    console.log(JSON.stringify(ev));
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const args = parseArgs();

// Global flags
if (args.flags.has('h') || args.flags.has('help')) {
  printHelp();
  process.exit(0);
}

if (args.flags.has('v') || args.flags.has('version')) {
  console.log('0.1.0');
  process.exit(0);
}

const cmd = args.command;

if (cmd === undefined) {
  printHelp();
  process.exit(0);
}

const COMMANDS = [
  'validate',
  'inventory',
  'policy-audit',
  'score',
  'report',
  'from-aep',
  'from-bscode',
] as const;

if (!(COMMANDS as readonly string[]).includes(cmd)) {
  process.stderr.write(`Error: unknown command: ${cmd}\n`);
  printHelp();
  process.exit(2);
}

switch (cmd) {
  case 'validate': {
    await cmdValidate(args.file);
    break;
  }
  case 'inventory': {
    await cmdInventory(args.file);
    break;
  }
  case 'policy-audit': {
    const manifestRaw = args.flags.get('manifest');
    const manifestJson = manifestRaw !== true ? manifestRaw : undefined;
    const profileRaw = args.flags.get('profile');
    const profileId = profileRaw !== true ? profileRaw : undefined;
    await cmdPolicyAudit(args.file, manifestJson, profileId);
    break;
  }
  case 'score': {
    await cmdScore(args.file);
    break;
  }
  case 'report': {
    const formatRaw = args.flags.get('format');
    const format = formatRaw !== undefined && formatRaw !== true ? formatRaw : 'md';
    const metaRaw = args.flags.get('meta');
    const metaJson = metaRaw !== true ? metaRaw : undefined;
    await cmdReport(args.file, format, metaJson);
    break;
  }
  case 'from-aep': {
    await cmdFromAep(args.file);
    break;
  }
  case 'from-bscode': {
    await cmdFromBscode(args.file);
    break;
  }
}
