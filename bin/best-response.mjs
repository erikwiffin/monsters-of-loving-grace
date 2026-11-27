#!/usr/bin/env node
// Best-response report: how much better than the standard heuristic each
// role can be played, in one deviating seat against a standard field.
// Challengers: tuned weights from experiments/tuned/<objective>.json, and the
// behaviour-tree policy for Prometheus.
// Usage: node bin/best-response.mjs [--objectives prometheus,visionary,inquisitor,unleasher]
//          [--players 3,4,5,6] [--games 400] [--seed br] [--threads N] [--out report.json]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { bestResponse } from '../src/sim/tune.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const objectives = opt('objectives', 'prometheus,visionary,inquisitor,unleasher').split(',');
const challengers = {};
for (const o of objectives) {
  challengers[o] = {};
  const file = `experiments/tuned/${o}.json`;
  if (existsSync(file)) challengers[o].tuned = { policy: 'heuristic', options: { weights: JSON.parse(readFileSync(file, 'utf8')).weights }, label: 'tuned' };
  if (o === 'prometheus') challengers[o].bt = 'bt';
}
const rows = await bestResponse({
  objectives, challengers,
  players: opt('players', '3,4,5,6').split(',').map(Number),
  games: Number(opt('games', 400)),
  seedPrefix: opt('seed', 'br'),
  threads: opt('threads') ? Number(opt('threads')) : undefined,
});
const p = (x) => `${(100 * x).toFixed(1)}%`;
console.log('objective    challenger  standard  challenger  gap [95% interval]        p      by players (standard → challenger)');
for (const r of rows) {
  const by = Object.entries(r.byPlayers).map(([n, x]) => `${n}p ${p(x.standard)}→${x.challenger == null ? '-' : p(x.challenger)}`).join('  ');
  console.log(`${r.objective.padEnd(12)} ${r.challenger.padEnd(10)}  ${p(r.standard.rate).padStart(8)}  ${p(r.best.rate).padStart(10)}  ${(r.gap.diff >= 0 ? '+' : '') + (100 * r.gap.diff).toFixed(1)} [${(100 * r.gap.lo).toFixed(1)}, ${(100 * r.gap.hi).toFixed(1)}]`.padEnd(70) + `${r.gap.p.toFixed(3)}  ${by}`);
}
console.log('\nA large gap means the role is under-measured by the standard bot: balance numbers for it reflect AI skill as much as the rules.');
if (opt('out')) writeFileSync(opt('out'), JSON.stringify(rows, null, 2));
