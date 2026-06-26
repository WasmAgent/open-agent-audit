#!/usr/bin/env node
/**
 * verify-evidence-ids.mjs
 *
 * Check that every example Finding object includes a non-empty
 * `evidence_ids[]` array. Enforced by CONSTRAINTS.md §6.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const ROOT = dirname(dirname(SELF));

const IGNORE_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.turbo',
  '.wrangler',
  '.git',
]);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (IGNORE_DIRS.has(name)) continue;
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function checkObject(obj, path, problems) {
  if (obj === null || typeof obj !== 'object') return;
  // Heuristic: any object with finding_id + severity as strings is treated
  // as a Finding instance. This excludes JSON Schema definitions where
  // those keys are property descriptors (objects), not values.
  if (
    'finding_id' in obj &&
    'severity' in obj &&
    typeof obj.finding_id === 'string' &&
    typeof obj.severity === 'string'
  ) {
    const ids = obj.evidence_ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      problems.push(`${path}: finding ${obj.finding_id} missing evidence_ids[]`);
    }
  }
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) checkObject(obj[i], `${path}[${i}]`, problems);
  } else {
    for (const k of Object.keys(obj)) checkObject(obj[k], `${path}.${k}`, problems);
  }
}

const problems = [];
for (const file of walk(ROOT)) {
  if (!file.endsWith('.json') && !file.endsWith('.jsonl')) continue;
  const rel = relative(ROOT, file);
  if (rel.startsWith('node_modules') || rel.startsWith('.git')) continue;
  if (rel.includes('package.json') || rel.includes('tsconfig')) continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (file.endsWith('.jsonl')) {
    const lines = text.split('\n').filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      try {
        const obj = JSON.parse(lines[i]);
        checkObject(obj, `${rel}:${i + 1}`, problems);
      } catch {
        // skip malformed lines; schema validator catches them
      }
    }
  } else {
    try {
      const obj = JSON.parse(text);
      checkObject(obj, rel, problems);
    } catch {
      // skip non-JSON-looking .json files (turbo cache etc.)
    }
  }
}

if (problems.length > 0) {
  // eslint-disable-next-line no-console
  for (const p of problems) console.error(`[evidence-ids] ${p}`);
  // eslint-disable-next-line no-console
  console.error(`\n${problems.length} finding(s) missing evidence_ids. See CONSTRAINTS.md §6.`);
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log('verify-evidence-ids: OK');
