// Replaceable decision policies for headless playtests.
// A policy is any object with decide({ playerId, view, legal }) -> command.
// `view` is the engine's filtered player observation; `legal` is the
// expanded list of legal commands. Policies never see authoritative state.
// Policies may be async (return a Promise) — the async runner awaits them.

import { seedState, randInt, nextUint32 } from '../engine/rng.js';

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
    decide({ legal }) {
      const nonPass = legal.filter((c) => c.type !== 'PASS_TURN');
      if (nonPass.length && r.float() > 0.1) return nonPass[r.int(nonPass.length)];
      return legal[r.int(legal.length)];
    },
  };
}

function effectValue(e) {
  if (e.op === 'die') return e.sign * (e.die + 1) / 2;
  if (e.op === 'fixed') return e.amount;
  if (e.op === 'threshold') return -e.amount;
  return 0;
}

// The Unleasher wants a body that lives but lacks Humanity.
function variantValue(cfg, variantId, objective) {
  const humanityWeight = objective === 'unleasher' ? -1.5 : 1.5;
  return cfg.partVariants[variantId].effects.reduce((a, e) => a + effectValue(e) * (e.attribute === 'vitality' ? 1 : humanityWeight), 0);
}

// How much each objective wants a research type, in money.
const RESEARCH_WANT = {
  unleasher: { galvanism: 4.5, neurology: 0.5, philosophy: 0.5, mesmerism: 0.5, restraint: 0.5, medicine: 2.5, discretion: 1.5 },
  inquisitor: { galvanism: 0.5, neurology: 1, philosophy: 1, mesmerism: 1.5, restraint: 1.5, medicine: 3, discretion: 0 },
  default: { galvanism: 4, neurology: 3.5, philosophy: 4.5, mesmerism: 4, restraint: 4, medicine: 2.5, discretion: 1.5 },
};
// Conducting research publishes the card. Types an objective would rather keep
// from rivals cost it this much to publish.
const PUBLISH_PENALTY = {
  prometheus: { philosophy: 1.5, galvanism: 1 },
  visionary: {},
  inquisitor: { discretion: 2, philosophy: 1.5 },
  unleasher: { philosophy: 2, neurology: 1.5, mesmerism: 1.5, restraint: 1.5 },
};
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

/**
 * A greedy strategy that prices every option in money, using only its view,
 * the configuration's numbers and the engine's exact odds. Because values come
 * from the config, it adapts when a sweep changes costs, gains or suspicion.
 */
export function heuristicPolicy(seed = 'heuristic', { noise = 0.75, style = 'standard' } = {}) {
  const r = makeRandom(seed);
  const st = STYLES[style] || STYLES.standard;
  return {
    name: style === 'standard' ? 'heuristic' : style,
    decide({ view, legal }) {
      const me = view.players.find((p) => p.id === view.viewerId);
      const objective = view.private.objective;
      const cfg = view.config;
      const want = RESEARCH_WANT[objective] || RESEARCH_WANT.default;

      if (view.pendingPick) {
        // Keep the drawn research card this objective wants most.
        const typeOf = (id) => view.pendingPick.cards.find((k) => k.id === id).type;
        let best = legal[0];
        for (const c of legal) if ((want[typeOf(c.cardId)] || 0) > (want[typeOf(best.cardId)] || 0)) best = c;
        return best;
      }
      if (view.phase === 'resolution' && view.control) {
        // A monster is loose in the control chain (spec 025). Subduing costs
        // one control attempt; declining adds suspicion.
        const k = view.control;
        const last = k.upcoming.length === 0;
        const declineBringsMob = view.suspicion + cfg.control.declineSuspicion >= view.suspicionMax;
        let doSubdue;
        if (objective === 'unleasher') doSubdue = false;
        else if (objective === 'inquisitor') doSubdue = last || declineBringsMob; // a mob during the chain frees the monster
        else if (objective === 'prometheus') doSubdue = k.creatorId === me.id || last || declineBringsMob || me.controlAttempts > 1;
        else doSubdue = true;
        return legal.find((c) => c.subdue === doSubdue) || legal[0];
      }

      const susp = view.suspicion / view.suspicionMax;
      const wantsSuspicion = objective === 'inquisitor';
      // The price of one point of suspicion: rises steeply as the mob nears.
      // Suspicion is the Inquisitor's only route to victory, so it buys it eagerly.
      const suspicionPrice = wantsSuspicion ? -4 : st.suspicionCost * (1 + 8 * susp * susp);
      // Suspicion is shared: paying it down helps every rival as much as the
      // payer, so non-Inquisitors only buy it back when the mob is close, and
      // only as much as it takes to get out of danger.
      const dangerLine = view.suspicionMax - 3 - (st.suspicionCost > 1 ? 1 : 0);
      const excess = Math.max(0, view.suspicion - dangerLine);
      const reduction = me.effectiveResearch.discretion * ((cfg.research.discretion && cfg.research.discretion.effects[0].amount) || 0);
      // Money matters less the more of it a player already holds.
      const moneyValue = me.money < 4 ? 1.5 : me.money < 10 ? 1 : me.money < 20 ? 0.5 : 0.2;

      const open = {};
      for (const [type, def] of Object.entries(cfg.partTypes)) open[type] = def.slots.filter((sl) => me.body[sl] === null).length;
      const needed = Object.values(open).reduce((a, b) => a + b, 0);
      const looseFits = (type) => me.loose.filter((x) => x.type === type).length;
      const stillNeeded = (type) => Math.max(0, open[type] - looseFits(type));
      const totalStillNeeded = Object.keys(open).reduce((a, t) => a + stillNeeded(t), 0);
      // A spare part is worth what it sells for.
      const spareValue = cfg.actions.sell ? cfg.actions.sell.gain / cfg.actions.sell.parts * 0.6 : 0.2;
      // The Inquisitor builds no body: to it every part is only worth selling.
      const partValue = (variantId, needs = stillNeeded) => {
        const t = cfg.partVariants[variantId].type;
        if (wantsSuspicion) return spareValue;
        return needs(t) > 0 ? 3 + variantValue(cfg, variantId, objective) * 0.4 : spareValue;
      };
      // A random part, drawn with the configured type weights.
      const weightTotal = Object.values(cfg.partTypes).reduce((a, t) => a + t.weight, 0);
      const randomPartValue = wantsSuspicion ? spareValue : Object.entries(cfg.partTypes).reduce((a, [t, def]) => a + def.weight / weightTotal * (stillNeeded(t) > 0 ? 3 : spareValue), 0);
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
      const rivalsNearlyReady = rivals.filter((p) => installedPlusLoose(p) >= GARRISON_ALERT_PARTS).length;
      const unknownTypes = Object.keys(cfg.research).filter((t) => !me.research.includes(t));
      const meanWant = unknownTypes.length ? unknownTypes.reduce((a, t) => a + (want[t] || 1), 0) / unknownTypes.length : 0;
      const remaining = Math.max(0, EXPECTED_ROUNDS - view.round);

      // Whether to commit to a resurrection tonight (preparing is public and binding).
      const shouldAttempt = () => {
        const odds = me.resurrectionOdds;
        if (!odds) return false;
        const late = view.round >= 12;
        const bar = st.attemptBar;
        const canControl = me.controlAttempts > 0 && me.controlChance >= 0.5;
        const safeEnough = canControl
          ? odds.pStable >= (late ? 0.1 : 0.2) * bar
          : odds.pStable >= odds.pMonster * 1.2 * bar || (late && odds.pStable >= odds.pMonster * 0.6 * bar);
        const preparedRivals = (view.prepared || []).filter((pid) => pid !== me.id);
        if (objective === 'prometheus') return safeEnough && preparedRivals.length === 0;
        if (objective === 'visionary') {
          const ready = rivals.filter((p) => p.bodyComplete).length;
          return safeEnough && (preparedRivals.length > 0 || ready >= Math.min(VISIONARY_MIN_RIVALS, rivals.length));
        }
        if (objective === 'unleasher') {
          const pEscape = rivals.filter((p) => p.garrisoned && p.controlAttempts > 0).reduce((a, p) => a * (1 - p.controlChance), 1);
          return pEscape >= 0.5
            ? odds.pMonster * pEscape > odds.pStable
            : odds.pMonster > odds.pStable * 4 && odds.pStable <= UNLEASHER_MAX_STABLE;
        }
        // Inquisitor: only a failed Vitality helps, and only if it brings the mob.
        return view.suspicion >= view.suspicionMax - cfg.resurrection.failedVitalitySuspicion && odds.pFailed > 0.5;
      };
      const igorFree = me.workers.some((w) => w.kind === 'igor' && w.availableNow);
      // Keep one Igor back for the night when a night action is worth more than
      // a typical day action: a day placement by the last free Igor pays for it.
      const freeIgors = me.workers.filter((w) => w.kind === 'igor' && w.availableNow).length;
      const graves = cfg.actions.graves;
      const nightValue = graves ? graves.parts * randomPartValue - expectedSuspicion(graves, reduction) * suspicionPrice : 0;
      const igorReserve = view.phase === 'day' && freeIgors === 1 && nightValue > 2.5 ? 0.6 * nightValue : 0;

      const score = (c) => {
        if (c.type === 'PASS_TURN') return 0.2;
        const a = c.actionId;
        const def = cfg.actions[a];
        const isSci = c.workerId.startsWith('scientist');
        const reserve = isSci ? 0 : igorReserve;
        // Keep the Scientist free for what only it can do.
        const sciTax = isSci && igorFree && a !== 'prepare' ? 0.3 : 0;
        const susCost = expectedSuspicion(def, reduction) * suspicionPrice;
        return actionScore(c, a, def, isSci, sciTax, susCost) - reserve;
      };
      const actionScore = (c, a, def, isSci, sciTax, susCost) => {
        switch (a) {
          case 'medicine': return (def.gain + me.effectiveResearch.medicine) * moneyValue * 0.8 - sciTax;
          case 'research': {
            const card = view.market.find((k) => k.id === c.choices.researchCardId);
            const pen = (PUBLISH_PENALTY[objective] || {})[card.type] || 0;
            return (want[card.type] || 1) - pen - def.cost * moneyValue * 0.6 - sciTax + denial('research');
          }
          case 'experiment': {
            // Draw one card per discarded installed part; keep the best eligible one.
            const n = c.choices.partIds.length;
            const frac = unknownTypes.length / Object.keys(cfg.research).length;
            const hit = 1 - Math.pow(1 - frac, n);
            // An installed part is cheap to lose if a spare loose part can replace it.
            const spares = {};
            for (const t of Object.keys(open)) spares[t] = Math.max(0, looseFits(t) - open[t]);
            const lost = c.choices.partIds.reduce((acc, id) => {
              const slot = Object.keys(me.body).find((sl) => me.body[sl] && me.body[sl].id === id);
              const t = me.body[slot].type;
              if (spares[t] > 0) { spares[t]--; return acc + spareValue + 1; }
              return acc + partValue(me.body[slot].variantId, () => 1);
            }, 0);
            return hit * (meanWant + 0.3 * (n - 1)) - lost - susCost - sciTax;
          }
          case 'specimens': {
            if (!needed && !wantsSuspicion) return -1;
            const left = {};
            for (const t of Object.keys(open)) left[t] = stillNeeded(t);
            let v = 0;
            for (const vid of c.choices.variantIds) {
              v += partValue(vid, (t) => left[t]);
              const t = cfg.partVariants[vid].type;
              if (left[t] > 0) left[t]--;
            }
            return v - def.cost * moneyValue * 0.6 - sciTax + denial('specimens');
          }
          case 'graves':
            return def.parts * randomPartValue - susCost - sciTax;
          case 'sell': {
            const lost = c.choices.partIds.reduce((acc, id) => acc + partValue(me.loose.find((x) => x.id === id).variantId), 0);
            return def.gain * moneyValue - lost - susCost - sciTax;
          }
          case 'hire': return def.cost > me.money ? -1 : (cfg.actions.medicine ? cfg.actions.medicine.gain : 2) * Math.min(remaining, 5) * 0.35 - def.cost * moneyValue * 0.6 - sciTax;
          case 'charity': {
            const units = (c.choices && c.choices.units) || 1;
            const cut = Math.min(units * def.reduction, view.suspicion);
            const pay = units * def.cost * moneyValue * 0.6;
            if (wantsSuspicion) {
              // The Inquisitor takes a scarce charity slot as cheaply as it can,
              // to keep rivals from paying suspicion down.
              const cap = (view.capacities || {}).charity;
              const left = cap == null ? Infinity : cap - ((view.occupancy.day || {}).charity || []).length;
              const othersCould = (def.maxUnits || 1) * def.reduction;
              const block = left <= 1 && susp >= 0.4 ? othersCould * 1.2 : 0;
              return block - cut * 2 - pay - sciTax;
            }
            // Only the part of the cut that gets the table out of danger is worth paying for.
            return Math.min(cut, excess) * suspicionPrice * 1.5 - pay - sciTax;
          }
          case 'garrison': {
            // A garrisoned worker lets its owner subdue rivals' monsters; for
            // the Unleasher, filling the space keeps others from doing so.
            if (!rivalsNearlyReady) return -0.2;
            if (objective === 'unleasher') return 3.5;
            if (me.garrisoned || me.controlAttempts === 0) return -0.2;
            return objective === 'inquisitor' ? 2.5 : 4.5;
          }
          case 'assemble':
            if (wantsSuspicion) return 0.2;
            return 5 + c.choices.partIds.reduce((acc, id) => acc + variantValue(cfg, me.loose.find((x) => x.id === id).variantId, objective) * 0.5 + 1, 0)
              - (isSci && igorFree ? 2 : 0);
          case 'prepare':
            // Wait for assembly first if loose parts still fit the body.
            if (!me.bodyComplete) return -5;
            return shouldAttempt() ? 12 : -5;
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
      let best = legal[0];
      let bestScore = -Infinity;
      for (const c of legal) {
        const sc = score(c) + r.float() * noise;
        if (sc > bestScore) { bestScore = sc; best = c; }
      }
      return best;
    },
  };
}

export const POLICIES = {
  random: randomPolicy,
  heuristic: heuristicPolicy,
  cautious: (seed) => heuristicPolicy(seed, { style: 'cautious' }),
  bold: (seed) => heuristicPolicy(seed, { style: 'bold' }),
};
