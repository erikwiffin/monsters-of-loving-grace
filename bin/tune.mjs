#!/usr/bin/env node
// Tune the heuristic's weights for one objective (src/sim/tune.js), as a best
// response to a field of standard heuristics, and save them.
// Usage: node bin/tune.mjs --objective prometheus [--players 4,5] [--games 80]
//          [--generations 6] [--population 10] [--keys a,b,c] [--seed tune]
//          [--out experiments/tuned/prometheus.json] [--threads N]
import { writeFileSync } from 'node:fs';
import { tuneWeights } from '../src/sim/tune.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const objective = opt('objective');
if (!objective) { console.error('Give --objective prometheus|visionary|inquisitor|unleasher'); process.exit(2); }
const started = Date.now();
const result = await tuneWeights({
  objective,
  players: opt('players', '4,5').split(',').map(Number),
  games: Number(opt('games', 80)),
  generations: Number(opt('generations', 6)),
  population: Number(opt('population', 10)),
  seed: opt('seed', 'tune'),
  ...(opt('keys') ? { keys: opt('keys').split(',') } : {}),
  threads: opt('threads') ? Number(opt('threads')) : undefined,
  onGeneration: (g) => console.error(`generation ${g.generation}: mean ${(100 * g.meanCandidateRate).toFixed(1)}%, best ${(100 * g.best).toFixed(1)}%, elite ${(100 * g.eliteMean).toFixed(1)}% (${Math.round((Date.now() - started) / 1000)}s)`),
});
const out = opt('out', `experiments/tuned/${objective}.json`);
writeFileSync(out, `${JSON.stringify({ objective, weights: result.weights, history: result.history, settings: { players: opt('players', '4,5'), games: Number(opt('games', 80)), generations: Number(opt('generations', 6)), population: Number(opt('population', 10)) } }, null, 2)}\n`);
console.log(`wrote ${out}`);
console.log(JSON.stringify(result.weights));
