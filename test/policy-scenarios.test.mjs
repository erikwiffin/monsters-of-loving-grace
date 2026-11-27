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

const GOOD_BODY = { arm1: 'labourer_arm', arm2: 'labourer_arm', leg1: 'athlete_leg', leg2: 'athlete_leg', chest: 'robust_chest', head: 'scholar_brain' };
const POOR_BODY = { arm1: 'damaged_arm', arm2: 'damaged_arm', leg1: 'frail_leg', leg2: 'frail_leg', chest: 'scarred_chest', head: 'criminal_brain' };

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
function scenario({ players = 4, seed = 'scenario', phase = 'day', config = {}, objective = 'prometheus', money, body, loose = [], research = [], suspicion, edit } = {}) {
  let s = createGame({ playerCount: players, ...config }, seed);
  if (phase === 'night') while (s.phase !== 'night') s = pass(s);
  const pid = s.activePlayerId;
  const p = s.players.find((x) => x.id === pid);
  s.objectives[pid] = objective;
  if (money !== undefined) p.money = money;
  if (body) for (const [slot, v] of Object.entries(body)) p.body[slot] = part(s, v);
  for (const v of loose) p.loose.push(part(s, v));
  for (const t of research) p.research.push(t);
  p.research.sort();
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
    const { s, pid } = scenario({ phase: 'night', config: { resurrection: { thresholds: { humanity: 4 } } }, body: GOOD_BODY });
    const { cmds } = playPhase(s, pid, policy);
    assert.equal(placed(cmds, 'prepare').length, 1, JSON.stringify(cmds));
  });

  test(`${policy}: a Prometheus with a hopeless body does not attempt it`, () => {
    const { s, pid } = scenario({ phase: 'night', body: POOR_BODY });
    const { cmds } = playPhase(s, pid, policy);
    assert.equal(placed(cmds, 'prepare').length, 0, JSON.stringify(cmds));
  });

  test(`${policy}: a Prometheus discards a harmful installed head when a better one is loose`, () => {
    const { s, pid, p } = scenario({ phase: 'night', body: { ...GOOD_BODY, head: 'criminal_brain' }, loose: ['scholar_brain'] });
    const bad = p.body.head.id;
    const { cmds } = playPhase(s, pid, policy);
    assert.ok(placed(cmds, 'experiment').some((c) => c.choices.partIds.includes(bad)), JSON.stringify(cmds));
  });

  test(`${policy}: with the mob one step away, a Prometheus takes no risky night action`, () => {
    const { s, pid } = scenario({ phase: 'night', suspicion: 9, loose: ['ordinary_arm', 'ordinary_leg', 'ordinary_arm'] });
    const { cmds } = playPhase(s, pid, policy);
    for (const id of ['graves', 'sell', 'experiment']) assert.equal(placed(cmds, id).length, 0, `${id}: ${JSON.stringify(cmds)}`);
  });

  test(`${policy}: with the mob close and money in hand, a Prometheus pays for charity`, () => {
    const { s, pid } = scenario({ phase: 'day', suspicion: 8, money: 6 });
    const { cmds } = playPhase(s, pid, policy);
    assert.equal(placed(cmds, 'charity').length, 1, JSON.stringify(cmds));
  });

  test(`${policy}: a Prometheus that lacks only a head buys one`, () => {
    const { s, pid } = scenario({ phase: 'day', money: 6, loose: ['ordinary_arm', 'ordinary_arm', 'ordinary_leg', 'ordinary_leg', 'ordinary_chest'] });
    const { cmds } = playPhase(s, pid, policy);
    assert.ok(placed(cmds, 'specimens').some((c) => c.choices.partTypes.includes('head')), JSON.stringify(cmds));
  });

  test(`${policy}: a Prometheus with far more money than it can spend stops practising medicine`, () => {
    const { s, pid } = scenario({ phase: 'day', money: 24, body: GOOD_BODY, edit: (st, me) => { me.research.push(...Object.keys(st.config.research)); } });
    const { cmds } = playPhase(s, pid, policy);
    assert.equal(placed(cmds, 'medicine').length, 0, JSON.stringify(cmds));
  });
}

/** Gives the subject Discreet Methods, and `published` rivals a published copy each. */
const discretion = (published) => (st, me) => {
  me.research.push('discretion');
  for (const o of st.players.filter((x) => x.id !== me.id).slice(0, published)) {
    o.research.push('discretion');
    o.published.push('discretion');
    st.publications.push({ playerId: o.id, type: 'discretion', round: 1 });
  }
};

for (const policy of BUILDERS) {
  // Four effective copies: a graves roll is 5 to 10, never noticed.
  test(`${policy}: with Discreet Methods making graves unnoticeable, a Prometheus robs graves even with the mob one step away`, () => {
    const { s, pid } = scenario({ phase: 'night', suspicion: 9, edit: discretion(3) });
    const { cmds } = playPhase(s, pid, policy);
    assert.ok(placed(cmds, 'graves').length >= 1, JSON.stringify(cmds));
  });

  // One copy: graves is noticed on 1 to 3, still a risk of the mob.
  test(`${policy}: with one copy of Discreet Methods, graves is still too risky one step from the mob`, () => {
    const { s, pid } = scenario({ phase: 'night', suspicion: 9, edit: discretion(0) });
    const { cmds } = playPhase(s, pid, policy);
    assert.equal(placed(cmds, 'graves').length, 0, JSON.stringify(cmds));
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
    runGame({ seed, config: { playerCount: players }, policies, includeCommands: false });
    if (found) return found;
  }
  throw new Error(`no ${objective} control decision found`);
}

/** Replays a game up to a decision point and asks a policy for its choice there. */
function decideAt({ seed, pid, commands }, policySpec, players = 5) {
  const { state } = runGame({ seed, config: { playerCount: players }, policies: 'heuristic', includeCommands: true, maxCommands: commands });
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

test('heuristic: an Inquisitor near the mob robs graves at night', () => {
  const { s, pid } = scenario({ phase: 'night', objective: 'inquisitor', suspicion: 8 });
  const { cmds } = playPhase(s, pid, 'heuristic');
  assert.ok(placed(cmds, 'graves').length >= 1, JSON.stringify(cmds));
});
