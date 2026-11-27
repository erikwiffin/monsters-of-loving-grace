// Monsters of Loving Grace — headless rules engine.
// Pure JavaScript ES module: no DOM, storage, timers, network or unseeded randomness.
// All gameplay state changes go through dispatch(state, command).

import {
  ENGINE_VERSION, SCHEMA_VERSION, SLOT_ORDER, ATTRIBUTES, ALLOWED_DICE, PHASES, DEFAULT_CONFIG,
} from './data.js';
import { seedState, randInt, rollDie, shuffle, isRngState } from './rng.js';

export { ENGINE_VERSION, SCHEMA_VERSION };

const clone = typeof structuredClone === 'function'
  ? (x) => structuredClone(x)
  : (x) => JSON.parse(JSON.stringify(x));

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

function validateConfig(cfg) {
  const n = cfg.playerCount;
  if (!Number.isInteger(n) || n < 3 || n > 6) throw new Error('playerCount must be an integer from 3 to 6');
  if (!Number.isInteger(cfg.suspicionMax) || cfg.suspicionMax < 1) throw new Error('suspicionMax must be a positive integer');
  if (!Number.isInteger(cfg.startingIgors) || cfg.startingIgors < 0 || cfg.startingIgors > cfg.maxIgors) throw new Error('startingIgors must be an integer from 0 to maxIgors');
  for (const attr of ATTRIBUTES) {
    if (!Number.isInteger(cfg.resurrection.thresholds[attr])) throw new Error(`resurrection threshold for ${attr} must be an integer`);
  }
  for (const k of ['failedVitalitySuspicion']) {
    if (!Number.isInteger(cfg.resurrection[k]) || cfg.resurrection[k] < 0) throw new Error(`resurrection.${k} must be a non-negative integer`);
  }
  if (!ALLOWED_DICE.includes(cfg.control.baseDie)) throw new Error('control.baseDie must be a supported die');
  if (!Number.isInteger(cfg.control.threshold)) throw new Error('control.threshold must be an integer');
  for (const k of ['startingAttempts', 'declineSuspicion', 'subdueSuspicion', 'subdueSalvage']) {
    if (!Number.isInteger(cfg.control[k]) || cfg.control[k] < 0) throw new Error(`control.${k} must be a non-negative integer`);
  }
  for (const [id, v] of Object.entries(cfg.partVariants)) {
    if (!cfg.partTypes[v.type]) throw new Error(`part variant ${id} has unknown type ${v.type}`);
    for (const e of v.effects) validateEffect(e, `part variant ${id}`);
  }
  for (const t of Object.keys(cfg.partTypes)) {
    if (!Object.values(cfg.partVariants).some((v) => v.type === t)) throw new Error(`part type ${t} has no variants`);
  }
  for (const [id, r] of Object.entries(cfg.research)) {
    if (r.copies !== undefined && (!Number.isInteger(r.copies) || r.copies < 0)) throw new Error(`research ${id}: copies must be a non-negative integer`);
    if (r.stacks !== undefined && typeof r.stacks !== 'boolean') throw new Error(`research ${id}: stacks must be a boolean`);
    for (const e of r.effects) {
      if (!RESEARCH_KINDS.has(e.kind)) throw new Error(`research ${id}: unknown effect kind ${e.kind}`);
      if (e.kind === 'resurrection') validateEffect(e, `research ${id}`);
      if (e.kind === 'control') validateEffect({ ...e, attribute: ATTRIBUTES[0] }, `research ${id}`);
      if (e.per !== undefined && !RESEARCH_MULTIPLIERS.has(e.per)) throw new Error(`research ${id}: unknown multiplier ${e.per}`);
      if (e.kind === 'reroll' && !ATTRIBUTES.includes(e.attribute)) throw new Error(`research ${id}: reroll needs an attribute`);
      if (e.amount !== undefined && !Number.isInteger(e.amount)) throw new Error(`research ${id}: amount must be an integer`);
      if (e.beyond !== undefined && (!Number.isInteger(e.beyond) || e.beyond < 0)) throw new Error(`research ${id}: beyond must be a non-negative integer`);
    }
  }
  for (const [id, a] of Object.entries(cfg.actions)) {
    if (!HANDLERS[id]) throw new Error(`action ${id} has no rules handler`);
    if (a.phase !== 'day' && a.phase !== 'night') throw new Error(`action ${id} has invalid phase`);
    validateCapacity(a.capacity, id);
    if (a.suspicion !== undefined) validateSuspicionRoll(a.suspicion, id);
    for (const k of HANDLERS[id].numbers || []) {
      if (!Number.isInteger(a[k]) || a[k] < 0) throw new Error(`action ${id}: ${k} must be a non-negative integer`);
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

// Research effect kinds (spec 023). Numeric kinds add `amount` per effective
// copy; 'resurrection' and 'control' add dice or modifiers; 'reroll' and
// 'noGarrison' are abilities.
const RESEARCH_KINDS = new Set([
  'medicineBonus', 'suspicionReduction', 'controlAttempts', 'control', 'resurrection',
  'ferocity', 'gravesBonus', 'sellBonus', 'charityBonus', 'researchCalm', 'reroll', 'noGarrison',
  'specimenDiscount', 'quietFailure', 'pursuit', 'discoveryBoost',
]);
// Resurrection effects may apply once per qualifying rival instead of once.
// Ferocity may apply once per rival able to subdue the monster ('rivalHunters').
const RESEARCH_MULTIPLIERS = new Set(['rivalPrepared', 'rivalHunters']);

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

function validateSuspicionRoll(r, id) {
  if (!isPlainObject(r) || !ALLOWED_DICE.includes(r.die)) throw new Error(`action ${id}: suspicion.die must be a supported die`);
  if (!Array.isArray(r.bands)) throw new Error(`action ${id}: suspicion.bands must be an array`);
  let prev = 0;
  for (const b of r.bands) {
    if (!isPlainObject(b) || !Number.isInteger(b.max) || b.max <= prev || b.max > r.die) throw new Error(`action ${id}: suspicion band maxima must rise from 1 to the die size`);
    if (!Number.isInteger(b.amount) || b.amount < 0) throw new Error(`action ${id}: suspicion band amounts must be non-negative integers`);
    prev = b.max;
  }
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

function validateEffect(e, where) {
  if (!ATTRIBUTES.includes(e.attribute)) throw new Error(`${where}: unknown attribute ${e.attribute}`);
  if (e.op === 'die') {
    if (!ALLOWED_DICE.includes(e.die)) throw new Error(`${where}: unsupported die d${e.die}`);
    if (e.sign !== 1 && e.sign !== -1) throw new Error(`${where}: die sign must be 1 or -1`);
  } else if (e.op === 'fixed' || e.op === 'threshold') {
    if (!Number.isInteger(e.amount)) throw new Error(`${where}: amount must be an integer`);
  } else {
    throw new Error(`${where}: unknown op ${e.op}`);
  }
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

export function bodyComplete(p) {
  return SLOT_ORDER.every((slot) => p.body[slot] !== null);
}

function openSlotsByType(s, p) {
  const out = {};
  for (const [type, def] of Object.entries(s.config.partTypes)) {
    out[type] = def.slots.filter((slot) => p.body[slot] === null).length;
  }
  return out;
}

/** Initiative order (player ids) starting with this round's first player. */
export function initiativeOrder(s) {
  const n = s.players.length;
  const out = [];
  for (let i = 0; i < n; i++) out.push(s.players[(s.firstPlayerIndex + i) % n].id);
  return out;
}

/**
 * Number of effective copies of a research type for a player:
 * 1 for a personal discovery, plus 1 for each publication of that type by
 * another player. (Ruling: research copies stack.)
 */
export function researchCount(s, pid, type) {
  const p = getPlayer(s, pid);
  let n = p && p.research.includes(type) ? 1 : 0;
  for (const pub of s.publications) if (pub.type === type && pub.playerId !== pid) n++;
  return n;
}

/**
 * Copies of a type whose effects apply: every copy for a stacking modifier,
 * at most one for a special ability (`stacks: false`).
 */
export function effectiveCopies(s, pid, type) {
  const n = researchCount(s, pid, type);
  return s.config.research[type].stacks === false ? Math.min(1, n) : n;
}

/** Whether a player holds any effective research with an effect of this kind. */
function hasAbility(s, pid, kind) {
  return researchBonus(s, pid, kind, 1) > 0;
}

function researchBonus(s, pid, kind, dflt = 0) {
  let total = 0;
  for (const [type, def] of Object.entries(s.config.research)) {
    const copies = effectiveCopies(s, pid, type);
    if (!copies) continue;
    for (const e of def.effects) if (e.kind === kind) total += copies * (e.amount ?? dflt);
  }
  return total;
}

/** Most parts one assemble action may install: the configured max, or a whole body when it is null. */
export function assembleCapacity(s) {
  const max = s.config.actions.assemble.max;
  return max == null ? SLOT_ORDER.length : max;
}

/** Control attempts a player has left: the starting allowance, plus one per effective Neural Conditioning, minus those spent. */
export function controlAttempts(s, pid) {
  const p = getPlayer(s, pid);
  if (!p) return 0;
  return Math.max(0, s.config.control.startingAttempts + researchBonus(s, pid, 'controlAttempts') - p.controlAttemptsUsed);
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

function eligibleMarketCards(s, p) {
  return s.market.filter((c) => !p.research.includes(c.type));
}

function igorCount(s, p) {
  return playerWorkers(s, p.id).filter((w) => w.kind === 'igor').length;
}

function nextIgorCost(s) {
  return s.config.actions.hire ? s.config.actions.hire.cost : null;
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
  s.suspicionHistory.push({ eventSeq: s.events.length + 1, round: s.round, phase: s.phase, value: after, delta: after - before, reason, playerId });
  emit(s, 'SUSPICION_CHANGED', { playerId, requested: delta, delta: after - before, value: after, max, reason });
  if (delta > 0 && after >= max) onMob(s);
}

function makePart(s, variantId) {
  const v = s.config.partVariants[variantId];
  s.counters.part += 1;
  return { id: `part-${s.counters.part}`, variantId, type: v.type };
}

function drawRandomPart(s) {
  const types = Object.entries(s.config.partTypes);
  const totalWeight = types.reduce((a, [, t]) => a + t.weight, 0);
  let r = randInt(s.rng, totalWeight);
  let chosen = types[0][0];
  for (const [id, t] of types) {
    if (r < t.weight) { chosen = id; break; }
    r -= t.weight;
  }
  return drawPartOfType(s, chosen);
}

// A uniformly random variant of the given part type (graves and specimens).
function drawPartOfType(s, type) {
  const variants = Object.keys(s.config.partVariants).filter((id) => s.config.partVariants[id].type === type);
  return makePart(s, variants[randInt(s.rng, variants.length)]);
}

function gainResearch(s, p, card, via) {
  p.research.push(card.type);
  p.research.sort();
  emit(s, 'RESEARCH_ACQUIRED', { playerId: p.id, cardId: card.id, researchType: card.type, via });
}

function publish(s, p, type) {
  p.published.push(type);
  p.published.sort();
  s.publications.push({ playerId: p.id, type, round: s.round });
  emit(s, 'RESEARCH_PUBLISHED', { playerId: p.id, researchType: type });
}

function acquireMarketResearch(s, p, cardId, via) {
  const idx = s.market.findIndex((c) => c.id === cardId);
  const [card] = s.market.splice(idx, 1);
  gainResearch(s, p, card, via);
  if (s.deck.length > 0) {
    const next = s.deck.shift();
    s.market.push(next);
    emit(s, 'MARKET_REFILLED', { cardId: next.id, researchType: next.type, deckRemaining: s.deck.length });
  } else {
    emit(s, 'MARKET_DECK_EMPTY', { marketSize: s.market.length });
  }
}

function addWorker(s, w) {
  s.workers[w.id] = { usedDay: false, usedNight: false, usedThisRound: false, ...w };
  s.workerOrder.push(w.id);
}

// ---------------------------------------------------------------------------
// Action handlers
// prereq(s, p, w, def)       -> error | null  (ignoring choices)
// choiceKeys                 -> required choice keys (all required, no extras)
// checkChoices(s,p,w,def,c)  -> error | null
// constraints(s,p,w,def)     -> machine-readable choice constraints
// apply(s,p,w,def,c)         -> mutates state
// ---------------------------------------------------------------------------

function specimenCost(s, p, def) {
  return Math.max(0, def.cost - researchBonus(s, p.id, 'specimenDiscount'));
}

function needMoney(p, amount) {
  return p.money < amount ? err('INSUFFICIENT_MONEY', `Requires ${amount} money; you have ${p.money}.`) : null;
}

function checkMarketCard(s, p, cardId) {
  if (typeof cardId !== 'string') return err('INVALID_CHOICE', 'researchCardId must be a string.');
  const card = s.market.find((c) => c.id === cardId);
  if (!card) return err('INVALID_TARGET', `Card ${cardId} is not in the market.`);
  if (p.research.includes(card.type)) return err('ALREADY_DISCOVERED', `You already discovered ${card.type}.`);
  return null;
}

function checkLooseParts(p, partIds, min, max) {
  if (!Array.isArray(partIds)) return err('INVALID_CHOICE', 'partIds must be an array.');
  if (partIds.length < min || partIds.length > max) return err('INVALID_CHOICE', `Select ${min === max ? min : `${min}–${max}`} parts.`);
  if (new Set(partIds).size !== partIds.length) return err('INVALID_CHOICE', 'partIds must be unique.');
  for (const id of partIds) {
    if (!p.loose.some((x) => x.id === id)) return err('INVALID_TARGET', `Part ${id} is not in your loose inventory.`);
  }
  return null;
}

/**
 * The discovery roll for an action with a `suspicion` table: roll the die, take
 * the first band whose max is at least the roll, then apply Discreet Methods.
 */
function rollActionSuspicion(s, p, def, actionId) {
  const r = def.suspicion;
  const roll = rollDie(s.rng, r.die);
  const band = r.bands.find((b) => roll <= b.max);
  const base = band ? band.amount : 0;
  const reduction = researchBonus(s, p.id, 'suspicionReduction');
  // Inflammatory research makes a discovery that is noticed worse.
  const boost = base > 0 ? researchBonus(s, p.id, 'discoveryBoost') : 0;
  const increase = Math.max(0, base + boost - reduction);
  emit(s, 'DIE_ROLLED', { playerId: p.id, purpose: 'discovery', actionId, die: r.die, result: roll });
  emit(s, 'DISCOVERY_RESOLVED', { playerId: p.id, actionId, die: r.die, roll, baseSuspicion: base, reduction, increase });
  if (increase > 0) changeSuspicion(s, increase, actionId, p.id);
}

function installedParts(p) {
  return SLOT_ORDER.filter((slot) => p.body[slot] !== null).map((slot) => p.body[slot]);
}

/** Most charity units a player may buy now: the configured maximum, what they can afford, and no more than it takes to reach 0. */
function charityMaxUnits(s, p, def) {
  let max = def.maxUnits;
  if (def.cost > 0) max = Math.min(max, Math.floor(p.money / def.cost));
  if (def.reduction > 0) max = Math.min(max, Math.ceil(s.suspicion / def.reduction));
  return Math.max(1, max);
}

/** Most installed parts an experiment may discard right now (0 if it can't be taken). */
function experimentMax(s, p, def) {
  return Math.min(def.maxParts, p.loose.length + installedParts(p).length, s.deck.length);
}

export const HANDLERS = {
  medicine: {
    choiceKeys: [],
    numbers: ['gain'],
    prereq: () => null,
    apply(s, p, w, def) {
      changeMoney(s, p, def.gain + researchBonus(s, p.id, 'medicineBonus'), 'medicine');
    },
  },
  research: {
    choiceKeys: ['researchCardId'],
    prereq(s, p, w, def) {
      return needMoney(p, def.cost) || (eligibleMarketCards(s, p).length ? null : err('NO_ELIGIBLE_RESEARCH', 'No eligible research card in the market.'));
    },
    checkChoices: (s, p, w, def, c) => checkMarketCard(s, p, c.researchCardId),
    constraints: (s, p) => ({ researchCardId: { type: 'enum', values: eligibleMarketCards(s, p).map((c) => c.id) } }),
    numbers: ['cost'],
    apply(s, p, w, def, c) {
      changeMoney(s, p, -def.cost, 'research');
      const type = s.market.find((k) => k.id === c.researchCardId).type;
      acquireMarketResearch(s, p, c.researchCardId, 'research');
      // Conducting research always publishes the discovery (spec 023).
      publish(s, p, type);
      const calm = researchBonus(s, p.id, 'researchCalm');
      if (calm > 0 && s.suspicion > 0) changeSuspicion(s, -calm, 'public_lecture', p.id);
    },
  },
  specimens: {
    choiceKeys: ['partTypes'],
    numbers: ['cost'],
    positive: ['count'],
    prereq: (s, p, w, def) => needMoney(p, specimenCost(s, p, def)),
    checkChoices(s, p, w, def, c) {
      const v = c.partTypes;
      if (!Array.isArray(v) || v.length !== def.count) return err('INVALID_CHOICE', `partTypes must list exactly ${def.count} part types.`);
      for (const t of v) if (typeof t !== 'string' || !Object.hasOwn(s.config.partTypes, t)) return err('INVALID_TARGET', `Unknown part type ${t}.`);
      return null;
    },
    constraints: (s, p, w, def) => ({ partTypes: { type: 'multiset', count: def.count, values: Object.keys(s.config.partTypes) } }),
    apply(s, p, w, def, c) {
      const cost = specimenCost(s, p, def);
      if (cost) changeMoney(s, p, -cost, 'specimens');
      // The player chooses the type; the variant is random (spec 024).
      const parts = c.partTypes.map((t) => drawPartOfType(s, t));
      p.loose.push(...parts);
      emit(s, 'PARTS_GAINED', { playerId: p.id, source: 'specimens', parts: clone(parts) });
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
      changeSuspicion(s, -(def.reduction + researchBonus(s, p.id, 'charityBonus')) * units, 'charity', p.id);
    },
  },
  garrison: {
    // No effect of its own: a garrisoned worker lets its owner subdue other
    // players' monsters during this round's resolution (spec 025).
    choiceKeys: [],
    prereq: () => null,
    apply() {},
  },
  graves: {
    choiceKeys: [],
    numbers: ['parts'],
    prereq: () => null,
    apply(s, p, w, def) {
      // The random parts are drawn first, then the discovery die is rolled.
      const parts = [];
      const n = def.parts + researchBonus(s, p.id, 'gravesBonus');
      for (let i = 0; i < n; i++) parts.push(drawRandomPart(s));
      p.loose.push(...parts);
      emit(s, 'PARTS_GAINED', { playerId: p.id, source: 'graves', parts: clone(parts) });
      rollActionSuspicion(s, p, def, 'graves');
    },
  },
  sell: {
    choiceKeys: ['partIds'],
    numbers: ['gain'],
    positive: ['parts'],
    prereq: (s, p, w, def) => (p.loose.length < def.parts ? err('INSUFFICIENT_PARTS', `Requires ${def.parts} loose parts.`) : null),
    checkChoices: (s, p, w, def, c) => checkLooseParts(p, c.partIds, def.parts, def.parts),
    constraints: (s, p, w, def) => ({ partIds: { type: 'subset', min: def.parts, max: def.parts, values: p.loose.map((x) => x.id) } }),
    apply(s, p, w, def, c) {
      const sold = c.partIds.map((id) => p.loose.splice(p.loose.findIndex((x) => x.id === id), 1)[0]);
      emit(s, 'PARTS_SPENT', { playerId: p.id, reason: 'sell', parts: clone(sold) });
      changeMoney(s, p, def.gain + researchBonus(s, p.id, 'sellBonus'), 'sell');
      rollActionSuspicion(s, p, def, 'sell');
    },
  },
  prepare: {
    // Placing the Scientist here commits the player to a resurrection attempt
    // in this round's resolution, if the body is complete by then (spec 025).
    choiceKeys: [],
    prereq: () => null,
    apply(s, p) {
      emit(s, 'RESURRECTION_PREPARED', { playerId: p.id, bodyComplete: bodyComplete(p) });
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
  assemble: {
    choiceKeys: ['partIds'],
    prereq(s, p) {
      const open = openSlotsByType(s, p);
      return p.loose.some((x) => open[x.type] > 0) ? null : err('NOTHING_TO_ASSEMBLE', 'No loose part fits an empty body slot.');
    },
    checkChoices(s, p, w, def, c) {
      const e = checkLooseParts(p, c.partIds, 1, assembleCapacity(s, p.id));
      if (e) return e;
      const open = openSlotsByType(s, p);
      for (const id of c.partIds) {
        const part = p.loose.find((x) => x.id === id);
        if (!(open[part.type] > 0)) return err('NO_MATCHING_SLOT', `No empty ${part.type} slot for ${id}.`);
        open[part.type] -= 1;
      }
      return null;
    },
    constraints(s, p) {
      const open = openSlotsByType(s, p);
      return {
        partIds: {
          type: 'subset', min: 1, max: assembleCapacity(s, p.id),
          values: p.loose.filter((x) => open[x.type] > 0).map((x) => x.id),
          maxPerPartType: open,
        },
      };
    },
    apply(s, p, w, def, c) {
      const installs = [];
      for (const id of c.partIds) {
        const idx = p.loose.findIndex((x) => x.id === id);
        const [part] = p.loose.splice(idx, 1);
        const slot = s.config.partTypes[part.type].slots.find((sl) => p.body[sl] === null);
        p.body[slot] = part;
        installs.push({ partId: part.id, variantId: part.variantId, slot });
      }
      emit(s, 'PARTS_INSTALLED', { playerId: p.id, installs, bodyComplete: bodyComplete(p) });
    },
  },
  experiment: {
    // Discard loose or installed parts, draw that many research cards from the
    // deck, roll for discovery, then keep one eligible card (PICK_RESEARCH).
    choiceKeys: ['partIds'],
    positive: ['maxParts'],
    prereq(s, p) {
      if (!p.loose.length && !installedParts(p).length) return err('INSUFFICIENT_PARTS', 'Requires at least one part.');
      return s.deck.length ? null : err('DECK_EMPTY', 'The research deck is empty.');
    },
    checkChoices(s, p, w, def, c) {
      const ids = c.partIds;
      const max = experimentMax(s, p, def);
      if (!Array.isArray(ids)) return err('INVALID_CHOICE', 'partIds must be an array.');
      if (ids.length < 1 || ids.length > max) return err('INVALID_CHOICE', `Select 1–${max} parts.`);
      if (new Set(ids).size !== ids.length) return err('INVALID_CHOICE', 'partIds must be unique.');
      const owned = [...p.loose, ...installedParts(p)];
      for (const id of ids) if (!owned.some((x) => x.id === id)) return err('INVALID_TARGET', `Part ${id} is not yours.`);
      return null;
    },
    constraints: (s, p, w, def) => ({ partIds: { type: 'subset', min: 1, max: experimentMax(s, p, def), values: [...p.loose, ...installedParts(p)].map((x) => x.id) } }),
    apply(s, p, w, def, c) {
      const spent = p.loose.filter((x) => c.partIds.includes(x.id));
      p.loose = p.loose.filter((x) => !c.partIds.includes(x.id));
      for (const slot of SLOT_ORDER) {
        const part = p.body[slot];
        if (part && c.partIds.includes(part.id)) { spent.push(part); p.body[slot] = null; }
      }
      emit(s, 'PARTS_SPENT', { playerId: p.id, reason: 'experiment', parts: clone(spent) });
      const cards = s.deck.splice(0, spent.length);
      emit(s, 'RESEARCH_DRAWN', { playerId: p.id, cards: clone(cards), deckRemaining: s.deck.length });
      const eligible = cards.filter((k) => !p.research.includes(k.type));
      if (eligible.length) s.pendingPick = { playerId: p.id, actionId: 'experiment', cards: clone(cards), eligible: eligible.map((k) => k.id) };
      else returnToDeck(s, p, cards);
      // A mob formed by this roll ends the game before the pick.
      rollActionSuspicion(s, p, def, 'experiment');
    },
  },
};

/** Cards drawn by an experiment and not kept go to the bottom of the deck, in the order drawn. */
function returnToDeck(s, p, cards) {
  s.deck.push(...cards);
  if (cards.length) emit(s, 'RESEARCH_RETURNED', { playerId: p.id, cards: clone(cards), deckRemaining: s.deck.length });
}

/** Whether a player has a worker in the garrison this round. */
export function garrisoned(s, pid) {
  return (s.occupancy.day.garrison || []).some((wid) => s.workers[wid] && s.workers[wid].ownerId === pid);
}

/** Whether a player may subdue other players' monsters this round: a garrison, or a research ability that waives it. */
export function canSubdueOthers(s, pid) {
  return garrisoned(s, pid) || hasAbility(s, pid, 'noGarrison');
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
    config: cfg,
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
    publications: [],
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
    s.players.push({ id, name: String(name), seat: i, money: cfg.startingMoney, loose: [], body: emptyBody(), research: [], published: [], igorsHired: 0, controlAttemptsUsed: 0, rerollsUsed: 0, passed: false });
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
  for (const type of Object.keys(cfg.research).sort()) {
    const copies = cfg.research[type].copies ?? cfg.researchCopies;
    for (let c = 0; c < copies; c++) s.deck.push({ id: `card-${++k}`, type });
  }
  shuffle(s.rng, s.deck);
  s.market = s.deck.splice(0, cfg.marketSize);
  s.suspicionHistory.push({ eventSeq: 0, round: 1, phase: 'setup', value: 0, delta: 0, reason: 'start', playerId: null });

  emit(s, 'GAME_STARTED', {
    engineVersion: ENGINE_VERSION,
    players: s.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat })),
    firstPlayerId: s.players[s.firstPlayerIndex].id,
    market: clone(s.market),
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

/** Pursuits a player has left: once per game per pursuit ability. */
function pursuitsLeft(s, pid) {
  const p = getPlayer(s, pid);
  let n = 0;
  for (const [type, def] of Object.entries(s.config.research)) {
    if (!effectiveCopies(s, pid, type)) continue;
    for (const e of def.effects) if (e.kind === 'pursuit') n += e.uses ?? 1;
  }
  return Math.max(0, n - (p.pursuitsUsed || 0));
}

/** Whether a player may subdue the current monster: an attempt left, and a garrisoned worker unless they created it. In a pursuit, a pursuit left instead of a garrison. */
function canSubdue(s, pid) {
  if (controlAttempts(s, pid) <= 0) return false;
  if (s.control.pursuit) return pursuitsLeft(s, pid) > 0;
  return pid === s.control.creatorId || canSubdueOthers(s, pid);
}

/** The next player in a control chain who could subdue the monster, skipping (and logging) those with no attempts left. */
function nextController(s) {
  const k = s.control;
  while (k.position < k.chain.length) {
    const pid = k.chain[k.position];
    const reason = controlAttempts(s, pid) <= 0 ? 'no_control_attempts'
      : k.pursuit ? (pursuitsLeft(s, pid) > 0 ? null : 'no_pursuit')
        : pid !== k.creatorId && !canSubdueOthers(s, pid) ? 'not_garrisoned' : null;
    if (!reason) return pid;
    emit(s, 'CONTROL_SKIPPED', { playerId: pid, creatureId: k.creatureId, reason });
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
        // A one-off pursuit ability gives its holders one more chance, in chain order.
        if (!s.control.pursuit) {
          const pursuers = s.control.chain.filter((x) => controlAttempts(s, x) > 0 && pursuitsLeft(s, x) > 0);
          if (pursuers.length) {
            Object.assign(s.control, { pursuit: true, chain: pursuers, position: 0 });
            emit(s, 'PURSUIT_BEGUN', { creatureId: s.control.creatureId, playerIds: [...pursuers] });
            continue;
          }
        }
        unleash(s, 'no_one_subdued');
        continue;
      }
      const c = s.resolution;
      if (c.resolved < c.order.length) {
        const pid = c.order[c.resolved];
        c.resolved += 1;
        if (bodyComplete(getPlayer(s, pid))) resurrect(s, pid);
        else emit(s, 'RESURRECTION_CANCELLED', { playerId: pid, reason: 'incomplete_body' });
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

function applyEffect(s, e, source, acc) {
  if (e.op === 'die') {
    const result = rollDie(s.rng, e.die);
    acc.dice.push({ source, die: e.die, sign: e.sign, result, value: e.sign * result });
  } else if (e.op === 'fixed') {
    acc.fixed.push({ source, amount: e.amount });
  } else if (e.op === 'threshold') {
    acc.thresholdAdjustments.push({ source, amount: e.amount });
  }
}

/** How many times a research effect applies, beyond its copies: e.g. once per rival who prepared this round. */
function effectMultiplier(s, pid, e) {
  if (e.per === 'rivalPrepared') {
    const prepared = new Set((s.occupancy.night.prepare || []).map((wid) => s.workers[wid].ownerId));
    prepared.delete(pid);
    return prepared.size;
  }
  return 1;
}

/** Research effects on a resurrection attribute, in type order, one entry per application. */
function resurrectionResearch(s, pid, attr) {
  const out = [];
  for (const type of Object.keys(s.config.research).sort()) {
    const copies = effectiveCopies(s, pid, type);
    for (let i = 0; i < copies; i++) {
      for (const e of s.config.research[type].effects) {
        if (e.kind !== 'resurrection' || e.attribute !== attr) continue;
        const times = effectMultiplier(s, pid, e);
        for (let j = 0; j < times; j++) out.push({ e, source: { kind: 'research', researchType: type, copy: i + 1 } });
      }
    }
  }
  return out;
}

/** Rerolls of a failed attribute a player has left: once per game per ability. */
function rerollsLeft(s, pid, attr) {
  const p = getPlayer(s, pid);
  let n = 0;
  for (const [type, def] of Object.entries(s.config.research)) {
    if (!effectiveCopies(s, pid, type)) continue;
    for (const e of def.effects) if (e.kind === 'reroll' && e.attribute === attr) n += e.uses ?? 1;
  }
  return Math.max(0, n - (p.rerollsUsed || 0));
}

function rollAttribute(s, pid, attr, parts) {
  const rc = s.config.resurrection;
  const acc = { dice: [], fixed: [], thresholdAdjustments: [] };
  const base = rollDie(s.rng, rc.baseDie);
  acc.dice.push({ source: { kind: 'base' }, die: rc.baseDie, sign: 1, result: base, value: base });
  for (const slot of SLOT_ORDER) {
    const part = parts[slot];
    const v = s.config.partVariants[part.variantId];
    for (const e of v.effects) {
      if (e.attribute === attr) applyEffect(s, e, { kind: 'part', slot, partId: part.id, variantId: part.variantId }, acc);
    }
  }
  for (const { e, source } of resurrectionResearch(s, pid, attr)) applyEffect(s, e, source, acc);
  const score = acc.dice.reduce((a, d) => a + d.value, 0) + acc.fixed.reduce((a, f) => a + f.amount, 0);
  const baseThreshold = rc.thresholds[attr];
  const threshold = baseThreshold + acc.thresholdAdjustments.reduce((a, t) => a + t.amount, 0);
  return { attribute: attr, ...acc, baseThreshold, threshold, score, success: score >= threshold };
}

function resurrect(s, pid) {
  const p = getPlayer(s, pid);
  const parts = { ...p.body };
  const consumed = SLOT_ORDER.map((slot) => parts[slot]);
  p.body = emptyBody();
  emit(s, 'RESURRECTION_STARTED', { playerId: pid, parts: SLOT_ORDER.map((slot) => ({ slot, partId: parts[slot].id, variantId: parts[slot].variantId })) });
  const attributes = {};
  for (const attr of ATTRIBUTES) {
    attributes[attr] = rollAttribute(s, pid, attr, parts);
    // A one-off ability may reroll a failed attribute once.
    if (!attributes[attr].success && rerollsLeft(s, pid, attr) > 0) {
      p.rerollsUsed = (p.rerollsUsed || 0) + 1;
      emit(s, 'ATTRIBUTE_REROLLED', { playerId: pid, attribute: attr, firstScore: attributes[attr].score });
      attributes[attr] = { ...rollAttribute(s, pid, attr, parts), rerolled: true };
    }
  }
  for (const attr of ATTRIBUTES) {
    const a = attributes[attr];
    for (const d of a.dice) emit(s, 'DIE_ROLLED', { playerId: pid, purpose: 'resurrection', attribute: attr, source: d.source, die: d.die, sign: d.sign, result: d.result });
  }
  emit(s, 'RESURRECTION_ROLLED', { playerId: pid, attributes: clone(attributes) });
  const record = {
    round: s.round, playerId: pid,
    scores: Object.fromEntries(ATTRIBUTES.map((a) => [a, { score: attributes[a].score, threshold: attributes[a].threshold, success: attributes[a].success }])),
    outcome: null, creatureId: null,
  };
  const { vitality, humanity } = attributes;
  if (!vitality.success) {
    const pool = [...consumed];
    const refund = [];
    const n = Math.min(s.config.resurrection.failedVitalityRefund, pool.length);
    for (let i = 0; i < n; i++) refund.push(pool.splice(randInt(s.rng, pool.length), 1)[0]);
    p.loose.push(...refund);
    record.outcome = 'failed';
    s.resurrections.push(record);
    emit(s, 'RESURRECTION_FAILED', { playerId: pid, refundedParts: clone(refund), lostParts: clone(pool) });
    const failSus = Math.max(0, s.config.resurrection.failedVitalitySuspicion - researchBonus(s, pid, 'quietFailure'));
    if (failSus > 0) changeSuspicion(s, failSus, 'failed_resurrection', pid);
    return;
  }
  s.counters.creature += 1;
  const cid = `creature-${s.counters.creature}`;
  if (humanity.success) {
    s.creatures[cid] = { id: cid, ownerId: pid, status: 'stable', disposition: 'humane', round: s.round };
    s.creatureOrder.push(cid);
    s.stableTransitions.push(cid);
    record.outcome = 'stable';
    record.creatureId = cid;
    s.resurrections.push(record);
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
  s.control = { creatorId: pid, creatureId: cid, parts: clone(consumed), chain, position: 0, record };
  emit(s, 'MONSTER_CREATED', { playerId: pid, creatureId: cid, chain: [...chain] });
}

function mobCannotStopMonster(s) {
  emit(s, 'MOB_FORMED', { suspicion: s.suspicion, overwhelmed: true });
  unleash(s, 'mob_overwhelmed');
}

/** Control-roll effects for a player: research in type order, one entry per effective copy. */
function controlEffects(s, pid) {
  const out = [];
  for (const type of Object.keys(s.config.research).sort()) {
    const copies = effectiveCopies(s, pid, type);
    for (let i = 0; i < copies; i++) for (const e of s.config.research[type].effects) if (e.kind === 'control') out.push({ e, source: { kind: 'research', researchType: type, copy: i + 1 } });
  }
  return out;
}

/** The control threshold against a creator's monsters: the base, plus their Ferocity research. */
export function controlThreshold(s, creatorId = null) {
  if (!creatorId) return s.config.control.threshold;
  let ferocity = 0;
  for (const [type, def] of Object.entries(s.config.research)) {
    const copies = effectiveCopies(s, creatorId, type);
    if (!copies) continue;
    for (const e of def.effects) {
      if (e.kind !== 'ferocity') continue;
      // Per hunter: once for each rival able to subdue the monster, after the first `beyond`.
      const times = e.per === 'rivalHunters' ? Math.max(0, s.players.filter((x) => x.id !== creatorId && canSubdueOthers(s, x.id)).length - (e.beyond || 0)) : 1;
      ferocity += copies * e.amount * times;
    }
  }
  return s.config.control.threshold + ferocity;
}

/** Exact chance that a player's control roll succeeds against a creator's monster (default: an ordinary one). Pure: consumes no RNG. */
export function estimateControl(s, pid, creatorId = null) {
  const cc = s.config.control;
  return successChance([{ op: 'die', die: cc.baseDie, sign: 1 }, ...controlEffects(s, pid).map((x) => x.e)], controlThreshold(s, creatorId));
}

function successChance(effects, threshold) {
  let dist = new Map([[0, 1]]);
  for (const e of effects) {
    if (e.op === 'threshold') { threshold += e.amount; continue; }
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
  const p = getPlayer(s, pid);
  const cc = s.config.control;
  p.controlAttemptsUsed += 1;
  if (k.pursuit) p.pursuitsUsed = (p.pursuitsUsed || 0) + 1;
  const acc = { dice: [], fixed: [], thresholdAdjustments: [] };
  const base = rollDie(s.rng, cc.baseDie);
  acc.dice.push({ source: { kind: 'base' }, die: cc.baseDie, sign: 1, result: base, value: base });
  for (const { e, source } of controlEffects(s, pid)) applyEffect(s, e, source, acc);
  const score = acc.dice.reduce((a, d) => a + d.value, 0) + acc.fixed.reduce((a, f) => a + f.amount, 0);
  const threshold = controlThreshold(s, k.creatorId);
  const success = score >= threshold;
  for (const d of acc.dice) emit(s, 'DIE_ROLLED', { playerId: pid, purpose: 'control', source: d.source, die: d.die, sign: d.sign, result: d.result });
  const roll = { dice: acc.dice, fixed: acc.fixed, threshold, score, success };
  emit(s, 'CONTROL_ROLLED', { playerId: pid, creatureId: k.creatureId, attemptsLeft: controlAttempts(s, pid), ...clone(roll) });
  k.record.controlDecisions.push({ playerId: pid, subdue: true, score, threshold, success });
  if (success) { subdue(s, pid); return; }
  // A failed attempt adds no suspicion; the monster passes on.
  k.position += 1;
}

function subdue(s, pid) {
  const k = s.control;
  const p = getPlayer(s, pid);
  const pool = [...k.parts];
  const salvage = [];
  const n = Math.min(s.config.control.subdueSalvage, pool.length);
  for (let i = 0; i < n; i++) salvage.push(pool.splice(randInt(s.rng, pool.length), 1)[0]);
  p.loose.push(...salvage);
  const c = s.creatures[k.creatureId];
  c.status = 'destroyed';
  c.disposition = 'subdued';
  c.subduedBy = pid;
  k.record.outcome = 'subdued';
  k.record.subduedBy = pid;
  s.resurrections.push(k.record);
  s.control = null;
  emit(s, 'MONSTER_SUBDUED', { playerId: pid, creatorId: c.ownerId, creatureId: c.id, attemptsLeft: controlAttempts(s, pid), salvagedParts: clone(salvage), lostParts: clone(pool) });
  // The struggle is noticed. The monster is already destroyed, so a mob
  // formed now is an ordinary mob.
  changeSuspicion(s, s.config.control.subdueSuspicion, 'monster_subdued', pid);
}

function declineSubdue(s, pid) {
  const k = s.control;
  k.record.controlDecisions.push({ playerId: pid, subdue: false });
  k.position += 1;
  emit(s, 'SUBDUE_DECLINED', { playerId: pid, creatureId: k.creatureId, pursuit: !!k.pursuit });
  // Letting a monster you are chasing get away is not noticed.
  if (k.pursuit) return;
  // The mob cannot stop a monster: if it forms now, the monster is unleashed.
  changeSuspicion(s, s.config.control.declineSuspicion, 'monster_not_subdued', pid, mobCannotStopMonster);
}

function unleash(s, cause) {
  const k = s.control;
  const c = s.creatures[k.creatureId];
  c.status = 'unleashed';
  c.disposition = 'unleashed';
  k.record.outcome = 'unleashed';
  s.resurrections.push(k.record);
  s.control = null;
  emit(s, 'CREATURE_UNLEASHED', { playerId: c.ownerId, creatureId: c.id, cause });
  endGame(s, 'unleashed', s.players.filter((x) => s.objectives[x.id] === 'unleasher').map((x) => x.id));
}

/**
 * Exact success probabilities for a resurrection attempt with the player's
 * currently installed body and effective research. Pure: consumes no RNG.
 * Returns null if the body is incomplete.
 */
export function estimateResurrection(s, pid) {
  const p = getPlayer(s, pid);
  if (!p || !bodyComplete(p)) return null;
  const rc = s.config.resurrection;
  const out = {};
  for (const attr of ATTRIBUTES) {
    const effects = [{ op: 'die', die: rc.baseDie, sign: 1 }];
    for (const slot of SLOT_ORDER) for (const e of s.config.partVariants[p.body[slot].variantId].effects) if (e.attribute === attr) effects.push(e);
    for (const { e } of resurrectionResearch(s, pid, attr)) effects.push(e);
    const threshold = rc.thresholds[attr] + effects.filter((e) => e.op === 'threshold').reduce((a, e) => a + e.amount, 0);
    let success = successChance(effects, rc.thresholds[attr]);
    // One reroll at most per attribute per attempt; rerolls are spent in attribute order.
    const rerollAvail = rerollsLeft(s, pid, attr) > 0;
    if (rerollAvail) success = 1 - (1 - success) * (1 - success);
    out[attr] = { threshold, success, reroll: rerollAvail };
  }
  const pv = out.vitality.success;
  const ph = out.humanity.success;
  return {
    attributes: out,
    pFailed: 1 - pv,
    pStable: pv * ph,
    pMonster: pv * (1 - ph),
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
  PICK_RESEARCH: { required: ['type', 'playerId', 'cardId'], optional: ['seq'] },
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
  if (cmd.type === 'PICK_RESEARCH') {
    const k = s.pendingPick;
    if (!k) return err('WRONG_PHASE', 'There are no drawn research cards to pick from.');
    if (typeof cmd.cardId !== 'string' || !k.cards.some((x) => x.id === cmd.cardId)) return err('INVALID_TARGET', `Card ${cmd.cardId} was not drawn.`);
    if (!k.eligible.includes(cmd.cardId)) return err('ALREADY_DISCOVERED', 'You already discovered that type.');
    return null;
  }
  if (s.pendingPick) return err('PICK_PENDING', 'Pick from the drawn research cards first.');
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
  } else if (cmd.type === 'PICK_RESEARCH') {
    // Experiment discoveries stay private: they are never published.
    const k = s.pendingPick;
    s.pendingPick = null;
    gainResearch(s, p, k.cards.find((x) => x.id === cmd.cardId), 'experiment');
    returnToDeck(s, p, k.cards.filter((x) => x.id !== cmd.cardId));
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
  // Emitted events are immutable, so the event list can be shared structurally.
  const { events, ...rest } = state;
  const s = clone(rest);
  s.events = events.slice();
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
    return s.pendingPick.eligible.map((cardId) => ({ type: 'PICK_RESEARCH', playerId: pid, cardId }));
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

// Parts are interchangeable when they share a variant and a location: a loose
// part and an installed one of the same variant are not (discarding the
// installed one empties a slot).
function partKey(p, id) {
  const loose = p.loose.find((x) => x.id === id);
  return loose ? `loose:${loose.variantId}` : `installed:${installedParts(p).find((x) => x.id === id).variantId}`;
}

function partSignature(p, ids) {
  return ids.map((id) => partKey(p, id)).sort().join('|');
}

/**
 * Part selections that differ in their variants, built by choosing how many of
 * each distinct variant to take rather than which instances. This stays small
 * when a player holds many parts (choosing 6 of 52 instances one by one would
 * be millions of combinations). `typeCaps` optionally limits parts per type.
 */
function variantCombos(p, values, min, max, typeCaps = null) {
  const all = [...p.loose, ...installedParts(p)];
  const groups = [];
  const byVariant = new Map();
  for (const id of values) {
    const part = all.find((x) => x.id === id);
    const key = partKey(p, id);
    let g = byVariant.get(key);
    if (!g) { g = { type: part.type, ids: [] }; byVariant.set(key, g); groups.push(g); }
    g.ids.push(id);
  }
  const out = [];
  const used = {};
  const rec = (gi, picked) => {
    if (gi === groups.length) {
      if (picked.length >= min) out.push({ partIds: [...picked] });
      return;
    }
    const g = groups[gi];
    const typeLeft = typeCaps ? (typeCaps[g.type] || 0) - (used[g.type] || 0) : Infinity;
    const most = Math.min(g.ids.length, max - picked.length, typeLeft);
    for (let n = 0; n <= most; n++) {
      used[g.type] = (used[g.type] || 0) + n;
      rec(gi + 1, [...picked, ...g.ids.slice(0, n)]);
      used[g.type] -= n;
    }
  };
  rec(0, []);
  return out.sort((a, b) => a.partIds.length - b.partIds.length);
}

function uniqueCombos(p, values, min, max, dedupe) {
  if (dedupe) return variantCombos(p, values, min, max);
  const out = [];
  const seen = new Set();
  for (let size = min; size <= Math.min(max, values.length); size++) {
    for (const combo of combinations(values, size)) {
      if (dedupe) {
        const sig = partSignature(p, combo);
        if (seen.has(sig)) continue;
        seen.add(sig);
      }
      out.push({ partIds: combo });
    }
  }
  return out;
}

function expandChoices(s, p, actionId, c, dedupe) {
  const out = [];
  if (actionId === 'research') {
    for (const id of c.researchCardId.values) out.push({ researchCardId: id });
  } else if (actionId === 'specimens') {
    const v = c.partTypes.values;
    const rec = (start, acc) => {
      if (acc.length === c.partTypes.count) { out.push({ partTypes: [...acc] }); return; }
      for (let i = start; i < v.length; i++) { acc.push(v[i]); rec(i, acc); acc.pop(); }
    };
    rec(0, []);
  } else if (actionId === 'assemble' && dedupe) {
    out.push(...variantCombos(p, c.partIds.values, c.partIds.min, c.partIds.max, c.partIds.maxPerPartType));
  } else if (actionId === 'assemble') {
    const seen = new Set();
    const k = c.partIds;
    for (let size = k.min; size <= Math.min(k.max, k.values.length); size++) {
      for (const combo of combinations(k.values, size)) {
        const count = {};
        let ok = true;
        for (const id of combo) {
          const type = p.loose.find((x) => x.id === id).type;
          count[type] = (count[type] || 0) + 1;
          if (count[type] > k.maxPerPartType[type]) { ok = false; break; }
        }
        if (!ok) continue;
        if (dedupe) {
          const sig = partSignature(p, combo);
          if (seen.has(sig)) continue;
          seen.add(sig);
        }
        out.push({ partIds: combo });
      }
    }
  } else if (actionId === 'charity') {
    for (const units of c.units.values) out.push({ units });
  } else if (actionId === 'experiment' || actionId === 'sell') {
    out.push(...uniqueCombos(p, c.partIds.values, c.partIds.min, c.partIds.max, dedupe));
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
  return {
    id: p.id, name: p.name, seat: p.seat, money: p.money,
    loose: clone(p.loose), body: clone(p.body), bodyComplete: bodyComplete(p),
    research: [...p.research], published: [...p.published], igorsHired: p.igorsHired,
    nextIgorCost: igorCount(s, p) < s.config.maxIgors ? nextIgorCost(s) : null,
    passed: p.passed,
    effectiveResearch: Object.fromEntries(Object.keys(s.config.research).sort().map((t) => [t, effectiveCopies(s, p.id, t)])),
    rerollsUsed: p.rerollsUsed || 0,
    assembleCapacity: assembleCapacity(s, p.id),
    controlAttempts: controlAttempts(s, p.id),
    controlChance: estimateControl(s, p.id),
    controlChanceVs: Object.fromEntries(s.players.map((c) => [c.id, estimateControl(s, p.id, c.id)])),
    controlThreshold: controlThreshold(s, p.id),
    garrisoned: garrisoned(s, p.id),
    canSubdueOthers: canSubdueOthers(s, p.id),
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
    suspicionHistory: clone(s.suspicionHistory),
    market: clone(s.market),
    deckCount: s.deck.length,
    publications: clone(s.publications),
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
      deciderId: s.control.chain[s.control.position] || null, pursuit: !!s.control.pursuit, decisions: clone(s.control.record.controlDecisions),
      // Players after the current decider who could still subdue this monster.
      upcoming: s.control.chain.slice(s.control.position + 1).filter((pid) => canSubdue(s, pid)),
    } : null,
    resurrections: clone(s.resurrections),
    commandCount: s.commandLog.length,
    result: s.result ? clone(s.result) : null,
    config: clone(s.config),
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
  return s;
}
