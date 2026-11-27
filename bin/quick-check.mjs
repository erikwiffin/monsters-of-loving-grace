#!/usr/bin/env node
// Quick sanity check of a rule change before a full balance run, in about a
// minute. Give it the change as configuration overrides:
//   node bin/quick-check.mjs change.json [--players 3,5] [--games 200] [--skip-scenarios]
//
// 1. Scenario tests under the changed rules: do the bots still behave sensibly?
// 2. Exact metamorphic checks under the changed rules: renaming research or
//    players changes no game (the AI reads effects, not IDs).
// 3. A screening comparison, standard heuristic, the same seeds with and
//    without the change: catches changes in win rate of about ±7 points.
// 4. Uptake of the content the change touches, and content the bots stop
//    using: a changed card nobody takes is an AI blind spot to fix before
//    trusting any win rate.
// It ends with what to do next. Anything subtler than it can see needs
// bin/compare.mjs with several policy sets.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolveConfig } from '../src/engine/index.js';
import { runGames } from '../src/sim/parallel.js';
import { aggregate } from '../src/sim/runner.js';
import { tally, diffs } from '../src/sim/compare.js';
import { CHECKS, runCheck } from '../src/sim/metamorphic.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const file = args.find((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
if (!file) { console.error('Usage: node bin/quick-check.mjs change.json [--players 3,5] [--games 200] [--skip-scenarios]'); process.exit(2); }
const change = JSON.parse(readFileSync(file, 'utf8'));
const players = opt('players', '3,5').split(',').map(Number);
const games = Number(opt('games', 200));
const started = Date.now();
const elapsed = () => `${Math.round((Date.now() - started) / 1000)}s`;
const flags = [];
const pct = (x) => `${(100 * x).toFixed(1)}%`;

// The change must be valid rules at every player count.
for (const n of players) resolveConfig({ ...change, playerCount: n });

// 1. Scenarios.
if (!args.includes('--skip-scenarios')) {
  const r = spawnSync(process.execPath, ['--test', new URL('../test/policy-scenarios.test.mjs', import.meta.url).pathname], {
    env: { ...process.env, MOLG_SCENARIO_CONFIG: JSON.stringify(change) }, encoding: 'utf8',
  });
  const failed = (r.stdout.match(/^not ok \d+ - .*$/gm) || []).map((l) => l.replace(/^not ok \d+ - /, ''));
  const passed = (r.stdout.match(/^# pass (\d+)/m) || [])[1];
  console.log(`1. Scenarios under the change: ${passed} passed, ${failed.length} failed (${elapsed()})`);
  for (const f of failed) console.log(`   FAIL ${f}`);
  if (failed.length) flags.push(`${failed.length} scenario(s) fail under the change: the bots misplay it, or the scenario no longer applies to the new rules`);
}

// 2. Exact metamorphic checks.
const exact = [];
for (const check of CHECKS.filter((c) => c.exact)) {
  const r = await runCheck(check, { players: players[players.length - 1], policies: 'heuristic', base: change });
  exact.push(`${r.pass ? 'pass' : 'FAIL'} ${check.id} (${r.detail})`);
  if (!r.pass) flags.push(`${check.id} fails under the change: the AI depends on an ID`);
}
console.log(`2. Exact checks under the change: ${exact.join('; ')} (${elapsed()})`);

// 3 and 4. Screening comparison and uptake, on the same games.
console.log(`3. Screening comparison, standard heuristic, ${games} games per arm (same seeds):`);
const touched = {
  research: Object.keys(change.research || {}),
  actions: Object.keys(change.actions || {}),
  variants: Object.keys(change.partVariants || {}),
};
const uptakeLines = [];
for (const n of players) {
  const job = (config) => Array.from({ length: games }, (_, i) => ({ seed: `quick-${n}-${i}`, config: { ...config, playerCount: n }, policies: 'heuristic', maxRounds: 60 }));
  const [ra, rb] = await Promise.all([runGames(job({})), runGames(job(change))]);
  const d = diffs(tally(ra), tally(rb));
  const cells = Object.entries(d).map(([o, x]) => `${o} ${pct(x.a)}→${pct(x.b)}${x.p < 0.05 ? ` (p ${x.p.toFixed(3)})` : ''}`);
  console.log(`   ${n}p  ${cells.join('  ')}`);
  for (const [o, x] of Object.entries(d)) if (x.p < 0.05) flags.push(`${n}p ${o} ${pct(x.a)} → ${pct(x.b)} (p ${x.p.toFixed(3)})`);
  const ta = ra.filter((r) => r.truncated).length;
  const tb = rb.filter((r) => r.truncated).length;
  if (tb > ta + Math.max(3, games * 0.02)) {
    const why = {};
    for (const r of rb.filter((x) => x.truncated)) {
      const k = r.truncationReason === 'hoarding' && r.hoarding ? `hoarding ${r.hoarding.resource} (${r.hoarding.objective})` : r.truncationReason;
      why[k] = (why[k] || 0) + 1;
    }
    flags.push(`${n}p truncated games rise from ${ta} to ${tb}: ${Object.entries(why).map(([k, v]) => `${v} ${k}`).join(', ')}`);
  }
  const invalid = rb.reduce((a, r) => a + r.invalidCommands, 0);
  if (invalid) flags.push(`${n}p ${invalid} invalid commands under the change`);

  const ua = aggregate(ra, resolveConfig({ playerCount: n })).uptake;
  const ab = aggregate(rb, resolveConfig({ ...change, playerCount: n }));
  const ub = ab.uptake;
  for (const t of touched.research) {
    const x = ua.research[t];
    const y = ub.research[t];
    if (!y) continue;
    const bought = (u) => (u ? u.perGame.research : 0);
    uptakeLines.push(`${n}p research ${t}: in ${pct(x ? x.acquiredInGames : 0)}→${pct(y.acquiredInGames)} of games; researched ${bought(x).toFixed(2)}→${bought(y).toFixed(2)}/game; applied ${(x ? x.perGame.appliedInRolls : 0).toFixed(2)}→${y.perGame.appliedInRolls.toFixed(2)}/game`);
    if (x && bought(x) > 0.2 && bought(y) < 0.5 * bought(x)) flags.push(`${n}p bots research ${t} far less after the change (${bought(x).toFixed(2)} → ${bought(y).toFixed(2)} per game): weaker card, or the AI doesn't understand it`);
    if (!x && y.acquiredInGames < 0.05) flags.push(`${n}p new research ${t} is almost never taken: the AI may not value its effect`);
  }
  for (const id of touched.actions) {
    const x = (aggregate(ra).actions[id] || {}).perRound || 0;
    const y = (ab.actions[id] || {}).perRound || 0;
    uptakeLines.push(`${n}p action ${id}: ${x.toFixed(3)}→${y.toFixed(3)} placements per round`);
  }
  const newly = ub.rarelyUsed.filter((k) => !ua.rarelyUsed.includes(k));
  if (newly.length) flags.push(`${n}p newly rarely used: ${newly.join(', ')}`);
}
console.log(`4. Uptake of the changed content${uptakeLines.length ? ':' : ': nothing in the change to track'} (${elapsed()})`);
for (const l of uptakeLines) console.log(`   ${l}`);

console.log('');
if (!flags.length) {
  console.log(`Nothing flagged (${elapsed()}). Effects smaller than about ±7 points can't be seen at ${games} games: run bin/compare.mjs before relying on it.`);
} else {
  console.log(`Flagged (${elapsed()}):`);
  for (const f of flags) console.log(`  - ${f}`);
  console.log('Next: fix AI flags first (scenarios, exact checks, uptake), then confirm win-rate changes with');
  console.log(`  node bin/compare.mjs --candidate ${file} --policies 'heuristic;cautious,bold;noisy' --games 400 --max-games 800`);
}
