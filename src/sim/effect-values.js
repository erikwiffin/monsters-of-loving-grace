// What science effects are worth to each objective, in two layers.
//
// Layer 1, EFFECT_IMPACT, says what an effect kind does, in a few game
// quantities, per unit of the effect. It is the same for every role, because
// it is a fact about the rules: Galvanic Mastery adds Vitality points, Public
// Lectures takes suspicion off the table, Medical Expertise adds money over
// the game. A unit is a mean point for dice and modifiers, one use for
// abilities, and the effect's amount otherwise (effectUnits).
//
// Layer 2 prices each quantity per role, in money, the heuristic's common
// currency (spec 016). A role's goal sits here: the Inquisitor prices
// suspicion taken away below zero, the Unleasher prices Humanity below zero.
// Science is personal (spec 023), so a card in a rival's hands matters only
// through RIVAL_PRICE: what it costs this role that a rival holds it.
//
// A new card using existing effect kinds needs nothing here: it is valued
// from its configuration. A new effect kind needs one EFFECT_IMPACT entry, in
// existing quantities where it can be said that way. A kind missing from
// layer 1 is worth nothing, and the uptake reports show when that matters.

/** Mean value of a die or modifier effect: a point of score. */
export function effectMean(e) {
  if (e.op === 'die') return e.sign * (e.die + 1) / 2;
  if (e.op === 'fixed') return e.amount;
  return 0;
}

/** Units of an effect: mean points, uses, or its amount. */
export function effectUnits(e) {
  if (e.kind === 'resurrection' || e.kind === 'control') return effectMean(e);
  if (e.kind === 'subdueOwn') return 1;
  return e.amount ?? 1;
}

/**
 * Layer 1: quantities per unit of each effect kind. Quantities:
 *   vitality, humanity  points on my bodies' Vitality and Humanity
 *   control             points on my control rolls
 *   money               money over the rest of the game
 *   calm                points of suspicion kept off the table by my play
 *   hunting             subduing my own monsters without a garrison
 */
export const EFFECT_IMPACT = {
  'resurrection:vitality': { vitality: 1 },
  'resurrection:humanity': { humanity: 1 },
  control: { control: 1 },
  // One more money from each medicine action, over the medicine still to come.
  medicineBonus: { money: 2.5 },
  researchCalm: { calm: 1.5 },
  charityBonus: { calm: 1 },
  subdueOwn: { hunting: 1 },
};

/** Layer 2: what one unit of each quantity is worth to a role itself. */
export const QUANTITY_PRICE = {
  // A Vitality point is worth more than a Humanity point: Vitality is a hard
  // gate on preparing at all.
  default: { vitality: 1.4, humanity: 0.9, control: 0.8, money: 1, calm: 1, hunting: 2 },
  prometheus: {},
  visionary: { humanity: 1 },
  // A monster needs Vitality and must lack Humanity; it wants monsters loose.
  unleasher: { vitality: 1.4, humanity: -0.3, control: 0.05, hunting: 0 },
  // It builds nothing and wants suspicion: calm works against it.
  inquisitor: { vitality: 0.15, humanity: 0.2, control: 0.37, money: 1.2, calm: -1.3, hunting: 0.3 },
};

/** Layer 2: what one unit of a quantity in a rival's hands costs a role (negative: it gains). */
export const RIVAL_PRICE = {
  prometheus: { vitality: 0.3, humanity: 0.3 },
  // Rivals' stability helps the Visionary: it needs two Creatures at once.
  visionary: { vitality: -0.3, humanity: -0.3 },
  inquisitor: { humanity: 0.3, calm: 1.33 },
  // Rivals' Vitality makes monsters possible; their control stops them.
  unleasher: { vitality: -0.2, humanity: 0.4, control: 0.4 },
};

const priceOf = (objective, q) => {
  const own = QUANTITY_PRICE[objective] || {};
  return own[q] ?? QUANTITY_PRICE.default[q] ?? 0;
};

/** The layer-1 key of an effect. */
export function impactKey(e) {
  if (e.kind === 'resurrection') return `${e.kind}:${e.attribute}`;
  return e.kind;
}

/** Quantities an effect gives, per card. */
export function effectQuantities(e) {
  const impact = EFFECT_IMPACT[impactKey(e)];
  if (!impact) return {};
  const units = effectUnits(e);
  return Object.fromEntries(Object.entries(impact).map(([q, x]) => [q, x * units]));
}

/**
 * What one card of a science type is worth to an objective (`want`), and
 * what one in a rival's hands costs it (`harm`), in money.
 */
export function scienceWorth(cfg, type, objective) {
  let want = 0;
  let harm = 0;
  for (const e of cfg.science[type].effects) {
    for (const [q, x] of Object.entries(effectQuantities(e))) {
      want += x * priceOf(objective, q);
      harm += x * ((RIVAL_PRICE[objective] || {})[q] || 0);
    }
  }
  return { want, harm };
}

/** The same, leaving out effects of the given kinds (for a policy that values those itself). */
export function scienceWorthExcept(cfg, type, objective, skipKinds) {
  const def = cfg.science[type];
  return scienceWorth({ ...cfg, science: { [type]: { ...def, effects: def.effects.filter((e) => !skipKinds.includes(e.kind)) } } }, type, objective);
}

/** The science deck's remaining mix, by type, from the catalogue minus every card seen in play. */
export function deckMix(view) {
  const cfg = view.config;
  const left = {};
  for (const [t, d] of Object.entries(cfg.science)) left[t] = d.copies;
  for (const c of view.market || []) left[c.type] = (left[c.type] || 0) - 1;
  for (const p of view.players) for (const c of p.science) left[c.type] = (left[c.type] || 0) - 1;
  const total = Object.values(left).reduce((a, b) => a + Math.max(0, b), 0);
  return total ? Object.entries(left).filter(([, n]) => n > 0).map(([type, n]) => ({ type, weight: n / total })) : [];
}
