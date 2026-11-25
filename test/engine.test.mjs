import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  createGame, dispatch, getLegalCommands, enumerateLegalCommands, getPlayerView, getPublicView,
  serialize, deserialize, replay, getReplayRecord, researchCount, estimateResurrection, estimateControl, controlAttempts,
} from '../src/engine/index.js';
import { heuristicPolicy } from '../src/sim/policies.js';
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
  for (const n of [3, 4, 5, 6]) {
    const s = createGame({ playerCount: n }, `setup-${n}`);
    assert.equal(s.players.length, n);
    const all = [...Object.values(s.objectives), ...s.unseenObjectives].sort();
    // The Visionary is only dealt from 4 players; Prometheus fills the rest of N+1 cards.
    const expected = (n >= 4
      ? [...Array(n - 2).fill('prometheus'), 'visionary', 'inquisitor', 'unleasher']
      : ['prometheus', 'prometheus', 'inquisitor', 'unleasher']).sort();
    assert.deepEqual(all, expected);
    assert.equal(s.unseenObjectives.length, 1);
    for (const p of s.players) {
      assert.equal(p.money, 3);
      assert.equal(p.loose.length, 0);
      assert.deepEqual(p.research, []);
    }
    assert.equal(s.market.length, 4);
    assert.equal(s.deck.length, 24, '7 research types x 4 copies, minus the market');
    assert.equal(s.suspicion, 0);
    assert.equal(s.phase, 'day');
    assert.equal(s.activePlayerId, s.players[s.firstPlayerIndex].id);
  }
  assert.throws(() => createGame({ playerCount: 2 }, 'x'));
  assert.throws(() => createGame({ playerCount: 7 }, 'x'));
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

test('everyone starts with an Igor; hired Igors act at once; an Igor acts once per round', () => {
  let s = createGame({ playerCount: 3, startingMoney: 20 }, 'igor');
  const pid = s.activePlayerId;
  for (const p of s.players) assert.equal(s.workers[`igor-${p.id}-1`].active, true);
  // Igors earn the full medicine income.
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: `igor-${pid}-1`, actionId: 'medicine' });
  assert.equal(s.players.find((p) => p.id === pid).money, 23);
  s = passAllUntil(s, (x) => x.activePlayerId === pid);
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'hire' });
  assert.equal(s.players.find((p) => p.id === pid).money, 19, 'the first hire costs 4');
  assert.equal(s.workers[`igor-${pid}-2`].active, true, 'a hired Igor is available at once');
  s = passAllUntil(s, (x) => x.activePlayerId === pid);
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: `igor-${pid}-2`, actionId: 'specimens', choices: { variantIds: ['athlete_leg'] } });
  s = passAllUntil(s, (x) => x.phase === 'night' && x.activePlayerId === pid);
  const legal = getLegalCommands(s, pid);
  assert.ok(!legal.some((c) => c.workerId === `igor-${pid}-1` || c.workerId === `igor-${pid}-2`), 'Igors act only once per round');
  assert.ok(legal.some((c) => c.workerId === sci(pid)), 'Scientist refreshes for night');
  const r = dispatch(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: `igor-${pid}-1`, actionId: 'experiment', choices: { partIds: [], researchCardId: 'x' } });
  assert.equal(r.ok, false);
});

test('hire and charity have no capacity limit; lecture holds 2; Cover tracks is gone; three Igors at most', () => {
  const cfg = createGame({}, 'caps').config.actions;
  assert.equal(cfg.hire.capacity, null);
  assert.equal(cfg.charity.capacity, null);
  assert.equal(cfg.lecture.capacity, 2);
  assert.ok(!('conceal' in cfg));
  let s = createGame({ playerCount: 3, startingMoney: 30 }, 'max-igors');
  const pid = s.activePlayerId;
  s.players.find((p) => p.id === pid).igorsHired = 2;
  for (const k of [2, 3]) {
    const id = `igor-${pid}-${k}`;
    s.workers[id] = { id, kind: 'igor', ownerId: pid, active: true, usedThisRound: false };
    s.workerOrder.push(id);
  }
  assert.equal(dispatch(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'hire' }).error.code, 'MAX_IGORS');
});

test('graves suspicion follows the d6 table and discretion reduces it', () => {
  for (let i = 0; i < 30; i++) {
    let s = createGame({ playerCount: 3 }, `graves-${i}`);
    s = passAllUntil(s, (x) => x.phase === 'night');
    const pid = s.activePlayerId;
    const r = dispatch(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'graves' });
    const roll = r.events.find((e) => e.type === 'DIE_ROLLED').result;
    assert.equal(r.state.suspicion, roll <= 4 ? 1 : 0);
    assert.equal(r.state.players.find((p) => p.id === pid).loose.length, 2);

    s.players.find((p) => p.id === pid).research = ['discretion'];
    const r2 = dispatch(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'graves' });
    assert.equal(r2.state.suspicion, 0);
  }
});

test('morgue draws 3 parts, rolls discovery, then the player keeps 1 and discards the rest', () => {
  let s = createGame({ playerCount: 3 }, 'morgue');
  s = passAllUntil(s, (x) => x.phase === 'night');
  const pid = s.activePlayerId;
  const r = dispatch(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'morgue' });
  s = r.state;
  const types = r.events.map((e) => e.type);
  assert.ok(types.indexOf('PARTS_DRAWN') < types.indexOf('DIE_ROLLED'), 'parts are drawn before the die');
  assert.equal(s.activePlayerId, pid);
  const drawn = s.pendingPick.parts;
  assert.equal(drawn.length, 3);
  assert.equal(s.players.find((p) => p.id === pid).loose.length, 0);
  const legal = getLegalCommands(s, pid);
  assert.equal(legal.length, 3);
  assert.ok(legal.every((c) => c.type === 'PICK_PARTS'));
  assert.equal(dispatch(s, { type: 'PASS_TURN', playerId: pid }).error.code, 'PICK_PENDING');
  assert.equal(dispatch(s, { type: 'PICK_PARTS', playerId: pid, partIds: [drawn[0].id, drawn[1].id] }).error.code, 'INVALID_CHOICE');
  s = ok(s, { type: 'PICK_PARTS', playerId: pid, partIds: [drawn[1].id] });
  assert.deepEqual(s.players.find((p) => p.id === pid).loose.map((x) => x.id), [drawn[1].id]);
  assert.equal(s.pendingPick, null);
  assert.notEqual(s.activePlayerId, pid, 'play moves on after the pick');
  assert.equal(s.events.at(-1).type === 'PARTS_PICKED' || s.events.some((e) => e.type === 'PARTS_PICKED'), true);
});

test('specimens buy one part; assemble installs any number of fitting parts, up to a whole body', () => {
  let s = createGame({ playerCount: 3, startingMoney: 10 }, 'assemble');
  const pid = s.activePlayerId;
  assert.ok(!('anatomy' in s.config.research), 'Advanced Anatomy is retired');
  assert.equal(dispatch(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'specimens', choices: { variantIds: ['athlete_leg', 'athlete_leg'] } }).error.code, 'INVALID_CHOICE');
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'specimens', choices: { variantIds: ['athlete_leg'] } });
  const p = () => s.players.find((x) => x.id === pid);
  assert.deepEqual(p().loose.map((x) => x.variantId), ['athlete_leg']);
  assert.equal(p().money, 8);
  const extra = [['ordinary_arm', 'arm'], ['ordinary_arm', 'arm'], ['ordinary_leg', 'leg'], ['ordinary_chest', 'chest'], ['poet_brain', 'head'], ['poet_brain', 'head']];
  extra.forEach(([variantId, type], i) => p().loose.push({ id: `part-x${i}`, variantId, type }));
  s = passAllUntil(s, (x) => x.phase === 'night' && x.activePlayerId === pid);
  assert.equal(dispatch(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'assemble', choices: { partIds: ['part-x4', 'part-x5'] } }).error.code, 'NO_MATCHING_SLOT');
  const all = p().loose.filter((x) => x.id !== 'part-x5').map((x) => x.id);
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'assemble', choices: { partIds: all } });
  assert.equal(p().body.leg1.variantId, 'athlete_leg');
  assert.equal(p().body.head.id, 'part-x4');
  assert.ok(Object.values(p().body).every(Boolean), 'a whole body in one action');
  assert.deepEqual(p().loose.map((x) => x.id), ['part-x5']);
});

test('lecture pays 1 + each own publication, uncapped; publishing is free and keeps the turn', () => {
  let s = createGame({ playerCount: 3 }, 'lecture');
  const pid = s.activePlayerId;
  const other = s.players.find((p) => p.id !== pid).id;
  const p = s.players.find((x) => x.id === pid);
  p.research = ['anatomy', 'discretion', 'galvanism', 'medicine', 'neurology', 'philosophy'];
  p.published = ['anatomy', 'discretion', 'galvanism', 'neurology', 'philosophy'];
  s.publications.push({ playerId: other, type: 'medicine', round: 1 });
  const r = dispatch(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'lecture' });
  assert.equal(r.state.players.find((x) => x.id === pid).money, 3 + 6, 'no cap of 4');
  assert.ok(!('publish' in s.config.actions), 'publishing is not a worker action');
  // Publishing: free, may repeat another player's type, keeps the turn.
  assert.deepEqual(getLegalCommands(s, pid).filter((c) => c.type === 'PUBLISH_RESEARCH').map((c) => c.researchType), ['medicine']);
  const s2 = ok(s, { type: 'PUBLISH_RESEARCH', playerId: pid, researchType: 'medicine' });
  assert.equal(s2.activePlayerId, pid);
  assert.equal(s2.players.find((x) => x.id === pid).money, 3);
  assert.equal(s2.publications.filter((x) => x.type === 'medicine').length, 2);
  assert.equal(dispatch(s2, { type: 'PUBLISH_RESEARCH', playerId: pid, researchType: 'medicine' }).error.code, 'ALREADY_PUBLISHED');
  assert.equal(dispatch(s2, { type: 'PUBLISH_RESEARCH', playerId: other, researchType: 'medicine' }).error.code, 'NOT_YOUR_TURN');
  const r2 = dispatch(s2, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'lecture' });
  assert.equal(r2.state.players.find((x) => x.id === pid).money, 3 + 7);
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
  assert.equal(s.deck.length, 23);
  const dupe = s.market.find((c) => c.type === card.type);
  if (dupe) {
    assert.equal(dispatch(s, { type: 'PLACE_MEEPLE', playerId: s.activePlayerId, workerId: sci(s.activePlayerId), actionId: 'research', choices: { researchCardId: 'card-999' } }).ok, false);
  }
});

function declineChain(s) {
  let guard = 0;
  while (!s.result && s.control) {
    assert.ok(++guard < 20);
    s = ok(s, { type: 'SUBDUE_MONSTER', playerId: s.activePlayerId, subdue: false });
  }
  return s;
}

function resurrectionGame(config, setup) {
  let s = createGame({ playerCount: 3, ...config }, 'res');
  s = passAllUntil(s, (x) => x.phase === 'night');
  setup(s);
  // pass night, which reaches commitment for players with bodies
  while (s.phase === 'night') s = ok(s, { type: 'PASS_TURN', playerId: s.activePlayerId });
  return s;
}

test('unleashed Creature ends the game immediately; Unleasher wins', () => {
  let s = resurrectionGame({ resurrection: { thresholds: { vitality: -100, humanity: 100 } } }, (st) => {
    st.objectives = { p1: 'unleasher', p2: 'prometheus', p3: 'visionary' };
    for (const p of st.players) fullBody(st, p.id);
  });
  assert.equal(s.phase, 'commitment');
  const first = s.activePlayerId;
  for (let i = 0; i < 3; i++) s = ok(s, { type: 'COMMIT_RESURRECTION', playerId: s.activePlayerId, attempt: true });
  assert.equal(s.phase, 'resolution');
  assert.equal(s.activePlayerId, first, 'the creator decides first');
  s = declineChain(s);
  assert.equal(s.result.reason, 'unleashed');
  assert.deepEqual(s.result.winners, ['p1']);
  // Only the first attempt in initiative order resolved; later commitments consumed nothing.
  assert.equal(s.resurrections.length, 1);
  assert.equal(s.resurrections[0].playerId, first);
  for (const p of s.players) if (p.id !== first) assert.ok(p.body.head !== null);
  assert.equal(dispatch(s, { type: 'PASS_TURN', playerId: 'p1' }).error.code, 'GAME_OVER');
});

test('collective defeat if the matching antagonist was not dealt', () => {
  let s = resurrectionGame({ resurrection: { thresholds: { vitality: -100, humanity: 100 } } }, (st) => {
    st.objectives = { p1: 'prometheus', p2: 'inquisitor', p3: 'visionary' };
    st.unseenObjectives = ['unleasher'];
    fullBody(st, 'p1');
  });
  s = ok(s, { type: 'COMMIT_RESURRECTION', playerId: 'p1', attempt: true });
  s = declineChain(s);
  assert.equal(s.result.reason, 'unleashed');
  assert.deepEqual(s.result.winners, []);
  assert.equal(s.result.collectiveDefeat, true);
});

test('failed Vitality refunds 3 parts and adds suspicion', () => {
  let s = resurrectionGame({ resurrection: { thresholds: { vitality: 100, humanity: 0 } } }, (st) => fullBody(st, 'p2'));
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
  let s = resurrectionGame({ resurrection: { thresholds: { vitality: -100, humanity: -100 } } }, (st) => {
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
    let s = resurrectionGame({ resurrection: { thresholds: { vitality: -100, humanity: -100 } } }, (st) => {
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
  let s = resurrectionGame({ resurrection: { thresholds: { vitality: -100, humanity: -100 } } }, (st) => {
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
  assert.equal(h.threshold, 23);
  assert.deepEqual(h.fixed.map((f) => f.amount), [5]);
  for (const a of Object.values(rolled.attributes)) assert.equal(a.success, a.score >= a.threshold);
});

test('estimateResurrection matches base odds', () => {
  const s = createGame({ playerCount: 3 }, 'odds');
  fullBody(s, 'p1');
  const o = estimateResurrection(s, 'p1');
  assert.ok(Math.abs(o.attributes.vitality.success - 0.05) < 1e-9, 'a bare d20 reaches Vitality 20 only on a 20');
  assert.ok(Math.abs(o.attributes.humanity.success - 0.05) < 1e-9, 'a bare d20 reaches Humanity 20 only on a 20');
  assert.ok(!('control' in o.attributes));
  assert.ok(Math.abs(o.pStable - 0.0025) < 1e-9);
  assert.ok(Math.abs(o.pMonster - 0.0475) < 1e-9);
  assert.ok(Math.abs(o.pFailed + o.pStable + o.pMonster - 1) < 1e-9);
  assert.equal(estimateResurrection(s, 'p2'), null);
  // Brain of a scholar (+1d6 Humanity): d20 + d6 >= 20 has probability 27/120.
  fullBody(s, 'p2', { head: 'scholar_brain' });
  assert.ok(Math.abs(estimateResurrection(s, 'p2').attributes.humanity.success - 27 / 120) < 1e-9);
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
  let s = resurrectionGame({ resurrection: { thresholds: { vitality: -100, humanity: -100 } } }, (st) => {
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
  let s = resurrectionGame({ resurrection: { thresholds: { vitality: -100, humanity: -100 } } }, (st) => {
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
  const legacy = replay({ config: { playerCount: 3, resurrection: { thresholds: { vitality: 18, humanity: 18 } } }, seed: 'old-rules', commands: [] });
  legacy.configOverrides = { playerCount: 3 };
  let st = legacy;
  for (let i = 0; i < 30 && !st.result; i++) st = dispatch(st, enumerateLegalCommands(st, st.activePlayerId)[0]).state;
  const back = deserialize(serialize(st));
  assert.equal(back.config.resurrection.thresholds.humanity, 18);
  assert.equal(serialize(back), serialize(st));
});

// ---------------------------------------------------------------------------
// Control attempts and monsters (spec 025)
// ---------------------------------------------------------------------------

// Monsters every time, and control rolls that always succeed (see the control-roll tests).
const MONSTER = { resurrection: { thresholds: { vitality: -100, humanity: 100 } }, control: { threshold: -100 } };
const garrison = (st, ...pids) => { st.occupancy.day.garrison = pids.map(sci); };
const player = (s, pid) => s.players.find((p) => p.id === pid);

test('defaults: thresholds 20, suspicion track 10, three control attempts each', () => {
  const s = createGame({}, 'defaults');
  assert.deepEqual(s.config.resurrection.thresholds, { vitality: 20, humanity: 20 });
  assert.equal(s.config.suspicionMax, 10);
  for (const p of s.players) assert.equal(controlAttempts(s, p.id), 3);
  assert.equal(getPublicView(s).players[0].controlAttempts, 3);
});

test('creator may subdue their own monster: destroyed, 3 parts salvaged, +1 suspicion, game continues', () => {
  let s = resurrectionGame(MONSTER, (st) => fullBody(st, 'p2'));
  s = ok(s, { type: 'COMMIT_RESURRECTION', playerId: 'p2', attempt: true });
  assert.equal(s.phase, 'resolution');
  assert.equal(s.activePlayerId, 'p2');
  assert.deepEqual(getLegalCommands(s, 'p2').map((c) => c.subdue), [true, false]);
  assert.deepEqual(getLegalCommands(s, 'p1'), []);
  s = ok(s, { type: 'SUBDUE_MONSTER', playerId: 'p2', subdue: true });
  assert.equal(controlAttempts(s, 'p2'), 2);
  assert.equal(player(s, 'p2').loose.length, 3);
  assert.equal(s.suspicion, 1);
  assert.equal(s.suspicionHistory.at(-1).reason, 'monster_subdued');
  assert.equal(s.resurrections[0].outcome, 'subdued');
  assert.equal(s.resurrections[0].subduedBy, 'p2');
  assert.equal(s.creatures[s.resurrections[0].creatureId].status, 'destroyed');
  assert.equal(s.result, null);
  assert.equal(s.round, 2, 'a subdued monster is not stable, so the game continues past dawn');
});

test('the chain runs clockwise from the creator; each decline adds 2 suspicion; the subduer takes the parts', () => {
  let s = resurrectionGame(MONSTER, (st) => { fullBody(st, 'p2'); garrison(st, 'p1', 'p3'); });
  s = ok(s, { type: 'COMMIT_RESURRECTION', playerId: 'p2', attempt: true });
  s = ok(s, { type: 'SUBDUE_MONSTER', playerId: 'p2', subdue: false });
  assert.equal(s.suspicion, 2);
  assert.equal(s.activePlayerId, 'p3');
  s = ok(s, { type: 'SUBDUE_MONSTER', playerId: 'p3', subdue: false });
  assert.equal(s.suspicion, 4);
  assert.equal(s.activePlayerId, 'p1');
  s = ok(s, { type: 'SUBDUE_MONSTER', playerId: 'p1', subdue: true });
  assert.equal(player(s, 'p1').loose.length, 3);
  assert.equal(player(s, 'p2').loose.length, 0);
  assert.equal(controlAttempts(s, 'p1'), 2);
  assert.equal(controlAttempts(s, 'p2'), 3);
  assert.deepEqual(s.resurrections[0].controlDecisions.map(({ playerId, subdue }) => ({ playerId, subdue })), [
    { playerId: 'p2', subdue: false }, { playerId: 'p3', subdue: false }, { playerId: 'p1', subdue: true },
  ]);
  assert.equal(s.result, null);
});

test('players with no control attempts are skipped without suspicion', () => {
  let s = resurrectionGame(MONSTER, (st) => {
    fullBody(st, 'p2');
    garrison(st, 'p1', 'p3');
    st.players.find((p) => p.id === 'p3').controlAttemptsUsed = 3;
  });
  s = ok(s, { type: 'COMMIT_RESURRECTION', playerId: 'p2', attempt: true });
  s = ok(s, { type: 'SUBDUE_MONSTER', playerId: 'p2', subdue: false });
  assert.equal(s.activePlayerId, 'p1');
  assert.equal(s.suspicion, 2);
  assert.ok(s.events.some((e) => e.type === 'CONTROL_SKIPPED' && e.playerId === 'p3'));
});

test('a monster nobody can subdue is unleashed immediately', () => {
  let s = resurrectionGame(MONSTER, (st) => {
    st.objectives = { p1: 'prometheus', p2: 'unleasher', p3: 'visionary' };
    fullBody(st, 'p2');
    for (const p of st.players) p.controlAttemptsUsed = 3;
  });
  s = ok(s, { type: 'COMMIT_RESURRECTION', playerId: 'p2', attempt: true });
  assert.equal(s.result.reason, 'unleashed');
  assert.deepEqual(s.result.winners, ['p2']);
  assert.equal(s.suspicion, 0);
});

test('if a decline brings the mob, the monster is unleashed: the Unleasher wins, not the Inquisitor', () => {
  let s = resurrectionGame({ ...MONSTER, suspicionMax: 3 }, (st) => {
    st.objectives = { p1: 'inquisitor', p2: 'prometheus', p3: 'unleasher' };
    fullBody(st, 'p2');
    garrison(st, 'p1', 'p3');
  });
  s = ok(s, { type: 'COMMIT_RESURRECTION', playerId: 'p2', attempt: true });
  s = ok(s, { type: 'SUBDUE_MONSTER', playerId: 'p2', subdue: false });
  assert.equal(s.result, null);
  s = ok(s, { type: 'SUBDUE_MONSTER', playerId: 'p3', subdue: false });
  assert.equal(s.suspicion, 3);
  assert.equal(s.result.reason, 'unleashed');
  assert.deepEqual(s.result.winners, ['p3']);
  assert.ok(s.events.some((e) => e.type === 'MOB_FORMED' && e.overwhelmed));
});

test('resolution continues with the next commitment after a monster is subdued', () => {
  let s = resurrectionGame(MONSTER, (st) => { fullBody(st, 'p1'); fullBody(st, 'p2'); garrison(st, 'p1', 'p2'); });
  const order = s.commitment.order;
  s = ok(s, { type: 'COMMIT_RESURRECTION', playerId: s.activePlayerId, attempt: true });
  s = ok(s, { type: 'COMMIT_RESURRECTION', playerId: s.activePlayerId, attempt: true });
  assert.equal(s.activePlayerId, order[0]);
  assert.equal(player(s, order[1]).body.head !== null, true, 'the second attempt waits for the chain');
  s = ok(s, { type: 'SUBDUE_MONSTER', playerId: order[0], subdue: true });
  assert.equal(s.activePlayerId, order[1], 'the second monster starts its own chain');
  assert.equal(player(s, order[1]).body.head, null);
  s = ok(s, { type: 'SUBDUE_MONSTER', playerId: order[1], subdue: true });
  assert.equal(s.resurrections.length, 2);
  assert.equal(s.round, 2);
});

test('Neural Conditioning grants a control attempt per effective copy, including via publication', () => {
  const s = createGame({ playerCount: 3 }, 'neuro');
  player(s, 'p1').research = ['neurology'];
  assert.equal(controlAttempts(s, 'p1'), 4);
  assert.equal(controlAttempts(s, 'p2'), 3);
  s.publications.push({ playerId: 'p1', type: 'neurology', round: 1 });
  assert.equal(controlAttempts(s, 'p1'), 4, 'own publication does not count again');
  assert.equal(controlAttempts(s, 'p2'), 4);
});

test('SUBDUE_MONSTER is rejected outside a control chain', () => {
  const s = createGame({ playerCount: 3 }, 'nosubdue');
  assert.equal(dispatch(s, { type: 'SUBDUE_MONSTER', playerId: s.activePlayerId, subdue: true }).error.code, 'WRONG_PHASE');
});

test('heuristic: the Inquisitor subdues rather than let a decline bring the mob', () => {
  const decide = (suspicionMax) => {
    let s = resurrectionGame({ ...MONSTER, suspicionMax }, (st) => {
      st.objectives = { p1: 'prometheus', p2: 'inquisitor', p3: 'visionary' };
      fullBody(st, 'p2');
      garrison(st, 'p1', 'p3');
    });
    s = ok(s, { type: 'COMMIT_RESURRECTION', playerId: 'p2', attempt: true });
    assert.equal(s.activePlayerId, 'p2');
    return heuristicPolicy('h').decide({ playerId: 'p2', view: getPlayerView(s, 'p2'), legal: enumerateLegalCommands(s, 'p2') }).subdue;
  };
  assert.equal(decide(10), false, 'declines while the mob is out of reach');
  assert.equal(decide(2), true, 'subdues when a decline would form the mob');
});

test('heuristic: non-Unleashers subdue when last in the chain; Unleashers never do', () => {
  for (const objective of ['prometheus', 'visionary', 'inquisitor', 'unleasher']) {
    let s = resurrectionGame(MONSTER, (st) => {
      st.objectives = { p1: objective, p2: 'prometheus', p3: 'prometheus' };
      fullBody(st, 'p2');
      garrison(st, 'p1', 'p3');
    });
    s = ok(s, { type: 'COMMIT_RESURRECTION', playerId: 'p2', attempt: true });
    s = ok(s, { type: 'SUBDUE_MONSTER', playerId: 'p2', subdue: false });
    s = ok(s, { type: 'SUBDUE_MONSTER', playerId: 'p3', subdue: false });
    assert.equal(s.activePlayerId, 'p1');
    const view = getPlayerView(s, 'p1');
    const cmd = heuristicPolicy('h').decide({ playerId: 'p1', view, legal: enumerateLegalCommands(s, 'p1') });
    assert.equal(cmd.subdue, objective !== 'unleasher', objective);
  }
});

test('only garrisoned players may subdue others\' monsters; the creator needs no garrison', () => {
  let s = resurrectionGame(MONSTER, (st) => { fullBody(st, 'p2'); garrison(st, 'p1'); });
  s = ok(s, { type: 'COMMIT_RESURRECTION', playerId: 'p2', attempt: true });
  assert.equal(s.activePlayerId, 'p2', 'the creator decides without a garrison worker');
  assert.deepEqual(getPublicView(s).control.upcoming, ['p1']);
  s = ok(s, { type: 'SUBDUE_MONSTER', playerId: 'p2', subdue: false });
  assert.equal(s.activePlayerId, 'p1', 'p3 has nobody in the garrison and is skipped');
  assert.ok(s.events.some((e) => e.type === 'CONTROL_SKIPPED' && e.playerId === 'p3' && e.reason === 'not_garrisoned'));
  assert.equal(s.suspicion, 2, 'the skipped player adds no suspicion');
});

test('garrison is a day action for Igors only, capacity 2, and lasts until dawn', () => {
  const g = createGame({}, 'garrison').config.actions.garrison;
  assert.deepEqual([g.phase, g.igor, g.scientist, g.capacity], ['day', true, false, 2]);
  let s = createGame({ playerCount: 3 }, 'garrison2');
  const pid = s.activePlayerId;
  assert.equal(dispatch(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'garrison' }).error.code, 'SCIENTIST_NOT_PERMITTED');
  const igor = `igor-${pid}-1`;
  s.workers[igor] = { id: igor, kind: 'igor', ownerId: pid, active: true, usedThisRound: false };
  s.workerOrder.push(igor);
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: igor, actionId: 'garrison' });
  assert.equal(getPublicView(s).players.find((p) => p.id === pid).garrisoned, true);
  s = passAllUntil(s, (x) => x.round === 2);
  assert.equal(getPublicView(s).players.find((p) => p.id === pid).garrisoned, false);
});

test('a stable Creature adds no suspicion; a subdue that forms the mob wins for the Inquisitor', () => {
  let s = resurrectionGame({ suspicionMax: 1, resurrection: { thresholds: { vitality: -100, humanity: -100 } } }, (st) => {
    st.objectives = { p1: 'inquisitor', p2: 'prometheus', p3: 'unleasher' };
    fullBody(st, 'p2');
  });
  s = ok(s, { type: 'COMMIT_RESURRECTION', playerId: 'p2', attempt: true });
  assert.equal(s.suspicion, 0);
  assert.equal(s.result.reason, 'objective');
  assert.deepEqual(s.result.winners, ['p2']);
  let m = resurrectionGame({ ...MONSTER, suspicionMax: 1 }, (st) => {
    st.objectives = { p1: 'inquisitor', p2: 'prometheus', p3: 'unleasher' };
    fullBody(st, 'p2');
  });
  m = ok(m, { type: 'COMMIT_RESURRECTION', playerId: 'p2', attempt: true });
  assert.equal(m.suspicion, 0, 'creating a monster adds nothing by itself');
  m = ok(m, { type: 'SUBDUE_MONSTER', playerId: 'p2', subdue: true });
  assert.equal(m.result.reason, 'mob');
  assert.deepEqual(m.result.winners, ['p1']);
  assert.equal(m.resurrections[0].outcome, 'subdued');
});

test('six players are supported', () => {
  const { results } = runBatch({ games: 3, policies: 'heuristic', config: { playerCount: 6 }, seedPrefix: 'six', includeCommands: false });
  for (const r of results) { assert.equal(r.playerCount, 6); assert.equal(r.invalidCommands, 0); }
});

test('batch aggregate reports win rate per dealt role', () => {
  const { aggregate } = runBatch({ games: 5, policies: 'heuristic', seedPrefix: 'roles', includeCommands: false });
  const dealt = Object.values(aggregate.dealtByObjective).reduce((a, b) => a + b, 0);
  assert.equal(dealt, 5 * 5);
  const rounds = runBatch({ games: 5, policies: 'heuristic', seedPrefix: 'roles', includeCommands: false }).results.map((r) => r.rounds).sort((x, y) => x - y);
  assert.equal(aggregate.medianRounds, rounds[2], 'median ending round');
  for (const [o, rate] of Object.entries(aggregate.winRateByObjective)) {
    assert.equal(rate, Math.round(1000 * (aggregate.winsByObjective[o] || 0) / aggregate.dealtByObjective[o]) / 1000);
  }
});

test('a control attempt rolls d20 + research against 20; a failed roll spends the attempt, adds no suspicion and passes the monster on', () => {
  let s = resurrectionGame({ ...MONSTER, control: { threshold: 100 } }, (st) => { fullBody(st, 'p2'); garrison(st, 'p1', 'p3'); });
  s = ok(s, { type: 'COMMIT_RESURRECTION', playerId: 'p2', attempt: true });
  const r = dispatch(s, { type: 'SUBDUE_MONSTER', playerId: 'p2', subdue: true });
  s = r.state;
  const roll = r.events.find((e) => e.type === 'CONTROL_ROLLED');
  assert.equal(roll.success, false);
  assert.equal(roll.dice[0].die, 20);
  assert.equal(controlAttempts(s, 'p2'), 2, 'the attempt is spent');
  assert.equal(s.suspicion, 0, 'a failed roll adds no suspicion');
  assert.equal(s.activePlayerId, 'p3');
  assert.equal(s.creatures[s.control.creatureId].status, 'monster');
  s = ok(s, { type: 'SUBDUE_MONSTER', playerId: 'p3', subdue: false });
  assert.equal(s.suspicion, 2, 'declining to try still adds 2');
});

test('control research: Mesmerism adds 1d6 and Restraining Apparatus +4 per effective copy', () => {
  const s = createGame({ playerCount: 3 }, 'control-odds');
  assert.ok(Math.abs(estimateControl(s, 'p1') - 0.05) < 1e-9, 'a bare d20 succeeds only on 20');
  player(s, 'p1').research = ['mesmerism', 'restraint'];
  // d20 + d6 >= 16 has probability 51/120.
  assert.ok(Math.abs(estimateControl(s, 'p1') - 51 / 120) < 1e-9);
  s.publications.push({ playerId: 'p1', type: 'restraint', round: 1 });
  // p2 gets one copy of Restraining Apparatus through the publication: d20 >= 16.
  assert.ok(Math.abs(estimateControl(s, 'p2') - 0.25) < 1e-9);
  let t = resurrectionGame({ ...MONSTER, control: { threshold: 20 } }, (st) => {
    fullBody(st, 'p2');
    st.players.find((p) => p.id === 'p2').research = ['mesmerism', 'restraint'];
  });
  t = ok(t, { type: 'COMMIT_RESURRECTION', playerId: 'p2', attempt: true });
  const r = dispatch(t, { type: 'SUBDUE_MONSTER', playerId: 'p2', subdue: true });
  const roll = r.events.find((e) => e.type === 'CONTROL_ROLLED');
  assert.deepEqual(roll.dice.map((d) => d.source.kind === 'base' ? 'base' : d.source.researchType), ['base', 'mesmerism']);
  assert.deepEqual(roll.fixed.map((f) => f.amount), [4]);
  assert.equal(roll.score, roll.dice.reduce((a, d) => a + d.value, 0) + 4);
  assert.equal(roll.success, roll.score >= 20);
});
