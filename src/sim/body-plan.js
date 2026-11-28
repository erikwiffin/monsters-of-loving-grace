// Body planning for the AI policies: pure helpers over a player's view.
// Nothing here is a rule; the engine decides what is legal. These estimate
// what a hand of parts is worth to an objective.

/** Exact chance that a sum of dice and fixed modifiers reaches `threshold`. */
export function chanceAtLeast(effects, threshold) {
  let dist = new Map([[0, 1]]);
  for (const e of effects) {
    const faces = e.op === 'die' ? Array.from({ length: e.die }, (_, i) => e.sign * (i + 1)) : [e.amount];
    const next = new Map();
    for (const [v, pr] of dist) for (const f of faces) next.set(v + f, (next.get(v + f) || 0) + pr / faces.length);
    dist = next;
  }
  let p = 0;
  for (const [v, pr] of dist) if (v >= threshold) p += pr;
  return p;
}

export const dieMean = (e) => (e.op === 'die' ? e.sign * (e.die + 1) / 2 : e.amount);

/** A part variant's Vitality and its Humanity dice. */
export function variantStats(cfg, variantId) {
  const v = cfg.partVariants[variantId];
  let vitality = 0;
  const humanity = [];
  for (const e of v.effects) {
    if (e.attribute === 'vitality') vitality += e.amount;
    else if (e.attribute === 'humanity') humanity.push(e);
  }
  return { vitality, humanity, humanityMean: humanity.reduce((a, e) => a + dieMean(e), 0) };
}

/** Science effects a player holds, one per card: { vitality, humanity: [dice], control: [effects] }. */
export function scienceStats(cfg, cards) {
  const out = { vitality: 0, humanity: [], control: [], kinds: {} };
  for (const c of cards) {
    const def = cfg.science[c.type];
    if (!def) continue;
    for (const e of def.effects) {
      out.kinds[e.kind] = (out.kinds[e.kind] || 0) + (e.amount ?? 1);
      if (e.kind === 'resurrection' && e.attribute === 'vitality') out.vitality += e.amount;
      else if (e.kind === 'resurrection' && e.attribute === 'humanity') out.humanity.push(e);
      else if (e.kind === 'control') out.control.push(e);
    }
  }
  return out;
}

const fullSet = (cfg) => Object.fromEntries(Object.entries(cfg.partTypes).map(([t, d]) => [t, d.slots.length]));

function choose(arr, k, start = 0, prefix = [], out = []) {
  if (prefix.length === k) { out.push([...prefix]); return out; }
  for (let i = start; i < arr.length; i++) { prefix.push(arr[i]); choose(arr, k, i + 1, prefix, out); prefix.pop(); }
  return out;
}

/**
 * The best body a hand of parts can make for an objective. `sign` is +1 for a
 * player who wants Humanity (a stable Creature) and −1 for one who wants a
 * monster. Bodies that reach the Vitality threshold always beat those that
 * don't; among those, Humanity decides (its exact chance when `exact`).
 *
 * Returns { ids, vitality, humanityMean, pStable, ok, missing } where
 * `missing` counts the parts still needed for a full set (ids is then null).
 */
export function planBody(cfg, hand, science, { sign = 1, exact = true } = {}) {
  const need = fullSet(cfg);
  const T = cfg.resurrection.thresholds.vitality;
  const H = cfg.resurrection.thresholds.humanity;
  let missing = 0;
  const perType = {};
  for (const [t, n] of Object.entries(need)) {
    // One representative per variant (and as many copies as can be used).
    const byVariant = new Map();
    for (const p of hand.filter((x) => x.type === t)) {
      const g = byVariant.get(p.variantId) || [];
      if (g.length < n) g.push(p);
      byVariant.set(p.variantId, g);
    }
    const pool = [...byVariant.values()].flat();
    missing += Math.max(0, n - pool.length);
    perType[t] = pool.length >= n ? choose(pool, n) : null;
  }
  const bonus = science.vitality;
  if (missing) {
    // No full set yet: the best Vitality the parts in hand reach so far.
    let vit = bonus;
    for (const [t, n] of Object.entries(need)) {
      const vals = hand.filter((x) => x.type === t).map((x) => variantStats(cfg, x.variantId).vitality).sort((a, b) => b - a);
      vit += vals.slice(0, n).reduce((a, b) => a + b, 0);
    }
    return { ids: null, vitality: vit, humanityMean: 0, pStable: 0, ok: false, missing };
  }
  // Vitality and Humanity add up independently per type, so a small dynamic
  // programme over the Vitality total finds the best body: for each total,
  // the picks with the best Humanity for this objective.
  let dp = new Map([[bonus, { h: 0, parts: [] }]]);
  for (const t of Object.keys(need)) {
    const picks = [];
    const seen = new Set();
    for (const pick of perType[t]) {
      const key = pick.map((x) => x.variantId).sort().join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      const stats = pick.map((x) => variantStats(cfg, x.variantId));
      picks.push({ pick, v: stats.reduce((a, x) => a + x.vitality, 0), h: stats.reduce((a, x) => a + x.humanityMean, 0) });
    }
    const next = new Map();
    for (const [v, st] of dp) {
      for (const k of picks) {
        const nv = v + k.v;
        const nh = st.h + k.h;
        const cur = next.get(nv);
        if (!cur || sign * nh > sign * cur.h) next.set(nv, { h: nh, parts: [...st.parts, ...k.pick] });
      }
    }
    dp = next;
  }
  let best = null;
  for (const [vitality, st] of dp) {
    const ok = vitality >= T;
    const score = (ok ? 1e6 : vitality * 1e3) + sign * st.h * 10 + vitality * 0.01;
    if (!best || score > best.score) best = { parts: st.parts, stats: st.parts.map((x) => variantStats(cfg, x.variantId)), vitality, ok, humanityMean: 10.5 + st.h + science.humanity.reduce((a, e) => a + dieMean(e), 0), score };
  }
  let pStable = 0;
  if (exact) {
    const dice = [{ op: 'die', die: cfg.resurrection.baseDie, sign: 1 }, ...best.stats.flatMap((x) => x.humanity), ...science.humanity];
    pStable = chanceAtLeast(dice, H);
  }
  return { ids: best.parts.map((x) => x.id), vitality: best.vitality, humanityMean: best.humanityMean, pStable, ok: best.ok, missing: 0 };
}

/** The exact Humanity chance and Vitality of a chosen set of parts. */
export function bodyOdds(cfg, parts, science) {
  const stats = parts.map((x) => variantStats(cfg, x.variantId));
  const dice = [{ op: 'die', die: cfg.resurrection.baseDie, sign: 1 }, ...stats.flatMap((x) => x.humanity), ...science.humanity];
  return {
    vitality: science.vitality + stats.reduce((a, x) => a + x.vitality, 0),
    pStable: chanceAtLeast(dice, cfg.resurrection.thresholds.humanity),
  };
}

/** The deck's catalogue as weighted variants: [{ variantId, weight }] summing to 1. */
export function partMix(cfg) {
  const total = Object.values(cfg.partVariants).reduce((a, v) => a + v.copies, 0) || 1;
  return Object.entries(cfg.partVariants).filter(([, v]) => v.copies > 0).map(([variantId, v]) => ({ variantId, weight: v.copies / total }));
}

/** Expected best of `n` independent draws from a weighted list of values. */
export function expectedMax(values, n) {
  const sorted = [...values].sort((a, b) => a.value - b.value);
  let cum = 0;
  let prevPow = 0;
  let e = 0;
  for (const { value, weight } of sorted) {
    cum += weight;
    const pow = Math.pow(Math.min(1, cum), n);
    e += value * (pow - prevPow);
    prevPow = pow;
  }
  return e;
}
