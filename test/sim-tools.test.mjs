// Unit tests for the AI quality tools: statistics, seatings, comparison
// verdicts, uptake metrics and explanations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wilson, compareRates, gamesForHalfWidth, normalP } from '../src/sim/stats.js';
import { seatSpec, makePolicy } from '../src/sim/registry.js';
import { verdicts, parsePolicySet } from '../src/sim/compare.js';
import { runGame, aggregate } from '../src/sim/runner.js';
import { heuristicPolicy, DEFAULT_WEIGHTS, OBJECTIVE_WEIGHTS } from '../src/sim/policies.js';
import { renameResearch } from '../src/sim/metamorphic.js';
import { researchWorth, expectedDiscovery } from '../src/sim/effect-values.js';
import { resolveConfig } from '../src/engine/index.js';
import { summarizeView, describeMove } from '../src/sim/llm-policy.js';
import { getPlayerView, enumerateLegalCommands } from '../src/engine/index.js';

test('statistics: Wilson interval, two-proportion test, sample size', () => {
  const w = wilson(50, 100);
  assert.ok(Math.abs(w.lo - 0.404) < 0.002 && Math.abs(w.hi - 0.596) < 0.002);
  assert.ok(Math.abs(normalP(1.959964) - 0.05) < 1e-4);
  const d = compareRates(40, 100, 55, 100);
  assert.ok(Math.abs(d.diff - 0.15) < 1e-9 && d.p < 0.05 && d.lo > 0);
  assert.ok(compareRates(10, 100, 10, 100).p > 0.999);
  assert.equal(gamesForHalfWidth(0.1), 97);
});

test('seatings: by objective, one deviator by default, or all', () => {
  const s = { default: 'heuristic', byObjective: { prometheus: 'bt' } };
  assert.equal(seatSpec(s, { index: 0, objective: 'prometheus', objectivesBefore: [] }), 'bt');
  assert.equal(seatSpec(s, { index: 2, objective: 'prometheus', objectivesBefore: ['visionary', 'prometheus'] }), 'heuristic');
  assert.equal(seatSpec({ ...s, deviators: 'all' }, { index: 2, objective: 'prometheus', objectivesBefore: ['prometheus'] }), 'bt');
  assert.equal(seatSpec(['a', 'b'], { index: 3, objective: 'x', objectivesBefore: [] }), 'b');
  assert.deepEqual(parsePolicySet('cautious,bold'), ['cautious', 'bold']);
  assert.equal(parsePolicySet('{"policy":"heuristic","label":"x"}').label, 'x');
  assert.equal(makePolicy({ policy: 'heuristic', label: 'tuned' }, 's').name, 'tuned');
});

test('the runner seats the first Prometheus with the deviating policy', () => {
  const { summary } = runGame({ seed: 'seat-1', config: { playerCount: 5 }, policies: { default: 'heuristic', byObjective: { prometheus: 'bt' } }, includeCommands: false, maxRounds: 3 });
  const pids = Object.keys(summary.objectives);
  const first = pids.find((p) => summary.objectives[p] === 'prometheus');
  pids.forEach((p, i) => assert.equal(summary.policies[i], p === first ? 'bt-prometheus' : 'heuristic'));
});

test('verdicts: robust, policy-dependent, untested with one set, none', () => {
  const cell = (set, diff, p) => ({ players: 4, set, diffs: { prometheus: { diff, p } } });
  assert.equal(verdicts([cell('a', 0.1, 0.01), cell('b', 0.08, 0.02)])[4].prometheus, 'robust increase');
  assert.equal(verdicts([cell('a', 0.1, 0.01), cell('b', -0.08, 0.02)])[4].prometheus, 'policy-dependent');
  assert.match(verdicts([cell('a', -0.1, 0.01)])[4].prometheus, /^decrease \(one policy set/);
  assert.equal(verdicts([cell('a', 0.1, 0.4), cell('b', 0.08, 0.3)])[4].prometheus, 'no clear effect');
});

test('uptake is reported per game and aggregated', () => {
  const results = Array.from({ length: 6 }, (_, i) => runGame({ seed: `up-${i}`, config: { playerCount: 4 }, includeCommands: false, maxRounds: 30 }).summary);
  const u = results[0].uptake;
  assert.ok(u.idle && Object.keys(u.idle).length === 4);
  const agg = aggregate(results, resolveConfig({ playerCount: 4 }));
  assert.ok(agg.uptake.research.galvanism);
  assert.ok(Array.isArray(agg.uptake.rarelyUsed));
  for (const x of Object.values(agg.uptake.idle)) assert.ok(x.idleIgorShare >= 0 && x.idleIgorShare <= 1);
});

test('heuristic: per-objective weights apply by default; explanations list every option', () => {
  for (const [o, w] of Object.entries(OBJECTIVE_WEIGHTS)) for (const k of Object.keys(w)) assert.ok(k in DEFAULT_WEIGHTS, `${o}.${k}`);
  const play = (opts) => runGame({ seed: 'w-1', config: { playerCount: 4 }, policies: (pid) => heuristicPolicy(`w:${pid}`, opts), includeCommands: false, maxRounds: 8 }).summary;
  // Passing a role's own defaults explicitly changes nothing; passing the
  // global defaults to every seat changes the Prometheus seats' play.
  const own = (pid, objective) => heuristicPolicy(`w:${pid}`, { weights: { ...DEFAULT_WEIGHTS, ...(OBJECTIVE_WEIGHTS[objective] || {}) } });
  const explicit = runGame({ seed: 'w-1', config: { playerCount: 4 }, policies: (pid, i, objective) => own(pid, objective), includeCommands: false, maxRounds: 8 }).summary;
  assert.equal(play({}).commandCount, explicit.commandCount);
  assert.deepEqual(play({}).winners, explicit.winners);
  const { state } = runGame({ seed: 'w-2', config: { playerCount: 4 }, includeCommands: false, maxCommands: 10 });
  const pid = state.activePlayerId;
  let seen = null;
  const cmd = heuristicPolicy('x', { explain: (e) => { seen = e; } }).decide({ playerId: pid, view: getPlayerView(state, pid, { includeEvents: false }), legal: enumerateLegalCommands(state, pid) });
  assert.equal(seen.options.length, enumerateLegalCommands(state, pid).length);
  assert.ok(seen.options.some((o) => JSON.stringify(o.command) === JSON.stringify(cmd)));
});

test('renaming research keeps every effect and retires the old names', () => {
  const cfg = resolveConfig(renameResearch('x_'));
  assert.equal(cfg.research.galvanism.copies, 0);
  assert.deepEqual(cfg.research.x_galvanism.effects, cfg.research.galvanism.effects);
});

test('the LLM playtester describes the view and every legal move', () => {
  const { state } = runGame({ seed: 'llm-v', config: { playerCount: 4 }, includeCommands: false, maxCommands: 40 });
  const pid = state.activePlayerId;
  const view = getPlayerView(state, pid, { includeEvents: false });
  assert.match(summarizeView(view), /your secret objective is/);
  for (const c of enumerateLegalCommands(state, pid)) assert.ok(describeMove(view, c).length > 3);
});

test('effect values: Discreet Methods is valued from the configured discovery rolls', () => {
  const at = (overrides) => researchWorth(resolveConfig({ playerCount: 4, ...overrides }), 'discretion', 'prometheus').want;
  const base = at({});
  assert.ok(base > 0);
  // A bigger roll bonus avoids more suspicion, so it is worth more.
  assert.ok(at({ research: { discretion: { effects: [{ kind: 'discoveryRollBonus', amount: 2 }] } } }) > base);
  // With no discovery rolls that can be noticed, it is worth nothing.
  const quiet = { die: 6, bands: [{ max: 6, amount: 0 }] };
  assert.equal(at({ actions: { graves: { suspicion: quiet }, sell: { suspicion: quiet }, experiment: { suspicion: quiet } } }), 0);
  // The Inquisitor wants suspicion: to it the card is worth less than nothing.
  assert.ok(researchWorth(resolveConfig({ playerCount: 4 }), 'discretion', 'inquisitor').want < 0);
  // The shared estimate: graves (1-4 of 6) with +1 is noticed on 1-3.
  const cfg = resolveConfig({ playerCount: 4 });
  assert.equal(expectedDiscovery(cfg.actions.graves, { rollBonus: 1 }), 0.5);
  assert.equal(expectedDiscovery(cfg.actions.graves, { rollBonus: 4 }), 0);
});
