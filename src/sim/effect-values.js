// What research effects are worth to each objective, in two layers.
//
// Layer 1, EFFECT_IMPACT, says what an effect kind does, in a few game
// quantities, per unit of the effect. It is the same for every role, because
// it is a fact about the rules: Galvanic Mastery adds Vitality points, Public
// Lectures takes suspicion off the table, Medical Expertise adds money over
// the game. A unit is a mean point for dice and modifiers, one use for
// abilities, and the effect's amount otherwise (effectUnits).
//
// Layer 2 prices each quantity per role: QUANTITY_PRICE for the role itself,
// RIVAL_PRICE for one unit in a rival's hands (what publishing gives them, or
// keeping a card denies them). Prices are in money, the heuristic's common
// currency (spec 016). A role's goal sits here: the Inquisitor prices
// suspicion taken away below zero, the Unleasher prices Humanity below zero,
// the Visionary gains from rivals' stability.
//
// A new card using existing effect kinds needs nothing here: it is valued
// from its configuration. A new effect kind needs one EFFECT_IMPACT entry, in
// existing quantities where it can be said that way; only a genuinely new
// kind of benefit needs a new quantity, priced once for each role. A kind
// missing from layer 1 is worth nothing, and the metamorphic checks and
// uptake reports show when that matters.

/** Mean value of a die or modifier effect: a point of score. */
export function effectMean(e) {
  if (e.op === 'die') return e.sign * (e.die + 1) / 2;
  if (e.op === 'fixed') return e.amount;
  if (e.op === 'threshold') return -e.amount;
  return 0;
}

/**
 * The distribution of an action's discovery roll (its `suspicion` table): for
 * each face, the suspicion added, after a roll bonus (Discreet Methods) and a
 * flat reduction. The policies' estimate, from the configuration.
 */
export function discoveryOutcomes(def, { rollBonus = 0, reduction = 0 } = {}) {
  const r = def && def.suspicion;
  if (!r) return [];
  const out = [];
  for (let roll = 1; roll <= r.die; roll++) {
    const band = r.bands.find((b) => roll + rollBonus <= b.max);
    out.push(Math.max(0, (band ? band.amount : 0) - reduction));
  }
  return out;
}
/** Expected suspicion from an action's discovery roll. */
export function expectedDiscovery(def, mods) {
  const o = discoveryOutcomes(def, mods);
  return o.length ? o.reduce((a, b) => a + b, 0) / o.length : 0;
}
/** Chance that a discovery roll adds at least `room` suspicion (the mob, if room is what is left). */
export function discoveryReaches(def, mods, room) {
  const o = discoveryOutcomes(def, mods);
  return o.length && room > 0 ? o.filter((x) => x >= room).length / o.length : 0;
}
/** The most a discovery roll can add. */
export const maxDiscovery = (def, mods) => Math.max(0, ...discoveryOutcomes(def, mods));

// Night actions with discovery rolls a player takes over the rest of a game,
// for valuing effects on those rolls.
const DISCOVERY_ACTIONS_PER_GAME = 3;

/** Suspicion a game's discovery rolls avoid with these modifiers, averaged over the configured discovery actions. */
function discoverySaved(cfg, mods) {
  const defs = Object.values(cfg.actions || {}).filter((d) => d.suspicion);
  if (!defs.length) return 0;
  const saved = defs.reduce((a, d) => a + expectedDiscovery(d) - expectedDiscovery(d, mods), 0) / defs.length;
  return DISCOVERY_ACTIONS_PER_GAME * saved;
}

/** Units of an effect: mean points, uses, or its amount. */
export function effectUnits(e) {
  if (e.kind === 'resurrection' || e.kind === 'control') return effectMean(e);
  // About two hunters per monster; the first `beyond` of them don't count.
  if (e.per === 'rivalHunters') return (e.amount ?? 1) * Math.max(0, 2 - (e.beyond || 0));
  if (e.kind === 'reroll' || e.kind === 'noGarrison' || e.kind === 'pursuit') return e.uses ?? 1;
  return e.amount ?? 1;
}

/**
 * Layer 1: quantities per unit of each effect kind (or, for a function, per
 * copy, computed from the configuration). Quantities:
 *   vitality, humanity  points on my resurrection rolls
 *   control             points on my control rolls
 *   controlAttempts     extra control attempts
 *   money               money over the rest of the game
 *   calm                points of suspicion kept off the table by my play
 *   parts               extra body parts over the game
 *   ferocity            points harder for others to subdue my monsters
 *   hunting             hunting rival monsters without a garrison, per use
 */
export const EFFECT_IMPACT = {
  'resurrection:vitality': { vitality: 1 },
  'resurrection:humanity': { humanity: 1 },
  control: { control: 1 },
  controlAttempts: { controlAttempts: 1 },
  // One more money from each medicine action, over the medicine still to come.
  medicineBonus: { money: 2.5 },
  // Effects on my discovery rolls are worth the suspicion they avoid over a
  // game, computed from the configured rolls (per copy, so units are 1).
  suspicionReduction: (e, cfg) => ({ calm: discoverySaved(cfg, { reduction: e.amount ?? 1 }) }),
  discoveryRollBonus: (e, cfg) => ({ calm: discoverySaved(cfg, { rollBonus: e.amount ?? 1 }) }),
  researchCalm: { calm: 1.5 },
  charityBonus: { calm: 1 },
  quietFailure: { calm: 1 },
  discoveryBoost: { calm: -1.5 },
  gravesBonus: { parts: 2 },
  sellBonus: { money: 0.4 },
  specimenDiscount: { money: 1.2 },
  ferocity: { ferocity: 1 },
  noGarrison: { hunting: 1 },
  pursuit: { hunting: 0.85 },
  // A reroll of a failed attribute is worth about this many points on it.
  'reroll:vitality': { vitality: 3.5 },
  'reroll:humanity': { humanity: 3.9 },
};

/** Layer 2: what one unit of each quantity is worth to a role itself. */
export const QUANTITY_PRICE = {
  default: { vitality: 1.15, humanity: 0.9, control: 1, controlAttempts: 3.5, money: 1, calm: 1, parts: 1, ferocity: -0.3, hunting: 3 },
  prometheus: {},
  visionary: { humanity: 1 },
  // A monster needs Vitality and must lack Humanity; it wants its own monsters loose.
  unleasher: { vitality: 1.3, humanity: -0.3, control: 0.12, controlAttempts: 0.5, ferocity: 1, hunting: 0 },
  // It builds nothing and wants suspicion: calm works against it.
  inquisitor: { vitality: 0.15, humanity: 0.2, control: 0.37, controlAttempts: 1, money: 1.2, calm: -1.3, parts: 0.75, ferocity: 0.1, hunting: 0.5 },
};

/** Layer 2: what one unit of a quantity in a rival's hands costs a role (negative: it gains). */
export const RIVAL_PRICE = {
  prometheus: { vitality: 0.3, humanity: 0.3 },
  // Rivals' stability helps the Visionary: it needs two Creatures at once.
  visionary: { vitality: -0.3, humanity: -0.3 },
  inquisitor: { humanity: 0.3, calm: 1.33 },
  // Rivals' Vitality makes their failures monsters, not corpses; their
  // control and hunting stop monsters.
  unleasher: { vitality: -0.2, humanity: 0.4, control: 0.4, controlAttempts: 1.5, hunting: 2, ferocity: -1 },
};

/** How many rivals an effect counted per prepared rival expects to share a round with. */
export const RIVALS_PREPARING = { default: 0.4, visionary: 1.2, prometheus: 0.2, unleasher: 0.3, inquisitor: 0 };

const priceOf = (objective, q) => {
  const own = QUANTITY_PRICE[objective] || {};
  return own[q] ?? QUANTITY_PRICE.default[q] ?? 0;
};

/** The layer-1 key of an effect. */
export function impactKey(e) {
  if (e.kind === 'resurrection' || e.kind === 'reroll') return `${e.kind}:${e.attribute}`;
  return e.kind;
}

/** Quantities an effect gives, per copy, for an objective's expectations. */
export function effectQuantities(e, objective, cfg = {}) {
  let impact = EFFECT_IMPACT[impactKey(e)];
  if (!impact) return {};
  let units = effectUnits(e);
  if (typeof impact === 'function') { impact = impact(e, cfg); units = 1; }
  if (e.per === 'rivalPrepared') units *= RIVALS_PREPARING[objective] ?? RIVALS_PREPARING.default;
  return Object.fromEntries(Object.entries(impact).map(([q, x]) => [q, x * units]));
}

/**
 * What one copy of a research type is worth to an objective (`want`), and
 * what one copy in a rival's hands costs it (`harm`), in money.
 */
export function researchWorth(cfg, type, objective) {
  let want = 0;
  let harm = 0;
  for (const e of cfg.research[type].effects) {
    for (const [q, x] of Object.entries(effectQuantities(e, objective, cfg))) {
      want += x * priceOf(objective, q);
      harm += x * ((RIVAL_PRICE[objective] || {})[q] || 0);
    }
  }
  return { want, harm };
}

/** The same, leaving out effects of the given kinds (for a policy that values those itself). */
export function researchWorthExcept(cfg, type, objective, skipKinds) {
  const def = cfg.research[type];
  return researchWorth({ ...cfg, research: { [type]: { ...def, effects: def.effects.filter((e) => !skipKinds.includes(e.kind)) } } }, type, objective);
}
