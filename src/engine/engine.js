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

function deepMerge(base, over) {
  for (const [k, v] of Object.entries(over)) {
    if (isPlainObject(v) && isPlainObject(base[k])) deepMerge(base[k], v);
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
  for (const attr of ATTRIBUTES) {
    if (!Number.isInteger(cfg.resurrection.thresholds[attr])) throw new Error(`resurrection threshold for ${attr} must be an integer`);
  }
  for (const k of ['failedVitalitySuspicion']) {
    if (!Number.isInteger(cfg.resurrection[k]) || cfg.resurrection[k] < 0) throw new Error(`resurrection.${k} must be a non-negative integer`);
  }
  for (const k of ['startingAttempts', 'declineSuspicion', 'subdueSuspicion', 'subdueSalvage']) {
    if (!Number.isInteger(cfg.control[k]) || cfg.control[k] < 0) throw new Error(`control.${k} must be a non-negative integer`);
  }
  for (const [id, v] of Object.entries(cfg.partVariants)) {
    if (!cfg.partTypes[v.type]) throw new Error(`part variant ${id} has unknown type ${v.type}`);
    for (const e of v.effects) validateEffect(e, `part variant ${id}`);
  }
  for (const [id, r] of Object.entries(cfg.research)) {
    for (const e of r.effects) if (e.kind === 'resurrection') validateEffect(e, `research ${id}`);
  }
  for (const [id, a] of Object.entries(cfg.actions)) {
    if (!HANDLERS[id]) throw new Error(`action ${id} has no rules handler`);
    if (a.phase !== 'day' && a.phase !== 'night') throw new Error(`action ${id} has invalid phase`);
  }
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

function researchBonus(s, pid, kind) {
  let total = 0;
  for (const [type, def] of Object.entries(s.config.research)) {
    const copies = researchCount(s, pid, type);
    if (!copies) continue;
    for (const e of def.effects) if (e.kind === kind) total += copies * e.amount;
  }
  return total;
}

export function assembleCapacity(s, pid) {
  return s.config.actions.assemble.max + researchBonus(s, pid, 'assembleCapacity');
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

function nextIgorCost(s, p) {
  return s.config.igorCosts[p.igorsHired];
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
  const variants = Object.keys(s.config.partVariants).filter((id) => s.config.partVariants[id].type === chosen);
  return makePart(s, variants[randInt(s.rng, variants.length)]);
}

function acquireResearch(s, p, cardId, via) {
  const idx = s.market.findIndex((c) => c.id === cardId);
  const [card] = s.market.splice(idx, 1);
  p.research.push(card.type);
  p.research.sort();
  emit(s, 'RESEARCH_ACQUIRED', { playerId: p.id, cardId: card.id, researchType: card.type, via });
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

function resolveDiscovery(s, p, w, def, actionId) {
  const parts = [];
  for (let i = 0; i < def.parts; i++) parts.push(drawRandomPart(s));
  p.loose.push(...parts);
  emit(s, 'PARTS_GAINED', { playerId: p.id, source: actionId, parts: clone(parts) });
  const roll = rollDie(s.rng, 6);
  const base = def.suspicionTable[roll - 1] || 0;
  const reduction = researchBonus(s, p.id, 'suspicionReduction');
  const increase = Math.max(0, base - reduction);
  emit(s, 'DIE_ROLLED', { playerId: p.id, purpose: 'discovery', actionId, die: 6, result: roll });
  emit(s, 'DISCOVERY_RESOLVED', { playerId: p.id, actionId, roll, baseSuspicion: base, reduction, increase });
  if (increase > 0) changeSuspicion(s, increase, actionId, p.id);
}

export const HANDLERS = {
  medicine: {
    choiceKeys: [],
    prereq: () => null,
    apply(s, p, w, def) {
      const base = w.kind === 'igor' ? def.igorGain : def.gain;
      changeMoney(s, p, base + researchBonus(s, p.id, 'medicineBonus'), 'medicine');
    },
  },
  research: {
    choiceKeys: ['researchCardId'],
    prereq(s, p, w, def) {
      return needMoney(p, def.cost) || (eligibleMarketCards(s, p).length ? null : err('NO_ELIGIBLE_RESEARCH', 'No eligible research card in the market.'));
    },
    checkChoices: (s, p, w, def, c) => checkMarketCard(s, p, c.researchCardId),
    constraints: (s, p) => ({ researchCardId: { type: 'enum', values: eligibleMarketCards(s, p).map((c) => c.id) } }),
    apply(s, p, w, def, c) {
      changeMoney(s, p, -def.cost, 'research');
      acquireResearch(s, p, c.researchCardId, 'research');
    },
  },
  specimens: {
    choiceKeys: ['variantIds'],
    prereq: (s, p, w, def) => needMoney(p, def.cost),
    checkChoices(s, p, w, def, c) {
      const v = c.variantIds;
      if (!Array.isArray(v) || v.length !== def.count) return err('INVALID_CHOICE', `variantIds must list exactly ${def.count} variants.`);
      for (const id of v) if (typeof id !== 'string' || !s.config.partVariants[id]) return err('INVALID_TARGET', `Unknown part variant ${id}.`);
      return null;
    },
    constraints: (s, p, w, def) => ({ variantIds: { type: 'multiset', count: def.count, values: Object.keys(s.config.partVariants) } }),
    apply(s, p, w, def, c) {
      changeMoney(s, p, -def.cost, 'specimens');
      const parts = c.variantIds.map((id) => makePart(s, id));
      p.loose.push(...parts);
      emit(s, 'PARTS_GAINED', { playerId: p.id, source: 'specimens', parts: clone(parts) });
    },
  },
  hire: {
    choiceKeys: [],
    prereq(s, p) {
      if (p.igorsHired >= s.config.maxIgors) return err('MAX_IGORS', 'You already employ the maximum number of Igors.');
      return needMoney(p, nextIgorCost(s, p));
    },
    apply(s, p) {
      const cost = nextIgorCost(s, p);
      changeMoney(s, p, -cost, 'hire');
      p.igorsHired += 1;
      const id = `igor-${p.id}-${p.igorsHired}`;
      addWorker(s, { id, kind: 'igor', ownerId: p.id, active: false });
      emit(s, 'IGOR_HIRED', { playerId: p.id, workerId: id, cost, availableFromRound: s.round + 1 });
    },
  },
  charity: {
    choiceKeys: [],
    prereq(s, p, w, def) {
      if (s.suspicion <= 0) return err('NO_SUSPICION', 'Suspicion is already 0.');
      return needMoney(p, def.cost);
    },
    apply(s, p, w, def) {
      changeMoney(s, p, -def.cost, 'charity');
      changeSuspicion(s, -def.reduction, 'charity', p.id);
    },
  },
  lecture: {
    choiceKeys: [],
    prereq: () => null,
    apply(s, p, w, def) {
      // 1 + one per discovery this player has published (no cap by default).
      const pay = def.base + p.published.length;
      changeMoney(s, p, def.cap == null ? pay : Math.min(def.cap, pay), 'lecture');
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
    prereq: () => null,
    apply: (s, p, w, def) => resolveDiscovery(s, p, w, def, 'graves'),
  },
  morgue: {
    choiceKeys: [],
    prereq: () => null,
    apply: (s, p, w, def) => resolveDiscovery(s, p, w, def, 'morgue'),
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
    choiceKeys: ['partIds', 'researchCardId'],
    prereq(s, p, w, def) {
      if (p.loose.length < def.partCost) return err('INSUFFICIENT_PARTS', `Requires ${def.partCost} loose parts.`);
      return eligibleMarketCards(s, p).length ? null : err('NO_ELIGIBLE_RESEARCH', 'No eligible research card in the market.');
    },
    checkChoices: (s, p, w, def, c) => checkLooseParts(p, c.partIds, def.partCost, def.partCost) || checkMarketCard(s, p, c.researchCardId),
    constraints: (s, p, w, def) => ({
      partIds: { type: 'subset', min: def.partCost, max: def.partCost, values: p.loose.map((x) => x.id) },
      researchCardId: { type: 'enum', values: eligibleMarketCards(s, p).map((c) => c.id) },
    }),
    apply(s, p, w, def, c) {
      const spent = c.partIds.map((id) => p.loose.splice(p.loose.findIndex((x) => x.id === id), 1)[0]);
      emit(s, 'PARTS_SPENT', { playerId: p.id, reason: 'experiment', parts: clone(spent) });
      acquireResearch(s, p, c.researchCardId, 'experiment');
    },
  },
  conceal: {
    choiceKeys: [],
    prereq: (s) => (s.suspicion > 0 ? null : err('NO_SUSPICION', 'Suspicion is already 0.')),
    apply: (s, p, w, def) => changeSuspicion(s, -def.reduction, 'conceal', p.id),
  },
};

function publishError(s, p, t) {
  if (typeof t !== 'string' || !s.config.research[t]) return err('INVALID_TARGET', `Unknown research type ${t}.`);
  if (!p.research.includes(t)) return err('NOT_DISCOVERED', `You have not discovered ${t}.`);
  if (p.published.includes(t)) return err('ALREADY_PUBLISHED', `You already published ${t}.`);
  return null;
}

function publishable(p) {
  return p.research.filter((t) => !p.published.includes(t));
}

/** Whether a player has a worker in the garrison this round. */
export function garrisoned(s, pid) {
  return (s.occupancy.day.garrison || []).some((wid) => s.workers[wid] && s.workers[wid].ownerId === pid);
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
  if (def.capacity != null && occupancyOf(s, actionId).length >= def.capacity) return err('SPACE_FULL', `${def.location} is full.`);
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
  const special = n >= cfg.visionaryMinPlayers ? ['visionary', 'inquisitor', 'unleasher'] : ['inquisitor', 'unleasher'];
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
    commitment: null,
    control: null,
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
    s.players.push({ id, name: String(name), seat: i, money: cfg.startingMoney, loose: [], body: emptyBody(), research: [], published: [], igorsHired: 0, controlAttemptsUsed: 0, passed: false });
    addWorker(s, { id: `scientist-${id}`, kind: 'scientist', ownerId: id, active: true });
  }
  s.firstPlayerIndex = randInt(s.rng, n);
  s.turnPointer = s.firstPlayerIndex;

  const objectiveDeck = objectiveDeckFor(cfg);
  shuffle(s.rng, objectiveDeck);
  s.players.forEach((p, i) => { s.objectives[p.id] = objectiveDeck[i]; });
  s.unseenObjectives = objectiveDeck.slice(n);

  let k = 0;
  for (const type of Object.keys(cfg.research).sort()) {
    for (let c = 0; c < cfg.researchCopies; c++) s.deck.push({ id: `card-${++k}`, type });
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

function startCommitment(s) {
  s.phase = 'commitment';
  emit(s, 'PHASE_STARTED', {});
  const order = initiativeOrder(s);
  const eligible = [];
  for (const pid of order) {
    if (bodyComplete(getPlayer(s, pid))) eligible.push(pid);
    else emit(s, 'COMMITMENT_AUTO_DECLINED', { playerId: pid, reason: 'incomplete_body' });
  }
  s.commitment = { order: eligible, choices: {}, resolved: 0 };
}

/** Whether a player may subdue the current monster: an attempt left, and a garrisoned worker unless they created it. */
function canSubdue(s, pid) {
  return controlAttempts(s, pid) > 0 && (pid === s.control.creatorId || garrisoned(s, pid));
}

/** The next player in a control chain who could subdue the monster, skipping (and logging) those with no attempts left. */
function nextController(s) {
  const k = s.control;
  while (k.position < k.chain.length) {
    const pid = k.chain[k.position];
    const reason = controlAttempts(s, pid) <= 0 ? 'no_control_attempts'
      : pid !== k.creatorId && !garrisoned(s, pid) ? 'not_garrisoned' : null;
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
  s.commitment = null;
  endPhase(s);
  s.firstPlayerIndex = (s.firstPlayerIndex + 1) % s.players.length;
  s.round += 1;
  startRound(s);
}

/** Runs forced transitions and system outcomes until a player decision or the end. */
function advance(s) {
  let guard = 0;
  while (!s.result) {
    if (++guard > 100000) throw new Error('advance(): no decision point reached');
    if (s.phase === 'day' || s.phase === 'night') {
      const p = nextPlacementPlayer(s);
      if (p) { s.activePlayerId = p.id; return; }
      endPhase(s);
      if (s.phase === 'day') startWorkerPhase(s, 'night');
      else startCommitment(s);
    } else if (s.phase === 'commitment') {
      const pid = s.commitment.order.find((id) => !(id in s.commitment.choices));
      if (pid) { s.activePlayerId = pid; return; }
      endPhase(s);
      s.phase = 'resolution';
      emit(s, 'PHASE_STARTED', {});
      const c = s.commitment;
      emit(s, 'COMMITMENTS_REVEALED', { commitments: c.order.map((id) => ({ playerId: id, attempt: c.choices[id] })) });
    } else if (s.phase === 'resolution') {
      // Attempts resolve in initiative order; a monster pauses resolution
      // while players decide, one at a time, whether to subdue it.
      if (s.control) {
        const pid = nextController(s);
        if (pid) { s.activePlayerId = pid; return; }
        unleash(s, 'no_one_subdued');
        continue;
      }
      const c = s.commitment;
      if (c.resolved < c.order.length) {
        const pid = c.order[c.resolved];
        c.resolved += 1;
        if (c.choices[pid]) resurrect(s, pid);
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
  for (const type of Object.keys(s.config.research).sort()) {
    const copies = researchCount(s, pid, type);
    for (let i = 0; i < copies; i++) {
      for (const e of s.config.research[type].effects) {
        if (e.kind === 'resurrection' && e.attribute === attr) applyEffect(s, e, { kind: 'research', researchType: type, copy: i + 1 }, acc);
      }
    }
  }
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
  for (const attr of ATTRIBUTES) attributes[attr] = rollAttribute(s, pid, attr, parts);
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
    changeSuspicion(s, s.config.resurrection.failedVitalitySuspicion, 'failed_resurrection', pid);
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

function subdue(s, pid) {
  const k = s.control;
  const p = getPlayer(s, pid);
  p.controlAttemptsUsed += 1;
  const pool = [...k.parts];
  const salvage = [];
  const n = Math.min(s.config.control.subdueSalvage, pool.length);
  for (let i = 0; i < n; i++) salvage.push(pool.splice(randInt(s.rng, pool.length), 1)[0]);
  p.loose.push(...salvage);
  const c = s.creatures[k.creatureId];
  c.status = 'destroyed';
  c.disposition = 'subdued';
  c.subduedBy = pid;
  k.record.controlDecisions.push({ playerId: pid, subdue: true });
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
    for (const type of Object.keys(s.config.research).sort()) {
      const copies = researchCount(s, pid, type);
      for (let i = 0; i < copies; i++) for (const e of s.config.research[type].effects) if (e.kind === 'resurrection' && e.attribute === attr) effects.push(e);
    }
    let dist = new Map([[0, 1]]);
    let threshold = rc.thresholds[attr];
    for (const e of effects) {
      if (e.op === 'threshold') { threshold += e.amount; continue; }
      const faces = e.op === 'die' ? Array.from({ length: e.die }, (_, i) => e.sign * (i + 1)) : [e.amount];
      const next = new Map();
      for (const [v, pr] of dist) for (const f of faces) next.set(v + f, (next.get(v + f) || 0) + pr / faces.length);
      dist = next;
    }
    let success = 0;
    for (const [v, pr] of dist) if (v >= threshold) success += pr;
    out[attr] = { threshold, success };
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
  COMMIT_RESURRECTION: { required: ['type', 'playerId', 'attempt'], optional: ['seq'] },
  SUBDUE_MONSTER: { required: ['type', 'playerId', 'subdue'], optional: ['seq'] },
  PUBLISH_RESEARCH: { required: ['type', 'playerId', 'researchType'], optional: ['seq'] },
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

  if (cmd.type === 'COMMIT_RESURRECTION') {
    if (s.phase !== 'commitment') return err('WRONG_PHASE', 'Not in the resurrection commitment phase.');
    if (typeof cmd.attempt !== 'boolean') return err('INVALID_CHOICE', 'attempt must be a boolean.');
    return null;
  }
  if (cmd.type === 'SUBDUE_MONSTER') {
    if (s.phase !== 'resolution' || !s.control) return err('WRONG_PHASE', 'There is no monster to subdue.');
    if (typeof cmd.subdue !== 'boolean') return err('INVALID_CHOICE', 'subdue must be a boolean.');
    return null;
  }
  if (s.phase !== 'day' && s.phase !== 'night') return err('WRONG_PHASE', cmd.type === 'PUBLISH_RESEARCH' ? 'You can only publish on your day or night turn.' : 'Workers can only be placed by day or night.');
  if (cmd.type === 'PASS_TURN') return null;
  if (cmd.type === 'PUBLISH_RESEARCH') return publishError(s, p, cmd.researchType);

  if (typeof cmd.workerId !== 'string') return err('INVALID_COMMAND', 'workerId must be a string.');
  if (typeof cmd.actionId !== 'string' || !s.config.actions[cmd.actionId]) return err('UNKNOWN_ACTION', `Unknown action ${cmd.actionId}.`);
  const w = s.workers[cmd.workerId];
  const pe = placementError(s, p, w, cmd.actionId);
  if (pe) return pe;
  const h = HANDLERS[cmd.actionId];
  const choices = cmd.choices === undefined ? {} : cmd.choices;
  if (!isPlainObject(choices)) return err('INVALID_CHOICE', 'choices must be an object.');
  for (const k of Object.keys(choices)) if (!h.choiceKeys.includes(k)) return err('UNKNOWN_FIELD', `Unknown choice ${k} for ${cmd.actionId}.`);
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
  } else if (cmd.type === 'COMMIT_RESURRECTION') {
    s.commitment.choices[p.id] = cmd.attempt;
    emit(s, 'COMMITMENT_LOCKED', { playerId: p.id });
    emit(s, 'COMMITMENT_RECORDED', { playerId: p.id, attempt: cmd.attempt }, [p.id]);
  } else if (cmd.type === 'PUBLISH_RESEARCH') {
    // A free action: the player keeps their turn.
    p.published.push(cmd.researchType);
    p.published.sort();
    s.publications.push({ playerId: p.id, type: cmd.researchType, round: s.round });
    emit(s, 'RESEARCH_PUBLISHED', { playerId: p.id, researchType: cmd.researchType });
  } else if (cmd.type === 'SUBDUE_MONSTER') {
    if (cmd.subdue) subdue(s, p.id);
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
  if (s.phase === 'commitment') {
    return [
      { type: 'COMMIT_RESURRECTION', playerId: pid, attempt: true },
      { type: 'COMMIT_RESURRECTION', playerId: pid, attempt: false },
    ];
  }
  if (s.phase === 'resolution') {
    return [
      { type: 'SUBDUE_MONSTER', playerId: pid, subdue: true },
      { type: 'SUBDUE_MONSTER', playerId: pid, subdue: false },
    ];
  }
  const p = getPlayer(s, pid);
  const out = [{ type: 'PASS_TURN', playerId: pid }];
  for (const t of publishable(p)) out.push({ type: 'PUBLISH_RESEARCH', playerId: pid, researchType: t });
  for (const w of playerWorkers(s, pid)) {
    if (!workerAvailable(s, w)) continue;
    for (const actionId of Object.keys(s.config.actions)) {
      if (placementError(s, p, w, actionId)) continue;
      const h = HANDLERS[actionId];
      const entry = { type: 'PLACE_MEEPLE', playerId: pid, workerId: w.id, actionId };
      if (h.choiceKeys.length) entry.choiceConstraints = h.constraints(s, p, w, s.config.actions[actionId]);
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

function partSignature(p, ids) {
  return ids.map((id) => p.loose.find((x) => x.id === id).variantId).sort().join('|');
}

function expandChoices(s, p, actionId, c, dedupe) {
  const out = [];
  if (actionId === 'research') {
    for (const id of c.researchCardId.values) out.push({ researchCardId: id });
  } else if (actionId === 'specimens') {
    const v = c.variantIds.values;
    const rec = (start, acc) => {
      if (acc.length === c.variantIds.count) { out.push({ variantIds: [...acc] }); return; }
      for (let i = start; i < v.length; i++) { acc.push(v[i]); rec(i, acc); acc.pop(); }
    };
    rec(0, []);
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
  } else if (actionId === 'experiment') {
    const seen = new Set();
    for (const combo of combinations(c.partIds.values, c.partIds.min)) {
      if (dedupe) {
        const sig = partSignature(p, combo);
        if (seen.has(sig)) continue;
        seen.add(sig);
      }
      for (const cardId of c.researchCardId.values) out.push({ partIds: combo, researchCardId: cardId });
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
  return {
    id: p.id, name: p.name, seat: p.seat, money: p.money,
    loose: clone(p.loose), body: clone(p.body), bodyComplete: bodyComplete(p),
    research: [...p.research], published: [...p.published], igorsHired: p.igorsHired,
    nextIgorCost: p.igorsHired < s.config.maxIgors ? nextIgorCost(s, p) : null,
    passed: p.passed,
    effectiveResearch: Object.fromEntries(Object.keys(s.config.research).sort().map((t) => [t, researchCount(s, p.id, t)])),
    assembleCapacity: assembleCapacity(s, p.id),
    controlAttempts: controlAttempts(s, p.id),
    garrisoned: garrisoned(s, p.id),
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
    commitment: s.commitment ? { order: [...s.commitment.order], decided: s.commitment.order.filter((pid) => pid in s.commitment.choices) } : null,
    control: s.control ? {
      creatorId: s.control.creatorId, creatureId: s.control.creatureId, chain: [...s.control.chain], position: s.control.position,
      deciderId: s.control.chain[s.control.position] || null, decisions: clone(s.control.record.controlDecisions),
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
  view.private = {
    objective: s.objectives[pid],
    commitment: s.commitment && pid in s.commitment.choices ? s.commitment.choices[pid] : null,
  };
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
