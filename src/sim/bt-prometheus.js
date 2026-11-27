// A behaviour-tree policy for the Prometheus objective (experimental).
//
// Like every policy (spec 014) it sees only its player view and the legal
// commands, and never authoritative state. Legality comes from the engine's
// legal-command templates. To compare bodies that are not yet assembled, it
// estimates their odds from the configuration's dice, as the heuristic
// estimates discovery rolls.
//
// The tree, ticked once per decision:
//   prometheus
//   ├─ pick research   keep the drawn card worth most to me
//   ├─ control chain   always try to subdue (an unleashing loses for me too)
//   ├─ day             charity in danger › garrison › hire › buy (research or
//   │                  specimens, on one value scale) › medicine
//   └─ night           attempt tonight (contested Igor work first, then
//                      prepare, stalling so rivals commit first) › Igor jobs
//                      › Scientist jobs › pass
//
// The body is planned from installed and loose parts together: installed parts
// the plan replaces are discarded by experiment, the rest assembled at once.
//
// Outside the Prometheus objective it defers to the heuristic.

import { selector, sequence, condition, action, guard } from './bt.js';
import { heuristicPolicy } from './policies.js';
import { researchWorth, researchWorthExcept, expectedDiscovery, maxDiscovery } from './effect-values.js';

// Effect kinds the tree values itself, from its own odds and plan.
const MODELLED_KINDS = ['resurrection', 'control', 'controlAttempts', 'suspicionReduction', 'discoveryRollBonus', 'medicineBonus'];

// ---------------------------------------------------------------------------
// Dice arithmetic over configuration effects
// ---------------------------------------------------------------------------

/** Chance that base die + effects reaches the threshold. */
function chance(baseDie, threshold, effects) {
  let dist = new Map();
  for (let f = 1; f <= baseDie; f++) dist.set(f, 1 / baseDie);
  for (const e of effects) {
    if (e.op === 'threshold') { threshold += e.amount; continue; }
    const faces = e.op === 'die' ? Array.from({ length: e.die }, (_, i) => e.sign * (i + 1)) : [e.amount];
    const next = new Map();
    for (const [v, p] of dist) for (const f of faces) next.set(v + f, (next.get(v + f) || 0) + p / faces.length);
    dist = next;
  }
  let ok = 0;
  for (const [v, p] of dist) if (v >= threshold) ok += p;
  return ok;
}

/** Research effects of one kind, one entry per effective copy. */
function researchEffects(cfg, copies, pred) {
  const out = [];
  for (const [t, def] of Object.entries(cfg.research)) {
    const n = copies[t] || 0;
    for (const e of def.effects) if (pred(e)) for (let i = 0; i < n; i++) out.push(e);
  }
  return out;
}

/** Estimated odds of a body (a list of variant IDs) with the given research. */
function bodyOdds(cfg, variants, copies) {
  const rc = cfg.resurrection;
  const res = {};
  for (const attr of ['vitality', 'humanity']) {
    const fx = [];
    for (const v of variants) for (const e of cfg.partVariants[v].effects) if (e.attribute === attr) fx.push(e);
    fx.push(...researchEffects(cfg, copies, (e) => e.kind === 'resurrection' && e.attribute === attr));
    res[attr] = chance(rc.baseDie, rc.thresholds[attr], fx);
  }
  return { pV: res.vitality, pH: res.humanity, pStable: res.vitality * res.humanity, pMonster: res.vitality * (1 - res.humanity) };
}

/** Mean contribution of a variant to an attribute. */
function variantMean(cfg, variantId, attr) {
  let m = 0;
  for (const e of cfg.partVariants[variantId].effects) {
    if (e.attribute !== attr) continue;
    if (e.op === 'die') m += e.sign * (e.die + 1) / 2;
    else if (e.op === 'fixed') m += e.amount;
    else if (e.op === 'threshold') m -= e.amount;
  }
  return m;
}

// ---------------------------------------------------------------------------
// Blackboard
// ---------------------------------------------------------------------------

function buildBlackboard(view, legal, P) {
  const cfg = view.config;
  const me = view.players.find((p) => p.id === view.viewerId);
  const rivals = view.players.filter((p) => p.id !== me.id);
  const bb = { view, legal, cfg, me, rivals, command: null, P };
  const templates = view.legalCommands || [];

  // Legality: a command must match a legal template and its constraints.
  bb.isLegal = (cmd) => {
    if (cmd.type !== 'PLACE_MEEPLE') return legal.some((c) => JSON.stringify(c) === JSON.stringify(cmd));
    const t = templates.find((x) => x.type === 'PLACE_MEEPLE' && x.workerId === cmd.workerId && x.actionId === cmd.actionId);
    if (!t) return false;
    const cons = t.choiceConstraints || {};
    for (const [key, c] of Object.entries(cons)) {
      const v = cmd.choices && cmd.choices[key];
      if (c.type === 'enum' && !c.values.includes(v)) return false;
      if (c.type === 'multiset' && (!Array.isArray(v) || v.length !== c.count || v.some((x) => !c.values.includes(x)))) return false;
      if (c.type === 'subset') {
        if (!Array.isArray(v) || v.length < c.min || v.length > c.max || new Set(v).size !== v.length) return false;
        if (v.some((x) => !c.values.includes(x))) return false;
        if (c.maxPerPartType) {
          const n = {};
          for (const id of v) { const ty = me.loose.find((x) => x.id === id).type; n[ty] = (n[ty] || 0) + 1; if (n[ty] > c.maxPerPartType[ty]) return false; }
        }
      }
    }
    return true;
  };
  // A worker of the given kind that may take an action now.
  bb.workerFor = (actionId, kind) => {
    const t = templates.find((x) => x.type === 'PLACE_MEEPLE' && x.actionId === actionId && x.workerId.startsWith(kind));
    return t ? t.workerId : null;
  };
  bb.place = (actionId, kind, choices = {}) => {
    const w = bb.workerFor(actionId, kind);
    return w ? { type: 'PLACE_MEEPLE', playerId: me.id, workerId: w, actionId, choices } : null;
  };
  bb.freeIgors = me.workers.filter((w) => w.kind === 'igor' && w.availableNow).length;
  bb.sciFree = me.workers.some((w) => w.kind === 'scientist' && w.availableNow);
  bb.igorCount = me.workers.filter((w) => w.kind === 'igor').length;

  // Suspicion.
  bb.susp = view.suspicion;
  bb.max = view.suspicionMax;
  bb.recentRise = (view.suspicionHistory || []).filter((h) => h.round >= view.round - 1 && h.delta > 0).reduce((a, h) => a + h.delta, 0);
  // My discovery-roll modifiers from research: a roll bonus (Discreet Methods) and any flat cut.
  const sumKind = (copies, kind) => researchEffects(cfg, copies, (e) => e.kind === kind).reduce((a, e) => a + (e.amount ?? 1), 0);
  bb.discoveryMods = (copies = me.effectiveResearch) => ({ rollBonus: sumKind(copies, 'discoveryRollBonus'), reduction: sumKind(copies, 'suspicionReduction') });
  bb.mods = bb.discoveryMods();
  bb.expSusp = (id) => expectedDiscovery(cfg.actions[id], bb.mods);
  bb.maxSusp = (id) => maxDiscovery(cfg.actions[id], bb.mods);
  // Room left before the mob.
  bb.room = bb.max - bb.susp;

  // Body. The plan is the best part for every slot among installed and loose
  // parts together. Installed parts left out of the plan are discarded by an
  // experiment (the only way to empty a slot); loose parts left out are spares.
  bb.slotTypes = {};
  for (const [type, def] of Object.entries(cfg.partTypes)) for (const sl of def.slots) bb.slotTypes[sl] = type;
  bb.copies = { ...me.effectiveResearch };
  bb.partScore = (variantId) => variantMean(cfg, variantId, 'vitality') + 2.5 * variantMean(cfg, variantId, 'humanity');
  const installed = Object.values(me.body).filter(Boolean);
  const makePlan = (extra = []) => {
    const plan = [];
    const missing = {};
    for (const [type, def] of Object.entries(cfg.partTypes)) {
      const cands = [
        ...installed.filter((x) => x.type === type).map((x) => ({ ...x, installed: true })),
        ...me.loose.filter((x) => x.type === type),
        ...extra.filter((x) => x.type === type),
      ].sort((a, b) => bb.partScore(b.variantId) - bb.partScore(a.variantId) || (b.installed ? 1 : 0) - (a.installed ? 1 : 0));
      plan.push(...cands.slice(0, def.slots.length));
      missing[type] = Math.max(0, def.slots.length - cands.length);
    }
    return { plan, missing, missingTotal: Object.values(missing).reduce((a, b) => a + b, 0) };
  };
  const base = makePlan();
  bb.plan = base.plan;
  bb.missing = base.missing;
  bb.missingTotal = base.missingTotal;
  bb.planComplete = base.missingTotal === 0;
  const inPlan = new Set(bb.plan.map((x) => x.id));
  bb.discards = installed.filter((x) => !inPlan.has(x.id)); // installed, to be replaced
  bb.toAssemble = me.loose.filter((x) => inPlan.has(x.id)); // loose, to be installed
  bb.spares = me.loose.filter((x) => !inPlan.has(x.id)).sort((a, b) => bb.partScore(a.variantId) - bb.partScore(b.variantId));
  bb.utility = (odds) => (odds ? odds.pStable - bb.P.unleashWeight * odds.pMonster * bb.pEscape() : 0);
  bb.planOdds = () => (bb.planComplete ? bodyOdds(cfg, bb.plan.map((x) => x.variantId), bb.copies) : null);
  // Expected gain in utility from one more part of a type, its variant random.
  bb.typeGain = (type) => {
    if (!bb.planComplete) return 0;
    const u0 = bb.utility(bb.planOdds());
    const vids = Object.keys(cfg.partVariants).filter((v) => cfg.partVariants[v].type === type);
    let g = 0;
    for (const v of vids) {
      const alt = makePlan([{ id: 'hypothetical', type, variantId: v }]);
      g += Math.max(0, bb.utility(bodyOdds(cfg, alt.plan.map((x) => x.variantId), bb.copies)) - u0);
    }
    return g / vids.length;
  };

  // Rivals.
  const partsTowards = (p) => {
    let n = 0;
    for (const [type, def] of Object.entries(cfg.partTypes)) {
      const filled = def.slots.filter((sl) => p.body[sl] !== null).length;
      n += Math.min(def.slots.length, filled + p.loose.filter((x) => x.type === type).length);
    }
    return n;
  };
  bb.rivalProgress = rivals.map((p) => ({ p, parts: partsTowards(p) }));
  bb.rivalsNear = bb.rivalProgress.filter((r) => r.parts >= bb.P.garrisonAt).length;
  // The best stable odds among rivals' complete bodies.
  bb.rivalThreat = Math.max(0, ...rivals.map((p) => (p.resurrectionOdds ? p.resurrectionOdds.pStable : 0)));
  bb.rivalsComplete = rivals.filter((p) => p.bodyComplete).length;
  bb.prepared = view.prepared || [];
  // Rivals who could still prepare tonight: a Scientist free, not passed,
  // not yet prepared, and a body that is or can be completed tonight.
  bb.rivalsWhoCouldPrepare = rivals.filter((p) => !p.passed && !bb.prepared.includes(p.id)
    && p.workers.some((w) => w.kind === 'scientist' && w.availableNow) && partsTowards(p) >= 6);
  bb.iPrepared = bb.prepared.includes(me.id);

  // My control: the chance that a monster of mine gets subdued.
  bb.pEscape = () => {
    const vs = (p) => (p.controlChanceVs ? p.controlChanceVs[me.id] : p.controlChance);
    let esc = me.controlAttempts > 0 ? 1 - vs(me) : 1;
    for (const p of rivals) if ((p.canSubdueOthers ?? p.garrisoned) && p.controlAttempts > 0) esc *= 1 - 0.75 * vs(p);
    return esc;
  };

  bb.controlChance = (copies) => chance(cfg.control.baseDie, cfg.control.threshold, researchEffects(cfg, copies, (e) => e.kind === 'control'));
  // Research wants: what each type is worth to me now.
  bb.researchValue = (type) => {
    if (me.research.includes(type)) return -Infinity;
    const def = cfg.research[type];
    let v = 0;
    const with1 = { ...bb.copies, [type]: (bb.copies[type] || 0) + 1 };
    // Resurrection value: improvement of a typical body's stable odds.
    if (def.effects.some((e) => e.kind === 'resurrection')) {
      const base = bodyOdds(cfg, bb.typicalBody(), bb.copies);
      const up = bodyOdds(cfg, bb.typicalBody(), with1);
      v += 40 * (up.pStable - base.pStable) + 15 * (up.pH - base.pH);
    }
    // Control: a better roll stops my monsters and rivals' (an Unleasher's
    // above all). Fewer hunters at the table make my own roll matter more.
    if (def.effects.some((e) => e.kind === 'control')) {
      v += bb.P.controlValue * (bb.controlChance(with1) - bb.controlChance(bb.copies)) * (4 / rivals.length);
    }
    for (const e of def.effects) {
      if (e.kind === 'controlAttempts') v += me.controlAttempts <= 1 ? 2 : 0.5;
      // Research on discovery rolls: worth a lot if it makes robbing graves
      // free of suspicion (my night work then costs nothing), otherwise what
      // the suspicion it avoids is worth.
      if (e.kind === 'suspicionReduction' || e.kind === 'discoveryRollBonus') {
        const quietNow = maxDiscovery(cfg.actions.graves, bb.mods) === 0;
        const quietWith = maxDiscovery(cfg.actions.graves, bb.discoveryMods(with1)) === 0;
        v += !quietNow && quietWith ? bb.P.discretionValue : bb.P.tableScale * researchWorth({ ...cfg, research: { [type]: { effects: [e] } } }, type, 'prometheus').want;
      }
      if (e.kind === 'medicineBonus') v += Math.max(0, 1.5 - view.round * 0.2);
    }
    // Every other effect kind is valued by the shared table (effect-values.js),
    // so the tree gets a sensible value for new kinds without new code.
    v += bb.P.tableScale * researchWorthExcept(cfg, type, 'prometheus', MODELLED_KINDS).want;
    return v;
  };
  // The planned body, with ordinary parts where it still lacks one.
  bb.typicalBody = () => {
    const out = bb.plan.map((x) => x.variantId);
    for (const [type, n] of Object.entries(bb.missing)) {
      const plain = Object.keys(cfg.partVariants).find((v) => cfg.partVariants[v].type === type && cfg.partVariants[v].effects.length === 0);
      for (let i = 0; i < n; i++) out.push(plain);
    }
    return out;
  };
  return bb;
}

// ---------------------------------------------------------------------------
// Leaves
// ---------------------------------------------------------------------------

// Tunable numbers; experiments override them with `params`.
export const PARAMS = {
  // Attempting a resurrection.
  attemptMinStable: 0.15, // least stable chance worth an attempt
  unleashWeight: 1.5, // an unleashing loses: weight against a stable win
  unleashRatio: 3, // stable odds must be this many times the unleash odds
  threatLevel: 0.15, // a rival body this likely to stabilize is a threat...
  threatDiscount: 0.6, // ...and lowers my bar by this factor
  joinBar: 0.05, // bar when a promising rival has already prepared tonight
  stall: true, // spend Igor turns so rivals must decide before I prepare
  prepareUnderThreat: true, // prepare even if a rival could still join
  // Suspicion.
  dangerRoom: 3, // charity when the mob is this close
  riskRoom: 3, // no risky night actions when the mob is this close
  // Economy and purchases.
  hireUntilRound: 5,
  researchMin: 1.5, // least value of a purchase...
  researchMinRich: 0.4, // ...or this, when holding richMoney or more
  richMoney: 8,
  moneyEnough: 14, // stop practising medicine with this much money
  researchBuffer: 1, // money kept after research
  missingPartValue: 4, // a part the body still lacks, divided by its type's draw weight
  gainScale: 40, // value of one unit of body utility
  controlValue: 12, // value of a whole control chance, at five players
  discretionValue: 6, // value of research that makes robbing graves free of suspicion
  tableScale: 0.5, // the shared effect table's money values, in the tree's units
  // Night work.
  gravesGain: 0.01, // least utility two random parts must add
  gravesReserveBelow: 6, // keep an Igor for graves while this few parts are missing
  quietNightJobs: 3, // Igors kept for suspicion-free night work
  contestedFirst: true, // capped spaces before unlimited work
  garrisonAt: 5, // garrison when a rival holds this many parts towards a body
};

function pickResearch(bb) {
  const pick = bb.view.pendingPick;
  const typeOf = (id) => pick.cards.find((k) => k.id === id).type;
  let best = null;
  let bestV = -Infinity;
  for (const c of bb.legal) {
    const v = bb.researchValue(typeOf(c.cardId));
    if (v > bestV) { bestV = v; best = c; }
  }
  return best;
}

function subdueDecision(bb) {
  // My own monster must be stopped; anyone else's unleashing loses the game
  // for me too, and declining adds suspicion. A failed try costs nothing
  // but the attempt.
  return bb.legal.find((c) => c.subdue === true) || bb.legal[0];
}

function attemptWorthIt(bb, odds) {
  if (!odds) return false;
  const pUnleash = odds.pMonster * bb.pEscape();
  // A failed Vitality adds suspicion: not when it would bring the mob.
  if (bb.room <= bb.cfg.resurrection.failedVitalitySuspicion) return false;
  // A rival about to attempt makes waiting for better odds costly.
  let bar = bb.rivalThreat >= bb.P.threatLevel ? bb.P.attemptMinStable * bb.P.threatDiscount : bb.P.attemptMinStable;
  // A rival committed tonight: if it stabilizes I lose whether or not I try,
  // so joining costs nothing against it.
  if (bb.view.phase === 'night' && bb.rivals.some((p) => bb.prepared.includes(p.id) && p.resurrectionOdds && p.resurrectionOdds.pStable > 0.1)) bar = Math.min(bar, bb.P.joinBar);
  return odds.pStable >= bar && odds.pStable >= bb.P.unleashRatio * pUnleash;
}

// Day purchases share one scale: research by its value, specimens by the
// utility they add to the planned body (a missing part is worth a lot).
function purchases(bb) {
  const out = [];
  const rc = bb.cfg.actions.research.cost;
  if (bb.me.money >= rc + bb.P.researchBuffer) {
    for (const k of bb.view.market) {
      if (bb.me.research.includes(k.type)) continue;
      out.push({ actionId: 'research', choices: { researchCardId: k.id }, value: bb.researchValue(k.type), cost: rc });
    }
  }
  const sc = bb.cfg.actions.specimens.cost;
  if (bb.me.money >= sc) {
    for (const t of Object.keys(bb.cfg.partTypes)) {
      const v = bb.missing[t] > 0 ? bb.P.missingPartValue / bb.cfg.partTypes[t].weight : bb.P.gainScale * bb.typeGain(t);
      out.push({ actionId: 'specimens', choices: { partTypes: [t] }, value: v, cost: sc });
    }
  }
  const min = bb.me.money >= bb.P.richMoney ? bb.P.researchMinRich : bb.P.researchMin;
  return out.filter((x) => x.value >= min).sort((a, b) => b.value / b.cost - a.value / a.cost);
}

function buyCmd(bb, kind) {
  for (const x of purchases(bb)) {
    const c = bb.place(x.actionId, kind, x.choices);
    if (c && bb.isLegal(c)) return c;
  }
  return null;
}

// Assemble the plan's loose parts once the plan is complete and nothing
// installed still has to be discarded.
function assembleCmd(bb, kind) {
  if (!bb.planComplete || bb.discards.length || !bb.toAssemble.length) return null;
  return bb.place('assemble', kind, { partIds: bb.toAssemble.map((p) => p.id) });
}

// Discard installed parts the plan replaces, plus the worst spares.
function discardCmd(bb, kind) {
  if (!bb.planComplete || !bb.discards.length) return null;
  const max = Math.min(bb.cfg.actions.experiment.maxParts, bb.view.deckCount);
  if (max < bb.discards.length) return null;
  const ids = [...bb.discards, ...bb.spares].slice(0, max).map((p) => p.id);
  return bb.place('experiment', kind, { partIds: ids });
}

function experimentCmd(bb, kind) {
  const n = Math.min(bb.cfg.actions.experiment.maxParts, bb.spares.length, bb.view.deckCount);
  if (n < 1) return null;
  return bb.place('experiment', kind, { partIds: bb.spares.slice(0, n).map((p) => p.id) });
}

function sellCmd(bb, kind) {
  const n = bb.cfg.actions.sell.parts;
  if (bb.spares.length < n) return null;
  return bb.place('sell', kind, { partIds: bb.spares.slice(0, n).map((p) => p.id) });
}

const pass = (bb) => ({ type: 'PASS_TURN', playerId: bb.me.id });

// ---------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------

// Safe: the roll can't add suspicion, or the mob stays far enough off even if it does.
const safe = (id) => (bb) => bb.maxSusp(id) === 0 || bb.room - bb.maxSusp(id) >= bb.P.riskRoom;
const quiet = (id) => (bb) => bb.maxSusp(id) === 0;
const gravesUseful = (bb) => bb.missingTotal > 0 || quiet('graves')(bb) || (bb.planComplete
  && Object.entries(bb.cfg.partTypes).reduce((a, [t, d]) => a + d.weight * bb.typeGain(t), 0)
    / Object.values(bb.cfg.partTypes).reduce((a, d) => a + d.weight, 0) * bb.cfg.actions.graves.parts >= bb.P.gravesGain);
// Night jobs for Igors: work the plan needs before an attempt, and graves
// while parts are missing.
const nightIgorJobs = (bb) => {
  let jobs = 0;
  if (bb.planComplete && bb.discards.length) jobs += 1;
  if (bb.planComplete && bb.toAssemble.length) jobs += 1;
  if (bb.missingTotal > 0 && bb.missingTotal <= bb.P.gravesReserveBelow) jobs += 1;
  // Quiet night work is worth more than a day's wages: keep every Igor.
  if (quiet('graves')(bb)) jobs += bb.P.quietNightJobs;
  // With a body to attempt the Scientist prepares; otherwise it takes a job.
  const sciBusy = bb.planComplete && attemptWorthIt(bb, bb.planOdds());
  return Math.max(0, jobs - (sciBusy ? 0 : 1));
};
const igorSpare = (bb) => bb.freeIgors > (bb.view.phase === 'day' ? nightIgorJobs(bb) : 0);
// The Scientist acts in both phases; Igors by day only when not needed tonight.
const both = (name, make) => selector(name,
  action(`${name} (scientist)`, (bb) => make(bb, 'scientist')),
  sequence(`${name} (igor)`, condition('igor spare', igorSpare), action(`${name} igor`, (bb) => make(bb, 'igor'))));
const igor = (name, make) => action(`${name} (igor)`, (bb) => make(bb, 'igor'));
const sci = (name, make) => action(`${name} (scientist)`, (bb) => make(bb, 'scientist'));

const dayTree = selector('day',
  guard('emergency charity', (bb) => bb.room <= bb.P.dangerRoom + Math.max(0, bb.recentRise - 2) && bb.me.money >= bb.cfg.actions.charity.cost,
    both('charity', (bb, k) => bb.place('charity', k))),
  guard('garrison', (bb) => bb.rivalsNear > 0 && bb.me.controlAttempts > 0 && !bb.me.garrisoned && bb.freeIgors > 0,
    action('garrison igor', (bb) => bb.place('garrison', 'igor'))),
  guard('hire', (bb) => bb.igorCount < bb.cfg.maxIgors && bb.view.round <= bb.P.hireUntilRound && bb.me.money >= bb.cfg.actions.hire.cost,
    both('hire', (bb, k) => bb.place('hire', k))),
  both('buy', buyCmd),
  // Earn only while money is short: beyond what the next rounds can spend, more is pointless.
  guard('money short', (bb) => bb.me.money < bb.P.moneyEnough, both('medicine', (bb, k) => bb.place('medicine', k))),
  action('pass', pass),
);

// The body is ready to attempt tonight if the plan is complete, worth it, and
// my free Igors can do the discarding and assembling first.
const readyTonight = (bb) => {
  if (bb.iPrepared || !bb.sciFree || !bb.planComplete) return false;
  const work = (bb.discards.length ? 1 : 0) + (bb.toAssemble.length ? 1 : 0);
  return work <= bb.freeIgors && attemptWorthIt(bb, bb.planOdds());
};
// Prepare as late as possible: a rival who could still prepare (a Visionary
// waiting to join) sees my commitment only once it can no longer act on it.
const rivalsCanStillJoin = (bb) => bb.rivalsWhoCouldPrepare.length > 0;

// Igors needed tonight to ready the body: discarding, then assembling.
const requiredWork = (bb) => (bb.planComplete ? (bb.discards.length ? 1 : 0) + (bb.toAssemble.length ? 1 : 0) : 0);
const contestedIgor = (bb) => bb.freeIgors > (bb.P.contestedFirst ? requiredWork(bb) : bb.freeIgors);
// Capped spaces fill up, so Igors take them before the unlimited work
// (assembling, preparing) that can wait until later in the night.
const igorJobs = selector('igor jobs',
  guard('contested', contestedIgor,
    guard('graves', (bb) => gravesUseful(bb) && safe('graves')(bb), igor('graves', (bb, k) => bb.place('graves', k))),
    guard('experiment', (bb) => bb.spares.length > 0 && safe('experiment')(bb), igor('experiment', experimentCmd)),
    guard('sell', (bb) => (bb.me.money < 6 || quiet('sell')(bb)) && bb.spares.length >= 2 && safe('sell')(bb), igor('sell', sellCmd))),
  igor('discard', discardCmd),
  igor('assemble', assembleCmd),
  guard('graves', (bb) => gravesUseful(bb) && safe('graves')(bb), igor('graves', (bb, k) => bb.place('graves', k))),
  guard('experiment', (bb) => bb.spares.length > 0 && safe('experiment')(bb), igor('experiment', experimentCmd)),
  guard('sell', (bb) => bb.me.money < 6 && bb.spares.length >= 2 && safe('sell')(bb), igor('sell', sellCmd)),
  igor('rest', (bb, k) => bb.place('rest', k)),
);

// Moves that only use up a turn, cheapest first, so the Scientist can wait.
const stall = selector('stall',
  igor('rest', (bb, k) => bb.place('rest', k)),
  igor('assemble', (bb, k) => (bb.planComplete && !bb.discards.length && bb.toAssemble.length ? bb.place('assemble', k, { partIds: bb.toAssemble.map((p) => p.id) }) : null)),
  guard('sell', (bb) => bb.spares.length >= 2 && safe('sell')(bb), igor('sell', sellCmd)),
  guard('experiment', (bb) => bb.spares.length > 0 && safe('experiment')(bb), igor('experiment', experimentCmd)),
  guard('graves', (bb) => safe('graves')(bb), igor('graves', (bb, k) => bb.place('graves', k))));

const prepare = sci('prepare', (bb, k) => bb.place('prepare', k));
const nightTree = selector('night',
  guard('attempt tonight', readyTonight,
    selector('attempt',
      sequence('nobody can join', condition('no rival can still prepare', (bb) => !rivalsCanStillJoin(bb)), prepare),
      igorJobs,
      guard('wait for rivals', (bb) => bb.P.stall, stall),
      sequence('join risk acceptable', condition('accept join risk', (bb) => bb.P.prepareUnderThreat), prepare))),
  // Already prepared: Igors finish the body.
  igorJobs,
  selector('scientist jobs',
    sci('discard', discardCmd),
    sci('assemble', assembleCmd),
    guard('graves', (bb) => gravesUseful(bb) && safe('graves')(bb), sci('graves', (bb, k) => bb.place('graves', k))),
    guard('experiment', (bb) => bb.spares.length > 0 && safe('experiment')(bb), sci('experiment', experimentCmd)),
    guard('sell', (bb) => bb.me.money < 6 && bb.spares.length >= 2 && safe('sell')(bb), sci('sell', sellCmd)),
    sci('rest', (bb, k) => bb.place('rest', k))),
  action('pass', pass),
);

export const prometheusTree = selector('prometheus',
  guard('pick research', (bb) => !!bb.view.pendingPick, action('keep best card', pickResearch)),
  guard('control chain', (bb) => bb.view.phase === 'resolution' && !!bb.view.control, action('subdue?', subdueDecision)),
  guard('day', (bb) => bb.view.phase === 'day', dayTree),
  guard('night', (bb) => bb.view.phase === 'night', nightTree),
  action('fallback', (bb) => bb.legal[0]),
);

/** The behaviour-tree Prometheus policy. */
export function btPrometheusPolicy(seed = 'bt-prometheus', { trace = null, params = {} } = {}) {
  const P = { ...PARAMS, ...params };
  const fallback = heuristicPolicy(seed);
  const log = [];
  return {
    name: 'bt-prometheus',
    log, // the odds of every attempt this policy committed to, for experiments
    decide(input) {
      const { view, legal } = input;
      if (view.private.objective !== 'prometheus') return fallback.decide(input);
      const bb = buildBlackboard(view, legal, P);
      if (trace) bb.trace = [];
      prometheusTree.tick(bb);
      if (bb.command && bb.command.actionId === 'prepare') {
        const o = bb.planOdds();
        log.push({ round: view.round, pStable: o.pStable, pH: o.pH, pV: o.pV, pEscape: bb.pEscape() });
      }
      if (trace) {
        const o = bb.planOdds();
        const state = `money ${bb.me.money} susp ${bb.susp} loose ${bb.me.loose.length} missing ${bb.missingTotal} igors ${bb.igorCount} research ${bb.me.research.join('/')}`
          + (o ? ` plan pS ${o.pStable.toFixed(2)} pH ${o.pH.toFixed(2)} pV ${o.pV.toFixed(2)}` : '');
        const rivals = bb.rivals.map((r) => `${r.id}:${bb.rivalProgress.find((x) => x.p.id === r.id).parts}p${r.resurrectionOdds ? `/pS${r.resurrectionOdds.pStable.toFixed(2)}` : ''}`).join(' ');
        trace({ round: view.round, phase: view.phase, trace: bb.trace, command: bb.command, state: `${state} | ${rivals}` });
      }
      return bb.command || legal[0];
    },
  };
}
