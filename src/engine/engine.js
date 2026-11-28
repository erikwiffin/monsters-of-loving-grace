// Monsters of Loving Grace — headless rules engine.
// Pure JavaScript ES module: no DOM, storage, timers, network or unseeded randomness.
// All gameplay state changes go through dispatch(state, command).

import {
  ENGINE_VERSION, SCHEMA_VERSION, SLOT_ORDER, ALLOWED_DICE, PHASES, DEFAULT_CONFIG,
} from './data.js';
import { seedState, randInt, rollDie, shuffle, isRngState } from './rng.js';

export { ENGINE_VERSION, SCHEMA_VERSION };

const clone = typeof structuredClone === 'function'
  ? (x) => structuredClone(x)
  : (x) => JSON.parse(JSON.stringify(x));

/** Freezes an object and everything in it: a game's configuration never changes once created. */
function deepFreeze(x) {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) deepFreeze(v);
  }
  return x;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Keys whose values are replaced whole rather than merged, so an override's
// capacity tiers never mix with the default tiers.
const ATOMIC_KEYS = new Set(['capacity', 'unleashers']);

function deepMerge(base, over) {
  for (const [k, v] of Object.entries(over)) {
    if (isPlainObject(v) && isPlainObject(base[k]) && !ATOMIC_KEYS.has(k)) deepMerge(base[k], v);
    else base[k] = clone(v);
  }
  return base;
}

/** Default configuration deep-merged with overrides (arrays are replaced). */
export function resolveConfig(overrides = {}) {
  if (overrides != null && !isPlainObject(overrides)) throw new Error('config must be an object');
  const cfg = deepMerge(clone(DEFAULT_CONFIG), overrides || {});
  validateConfig(cfg);
  return cfg;
}

const isNonNegInt = (x) => Number.isInteger(x) && x >= 0;

function validateConfig(cfg) {
  const n = cfg.playerCount;
  if (!Number.isInteger(n) || n < 3 || n > 6) throw new Error('playerCount must be an integer from 3 to 6');
  if (!Number.isInteger(cfg.suspicionMax) || cfg.suspicionMax < 1) throw new Error('suspicionMax must be a positive integer');
  if (!Number.isInteger(cfg.startingIgors) || cfg.startingIgors < 0 || cfg.startingIgors > cfg.maxIgors) throw new Error('startingIgors must be an integer from 0 to maxIgors');
  if (!isNonNegInt(cfg.marketSize)) throw new Error('marketSize must be a non-negative integer');
  const rc = cfg.resurrection;
  if (!ALLOWED_DICE.includes(rc.baseDie)) throw new Error('resurrection.baseDie must be a supported die');
  for (const attr of ['vitality', 'humanity']) {
    if (!Number.isInteger(rc.thresholds[attr])) throw new Error(`resurrection threshold for ${attr} must be an integer`);
  }
  if (!ALLOWED_DICE.includes(cfg.control.baseDie)) throw new Error('control.baseDie must be a supported die');
  if (!Number.isInteger(cfg.control.threshold)) throw new Error('control.threshold must be an integer');
  for (const k of ['declineSuspicion', 'subdueSuspicion']) {
    if (!isNonNegInt(cfg.control[k])) throw new Error(`control.${k} must be a non-negative integer`);
  }
  for (const [t, def] of Object.entries(cfg.partTypes)) {
    if (!Array.isArray(def.slots) || !def.slots.length || def.slots.some((sl) => !SLOT_ORDER.includes(sl))) throw new Error(`part type ${t} must list body slots`);
  }
  if (Object.values(cfg.partTypes).reduce((a, d) => a + d.slots.length, 0) !== SLOT_ORDER.length) throw new Error('part types must cover every body slot once');
  for (const [id, v] of Object.entries(cfg.partVariants)) {
    if (!cfg.partTypes[v.type]) throw new Error(`part variant ${id} has unknown type ${v.type}`);
    if (!isNonNegInt(v.copies)) throw new Error(`part variant ${id}: copies must be a non-negative integer`);
    for (const e of v.effects) validateResurrectionEffect(e, `part variant ${id}`, false);
  }
  for (const t of Object.keys(cfg.partTypes)) {
    if (!Object.values(cfg.partVariants).some((v) => v.type === t)) throw new Error(`part type ${t} has no variants`);
  }
  for (const [id, r] of Object.entries(cfg.science)) {
    if (!isNonNegInt(r.copies)) throw new Error(`science ${id}: copies must be a non-negative integer`);
    for (const e of r.effects) {
      if (!SCIENCE_KINDS.has(e.kind)) throw new Error(`science ${id}: unknown effect kind ${e.kind}`);
      if (e.kind === 'resurrection') validateResurrectionEffect(e, `science ${id}`, true);
      else if (e.kind === 'control') validateControlEffect(e, `science ${id}`);
      else if (e.kind !== 'subdueOwn' && !(Number.isInteger(e.amount) && e.amount > 0)) throw new Error(`science ${id}: amount must be a positive integer`);
    }
  }
  for (const [id, a] of Object.entries(cfg.actions)) {
    if (!HANDLERS[id]) throw new Error(`action ${id} has no rules handler`);
    if (a.phase !== 'day' && a.phase !== 'night') throw new Error(`action ${id} has invalid phase`);
    validateCapacity(a.capacity, id);
    if (a.suspicion !== undefined && !isNonNegInt(a.suspicion)) throw new Error(`action ${id}: suspicion must be a non-negative integer`);
    for (const k of HANDLERS[id].numbers || []) {
      if (!isNonNegInt(a[k])) throw new Error(`action ${id}: ${k} must be a non-negative integer`);
    }
    for (const k of HANDLERS[id].positive || []) {
      if (!Number.isInteger(a[k]) || a[k] < 1) throw new Error(`action ${id}: ${k} must be a positive integer`);
    }
  }
  const unl = tierValue(cfg.unleashers, n);
  const specials = unl + 1 + (n >= cfg.visionaryMinPlayers ? 1 : 0);
  if (!Number.isInteger(unl) || unl < 1 || specials > n) throw new Error('unleashers must be a positive integer that leaves at least one Prometheus card in the objective deck');
  if (!cfg.actions.prepare) throw new Error('the prepare action is required: it is the only way to attempt a resurrection');
}

// Science effect kinds (spec 023). Every effect is positive.
const SCIENCE_KINDS = new Set(['resurrection', 'control', 'medicineBonus', 'researchCalm', 'charityBonus', 'subdueOwn']);

/** Vitality is a whole number; Humanity is a die. Science effects must be positive. */
function validateResurrectionEffect(e, where, positive) {
  if (e.attribute === 'vitality') {
    if (e.op !== 'fixed' || !Number.isInteger(e.amount)) throw new Error(`${where}: a Vitality effect must be a fixed whole number`);
    if (positive && e.amount <= 0) throw new Error(`${where}: science effects must be positive`);
  } else if (e.attribute === 'humanity') {
    if (e.op !== 'die' || !ALLOWED_DICE.includes(e.die) || (e.sign !== 1 && e.sign !== -1)) throw new Error(`${where}: a Humanity effect must be a signed supported die`);
    if (positive && e.sign !== 1) throw new Error(`${where}: science effects must be positive`);
  } else {
    throw new Error(`${where}: unknown attribute ${e.attribute}`);
  }
}

function validateControlEffect(e, where) {
  if (e.op === 'die') {
    if (!ALLOWED_DICE.includes(e.die) || e.sign !== 1) throw new Error(`${where}: a control die must be a positive supported die`);
  } else if (e.op === 'fixed') {
    if (!(Number.isInteger(e.amount) && e.amount > 0)) throw new Error(`${where}: a control modifier must be a positive integer`);
  } else {
    throw new Error(`${where}: unknown op ${e.op}`);
  }
}

function validateCapacity(c, id) {
  if (c === null) return;
  if (Number.isInteger(c) && c >= 1) return;
  if (isPlainObject(c)) {
    const keys = Object.keys(c);
    if (!keys.length) throw new Error(`action ${id}: capacity tiers must not be empty`);
    for (const k of keys) {
      if (!/^[1-9][0-9]*$/.test(k)) throw new Error(`action ${id}: capacity tier keys must be player counts`);
      if (c[k] !== null && !(Number.isInteger(c[k]) && c[k] >= 1)) throw new Error(`action ${id}: capacity tier ${k} must be a positive integer or null`);
    }
    if (Math.min(...keys.map(Number)) > 3) throw new Error(`action ${id}: capacity tiers must cover 3 players`);
    return;
  }
  throw new Error(`action ${id}: capacity must be null, a positive integer or a tier object`);
}


/** A number, or the value of the tier for this player count (tiers keyed by smallest player count). */
function tierValue(v, n) {
  if (typeof v === 'number') return v;
  let best = 0;
  let bestKey = -1;
  for (const [k, x] of Object.entries(v)) if (Number(k) <= n && Number(k) > bestKey) { bestKey = Number(k); best = x; }
  return best;
}

/** Capacity of an action for this game's player count: a number, or null for unlimited. */
export function capacityFor(cfg, actionId) {
  const c = cfg.actions[actionId].capacity;
  if (c === null || typeof c === 'number') return c;
  let best = null;
  let bestKey = -1;
  for (const [k, v] of Object.entries(c)) {
    const n = Number(k);
    if (n <= cfg.playerCount && n > bestKey) { bestKey = n; best = v; }
  }
  return best;
}


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function err(code, message, details) {
  return details ? { code, message, details } : { code, message };
}

function emit(s, type, data = {}, visibility = 'public') {
  s.events.push({ seq: s.events.length + 1, round: s.round, phase: s.phase, type, visibility, ...data });
}

export function getPlayer(s, pid) {
  return s.players.find((p) => p.id === pid) || null;
}

function emptyBody() {
  return { arm1: null, arm2: null, leg1: null, leg2: null, chest: null, head: null };
}

/** Whether a player has a body laid out for a prepared resurrection. */
export function bodyComplete(p) {
  return SLOT_ORDER.every((slot) => p.body[slot] !== null);
}

/** Initiative order (player ids) starting with this round's first player. */
export function initiativeOrder(s) {
  const n = s.players.length;
  const out = [];
  for (let i = 0; i < n; i++) out.push(s.players[(s.firstPlayerIndex + i) % n].id);
  return out;
}

/** Cards of a science type a player holds. Every card applies (spec 023). */
export function scienceCount(s, pid, type) {
  const p = getPlayer(s, pid);
  return p ? p.science.filter((c) => c.type === type).length : 0;
}

/** Each science effect a player holds, one entry per card, in type order. */
function scienceEffects(s, pid, pred) {
  const p = getPlayer(s, pid);
  const out = [];
  if (!p) return out;
  const counts = {};
  for (const c of p.science) counts[c.type] = (counts[c.type] || 0) + 1;
  for (const type of Object.keys(counts).sort()) {
    const def = s.config.science[type];
    if (!def) continue;
    for (let i = 0; i < counts[type]; i++) {
      for (const e of def.effects) if (pred(e)) out.push({ e, source: { kind: 'science', scienceType: type, copy: i + 1 } });
    }
  }
  return out;
}

function scienceBonus(s, pid, kind) {
  return scienceEffects(s, pid, (e) => e.kind === kind).reduce((a, x) => a + (x.e.amount ?? 1), 0);
}

const hasAbility = (s, pid, kind) => scienceEffects(s, pid, (e) => e.kind === kind).length > 0;

/** A player's Vitality from science: added to every body they prepare. */
export function vitalityBonus(s, pid) {
  return scienceEffects(s, pid, (e) => e.kind === 'resurrection' && e.attribute === 'vitality').reduce((a, x) => a + x.e.amount, 0);
}

/** A part variant's Vitality value (0 when it has none). */
export function partVitality(cfg, variantId) {
  return cfg.partVariants[variantId].effects.filter((e) => e.attribute === 'vitality').reduce((a, e) => a + e.amount, 0);
}

/** How many parts of each type a full set needs: { arm: 2, leg: 2, chest: 1, head: 1 }. */
export function fullSetCounts(cfg) {
  return Object.fromEntries(Object.entries(cfg.partTypes).map(([t, d]) => [t, d.slots.length]));
}

/**
 * The highest Vitality total any full set in the player's hand can reach,
 * science included, or null when the hand holds no full set.
 */
export function bestVitality(s, pid) {
  const p = getPlayer(s, pid);
  if (!p) return null;
  let total = vitalityBonus(s, pid);
  for (const [t, need] of Object.entries(fullSetCounts(s.config))) {
    const vals = p.hand.filter((x) => x.type === t).map((x) => partVitality(s.config, x.variantId)).sort((a, b) => b - a);
    if (vals.length < need) return null;
    total += vals.slice(0, need).reduce((a, b) => a + b, 0);
  }
  return total;
}

function playerWorkers(s, pid) {
  return s.workerOrder.map((id) => s.workers[id]).filter((w) => w.ownerId === pid);
}

function workerAvailable(s, w) {
  if (!w.active) return false;
  if (w.kind === 'scientist') return s.phase === 'day' ? !w.usedDay : !w.usedNight;
  return !w.usedThisRound;
}

function occupancyOf(s, actionId) {
  const ph = s.occupancy[s.phase] || {};
  return ph[actionId] || [];
}

function igorCount(s, p) {
  return playerWorkers(s, p.id).filter((w) => w.kind === 'igor').length;
}

function nextIgorCost(s) {
  return s.config.actions.hire ? s.config.actions.hire.cost : null;
}

/** Parts still available to draw: the deck plus the discard pile, which is reshuffled into it. */
function partsAvailable(s) {
  return s.partsDeck.length + s.partsDiscard.length;
}

// ---------------------------------------------------------------------------
// State mutation primitives (all emit events)
// ---------------------------------------------------------------------------

function changeMoney(s, p, delta, reason) {
  p.money += delta;
  emit(s, 'MONEY_CHANGED', { playerId: p.id, delta, balance: p.money, reason });
}

function changeSuspicion(s, delta, reason, playerId = null, onMob = formMob) {
  const max = s.config.suspicionMax;
  const before = s.suspicion;
  const after = Math.max(0, Math.min(max, before + delta));
  s.suspicion = after;
  s.suspicionHistory.push(Object.freeze({ eventSeq: s.events.length + 1, round: s.round, phase: s.phase, value: after, delta: after - before, reason, playerId }));
  emit(s, 'SUSPICION_CHANGED', { playerId, requested: delta, delta: after - before, value: after, max, reason });
  if (delta > 0 && after >= max) onMob(s);
}

/** Draws the top body part, first shuffling the discard pile into a new deck if the deck is empty. Null if none is left. */
function drawPart(s) {
  if (!s.partsDeck.length && s.partsDiscard.length) {
    s.partsDeck = shuffle(s.rng, s.partsDiscard);
    s.partsDiscard = [];
    emit(s, 'PARTS_DECK_RESHUFFLED', { deckSize: s.partsDeck.length });
  }
  return s.partsDeck.shift() || null;
}

function drawParts(s, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const part = drawPart(s);
    if (!part) break;
    out.push(part);
  }
  return out;
}

function discardParts(s, p, parts, reason) {
  s.partsDiscard.push(...parts);
  emit(s, 'PARTS_DISCARDED', { playerId: p ? p.id : null, reason, parts: clone(parts), discardSize: s.partsDiscard.length });
}

/** Removes parts from a player's hand by ID, in the order given. */
function takeFromHand(p, ids) {
  return ids.map((id) => p.hand.splice(p.hand.findIndex((x) => x.id === id), 1)[0]);
}

function gainScience(s, p, cards, via) {
  for (const card of cards) {
    p.science.push(card);
    emit(s, 'SCIENCE_ACQUIRED', { playerId: p.id, cardId: card.id, scienceType: card.type, via });
  }
  p.science.sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
}

function takeMarketScience(s, p, cardId) {
  const idx = s.market.findIndex((c) => c.id === cardId);
  const [card] = s.market.splice(idx, 1);
  gainScience(s, p, [card], 'research');
  if (s.deck.length > 0) {
    const next = s.deck.shift();
    s.market.push(next);
    emit(s, 'MARKET_REFILLED', { cardId: next.id, scienceType: next.type, deckRemaining: s.deck.length });
  } else {
    emit(s, 'MARKET_DECK_EMPTY', { marketSize: s.market.length });
  }
}

function addWorker(s, w) {
  s.workers[w.id] = { usedDay: false, usedNight: false, usedThisRound: false, ...w };
  s.workerOrder.push(w.id);
}

/** A night action's flat suspicion, added after its other effects (spec 022). */
function actionSuspicion(s, p, def, actionId) {
  if (def.suspicion > 0) changeSuspicion(s, def.suspicion, actionId, p.id);
}

// ---------------------------------------------------------------------------
// Action handlers
// prereq(s, p, w, def)       -> error | null  (ignoring choices)
// choiceKeys                 -> required choice keys (all required, no extras)
// checkChoices(s,p,w,def,c)  -> error | null
// constraints(s,p,w,def)     -> machine-readable choice constraints
// apply(s,p,w,def,c)         -> mutates state
// ---------------------------------------------------------------------------

function needMoney(p, amount) {
  return p.money < amount ? err('INSUFFICIENT_MONEY', `Requires ${amount} money; you have ${p.money}.`) : null;
}

function checkHandParts(p, partIds, min, max) {
  if (!Array.isArray(partIds)) return err('INVALID_CHOICE', 'partIds must be an array.');
  if (partIds.length < min || partIds.length > max) return err('INVALID_CHOICE', `Select ${min === max ? min : `${min}–${max}`} parts.`);
  if (new Set(partIds).size !== partIds.length) return err('INVALID_CHOICE', 'partIds must be unique.');
  for (const id of partIds) {
    if (!p.hand.some((x) => x.id === id)) return err('INVALID_TARGET', `Part ${id} is not in your hand.`);
  }
  return null;
}

/** Most charity units a player may buy now: the configured maximum, what they can afford, and no more than it takes to reach 0. */
function charityMaxUnits(s, p, def) {
  let max = def.maxUnits;
  if (def.cost > 0) max = Math.min(max, Math.floor(p.money / def.cost));
  if (def.reduction > 0) max = Math.min(max, Math.ceil(s.suspicion / def.reduction));
  return Math.max(1, max);
}

/** The Vitality total of six parts from a hand, science included. */
function vitalityOf(s, pid, parts) {
  return parts.reduce((a, x) => a + partVitality(s.config, x.variantId), 0) + vitalityBonus(s, pid);
}

function checkBody(s, p, partIds) {
  const total = SLOT_ORDER.length;
  const e = checkHandParts(p, partIds, total, total);
  if (e) return e;
  const parts = partIds.map((id) => p.hand.find((x) => x.id === id));
  for (const [t, need] of Object.entries(fullSetCounts(s.config))) {
    if (parts.filter((x) => x.type === t).length !== need) return err('NOT_A_FULL_SET', 'Choose two arms, two legs, a chest and a head.');
  }
  const vitality = vitalityOf(s, p.id, parts);
  const threshold = s.config.resurrection.thresholds.vitality;
  if (vitality < threshold) return err('VITALITY_TOO_LOW', `That body's Vitality is ${vitality}; it needs ${threshold}.`);
  return null;
}

export const HANDLERS = {
  medicine: {
    choiceKeys: [],
    numbers: ['gain'],
    prereq: () => null,
    apply(s, p, w, def) {
      changeMoney(s, p, def.gain + scienceBonus(s, p.id, 'medicineBonus'), 'medicine');
    },
  },
  research: {
    choiceKeys: ['researchCardId'],
    numbers: ['cost'],
    prereq(s, p, w, def) {
      return needMoney(p, def.cost) || (s.market.length ? null : err('MARKET_EMPTY', 'The science market is empty.'));
    },
    checkChoices(s, p, w, def, c) {
      if (typeof c.researchCardId !== 'string') return err('INVALID_CHOICE', 'researchCardId must be a string.');
      return s.market.some((k) => k.id === c.researchCardId) ? null : err('INVALID_TARGET', `Card ${c.researchCardId} is not in the market.`);
    },
    constraints: (s) => ({ researchCardId: { type: 'enum', values: s.market.map((c) => c.id) } }),
    apply(s, p, w, def, c) {
      changeMoney(s, p, -def.cost, 'research');
      takeMarketScience(s, p, c.researchCardId);
      const calm = scienceBonus(s, p.id, 'researchCalm');
      if (calm > 0 && s.suspicion > 0) changeSuspicion(s, -calm, 'public_lecture', p.id);
    },
  },
  specimens: {
    // Draw several parts, keep one (PICK_PART), discard the rest (spec 022).
    choiceKeys: [],
    numbers: ['cost'],
    positive: ['draw'],
    prereq: (s, p, w, def) => needMoney(p, def.cost) || (partsAvailable(s) ? null : err('NO_PARTS', 'There are no body parts left to draw.')),
    apply(s, p, w, def) {
      if (def.cost) changeMoney(s, p, -def.cost, 'specimens');
      const parts = drawParts(s, def.draw);
      emit(s, 'SPECIMENS_DRAWN', { playerId: p.id, parts: clone(parts) });
      s.pendingPick = { playerId: p.id, actionId: 'specimens', parts: clone(parts) };
    },
  },
  hire: {
    choiceKeys: [],
    numbers: ['cost'],
    prereq(s, p, w, def) {
      if (igorCount(s, p) >= s.config.maxIgors) return err('MAX_IGORS', 'You already employ the maximum number of Igors.');
      return needMoney(p, def.cost);
    },
    apply(s, p, w, def) {
      const cost = def.cost;
      changeMoney(s, p, -cost, 'hire');
      p.igorsHired += 1;
      // A hired Igor can act at once, later this day or tonight.
      const id = `igor-${p.id}-${igorCount(s, p) + 1}`;
      addWorker(s, { id, kind: 'igor', ownerId: p.id, active: true });
      emit(s, 'IGOR_HIRED', { playerId: p.id, workerId: id, cost, availableFromRound: s.round });
    },
  },
  charity: {
    // Buys 1 to maxUnits units, each costing `cost` and removing `reduction`
    // suspicion. With maxUnits 1 (the default) `units` may be omitted.
    choiceKeys: [],
    optionalChoiceKeys: ['units'],
    numbers: ['cost', 'reduction'],
    positive: ['maxUnits'],
    prereq(s, p, w, def) {
      if (s.suspicion <= 0) return err('NO_SUSPICION', 'Suspicion is already 0.');
      return needMoney(p, def.cost);
    },
    checkChoices(s, p, w, def, c) {
      if (c.units === undefined) return null;
      const max = charityMaxUnits(s, p, def);
      return Number.isInteger(c.units) && c.units >= 1 && c.units <= max ? null : err('INVALID_CHOICE', `units must be an integer from 1 to ${max}.`);
    },
    constraints(s, p, w, def) {
      const max = charityMaxUnits(s, p, def);
      return max > 1 ? { units: { type: 'enum', values: Array.from({ length: max }, (_, i) => i + 1) } } : {};
    },
    apply(s, p, w, def, c) {
      const units = c.units || 1;
      changeMoney(s, p, -def.cost * units, 'charity');
      changeSuspicion(s, -(def.reduction + scienceBonus(s, p.id, 'charityBonus')) * units, 'charity', p.id);
    },
  },
  garrison: {
    // No effect of its own: a garrisoned Igor lets its owner try to subdue
    // monsters during this round's resolution (spec 025).
    choiceKeys: [],
    prereq: () => null,
    apply() {},
  },
  graves: {
    choiceKeys: [],
    numbers: ['parts'],
    prereq: (s) => (partsAvailable(s) ? null : err('NO_PARTS', 'There are no body parts left to draw.')),
    apply(s, p, w, def) {
      const parts = drawParts(s, def.parts);
      p.hand.push(...parts);
      emit(s, 'PARTS_GAINED', { playerId: p.id, source: 'graves', parts: clone(parts) });
      actionSuspicion(s, p, def, 'graves');
    },
  },
  sell: {
    choiceKeys: ['partIds'],
    numbers: ['gain'],
    positive: ['parts'],
    prereq: (s, p, w, def) => (p.hand.length < def.parts ? err('INSUFFICIENT_PARTS', `Requires ${def.parts} parts in hand.`) : null),
    checkChoices: (s, p, w, def, c) => checkHandParts(p, c.partIds, def.parts, def.parts),
    constraints: (s, p, w, def) => ({ partIds: { type: 'subset', min: def.parts, max: def.parts, values: p.hand.map((x) => x.id) } }),
    apply(s, p, w, def, c) {
      discardParts(s, p, takeFromHand(p, c.partIds), 'sell');
      changeMoney(s, p, def.gain, 'sell');
      actionSuspicion(s, p, def, 'sell');
    },
  },
  experiment: {
    // Discard parts, draw science cards from the deck and keep them all.
    choiceKeys: ['partIds'],
    positive: ['parts', 'cards'],
    prereq(s, p, w, def) {
      if (p.hand.length < def.parts) return err('INSUFFICIENT_PARTS', `Requires ${def.parts} parts in hand.`);
      return s.deck.length ? null : err('DECK_EMPTY', 'The science deck is empty.');
    },
    checkChoices: (s, p, w, def, c) => checkHandParts(p, c.partIds, def.parts, def.parts),
    constraints: (s, p, w, def) => ({ partIds: { type: 'subset', min: def.parts, max: def.parts, values: p.hand.map((x) => x.id) } }),
    apply(s, p, w, def, c) {
      discardParts(s, p, takeFromHand(p, c.partIds), 'experiment');
      const cards = s.deck.splice(0, def.cards);
      emit(s, 'SCIENCE_DRAWN', { playerId: p.id, cards: clone(cards), deckRemaining: s.deck.length });
      gainScience(s, p, cards, 'experiment');
      actionSuspicion(s, p, def, 'experiment');
    },
  },
  vespers: {
    choiceKeys: [],
    numbers: ['reduction'],
    prereq: (s) => (s.suspicion > 0 ? null : err('NO_SUSPICION', 'Suspicion is already 0.')),
    apply(s, p, w, def) {
      changeSuspicion(s, -def.reduction, 'vespers', p.id);
    },
  },
  prepare: {
    // The Scientist lays out a full set whose Vitality meets the threshold;
    // the attempt resolves after night (spec 025).
    choiceKeys: ['partIds'],
    prereq(s, p) {
      const best = bestVitality(s, p.id);
      if (best === null) return err('NOT_A_FULL_SET', 'You have no full set of body parts.');
      const threshold = s.config.resurrection.thresholds.vitality;
      return best >= threshold ? null : err('VITALITY_TOO_LOW', `Your best body's Vitality is ${best}; it needs ${threshold}.`);
    },
    checkChoices: (s, p, w, def, c) => checkBody(s, p, c.partIds),
    constraints: (s, p) => ({
      partIds: {
        type: 'subset', min: SLOT_ORDER.length, max: SLOT_ORDER.length, values: p.hand.map((x) => x.id),
        perPartType: fullSetCounts(s.config), minVitality: s.config.resurrection.thresholds.vitality, vitalityBonus: vitalityBonus(s, p.id),
      },
    }),
    apply(s, p, w, def, c) {
      const parts = takeFromHand(p, c.partIds);
      for (const part of parts) {
        const slot = s.config.partTypes[part.type].slots.find((sl) => p.body[sl] === null);
        p.body[slot] = part;
      }
      emit(s, 'RESURRECTION_PREPARED', {
        playerId: p.id,
        parts: SLOT_ORDER.map((slot) => ({ slot, partId: p.body[slot].id, variantId: p.body[slot].variantId })),
        vitality: vitalityOf(s, p.id, parts),
      });
    },
  },
  rest: {
    // The resting player goes first next round (spec 021).
    choiceKeys: [],
    prereq: () => null,
    apply(s, p) {
      s.restedBy = p.id;
      emit(s, 'PLAYER_RESTED', { playerId: p.id });
    },
  },
};

/** Whether a player has an Igor in the garrison this round. */
export function garrisoned(s, pid) {
  return (s.occupancy.day.garrison || []).some((wid) => s.workers[wid] && s.workers[wid].ownerId === pid);
}

/** Whether a player may try to subdue a monster made by `creatorId`: a garrison, or Neural Conditioning for their own. */
export function canSubdue(s, pid, creatorId) {
  return garrisoned(s, pid) || (pid === creatorId && hasAbility(s, pid, 'subdueOwn'));
}

/** Prerequisite check for placing a worker on an action, ignoring choices. */
function placementError(s, p, w, actionId) {
  const def = s.config.actions[actionId];
  if (!def) return err('UNKNOWN_ACTION', `Unknown action ${actionId}.`);
  if (def.phase !== s.phase) return err('WRONG_PHASE', `${actionId} is a ${def.phase} action.`);
  if (!w || w.ownerId !== p.id) return err('UNKNOWN_WORKER', 'That worker does not belong to you.');
  if (!w.active) return err('WORKER_PENDING', 'That worker is not available until next round.');
  if (!workerAvailable(s, w)) return err('WORKER_USED', 'That worker has already acted.');
  if (w.kind === 'igor' && !def.igor) return err('IGOR_NOT_PERMITTED', 'Igors may not take that action.');
  if (w.kind === 'scientist' && def.scientist === false) return err('SCIENTIST_NOT_PERMITTED', 'Only an Igor may take that action.');
  const cap = capacityFor(s.config, actionId);
  if (cap != null && occupancyOf(s, actionId).length >= cap) return err('SPACE_FULL', `${def.location} is full.`);
  return HANDLERS[actionId].prereq(s, p, w, def);
}

function hasLegalPlacement(s, p) {
  for (const w of playerWorkers(s, p.id)) {
    if (!workerAvailable(s, w)) continue;
    for (const id of Object.keys(s.config.actions)) {
      if (!placementError(s, p, w, id)) return true;
    }
  }
  return false;
}

/**
 * The N+1 objective cards for a configuration: the Inquisitor, the Unleasher,
 * the Visionary from visionaryMinPlayers players, and Prometheus for the rest.
 */
export function objectiveDeckFor(cfg) {
  const n = cfg.playerCount;
  const unl = tierValue(cfg.unleashers, n);
  const special = [...(n >= cfg.visionaryMinPlayers ? ['visionary'] : []), 'inquisitor', ...Array(unl).fill('unleasher')];
  return [...Array(n + 1 - special.length).fill('prometheus'), ...special];
}

// ---------------------------------------------------------------------------
// Game creation
// ---------------------------------------------------------------------------

export function createGame(config = {}, seed) {
  if (seed === undefined || seed === null || seed === '') throw new Error('createGame requires a seed');
  const cfg = resolveConfig(config);
  const n = cfg.playerCount;
  const s = {
    format: 'molg-state',
    schemaVersion: SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    seed: String(seed),
    configOverrides: clone(config || {}),
    config: deepFreeze(cfg),
    rng: seedState(String(seed)),
    round: 1,
    phase: 'setup',
    firstPlayerIndex: 0,
    turnPointer: 0,
    activePlayerId: null,
    players: [],
    workers: {},
    workerOrder: [],
    suspicion: 0,
    suspicionHistory: [],
    deck: [],
    market: [],
    partsDeck: [],
    partsDiscard: [],
    occupancy: { day: {}, night: {} },
    resolution: null,
    restedBy: null,
    control: null,
    pendingPick: null,
    stableTransitions: [],
    creatures: {},
    creatureOrder: [],
    counters: { part: 0, creature: 0 },
    objectives: {},
    unseenObjectives: [],
    resurrections: [],
    events: [],
    commandLog: [],
    result: null,
  };
  for (let i = 0; i < n; i++) {
    const id = `p${i + 1}`;
    const name = (cfg.playerNames && cfg.playerNames[i]) || `Scientist ${i + 1}`;
    s.players.push({ id, name: String(name), seat: i, money: cfg.startingMoney, hand: [], body: emptyBody(), science: [], igorsHired: 0, passed: false });
    addWorker(s, { id: `scientist-${id}`, kind: 'scientist', ownerId: id, active: true });
    for (let k = 1; k <= cfg.startingIgors; k++) addWorker(s, { id: `igor-${id}-${k}`, kind: 'igor', ownerId: id, active: true });
  }
  s.firstPlayerIndex = randInt(s.rng, n);
  s.turnPointer = s.firstPlayerIndex;

  const objectiveDeck = objectiveDeckFor(cfg);
  shuffle(s.rng, objectiveDeck);
  s.players.forEach((p, i) => { s.objectives[p.id] = objectiveDeck[i]; });
  s.unseenObjectives = objectiveDeck.slice(n);

  let k = 0;
  for (const type of Object.keys(cfg.science).sort()) {
    for (let c = 0; c < cfg.science[type].copies; c++) s.deck.push({ id: `card-${++k}`, type });
  }
  shuffle(s.rng, s.deck);
  s.market = s.deck.splice(0, cfg.marketSize);

  for (const [variantId, v] of Object.entries(cfg.partVariants)) {
    for (let c = 0; c < v.copies; c++) {
      s.counters.part += 1;
      s.partsDeck.push({ id: `part-${s.counters.part}`, variantId, type: v.type });
    }
  }
  shuffle(s.rng, s.partsDeck);
  s.suspicionHistory.push(Object.freeze({ eventSeq: 0, round: 1, phase: 'setup', value: 0, delta: 0, reason: 'start', playerId: null }));

  emit(s, 'GAME_STARTED', {
    engineVersion: ENGINE_VERSION,
    players: s.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat })),
    firstPlayerId: s.players[s.firstPlayerIndex].id,
    market: clone(s.market),
    partsDeckSize: s.partsDeck.length,
  });
  for (const p of s.players) emit(s, 'OBJECTIVE_ASSIGNED', { playerId: p.id, objective: s.objectives[p.id] }, [p.id]);
  startRound(s);
  advance(s);
  return s;
}

// ---------------------------------------------------------------------------
// Phase progression (automatic)
// ---------------------------------------------------------------------------

function startRound(s) {
  emit(s, 'ROUND_STARTED', { firstPlayerId: s.players[s.firstPlayerIndex].id, initiative: initiativeOrder(s) });
  startWorkerPhase(s, 'day');
}

function startWorkerPhase(s, phase) {
  s.phase = phase;
  for (const p of s.players) p.passed = false;
  s.turnPointer = s.firstPlayerIndex;
  emit(s, 'PHASE_STARTED', {});
}

function endPhase(s) {
  emit(s, 'PHASE_ENDED', {});
}

function nextPlacementPlayer(s) {
  const n = s.players.length;
  for (let i = 0; i < n; i++) {
    const p = s.players[(s.turnPointer + i) % n];
    if (p.passed) continue;
    if (hasLegalPlacement(s, p)) return p;
  }
  return null;
}

/**
 * After night, every player whose Scientist prepared a resurrection attempts
 * one, in initiative order. There is no secret commitment (spec 021).
 */
function startResolution(s) {
  s.phase = 'resolution';
  emit(s, 'PHASE_STARTED', {});
  const prepared = new Set((s.occupancy.night.prepare || []).map((wid) => s.workers[wid].ownerId));
  const order = initiativeOrder(s).filter((pid) => prepared.has(pid));
  emit(s, 'RESURRECTIONS_ANNOUNCED', { playerIds: [...order] });
  s.resolution = { order, resolved: 0 };
}

/** The next player in a control chain who may try to subdue the monster, skipping (and logging) the rest. */
function nextController(s) {
  const k = s.control;
  while (k.position < k.chain.length) {
    const pid = k.chain[k.position];
    if (canSubdue(s, pid, k.creatorId)) return pid;
    emit(s, 'CONTROL_SKIPPED', { playerId: pid, creatureId: k.creatureId, reason: 'not_garrisoned' });
    k.position += 1;
  }
  return null;
}

function dawn(s) {
  // Any stable Creature ends the game at dawn. Exactly one: its owner wins
  // if they are a Prometheus. Two or more: the Visionary wins if dealt.
  // Otherwise everyone loses.
  const transitions = s.stableTransitions;
  const winners = [];
  const visionary = transitions.length >= 2;
  const soleOwner = transitions.length === 1 ? s.creatures[transitions[0]].ownerId : null;
  for (const p of s.players) {
    const obj = s.objectives[p.id];
    if (obj === 'visionary' && visionary) winners.push(p.id);
    if (obj === 'prometheus' && p.id === soleOwner) winners.push(p.id);
  }
  emit(s, 'DAWN_CHECK', { stableTransitions: [...transitions], objectiveMet: winners.length > 0 });
  if (transitions.length) {
    endGame(s, 'objective', winners);
    return;
  }
  for (const id of s.workerOrder) {
    const w = s.workers[id];
    w.usedDay = false; w.usedNight = false; w.usedThisRound = false;
    if (!w.active) {
      w.active = true;
      emit(s, 'WORKER_ACTIVATED', { playerId: w.ownerId, workerId: w.id, kind: w.kind });
    }
  }
  s.occupancy = { day: {}, night: {} };
  s.stableTransitions = [];
  s.resolution = null;
  endPhase(s);
  // The player who rested goes first; otherwise the first player moves one seat to the left.
  if (s.restedBy) s.firstPlayerIndex = getPlayer(s, s.restedBy).seat;
  else s.firstPlayerIndex = (s.firstPlayerIndex + 1) % s.players.length;
  s.restedBy = null;
  s.round += 1;
  startRound(s);
}

/** Runs forced transitions and system outcomes until a player decision or the end. */
function advance(s) {
  let guard = 0;
  while (!s.result) {
    if (++guard > 100000) throw new Error('advance(): no decision point reached');
    if (s.phase === 'day' || s.phase === 'night') {
      if (s.pendingPick) { s.activePlayerId = s.pendingPick.playerId; return; }
      const p = nextPlacementPlayer(s);
      if (p) { s.activePlayerId = p.id; return; }
      endPhase(s);
      if (s.phase === 'day') startWorkerPhase(s, 'night');
      else startResolution(s);
    } else if (s.phase === 'resolution') {
      // Attempts resolve in initiative order; a monster pauses resolution
      // while players decide, one at a time, whether to subdue it.
      if (s.control) {
        const pid = nextController(s);
        if (pid) { s.activePlayerId = pid; return; }
        unleash(s, 'no_one_subdued');
        continue;
      }
      const c = s.resolution;
      if (c.resolved < c.order.length) {
        const pid = c.order[c.resolved];
        c.resolved += 1;
        resurrect(s, pid);
        continue;
      }
      endPhase(s);
      s.phase = 'dawn';
      emit(s, 'PHASE_STARTED', {});
    } else if (s.phase === 'dawn') {
      dawn(s);
    } else {
      throw new Error(`advance(): unexpected phase ${s.phase}`);
    }
  }
  s.activePlayerId = null;
}

// ---------------------------------------------------------------------------
// Resurrection
// ---------------------------------------------------------------------------

function rollEffects(s, effects, acc) {
  for (const { e, source } of effects) {
    if (e.op === 'die') {
      const result = rollDie(s.rng, e.die);
      acc.dice.push({ source, die: e.die, sign: e.sign, result, value: e.sign * result });
    } else if (e.op === 'fixed') {
      acc.fixed.push({ source, amount: e.amount });
    }
  }
}

/** The Humanity dice of a body, in roll order: parts in slot order, then science in type order. */
function humanityEffects(s, pid, body) {
  const out = [];
  for (const slot of SLOT_ORDER) {
    const part = body[slot];
    for (const e of s.config.partVariants[part.variantId].effects) {
      if (e.attribute === 'humanity') out.push({ e, source: { kind: 'part', slot, partId: part.id, variantId: part.variantId } });
    }
  }
  out.push(...scienceEffects(s, pid, (e) => e.kind === 'resurrection' && e.attribute === 'humanity'));
  return out;
}

/** The Vitality sources of a body: parts in slot order, then science in type order. */
function vitalitySources(s, pid, body) {
  const out = [];
  for (const slot of SLOT_ORDER) {
    const part = body[slot];
    const amount = partVitality(s.config, part.variantId);
    if (amount) out.push({ source: { kind: 'part', slot, partId: part.id, variantId: part.variantId }, amount });
  }
  for (const { e, source } of scienceEffects(s, pid, (x) => x.kind === 'resurrection' && x.attribute === 'vitality')) out.push({ source, amount: e.amount });
  return out;
}

function resurrect(s, pid) {
  const p = getPlayer(s, pid);
  const rc = s.config.resurrection;
  const body = { ...p.body };
  const consumed = SLOT_ORDER.map((slot) => body[slot]);
  p.body = emptyBody();
  emit(s, 'RESURRECTION_STARTED', { playerId: pid, parts: SLOT_ORDER.map((slot) => ({ slot, partId: body[slot].id, variantId: body[slot].variantId })) });
  const sources = vitalitySources(s, pid, body);
  const vitality = { total: sources.reduce((a, x) => a + x.amount, 0), threshold: rc.thresholds.vitality, sources };
  const acc = { dice: [], fixed: [] };
  const base = rollDie(s.rng, rc.baseDie);
  acc.dice.push({ source: { kind: 'base' }, die: rc.baseDie, sign: 1, result: base, value: base });
  rollEffects(s, humanityEffects(s, pid, body), acc);
  const score = acc.dice.reduce((a, d) => a + d.value, 0);
  const humanity = { dice: acc.dice, threshold: rc.thresholds.humanity, score, success: score >= rc.thresholds.humanity };
  for (const d of acc.dice) emit(s, 'DIE_ROLLED', { playerId: pid, purpose: 'resurrection', attribute: 'humanity', source: d.source, die: d.die, sign: d.sign, result: d.result });
  emit(s, 'RESURRECTION_ROLLED', { playerId: pid, vitality: clone(vitality), humanity: clone(humanity) });
  discardParts(s, p, consumed, 'resurrection');
  const record = {
    round: s.round, playerId: pid,
    vitality: vitality.total,
    humanity: { score, threshold: humanity.threshold, success: humanity.success },
    outcome: null, creatureId: null,
  };
  s.counters.creature += 1;
  const cid = `creature-${s.counters.creature}`;
  if (humanity.success) {
    s.creatures[cid] = { id: cid, ownerId: pid, status: 'stable', disposition: 'humane', round: s.round };
    s.creatureOrder.push(cid);
    s.stableTransitions.push(cid);
    record.outcome = 'stable';
    record.creatureId = cid;
    s.resurrections.push(deepFreeze(record));
    emit(s, 'CREATURE_STABILIZED', { playerId: pid, creatureId: cid, disposition: 'humane' });
    return;
  }
  // A monster: the control chain starts with its creator and runs clockwise.
  s.creatures[cid] = { id: cid, ownerId: pid, status: 'monster', disposition: 'monster', round: s.round };
  s.creatureOrder.push(cid);
  record.creatureId = cid;
  record.controlDecisions = [];
  const n = s.players.length;
  const chain = Array.from({ length: n }, (_, i) => s.players[(p.seat + i) % n].id);
  s.control = { creatorId: pid, creatureId: cid, chain, position: 0, record };
  emit(s, 'MONSTER_CREATED', { playerId: pid, creatureId: cid, chain: [...chain] });
}

function mobCannotStopMonster(s) {
  emit(s, 'MOB_FORMED', { suspicion: s.suspicion, overwhelmed: true });
  unleash(s, 'mob_overwhelmed');
}

/** Control-roll effects for a player: science in type order, one entry per card. */
function controlEffects(s, pid) {
  return scienceEffects(s, pid, (e) => e.kind === 'control');
}

/** The control threshold. */
export function controlThreshold(s) {
  return s.config.control.threshold;
}

/** Exact chance that a player's control roll succeeds. Pure: consumes no RNG. */
export function estimateControl(s, pid) {
  const cc = s.config.control;
  return successChance([{ op: 'die', die: cc.baseDie, sign: 1 }, ...controlEffects(s, pid).map((x) => x.e)], cc.threshold);
}

// successChance is pure and called for every player against every creator on
// every view, so its results are cached by their inputs.
const chanceCache = new Map();
function successChance(effects, threshold) {
  let key = `${threshold}`;
  for (const e of effects) key += `|${e.op},${e.die},${e.sign},${e.amount}`;
  const hit = chanceCache.get(key);
  if (hit !== undefined) return hit;
  const v = computeSuccessChance(effects, threshold);
  if (chanceCache.size > 20000) chanceCache.clear();
  chanceCache.set(key, v);
  return v;
}

function computeSuccessChance(effects, threshold) {
  let dist = new Map([[0, 1]]);
  for (const e of effects) {
    const faces = e.op === 'die' ? Array.from({ length: e.die }, (_, i) => e.sign * (i + 1)) : [e.amount];
    const next = new Map();
    for (const [v, pr] of dist) for (const f of faces) next.set(v + f, (next.get(v + f) || 0) + pr / faces.length);
    dist = next;
  }
  let success = 0;
  for (const [v, pr] of dist) if (v >= threshold) success += pr;
  return success;
}

function attemptControl(s, pid) {
  const k = s.control;
  const cc = s.config.control;
  const acc = { dice: [], fixed: [] };
  const base = rollDie(s.rng, cc.baseDie);
  acc.dice.push({ source: { kind: 'base' }, die: cc.baseDie, sign: 1, result: base, value: base });
  rollEffects(s, controlEffects(s, pid), acc);
  const score = acc.dice.reduce((a, d) => a + d.value, 0) + acc.fixed.reduce((a, f) => a + f.amount, 0);
  const threshold = cc.threshold;
  const success = score >= threshold;
  for (const d of acc.dice) emit(s, 'DIE_ROLLED', { playerId: pid, purpose: 'control', source: d.source, die: d.die, sign: d.sign, result: d.result });
  emit(s, 'CONTROL_ROLLED', { playerId: pid, creatureId: k.creatureId, dice: clone(acc.dice), fixed: clone(acc.fixed), threshold, score, success });
  k.record.controlDecisions.push({ playerId: pid, subdue: true, score, threshold, success });
  if (success) { subdue(s, pid); return; }
  // A failed attempt adds no suspicion; the monster passes on.
  k.position += 1;
}

function subdue(s, pid) {
  const k = s.control;
  const c = s.creatures[k.creatureId];
  c.status = 'destroyed';
  c.disposition = 'subdued';
  c.subduedBy = pid;
  k.record.outcome = 'subdued';
  k.record.subduedBy = pid;
  s.resurrections.push(deepFreeze(k.record));
  s.control = null;
  emit(s, 'MONSTER_SUBDUED', { playerId: pid, creatorId: c.ownerId, creatureId: c.id });
  // The struggle is noticed. The monster is already destroyed, so a mob
  // formed now is an ordinary mob.
  changeSuspicion(s, s.config.control.subdueSuspicion, 'monster_subdued', pid);
}

function declineSubdue(s, pid) {
  const k = s.control;
  k.record.controlDecisions.push({ playerId: pid, subdue: false });
  k.position += 1;
  emit(s, 'SUBDUE_DECLINED', { playerId: pid, creatureId: k.creatureId });
  // The mob cannot stop a monster: if it forms now, the monster is unleashed.
  changeSuspicion(s, s.config.control.declineSuspicion, 'monster_not_subdued', pid, mobCannotStopMonster);
}

function unleash(s, cause) {
  const k = s.control;
  const c = s.creatures[k.creatureId];
  c.status = 'unleashed';
  c.disposition = 'unleashed';
  k.record.outcome = 'unleashed';
  s.resurrections.push(deepFreeze(k.record));
  s.control = null;
  emit(s, 'CREATURE_UNLEASHED', { playerId: c.ownerId, creatureId: c.id, cause });
  endGame(s, 'unleashed', s.players.filter((x) => s.objectives[x.id] === 'unleasher').map((x) => x.id));
}

/**
 * A body's Vitality total and exact Humanity odds with the player's current
 * science: six part IDs from their hand, or (by default) their prepared body.
 * Pure: consumes no RNG. Returns null without a full set.
 */
export function estimateResurrection(s, pid, partIds = null) {
  const p = getPlayer(s, pid);
  if (!p) return null;
  let body;
  if (partIds) {
    const parts = partIds.map((id) => p.hand.find((x) => x.id === id) || Object.values(p.body).find((x) => x && x.id === id));
    if (parts.length !== SLOT_ORDER.length || parts.some((x) => !x)) return null;
    body = emptyBody();
    for (const part of parts) {
      const slot = s.config.partTypes[part.type].slots.find((sl) => body[sl] === null);
      if (!slot) return null;
      body[slot] = part;
    }
  } else {
    if (!bodyComplete(p)) return null;
    body = p.body;
  }
  const rc = s.config.resurrection;
  const total = vitalitySources(s, pid, body).reduce((a, x) => a + x.amount, 0);
  const effects = [{ op: 'die', die: rc.baseDie, sign: 1 }, ...humanityEffects(s, pid, body).map((x) => x.e)];
  const pStable = successChance(effects, rc.thresholds.humanity);
  return {
    vitality: { total, threshold: rc.thresholds.vitality, ok: total >= rc.thresholds.vitality },
    humanity: { threshold: rc.thresholds.humanity, success: pStable },
    pStable,
    pMonster: 1 - pStable,
  };
}

// ---------------------------------------------------------------------------
// Game end
// ---------------------------------------------------------------------------

function formMob(s) {
  emit(s, 'MOB_FORMED', { suspicion: s.suspicion });
  emit(s, 'SCIENTISTS_ARRESTED', { playerIds: s.players.map((p) => p.id) });
  endGame(s, 'mob', s.players.filter((p) => s.objectives[p.id] === 'inquisitor').map((p) => p.id));
}

function endGame(s, reason, winners) {
  s.result = {
    reason,
    winners,
    collectiveDefeat: winners.length === 0,
    round: s.round,
    phase: s.phase,
    objectives: clone(s.objectives),
    unseenObjectives: clone(s.unseenObjectives),
  };
  emit(s, 'OBJECTIVES_REVEALED', { objectives: clone(s.objectives), unseenObjectives: clone(s.unseenObjectives) });
  emit(s, 'GAME_ENDED', { reason, winners, collectiveDefeat: winners.length === 0 });
  s.phase = 'ended';
  s.activePlayerId = null;
}

// ---------------------------------------------------------------------------
// Command validation and dispatch
// ---------------------------------------------------------------------------

const COMMAND_FIELDS = {
  PLACE_MEEPLE: { required: ['type', 'playerId', 'workerId', 'actionId'], optional: ['choices', 'seq'] },
  PASS_TURN: { required: ['type', 'playerId'], optional: ['seq'] },
  SUBDUE_MONSTER: { required: ['type', 'playerId', 'subdue'], optional: ['seq'] },
  PICK_PART: { required: ['type', 'playerId', 'partId'], optional: ['seq'] },
};

export const COMMAND_TYPES = Object.keys(COMMAND_FIELDS);

/** Returns a structured error, or null if the command is legal in this state. */
export function validateCommand(s, cmd) {
  if (!isPlainObject(cmd)) return err('INVALID_COMMAND', 'Command must be an object.');
  const schema = COMMAND_FIELDS[cmd.type];
  if (!schema) return err('UNKNOWN_COMMAND', `Unknown command type ${cmd.type}.`);
  for (const k of Object.keys(cmd)) {
    if (!schema.required.includes(k) && !schema.optional.includes(k)) return err('UNKNOWN_FIELD', `Unknown field ${k}.`);
  }
  for (const k of schema.required) if (cmd[k] === undefined) return err('MISSING_FIELD', `Missing field ${k}.`);
  if (s.result) return err('GAME_OVER', 'The game has ended.');
  if (cmd.seq !== undefined && cmd.seq !== s.commandLog.length) {
    return err('STALE_COMMAND', `Expected seq ${s.commandLog.length}, got ${cmd.seq}.`);
  }
  const p = getPlayer(s, cmd.playerId);
  if (!p) return err('UNKNOWN_PLAYER', `Unknown player ${cmd.playerId}.`);
  if (s.activePlayerId !== p.id) return err('NOT_YOUR_TURN', `It is ${s.activePlayerId}'s decision.`);

  if (cmd.type === 'SUBDUE_MONSTER') {
    if (s.phase !== 'resolution' || !s.control) return err('WRONG_PHASE', 'There is no monster to subdue.');
    if (typeof cmd.subdue !== 'boolean') return err('INVALID_CHOICE', 'subdue must be a boolean.');
    return null;
  }
  if (cmd.type === 'PICK_PART') {
    const k = s.pendingPick;
    if (!k) return err('WRONG_PHASE', 'There are no drawn parts to pick from.');
    if (typeof cmd.partId !== 'string' || !k.parts.some((x) => x.id === cmd.partId)) return err('INVALID_TARGET', `Part ${cmd.partId} was not drawn.`);
    return null;
  }
  if (s.pendingPick) return err('PICK_PENDING', 'Pick one of the drawn parts first.');
  if (s.phase !== 'day' && s.phase !== 'night') return err('WRONG_PHASE', 'Workers can only be placed by day or night.');
  if (cmd.type === 'PASS_TURN') return null;

  if (typeof cmd.workerId !== 'string') return err('INVALID_COMMAND', 'workerId must be a string.');
  if (typeof cmd.actionId !== 'string' || !s.config.actions[cmd.actionId]) return err('UNKNOWN_ACTION', `Unknown action ${cmd.actionId}.`);
  const w = s.workers[cmd.workerId];
  const pe = placementError(s, p, w, cmd.actionId);
  if (pe) return pe;
  const h = HANDLERS[cmd.actionId];
  const choices = cmd.choices === undefined ? {} : cmd.choices;
  if (!isPlainObject(choices)) return err('INVALID_CHOICE', 'choices must be an object.');
  for (const k of Object.keys(choices)) if (!h.choiceKeys.includes(k) && !(h.optionalChoiceKeys || []).includes(k)) return err('UNKNOWN_FIELD', `Unknown choice ${k} for ${cmd.actionId}.`);
  for (const k of h.choiceKeys) if (choices[k] === undefined) return err('MISSING_CHOICE', `Missing choice ${k} for ${cmd.actionId}.`);
  if (h.checkChoices) return h.checkChoices(s, p, w, s.config.actions[cmd.actionId], choices);
  return null;
}

function applyCommand(s, cmd) {
  const p = getPlayer(s, cmd.playerId);
  if (cmd.type === 'PASS_TURN') {
    p.passed = true;
    emit(s, 'TURN_PASSED', { playerId: p.id });
    s.turnPointer = (p.seat + 1) % s.players.length;
  } else if (cmd.type === 'PLACE_MEEPLE') {
    const w = s.workers[cmd.workerId];
    const def = s.config.actions[cmd.actionId];
    const choices = cmd.choices || {};
    const occ = s.occupancy[s.phase];
    (occ[cmd.actionId] = occ[cmd.actionId] || []).push(w.id);
    if (w.kind === 'scientist') { if (s.phase === 'day') w.usedDay = true; else w.usedNight = true; }
    else w.usedThisRound = true;
    emit(s, 'WORKER_PLACED', { playerId: p.id, workerId: w.id, workerKind: w.kind, actionId: cmd.actionId, location: def.location, choices: clone(choices) });
    HANDLERS[cmd.actionId].apply(s, p, w, def, choices);
    s.turnPointer = (p.seat + 1) % s.players.length;
  } else if (cmd.type === 'PICK_PART') {
    // Keep one specimen; the rest go to the discard pile.
    const k = s.pendingPick;
    s.pendingPick = null;
    const kept = k.parts.find((x) => x.id === cmd.partId);
    p.hand.push(kept);
    emit(s, 'PARTS_GAINED', { playerId: p.id, source: 'specimens', parts: [clone(kept)] });
    const rest = k.parts.filter((x) => x.id !== cmd.partId);
    if (rest.length) discardParts(s, p, rest, 'specimens');
  } else if (cmd.type === 'SUBDUE_MONSTER') {
    if (cmd.subdue) attemptControl(s, p.id);
    else declineSubdue(s, p.id);
  }
}

/**
 * Submit a command. Returns { ok, state, events, error? }.
 * Rejected commands return the original state object untouched.
 */
export function dispatch(state, command) {
  const e = validateCommand(state, command);
  if (e) return { ok: false, state, events: [], error: e };
  // Events, the command log and the other logs are append-only and their
  // entries never change, and the configuration is frozen: share them
  // structurally (new arrays, same entries) instead of copying them on every
  // command, which made a game quadratic in its length.
  const { events, config, commandLog, suspicionHistory, resurrections, ...rest } = state;
  const copied = clone(rest);
  const shared = {
    config, events: events.slice(), commandLog: commandLog.slice(), suspicionHistory: suspicionHistory.slice(),
    resurrections: resurrections.slice(),
  };
  // Keep the key order earlier versions produced (every key in place, events
  // last): saves are verified by comparing serialized text.
  const s = {};
  for (const k of Object.keys(state)) if (k !== 'events') s[k] = k in shared ? shared[k] : copied[k];
  s.events = shared.events;
  const start = s.events.length;
  const recorded = clone(command);
  delete recorded.seq;
  s.commandLog.push(recorded);
  applyCommand(s, command);
  advance(s);
  return { ok: true, state: s, events: s.events.slice(start) };
}

// ---------------------------------------------------------------------------
// Legal command discovery
// ---------------------------------------------------------------------------

/**
 * Legal commands for a player. Entries without `choiceConstraints` are
 * complete commands. Entries with `choiceConstraints` describe the choices
 * still to be filled in (see README for the constraint schema).
 */
export function getLegalCommands(s, pid) {
  if (s.result || s.activePlayerId !== pid) return [];
  if (s.phase === 'resolution') {
    return [
      { type: 'SUBDUE_MONSTER', playerId: pid, subdue: true },
      { type: 'SUBDUE_MONSTER', playerId: pid, subdue: false },
    ];
  }
  const p = getPlayer(s, pid);
  if (s.pendingPick) {
    return s.pendingPick.parts.map((x) => ({ type: 'PICK_PART', playerId: pid, partId: x.id }));
  }
  const out = [{ type: 'PASS_TURN', playerId: pid }];
  for (const w of playerWorkers(s, pid)) {
    if (!workerAvailable(s, w)) continue;
    for (const actionId of Object.keys(s.config.actions)) {
      if (placementError(s, p, w, actionId)) continue;
      const h = HANDLERS[actionId];
      const entry = { type: 'PLACE_MEEPLE', playerId: pid, workerId: w.id, actionId };
      if (h.constraints) {
        const c = h.constraints(s, p, w, s.config.actions[actionId]);
        if (Object.keys(c).length) entry.choiceConstraints = c;
      }
      out.push(entry);
    }
  }
  return out;
}

function combinations(arr, k, start = 0, prefix = [], out = []) {
  if (prefix.length === k) { out.push([...prefix]); return out; }
  for (let i = start; i < arr.length; i++) {
    prefix.push(arr[i]);
    combinations(arr, k, i + 1, prefix, out);
    prefix.pop();
  }
  return out;
}

/**
 * Fully expanded legal commands. By default, equivalent workers (e.g. two
 * unused Igors) and part selections with identical variants are collapsed
 * to one representative to keep the list small.
 */
export function enumerateLegalCommands(s, pid, { dedupe = true } = {}) {
  const templates = getLegalCommands(s, pid);
  const out = [];
  const seenWorkerKinds = new Set();
  const p = getPlayer(s, pid);
  for (const t of templates) {
    if (t.type === 'PICK_PART' && dedupe) {
      // Drawn parts of the same variant are interchangeable.
      const v = s.pendingPick.parts.find((x) => x.id === t.partId).variantId;
      if (out.some((o) => o.type === 'PICK_PART' && s.pendingPick.parts.find((x) => x.id === o.partId).variantId === v)) continue;
    }
    if (t.type !== 'PLACE_MEEPLE') { out.push(t); continue; }
    if (dedupe) {
      const kind = s.workers[t.workerId].kind;
      const key = `${kind}:${t.actionId}`;
      if (kind !== 'scientist' && seenWorkerKinds.has(key)) continue;
      seenWorkerKinds.add(key);
    }
    const base = { type: t.type, playerId: t.playerId, workerId: t.workerId, actionId: t.actionId };
    const c = t.choiceConstraints;
    if (!c) { out.push({ ...base, choices: {} }); continue; }
    for (const choices of expandChoices(s, p, t.actionId, c, dedupe)) out.push({ ...base, choices });
  }
  return out;
}

/** Groups of a player's parts in hand: one group per variant when deduplicating, else one per part. */
function handGroups(p, values, dedupe) {
  const groups = [];
  const byKey = new Map();
  for (const id of values) {
    const part = p.hand.find((x) => x.id === id);
    const key = dedupe ? part.variantId : id;
    let g = byKey.get(key);
    if (!g) { g = { type: part.type, variantId: part.variantId, ids: [] }; byKey.set(key, g); groups.push(g); }
    g.ids.push(id);
  }
  return groups;
}

/**
 * Part selections of exactly `size` parts that differ in their variants (or,
 * without dedupe, in their instances), built by choosing how many of each
 * group to take. `perType` optionally fixes the number of each type.
 */
function partSelections(p, values, size, dedupe, perType = null) {
  const groups = handGroups(p, values, dedupe);
  const out = [];
  const used = {};
  const rec = (gi, picked) => {
    if (picked.length === size) {
      if (!perType || Object.entries(perType).every(([t, n]) => (used[t] || 0) === n)) out.push([...picked]);
      return;
    }
    if (gi === groups.length) return;
    const g = groups[gi];
    const typeLeft = perType ? (perType[g.type] || 0) - (used[g.type] || 0) : Infinity;
    const most = Math.min(g.ids.length, size - picked.length, typeLeft);
    for (let n = most; n >= 0; n--) {
      used[g.type] = (used[g.type] || 0) + n;
      rec(gi + 1, [...picked, ...g.ids.slice(0, n)]);
      used[g.type] -= n;
    }
  };
  rec(0, []);
  return out;
}

function expandChoices(s, p, actionId, c, dedupe) {
  const out = [];
  if (actionId === 'research') {
    for (const id of c.researchCardId.values) out.push({ researchCardId: id });
  } else if (actionId === 'charity') {
    for (const units of c.units.values) out.push({ units });
  } else if (actionId === 'sell' || actionId === 'experiment') {
    for (const ids of partSelections(p, c.partIds.values, c.partIds.min, dedupe)) out.push({ partIds: ids });
  } else if (actionId === 'prepare') {
    const k = c.partIds;
    for (const ids of partSelections(p, k.values, k.min, dedupe, k.perPartType)) {
      const vitality = ids.reduce((a, id) => a + partVitality(s.config, p.hand.find((x) => x.id === id).variantId), 0) + k.vitalityBonus;
      if (vitality >= k.minVitality) out.push({ partIds: ids });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------

function eventVisibleTo(e, pid) {
  return e.visibility === 'public' || (pid != null && Array.isArray(e.visibility) && e.visibility.includes(pid));
}

/** Filters an event list to what a player (or the public, pid = null) may see. */
export function filterEvents(events, pid = null) {
  return events.filter((e) => eventVisibleTo(e, pid));
}

function publicPlayer(s, p) {
  const counts = {};
  for (const c of p.science) counts[c.type] = (counts[c.type] || 0) + 1;
  return {
    id: p.id, name: p.name, seat: p.seat, money: p.money,
    hand: clone(p.hand), body: clone(p.body), bodyComplete: bodyComplete(p),
    science: clone(p.science), scienceCounts: counts, igorsHired: p.igorsHired,
    nextIgorCost: igorCount(s, p) < s.config.maxIgors ? nextIgorCost(s) : null,
    passed: p.passed,
    vitalityBonus: vitalityBonus(s, p.id),
    bestVitality: bestVitality(s, p.id),
    controlChance: estimateControl(s, p.id),
    garrisoned: garrisoned(s, p.id),
    subdueOwn: hasAbility(s, p.id, 'subdueOwn'),
    resurrectionOdds: estimateResurrection(s, p.id),
    workers: playerWorkers(s, p.id).map((w) => ({ ...clone(w), availableNow: (s.phase === 'day' || s.phase === 'night') ? workerAvailable(s, w) : false })),
  };
}

/** Shared information only. */
export function getPublicView(s, { includeEvents = true } = {}) {
  const view = {
    engineVersion: s.engineVersion,
    round: s.round,
    phase: s.phase,
    activePlayerId: s.activePlayerId,
    firstPlayerId: s.players[s.firstPlayerIndex].id,
    initiative: initiativeOrder(s),
    suspicion: s.suspicion,
    suspicionMax: s.config.suspicionMax,
    // Log entries are frozen when recorded, so views share them.
    suspicionHistory: s.suspicionHistory.slice(),
    market: clone(s.market),
    deckCount: s.deck.length,
    partsDeckCount: s.partsDeck.length,
    partsDiscard: clone(s.partsDiscard),
    occupancy: clone(s.occupancy),
    players: s.players.map((p) => publicPlayer(s, p)),
    creatures: s.creatureOrder.map((id) => clone(s.creatures[id])),
    stableTransitions: [...s.stableTransitions],
    capacities: Object.fromEntries(Object.keys(s.config.actions).map((id) => [id, capacityFor(s.config, id)])),
    prepared: (s.occupancy.night.prepare || []).map((wid) => s.workers[wid].ownerId),
    restedBy: s.restedBy,
    resolution: s.resolution ? { order: [...s.resolution.order], resolved: s.resolution.resolved } : null,
    pendingPick: s.pendingPick ? clone(s.pendingPick) : null,
    control: s.control ? {
      creatorId: s.control.creatorId, creatureId: s.control.creatureId, chain: [...s.control.chain], position: s.control.position,
      deciderId: s.control.chain[s.control.position] || null, decisions: clone(s.control.record.controlDecisions),
      // Players after the current decider who could still subdue this monster.
      upcoming: s.control.chain.slice(s.control.position + 1).filter((pid) => canSubdue(s, pid, s.control.creatorId)),
    } : null,
    resurrections: s.resurrections.slice(),
    commandCount: s.commandLog.length,
    result: s.result ? clone(s.result) : null,
    config: s.config, // frozen: shared, not copied
  };
  if (includeEvents) view.events = clone(filterEvents(s.events, null));
  return view;
}

/** Observation for one player: public info plus their own secrets. */
export function getPlayerView(s, pid, { includeEvents = true } = {}) {
  const p = getPlayer(s, pid);
  if (!p) throw new Error(`Unknown player ${pid}`);
  const view = getPublicView(s, { includeEvents: false });
  view.viewerId = pid;
  view.private = { objective: s.objectives[pid] };
  view.legalCommands = getLegalCommands(s, pid);
  if (includeEvents) view.events = clone(filterEvents(s.events, pid));
  return view;
}

// ---------------------------------------------------------------------------
// Serialization and replay
// ---------------------------------------------------------------------------

export function serialize(state) {
  return JSON.stringify(state);
}

/** Replays a recorded game. Throws if any command is rejected. */
export function replay({ config = {}, seed, commands = [] }) {
  let s = createGame(config, seed);
  commands.forEach((cmd, i) => {
    const r = dispatch(s, cmd);
    if (!r.ok) throw new Error(`Replay failed at command ${i}: ${r.error.code} ${r.error.message}`);
    s = r.state;
  });
  return s;
}

export function getReplayRecord(s) {
  return { engineVersion: s.engineVersion, config: clone(s.configOverrides), seed: s.seed, commands: clone(s.commandLog) };
}

/**
 * Parses and validates a serialized state. With verifyReplay (default),
 * the state is rebuilt from its seed and command log and must match exactly.
 */
export function deserialize(json, { verifyReplay = true } = {}) {
  let s;
  try { s = typeof json === 'string' ? JSON.parse(json) : clone(json); } catch (e) { throw new Error(`Invalid JSON: ${e.message}`); }
  if (!isPlainObject(s) || s.format !== 'molg-state') throw new Error('Not a Monsters of Loving Grace game state.');
  if (s.schemaVersion !== SCHEMA_VERSION) throw new Error(`Unsupported schema version ${s.schemaVersion} (expected ${SCHEMA_VERSION}).`);
  if (!isRngState(s.rng)) throw new Error('Invalid RNG state.');
  if (!PHASES.includes(s.phase)) throw new Error(`Invalid phase ${s.phase}.`);
  if (!Array.isArray(s.players) || !Array.isArray(s.commandLog) || !Array.isArray(s.events)) throw new Error('Malformed state.');
  if (typeof s.seed !== 'string') throw new Error('Missing seed.');
  if (verifyReplay) {
    let rebuilt;
    // Replay with the save's own resolved rules, so saves survive later
    // changes to the default configuration.
    try { rebuilt = replay({ config: s.config, seed: s.seed, commands: s.commandLog }); } catch (e) { throw new Error(`Save failed replay verification: ${e.message}`); }
    rebuilt.configOverrides = clone(s.configOverrides);
    if (serialize(rebuilt) !== serialize(s)) throw new Error('Save failed replay verification: state does not match its command history.');
  }
  deepFreeze(s.config);
  for (const log of [s.suspicionHistory, s.resurrections]) for (const x of log || []) deepFreeze(x);
  return s;
}
