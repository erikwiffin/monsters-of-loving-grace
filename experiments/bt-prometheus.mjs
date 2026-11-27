// Experiment: one Prometheus seat plays the policy under test, every other
// seat the heuristic. Reports that seat's win rate per player count.
//   node experiments/bt-prometheus.mjs [--policy bt|heuristic] [--games N]
//     [--players 3,4,5,6] [--seed prefix] [--threads 4] [--verbose]
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { createGame } from '../src/engine/index.js';
import { runGame } from '../src/sim/runner.js';
import { POLICIES } from '../src/sim/policies.js';
import { btPrometheusPolicy } from '../src/sim/bt-prometheus.js';

const pid0 = (x) => x;
function play({ n, i, prefix, which, params }) {
  const seed = `${prefix}-${n}-${i}`;
  const config = { playerCount: n };
  const probe = createGame(config, seed);
  // The first seat dealt Prometheus plays the policy under test. The runner
  // may read authoritative state; the policies never do.
  const target = probe.players.find((p) => probe.objectives[p.id] === 'prometheus').id;
  const make = which === 'bt' ? (sd) => btPrometheusPolicy(sd, { params }) : POLICIES[which];
  const pol = make(`${seed}:${pid0(target)}:test`);
  const policies = (pid) => (pid === target ? pol : 'heuristic');
  const { summary } = runGame({ seed, config, policies, maxRounds: 60, includeCommands: false });
  const won = summary.winners.includes(target);
  const mine = summary.resurrections.filter((x) => x.playerId === target).map((x) => x.outcome);
  return {
    seed, n, won, invalid: summary.invalidCommands, truncated: summary.truncated, rounds: summary.rounds,
    key: won ? 'win' : `${summary.terminalReason || 'trunc'}:${summary.winnerObjectives.join('+') || 'none'}${summary.terminalReason === 'objective'
      ? `[${summary.resurrections.filter((x) => x.round === summary.rounds && x.outcome === 'stable').map((x) => (x.playerId === target ? 'me' : summary.objectives[x.playerId].slice(0, 3))).join(',')}]` : ''}`,
    mine,
    log: pol.log || [],
    myFirst: (summary.resurrections.find((x) => x.playerId === target) || {}).round ?? null,
    rivalFirst: (summary.resurrections.find((x) => x.playerId !== target) || {}).round ?? null,
  };
}

const avg2 = (xs, k) => (xs.reduce((a, x) => a + x[k], 0) / xs.length).toFixed(2);

if (!isMainThread) {
  parentPort.postMessage(workerData.jobs.map(play));
} else {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  const games = Number(opt('games', 200));
  const counts = opt('players', '3,4,5,6').split(',').map(Number);
  const which = opt('policy', 'bt');
  const prefix = opt('seed', 'btp');
  const params = JSON.parse(opt('params', '{}'));
  const threads = Number(opt('threads', availableParallelism()));
  const jobs = [];
  for (const n of counts) for (let i = 0; i < games; i++) jobs.push({ n, i, prefix, which, params });
  const chunks = Array.from({ length: threads }, (_, t) => jobs.filter((_, j) => j % threads === t));
  const parts = await Promise.all(chunks.map((c) => new Promise((res, rej) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { jobs: c } });
    w.on('message', res); w.on('error', rej);
  })));
  const results = parts.flat();
  let allOk = true;
  for (const n of counts) {
    const rs = results.filter((r) => r.n === n);
    const wins = rs.filter((r) => r.won).length;
    const why = {};
    for (const r of rs) why[r.key] = (why[r.key] || 0) + 1;
    const own = {};
    for (const r of rs) for (const o of r.mine) own[o] = (own[o] || 0) + 1;
    const rate = wins / rs.length;
    if (rate < 0.9) allOk = false;
    const avgRounds = rs.reduce((a, r) => a + r.rounds, 0) / rs.length;
    console.log(`${n}p: ${(100 * rate).toFixed(1)}% (${wins}/${rs.length}) invalid=${rs.reduce((a, r) => a + r.invalid, 0)} truncated=${rs.filter((r) => r.truncated).length} avgRounds=${avgRounds.toFixed(1)}`);
    const avg = (f) => { const v = rs.map(f).filter((x) => x != null); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : '-'; };
    console.log(`    first attempt: mine r${avg((r) => r.myFirst)} rivals r${avg((r) => r.rivalFirst)}`);
    const logs = rs.flatMap((r) => r.log);
    if (logs.length) console.log(`    attempts ${logs.length}: pStable ${avg2(logs, 'pStable')} pH ${avg2(logs, 'pH')} pV ${avg2(logs, 'pV')} pEscape ${avg2(logs, 'pEscape')}`);
    console.log(`    outcomes ${JSON.stringify(why)}  own attempts ${JSON.stringify(own)}`);
    if (args.includes('--verbose')) for (const r of rs) if (!r.won) console.log(`    ${r.seed} ${r.key} r${r.rounds} ${r.mine.join(',')}`);
  }
  console.log(allOk ? 'TARGET MET' : 'target not met');
}
