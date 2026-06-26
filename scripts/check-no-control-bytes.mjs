#!/usr/bin/env node
/**
 * check-no-control-bytes.mjs
 *
 * Reject NUL and other non-whitespace control bytes in text files.
 * These can break grep/diff/CI parsers silently.
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

const TEXT_EXT = new Set([
  '.md', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.jsonc',
  '.yaml', '.yml', '.toml', '.sql', '.txt', '.j2', '.html', '.css',
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

let hits = 0;
for (const file of walk(ROOT)) {
  const dot = file.lastIndexOf('.');
  const ext = dot >= 0 ? file.slice(dot) : '';
  if (!TEXT_EXT.has(ext)) continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Allow \t (0x09), \n (0x0A), \r (0x0D); reject other 0x00–0x1F and 0x7F.
    if (
      (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
      code === 0x7f
    ) {
      const rel = relative(ROOT, file);
      // eslint-disable-next-line no-console
      console.error(`[control-bytes] ${rel}: control byte 0x${code.toString(16)} at offset ${i}`);
      hits++;
      break;
    }
  }
}

if (hits > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${hits} file(s) contain control bytes.`);
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log('check-no-control-bytes: OK');
