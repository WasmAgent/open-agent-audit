#!/usr/bin/env node
/**
 * OpenAgentAudit Node.js stdin/stdout bridge.
 *
 * Reads AEP records from stdin (single JSON object or JSONL), converts them
 * to CanonicalEvents, runs the audit pipeline, and outputs analysis JSON
 * to stdout.
 *
 * Exit codes:
 *   0 — success
 *   2 — bad input (unparseable JSON, empty input)
 *   3 — adapter error (AEP conversion failed)
 *   4 — engine error (policy-audit or scoring failed)
 *
 * Usage:
 *   echo '{"schema_version":"aep/v0.2",...}' | node bridge.mjs
 *   cat records.jsonl | node bridge.mjs
 *   cat records.jsonl | node bridge.mjs --manifest '{"declared_capabilities":["fs.read"]}'
 *
 * Requirements:
 *   - Node.js >= 18
 *   - @openagentaudit/adapters, @openagentaudit/core, @openagentaudit/schema
 *     must be resolvable (install from the monorepo root or npm)
 */

import { createInterface } from 'node:readline';
import { stdin, stdout, stderr, argv, exit } from 'node:process';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseManifestArg() {
  const idx = argv.indexOf('--manifest');
  if (idx === -1 || idx + 1 >= argv.length) return undefined;
  const raw = argv[idx + 1];
  try {
    return JSON.parse(raw);
  } catch {
    stderr.write('Error: --manifest value is not valid JSON\n');
    exit(2);
  }
}

// ---------------------------------------------------------------------------
// Read stdin
// ---------------------------------------------------------------------------

async function readStdin() {
  const lines = [];
  const rl = createInterface({ input: stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    lines.push(line);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const manifest = parseManifestArg() ?? {
    declared_capabilities: [],
    high_risk_capabilities: [],
    denied_capabilities: [],
  };

  // Read all of stdin
  let text;
  try {
    text = await readStdin();
  } catch (err) {
    stderr.write(`Error reading stdin: ${err.message}\n`);
    exit(2);
  }

  if (!text || text.trim().length === 0) {
    stderr.write('Error: empty input\n');
    exit(2);
  }

  // Parse input: single JSON object or JSONL (one record per line)
  let records;
  try {
    const trimmed = text.trim();
    if (trimmed.startsWith('[')) {
      // JSON array
      records = JSON.parse(trimmed);
    } else if (trimmed.startsWith('{') && !trimmed.includes('\n')) {
      // Single JSON object
      records = [JSON.parse(trimmed)];
    } else {
      // JSONL
      records = [];
      for (const line of trimmed.split('\n')) {
        const l = line.trim();
        if (l.length === 0 || l.startsWith('//')) continue;
        records.push(JSON.parse(l));
      }
    }
  } catch (err) {
    stderr.write(`Error: input is not valid JSON or JSONL: ${err.message}\n`);
    exit(2);
  }

  if (records.length === 0) {
    stderr.write('Error: no records found in input\n');
    exit(2);
  }

  // Convert AEP records to CanonicalEvents
  let events;
  try {
    const { aepV0_2 } = await import('@openagentaudit/adapters');
    if (records.length === 1) {
      events = aepV0_2.AepV0_2Adapter.toEvents(records[0]);
    } else {
      events = aepV0_2.toEventsBatch(records);
    }
  } catch (err) {
    stderr.write(`Adapter error: ${err.message}\n`);
    exit(3);
  }

  // Run audit pipeline
  let findings, score;
  try {
    const { policyAudit, computeRiskScore } = await import('@openagentaudit/core');
    findings = await policyAudit(events, { manifest });
    score = await computeRiskScore(events);
  } catch (err) {
    stderr.write(`Engine error: ${err.message}\n`);
    exit(4);
  }

  // Output analysis
  const output = {
    event_count: events.length,
    record_count: records.length,
    findings_count: findings.length,
    findings_by_severity: {
      critical: findings.filter((f) => f.severity === 'critical').length,
      high: findings.filter((f) => f.severity === 'high').length,
      medium: findings.filter((f) => f.severity === 'medium').length,
      low: findings.filter((f) => f.severity === 'low').length,
      info: findings.filter((f) => f.severity === 'info').length,
    },
    evidence_admission_score: score.evidence_admission_score,
    agent_risk_score: score.agent_risk_score,
    findings,
  };

  stdout.write(JSON.stringify(output, null, 2) + '\n');
  exit(0);
}

main().catch((err) => {
  stderr.write(`Unexpected error: ${err.message}\n`);
  exit(4);
});
