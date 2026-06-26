#!/usr/bin/env node
/**
 * check-no-sensitive-info.mjs
 *
 * Reject sensitive information patterns from any committed file.
 * See CONSTRAINTS.md §9.
 *
 * Patterns:
 *   - Personal absolute paths "/Users/<name>/"
 *   - Internal proxy / corp domains "*.corp", "sap.corp"
 *   - Specific hardware model names (CPU SKUs)
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

// Patterns assembled to avoid self-flagging.
const PERSONAL_PATH = new RegExp('/' + 'Users/' + '[A-Za-z0-9]+/');
const CORP_DOMAIN = new RegExp(['[a-z0-9-]+\\.', 'corp'].join(''));
const HW_MODELS = [
  'M5 Pro',
  'M5 Max',
  '5600G',
  'Ryzen 5600',
  'Ryzen 9 7950',
];

const EXEMPT_FILES = new Set(
  [
    'scripts/check-no-sensitive-info.mjs',
  ],
);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (IGNORE_DIRS.has(name)) continue;
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else yield full;
  }
}

let hits = 0;
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file);
  if (EXEMPT_FILES.has(rel)) continue;
  // Skip binary-ish extensions.
  if (/\.(png|jpg|jpeg|gif|webp|pdf|zip|tar|gz|woff2?)$/i.test(rel)) continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (PERSONAL_PATH.test(text)) {
    // eslint-disable-next-line no-console
    console.error(`[sensitive-info] ${rel}: personal absolute path detected`);
    hits++;
  }
  if (CORP_DOMAIN.test(text)) {
    // eslint-disable-next-line no-console
    console.error(`[sensitive-info] ${rel}: internal corp domain pattern detected`);
    hits++;
  }
  for (const model of HW_MODELS) {
    if (text.includes(model)) {
      // eslint-disable-next-line no-console
      console.error(`[sensitive-info] ${rel}: forbidden hardware model "${model}"`);
      hits++;
    }
  }
}

if (hits > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${hits} sensitive-info pattern(s). See CONSTRAINTS.md §9.`);
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log('check-no-sensitive-info: OK');
