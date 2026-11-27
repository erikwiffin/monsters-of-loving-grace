#!/usr/bin/env node
// Role balance across player counts: node bin/balance.mjs <games> base|<config.json> ...
// For each count, averages the heuristic and cautious,bold policy sets and
// compares each objective's win rate and the no-winner share with 1/(N+1).
// Compact balance score: for each player count, average policy sets, compare
// every role's win rate and the no-winner share with the fair share 1/(N+1).
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
if (!isMainThread) {
  const { runBatch } = await import(ROOT + '/src/sim/runner.js');
  parentPort.on('message', (j) => {
    const { aggregate: a } = runBatch({ games: j.games, policies: j.p.includes(',') ? j.p.split(',') : j.p, config: { ...j.cfg, playerCount: j.n }, seedPrefix: `bal-${j.n}-${j.k}`, includeCommands: false, maxRounds: 60 });
    parentPort.postMessage({ id: j.id, a });
  });
} else {
  const games = Number(process.argv[2] || 150);
  const files = process.argv.slice(3);
  const pols = ['heuristic', 'cautious,bold'];
  const chunks = 2; // split each batch for parallelism
  const jobs = [];
  for (const f of files) {
    const cfg = f === 'base' ? {} : JSON.parse(readFileSync(f, 'utf8'));
    for (const n of [3, 4, 5, 6]) for (const p of pols) for (let k = 0; k < chunks; k++) jobs.push({ id: jobs.length, f, cfg, n, p, k, games: Math.ceil(games / chunks) });
  }
  const results = new Array(jobs.length);
  await new Promise((res) => {
    let next = 0, done = 0;
    const pool = Array.from({ length: cpus().length }, () => new Worker(new URL(import.meta.url)));
    const feed = (w) => { if (next < jobs.length) w.postMessage(jobs[next++]); };
    for (const w of pool) { w.on('message', (m) => { results[m.id] = m.a; if (++done === jobs.length) { pool.forEach((x) => x.terminate()); res(); } else feed(w); }); feed(w); }
  });
  const roles = ['prometheus', 'visionary', 'inquisitor', 'unleasher'];
  for (const f of files) {
    let sq = 0, cnt = 0, worst = 0, inv = 0, trunc = 0;
    const lines = [];
    for (const n of [3, 4, 5, 6]) {
      const js = jobs.filter((j) => j.f === f && j.n === n);
      const wins = {}, dealt = {}; let none = 0, g = 0, rounds = [];
      for (const j of js) { const a = results[j.id]; g += a.games; none += a.collectiveDefeats; inv += a.invalidCommands; trunc += a.truncated; rounds.push(a.medianRounds);
        for (const o of roles) { wins[o] = (wins[o] || 0) + (a.winsByObjective[o] || 0); dealt[o] = (dealt[o] || 0) + (a.dealtByObjective[o] || 0); } }
      const fair = 1 / (n + 1);
      const vals = {};
      for (const o of roles) if (dealt[o]) vals[o] = wins[o] / dealt[o];
      vals.none = none / g;
      for (const v of Object.values(vals)) { sq += (v - fair) ** 2; cnt++; worst = Math.max(worst, Math.abs(v - fair)); }
      const fmt = (o) => (vals[o] == null ? '  -  ' : vals[o].toFixed(2));
      const vs = Object.values(vals);
      lines.push(`  ${n}p fair ${fair.toFixed(2)} | pro ${fmt('prometheus')} vis ${fmt('visionary')} inq ${fmt('inquisitor')} unl ${fmt('unleasher')} none ${fmt('none')} | spread ${(Math.max(...vs) - Math.min(...vs)).toFixed(2)} med ${rounds.sort()[1]}`);
    }
    console.log(`${f.replace(/.*\//, '')}: rms ${Math.sqrt(sq / cnt).toFixed(3)} worst ${worst.toFixed(3)} inv ${inv} trunc ${trunc}`);
    console.log(lines.join('\n'));
  }
}
