#!/usr/bin/env node
/**
 * verify-spec-consistency.mjs
 *
 * Sanity checks:
 *   1. schemas/index.json points at existing schema files.
 *   2. Every profile YAML has a `disclaimer` and per-requirement `limitation`.
 *   3. Every `severity` value found in profiles or examples is one of the
 *      five allowed levels.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const ROOT = dirname(dirname(SELF));

const ALLOWED_SEVERITIES = new Set(['info', 'low', 'medium', 'high', 'critical']);
let problems = [];

// (1) schemas/index.json points at existing schema files.
{
  const idx = JSON.parse(readFileSync(join(ROOT, 'schemas/index.json'), 'utf8'));
  for (const v of Object.keys(idx.schemas)) {
    for (const f of idx.schemas[v].files) {
      if (!existsSync(join(ROOT, 'schemas', f))) {
        problems.push(`schemas/index.json references missing file: ${f}`);
      }
    }
  }
}

// (2) Profile YAML structural check — minimal regex-based (no yaml parser dep).
{
  const profDir = join(ROOT, 'profiles');
  for (const name of readdirSync(profDir)) {
    if (!name.endsWith('.yaml')) continue;
    const text = readFileSync(join(profDir, name), 'utf8');
    if (!/^disclaimer:/m.test(text) && !/\ndisclaimer:/.test(text)) {
      problems.push(`profiles/${name}: missing top-level 'disclaimer:' field`);
    }
    // Each requirement entry should include limitation.
    const requirementBlocks = text.split(/\n\s*-\s+id:/).slice(1);
    for (const block of requirementBlocks) {
      if (!/limitation:/.test(block)) {
        const head = block.split('\n')[0].trim();
        problems.push(`profiles/${name}: requirement '${head}' missing 'limitation:' field`);
      }
    }
  }
}

// (3) Severity values in JSON/JSONL examples.
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', '.turbo', '.git']);
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (IGNORE_DIRS.has(name)) continue;
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else yield full;
  }
}
function checkSev(obj, where) {
  if (obj === null || typeof obj !== 'object') return;
  if ('severity' in obj && typeof obj.severity === 'string') {
    if (!ALLOWED_SEVERITIES.has(obj.severity)) {
      problems.push(`${where}: invalid severity '${obj.severity}'`);
    }
  }
  if (Array.isArray(obj)) obj.forEach((v, i) => checkSev(v, `${where}[${i}]`));
  else for (const k of Object.keys(obj)) checkSev(obj[k], `${where}.${k}`);
}
for (const file of walk(ROOT)) {
  if (!file.endsWith('.json') && !file.endsWith('.jsonl')) continue;
  const rel = relative(ROOT, file);
  if (rel.includes('node_modules') || rel.startsWith('.git')) continue;
  if (rel.endsWith('package.json') || rel.endsWith('tsconfig.json')) continue;
  if (rel.endsWith('turbo.json') || rel.endsWith('biome.json')) continue;
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
        checkSev(JSON.parse(lines[i]), `${rel}:${i + 1}`);
      } catch {}
    }
  } else {
    try {
      checkSev(JSON.parse(text), rel);
    } catch {}
  }
}

if (problems.length > 0) {
  // eslint-disable-next-line no-console
  for (const p of problems) console.error(`[spec-consistency] ${p}`);
  // eslint-disable-next-line no-console
  console.error(`\n${problems.length} spec-consistency issue(s).`);
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log('verify-spec-consistency: OK');
