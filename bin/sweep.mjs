#!/usr/bin/env node
// Parameter sweep runner (spec 016).
// Usage: node bin/sweep.mjs <sweep.json> [--out results.jsonl] [--threads N]
//        [--games N] [--players 3,5] [--sampler oat|grid|random|lhs] [--samples N]
//
// The sweep file:
// {
//   "games": 100,                      // games per point, per player count, per policy set
//   "players": [3, 4, 5, 6],
//   "policies": ["heuristic", "cautious,bold"],   // each entry is one policy set (comma = per seat)
//   "base": { ...config overrides applied to every point... },
//   "params": { "actions.medicine.gain": [2, 3, 4], "actions.charity.cost": { "min": 2, "max": 5 } },
//   "sampler": "oat", "samples": 20, "seed": "sweep",
//   "targets": { ...overrides of DEFAULT_TARGETS... },
//   "maxRounds": 60
// }
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

if (!isMainThread) {
  const { runBatch } = await import('../src/sim/runner.js');
  const { compactAggregate } = await import('../src/sim/sweep.js');
  parentPort.on('message', (job) => {
    try {
      const policies = job.policies.includes(',') ? job.policies.split(',') : job.policies;
      const { aggregate } = runBatch({ games: job.games, policies, config: job.config, seedPrefix: job.seedPrefix, includeCommands: false, maxRounds: job.maxRounds });
      parentPort.postMessage({ id: job.id, aggregate: compactAggregate(aggregate) });
    } catch (e) {
      parentPort.postMessage({ id: job.id, error: e.message });
    }
  });
} else {
  const { samplePoints, configForPoint, scoreAggregate, DEFAULT_TARGETS } = await import('../src/sim/sweep.js');
  const args = process.argv.slice(2);
  const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
  const file = args.find((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
  if (!file) { console.error('Usage: node bin/sweep.mjs <sweep.json> [--out results.jsonl] [--threads N]'); process.exit(2); }
  const spec = JSON.parse(readFileSync(file, 'utf8'));
  const games = Number(opt('games', spec.games || 100));
  const players = (opt('players') ? opt('players').split(',').map(Number) : spec.players || [3, 4, 5, 6]);
  const policySets = spec.policies || ['heuristic'];
  const sampler = opt('sampler', spec.sampler || 'oat');
  const samples = Number(opt('samples', spec.samples || 20));
  const targets = { ...DEFAULT_TARGETS, ...(spec.targets || {}) };
  const maxRounds = spec.maxRounds || 60;
  const out = opt('out', null);
  const threads = Number(opt('threads', Math.max(1, cpus().length)));
  const points = samplePoints({ params: spec.params || {}, sampler, samples, seed: spec.seed || 'sweep' });

  // Every point uses the same seeds (common random numbers), so differences
  // between points come from the rules, not from luck.
  const jobs = [];
  points.forEach((point, pi) => {
    for (const n of players) {
      const config = configForPoint(spec.base, point, n);
      for (const policies of policySets) {
        jobs.push({ id: jobs.length, pi, point, players: n, policies, games, config, maxRounds, seedPrefix: `${spec.seed || 'sweep'}-${n}` });
      }
    }
  });
  console.error(`${points.length} points × ${players.length} player counts × ${policySets.length} policy sets = ${jobs.length} batches of ${games} games on ${threads} threads`);
  if (out) writeFileSync(out, '');

  const results = new Array(jobs.length);
  let next = 0;
  let done = 0;
  const started = Date.now();
  await new Promise((resolveAll, rejectAll) => {
    const self = fileURLToPath(import.meta.url);
    const pool = Array.from({ length: Math.min(threads, jobs.length) }, () => new Worker(self));
    const feed = (w) => { if (next < jobs.length) w.postMessage(jobs[next++]); else w.terminate(); };
    for (const w of pool) {
      w.on('message', (m) => {
        const job = jobs[m.id];
        if (m.error) { rejectAll(new Error(`Point ${JSON.stringify(job.point)} at ${job.players} players: ${m.error}`)); return; }
        const score = scoreAggregate(m.aggregate, targets);
        const row = { point: job.point, players: job.players, policies: job.policies, score, aggregate: m.aggregate };
        results[m.id] = row;
        if (out) appendFileSync(out, `${JSON.stringify(row)}\n`);
        done += 1;
        if (done % Math.max(1, Math.floor(jobs.length / 20)) === 0 || done === jobs.length) {
          console.error(`  ${done}/${jobs.length} batches (${Math.round((Date.now() - started) / 1000)}s)`);
        }
        if (done === jobs.length) resolveAll();
        feed(w);
      });
      w.on('error', rejectAll);
      feed(w);
    }
  });

  // Rank points by mean penalty over player counts and policy sets.
  const byPoint = new Map();
  for (const r of results) {
    const key = JSON.stringify(r.point);
    const x = byPoint.get(key) || { point: r.point, total: 0, n: 0, worst: [] };
    x.total += r.score.total;
    x.n += 1;
    for (const [k, v] of Object.entries(r.score.parts)) x.worst.push([`${r.players}p ${k}`, v]);
    byPoint.set(key, x);
  }
  const ranked = [...byPoint.values()].map((x) => ({ ...x, mean: Math.round(1000 * x.total / x.n) / 1000 })).sort((a, b) => a.mean - b.mean);
  console.log('\nRank  Penalty  Point  (largest penalties)');
  ranked.forEach((x, i) => {
    const worst = x.worst.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(', ');
    console.log(`${String(i + 1).padStart(4)}  ${x.mean.toFixed(3).padStart(7)}  ${JSON.stringify(x.point) === '{}' ? '(baseline)' : JSON.stringify(x.point)}  ${worst}`);
  });
  const invalid = results.reduce((a, r) => a + (r.aggregate.invalidCommands || 0), 0);
  console.error(`\nInvalid commands across the sweep: ${invalid}`);
  if (invalid) process.exitCode = 1;
}
