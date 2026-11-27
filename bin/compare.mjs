#!/usr/bin/env node
// Compare two arms on the same seeds, with confidence intervals, under
// several policy sets, and say whether each effect holds across them.
//
// A rule change: two configuration override files.
//   node bin/compare.mjs --candidate change.json [--base base.json]
// A policy change: the same rules, two seatings.
//   node bin/compare.mjs --base-policies heuristic --candidate-policies bt
//
// Options:
//   --policies 'heuristic;cautious,bold;noisy;bt'  policy sets, separated by ';'
//                                                   (a comma assigns seats in order)
//   --players 3,4,5,6  --games 200  --max-games 1600  --precision 0.03
//   --seed cmp  --max-rounds 60  --threads N  --out comparison.json
import { readFileSync, writeFileSync } from 'node:fs';
import { compareArms, formatComparison, parsePolicySet } from '../src/sim/compare.js';
import { specName } from '../src/sim/registry.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
if (args.includes('--help')) {
  console.log(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(1, 16).join('\n'));
  process.exit(0);
}
const readConfig = (file) => (file ? JSON.parse(readFileSync(file, 'utf8')) : {});
const basePolicies = opt('base-policies');
const candPolicies = opt('candidate-policies');
const a = { config: readConfig(opt('base')), ...(basePolicies ? { policies: parsePolicySet(basePolicies) } : {}) };
const b = { config: readConfig(opt('candidate')), ...(candPolicies ? { policies: parsePolicySet(candPolicies) } : {}) };
if (basePolicies || candPolicies) { a.policies ??= 'heuristic'; b.policies ??= 'heuristic'; }
const policySets = basePolicies || candPolicies ? ['(as given)'] : opt('policies', 'heuristic;cautious,bold;noisy').split(';').map(parsePolicySet);
if (!opt('base') && !opt('candidate') && !basePolicies && !candPolicies) {
  console.error('Give --candidate (and optionally --base) configuration files, or --base-policies and --candidate-policies.');
  process.exit(2);
}

const result = await compareArms({
  a, b, policySets,
  players: opt('players', '3,4,5,6').split(',').map(Number),
  games: Number(opt('games', 200)),
  maxGames: Number(opt('max-games', 1600)),
  precision: Number(opt('precision', 0.03)),
  seedPrefix: opt('seed', 'cmp'),
  maxRounds: Number(opt('max-rounds', 60)),
  threads: opt('threads') ? Number(opt('threads')) : undefined,
  onProgress: (p) => process.stderr.write(`${p.players}p ${p.set}: ${p.games} games, ${p.open} unsettled\n`),
});
const label = (x) => (Array.isArray(x) ? x.map(specName).join(',') : specName(x));
const labels = basePolicies || candPolicies ? [label(a.policies), label(b.policies)] : ['base', 'cand.'];
console.log(formatComparison(result, { labels: labels.map((l) => l.slice(0, 7)) }));
if (opt('out')) writeFileSync(opt('out'), JSON.stringify({ a, b, ...result }, null, 2));
