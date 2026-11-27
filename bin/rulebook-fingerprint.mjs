#!/usr/bin/env node
// Rules fingerprint for the rulebook (spec 032): a hash of the default
// configuration, the objective descriptions and the gameplay specs (02x).
// Usage: node bin/rulebook-fingerprint.mjs   prints the current fingerprint
//        and whether assets/rulebook.md records it.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CONFIG, OBJECTIVE_INFO } from '../src/engine/index.js';

const root = new URL('..', import.meta.url);
export const RULEBOOK_PATH = 'assets/rulebook.md';

function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/** FNV-1a, 32-bit, as 8 hex digits. */
function fnv1a(text) {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function rulesFingerprint() {
  const specDir = new URL('specs/', root);
  const specs = readdirSync(specDir).filter((f) => /^02\d-.*\.md$/.test(f)).sort()
    .map((f) => `${f}\n${readFileSync(new URL(f, specDir), 'utf8').replace(/\r\n?/g, '\n')}`);
  return fnv1a([stable(DEFAULT_CONFIG), stable(OBJECTIVE_INFO), ...specs].join('\n\u0000\n'));
}

export function recordedFingerprint() {
  const m = readFileSync(new URL(RULEBOOK_PATH, root), 'utf8').match(/<!--\s*rules-fingerprint:\s*(\S+)\s*-->/);
  return m ? m[1] : null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const now = rulesFingerprint();
  const recorded = recordedFingerprint();
  console.log(`rules fingerprint: ${now}`);
  console.log(recorded === now ? `${RULEBOOK_PATH} is up to date.` : `${RULEBOOK_PATH} records ${recorded}: review the rulebook, then set <!-- rules-fingerprint: ${now} -->.`);
  process.exitCode = recorded === now ? 0 : 1;
}
