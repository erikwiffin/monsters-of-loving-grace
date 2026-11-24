#!/usr/bin/env node
// Headless AI playtest runner.
// Usage: node bin/simulate.mjs [--games 100] [--seed batch] [--players 5]
//        [--policy heuristic|random|heuristic,random,...] [--max-commands 20000]
//        [--max-rounds 200] [--config overrides.json] [--commands] [--out results.json] [--jsonl]
import { readFileSync, writeFileSync } from 'node:fs';
import { runGame, aggregate } from '../src/sim/runner.js';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);
if (flag('help')) {
  console.log(readFileSync(new URL(import.meta.url)).toString().split('\n').slice(1, 6).join('\n'));
  process.exit(0);
}

const games = Number(opt('games', 100));
const seedPrefix = opt('seed', 'batch');
const players = Number(opt('players', 5));
const policySpec = opt('policy', 'heuristic');
const policies = policySpec.includes(',') ? policySpec.split(',') : policySpec;
const config = { playerCount: players, ...(opt('config') ? JSON.parse(readFileSync(opt('config'), 'utf8')) : {}) };
const runOpts = {
  config, policies,
  maxCommands: Number(opt('max-commands', 20000)),
  maxRounds: Number(opt('max-rounds', 200)),
  includeCommands: flag('commands'),
};

const results = [];
for (let i = 0; i < games; i++) {
  const seed = games === 1 ? seedPrefix : `${seedPrefix}-${i}`;
  const { summary } = runGame({ ...runOpts, seed });
  results.push(summary);
  if (flag('jsonl')) process.stdout.write(`${JSON.stringify(summary)}\n`);
}
const agg = aggregate(results);
const out = opt('out');
if (out) writeFileSync(out, JSON.stringify({ options: { ...runOpts, games, seedPrefix }, aggregate: agg, results }, null, 2));
else if (!flag('jsonl')) process.stdout.write(`${JSON.stringify({ aggregate: agg, results }, null, 2)}\n`);
process.stderr.write(`${JSON.stringify(agg, null, 2)}\n`);
