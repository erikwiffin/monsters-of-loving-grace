// Replaceable decision policies for headless playtests.
// A policy is any object with decide({ playerId, view, legal }) -> command.
// `view` is the engine's filtered player observation; `legal` is the
// expanded list of legal commands. Policies never see authoritative state.
// Policies may be async (return a Promise) — the async runner awaits them.

import { seedState, randInt, nextUint32 } from '../engine/rng.js';
import { effectMean, researchWorth } from './effect-values.js';

function makeRandom(seed) {
  const st = seedState(seed);
  return {
    int: (n) => randInt(st, n),
    float: () => nextUint32(st) / 0x100000000,
  };
}

/** Uniformly random legal command; passes only occasionally. */
export function randomPolicy(seed = 'random') {
  const r = makeRandom(seed);
  return {
    name: 'random',
    // Random play is not meant to be realistic, so runners don't stop it for hoarding.
    realistic: false,
    decide({ legal }) {
      const nonPass = legal.filter((c) => c.type !== 'PASS_TURN');
      if (nonPass.length && r.float() > 0.1) return nonPass[r.int(nonPass.length)];
      return legal[r.int(legal.length)];
    },
  };
}

const effectValue = effectMean;

// The Unleasher wants a body that lives but lacks Humanity.
function variantValue(cfg, variantId, objective) {
  const humanityWeight = objective === 'unleasher' ? -1.5 : 1.5;
  return cfg.partVariants[variantId].effects.reduce((a, e) => a + effectValue(e) * (e.attribute === 'vitality' ? 1 : humanityWeight), 0);
}

// Research is valued from its effects by the shared two-layer table
// (effect-values.js): what each effect kind does, and what that is worth to
// each objective, in money.

const UNLEASHER_MAX_STABLE = 0.05;
const VISIONARY_MIN_RIVALS = 3;
const GARRISON_ALERT_PARTS = 5; // installed plus fitting loose parts
const EXPECTED_ROUNDS = 9; // rough game length, for valuing a new worker

// Styles shift how much risk a heuristic player accepts (spec 016): suspicion
// costs more for a cautious player and less for a bold one, and their
// resurrection thresholds move the same way.
const STYLES = {
  standard: { suspicionCost: 1, attemptBar: 1 },
  cautious: { suspicionCost: 1.6, attemptBar: 1.4 },
  bold: { suspicionCost: 0.6, attemptBar: 0.7 },
};

/** Expected suspicion from an action's discovery roll, after Discreet Methods. */
function expectedSuspicion(def, reduction) {
  const r = def && def.suspicion;
  if (!r) return 0;
  let total = 0;
  for (let roll = 1; roll <= r.die; roll++) {
    const band = r.bands.find((b) => roll <= b.max);
    total += Math.max(0, (band ? band.amount : 0) - reduction);
  }
  return total / r.die;
}

/** Chance that an action's discovery roll adds at least `room` suspicion: the mob, if room is what is left. */
function mobChance(def, reduction, room) {
  const r = def && def.suspicion;
  if (!r || room <= 0) return 0;
  let hits = 0;
  for (let roll = 1; roll <= r.die; roll++) {
    const band = r.bands.find((b) => roll <= b.max);
    if (Math.max(0, (band ? band.amount : 0) - reduction) >= room) hits += 1;
  }
  return hits / r.die;
}
// What the mob forming is worth, in money: the game ends, lost for everyone
// but the Inquisitor (and won for it). The smooth suspicion price misses this.
const MOB_STAKE = 40;
// A part that completes the body (or nearly) is worth more than any other:
// it turns every other part into an attempt.
const COMPLETION_BONUS = 2;

/**
 * The heuristic's tunable numbers. Defaults are the hand-set values; a tuner
 * (bin/tune.mjs) searches them per objective. Each is a price in money or a
 * multiplier on one, so the policy still values actions from the
 * configuration's numbers (spec 016).
 */
export const DEFAULT_WEIGHTS = {
  suspicionCost: 1, // multiplies the price of a point of suspicion
  suspicionCurve: 8, // how steeply that price rises as the mob nears
  suspicionPace: 4, // how much fast-rising suspicion adds to it
  mobStake: MOB_STAKE, // what the mob forming is worth
  moneyScale: 1, // multiplies what money is worth
  spendFactor: 0.6, // share of a price felt when paying it
  partBase: 3, // a part the body still needs
  partQuality: 0.4, // per point of a part's effect on the odds
  completionBonus: COMPLETION_BONUS, // a part that (nearly) completes the body
  researchScale: 1, // multiplies research wants
  publishHarm: 1, // multiplies the cost of publishing to rivals
  denyScale: 0.8, // keeping a card from rivals, per unit of harm
  hireValue: 0.35, // a new Igor, per round of medicine it can work
  expectedRounds: EXPECTED_ROUNDS,
  igorReserve: 0.8, // share of tonight's job a day Igor gives up
  charityScale: 1.5, // multiplies the value of suspicion paid down
  garrisonValue: 4.5,
  garrisonAlert: GARRISON_ALERT_PARTS, // rival parts towards a body that call for a garrison
  assembleValue: 5,
  prepareValue: 12,
  attemptMinStable: 0.2, // least stable chance for an attempt...
  attemptLate: 0.1, // ...from round 12
  unleashFactor: 1.5, // stable odds must beat this many times the unleash odds
};

/**
 * Per-objective defaults over DEFAULT_WEIGHTS, for roles whose best weights
 * measurably beat the defaults when every seat of that role plays them
 * (bin/tune.mjs --deviators all; experiments/README.md). Weights tuned for a
 * single seat against a standard field are best responses, not defaults:
 * the first tuned Prometheus never garrisoned, which paid while others
 * hunted monsters and let Unleashers win far more once every Prometheus
 * played it. Those stay in experiments/tuned/ as challengers.
 */
export const OBJECTIVE_WEIGHTS = {};

/**
 * A greedy strategy that prices every option in money, using only its view,
 * the configuration's numbers and the engine's exact odds. Because values come
 * from the config, it adapts when a sweep changes costs, gains or suspicion.
 */
export function heuristicPolicy(seed = 'heuristic', { noise = 0.75, style = 'standard', igorBias = null, weights = {}, margin = 0, explain = null } = {}) {
  const r = makeRandom(seed);
  const st = STYLES[style] || STYLES.standard;
  // The weights for this decision: defaults, the objective's own, then the caller's.
  let W = { ...DEFAULT_WEIGHTS, ...weights };
  // Why the bot chose: every option with its score, broken into parts.
  const report = (kind, options, chosen) => {
    if (explain) explain({ kind, options, chosen });
    return chosen;
  };
  return {
    name: style === 'standard' ? 'heuristic' : style,
    decide({ view, legal }) {
      const me = view.players.find((p) => p.id === view.viewerId);
      const objective = view.private.objective;
      const cfg = view.config;
      W = { ...DEFAULT_WEIGHTS, ...(OBJECTIVE_WEIGHTS[objective] || {}), ...weights };
      // A special ability (stacks: false) is worthless to a player who already
      // has it through a rival's publication.
      const want = {};
      const publishPenalty = {};
      for (const t of Object.keys(cfg.research)) {
        const w = researchWorth(cfg, t, objective);
        const redundant = cfg.research[t].stacks === false && (me.effectiveResearch[t] || 0) >= 1;
        want[t] = redundant ? 0 : w.want;
        // Rivals who already have a special ability lose nothing more.
        want[t] *= W.researchScale;
        publishPenalty[t] = w.harm * W.publishHarm * (cfg.research[t].stacks === false ? 0.6 : 1);
      }

      // A card kept from an experiment is never published, and the deck holds
      // only a few copies of each type, so keeping one also keeps it from a
      // rival. Denial is worth what that card would cost this bot in a rival's
      // hands (its rival price, effect-values.js), for about one rival.
      const denyValue = {};
      for (const t of Object.keys(cfg.research)) denyValue[t] = researchWorth(cfg, t, objective).harm * W.denyScale;
      const keepValue = (t) => (want[t] || 0) + (denyValue[t] || 0);

      if (view.pendingPick) {
        // Keep the drawn research card worth most: for itself, or to deny it.
        const typeOf = (id) => view.pendingPick.cards.find((k) => k.id === id).type;
        let best = legal[0];
        for (const c of legal) if (keepValue(typeOf(c.cardId)) > keepValue(typeOf(best.cardId))) best = c;
        return report('pick', legal.map((c) => ({ command: c, score: keepValue(typeOf(c.cardId)), parts: { want: want[typeOf(c.cardId)] || 0, deny: denyValue[typeOf(c.cardId)] || 0 } })), best);
      }
      if (view.phase === 'resolution' && view.control) {
        // A monster is loose in the control chain (spec 025). Subduing costs
        // one control attempt; declining adds suspicion.
        const k = view.control;
        const last = k.upcoming.length === 0;
        const declineBringsMob = view.suspicion + cfg.control.declineSuspicion >= view.suspicionMax;
        let doSubdue;
        if (objective === 'unleasher') doSubdue = false;
        else if (objective === 'inquisitor') {
          // An unleashing loses for the Inquisitor. It declines (adding suspicion)
          // only if another player able to subdue, not the creator, comes after
          // it, or never if declining would bring the mob (which frees the monster).
          const otherHunter = k.upcoming.some((pid) => pid !== k.creatorId);
          doSubdue = !otherHunter || declineBringsMob;
        }
        else if (objective === 'prometheus') doSubdue = k.creatorId === me.id || last || declineBringsMob || me.controlAttempts > 1;
        else doSubdue = true;
        const chosen = legal.find((c) => c.subdue === doSubdue) || legal[0];
        return report('control', legal.map((c) => ({ command: c, score: c.subdue === doSubdue ? 1 : 0, parts: { rule: `${objective}: ${doSubdue ? 'subdue' : 'decline'}` } })), chosen);
      }

      const susp = view.suspicion / view.suspicionMax;
      // Suspicion added over the last full round: how fast the mob is coming.
      const recentRise = (view.suspicionHistory || []).filter((h) => h.round >= view.round - 1 && h.delta > 0).reduce((x, h) => x + h.delta, 0);
      const wantsSuspicion = objective === 'inquisitor';
      // The price of one point of suspicion: rises steeply as the mob nears.
      // Suspicion is the Inquisitor's only route to victory, so it buys it eagerly.
      const pace = Math.min(1, recentRise / view.suspicionMax);
      const suspicionPrice = wantsSuspicion ? -4 : st.suspicionCost * W.suspicionCost * (1 + W.suspicionCurve * susp * susp + W.suspicionPace * pace);
      // Suspicion is shared: paying it down helps every rival as much as the
      // payer, so non-Inquisitors only buy it back when the mob is close, and
      // only as much as it takes to get out of danger.
      // The danger line drops when suspicion is climbing fast: it is the
      // threshold minus the rise over the last full round (at least 2).
      const dangerLine = view.suspicionMax - Math.max(2, recentRise) - 1 - (st.suspicionCost > 1 ? 1 : 0);
      const excess = Math.max(0, view.suspicion - dangerLine);
      // My total research bonus of an effect kind (one entry per effective copy).
      const bonus = (kind) => Object.entries(cfg.research).reduce((a, [t, d]) => a + (me.effectiveResearch[t] || 0) * d.effects.filter((e) => e.kind === kind).reduce((x, e) => x + (e.amount ?? 1), 0), 0);
      const reduction = bonus('suspicionReduction');
      // An action's suspicion cost: the expected rise at the current price,
      // plus the chance its roll brings the mob, which ends the game.
      const riskCost = (def) => expectedSuspicion(def, reduction) * suspicionPrice
        + (wantsSuspicion ? -1 : 1) * W.mobStake * mobChance(def, reduction, view.suspicionMax - view.suspicion);
      const gravesParts = (cfg.actions.graves ? cfg.actions.graves.parts : 0) + bonus('gravesBonus');
      const sellGain = (cfg.actions.sell ? cfg.actions.sell.gain : 0) + bonus('sellBonus');
      const charityCut = (cfg.actions.charity ? cfg.actions.charity.reduction : 0) + bonus('charityBonus');
      const specimenCost = Math.max(0, (cfg.actions.specimens ? cfg.actions.specimens.cost : 0) - bonus('specimenDiscount'));
      // Money matters less the more of it a player already holds.
      let moneyValue = W.moneyScale * (me.money < 4 ? 1.5 : me.money < 10 ? 1 : me.money < 20 ? 0.5 : 0.2);
      // The Inquisitor builds nothing: money matters only for hiring more
      // Igors (more night work) and for blocking charity.
      if (wantsSuspicion) {
        const canHire = cfg.actions.hire && me.workers.filter((w) => w.kind === 'igor').length < cfg.maxIgors;
        moneyValue = canHire && me.money < cfg.actions.hire.cost ? 0.8 : 0.3;
      }

      const open = {};
      for (const [type, def] of Object.entries(cfg.partTypes)) open[type] = def.slots.filter((sl) => me.body[sl] === null).length;
      const needed = Object.values(open).reduce((a, b) => a + b, 0);
      // A harmful part (one that hurts this objective's odds) doesn't count
      // toward the body: the bot looks for a better one instead.
      const usable = (variantId) => wantsSuspicion || variantValue(cfg, variantId, objective) >= 0;
      const looseFits = (type) => me.loose.filter((x) => x.type === type && usable(x.variantId)).length;
      // Installed harmful parts, which an experiment can discard to make room for better ones.
      const installedBad = wantsSuspicion ? [] : Object.values(me.body).filter((x) => x && !usable(x.variantId));
      const stillNeeded = (type) => Math.max(0, open[type] - looseFits(type));
      const totalStillNeeded = Object.keys(open).reduce((a, t) => a + stillNeeded(t), 0);
      // A spare part is worth what it sells for.
      // A spare part (one that fits no empty slot) is worth a share of what it
      // sells for; it can also feed an experiment.
      // Spares beyond what the next sale and experiment can use are worth
      // nothing: hoarding them is pointless.
      const sparesHeld = me.loose.length - Object.keys(open).reduce((a, t) => a + Math.min(open[t], looseFits(t)), 0);
      const spareUse = (cfg.actions.sell ? cfg.actions.sell.parts : 0) + (cfg.actions.experiment && view.deckCount > 0 ? cfg.actions.experiment.maxParts : 0);
      const spareValue = sparesHeld >= spareUse ? 0.05
        : cfg.actions.sell ? Math.min(2, Math.max(0.5, cfg.actions.sell.gain / cfg.actions.sell.parts * 0.4)) : 0.5;
      // The Inquisitor builds no body: to it every part is only worth selling.
      const partValue = (variantId, needs = stillNeeded) => {
        const t = cfg.partVariants[variantId].type;
        if (wantsSuspicion) return 0.3;
        if (!(needs(t) > 0)) return spareValue;
        return W.partBase + variantValue(cfg, variantId, objective) * W.partQuality + (totalStillNeeded <= 2 ? W.completionBonus : 0);
      };
      // A random part, drawn with the configured type weights.
      const weightTotal = Object.values(cfg.partTypes).reduce((a, t) => a + t.weight, 0);
      const randomPartValue = wantsSuspicion ? 0.3 : Object.entries(cfg.partTypes).reduce((a, [t, def]) => a + def.weight / weightTotal * (stillNeeded(t) > 0 ? W.partBase : spareValue), 0);
      // The Inquisitor gains by taking the last slot of a space rivals need to
      // build Creatures, slowing everyone down while suspicion grows.
      const denial = (id) => {
        if (!wantsSuspicion || !['specimens', 'research'].includes(id)) return 0;
        const cap = (view.capacities || {})[id];
        if (cap == null) return 0;
        const left = cap - ((view.occupancy[view.phase] || {})[id] || []).length;
        return left <= 1 ? 1.5 : 0;
      };

      const rivals = view.players.filter((p) => p.id !== me.id);
      const installedPlusLoose = (p) => {
        let n = 0;
        for (const [type, def] of Object.entries(cfg.partTypes)) {
          const filled = def.slots.filter((sl) => p.body[sl] !== null).length;
          n += Math.min(def.slots.length, filled + p.loose.filter((x) => x.type === type).length);
        }
        return n;
      };
      const rivalsNearlyReady = rivals.filter((p) => installedPlusLoose(p) >= W.garrisonAlert).length;
      const copiesOf = (t) => cfg.research[t].copies ?? cfg.researchCopies;
      // Types it could still discover: unknown to it, with cards in the game.
      const unknownTypes = Object.keys(cfg.research).filter((t) => !me.research.includes(t) && copiesOf(t) > 0);
      // Share of the deck's cards that would be new to it, by copies, not types.
      const totalCopies = Object.keys(cfg.research).reduce((a, t) => a + copiesOf(t), 0);
      const newCardShare = totalCopies ? unknownTypes.reduce((a, t) => a + copiesOf(t), 0) / totalCopies : 0;
      const meanWant = unknownTypes.length ? unknownTypes.reduce((a, t) => a + Math.max(0, keepValue(t)), 0) / unknownTypes.length : 0;
      const remaining = Math.max(0, W.expectedRounds - view.round);

      // Money is worth what the bot expects to spend soon: an Igor, the parts
      // its body still needs (and replacements for harmful ones), research it
      // wants from the market and charity if the mob is close. Beyond that,
      // earning more is pointless, and a realistic player stops.
      const igorCount = me.workers.filter((w) => w.kind === 'igor').length;
      const canHireMore = !!cfg.actions.hire && igorCount < cfg.maxIgors;
      const wantedCards = (view.market || []).filter((k) => !me.research.includes(k.type) && (want[k.type] || 0) - (publishPenalty[k.type] || 0) > 0.5).length;
      // Capped spaces limit how fast money turns into anything, so plan only
      // what the next two rounds can buy: a couple of cards and three parts.
      const plannedSpend = (canHireMore ? cfg.actions.hire.cost : 0)
        + (cfg.actions.research ? Math.min(wantedCards, 2) * cfg.actions.research.cost : 0)
        + Math.min(3, wantsSuspicion ? 2 : totalStillNeeded + installedBad.length) * specimenCost
        + (cfg.actions.charity && excess > 0 && !wantsSuspicion ? cfg.actions.charity.cost : 0);
      const surplus = me.money - plannedSpend;
      if (surplus >= 0) moneyValue = surplus < 4 ? Math.min(moneyValue, 0.3) : 0.02;
      const moneyIdle = surplus >= 4;

      // Whether to commit to a resurrection tonight (preparing is public and binding).
      // Everything about a resurrection is public: bodies, exact odds, control
      // chances, garrisons and who has prepared tonight.
      // Chance that a monster of mine is never subdued: I try first (if I have
      // an attempt), then every garrisoned rival with an attempt, each of whom
      // might also decline (an Unleasher would).
      const pUnleashed = () => {
        const vs = (p) => (p.controlChanceVs ? p.controlChanceVs[me.id] : p.controlChance);
        let escape = me.controlAttempts > 0 ? 1 - vs(me) : 1;
        for (const p of rivals) if ((p.canSubdueOthers ?? p.garrisoned) && p.controlAttempts > 0) escape *= 1 - 0.8 * vs(p);
        return escape;
      };
      const preparedRivals = rivals.filter((p) => (view.prepared || []).includes(p.id));
      // Chance that at least one rival who has prepared tonight stabilizes.
      const rivalStable = preparedRivals.reduce((a, p) => a * (1 - (p.resurrectionOdds ? p.resurrectionOdds.pStable : 0)), 1);
      const pRivalStable = 1 - rivalStable;
      // Rivals with a complete body whose Scientist could still prepare tonight.
      // That includes bodies their loose parts can finish tonight.
      const rivalsCouldPrepare = rivals.filter((p) => installedPlusLoose(p) >= 6 && !p.passed && !(view.prepared || []).includes(p.id)
        && p.workers.some((w) => w.kind === 'scientist' && w.availableNow)).length;

      const shouldAttempt = () => {
        const odds = me.resurrectionOdds;
        if (!odds) return false;
        const late = view.round >= 12;
        const bar = st.attemptBar;
        // A subdued monster is a setback; an unleashed one ends the game.
        const pUnleash = odds.pMonster * pUnleashed();
        const safeEnough = odds.pStable >= bar * Math.max(late ? W.attemptLate : W.attemptMinStable, W.unleashFactor * pUnleash);
        if (objective === 'prometheus') {
          // A rival's attempt doesn't change the decision: if the rival
          // stabilizes, Prometheus loses whether or not it attempted too; if
          // not, this is an ordinary attempt. So judge only by its own odds.
          return safeEnough;
        }
        if (objective === 'visionary') {
          // If a rival stabilizes alone, the Visionary loses anyway, so join any
          // promising attempt even with poor odds. Only an unleashed monster,
          // which would end a game that might otherwise go on, holds it back.
          if (pRivalStable >= 0.1) return odds.pStable >= 0.03 && odds.pStable * pRivalStable >= 0.5 * pUnleash * (1 - pRivalStable);
          return false;
        }
        if (objective === 'unleasher') {
          const mine = me.controlChanceVs ? me.controlChanceVs[me.id] : me.controlChance;
          const pEscape = pUnleashed() / (me.controlAttempts > 0 ? 1 - mine : 1); // it won't subdue its own
          return pEscape >= 0.5
            ? odds.pMonster * pEscape > odds.pStable
            : odds.pMonster > odds.pStable * 4 && odds.pStable <= UNLEASHER_MAX_STABLE;
        }
        // Inquisitor: only a failed Vitality helps, and only if it brings the mob.
        return view.suspicion >= view.suspicionMax - cfg.resurrection.failedVitalitySuspicion && odds.pFailed > 0.5;
      };
      // The Visionary waits for a rival to commit first, keeping its Scientist free.
      const visionaryWaiting = objective === 'visionary' && view.phase === 'night' && me.bodyComplete
        && preparedRivals.length === 0 && rivalsCouldPrepare > 0;
      const igorFree = me.workers.some((w) => w.kind === 'igor' && w.availableNow);
      // An Igor used by day can't act tonight, so a day placement costs what
      // that Igor would have earned at night. Plan tonight's jobs, give the best
      // to the Scientist, and charge each day Igor for the job it gives up.
      const freeIgors = me.workers.filter((w) => w.kind === 'igor' && w.availableNow).length;
      const nightJobs = () => {
        const jobs = [];
        const capOf = (id) => { const c = (view.capacities || {})[id]; return c == null ? 3 : c; };
        // Rivals compete for capped spaces, so count on only some of the slots.
        const slots = (id) => Math.max(1, Math.round(capOf(id) / 2));
        const g = cfg.actions.graves;
        // Everyone plans graves when it pays (parts that don't fit can be sold).
        // Graves fill only about a third of rounds, so the Inquisitor plans on
        // every slot; builders, who also bear the suspicion, plan on fewer.
        const gravesValue = g && sparesHeld < 16 ? gravesParts * randomPartValue - riskCost(g) : 0;
        for (let i = 0; g && i < (wantsSuspicion ? capOf('graves') : slots('graves')); i++) jobs.push(gravesValue);
        const sl = cfg.actions.sell;
        // Spare parts on hand (plus, for the Inquisitor, tonight's grave haul)
        // can be sold or experimented with.
        let spareCount = me.loose.length - Object.keys(open).reduce((a2, t) => a2 + Math.min(open[t], looseFits(t)), 0)
          + (wantsSuspicion && g ? g.parts : 0);
        const ex = cfg.actions.experiment;
        if (ex && spareCount > 0 && unknownTypes.length && view.deckCount > 0) {
          const frac = newCardShare;
          jobs.push(frac * meanWant - spareValue - riskCost(ex));
          spareCount -= 1;
        }
        if (sl) {
          const sellValue = sellGain * moneyValue - sl.parts * (wantsSuspicion ? 0.3 : spareValue) - riskCost(sl);
          for (let i = 0; i < Math.min(slots('sell'), Math.floor(Math.max(0, spareCount) / sl.parts)); i++) jobs.push(sellValue);
        }
        if (me.bodyComplete && shouldAttempt()) jobs.push(W.prepareValue); // the Scientist prepares
        else if (!wantsSuspicion && totalStillNeeded === 0 && needed > 0) jobs.push(W.assembleValue); // assemble the whole body
        jobs.push(0.8); // rest, if nobody else takes it
        return jobs.filter((v) => v > 0).sort((x, y) => y - x);
      };
      // What it costs to discard these parts (loose or installed). Spare loose
      // parts are cheap. An installed part is cheap if a spare can replace it,
      // and discarding a harmful one (a damaged arm, say) is an upgrade.
      const discardCost = (ids) => {
        const spares = {};
        for (const t of Object.keys(open)) spares[t] = Math.max(0, looseFits(t) - open[t]);
        const refill = cfg.actions.specimens ? cfg.actions.specimens.cost * moneyValue * W.spendFactor + 1.5 : 3;
        return ids.reduce((acc, id) => {
          const loose = me.loose.find((x) => x.id === id);
          if (loose) {
            if (spares[loose.type] > 0 || !usable(loose.variantId)) { if (spares[loose.type] > 0) spares[loose.type]--; return acc + spareValue; }
            // A part the body needs is hard to replace: the spaces that sell
            // parts are capped and contested.
            return acc + partValue(loose.variantId) + 2;
          }
          const slot = Object.keys(me.body).find((sl) => me.body[sl] && me.body[sl].id === id);
          const part = me.body[slot];
          const quality = variantValue(cfg, part.variantId, objective) * 0.4;
          if (spares[part.type] > 0) { spares[part.type]--; return acc + spareValue + 1 + quality; }
          return acc + Math.max(0.3, Math.min(partValue(part.variantId, () => 1), refill + quality));
        }, 0);
      };
      let igorReserve = 0;
      if (view.phase === 'day' && freeIgors > 0) {
        const jobs = nightJobs();
        const sciFree = me.workers.some((w) => w.kind === 'scientist' && w.availableNow) || view.phase === 'day';
        const forIgors = sciFree ? jobs.slice(1) : jobs; // the Scientist takes the best job tonight
        // Placing an Igor now leaves freeIgors - 1 for the night: it gives up the
        // job at position freeIgors - 1, if there is one.
        igorReserve = W.igorReserve * (forIgors[freeIgors - 1] || 0);
      }

      const score = (c) => {
        if (c.type === 'PASS_TURN') return 0.2;
        const a = c.actionId;
        const def = cfg.actions[a];
        const isSci = c.workerId.startsWith('scientist');
        let reserve = isSci ? (visionaryWaiting && a !== 'prepare' ? 3 : 0) : igorReserve;
        // Experiments only: push Igors towards one phase (spec 016).
        if (!isSci && igorBias) reserve += view.phase === igorBias ? -3 : 3;
        // Keep the Scientist free for what only it can do.
        const sciTax = isSci && igorFree && a !== 'prepare' ? 0.3 : 0;
        const susCost = riskCost(def);
        const value = actionScore(c, a, def, isSci, sciTax, susCost);
        // The parts, for explanations: the action's value already includes
        // the suspicion cost and the Scientist tax.
        lastParts = { value, risk: susCost, sciTax, reserve };
        return value - reserve;
      };
      let lastParts = null;
      const actionScore = (c, a, def, isSci, sciTax, susCost) => {
        switch (a) {
          case 'medicine':
            if (moneyIdle) return -0.5;
            return (def.gain + bonus('medicineBonus')) * moneyValue * 0.8 - sciTax;
          case 'research': {
            const card = view.market.find((k) => k.id === c.choices.researchCardId);
            const pen = publishPenalty[card.type] || 0;
            // A card worth nothing to it is never worth a slot, however cheap
            // money is, unless taking the slot denies rivals (the Inquisitor).
            if ((want[card.type] ?? 0) - pen <= 0 && !denial('research')) return -1;
            return (want[card.type] ?? 1) - pen - def.cost * moneyValue * W.spendFactor - sciTax + denial('research');
          }
          case 'experiment': {
            // Draw one card per discarded part; keep the best eligible one,
            // privately (no publishing penalty, unlike research).
            const n = c.choices.partIds.length;
            const frac = newCardShare;
            const hit = 1 - Math.pow(1 - frac, n);
            const repair = c.choices.partIds.reduce((acc, id) => {
              const bad = installedBad.find((x) => x.id === id);
              return acc + (bad ? 1.5 - variantValue(cfg, bad.variantId, objective) * 0.6 : 0);
            }, 0);
            return hit * (meanWant + 0.3 * (n - 1)) + repair - discardCost(c.choices.partIds) - susCost - sciTax;
          }
          case 'specimens': {
            if (!needed && !wantsSuspicion) return -1;
            const left = {};
            for (const t of Object.keys(open)) left[t] = stillNeeded(t);
            let v = 0;
            // The type is chosen; the variant is uniformly random.
            for (const t of c.choices.partTypes) {
              const vids = Object.keys(cfg.partVariants).filter((id) => cfg.partVariants[id].type === t);
              v += vids.reduce((a, vid) => a + partValue(vid, (x) => left[x]), 0) / vids.length;
              if (left[t] > 0) left[t]--;
            }
            return v - specimenCost * moneyValue * W.spendFactor - sciTax + denial('specimens');
          }
          case 'graves':
            // Nobody keeps hauling corpses into a cellar full of ones they can't use.
            if (sparesHeld >= 16) return -1;
            return gravesParts * randomPartValue - susCost - sciTax;
          case 'sell': {
            // With money to spare, sell only to clear a pile of junk.
            if (moneyIdle && sparesHeld < 15) return -0.5;
            const lost = c.choices.partIds.reduce((acc, id) => acc + partValue(me.loose.find((x) => x.id === id).variantId), 0);
            return sellGain * moneyValue - lost - susCost - sciTax;
          }
          case 'hire': {
            if (def.cost > me.money) return -1;
            // An Igor is an investment: urgent needs come first. Don't hire
            // if what is left can't pay for charity with the mob close, or
            // for the last parts of the body.
            const urgent = (!wantsSuspicion && excess > 0 && cfg.actions.charity ? cfg.actions.charity.cost : 0)
              + (!wantsSuspicion && needed > 0 && totalStillNeeded <= 1 ? totalStillNeeded * specimenCost : 0);
            if (urgent > 0 && me.money - def.cost < urgent) return -1;
            return (cfg.actions.medicine ? cfg.actions.medicine.gain : 2) * Math.min(remaining, 5) * W.hireValue - def.cost * moneyValue * W.spendFactor - sciTax;
          }
          case 'charity': {
            const units = (c.choices && c.choices.units) || 1;
            const cut = Math.min(units * charityCut, view.suspicion);
            const pay = units * def.cost * moneyValue * W.spendFactor;
            if (wantsSuspicion) {
              // The Inquisitor takes a scarce charity slot as cheaply as it can,
              // to keep rivals from paying suspicion down.
              const cap = (view.capacities || {}).charity;
              const left = cap == null ? Infinity : cap - ((view.occupancy.day || {}).charity || []).length;
              const othersCould = (def.maxUnits || 1) * def.reduction;
              const block = left <= 1 && susp >= 0.4 ? othersCould * 1.2 : 0;
              return block - cut * 2 - pay - sciTax;
            }
            // Only the part of the cut that gets the table out of danger is worth
            // paying for, unless the money has no other use: then any cut keeps
            // the mob further off.
            return Math.min(cut, excess) * suspicionPrice * W.charityScale + (moneyIdle ? cut * 0.4 : 0) - pay - sciTax;
          }
          case 'garrison': {
            // A garrisoned worker lets its owner subdue rivals' monsters; for
            // the Unleasher, filling the space keeps others from doing so.
            if (!rivalsNearlyReady) return -0.2;
            if (objective === 'unleasher') return 3.5;
            if (me.garrisoned || me.canSubdueOthers || me.controlAttempts === 0) return -0.2;
            // Take a scarce garrison slot before an Unleasher can fill it.
            const gCap = (view.capacities || {}).garrison;
            const gLeft = gCap == null ? Infinity : gCap - ((view.occupancy.day || {}).garrison || []).length;
            // An unleashing loses for the Inquisitor too, so it garrisons like anyone else.
            return W.garrisonValue + (gLeft <= 1 ? 1 : 0);
          }
          case 'assemble': {
            if (wantsSuspicion) return -1; // it builds nothing; parts are for experiments and sale
            // Installed parts can't be swapped, so with unlimited assembly there
            // is no reason to install anything until the whole body can be built
            // in one action. With a limit, the work has to start earlier.
            const filled = Object.values(me.body).filter(Boolean).length;
            if (c.choices.partIds.some((id) => !usable(me.loose.find((x) => x.id === id).variantId))) return -3;
            if (def.max == null && filled + c.choices.partIds.length < Object.keys(me.body).length) return -0.5;
            return W.assembleValue + c.choices.partIds.reduce((acc, id) => acc + variantValue(cfg, me.loose.find((x) => x.id === id).variantId, objective) * 0.5 + 1, 0)
              - (isSci && igorFree ? 2 : 0);
          }
          case 'prepare':
            // Wait for assembly first if loose parts still fit the body.
            if (!me.bodyComplete) return -5;
            // Nothing to join yet. Committing first is a bad bet for the
            // Visionary: its own Creature stabilizing alone loses for everyone,
            // so it waits for a rival to commit.
            if (visionaryWaiting) return -5;
            return shouldAttempt() ? W.prepareValue : -5;
          case 'rest': {
            // Going first matters when the day's capped spaces fill up.
            const caps = view.capacities || {};
            const full = Object.keys(cfg.actions).filter((id) => cfg.actions[id].phase === 'day' && caps[id] != null
              && ((view.occupancy.day || {})[id] || []).length >= caps[id]).length;
            const order = view.initiative || [];
            const firstAnyway = order.length > 1 && order[1] === me.id;
            return firstAnyway ? -0.5 : 0.4 + 0.7 * full - sciTax;
          }
          default: return 0.1;
        }
      };
      // Score every option, add noise, and take the best; with a margin, take
      // any option within the margin of the best, uniformly (a weaker but
      // still sensible player, for robustness checks).
      const options = legal.map((c) => {
        lastParts = null;
        const base = score(c);
        const parts = lastParts || { value: base };
        return { command: c, score: base + r.float() * noise, base, parts };
      });
      const top = Math.max(...options.map((o) => o.score));
      // Options the bot itself prices below zero are never near the best.
      const near = margin > 0 ? options.filter((o) => o.score === top || (o.score >= top - margin && o.base >= 0)) : [options.find((o) => o.score === top)];
      const pick = near.length === 1 ? near[0] : near[r.int(near.length)];
      return report('place', options, pick.command);
    },
  };
}

export const POLICIES = {
  random: randomPolicy,
  heuristic: heuristicPolicy,
  cautious: (seed) => heuristicPolicy(seed, { style: 'cautious' }),
  bold: (seed) => heuristicPolicy(seed, { style: 'bold' }),
};
