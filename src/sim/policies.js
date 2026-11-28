// Replaceable decision policies for headless playtests.
// A policy is any object with decide({ playerId, view, legal }) -> command.
// `view` is the engine's filtered player observation; `legal` is the
// expanded list of legal commands. Policies never see authoritative state.
// Policies may be async (return a Promise) — the async runner awaits them.

import { seedState, randInt, nextUint32 } from '../engine/rng.js';
import { scienceWorth, deckMix } from './effect-values.js';
import { planBody, bodyOdds, scienceStats, partMix, expectedMax } from './body-plan.js';

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

const UNLEASHER_MAX_STABLE = 0.05;
const EXPECTED_ROUNDS = 9; // rough game length, for valuing a new worker

// Styles shift how much risk a heuristic player accepts (spec 016): suspicion
// costs more for a cautious player and less for a bold one, and their
// resurrection thresholds move the same way.
const STYLES = {
  standard: { suspicionCost: 1, attemptBar: 1 },
  cautious: { suspicionCost: 1.6, attemptBar: 1.4 },
  bold: { suspicionCost: 0.6, attemptBar: 0.7 },
};

/**
 * The heuristic's tunable numbers. Each is a price in money or a multiplier
 * on one, so the policy still values actions from the configuration's numbers
 * (spec 016).
 */
export const DEFAULT_WEIGHTS = {
  suspicionCost: 1, // multiplies the price of a point of suspicion
  suspicionCurve: 8, // how steeply that price rises as the mob nears
  suspicionPace: 4, // how much fast-rising suspicion adds to it
  mobStake: 40, // what the mob forming is worth
  moneyScale: 1, // multiplies what money is worth
  spendFactor: 0.6, // share of a price felt when paying it
  bodyScale: 1, // multiplies what a better body is worth
  missingPart: 5, // a part the full set still lacks
  vitalityPoint: 1.2, // a point of Vitality still short of the threshold
  stablePoint: 14, // a body's stable chance, from 0 to 1, in money
  spareFloor: 0.4, // least a part is worth: it can be sold or experimented
  scienceScale: 1, // multiplies science wants
  hireValue: 0.35, // a new Igor, per round of medicine it can work
  expectedRounds: EXPECTED_ROUNDS,
  igorReserve: 0.8, // share of tonight's job a day Igor gives up
  charityScale: 1.5, // multiplies the value of suspicion paid down
  garrisonValue: 4.5,
  prepareValue: 12,
  attemptMinStable: 0.2, // least stable chance for an attempt...
  attemptLate: 0.1, // ...from round 12
  unleashFactor: 1.5, // stable odds must beat this many times the unleash odds
};

/**
 * Per-objective defaults over DEFAULT_WEIGHTS, for roles whose best weights
 * measurably beat the defaults when every seat of that role plays them
 * (bin/tune.mjs --deviators all). None are set for the current rules.
 */
export const OBJECTIVE_WEIGHTS = {};

/**
 * A greedy strategy that prices every option in money, using only its view,
 * the configuration's numbers and exact odds. Because values come from the
 * config, it adapts when a sweep changes costs, gains or suspicion.
 */
export function heuristicPolicy(seed = 'heuristic', { noise = 0.75, style = 'standard', igorBias = null, weights = {}, margin = 0, explain = null } = {}) {
  const r = makeRandom(seed);
  const st = STYLES[style] || STYLES.standard;
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
      const wantsSuspicion = objective === 'inquisitor';
      const wantsMonster = objective === 'unleasher';
      const rivals = view.players.filter((p) => p.id !== me.id);
      const T = cfg.resurrection.thresholds.vitality;

      // Science: what each type is worth to this objective.
      const want = {};
      for (const t of Object.keys(cfg.science)) want[t] = scienceWorth(cfg, t, objective).want * W.scienceScale;
      const mix = deckMix(view);
      const randomCardValue = mix.reduce((a, x) => a + x.weight * (want[x.type] || 0), 0);
      const mySci = scienceStats(cfg, me.science);
      const bonus = (kind) => mySci.kinds[kind] || 0;

      // The body: what a hand is worth, in money. A full set at the threshold
      // is worth most; its stable chance (or, for the Unleasher, its monster
      // chance) adds to that. The Inquisitor builds nothing.
      const sign = wantsMonster ? -1 : 1;
      const handValue = (hand, sci = mySci) => {
        if (wantsSuspicion) return 0;
        const plan = planBody(cfg, hand, sci, { sign });
        const short = Math.max(0, T - plan.vitality);
        let v = -W.missingPart * plan.missing - W.vitalityPoint * short;
        if (!plan.missing) v += wantsMonster ? W.stablePoint * (1 - plan.pStable) * 0.6 : W.stablePoint * plan.pStable;
        return v * W.bodyScale;
      };
      const baseHand = handValue(me.hand);
      const spare = W.spareFloor;
      // What adding parts to the hand is worth (at least what they sell for).
      const gainValue = (parts) => Math.max(spare * parts.length, handValue([...me.hand, ...parts]) - baseHand);
      // What losing parts from the hand costs.
      const lossValue = (ids) => Math.max(spare * ids.length * 0.5, baseHand - handValue(me.hand.filter((x) => !ids.includes(x.id))));
      // Expected value of one random part, by the deck's catalogue.
      const pmix = partMix(cfg);
      let partValues = null;
      const variantValues = () => (partValues ??= pmix.map(({ variantId, weight }) => ({ value: gainValue([{ id: `probe-${variantId}`, variantId, type: cfg.partVariants[variantId].type }]), weight })));
      const randomPartValue = () => (wantsSuspicion ? spare : variantValues().reduce((a, x) => a + x.value * x.weight, 0));

      if (view.pendingPick) {
        // Keep the drawn part worth most to this hand.
        const value = (c) => gainValue([view.pendingPick.parts.find((x) => x.id === c.partId)]);
        let best = legal[0];
        for (const c of legal) if (value(c) > value(best)) best = c;
        return report('pick', legal.map((c) => ({ command: c, score: value(c), parts: { gain: value(c) } })), best);
      }
      if (view.phase === 'resolution' && view.control) {
        // A monster is loose in the control chain (spec 025). A failed try costs
        // nothing; a success adds a little suspicion; a decline adds more.
        const k = view.control;
        const declineBringsMob = view.suspicion + cfg.control.declineSuspicion >= view.suspicionMax;
        let doSubdue;
        if (wantsMonster) doSubdue = false;
        else if (wantsSuspicion) {
          // An unleashing loses for the Inquisitor. It declines (adding suspicion)
          // only if another player able to subdue, not the creator, comes after
          // it, and never if declining would bring the mob (which frees the monster).
          const otherHunter = k.upcoming.some((pid) => pid !== k.creatorId);
          doSubdue = !otherHunter || declineBringsMob;
        } else doSubdue = true;
        const chosen = legal.find((c) => c.subdue === doSubdue) || legal[0];
        return report('control', legal.map((c) => ({ command: c, score: c.subdue === doSubdue ? 1 : 0, parts: { rule: `${objective}: ${doSubdue ? 'subdue' : 'decline'}` } })), chosen);
      }

      const susp = view.suspicion / view.suspicionMax;
      // Suspicion added over the last full round: how fast the mob is coming.
      const recentRise = (view.suspicionHistory || []).filter((h) => h.round >= view.round - 1 && h.delta > 0).reduce((x, h) => x + h.delta, 0);
      const pace = Math.min(1, recentRise / view.suspicionMax);
      // The price of one point of suspicion: rises steeply as the mob nears.
      // Suspicion is the Inquisitor's only route to victory, so it buys it eagerly.
      const suspicionPrice = wantsSuspicion ? -4 : st.suspicionCost * W.suspicionCost * (1 + W.suspicionCurve * susp * susp + W.suspicionPace * pace);
      // Suspicion is shared: paying it down helps every rival as much as the
      // payer, so non-Inquisitors only buy it back when the mob is close.
      const dangerLine = view.suspicionMax - Math.max(2, recentRise) - 1 - (st.suspicionCost > 1 ? 1 : 0);
      const excess = Math.max(0, view.suspicion - dangerLine);
      // An action's suspicion cost: its flat rise at the current price, plus the mob if it brings it.
      const riskCost = (def) => {
        const add = (def && def.suspicion) || 0;
        if (!add) return 0;
        const mob = view.suspicion + add >= view.suspicionMax ? 1 : 0;
        return add * suspicionPrice + (wantsSuspicion ? -1 : 1) * W.mobStake * mob;
      };

      // Money matters less the more of it a player already holds.
      let moneyValue = W.moneyScale * (me.money < 4 ? 1.5 : me.money < 10 ? 1 : me.money < 20 ? 0.5 : 0.2);
      if (wantsSuspicion) {
        const canHire = cfg.actions.hire && me.workers.filter((w) => w.kind === 'igor').length < cfg.maxIgors;
        moneyValue = canHire && me.money < cfg.actions.hire.cost ? 0.8 : 0.3;
      }
      const igorCount = me.workers.filter((w) => w.kind === 'igor').length;
      const canHireMore = !!cfg.actions.hire && igorCount < cfg.maxIgors;
      const wantedCards = (view.market || []).filter((k) => (want[k.type] || 0) > 0.5).length;
      const plan = wantsSuspicion ? null : planBody(cfg, me.hand, mySci, { sign });
      const partsWanted = plan ? Math.min(3, plan.missing + (plan.ok ? 0 : 1)) : 0;
      // Money is worth what the bot expects to spend soon. Beyond that,
      // earning more is pointless, and a realistic player stops.
      const plannedSpend = (canHireMore ? cfg.actions.hire.cost : 0)
        + (cfg.actions.research ? Math.min(wantedCards, 2) * cfg.actions.research.cost : 0)
        + (cfg.actions.specimens ? partsWanted * cfg.actions.specimens.cost : 0)
        + (cfg.actions.charity && excess > 0 && !wantsSuspicion ? cfg.actions.charity.cost : 0);
      const surplus = me.money - plannedSpend;
      if (surplus >= 0) moneyValue = surplus < 4 ? Math.min(moneyValue, 0.3) : 0.02;
      const moneyIdle = surplus >= 4;

      // Resurrection: chance that a monster of mine is never subdued. Each
      // player able to try (garrisoned, or me with Neural Conditioning) might.
      const canTry = (p) => p.garrisoned || (p.id === me.id && p.subdueOwn);
      const pUnleashed = () => {
        let escape = 1;
        for (const p of view.players) if (canTry(p)) escape *= 1 - (p.id === me.id && wantsMonster ? 0 : 0.8) * p.controlChance;
        return escape;
      };
      const preparedRivals = rivals.filter((p) => (view.prepared || []).includes(p.id));
      const pRivalStable = 1 - preparedRivals.reduce((a, p) => a * (1 - (p.resurrectionOdds ? p.resurrectionOdds.pStable : 0)), 1);
      // Rivals with a body they could still prepare tonight.
      const rivalsCouldPrepare = rivals.filter((p) => (p.bestVitality ?? -Infinity) >= T && !p.passed && !(view.prepared || []).includes(p.id)
        && p.workers.some((w) => w.kind === 'scientist' && w.availableNow)).length;
      // The parts deck is finite: when few parts are left to draw, waiting for
      // a better body may mean waiting for ever.
      const partsLeft = (view.partsDeckCount ?? 0) + ((view.partsDiscard || []).length);
      const scarce = partsLeft < 12;
      const shouldAttempt = (odds) => {
        if (!odds) return false;
        const late = view.round >= 12 || scarce;
        const pMonster = 1 - odds.pStable;
        const pUnleash = pMonster * pUnleashed();
        const safeEnough = odds.pStable >= st.attemptBar * Math.max(late ? W.attemptLate : W.attemptMinStable, W.unleashFactor * pUnleash);
        if (objective === 'prometheus') return safeEnough;
        if (objective === 'visionary') {
          // If a rival stabilizes alone, the Visionary loses anyway, so join any
          // promising attempt even with poor odds.
          if (pRivalStable >= 0.1) return odds.pStable >= 0.03 && odds.pStable * pRivalStable >= 0.5 * pUnleash * (1 - pRivalStable);
          return false;
        }
        if (wantsMonster) {
          const pEscape = pUnleashed();
          return pEscape >= 0.5 ? pMonster * pEscape > odds.pStable : pMonster > odds.pStable * 4 && odds.pStable <= UNLEASHER_MAX_STABLE;
        }
        return false; // the Inquisitor never resurrects
      };
      const myBestOdds = plan && plan.ok ? { pStable: plan.pStable } : null;
      const visionaryWaiting = objective === 'visionary' && view.phase === 'night' && plan && plan.ok
        && preparedRivals.length === 0 && rivalsCouldPrepare > 0;
      const igorFree = me.workers.some((w) => w.kind === 'igor' && w.availableNow);
      // Rivals close to a body worth preparing: worth a garrison.
      const rivalsNearlyReady = rivals.filter((p) => (p.bestVitality ?? -Infinity) >= T - 3).length;
      const iMayAttempt = !!(plan && plan.vitality >= T - 3) && !wantsSuspicion;

      // An Igor used by day can't act tonight, so a day placement costs what
      // that Igor would have earned at night.
      const freeIgors = me.workers.filter((w) => w.kind === 'igor' && w.availableNow).length;
      const capOf = (id) => { const c = (view.capacities || {})[id]; return c == null ? 3 : c; };
      const nightJobs = () => {
        const jobs = [];
        const slots = (id) => Math.max(1, Math.round(capOf(id) / 2));
        const g = cfg.actions.graves;
        const gravesValue = g ? (cfg.actions.graves.parts * randomPartValue()) - riskCost(g) : 0;
        for (let i = 0; g && i < (wantsSuspicion ? capOf('graves') : slots('graves')); i++) jobs.push(gravesValue);
        const sl = cfg.actions.sell;
        if (sl && me.hand.length >= sl.parts) jobs.push(sl.gain * moneyValue - sl.parts * spare - riskCost(sl));
        const ex = cfg.actions.experiment;
        if (ex && me.hand.length >= ex.parts && view.deckCount > 0) jobs.push(ex.cards * randomCardValue - ex.parts * spare - riskCost(ex));
        if (myBestOdds && shouldAttempt(myBestOdds)) jobs.push(W.prepareValue);
        jobs.push(0.8); // rest, if nobody else takes it
        return jobs.filter((v) => v > 0).sort((x, y) => y - x);
      };
      let igorReserve = 0;
      if (view.phase === 'day' && freeIgors > 0) {
        const jobs = nightJobs();
        const forIgors = jobs.slice(1); // the Scientist takes the best job tonight
        igorReserve = W.igorReserve * (forIgors[freeIgors - 1] || 0);
      }

      // The Visionary needs rivals to build: when parts run short, spare parts
      // it discards go back into circulation for them.
      const feed = (ids) => (objective === 'visionary' && scarce ? 1.5 * ids.length : 0);
      let lastParts = null;
      const actionScore = (c, a, def, isSci, sciTax, susCost) => {
        switch (a) {
          case 'medicine':
            if (moneyIdle) return -0.5;
            return (def.gain + bonus('medicineBonus')) * moneyValue * 0.8 - sciTax;
          case 'research': {
            const card = view.market.find((k) => k.id === c.choices.researchCardId);
            const w = want[card.type] ?? 0;
            if (w <= 0) return -1;
            return w - def.cost * moneyValue * W.spendFactor - sciTax;
          }
          case 'experiment': {
            const n = Math.min(def.cards, view.deckCount);
            return n * randomCardValue + feed(c.choices.partIds) - lossValue(c.choices.partIds) - susCost - sciTax;
          }
          case 'specimens': {
            // Draw several, keep the best for this hand.
            const best = wantsSuspicion ? spare : expectedMax(variantValues(), def.draw);
            return best - def.cost * moneyValue * W.spendFactor - sciTax;
          }
          case 'graves':
            return def.parts * randomPartValue() - susCost - sciTax;
          case 'sell': {
            if (moneyIdle && me.hand.length < 15 && !feed(c.choices.partIds)) return -0.5;
            return def.gain * moneyValue + feed(c.choices.partIds) - lossValue(c.choices.partIds) - susCost - sciTax;
          }
          case 'hire': {
            if (def.cost > me.money) return -1;
            const urgent = !wantsSuspicion && excess > 0 && cfg.actions.charity ? cfg.actions.charity.cost : 0;
            if (urgent > 0 && me.money - def.cost < urgent) return -1;
            const remaining = Math.max(0, W.expectedRounds - view.round);
            return (cfg.actions.medicine ? cfg.actions.medicine.gain : 2) * Math.min(remaining, 5) * W.hireValue - def.cost * moneyValue * W.spendFactor - sciTax;
          }
          case 'charity': {
            const units = (c.choices && c.choices.units) || 1;
            const cut = Math.min(units * (def.reduction + bonus('charityBonus')), view.suspicion);
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
            return Math.min(cut, excess) * suspicionPrice * W.charityScale + (moneyIdle ? cut * 0.4 : 0) - pay - sciTax;
          }
          case 'vespers': {
            const cut = Math.min(def.reduction, view.suspicion);
            if (wantsSuspicion) return -1;
            return Math.min(cut, excess) * suspicionPrice * W.charityScale + cut * 0.3 - sciTax;
          }
          case 'garrison': {
            // A garrisoned Igor lets its owner subdue monsters, its own included;
            // for the Unleasher, filling the space keeps others from doing so.
            if (!rivalsNearlyReady && !iMayAttempt) return -0.2;
            if (wantsMonster) return 3.5;
            if (me.garrisoned) return -0.2;
            const gLeft = capOf('garrison') - ((view.occupancy.day || {}).garrison || []).length;
            return W.garrisonValue + (gLeft <= 1 ? 1 : 0);
          }
          case 'prepare': {
            if (visionaryWaiting) return -5;
            const parts = c.choices.partIds.map((id) => me.hand.find((x) => x.id === id));
            const odds = bodyOdds(cfg, parts, mySci);
            if (!shouldAttempt(odds)) return -5;
            // The best body for this objective.
            return W.prepareValue + (wantsMonster ? 1 - odds.pStable : odds.pStable) * 4;
          }
          case 'rest': {
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
      const score = (c) => {
        if (c.type === 'PASS_TURN') return 0.2;
        const a = c.actionId;
        const def = cfg.actions[a];
        const isSci = c.workerId.startsWith('scientist');
        let reserve = isSci ? (visionaryWaiting && a !== 'prepare' ? 3 : 0) : igorReserve;
        // Experiments only: push Igors towards one phase (spec 016).
        if (!isSci && igorBias) reserve += view.phase === igorBias ? -3 : 3;
        // Keep the Scientist free for what only it can do.
        const sciTax = isSci && igorFree && a !== 'prepare' && view.phase === 'night' && myBestOdds ? 0.3 : 0;
        const susCost = riskCost(def);
        const value = actionScore(c, a, def, isSci, sciTax, susCost);
        lastParts = { value, risk: susCost, sciTax, reserve };
        return value - reserve;
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
