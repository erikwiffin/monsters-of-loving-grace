import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  createGame, dispatch, getLegalCommands, enumerateLegalCommands, getPlayerView, getPublicView,
  serialize, deserialize, replay, getReplayRecord, researchCount, estimateResurrection,
} from '../src/engine/index.js';
import { runGame, runBatch } from '../src/sim/runner.js';

const ok = (state, cmd) => {
  const r = dispatch(state, cmd);
  assert.equal(r.ok, true, r.error && `${r.error.code}: ${r.error.message}`);
  return r.state;
};
const sci = (pid) => `scientist-${pid}`;
const passAllUntil = (s, pred) => {
  let guard = 0;
  while (!pred(s)) {
    assert.ok(++guard < 500, 'passAllUntil guard');
    if (s.phase === 'commitment') s = ok(s, { type: 'COMMIT_RESURRECTION', playerId: s.activePlayerId, attempt: false });
    else s = ok(s, { type: 'PASS_TURN', playerId: s.activePlayerId });
  }
  return s;
};
function fullBody(s, pid, variants = {}) {
  const p = s.players.find((x) => x.id === pid);
  const pick = { arm1: 'ordinary_arm', arm2: 'ordinary_arm', leg1: 'ordinary_leg', leg2: 'ordinary_leg', chest: 'ordinary_chest', head: 'ordinary_head', ...variants };
  for (const [slot, variantId] of Object.entries(pick)) {
    s.counters.part += 1;
    p.body[slot] = { id: `part-${s.counters.part}`, variantId, type: s.config.partVariants[variantId].type };
  }
}

test('createGame is deterministic for a seed and differs across seeds', () => {
  assert.equal(serialize(createGame({}, 'alpha')), serialize(createGame({}, 'alpha')));
  assert.notEqual(serialize(createGame({}, 'alpha')), serialize(createGame({}, 'beta')));
  assert.throws(() => createGame({}));
});

test('setup follows section 3', () => {
  for (const n of [3, 4, 5]) {
    const s = createGame({ playerCount: n }, `setup-${n}`);
    assert.equal(s.players.length, n);
    const all = [...Object.values(s.objectives), ...s.unseenObjectives].sort();
    const expected = [...Array(n - 2).fill('prometheus'), 'visionary', 'inquisitor', 'unleasher'].sort();
    assert.deepEqual(all, expected);
    assert.equal(s.unseenObjectives.length, 1);
    for (const p of s.players) {
      assert.equal(p.money, 3);
      assert.equal(p.loose.length, 0);
      assert.deepEqual(p.research, []);
    }
    assert.equal(s.market.length, 4);
    assert.equal(s.deck.length, 20);
    assert.equal(s.suspicion, 0);
    assert.equal(s.phase, 'day');
    assert.equal(s.activePlayerId, s.players[s.firstPlayerIndex].id);
  }
  assert.throws(() => createGame({ playerCount: 2 }, 'x'));
  assert.throws(() => createGame({ playerCount: 6 }, 'x'));
});

test('rejected commands leave state, RNG and history unchanged', () => {
  const s = createGame({}, 'reject');
  const before = serialize(s);
  const pid = s.activePlayerId;
  const other = s.players.find((p) => p.id !== pid).id;
  const bad = [
    { type: 'NOPE', playerId: pid },
    { type: 'PASS_TURN', playerId: pid, extra: 1 },
    { type: 'PASS_TURN', playerId: other },
    { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'graves' },
    { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'research', choices: {} },
    { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'medicine', choices: { foo: 1 } },
    { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'hire' },
    { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'charity' },
    { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(other), actionId: 'medicine' },
    { type: 'COMMIT_RESURRECTION', playerId: pid, attempt: true },
    { type: 'PASS_TURN', playerId: pid, seq: 99 },
    null,
  ];
  for (const cmd of bad) {
    const r = dispatch(s, cmd);
    assert.equal(r.ok, false, JSON.stringify(cmd));
    assert.ok(r.error.code);
    assert.equal(r.state, s);
    assert.equal(r.events.length, 0);
  }
  assert.equal(serialize(s), before);
});

test('medicine income, Igor income and stacking research bonus', () => {
  let s = createGame({}, 'medicine');
  const pid = s.activePlayerId;
  const p = () => s.players.find((x) => x.id === pid);
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'medicine' });
  assert.equal(p().money, 6);

  s = createGame({}, 'medicine2');
  const a = s.activePlayerId;
  const others = s.players.filter((x) => x.id !== a);
  s.players.find((x) => x.id === a).research = ['medicine'];
  s.publications.push({ playerId: others[0].id, type: 'medicine', round: 1 });
  s.publications.push({ playerId: a, type: 'medicine', round: 1 }); // own publication doesn't double-count
  assert.equal(researchCount(s, a, 'medicine'), 2);
  assert.equal(researchCount(s, others[1].id, 'medicine'), 2);
  assert.equal(researchCount(s, others[0].id, 'medicine'), 1);
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: a, workerId: sci(a), actionId: 'medicine' });
  assert.equal(s.players.find((x) => x.id === a).money, 3 + 3 + 2);
});

test('shared capacity is enforced per phase', () => {
  let s = createGame({}, 'capacity');
  const order = s.players.map((p) => p.id);
  const first = s.activePlayerId;
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: first, workerId: sci(first), actionId: 'medicine' });
  const second = s.activePlayerId;
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: second, workerId: sci(second), actionId: 'medicine' });
  const third = s.activePlayerId;
  const r = dispatch(s, { type: 'PLACE_MEEPLE', playerId: third, workerId: sci(third), actionId: 'medicine' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'SPACE_FULL');
  assert.ok(!getLegalCommands(s, third).some((c) => c.actionId === 'medicine'));
  assert.equal(order.length, 5);
});

test('hired Igors activate next round; Igor unused by day may act at night', () => {
  let s = createGame({ playerCount: 3, startingMoney: 20 }, 'igor');
  const pid = s.activePlayerId;
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'hire' });
  assert.equal(s.players.find((p) => p.id === pid).money, 16);
  assert.equal(s.workers[`igor-${pid}-1`].active, false);
  s = passAllUntil(s, (x) => x.round === 2);
  assert.equal(s.workers[`igor-${pid}-1`].active, true);
  // Pass day with the Igor unused, then use it at night.
  s = passAllUntil(s, (x) => x.phase === 'day' && x.activePlayerId === pid);
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'medicine' });
  s = passAllUntil(s, (x) => x.activePlayerId === pid);
  s = ok(s, { type: 'PASS_TURN', playerId: pid });
  s = passAllUntil(s, (x) => x.phase === 'night' && x.activePlayerId === pid);
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: `igor-${pid}-1`, actionId: 'graves' });
  s = passAllUntil(s, (x) => x.phase === 'night' && x.activePlayerId === pid);
  const legal = getLegalCommands(s, pid);
  assert.ok(!legal.some((c) => c.workerId === `igor-${pid}-1`), 'Igor acts only once per round');
  assert.ok(legal.some((c) => c.workerId === sci(pid)), 'Scientist refreshes for night');
  // Igors may not research.
  const r = dispatch(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: `igor-${pid}-1`, actionId: 'experiment', choices: { partIds: [], researchCardId: 'x' } });
  assert.equal(r.ok, false);
});

test('graves suspicion follows the d6 table and discretion reduces it', () => {
  for (let i = 0; i < 30; i++) {
    let s = createGame({ playerCount: 3 }, `graves-${i}`);
    s = passAllUntil(s, (x) => x.phase === 'night');
    const pid = s.activePlayerId;
    const r = dispatch(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'graves' });
    const roll = r.events.find((e) => e.type === 'DIE_ROLLED').result;
    assert.equal(r.state.suspicion, roll <= 3 ? 1 : 0);
    assert.equal(r.state.players.find((p) => p.id === pid).loose.length, 2);

    s.players.find((p) => p.id === pid).research = ['discretion'];
    const r2 = dispatch(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'graves' });
    assert.equal(r2.state.suspicion, 0);
  }
});

test('specimens, assemble limits and Advanced Anatomy', () => {
  let s = createGame({ playerCount: 3, startingMoney: 10 }, 'assemble');
  const pid = s.activePlayerId;
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'specimens', choices: { variantIds: ['athlete_leg', 'athlete_leg'] } });
  const p = () => s.players.find((x) => x.id === pid);
  assert.deepEqual(p().loose.map((x) => x.variantId), ['athlete_leg', 'athlete_leg']);
  p().loose.push({ id: 'part-x', variantId: 'poet_brain', type: 'head' }, { id: 'part-y', variantId: 'poet_brain', type: 'head' });
  s = passAllUntil(s, (x) => x.phase === 'night' && x.activePlayerId === pid);
  const ids = p().loose.map((x) => x.id);
  assert.equal(dispatch(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'assemble', choices: { partIds: ids.slice(0, 3) } }).error.code, 'INVALID_CHOICE');
  assert.equal(dispatch(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'assemble', choices: { partIds: ['part-x', 'part-y'] } }).error.code, 'NO_MATCHING_SLOT');
  p().research = ['anatomy'];
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'assemble', choices: { partIds: [ids[0], ids[1], 'part-x'] } });
  assert.equal(p().body.leg1.variantId, 'athlete_leg');
  assert.equal(p().body.leg2.variantId, 'athlete_leg');
  assert.equal(p().body.head.id, 'part-x');
  assert.equal(p().loose.length, 1);
});

test('lecture pays 1 + own published types (cap 4); publish may repeat another player\'s type', () => {
  let s = createGame({ playerCount: 3 }, 'lecture');
  const pid = s.activePlayerId;
  const other = s.players.find((p) => p.id !== pid).id;
  const p = s.players.find((x) => x.id === pid);
  p.research = ['anatomy', 'galvanism', 'medicine', 'neurology'];
  p.published = ['anatomy', 'galvanism'];
  s.publications.push({ playerId: pid, type: 'anatomy', round: 1 }, { playerId: pid, type: 'galvanism', round: 1 });
  s.publications.push({ playerId: other, type: 'medicine', round: 1 });
  const r = dispatch(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'lecture' });
  assert.equal(r.state.players.find((x) => x.id === pid).money, 3 + 3);
  p.published.push('neurology');
  p.published.push('medicine');
  const r2 = dispatch(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'lecture' });
  assert.equal(r2.state.players.find((x) => x.id === pid).money, 3 + 4);
  p.published = ['anatomy', 'galvanism'];
  const r3 = dispatch(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'publish', choices: { researchType: 'medicine' } });
  assert.equal(r3.ok, true);
  assert.equal(r3.state.publications.filter((x) => x.type === 'medicine').length, 2);
  assert.equal(dispatch(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'publish', choices: { researchType: 'anatomy' } }).error.code, 'ALREADY_PUBLISHED');
});

test('research and experiment acquire market cards and refill', () => {
  let s = createGame({ playerCount: 3, startingMoney: 10 }, 'research');
  const pid = s.activePlayerId;
  const card = s.market[0];
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'research', choices: { researchCardId: card.id } });
  const p = s.players.find((x) => x.id === pid);
  assert.deepEqual(p.research, [card.type]);
  assert.equal(p.money, 8);
  assert.equal(s.market.length, 4);
  assert.equal(s.deck.length, 19);
  const dupe = s.market.find((c) => c.type === card.type);
  if (dupe) {
    assert.equal(dispatch(s, { type: 'PLACE_MEEPLE', playerId: s.activePlayerId, workerId: sci(s.activePlayerId), actionId: 'research', choices: { researchCardId: 'card-999' } }).ok, false);
  }
});

function resurrectionGame(config, setup) {
  let s = createGame({ playerCount: 3, ...config }, 'res');
  s = passAllUntil(s, (x) => x.phase === 'night');
  setup(s);
  // pass night, which reaches commitment for players with bodies
  while (s.phase === 'night') s = ok(s, { type: 'PASS_TURN', playerId: s.activePlayerId });
  return s;
}

test('unleashed Creature ends the game immediately; Unleasher wins', () => {
  let s = resurrectionGame({ resurrection: { thresholds: { vitality: -100, control: 100, humanity: 100 } } }, (st) => {
    st.objectives = { p1: 'unleasher', p2: 'prometheus', p3: 'visionary' };
    for (const p of st.players) fullBody(st, p.id);
  });
  assert.equal(s.phase, 'commitment');
  const first = s.activePlayerId;
  for (let i = 0; i < 3; i++) s = ok(s, { type: 'COMMIT_RESURRECTION', playerId: s.activePlayerId, attempt: true });
  assert.equal(s.result.reason, 'unleashed');
  assert.deepEqual(s.result.winners, ['p1']);
  // Only the first attempt in initiative order resolved; later commitments consumed nothing.
  assert.equal(s.resurrections.length, 1);
  assert.equal(s.resurrections[0].playerId, first);
  for (const p of s.players) if (p.id !== first) assert.ok(p.body.head !== null);
  assert.equal(dispatch(s, { type: 'PASS_TURN', playerId: 'p1' }).error.code, 'GAME_OVER');
});

test('collective defeat if the matching antagonist was not dealt', () => {
  let s = resurrectionGame({ resurrection: { thresholds: { vitality: -100, control: 100, humanity: 100 } } }, (st) => {
    st.objectives = { p1: 'prometheus', p2: 'inquisitor', p3: 'visionary' };
    st.unseenObjectives = ['unleasher'];
    fullBody(st, 'p1');
  });
  s = ok(s, { type: 'COMMIT_RESURRECTION', playerId: 'p1', attempt: true });
  assert.equal(s.result.reason, 'unleashed');
  assert.deepEqual(s.result.winners, []);
  assert.equal(s.result.collectiveDefeat, true);
});

test('failed Vitality refunds 3 parts and adds suspicion', () => {
  let s = resurrectionGame({ resurrection: { thresholds: { vitality: 100, control: 0, humanity: 0 } } }, (st) => fullBody(st, 'p2'));
  s = ok(s, { type: 'COMMIT_RESURRECTION', playerId: 'p2', attempt: true });
  const p = s.players.find((x) => x.id === 'p2');
  assert.equal(p.loose.length, 3);
  assert.equal(p.body.head, null);
  assert.equal(s.suspicion, 1);
  assert.equal(s.resurrections[0].outcome, 'failed');
  assert.equal(s.round, 2);
});

test('declined commitments consume nothing; commitments are hidden until reveal', () => {
  let s = resurrectionGame({}, (st) => { fullBody(st, 'p1'); fullBody(st, 'p2'); });
  const firstDecider = s.activePlayerId;
  const r = dispatch(s, { type: 'COMMIT_RESURRECTION', playerId: firstDecider, attempt: true });
  const other = firstDecider === 'p1' ? 'p2' : 'p1';
  const otherView = getPlayerView(r.state, other);
  assert.equal(otherView.private.commitment, null);
  assert.ok(!JSON.stringify({ ...otherView, legalCommands: [] }).includes('"attempt":true'));
  assert.equal(getPlayerView(r.state, firstDecider).private.commitment, true);
  const s2 = ok(r.state, { type: 'COMMIT_RESURRECTION', playerId: other, attempt: false });
  assert.ok(s2.players.find((p) => p.id === other).body.head !== null);
});

test('Prometheus wins at dawn with the only stable Creature', () => {
  let s = resurrectionGame({ resurrection: { thresholds: { vitality: -100, control: -100, humanity: 100 } } }, (st) => {
    st.objectives = { p1: 'prometheus', p2: 'inquisitor', p3: 'visionary' };
    fullBody(st, 'p1');
  });
  s = ok(s, { type: 'COMMIT_RESURRECTION', playerId: 'p1', attempt: true });
  assert.equal(s.result.reason, 'objective');
  assert.deepEqual(s.result.winners, ['p1']);
  assert.ok(!Object.values(s.workers).some((w) => w.kind === 'creature'), 'stable Creatures never become workers');
});

test('a lone stable Creature owned by a non-Prometheus ends the game with everyone losing', () => {
  for (const owner of ['visionary', 'inquisitor', 'unleasher']) {
    let s = resurrectionGame({ resurrection: { thresholds: { vitality: -100, control: -100, humanity: 100 } } }, (st) => {
      const others = ['prometheus', 'inquisitor', 'unleasher', 'visionary'].filter((o) => o !== owner);
      st.objectives = { p1: owner, p2: others[0], p3: others[1] };
      fullBody(st, 'p1');
    });
    s = ok(s, { type: 'COMMIT_RESURRECTION', playerId: 'p1', attempt: true });
    assert.equal(s.result.reason, 'objective', owner);
    assert.deepEqual(s.result.winners, [], owner);
    assert.equal(s.result.collectiveDefeat, true, owner);
  }
});

test('Visionary wins when two Creatures stabilize in one round', () => {
  let s = resurrectionGame({ resurrection: { thresholds: { vitality: -100, control: -100, humanity: -100 } } }, (st) => {
    st.objectives = { p1: 'unleasher', p2: 'inquisitor', p3: 'visionary' };
    fullBody(st, 'p1'); fullBody(st, 'p2');
  });
  s = ok(s, { type: 'COMMIT_RESURRECTION', playerId: s.activePlayerId, attempt: true });
  s = ok(s, { type: 'COMMIT_RESURRECTION', playerId: s.activePlayerId, attempt: true });
  assert.equal(s.result.reason, 'objective');
  assert.deepEqual(s.result.winners, ['p3']);
});

test('mob forms at the threshold; Inquisitor wins', () => {
  let s = createGame({ playerCount: 3, suspicionMax: 1, actions: { graves: { suspicionTable: [1, 1, 1, 1, 1, 1] } } }, 'mob');
  s.objectives = { p1: 'inquisitor', p2: 'prometheus', p3: 'visionary' };
  s = passAllUntil(s, (x) => x.phase === 'night');
  const pid = s.activePlayerId;
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'graves' });
  assert.equal(s.result.reason, 'mob');
  assert.deepEqual(s.result.winners, ['p1']);
  assert.ok(s.events.some((e) => e.type === 'SCIENTISTS_ARRESTED'));
});

test('resurrection rolls are fully itemised and consistent', () => {
  let s = resurrectionGame({}, (st) => {
    fullBody(st, 'p1', { arm1: 'labourer_arm', arm2: 'damaged_arm', leg1: 'frail_leg', chest: 'robust_chest', head: 'criminal_brain' });
    st.players[0].research = ['galvanism', 'philosophy'];
  });
  const r = dispatch(s, { type: 'COMMIT_RESURRECTION', playerId: 'p1', attempt: true });
  const rolled = r.events.find((e) => e.type === 'RESURRECTION_ROLLED');
  const v = rolled.attributes.vitality;
  assert.deepEqual(v.dice.map((d) => d.source.kind === 'base' ? 'base' : d.source.slot || d.source.researchType), ['base', 'arm1', 'arm2', 'chest', 'galvanism']);
  assert.deepEqual(v.fixed.map((f) => f.amount), [-2]);
  assert.equal(v.score, v.dice.reduce((a, d) => a + d.value, 0) - 2);
  const h = rolled.attributes.humanity;
  assert.equal(h.threshold, 24);
  assert.deepEqual(h.fixed.map((f) => f.amount), [5]);
  for (const a of Object.values(rolled.attributes)) assert.equal(a.success, a.score >= a.threshold);
});

test('estimateResurrection matches base odds', () => {
  const s = createGame({ playerCount: 3 }, 'odds');
  fullBody(s, 'p1');
  const o = estimateResurrection(s, 'p1');
  assert.ok(Math.abs(o.attributes.vitality.success - 0.15) < 1e-9);
  assert.equal(o.attributes.control.success, 0, 'a bare d20 cannot reach the Control threshold of 21');
  assert.equal(o.attributes.humanity.success, 0, 'a bare d20 cannot reach the Humanity threshold of 21');
  assert.equal(o.pStable, 0);
  assert.ok(Math.abs(o.pUnleashed - 0.15) < 1e-9);
  assert.ok(Math.abs(o.pFailed + o.pStable + o.pUnleashed - 1) < 1e-9);
  assert.equal(estimateResurrection(s, 'p2'), null);
  // Brain of a scholar (+1d6 Control): d20 + d6 >= 21 has probability 3.5/20.
  fullBody(s, 'p2', { head: 'scholar_brain' });
  assert.ok(Math.abs(estimateResurrection(s, 'p2').attributes.control.success - 0.175) < 1e-9);
});

test('player views hide secrets', () => {
  const s = createGame({}, 'views');
  const pid = s.players[0].id;
  const view = getPlayerView(s, pid);
  const json = JSON.stringify(view);
  assert.equal(view.private.objective, s.objectives[pid]);
  assert.ok(!('objectives' in view));
  assert.ok(!json.includes('"rng"'));
  assert.ok(!json.includes(s.seed));
  assert.ok(!('deck' in view));
  assert.ok(!view.events.some((e) => e.type === 'OBJECTIVE_ASSIGNED' && e.playerId !== pid));
  const pub = getPublicView(s);
  assert.ok(!pub.events.some((e) => e.type === 'OBJECTIVE_ASSIGNED'));
  assert.ok(!('private' in pub));
});

test('serialize/deserialize round-trips; replay reproduces; tampering is detected', () => {
  const { state } = runGame({ seed: 'save', policies: 'heuristic', maxCommands: 120 });
  const json = serialize(state);
  const back = deserialize(json);
  assert.equal(serialize(back), json);
  const rep = replay(getReplayRecord(state));
  assert.equal(serialize(rep), json);
  const tampered = JSON.parse(json);
  tampered.players[0].money += 50;
  assert.throws(() => deserialize(JSON.stringify(tampered)), /replay verification/);
  assert.throws(() => deserialize('{"format":"other"}'));
  assert.throws(() => deserialize('not json'));
  if (!state.result) {
    const legal = enumerateLegalCommands(back, back.activePlayerId);
    assert.ok(dispatch(back, legal[0]).ok);
  }
});

test('stale seq prevents duplicate execution', () => {
  const s = createGame({}, 'seq');
  const cmd = { type: 'PASS_TURN', playerId: s.activePlayerId, seq: 0 };
  const r1 = dispatch(s, cmd);
  assert.ok(r1.ok);
  assert.equal(dispatch(r1.state, cmd).error.code, 'STALE_COMMAND');
});

test('every enumerated legal command is accepted', () => {
  let s = createGame({ startingMoney: 30 }, 'enum');
  for (let i = 0; i < 300 && !s.result; i++) {
    const legal = enumerateLegalCommands(s, s.activePlayerId);
    for (const c of legal.slice(0, 40)) assert.ok(dispatch(s, c).ok, JSON.stringify(c));
    s = dispatch(s, legal[(i * 7) % legal.length]).state;
  }
});

test('batch simulations terminate without invalid commands', () => {
  for (const policies of ['random', 'heuristic', ['heuristic', 'random']]) {
    const { results } = runBatch({ games: 15, policies, includeCommands: false, seedPrefix: `t-${policies}` });
    for (const r of results) {
      assert.equal(r.invalidCommands, 0);
      assert.equal(r.terminal, true);
      assert.ok(['mob', 'unleashed', 'objective'].includes(r.terminalReason));
    }
  }
  const t = runGame({ seed: 'budget', maxCommands: 10 }).summary;
  assert.equal(t.truncated, true);
  assert.equal(t.terminalReason, null);
  assert.equal(t.truncationReason, 'command_budget');
});

test('engine source has no DOM, storage, timers or unseeded randomness', () => {
  const dir = new URL('../src/engine/', import.meta.url);
  for (const f of readdirSync(dir)) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const banned of ['window', 'document', 'localStorage', 'Math.random', 'Date.now', 'setTimeout', 'fetch(']) {
      assert.ok(!src.includes(banned), `${f} uses ${banned}`);
    }
  }
});

test('two Prometheus players stabilizing in one round both lose; game ends without Visionary', () => {
  let s = resurrectionGame({ resurrection: { thresholds: { vitality: -100, control: -100, humanity: 100 } } }, (st) => {
    st.objectives = { p1: 'prometheus', p2: 'prometheus', p3: 'inquisitor' };
    st.unseenObjectives = ['visionary'];
    fullBody(st, 'p1'); fullBody(st, 'p2');
  });
  s = ok(s, { type: 'COMMIT_RESURRECTION', playerId: s.activePlayerId, attempt: true });
  s = ok(s, { type: 'COMMIT_RESURRECTION', playerId: s.activePlayerId, attempt: true });
  assert.equal(s.result.reason, 'objective');
  assert.deepEqual(s.result.winners, []);
  assert.equal(s.result.collectiveDefeat, true);
});

test('Prometheus and another player stabilizing together: only the Visionary wins', () => {
  let s = resurrectionGame({ resurrection: { thresholds: { vitality: -100, control: -100, humanity: 100 } } }, (st) => {
    st.objectives = { p1: 'prometheus', p2: 'inquisitor', p3: 'visionary' };
    fullBody(st, 'p1'); fullBody(st, 'p2');
  });
  s = ok(s, { type: 'COMMIT_RESURRECTION', playerId: s.activePlayerId, attempt: true });
  s = ok(s, { type: 'COMMIT_RESURRECTION', playerId: s.activePlayerId, attempt: true });
  assert.deepEqual(s.result.winners, ['p3']);
});

test('saves made under different default rules still load and keep their rules', () => {
  // Simulate a save from before a balance change by giving it non-default thresholds
  // in its resolved config while its overrides stay empty.
  const legacy = replay({ config: { playerCount: 3, resurrection: { thresholds: { vitality: 18, control: 18, humanity: 18 } } }, seed: 'old-rules', commands: [] });
  legacy.configOverrides = { playerCount: 3 };
  let st = legacy;
  for (let i = 0; i < 30 && !st.result; i++) st = dispatch(st, enumerateLegalCommands(st, st.activePlayerId)[0]).state;
  const back = deserialize(serialize(st));
  assert.equal(back.config.resurrection.thresholds.control, 18);
  assert.equal(serialize(back), serialize(st));
});
