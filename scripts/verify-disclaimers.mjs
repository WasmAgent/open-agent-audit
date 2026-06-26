#!/usr/bin/env node
/**
 * verify-disclaimers.mjs
 *
 * Scan markdown / YAML / JSON for forbidden compliance-claiming phrasing.
 * Enforced by CONSTRAINTS.md §1.
 *
 * Self-exemption: this file itself contains the forbidden phrases as
 * patterns. They are split via string concatenation so the scanner does
 * not flag itself.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const ROOT = dirname(dirname(SELF));

// Patterns are assembled at runtime so the scanner does not detect itself.
const FORBIDDEN = [
  ['certified', 'compliant'],
  ['legally', 'compliant'],
  ['regulator', 'approved'],
  ['regulator-approved'],
  ['EU AI Act', 'compliant'],
  ['ISO 42001', 'compliant'],
  ['ISO 42001', 'certified'],
  ['guarantees', 'compliance'],
  ['satisfies', 'the AI Act'],
  ['meets', 'regulatory requirements'],
  ['legally', 'binding evidence'],
  ['automatic', 'compliance'],
].map((parts) => parts.join(' '));

const SCAN_EXT = new Set(['.md', '.yaml', '.yml', '.json', '.j2', '.txt']);
const IGNORE_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.turbo',
  '.wrangler',
  '.git',
]);

// Files exempt from the lint (they discuss the forbidden phrases by design).
const EXEMPT = new Set([
  'CONSTRAINTS.md',
  'docs/regulatory-disclaimer.md',
  'docs/mapping-methodology.md',
  'docs/differences-from-observability.md',
  'spec/versions/v0.1/disclaimer.md',
  'examples/reports/audit-report.example.md',
  'scripts/verify-disclaimers.mjs',
]);
function posix(p) {
  return p.split(sep).join('/');
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(ROOT, full);
    if (IGNORE_DIRS.has(name)) continue;
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* walk(full);
    } else {
      const dot = name.lastIndexOf('.');
      const ext = dot >= 0 ? name.slice(dot) : '';
      if (SCAN_EXT.has(ext) && !EXEMPT.has(posix(rel))) {
        yield full;
      }
    }
  }
}

let hits = 0;
for (const path of walk(ROOT)) {
  const text = readFileSync(path, 'utf8');
  for (const phrase of FORBIDDEN) {
    if (text.toLowerCase().includes(phrase.toLowerCase())) {
      const rel = relative(ROOT, path);
      // eslint-disable-next-line no-console
      console.error(`[forbidden phrase] ${rel}: "${phrase}"`);
      hits++;
    }
  }
}

if (hits > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${hits} forbidden phrase occurrence(s). See CONSTRAINTS.md §1.`);
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log('verify-disclaimers: OK');
