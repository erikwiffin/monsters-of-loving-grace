#!/usr/bin/env node
// Metamorphic checks for the AI policies (src/sim/metamorphic.js). Exits 1 if
// any check fails.
// Usage: node bin/ai-checks.mjs [--policies 'heuristic;bt'] [--players 4]
//          [--scale 1] [--only id,id] [--exact] [--threads N]
// Exact checks (renaming) play 20 games each; statistical ones 100-150,
// times --scale. --exact runs only the exact checks.
import { CHECKS, runCheck } from '../src/sim/metamorphic.js';
import { parsePolicySet } from '../src/sim/compare.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const sets = opt('policies', 'heuristic;bt').split(';').map(parsePolicySet);
const players = opt('players', '4').split(',').map(Number);
const only = opt('only') ? opt('only').split(',') : null;
const scale = Number(opt('scale', 1));
const exactOnly = args.includes('--exact');
const threads = opt('threads') ? Number(opt('threads')) : undefined;

let failed = 0;
for (const check of CHECKS.filter((c) => (!only || only.includes(c.id)) && (!exactOnly || c.exact))) {
  for (const n of players) {
    for (const policies of sets) {
      const r = await runCheck(check, { players: n, policies, scale, threads });
      if (!r.pass) failed += 1;
      console.log(`${r.pass ? 'pass' : 'FAIL'}  ${check.id.padEnd(18)} ${String(n)}p ${JSON.stringify(policies).padEnd(12)} ${r.detail}`);
    }
  }
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
