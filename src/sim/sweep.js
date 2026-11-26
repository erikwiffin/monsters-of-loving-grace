// Parameter sweeps (spec 016): sample configuration values, run batches
// through the ordinary runner, and score each point against design targets.
// Rules are never touched here; every value reaches the engine as a config
// override and is validated by it.

import { resolveConfig, DEFAULT_CONFIG } from '../engine/index.js';
import { seedState, randInt } from '../engine/rng.js';

const clone = (x) => JSON.parse(JSON.stringify(x));

/** Default design targets. A sweep file may override any of them. */
export const DEFAULT_TARGETS = {
  maxWinSpread: 0.10, // largest gap between any two objectives' win rates
  roundsMin: 7, // median ending round
  roundsMax: 10,
  maxTruncated: 0, // share of games stopped by the round budget
  minUsedRate: 0.3, // each capped space used in at least this share of rounds
  maxFullRate: 0.85, // no capped space full in more than this share of rounds
  fallbackMinPerRound: 1, // unlimited spaces (other than private ones) used this often
  fallbackActions: ['medicine'],
  maxSeatSpread: 0.10, // win rate gap between initiative seats in round 1
  ignoreActions: ['prepare', 'assemble'], // private spaces with no economy target
};

// ---------------------------------------------------------------------------
// Parameter space
// ---------------------------------------------------------------------------

/**
 * Parameters are keyed by a dotted config path, such as
 * `actions.medicine.gain` or `actions.graves.suspicion.bands.0.max`.
 * Several paths joined with `|` share one value, so one variable can drive
 * several numbers (for example every 2/3 space's larger tier).
 * A value spec is an array of values, or { min, max, step } for integers.
 */
export function paramValues(spec) {
  if (Array.isArray(spec)) return spec;
  if (spec && Number.isInteger(spec.min) && Number.isInteger(spec.max)) {
    const step = spec.step || 1;
    const out = [];
    for (let v = spec.min; v <= spec.max; v += step) out.push(v);
    return out;
  }
  throw new Error(`Bad parameter spec ${JSON.stringify(spec)}: use an array or { min, max, step }`);
}

/**
 * Points to run. Samplers:
 * - `oat` (one at a time): the baseline, then each parameter's values with the
 *   others at their baseline. For finding which variables matter.
 * - `grid`: every combination. Practical for one to three parameters.
 * - `random`: `samples` independent uniform draws from each parameter's values.
 * - `lhs`: Latin hypercube; each parameter's values are spread evenly over
 *   `samples` points, then shuffled independently.
 */
export function samplePoints({ params = {}, sampler = 'oat', samples = 20, seed = 'sweep' }) {
  const keys = Object.keys(params);
  const values = Object.fromEntries(keys.map((k) => [k, paramValues(params[k])]));
  const rng = seedState(String(seed));
  if (!keys.length) return [{}];
  if (sampler === 'oat') {
    const out = [{}];
    for (const k of keys) for (const v of values[k]) out.push({ [k]: v });
    return out;
  }
  if (sampler === 'grid') {
    let out = [{}];
    for (const k of keys) out = out.flatMap((p) => values[k].map((v) => ({ ...p, [k]: v })));
    return out;
  }
  if (sampler === 'random') {
    return Array.from({ length: samples }, () => Object.fromEntries(keys.map((k) => [k, values[k][randInt(rng, values[k].length)]])));
  }
  if (sampler === 'lhs') {
    const cols = {};
    for (const k of keys) {
      const col = Array.from({ length: samples }, (_, i) => values[k][Math.floor((i + 0.5) * values[k].length / samples)]);
      for (let i = col.length - 1; i > 0; i--) { const j = randInt(rng, i + 1); [col[i], col[j]] = [col[j], col[i]]; }
      cols[k] = col;
    }
    return Array.from({ length: samples }, (_, i) => Object.fromEntries(keys.map((k) => [k, cols[k][i]])));
  }
  throw new Error(`Unknown sampler ${sampler}`);
}

function setPath(obj, path, value) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (o[k] === undefined || o[k] === null || typeof o[k] !== 'object') {
      throw new Error(`Config path ${path} does not exist (at ${parts.slice(0, i + 1).join('.')})`);
    }
    o = o[k];
  }
  o[parts[parts.length - 1]] = value;
}

/**
 * The full configuration for a point: the defaults, then the sweep's base
 * overrides, then the point's values. Returning the whole resolved config
 * (rather than a sparse override) lets a path reach into arrays such as
 * discovery-roll bands. Throws if the engine rejects the result.
 */
export function configForPoint(base, point, playerCount) {
  const cfg = clone(resolveConfig({ ...clone(base || {}), playerCount }));
  for (const [key, value] of Object.entries(point)) for (const path of key.split('|')) setPath(cfg, path, clone(value));
  cfg.playerCount = playerCount;
  resolveConfig(cfg);
  return cfg;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Scores one aggregate (one point, one player count, one policy set) against
 * the targets. Returns the total penalty (0 = every target met) and its parts,
 * so a reader can see why a point scored badly.
 */
export function scoreAggregate(agg, targets = DEFAULT_TARGETS) {
  const t = { ...DEFAULT_TARGETS, ...targets };
  const parts = {};
  if (agg.invalidCommands) parts.invalidCommands = 100;
  const rates = Object.values(agg.winRateByObjective || {});
  const spread = rates.length ? Math.max(...rates) - Math.min(...rates) : 0;
  if (spread > t.maxWinSpread) parts.winSpread = (spread - t.maxWinSpread) * 10;
  const r = agg.medianRounds;
  if (r < t.roundsMin) parts.rounds = (t.roundsMin - r) / 2;
  if (r > t.roundsMax) parts.rounds = (r - t.roundsMax) / 2;
  const trunc = agg.games ? agg.truncated / agg.games : 0;
  if (trunc > t.maxTruncated) parts.truncated = (trunc - t.maxTruncated) * 20;
  for (const [id, a] of Object.entries(agg.actions || {})) {
    if (t.ignoreActions.includes(id)) continue;
    if (a.capacity != null) {
      if (a.usedRate < t.minUsedRate) parts[`${id}.underused`] = (t.minUsedRate - a.usedRate) * 3;
      if (a.fullRate > t.maxFullRate) parts[`${id}.crowded`] = (a.fullRate - t.maxFullRate) * 3;
    } else if (t.fallbackActions.includes(id) && a.perRound < t.fallbackMinPerRound) {
      parts[`${id}.fallback`] = (t.fallbackMinPerRound - a.perRound) * 2;
    }
  }
  const seats = agg.winRateBySeat || [];
  const seatSpread = seats.length ? Math.max(...seats) - Math.min(...seats) : 0;
  if (seatSpread > t.maxSeatSpread) parts.seatSpread = (seatSpread - t.maxSeatSpread) * 5;
  for (const k of Object.keys(parts)) parts[k] = Math.round(parts[k] * 1000) / 1000;
  const total = Math.round(Object.values(parts).reduce((a, b) => a + b, 0) * 1000) / 1000;
  return { total, parts, spread: Math.round(spread * 1000) / 1000, seatSpread: Math.round(seatSpread * 1000) / 1000 };
}

/** A compact, comparable summary of one aggregate for sweep output. */
export function compactAggregate(agg) {
  return {
    games: agg.games,
    truncated: agg.truncated,
    medianRounds: agg.medianRounds,
    byReason: agg.byReason,
    winRateByObjective: agg.winRateByObjective,
    winRateBySeat: agg.winRateBySeat,
    collectiveDefeats: agg.collectiveDefeats,
    avgFinalSuspicion: agg.avgFinalSuspicion,
    resurrections: agg.resurrections,
    avgIgors: agg.avgIgors,
    avgMoneyLeft: agg.avgMoneyLeft,
    invalidCommands: agg.invalidCommands,
    actions: agg.actions,
  };
}

export { DEFAULT_CONFIG };
