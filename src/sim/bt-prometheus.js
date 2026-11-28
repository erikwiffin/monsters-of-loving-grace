// A behaviour-tree policy for the Prometheus objective (experimental).
//
// Like every policy (spec 014) it sees only its player view and the legal
// commands, and never authoritative state. Legality comes from the engine's
// legal-command templates. Bodies are planned from the hand with the shared
// body planner (body-plan.js), which computes exact Humanity odds.
//
// The tree, ticked once per decision:
//   prometheus
//   ├─ pick part       keep the drawn specimen that improves my body most
//   ├─ control chain   always try to subdue (an unleashing loses for me too)
//   ├─ day             charity in danger › garrison › hire › buy (research or
//   │                  specimens, on one value scale) › medicine
//   └─ night           attempt tonight (contested Igor work first, then
//                      prepare, stalling so rivals commit first) › Igor jobs
//                      › Scientist jobs › pass
//
// Outside the Prometheus objective it defers to the heuristic.

import { selector, sequence, condition, action, guard } from './bt.js';
import { heuristicPolicy } from './policies.js';
import { scienceWorth, deckMix } from './effect-values.js';
import { planBody, scienceStats, partMix, expectedMax } from './body-plan.js';

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
    for (const [key, c] of Object.entries(t.choiceConstraints || {})) {
      const v = cmd.choices && cmd.choices[key];
      if (c.type === 'enum' && !c.values.includes(v)) return false;
      if (c.type === 'subset' && (!Array.isArray(v) || v.length < c.min || v.length > c.max || new Set(v).size !== v.length || v.some((x) => !c.values.includes(x)))) return false;
    }
    return true;
  };
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

  // Suspicion: every risky night action adds a known amount.
  bb.susp = view.suspicion;
  bb.max = view.suspicionMax;
  bb.room = bb.max - bb.susp;
  bb.recentRise = (view.suspicionHistory || []).filter((h) => h.round >= view.round - 1 && h.delta > 0).reduce((a, h) => a + h.delta, 0);
  bb.adds = (id) => (cfg.actions[id] && cfg.actions[id].suspicion) || 0;

  // Body.
  bb.sci = scienceStats(cfg, me.science);
  bb.plan = planBody(cfg, me.hand, bb.sci, { sign: 1 });
  bb.T = cfg.resurrection.thresholds.vitality;
  bb.planReady = bb.plan.ok;
  bb.inPlan = new Set(bb.plan.ids || []);
  // Utility of a hand: a ready body by its stable chance, otherwise progress towards one.
  const utility = (hand) => {
    const p = planBody(cfg, hand, bb.sci, { sign: 1 });
    if (p.missing) return -P.missingPart * p.missing - P.vitalityPoint * Math.max(0, bb.T - p.vitality);
    return (p.ok ? P.readyBonus : -P.vitalityPoint * (bb.T - p.vitality)) + P.stableValue * p.pStable;
  };
  bb.utility = utility(me.hand);
  bb.gain = (parts) => utility([...me.hand, ...parts]) - bb.utility;
  // Spares: parts outside the plan, worst first.
  const solo = (x) => bb.gain([]) - (utility(me.hand.filter((y) => y.id !== x.id)) - bb.utility);
  bb.spares = me.hand.filter((x) => !bb.inPlan.has(x.id)).sort((a, b) => solo(a) - solo(b));
  const mix = partMix(cfg).map(({ variantId, weight }) => ({ value: bb.gain([{ id: `probe-${variantId}`, variantId, type: cfg.partVariants[variantId].type }]), weight }));
  bb.randomPartGain = mix.reduce((a, x) => a + x.value * x.weight, 0);
  bb.specimenGain = (n) => expectedMax(mix, n);
  bb.scienceValue = (t) => scienceWorth(cfg, t, 'prometheus').want;
  bb.randomCardValue = deckMix(view).reduce((a, x) => a + x.weight * bb.scienceValue(x.type), 0);

  // Monsters: chance nobody subdues mine.
  bb.pEscape = () => view.players.reduce((a, p) => a * (p.garrisoned || (p.id === me.id && p.subdueOwn) ? 1 - 0.8 * p.controlChance : 1), 1);
  bb.prepared = view.prepared || [];
  bb.iPrepared = bb.prepared.includes(me.id);
  bb.rivalsNear = rivals.filter((p) => (p.bestVitality ?? -Infinity) >= bb.T - P.garrisonGap).length;
  bb.rivalThreat = Math.max(0, ...rivals.map((p) => (p.resurrectionOdds ? p.resurrectionOdds.pStable : 0)));
  bb.rivalsWhoCouldPrepare = rivals.filter((p) => (p.bestVitality ?? -Infinity) >= bb.T && !p.passed && !bb.prepared.includes(p.id)
    && p.workers.some((w) => w.kind === 'scientist' && w.availableNow));
  return bb;
}

// ---------------------------------------------------------------------------
// Leaves
// ---------------------------------------------------------------------------

// Tunable numbers; experiments override them with `params`.
export const PARAMS = {
  attemptMinStable: 0.15, // least stable chance worth an attempt
  unleashRatio: 3, // stable odds must be this many times the unleash odds
  threatLevel: 0.15, // a rival body this likely to stabilize is a threat...
  threatDiscount: 0.6, // ...and lowers my bar by this factor
  joinBar: 0.05, // bar when a promising rival has already prepared tonight
  stall: true, // spend Igor turns so rivals must decide before I prepare
  prepareUnderThreat: true, // prepare even if a rival could still join
  dangerRoom: 3, // charity or vespers when the mob is this close
  riskRoom: 3, // no risky night actions when the mob is this close
  hireUntilRound: 5,
  buyMin: 1.5, // least value of a purchase...
  buyMinRich: 0.4, // ...or this, when holding richMoney or more
  richMoney: 8,
  moneyEnough: 14, // stop practising medicine with this much money
  missingPart: 4, // utility of a part the full set still lacks
  vitalityPoint: 1.2, // utility of a Vitality point short of the threshold
  readyBonus: 4, // utility of a body that can be prepared
  stableValue: 20, // utility of a whole stable chance
  gravesGain: 0.3, // least utility two random parts must add
  garrisonGap: 3, // garrison when a rival's best body is this close to the threshold
};

function pickPart(bb) {
  let best = null;
  let bestV = -Infinity;
  for (const c of bb.legal) {
    const v = bb.gain([bb.view.pendingPick.parts.find((x) => x.id === c.partId)]);
    if (v > bestV) { bestV = v; best = c; }
  }
  return best;
}

const subdueDecision = (bb) => bb.legal.find((c) => c.subdue === true) || bb.legal[0];

function attemptWorthIt(bb, pStable) {
  const pUnleash = (1 - pStable) * bb.pEscape();
  let bar = bb.rivalThreat >= bb.P.threatLevel ? bb.P.attemptMinStable * bb.P.threatDiscount : bb.P.attemptMinStable;
  if (bb.view.phase === 'night' && bb.rivals.some((p) => bb.prepared.includes(p.id) && p.resurrectionOdds && p.resurrectionOdds.pStable > 0.1)) bar = Math.min(bar, bb.P.joinBar);
  return pStable >= bar && pStable >= bb.P.unleashRatio * pUnleash;
}

// Day purchases share one scale: science by its value, specimens by the
// utility the best of their draw adds to my body.
function purchases(bb) {
  const out = [];
  const rc = bb.cfg.actions.research && bb.cfg.actions.research.cost;
  if (rc != null && bb.me.money >= rc) for (const k of bb.view.market) out.push({ actionId: 'research', choices: { researchCardId: k.id }, value: bb.scienceValue(k.type), cost: rc });
  const sp = bb.cfg.actions.specimens;
  if (sp && bb.me.money >= sp.cost) out.push({ actionId: 'specimens', choices: {}, value: bb.specimenGain(sp.draw), cost: sp.cost });
  const min = bb.me.money >= bb.P.richMoney ? bb.P.buyMinRich : bb.P.buyMin;
  return out.filter((x) => x.value >= min).sort((a, b) => b.value / Math.max(1, b.cost) - a.value / Math.max(1, a.cost));
}

function buyCmd(bb, kind) {
  for (const x of purchases(bb)) {
    const c = bb.place(x.actionId, kind, x.choices);
    if (c && bb.isLegal(c)) return c;
  }
  return null;
}

const spareIds = (bb, n) => (bb.spares.length >= n ? bb.spares.slice(0, n).map((p) => p.id) : null);
function experimentCmd(bb, kind) {
  const ex = bb.cfg.actions.experiment;
  const ids = ex && bb.view.deckCount > 0 && spareIds(bb, ex.parts);
  return ids ? bb.place('experiment', kind, { partIds: ids }) : null;
}
function sellCmd(bb, kind) {
  const ids = bb.cfg.actions.sell && spareIds(bb, bb.cfg.actions.sell.parts);
  return ids ? bb.place('sell', kind, { partIds: ids }) : null;
}
const prepareCmd = (bb, kind) => (bb.planReady ? bb.place('prepare', kind, { partIds: bb.plan.ids }) : null);
const pass = (bb) => ({ type: 'PASS_TURN', playerId: bb.me.id });

// ---------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------

const safe = (id) => (bb) => bb.adds(id) === 0 || bb.room - bb.adds(id) >= bb.P.riskRoom;
const danger = (bb) => bb.room <= bb.P.dangerRoom + Math.max(0, bb.recentRise - 2);
const gravesUseful = (bb) => bb.cfg.actions.graves && bb.cfg.actions.graves.parts * bb.randomPartGain >= bb.P.gravesGain;
// Night jobs for Igors, so the day keeps enough of them back.
const nightIgorJobs = (bb) => (gravesUseful(bb) ? 1 : 0) + (bb.spares.length >= 2 ? 1 : 0) - (bb.planReady && attemptWorthIt(bb, bb.plan.pStable) ? 0 : 1);
const igorSpare = (bb) => bb.freeIgors > (bb.view.phase === 'day' ? Math.max(0, nightIgorJobs(bb)) : 0);
const both = (name, make) => selector(name,
  action(`${name} (scientist)`, (bb) => make(bb, 'scientist')),
  sequence(`${name} (igor)`, condition('igor spare', igorSpare), action(`${name} igor`, (bb) => make(bb, 'igor'))));
const igor = (name, make) => action(`${name} (igor)`, (bb) => make(bb, 'igor'));
const sci = (name, make) => action(`${name} (scientist)`, (bb) => make(bb, 'scientist'));

const dayTree = selector('day',
  guard('emergency charity', (bb) => danger(bb) && bb.cfg.actions.charity && bb.me.money >= bb.cfg.actions.charity.cost,
    both('charity', (bb, k) => bb.place('charity', k))),
  guard('garrison', (bb) => (bb.rivalsNear > 0 || bb.planReady) && !bb.me.garrisoned && bb.freeIgors > 0,
    action('garrison igor', (bb) => bb.place('garrison', 'igor'))),
  guard('hire', (bb) => bb.cfg.actions.hire && bb.igorCount < bb.cfg.maxIgors && bb.view.round <= bb.P.hireUntilRound && bb.me.money >= bb.cfg.actions.hire.cost,
    both('hire', (bb, k) => bb.place('hire', k))),
  both('buy', buyCmd),
  guard('money short', (bb) => bb.me.money < bb.P.moneyEnough, both('medicine', (bb, k) => bb.place('medicine', k))),
  action('pass', pass),
);

const readyTonight = (bb) => !bb.iPrepared && bb.sciFree && bb.planReady && attemptWorthIt(bb, bb.plan.pStable);
const rivalsCanStillJoin = (bb) => bb.rivalsWhoCouldPrepare.length > 0;

const igorJobs = selector('igor jobs',
  guard('vespers', danger, igor('vespers', (bb, k) => bb.place('vespers', k))),
  guard('graves', (bb) => gravesUseful(bb) && safe('graves')(bb), igor('graves', (bb, k) => bb.place('graves', k))),
  guard('experiment', (bb) => bb.randomCardValue > 0.5 && safe('experiment')(bb), igor('experiment', experimentCmd)),
  guard('sell', (bb) => bb.me.money < 6 && safe('sell')(bb), igor('sell', sellCmd)),
  igor('rest', (bb, k) => bb.place('rest', k)),
);

// Moves that only use up a turn, cheapest first, so the Scientist can wait.
const stall = selector('stall',
  igor('rest', (bb, k) => bb.place('rest', k)),
  guard('vespers', (bb) => bb.susp > 0, igor('vespers', (bb, k) => bb.place('vespers', k))),
  guard('sell', safe('sell'), igor('sell', sellCmd)),
  guard('experiment', safe('experiment'), igor('experiment', experimentCmd)));

const prepare = sci('prepare', prepareCmd);
const nightTree = selector('night',
  guard('attempt tonight', readyTonight,
    selector('attempt',
      sequence('nobody can join', condition('no rival can still prepare', (bb) => !rivalsCanStillJoin(bb)), prepare),
      igorJobs,
      guard('wait for rivals', (bb) => bb.P.stall, stall),
      sequence('join risk acceptable', condition('accept join risk', (bb) => bb.P.prepareUnderThreat), prepare))),
  igorJobs,
  selector('scientist jobs',
    guard('vespers', danger, sci('vespers', (bb, k) => bb.place('vespers', k))),
    guard('graves', (bb) => gravesUseful(bb) && safe('graves')(bb), sci('graves', (bb, k) => bb.place('graves', k))),
    guard('experiment', (bb) => bb.randomCardValue > 0.5 && safe('experiment')(bb), sci('experiment', experimentCmd)),
    guard('sell', (bb) => bb.me.money < 6 && safe('sell')(bb), sci('sell', sellCmd)),
    sci('rest', (bb, k) => bb.place('rest', k))),
  action('pass', pass),
);

export const prometheusTree = selector('prometheus',
  guard('pick part', (bb) => !!bb.view.pendingPick, action('keep best part', pickPart)),
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
      if (bb.command && bb.command.actionId === 'prepare') log.push({ round: view.round, pStable: bb.plan.pStable, vitality: bb.plan.vitality, pEscape: bb.pEscape() });
      if (trace) {
        const state = `money ${bb.me.money} susp ${bb.susp} hand ${bb.me.hand.length} missing ${bb.plan.missing} vitality ${bb.plan.vitality} igors ${bb.igorCount} science ${bb.me.science.map((c) => c.type).join('/')}`
          + (bb.planReady ? ` plan pS ${bb.plan.pStable.toFixed(2)}` : '');
        const rivals = bb.rivals.map((r) => `${r.id}:best ${r.bestVitality ?? '-'}${r.resurrectionOdds ? `/pS${r.resurrectionOdds.pStable.toFixed(2)}` : ''}`).join(' ');
        trace({ round: view.round, phase: view.phase, trace: bb.trace, command: bb.command, state: `${state} | ${rivals}` });
      }
      // A command that isn't legal (a stale plan) falls back to the heuristic.
      if (!bb.command || !(bb.command.type !== 'PLACE_MEEPLE' || bb.isLegal(bb.command))) return fallback.decide(input);
      return bb.command;
    },
  };
}
