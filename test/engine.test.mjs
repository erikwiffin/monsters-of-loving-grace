import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  createGame, dispatch, getLegalCommands, enumerateLegalCommands, getPlayerView, getPublicView,
  serialize, deserialize, replay, getReplayRecord, scienceCount, estimateResurrection, estimateControl,
  bestVitality, vitalityBonus, canSubdue,
} from '../src/engine/index.js';
import { heuristicPolicy } from '../src/sim/policies.js';
import { runGame, runBatch, aggregate } from '../src/sim/runner.js';

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
    s = ok(s, { type: 'PASS_TURN', playerId: s.activePlayerId });
  }
  return s;
};
const player = (s, pid) => s.players.find((p) => p.id === pid);
// Adds parts of the given variants to a player's hand; returns their IDs.
function give(s, pid, variants) {
  const p = player(s, pid);
  return variants.map((variantId) => {
    s.counters.part += 1;
    const part = { id: `part-${s.counters.part}`, variantId, type: s.config.partVariants[variantId].type };
    p.hand.push(part);
    return part.id;
  });
}
const ORDINARY = ['ordinary_arm', 'ordinary_arm', 'ordinary_leg', 'ordinary_leg', 'ordinary_chest', 'ordinary_head'];
const STRONG = ['labourer_arm', 'labourer_arm', 'athlete_leg', 'athlete_leg', 'robust_chest', 'ordinary_head']; // Vitality 16
// Gives a full set to a player's hand, replacing the named slots' variants.
function giveBody(s, pid, swap = {}) {
  const v = [...ORDINARY];
  const idx = { arm1: 0, arm2: 1, leg1: 2, leg2: 3, chest: 4, head: 5 };
  for (const [slot, id] of Object.entries(swap)) v[idx[slot]] = id;
  return give(s, pid, v);
}
const giveScience = (s, pid, ...types) => { for (const type of types) player(s, pid).science.push({ id: `card-x${player(s, pid).science.length}-${type}`, type }); };

test('createGame is deterministic for a seed and differs across seeds', () => {
  assert.equal(serialize(createGame({}, 'alpha')), serialize(createGame({}, 'alpha')));
  assert.notEqual(serialize(createGame({}, 'alpha')), serialize(createGame({}, 'beta')));
  assert.throws(() => createGame({}));
});

test('setup: money, empty hands, shuffled decks and N+1 objectives', () => {
  for (const n of [3, 4, 5, 6]) {
    const s = createGame({ playerCount: n }, `setup-${n}`);
    assert.equal(s.players.length, n);
    const all = [...Object.values(s.objectives), ...s.unseenObjectives].sort();
    // The Visionary is only dealt from 4 players; Prometheus fills the rest of N+1 cards.
    // Six players have two Unleashers.
    const expected = (n === 6
      ? ['prometheus', 'prometheus', 'prometheus', 'visionary', 'inquisitor', 'unleasher', 'unleasher']
      : n >= 4
        ? [...Array(n - 2).fill('prometheus'), 'visionary', 'inquisitor', 'unleasher']
        : ['prometheus', 'prometheus', 'inquisitor', 'unleasher']).sort();
    assert.deepEqual(all, expected);
    assert.equal(s.unseenObjectives.length, 1);
    for (const p of s.players) {
      assert.equal(p.money, 3);
      assert.deepEqual(p.hand, []);
      assert.deepEqual(p.science, []);
      assert.ok(Object.values(p.body).every((x) => x === null));
    }
    assert.equal(s.market.length, 4);
    assert.equal(s.deck.length, 31 - 4, '31 science cards, minus the market');
    assert.equal(s.partsDeck.length, 60);
    assert.deepEqual(s.partsDiscard, []);
    assert.equal(s.suspicion, 0);
    assert.equal(s.phase, 'day');
    assert.equal(s.activePlayerId, s.players[s.firstPlayerIndex].id);
  }
  // Every copy of every variant is in the deck, once.
  const s = createGame({}, 'deck');
  const counts = {};
  for (const x of s.partsDeck) counts[x.variantId] = (counts[x.variantId] || 0) + 1;
  for (const [id, v] of Object.entries(s.config.partVariants)) assert.equal(counts[id] || 0, v.copies, id);
  assert.equal(new Set(s.partsDeck.map((x) => x.id)).size, 60);
  assert.notDeepEqual(s.partsDeck.map((x) => x.variantId), createGame({}, 'deck-2').partsDeck.map((x) => x.variantId), 'shuffled by seed');
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
    { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'specimens', choices: { partTypes: ['arm'] } },
    { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'hire' },
    { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'charity' },
    { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(other), actionId: 'medicine' },
    { type: 'PICK_PART', playerId: pid, partId: 'part-1' },
    { type: 'PICK_RESEARCH', playerId: pid, cardId: 'card-1' },
    { type: 'PUBLISH_RESEARCH', playerId: pid, researchType: 'medicine' },
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

test('the configuration has no discovery rolls, assembly, publishing or control attempts', () => {
  const cfg = createGame({}, 'cfg').config;
  assert.ok(!('assemble' in cfg.actions));
  assert.ok(!('research' in cfg), 'science replaces research');
  for (const a of Object.values(cfg.actions)) assert.ok(a.suspicion === undefined || Number.isInteger(a.suspicion), 'suspicion is a flat integer');
  assert.ok(!('startingAttempts' in cfg.control));
  assert.ok(!('subdueSalvage' in cfg.control));
  assert.ok(!('failedVitalityRefund' in cfg.resurrection));
  assert.deepEqual(cfg.resurrection.thresholds, { vitality: 10, humanity: 20 });
  for (const n of [3, 4, 5, 6]) assert.equal(createGame({ playerCount: n }, 'susp').config.suspicionMax, 10);
  // Validation: Vitality is fixed, Humanity is dice, science is positive.
  assert.throws(() => createGame({ partVariants: { ordinary_arm: { effects: [{ attribute: 'vitality', op: 'die', die: 6, sign: 1 }] } } }, 'x'), /Vitality/);
  assert.throws(() => createGame({ partVariants: { ordinary_arm: { effects: [{ attribute: 'humanity', op: 'fixed', amount: 2 }] } } }, 'x'), /Humanity/);
  assert.throws(() => createGame({ science: { galvanism: { effects: [{ kind: 'resurrection', attribute: 'vitality', op: 'fixed', amount: -1 }] } } }, 'x'), /positive/);
  assert.throws(() => createGame({ science: { mesmerism: { effects: [{ kind: 'control', op: 'die', die: 6, sign: -1 }] } } }, 'x'), /positive/);
  assert.throws(() => createGame({ science: { medicine: { effects: [{ kind: 'discoveryRollBonus', amount: 1 }] } } }, 'x'), /unknown effect kind/);
  assert.throws(() => createGame({ actions: { graves: { suspicion: -1 } } }, 'x'), /suspicion/);
});

test('medicine income; every Medical Expertise card held adds 1', () => {
  let s = createGame({}, 'medicine');
  const pid = s.activePlayerId;
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'medicine' });
  assert.equal(player(s, pid).money, 6);
  s = createGame({}, 'medicine2');
  const a = s.activePlayerId;
  giveScience(s, a, 'medicine', 'medicine');
  // Another player's cards never help.
  giveScience(s, s.players.find((p) => p.id !== a).id, 'medicine');
  assert.equal(scienceCount(s, a, 'medicine'), 2);
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: a, workerId: sci(a), actionId: 'medicine' });
  assert.equal(player(s, a).money, 3 + 3 + 2);
});

test('capacity tiers follow the player count; medicine and vespers are unlimited', () => {
  for (const [n, cap] of [[3, 2], [4, 2], [5, 3], [6, 3]]) {
    let s = createGame({ playerCount: n }, `capacity-${n}`);
    const v = getPublicView(s);
    assert.equal(v.capacities.research, cap);
    assert.equal(v.capacities.medicine, null);
    assert.equal(v.capacities.vespers, null);
    assert.equal(v.capacities.rest, 1);
    for (let i = 0; i < cap; i++) {
      const pid = s.activePlayerId;
      s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'research', choices: { researchCardId: s.market[0].id } });
    }
    const next = s.activePlayerId;
    const r = dispatch(s, { type: 'PLACE_MEEPLE', playerId: next, workerId: sci(next), actionId: 'research', choices: { researchCardId: s.market[0].id } });
    assert.equal(r.error.code, 'SPACE_FULL');
    assert.ok(!getLegalCommands(s, next).some((c) => c.actionId === 'research'));
    for (let i = 0; i < n; i++) s = ok(s, { type: 'PLACE_MEEPLE', playerId: s.activePlayerId, workerId: `igor-${s.activePlayerId}-1`, actionId: 'medicine' });
  }
  assert.equal(getPublicView(createGame({ playerCount: 6, actions: { graves: { capacity: { 3: 1, 4: 2, 6: 4 } } } }, 'tiers')).capacities.graves, 4);
  assert.equal(getPublicView(createGame({ playerCount: 4, actions: { graves: { capacity: { 3: 1, 4: 2, 6: 4 } } } }, 'tiers')).capacities.graves, 2);
  assert.equal(getPublicView(createGame({ actions: { graves: { capacity: 5 } } }, 'flat')).capacities.graves, 5);
  assert.throws(() => createGame({ actions: { graves: { capacity: { 4: 2 } } } }, 'x'), /cover 3 players/);
  assert.throws(() => createGame({ actions: { graves: { capacity: 0 } } }, 'x'));
});

test('everyone starts with an Igor; hired Igors act at once; an Igor acts once per round', () => {
  let s = createGame({ playerCount: 3, startingMoney: 20 }, 'igor');
  const pid = s.activePlayerId;
  for (const p of s.players) assert.equal(s.workers[`igor-${p.id}-1`].active, true);
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: `igor-${pid}-1`, actionId: 'medicine' });
  assert.equal(player(s, pid).money, 23);
  s = passAllUntil(s, (x) => x.activePlayerId === pid);
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'hire' });
  assert.equal(player(s, pid).money, 19, 'a hire costs 4');
  assert.equal(s.workers[`igor-${pid}-2`].active, true, 'a hired Igor is available at once');
  s = passAllUntil(s, (x) => x.activePlayerId === pid);
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: `igor-${pid}-2`, actionId: 'medicine' });
  s = passAllUntil(s, (x) => x.phase === 'night' && x.activePlayerId === pid);
  const legal = getLegalCommands(s, pid);
  assert.ok(!legal.some((c) => c.workerId === `igor-${pid}-1` || c.workerId === `igor-${pid}-2`), 'Igors act only once per round');
  assert.ok(legal.some((c) => c.workerId === sci(pid)), 'Scientist refreshes for night');
});

test('Igors may take every action except prepare; only Igors garrison; three Igors at most', () => {
  const cfg = createGame({}, 'perms').config.actions;
  for (const [id, a] of Object.entries(cfg)) {
    assert.equal(a.igor, id !== 'prepare', id);
    assert.equal(a.scientist !== false, id !== 'garrison', id);
  }
  let s = createGame({ playerCount: 3, startingMoney: 30 }, 'max-igors');
  const pid = s.activePlayerId;
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: `igor-${pid}-1`, actionId: 'hire' });
  s = passAllUntil(s, (x) => x.activePlayerId === pid);
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: `igor-${pid}-2`, actionId: 'hire' });
  assert.equal(player(s, pid).money, 22, 'every hire costs 4');
  s = passAllUntil(s, (x) => x.round === 2 && x.activePlayerId === pid);
  assert.equal(dispatch(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: `igor-${pid}-3`, actionId: 'hire' }).error.code, 'MAX_IGORS');
});

test('buy specimens: pay 2, draw 3 public parts, keep one with PICK_PART, discard the rest', () => {
  let s = createGame({ playerCount: 3 }, 'specimens');
  const pid = s.activePlayerId;
  const top = s.partsDeck.slice(0, 3).map((x) => x.id);
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'specimens' });
  assert.equal(player(s, pid).money, 1);
  assert.deepEqual(s.pendingPick.parts.map((x) => x.id), top, 'the top three cards');
  assert.ok(s.events.some((e) => e.type === 'SPECIMENS_DRAWN'));
  assert.equal(s.activePlayerId, pid, 'the buyer picks before play moves on');
  const legal = getLegalCommands(s, pid);
  assert.deepEqual(legal.map((c) => c.type), ['PICK_PART', 'PICK_PART', 'PICK_PART']);
  assert.equal(dispatch(s, { type: 'PASS_TURN', playerId: pid }).error.code, 'PICK_PENDING');
  assert.equal(dispatch(s, { type: 'PICK_PART', playerId: pid, partId: 'part-999' }).error.code, 'INVALID_TARGET');
  s = ok(s, { type: 'PICK_PART', playerId: pid, partId: top[1] });
  assert.deepEqual(player(s, pid).hand.map((x) => x.id), [top[1]]);
  assert.deepEqual(s.partsDiscard.map((x) => x.id), [top[0], top[2]]);
  assert.equal(s.partsDeck.length, 57);
  assert.notEqual(s.activePlayerId, pid);
  assert.equal(s.suspicion, 0, 'day actions never raise suspicion');
  // No money: not legal.
  const poor = createGame({ playerCount: 3, startingMoney: 1 }, 'specimens-poor');
  assert.equal(dispatch(poor, { type: 'PLACE_MEEPLE', playerId: poor.activePlayerId, workerId: sci(poor.activePlayerId), actionId: 'specimens' }).error.code, 'INSUFFICIENT_MONEY');
});

test('the parts deck reshuffles its discard pile when it runs out; with neither, nothing is drawn', () => {
  let s = createGame({ playerCount: 3 }, 'reshuffle');
  s = passAllUntil(s, (x) => x.phase === 'night');
  const pid = s.activePlayerId;
  s.partsDiscard = s.partsDeck.splice(1); // one card left in the deck
  const left = s.partsDeck[0].id;
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'graves' });
  const hand = player(s, pid).hand;
  assert.equal(hand.length, 2);
  assert.equal(hand[0].id, left, 'the deck is drawn out first');
  assert.ok(s.events.some((e) => e.type === 'PARTS_DECK_RESHUFFLED' && e.deckSize === 59));
  assert.equal(s.partsDiscard.length, 0);
  assert.equal(s.partsDeck.length, 58);
  // With nothing left anywhere, the part-drawing spaces are closed.
  let t = createGame({ playerCount: 3 }, 'empty');
  t.partsDeck = [];
  const tp = t.activePlayerId;
  assert.equal(dispatch(t, { type: 'PLACE_MEEPLE', playerId: tp, workerId: sci(tp), actionId: 'specimens' }).error.code, 'NO_PARTS');
});

test('rob graves: draw 2 parts, then suspicion +1, no dice', () => {
  let s = createGame({ playerCount: 3 }, 'graves');
  s = passAllUntil(s, (x) => x.phase === 'night');
  const pid = s.activePlayerId;
  const rngBefore = [...s.rng];
  const top = s.partsDeck.slice(0, 2).map((x) => x.id);
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'graves' });
  assert.deepEqual(player(s, pid).hand.map((x) => x.id), top);
  assert.equal(s.suspicion, 1);
  assert.deepEqual(s.rng, rngBefore, 'no randomness is used');
  assert.ok(!s.events.some((e) => e.type === 'DIE_ROLLED'));
  const sus = s.events.filter((e) => e.type === 'SUSPICION_CHANGED');
  assert.equal(sus[sus.length - 1].reason, 'graves');
  assert.equal(sus[sus.length - 1].playerId, pid);
  // The amount is configurable.
  let t = createGame({ playerCount: 3, actions: { graves: { suspicion: 2 } } }, 'graves-2');
  t = passAllUntil(t, (x) => x.phase === 'night');
  t = ok(t, { type: 'PLACE_MEEPLE', playerId: t.activePlayerId, workerId: sci(t.activePlayerId), actionId: 'graves' });
  assert.equal(t.suspicion, 2);
});

test('sell parts: exactly 2 parts from the hand for 7 money, then suspicion +1', () => {
  let s = createGame({ playerCount: 3 }, 'sell');
  s = passAllUntil(s, (x) => x.phase === 'night');
  const pid = s.activePlayerId;
  assert.ok(!getLegalCommands(s, pid).some((c) => c.actionId === 'sell'), 'needs two parts');
  const ids = give(s, pid, ['ordinary_arm', 'damaged_arm', 'ordinary_head']);
  assert.equal(dispatch(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'sell', choices: { partIds: [ids[0]] } }).error.code, 'INVALID_CHOICE');
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'sell', choices: { partIds: [ids[0], ids[1]] } });
  assert.equal(player(s, pid).money, 10);
  assert.deepEqual(player(s, pid).hand.map((x) => x.id), [ids[2]]);
  assert.deepEqual(s.partsDiscard.map((x) => x.id), [ids[0], ids[1]]);
  assert.equal(s.suspicion, 1);
});

test('experiment: discard 2 parts, draw 2 science cards from the deck and keep both, suspicion +1', () => {
  let s = createGame({ playerCount: 3 }, 'experiment');
  s = passAllUntil(s, (x) => x.phase === 'night');
  const pid = s.activePlayerId;
  const ids = give(s, pid, ['ordinary_arm', 'ordinary_leg']);
  const top = s.deck.slice(0, 2);
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'experiment', choices: { partIds: ids } });
  assert.deepEqual(player(s, pid).science.map((c) => c.id).sort(), top.map((c) => c.id).sort());
  assert.deepEqual(player(s, pid).hand, []);
  assert.equal(s.partsDiscard.length, 2);
  assert.equal(s.deck.length, 27 - 2);
  assert.equal(s.suspicion, 1);
  assert.equal(s.pendingPick, null, 'nothing to pick: every card is kept');
  // Duplicates are kept too.
  let t = createGame({ playerCount: 3 }, 'experiment-dup');
  t = passAllUntil(t, (x) => x.phase === 'night');
  const tp = t.activePlayerId;
  giveScience(t, tp, 'galvanism');
  t.deck.unshift({ id: 'card-g1', type: 'galvanism' }, { id: 'card-g2', type: 'galvanism' });
  const tids = give(t, tp, ['ordinary_arm', 'ordinary_leg']);
  t = ok(t, { type: 'PLACE_MEEPLE', playerId: tp, workerId: sci(tp), actionId: 'experiment', choices: { partIds: tids } });
  assert.equal(scienceCount(t, tp, 'galvanism'), 3);
  assert.equal(vitalityBonus(t, tp), 6);
  // An empty deck closes the space.
  let u = createGame({ playerCount: 3 }, 'experiment-empty');
  u = passAllUntil(u, (x) => x.phase === 'night');
  u.deck = [];
  give(u, u.activePlayerId, ['ordinary_arm', 'ordinary_leg']);
  assert.ok(!getLegalCommands(u, u.activePlayerId).some((c) => c.actionId === 'experiment'));
});

test('vespers: free, unlimited, any worker, suspicion −1; only while suspicion is above 0', () => {
  let s = createGame({ playerCount: 3 }, 'vespers');
  s = passAllUntil(s, (x) => x.phase === 'night');
  const pid = s.activePlayerId;
  assert.equal(dispatch(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'vespers' }).error.code, 'NO_SUSPICION');
  s.suspicion = 3;
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'vespers' });
  assert.equal(s.suspicion, 2);
  assert.equal(player(s, pid).money, 3, 'free');
  s = passAllUntil(s, (x) => x.activePlayerId === pid);
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: `igor-${pid}-1`, actionId: 'vespers' });
  assert.equal(s.suspicion, 1);
  assert.equal(s.events.filter((e) => e.type === 'WORKER_PLACED' && e.actionId === 'vespers').length, 2, 'unlimited');
});

test('conduct research: pay 2, take any market card (even a duplicate), refill; Public Lectures calms', () => {
  let s = createGame({ playerCount: 3, startingMoney: 10 }, 'research');
  const pid = s.activePlayerId;
  const card = s.market[1];
  const next = s.deck[0];
  giveScience(s, pid, card.type, 'lectures');
  s.suspicion = 3;
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'research', choices: { researchCardId: card.id } });
  assert.equal(player(s, pid).money, 8);
  assert.equal(scienceCount(s, pid, card.type), card.type === 'lectures' ? 3 : 2, 'a second copy of a type is allowed');
  assert.equal(s.market.length, 4);
  assert.equal(s.market[3].id, next.id, 'the market refills from the deck');
  assert.equal(s.suspicion, 2, 'Public Lectures: −1');
  assert.ok(!s.events.some((e) => e.type === 'RESEARCH_PUBLISHED'), 'there is no publishing');
  for (const p of s.players) if (p.id !== pid) assert.deepEqual(p.science, [], 'nobody else gains anything');
  // An empty market closes the space.
  const t = createGame({ playerCount: 3 }, 'research-empty');
  t.market = [];
  assert.equal(dispatch(t, { type: 'PLACE_MEEPLE', playerId: t.activePlayerId, workerId: sci(t.activePlayerId), actionId: 'research', choices: { researchCardId: 'card-1' } }).error.code, 'MARKET_EMPTY');
});

test('charity: one bundle by default; scalable units when maxUnits > 1; Parish Benefactor adds 1 per unit', () => {
  let s = createGame({ playerCount: 3, startingMoney: 10 }, 'charity');
  const pid = s.activePlayerId;
  assert.equal(dispatch(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'charity' }).error.code, 'NO_SUSPICION');
  s.suspicion = 6;
  giveScience(s, pid, 'benefactor');
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'charity' });
  assert.equal(s.suspicion, 3);
  assert.equal(player(s, pid).money, 7);
  let t = createGame({ playerCount: 3, startingMoney: 10, actions: { charity: { cost: 1, reduction: 1, maxUnits: 4 } } }, 'charity-units');
  t.suspicion = 3;
  const tp = t.activePlayerId;
  const c = getLegalCommands(t, tp).find((x) => x.actionId === 'charity');
  assert.deepEqual(c.choiceConstraints.units.values, [1, 2, 3], 'no more than it takes to reach 0');
  t = ok(t, { type: 'PLACE_MEEPLE', playerId: tp, workerId: sci(tp), actionId: 'charity', choices: { units: 2 } });
  assert.equal(t.suspicion, 1);
});

test('rest: the resting player goes first next round; otherwise first player rotates', () => {
  let s = createGame({ playerCount: 3 }, 'rest');
  const first = s.players[s.firstPlayerIndex];
  s = passAllUntil(s, (x) => x.phase === 'night');
  s = passAllUntil(s, (x) => x.activePlayerId !== first.id);
  const rester = s.activePlayerId;
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: rester, workerId: `igor-${rester}-1`, actionId: 'rest' });
  assert.ok(!getLegalCommands(s, s.activePlayerId).some((c) => c.actionId === 'rest'), 'only one player may rest');
  s = passAllUntil(s, (x) => x.round === 2);
  assert.equal(s.players[s.firstPlayerIndex].id, rester);
  assert.equal(s.activePlayerId, rester);
  const before = s.firstPlayerIndex;
  s = passAllUntil(s, (x) => x.round === 3);
  assert.equal(s.firstPlayerIndex, (before + 1) % 3, 'nobody rested: rotate one seat');
});

// ---------------------------------------------------------------------------
// Preparing and resolving resurrections (spec 025)
// ---------------------------------------------------------------------------

test('prepare: Scientist only; a full set from the hand with Vitality at least 10', () => {
  let s = createGame({ playerCount: 3 }, 'prepare');
  s = passAllUntil(s, (x) => x.phase === 'night');
  const pid = s.activePlayerId;
  assert.equal(dispatch(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'prepare', choices: { partIds: [] } }).error.code, 'NOT_A_FULL_SET');
  const weak = giveBody(s, pid); // Vitality 6
  assert.equal(bestVitality(s, pid), 6);
  assert.equal(dispatch(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'prepare', choices: { partIds: weak } }).error.code, 'VITALITY_TOO_LOW');
  assert.ok(!getLegalCommands(s, pid).some((c) => c.actionId === 'prepare'), 'no legal body, no placement');
  // Science adds to Vitality: 6 + 2 + 2 = 10.
  giveScience(s, pid, 'galvanism', 'galvanism');
  assert.equal(bestVitality(s, pid), 10);
  const t = getLegalCommands(s, pid).find((c) => c.actionId === 'prepare');
  assert.deepEqual(t.choiceConstraints.partIds.perPartType, { arm: 2, leg: 2, chest: 1, head: 1 });
  assert.equal(t.choiceConstraints.partIds.minVitality, 10);
  assert.equal(t.choiceConstraints.partIds.vitalityBonus, 4);
  assert.equal(dispatch(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: `igor-${pid}-1`, actionId: 'prepare', choices: { partIds: weak } }).error.code, 'IGOR_NOT_PERMITTED');
  // Not a full set: three arms.
  const arm = give(s, pid, ['labourer_arm'])[0];
  assert.equal(dispatch(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'prepare', choices: { partIds: [arm, ...weak.slice(0, 5)] } }).error.code, 'NOT_A_FULL_SET');
  // Prepared: the parts leave the hand for the body slots, in slot order.
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'prepare', choices: { partIds: weak } });
  const p = player(s, pid);
  assert.deepEqual(p.hand.map((x) => x.id), [arm]);
  assert.deepEqual(Object.values(p.body).map((x) => x.id), weak);
  const ev = s.events.find((e) => e.type === 'RESURRECTION_PREPARED');
  assert.equal(ev.vitality, 10);
  // Committed parts can't be sold.
  s = passAllUntil(s, (x) => x.activePlayerId === pid);
  assert.equal(dispatch(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: `igor-${pid}-1`, actionId: 'sell', choices: { partIds: [weak[0], arm] } }).error.code, 'INSUFFICIENT_PARTS');
});

test('prepare options enumerate distinct full sets that meet the threshold', () => {
  let s = createGame({ playerCount: 3 }, 'prepare-enum');
  s = passAllUntil(s, (x) => x.phase === 'night');
  const pid = s.activePlayerId;
  give(s, pid, [...STRONG, 'damaged_arm', 'labourer_arm', 'gangrenous_arm']);
  const opts = enumerateLegalCommands(s, pid).filter((c) => c.actionId === 'prepare');
  // Arms: {lab,lab}, {lab,dam}, {lab,gan}, {dam,gan}; Vitality 16, 12, 10, 6 → three qualify.
  assert.equal(opts.length, 3);
  for (const c of opts) assert.ok(dispatch(s, c).ok);
  const all = enumerateLegalCommands(s, pid, { dedupe: false }).filter((c) => c.actionId === 'prepare');
  assert.ok(all.length > opts.length);
  for (const c of all) assert.ok(dispatch(s, c).ok);
});

// Sets up the first night: `setup` hands out parts, then every player in
// `attempters` (by default, everyone with a full set) prepares and the rest
// pass. Returns the state once resolution has started (or later).
function resurrectionGame(config, setup, attempters) {
  let s = createGame({ playerCount: 3, ...config, resurrection: { thresholds: { vitality: 0, humanity: 20 }, ...(config.resurrection || {}) } }, 'res');
  s = passAllUntil(s, (x) => x.phase === 'night');
  setup(s);
  const who = attempters || s.players.filter((p) => bestVitality(s, p.id) !== null).map((p) => p.id);
  while (s.phase === 'night') {
    const pid = s.activePlayerId;
    const prep = enumerateLegalCommands(s, pid).find((c) => c.actionId === 'prepare');
    if (who.includes(pid) && prep && !(s.occupancy.night.prepare || []).includes(sci(pid))) s = ok(s, prep);
    else s = ok(s, { type: 'PASS_TURN', playerId: pid });
  }
  return s;
}
function declineChain(s) {
  let guard = 0;
  while (!s.result && s.control) {
    assert.ok(++guard < 20);
    s = ok(s, { type: 'SUBDUE_MONSTER', playerId: s.activePlayerId, subdue: false });
  }
  return s;
}
const STABLE = { resurrection: { thresholds: { vitality: 0, humanity: -100 } } };
const MONSTERS = { resurrection: { thresholds: { vitality: 0, humanity: 100 } } };
const garrison = (st, ...pids) => { st.occupancy.day.garrison = pids.map((pid) => `igor-${pid}-1`); };

test('a resurrection is one Humanity roll: base d20, part dice in slot order, then science; itemised', () => {
  const s = resurrectionGame({}, (st) => {
    giveBody(st, 'p1', { arm1: 'strangler_arm', leg1: 'dancer_leg', chest: 'priest_chest', head: 'criminal_brain' });
    giveScience(st, 'p1', 'philosophy', 'galvanism', 'philosophy');
  });
  const rolled = s.events.find((e) => e.type === 'RESURRECTION_ROLLED');
  const h = rolled.humanity;
  assert.deepEqual(h.dice.map((d) => (d.source.kind === 'base' ? 'base' : d.source.slot || d.source.scienceType)), ['base', 'arm1', 'leg1', 'chest', 'head', 'philosophy', 'philosophy']);
  assert.deepEqual(h.dice.map((d) => d.sign * d.die), [20, -6, 4, 6, -6, 6, 6]);
  assert.equal(h.score, h.dice.reduce((a, d) => a + d.value, 0));
  assert.equal(h.success, h.score >= 20);
  // Vitality: 2 + 1 + 1 + 1 + 1 + 0 + 2 (Galvanic Mastery) = 8.
  assert.equal(rolled.vitality.total, 8);
  assert.equal(rolled.vitality.sources.reduce((a, x) => a + x.amount, 0), 8);
  assert.equal(s.resurrections[0].vitality, 8);
  assert.ok(!s.events.some((e) => e.type === 'DIE_ROLLED' && e.attribute === 'vitality'), 'Vitality is never rolled');
  // The six parts go to the discard pile, whatever the outcome.
  assert.equal(s.events.find((e) => e.type === 'PARTS_DISCARDED' && e.reason === 'resurrection').parts.length, 6);
});

test('estimateResurrection gives the Vitality total and exact Humanity odds, for a hand or a prepared body', () => {
  const s = createGame({ playerCount: 3 }, 'odds');
  const ids = giveBody(s, 'p1');
  const o = estimateResurrection(s, 'p1', ids);
  assert.deepEqual(o.vitality, { total: 6, threshold: 10, ok: false });
  assert.ok(Math.abs(o.pStable - 0.05) < 1e-9, 'a bare d20 reaches 20 only on a 20');
  assert.ok(Math.abs(o.pMonster - 0.95) < 1e-9);
  assert.equal(estimateResurrection(s, 'p1'), null, 'nothing prepared');
  assert.equal(estimateResurrection(s, 'p2', ids), null, 'not their parts');
  // Brain of a scholar (+d6): d20 + d6 >= 20 has probability 27/120.
  const ids2 = giveBody(s, 'p2', { head: 'scholar_brain' });
  assert.ok(Math.abs(estimateResurrection(s, 'p2', ids2).pStable - 27 / 120) < 1e-9);
  // A negative die can make success impossible.
  const ids3 = giveBody(s, 'p3', { head: 'criminal_brain' });
  assert.equal(estimateResurrection(s, 'p3', ids3).pStable, 0);
});

test('unleashed Creature ends the game immediately; Unleasher wins; later attempts never resolve', () => {
  let s = resurrectionGame(MONSTERS, (st) => {
    st.objectives = { p1: 'unleasher', p2: 'prometheus', p3: 'visionary' };
    for (const p of st.players) giveBody(st, p.id);
  });
  assert.equal(s.result.reason, 'unleashed', 'nobody is garrisoned: unleashed at once');
  assert.deepEqual(s.result.winners, ['p1']);
  const first = s.events.find((e) => e.type === 'RESURRECTIONS_ANNOUNCED').playerIds[0];
  assert.equal(s.resurrections.length, 1);
  assert.equal(s.resurrections[0].playerId, first);
  for (const p of s.players) if (p.id !== first) assert.ok(p.body.head !== null, 'later bodies are untouched');
  assert.ok(s.events.filter((e) => e.type === 'CONTROL_SKIPPED').length === 3, 'every player is skipped, the creator included');
  assert.equal(dispatch(s, { type: 'PASS_TURN', playerId: 'p1' }).error.code, 'GAME_OVER');
});

test('collective defeat if the matching antagonist was not dealt', () => {
  const s = resurrectionGame(MONSTERS, (st) => {
    st.objectives = { p1: 'prometheus', p2: 'inquisitor', p3: 'visionary' };
    st.unseenObjectives = ['unleasher'];
    giveBody(st, 'p1');
  });
  assert.equal(s.result.reason, 'unleashed');
  assert.deepEqual(s.result.winners, []);
  assert.equal(s.result.collectiveDefeat, true);
});

test('only prepared players attempt', () => {
  const s = resurrectionGame(STABLE, (st) => { giveBody(st, 'p1'); giveBody(st, 'p2'); }, ['p1']);
  const announced = s.events.find((e) => e.type === 'RESURRECTIONS_ANNOUNCED');
  assert.deepEqual(announced.playerIds, ['p1']);
  assert.equal(player(s, 'p2').hand.length, 6, "an unprepared player's parts are untouched");
});

test('Prometheus wins at dawn with the only stable Creature', () => {
  const s = resurrectionGame(STABLE, (st) => {
    st.objectives = { p1: 'prometheus', p2: 'inquisitor', p3: 'visionary' };
    giveBody(st, 'p1');
  });
  assert.equal(s.result.reason, 'objective');
  assert.deepEqual(s.result.winners, ['p1']);
  assert.equal(s.suspicion, 0, 'a stable Creature adds no suspicion');
});

test('a lone stable Creature owned by a non-Prometheus ends the game with everyone losing', () => {
  for (const owner of ['visionary', 'inquisitor', 'unleasher']) {
    const s = resurrectionGame(STABLE, (st) => {
      const others = ['prometheus', 'inquisitor', 'unleasher', 'visionary'].filter((o) => o !== owner);
      st.objectives = { p1: owner, p2: others[0], p3: others[1] };
      giveBody(st, 'p1');
    });
    assert.equal(s.result.reason, 'objective', owner);
    assert.deepEqual(s.result.winners, [], owner);
    assert.equal(s.result.collectiveDefeat, true, owner);
  }
});

test('Visionary wins when two Creatures stabilize in one round; two Prometheus both lose', () => {
  let s = resurrectionGame(STABLE, (st) => {
    st.objectives = { p1: 'unleasher', p2: 'inquisitor', p3: 'visionary' };
    giveBody(st, 'p1'); giveBody(st, 'p2');
  });
  assert.deepEqual(s.result.winners, ['p3']);
  s = resurrectionGame(STABLE, (st) => {
    st.objectives = { p1: 'prometheus', p2: 'prometheus', p3: 'inquisitor' };
    st.unseenObjectives = ['visionary'];
    giveBody(st, 'p1'); giveBody(st, 'p2');
  });
  assert.deepEqual(s.result.winners, []);
  assert.equal(s.result.collectiveDefeat, true);
});

test('mob forms at the threshold; Inquisitor wins', () => {
  let s = createGame({ playerCount: 3, suspicionMax: 1 }, 'mob');
  s.objectives = { p1: 'inquisitor', p2: 'prometheus', p3: 'visionary' };
  s = passAllUntil(s, (x) => x.phase === 'night');
  const pid = s.activePlayerId;
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'graves' });
  assert.equal(s.result.reason, 'mob');
  assert.deepEqual(s.result.winners, ['p1']);
  assert.ok(s.events.some((e) => e.type === 'SCIENTISTS_ARRESTED'));
});

// ---------------------------------------------------------------------------
// Control chain (spec 025)
// ---------------------------------------------------------------------------

test('everyone needs a garrisoned Igor to subdue, the creator included; Neural Conditioning waives it for your own', () => {
  const s = createGame({ playerCount: 3 }, 'garrison-rule');
  garrison(s, 'p2');
  assert.equal(canSubdue(s, 'p1', 'p1'), false, 'the creator needs a garrison too');
  assert.equal(canSubdue(s, 'p2', 'p1'), true);
  assert.equal(canSubdue(s, 'p3', 'p1'), false);
  giveScience(s, 'p1', 'neurology');
  assert.equal(canSubdue(s, 'p1', 'p1'), true, 'Neural Conditioning: your own monster without a garrison');
  assert.equal(canSubdue(s, 'p1', 'p2'), false, 'but not anyone else\'s');
  assert.equal(getPublicView(s).players[0].subdueOwn, true);
});

test('the chain runs clockwise from the creator over garrisoned players; each decline adds 2; a subdue destroys it, gives nothing and adds 1', () => {
  let s = resurrectionGame({ ...MONSTERS, control: { threshold: -100 } }, (st) => {
    st.objectives = { p1: 'prometheus', p2: 'prometheus', p3: 'inquisitor' };
    garrison(st, 'p1', 'p2', 'p3');
    giveBody(st, 'p2');
  });
  assert.deepEqual(s.control.chain, ['p2', 'p3', 'p1']);
  assert.equal(s.activePlayerId, 'p2', 'the garrisoned creator decides first');
  s = ok(s, { type: 'SUBDUE_MONSTER', playerId: 'p2', subdue: false });
  assert.equal(s.suspicion, 2);
  assert.equal(s.activePlayerId, 'p3');
  const handBefore = player(s, 'p3').hand.length;
  s = ok(s, { type: 'SUBDUE_MONSTER', playerId: 'p3', subdue: true });
  assert.equal(s.suspicion, 3);
  assert.equal(player(s, 'p3').hand.length, handBefore, 'the subduer gains nothing');
  assert.equal(s.creatures['creature-1'].status, 'destroyed');
  assert.equal(s.resurrections[0].outcome, 'subdued');
  assert.equal(s.resurrections[0].subduedBy, 'p3');
  assert.equal(s.round, 2, 'the game goes on');
});

test('a control roll is d20 + control science against 20; a failure adds nothing and passes the monster on', () => {
  let s = resurrectionGame({ ...MONSTERS, control: { threshold: 100 } }, (st) => {
    st.objectives = { p1: 'prometheus', p2: 'unleasher', p3: 'inquisitor' };
    garrison(st, 'p1', 'p3');
    giveScience(st, 'p3', 'restraint', 'mesmerism');
    giveBody(st, 'p1');
  });
  s = ok(s, { type: 'SUBDUE_MONSTER', playerId: 'p1', subdue: true });
  const roll = s.events.filter((e) => e.type === 'CONTROL_ROLLED').pop();
  assert.equal(roll.success, false);
  assert.equal(s.suspicion, 0);
  assert.ok(s.events.some((e) => e.type === 'CONTROL_SKIPPED' && e.playerId === 'p2'), 'ungarrisoned p2 is skipped');
  assert.equal(s.activePlayerId, 'p3');
  s = ok(s, { type: 'SUBDUE_MONSTER', playerId: 'p3', subdue: true });
  const r3 = s.events.filter((e) => e.type === 'CONTROL_ROLLED').pop();
  assert.deepEqual(r3.dice.map((d) => d.die), [20, 6]);
  assert.deepEqual(r3.fixed.map((f) => f.amount), [3]);
  assert.equal(r3.score, r3.dice[0].result + r3.dice[1].result + 3);
  assert.equal(s.result.reason, 'unleashed');
  // Exact odds: d20 alone 5%; d20 + 3 + d6 >= 20 is 45/120.
  const t = createGame({ playerCount: 3 }, 'control-odds');
  assert.ok(Math.abs(estimateControl(t, 'p1') - 0.05) < 1e-9);
  giveScience(t, 'p1', 'restraint', 'mesmerism');
  assert.ok(Math.abs(estimateControl(t, 'p1') - 45 / 120) < 1e-9);
  assert.ok(Math.abs(getPublicView(t).players[0].controlChance - 45 / 120) < 1e-9);
});

test('if a decline brings the mob, the monster is unleashed: the Unleasher wins, not the Inquisitor', () => {
  let s = resurrectionGame(MONSTERS, (st) => {
    st.objectives = { p1: 'prometheus', p2: 'unleasher', p3: 'inquisitor' };
    garrison(st, 'p1');
    st.suspicion = 8;
    giveBody(st, 'p1');
  });
  s = ok(s, { type: 'SUBDUE_MONSTER', playerId: 'p1', subdue: false });
  assert.equal(s.result.reason, 'unleashed');
  assert.deepEqual(s.result.winners, ['p2']);
  assert.ok(s.events.some((e) => e.type === 'MOB_FORMED' && e.overwhelmed));
});

test('a subdue that forms the mob is an ordinary mob, won by the Inquisitor', () => {
  let s = resurrectionGame({ ...MONSTERS, control: { threshold: -100 } }, (st) => {
    st.objectives = { p1: 'prometheus', p2: 'unleasher', p3: 'inquisitor' };
    garrison(st, 'p1');
    st.suspicion = 9;
    giveBody(st, 'p1');
  });
  s = ok(s, { type: 'SUBDUE_MONSTER', playerId: 'p1', subdue: true });
  assert.equal(s.result.reason, 'mob');
  assert.deepEqual(s.result.winners, ['p3']);
});

test('resolution continues with the next attempt after a monster is subdued', () => {
  let s = resurrectionGame({ ...MONSTERS, control: { threshold: -100 } }, (st) => {
    garrison(st, 'p1', 'p2', 'p3');
    giveBody(st, 'p1'); giveBody(st, 'p2');
  });
  const order = s.resolution.order;
  assert.equal(order.length, 2);
  s = ok(s, { type: 'SUBDUE_MONSTER', playerId: s.activePlayerId, subdue: true });
  assert.ok(s.control, 'the second attempt made a monster too');
  assert.equal(s.control.creatorId, order[1]);
  assert.equal(dispatch(createGame({}, 'nm'), { type: 'SUBDUE_MONSTER', playerId: 'p1', subdue: true }).ok, false, 'no monster, no subdue');
});

test('garrison is a day action for Igors only, capacity 3 at every player count, free, and lasts until dawn', () => {
  for (const n of [3, 6]) assert.equal(getPublicView(createGame({ playerCount: n }, 'g')).capacities.garrison, 3);
  let s = createGame({ playerCount: 3 }, 'garrison');
  const pid = s.activePlayerId;
  assert.equal(dispatch(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: sci(pid), actionId: 'garrison' }).error.code, 'SCIENTIST_NOT_PERMITTED');
  s = ok(s, { type: 'PLACE_MEEPLE', playerId: pid, workerId: `igor-${pid}-1`, actionId: 'garrison' });
  assert.equal(player(s, pid).money, 3);
  assert.equal(getPublicView(s).players.find((p) => p.id === pid).garrisoned, true);
  s = passAllUntil(s, (x) => x.round === 2);
  assert.equal(getPublicView(s).players.find((p) => p.id === pid).garrisoned, false);
});

test('heuristic: the Unleasher never subdues; the Inquisitor subdues rather than let a decline bring the mob', () => {
  const decide = (objective, suspicion) => {
    const s = resurrectionGame(MONSTERS, (st) => {
      st.objectives = { p1: 'prometheus', p2: 'prometheus', p3: 'prometheus' };
      garrison(st, 'p1', 'p2', 'p3');
      st.suspicion = suspicion;
      giveBody(st, 'p1');
    });
    const pid = s.activePlayerId;
    s.objectives[pid] = objective;
    return heuristicPolicy('h', { noise: 0 }).decide({ playerId: pid, view: getPlayerView(s, pid), legal: enumerateLegalCommands(s, pid) }).subdue;
  };
  assert.equal(decide('unleasher', 0), false);
  assert.equal(decide('inquisitor', 8), true);
  assert.equal(decide('prometheus', 0), true, 'a Prometheus subdues its own monster');
});

test('heuristic: suspicion is shared, so only danger or idle money justifies charity; the Inquisitor blocks a scarce charity slot', () => {
  const decideDay = (objective, suspicion, config = {}) => {
    const s = createGame({ playerCount: 3, startingMoney: 8, ...config }, 'h-charity');
    const pid = s.activePlayerId;
    s.objectives[pid] = objective;
    s.suspicion = suspicion;
    const legal = enumerateLegalCommands(s, pid).filter((c) => c.actionId === 'charity' || c.actionId === 'medicine');
    return heuristicPolicy('h', { noise: 0 }).decide({ playerId: pid, view: getPlayerView(s, pid), legal });
  };
  assert.equal(decideDay('prometheus', 3).actionId, 'medicine', 'no charity while the mob is far off');
  assert.equal(decideDay('prometheus', 9).actionId, 'charity', 'charity when the mob is near');
  const scarce = { actions: { charity: { cost: 1, reduction: 1, maxUnits: 4, capacity: 1 } } };
  const inq = decideDay('inquisitor', 6, scarce);
  assert.equal(inq.actionId, 'charity', 'the Inquisitor takes the only charity slot');
  assert.equal(inq.choices.units, 1, 'and spends as little as possible');
});

// ---------------------------------------------------------------------------
// Views, saves and tooling
// ---------------------------------------------------------------------------

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

test('views hide the order of both decks but show the discard pile', () => {
  const s = createGame({}, 'views-decks');
  const v = getPublicView(s);
  assert.ok(!('partsDeck' in v) && !('deck' in v));
  assert.equal(v.partsDeckCount, 60);
  assert.equal(v.deckCount, 27);
  assert.deepEqual(v.partsDiscard, []);
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

test('saves made under different default rules still load and keep their rules', () => {
  const legacy = replay({ config: { playerCount: 3, resurrection: { thresholds: { vitality: 8, humanity: 18 } } }, seed: 'old-rules', commands: [] });
  legacy.configOverrides = { playerCount: 3 };
  let st = legacy;
  for (let i = 0; i < 30 && !st.result; i++) st = dispatch(st, enumerateLegalCommands(st, st.activePlayerId)[0]).state;
  const back = deserialize(serialize(st));
  assert.equal(back.config.resurrection.thresholds.humanity, 18);
  assert.equal(serialize(back), serialize(st));
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
    // There is no forced ending (spec 020). Random play, which rarely builds
    // a body and often attends vespers, may run to the round budget. A bot
    // that hoards (an Inquisitor starving the finite parts deck, say) is
    // stopped and flagged by the runner (spec 014). Either is reported as
    // truncated, never as a result; nothing else may stall.
    const { results } = runBatch({ games: 15, policies, includeCommands: false, seedPrefix: `t-${policies}` });
    for (const r of results) {
      assert.equal(r.invalidCommands, 0);
      if (!r.terminal) {
        assert.equal(r.truncationReason, policies === 'random' ? 'round_budget' : 'hoarding', r.seed);
        continue;
      }
      assert.ok(['mob', 'unleashed', 'objective'].includes(r.terminalReason));
    }
  }
  const t = runGame({ seed: 'budget', maxCommands: 10 }).summary;
  assert.equal(t.truncated, true);
  assert.equal(t.terminalReason, null);
  assert.equal(t.truncationReason, 'command_budget');
});

test('runner stops and flags a bot that hoards money or parts', () => {
  // A tiny limit trips at once; the summary names who, what and their objective.
  const t = runGame({ seed: 'hoard', policies: 'heuristic', hoardLimit: { money: 3, parts: 25 } }).summary;
  assert.equal(t.truncated, true);
  assert.equal(t.terminalReason, null);
  assert.equal(t.truncationReason, 'hoarding');
  assert.equal(t.hoarding.resource, 'money');
  assert.ok(t.hoarding.value > 3);
  assert.equal(t.hoarding.objective, t.objectives[t.hoarding.playerId]);
  assert.equal(t.hoarding.policy, 'heuristic');
  const agg = aggregate([t]);
  assert.equal(agg.truncatedByReason.hoarding, 1);
  assert.equal(agg.hoardingBy[`${t.hoarding.objective}:money`], 1);
  // Random seats are exempt, and the limit can be turned off.
  assert.equal(runGame({ seed: 'hoard', policies: 'random', hoardLimit: { money: 3, parts: 3 } }).summary.hoarding, null);
  assert.equal(runGame({ seed: 'hoard', policies: 'heuristic', hoardLimit: null }).summary.hoarding, null);
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

test('sweep samplers: one-at-a-time, grid, random and Latin hypercube', async () => {
  const { samplePoints, paramValues } = await import('../src/sim/sweep.js');
  assert.deepEqual(paramValues({ min: 2, max: 6, step: 2 }), [2, 4, 6]);
  const params = { a: [1, 2], b: { min: 5, max: 7 } };
  assert.deepEqual(samplePoints({ params, sampler: 'oat' }), [{}, { a: 1 }, { a: 2 }, { b: 5 }, { b: 6 }, { b: 7 }]);
  assert.equal(samplePoints({ params, sampler: 'grid' }).length, 6);
  const rnd = samplePoints({ params, sampler: 'random', samples: 9, seed: 's' });
  assert.equal(rnd.length, 9);
  assert.deepEqual(rnd, samplePoints({ params, sampler: 'random', samples: 9, seed: 's' }), 'seeded');
  const lhs = samplePoints({ params: { b: { min: 1, max: 3 } }, sampler: 'lhs', samples: 6, seed: 'l' });
  assert.deepEqual(lhs.map((p) => p.b).sort(), [1, 1, 2, 2, 3, 3], 'each value equally often');
});

test('sweep points become validated configs; linked paths share a value', async () => {
  const { configForPoint } = await import('../src/sim/sweep.js');
  const cfg = configForPoint({ startingMoney: 5 }, { 'actions.graves.suspicion': 2, 'actions.research.capacity.5|actions.sell.capacity.5': 4, 'partVariants.ordinary_arm.copies': 7 }, 6);
  assert.equal(cfg.startingMoney, 5);
  assert.equal(cfg.playerCount, 6);
  assert.equal(cfg.actions.graves.suspicion, 2);
  assert.equal(cfg.actions.research.capacity[5], 4);
  assert.equal(cfg.actions.sell.capacity[5], 4);
  assert.equal(createGame(cfg, 'x').partsDeck.filter((p) => p.variantId === 'ordinary_arm').length, 7);
  assert.throws(() => configForPoint({}, { 'actions.nope.gain': 1 }, 3), /does not exist/);
  assert.throws(() => configForPoint({}, { 'resurrection.baseDie': 7 }, 3), /supported die/);
});

test('sweep scoring penalises missed targets and explains why', async () => {
  const { scoreAggregate } = await import('../src/sim/sweep.js');
  const good = {
    games: 10, truncated: 0, medianRounds: 8, invalidCommands: 0,
    winRateByObjective: { prometheus: 0.2, inquisitor: 0.25 }, winRateBySeat: [0.2, 0.22],
    actions: { medicine: { capacity: null, perRound: 3 }, graves: { capacity: 2, usedRate: 0.5, fullRate: 0.4 } },
  };
  assert.equal(scoreAggregate(good).total, 0);
  const bad = { ...good, medianRounds: 13, winRateByObjective: { prometheus: 0.6, inquisitor: 0 }, actions: { ...good.actions, graves: { capacity: 2, usedRate: 0.1, fullRate: 0.95 } } };
  const s = scoreAggregate(bad);
  assert.ok(s.total > 0);
  assert.deepEqual(Object.keys(s.parts).sort(), ['graves.crowded', 'graves.underused', 'rounds', 'winSpread']);
  assert.equal(scoreAggregate({ ...good, invalidCommands: 1 }).parts.invalidCommands, 100);
});

test('the cautious and bold heuristic styles play legal games', () => {
  const { results } = runBatch({ games: 4, policies: ['cautious', 'bold', 'heuristic'], includeCommands: false, seedPrefix: 'styles', hoardLimit: null });
  for (const r of results) { assert.equal(r.invalidCommands, 0); assert.equal(r.terminal, true); }
});

test('objective deck: unleashers may be tiered by player count', () => {
  const cfg = { unleashers: { 3: 1, 6: 2 } };
  const count = (n) => createGame({ ...cfg, playerCount: n }, 'u').unseenObjectives.concat(Object.values(createGame({ ...cfg, playerCount: n }, 'u').objectives)).filter((o) => o === 'unleasher').length;
  assert.equal(count(5), 1);
  assert.equal(count(6), 2);
  const s = createGame({ ...cfg, playerCount: 6 }, 'u');
  assert.equal(Object.values(s.objectives).length + s.unseenObjectives.length, 7);
});

test('dispatch shares frozen configuration and log entries, and never mutates the state it was given', () => {
  let s = createGame({ playerCount: 4 }, 'share-1');
  assert.ok(Object.isFrozen(s.config) && Object.isFrozen(s.config.actions.graves));
  for (let i = 0; i < 120 && !s.result; i++) {
    const before = serialize(s);
    const r = dispatch(s, enumerateLegalCommands(s, s.activePlayerId)[0]);
    assert.equal(serialize(s), before, 'the given state changed');
    assert.equal(r.state.config, s.config);
    s = r.state;
  }
  for (const log of [s.suspicionHistory, s.resurrections]) for (const x of log) assert.ok(Object.isFrozen(x));
  const view = getPlayerView(s, s.players[0].id);
  assert.throws(() => { view.config.suspicionMax = 99; });
  assert.throws(() => { view.suspicionHistory[0].value = 99; });
});
