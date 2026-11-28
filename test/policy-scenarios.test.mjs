// Scenario tests for AI decisions. Each builds a situation, lets one policy
// play a phase while every other seat passes, and checks what it did. They
// state how the bots are meant to behave, so a change to a policy or to the
// rules that breaks that behaviour shows up here, not as a puzzling shift in
// balance numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, dispatch, getPlayerView, enumerateLegalCommands } from '../src/engine/index.js';
import { makePolicy } from '../src/sim/registry.js';
import { runGame } from '../src/sim/runner.js';

// Rules to test under: the defaults, or a candidate change given as JSON
// overrides in MOLG_SCENARIO_CONFIG (bin/quick-check.mjs sets it). Each
// scenario's own settings go on top.
const BASE = process.env.MOLG_SCENARIO_CONFIG ? JSON.parse(process.env.MOLG_SCENARIO_CONFIG) : {};
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const merge = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) out[k] = isObj(v) && isObj(a[k]) ? merge(a[k], v) : v;
  return out;
};

// A strong full set (Vitality 16) with a humane brain, and a weak one (Vitality −7).
const GOOD_HAND = ['labourer_arm', 'labourer_arm', 'athlete_leg', 'athlete_leg', 'robust_chest', 'scholar_brain'];
const POOR_HAND = ['labourer_arm', 'strangler_arm', 'athlete_leg', 'highwayman_leg', 'prizefighter_chest', 'criminal_brain']; // Vitality 16, Humanity hopeless

function part(s, variantId) {
  s.counters.part += 1;
  return { id: `part-${s.counters.part}`, variantId, type: s.config.partVariants[variantId].type };
}

function pass(s) {
  const r = dispatch(s, { type: 'PASS_TURN', playerId: s.activePlayerId });
  assert.equal(r.ok, true);
  return r.state;
}

/**
 * A game at the start of the given phase, with the active player (the
 * subject) set up as described. Rivals keep their starting position.
 */
function scenario({ players = 4, seed = 'scenario', phase = 'day', config = {}, objective = 'prometheus', money, hand = [], science = [], suspicion, edit } = {}) {
  let s = createGame(merge(BASE, { playerCount: players, ...config }), seed);
  if (phase === 'night') while (s.phase !== 'night') s = pass(s);
  const pid = s.activePlayerId;
  const p = s.players.find((x) => x.id === pid);
  s.objectives[pid] = objective;
  if (money !== undefined) p.money = money;
  for (const v of hand) p.hand.push(part(s, v));
  science.forEach((t, i) => p.science.push({ id: `card-s${i}`, type: t }));
  if (suspicion !== undefined) s.suspicion = suspicion;
  if (edit) edit(s, p);
  return { s, pid, p };
}

/** The subject's commands for the rest of the phase; every other seat passes. */
function playPhase(s, pid, policySpec) {
  const policy = makePolicy(policySpec, `scenario:${pid}`);
  const phase = s.phase;
  const round = s.round;
  const cmds = [];
  let guard = 0;
  while (!s.result && s.phase === phase && s.round === round) {
    assert.ok(++guard < 200, 'phase did not end');
    if (s.activePlayerId !== pid) { s = pass(s); continue; }
    const view = getPlayerView(s, pid, { includeEvents: false });
    const legal = enumerateLegalCommands(s, pid);
    const cmd = policy.decide({ playerId: pid, view, legal });
    const r = dispatch(s, cmd);
    assert.equal(r.ok, true, `${policySpec} sent an invalid command: ${JSON.stringify(cmd)} (${r.error && r.error.message})`);
    cmds.push(cmd);
    s = r.state;
  }
  return { cmds, s };
}

const placed = (cmds, actionId) => cmds.filter((c) => c.type === 'PLACE_MEEPLE' && c.actionId === actionId);

// Builders (Prometheus) are played by both architectures.
const BUILDERS = ['heuristic', 'bt'];

for (const policy of BUILDERS) {
  test(`${policy}: a Prometheus with a body likely to stabilize prepares a resurrection`, () => {
    // Humanity made easy, so the body is a strong attempt by any measure.
    const { s, pid } = scenario({ phase: 'night', config: { resurrection: { thresholds: { humanity: 8 } } }, hand: GOOD_HAND });
    const { cmds } = playPhase(s, pid, policy);
    assert.equal(placed(cmds, 'prepare').length, 1, JSON.stringify(cmds));
  });

  test(`${policy}: a Prometheus with a hopeless body does not attempt it`, () => {
    const { s, pid } = scenario({ phase: 'night', hand: POOR_HAND });
    const { cmds } = playPhase(s, pid, policy);
    assert.equal(placed(cmds, 'prepare').length, 0, JSON.stringify(cmds));
  });

  test(`${policy}: a Prometheus prepares its most humane body, leaving a harmful head in hand`, () => {
    const { s, pid, p } = scenario({ phase: 'night', config: { resurrection: { thresholds: { humanity: 8 } } }, hand: [...GOOD_HAND, 'criminal_brain'] });
    const bad = p.hand[6].id;
    const { cmds } = playPhase(s, pid, policy);
    const prep = placed(cmds, 'prepare');
    assert.equal(prep.length, 1, JSON.stringify(cmds));
    assert.ok(!prep[0].choices.partIds.includes(bad), JSON.stringify(prep[0]));
  });

  test(`${policy}: with the mob one step away, a Prometheus takes no risky night action`, () => {
    const { s, pid } = scenario({ phase: 'night', suspicion: 9, hand: ['ordinary_arm', 'ordinary_leg', 'ordinary_arm'] });
    const { cmds } = playPhase(s, pid, policy);
    for (const id of ['graves', 'sell', 'experiment']) assert.equal(placed(cmds, id).length, 0, `${id}: ${JSON.stringify(cmds)}`);
  });

  test(`${policy}: with the mob close, a Prometheus attends vespers at night`, () => {
    const { s, pid } = scenario({ phase: 'night', suspicion: 8 });
    const { cmds } = playPhase(s, pid, policy);
    assert.ok(placed(cmds, 'vespers').length >= 1, JSON.stringify(cmds));
  });

  test(`${policy}: with the mob close and money in hand, a Prometheus pays for charity`, () => {
    const { s, pid } = scenario({ phase: 'day', suspicion: 8, money: 6 });
    const { cmds } = playPhase(s, pid, policy);
    assert.equal(placed(cmds, 'charity').length, 1, JSON.stringify(cmds));
  });

  test(`${policy}: a Prometheus that lacks only a head buys specimens when the market has nothing`, () => {
    // Three random draws find a head less than half the time, so a good
    // science card may rightly come first; with the market empty, specimens.
    const { s, pid } = scenario({ phase: 'day', money: 8, config: { maxIgors: 1 }, hand: ['labourer_arm', 'labourer_arm', 'athlete_leg', 'athlete_leg', 'robust_chest'], edit: (st) => { st.market = []; } });
    const { cmds } = playPhase(s, pid, policy);
    assert.ok(placed(cmds, 'specimens').length >= 1, JSON.stringify(cmds));
  });

  test(`${policy}: a Prometheus with far more money than it can spend stops practising medicine`, () => {
    const { s, pid } = scenario({ phase: 'day', money: 24, hand: GOOD_HAND, edit: (st) => { st.market = []; } });
    const { cmds } = playPhase(s, pid, policy);
    assert.equal(placed(cmds, 'medicine').length, 0, JSON.stringify(cmds));
  });
}

/** The first state of a simulated game where a player of `objective` decides on a monster. */
function controlDecision({ objective, own, players = 5, tries = 300 }) {
  for (let i = 0; i < tries; i++) {
    let found = null;
    const seed = `control-${i}`;
    // The same heuristic seeds the runner would use, so decideAt can replay it.
    const policies = (pid) => {
      const h = makePolicy('heuristic', `${seed}:${pid}:heuristic`);
      return {
        decide(input) {
          const k = input.view.control;
          if (!found && k && input.view.private.objective === objective && (k.creatorId === pid) === own) found = { seed, pid, commands: input.view.commandCount };
          return h.decide(input);
        },
      };
    };
    runGame({ seed, config: merge(BASE, { playerCount: players }), policies, includeCommands: false });
    if (found) return found;
  }
  throw new Error(`no ${objective} control decision found`);
}

/** Replays a game up to a decision point and asks a policy for its choice there. */
function decideAt({ seed, pid, commands }, policySpec, players = 5) {
  const { state } = runGame({ seed, config: merge(BASE, { playerCount: players }), policies: 'heuristic', includeCommands: true, maxCommands: commands });
  assert.equal(state.activePlayerId, pid);
  const policy = makePolicy(policySpec, `decide:${pid}`);
  return policy.decide({ playerId: pid, view: getPlayerView(state, pid, { includeEvents: false }), legal: enumerateLegalCommands(state, pid) });
}

for (const policy of BUILDERS) {
  test(`${policy}: a Prometheus always tries to subdue its own monster`, () => {
    const at = controlDecision({ objective: 'prometheus', own: true });
    assert.equal(decideAt(at, policy).subdue, true);
  });
}

test('heuristic: an Unleasher never subdues a monster', () => {
  const at = controlDecision({ objective: 'unleasher', own: false });
  assert.equal(decideAt(at, 'heuristic').subdue, false);
});

test('heuristic: an Inquisitor near the mob robs graves at night and never attends vespers', () => {
  const { s, pid } = scenario({ phase: 'night', objective: 'inquisitor', suspicion: 8 });
  const { cmds } = playPhase(s, pid, 'heuristic');
  assert.ok(placed(cmds, 'graves').length >= 1, JSON.stringify(cmds));
  assert.equal(placed(cmds, 'vespers').length, 0, JSON.stringify(cmds));
});
