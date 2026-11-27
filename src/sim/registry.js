// Named policies, and serializable policy specs, so batch tools can describe
// who plays which seat as plain data (for worker threads and result files).
//
// A policy spec is one of:
//   - a name: 'heuristic', 'random', 'cautious', 'bold', 'noisy', 'bt';
//   - { policy: name, options: {...} }, passed to the factory (for example a
//     tuned heuristic: { policy: 'heuristic', options: { weights: {...} } });
//   - an object with decide(), used as is.
// A seating says which spec plays each seat:
//   - a spec, for every seat;
//   - an array of specs, assigned to seats in order;
//   - { default: spec, byObjective: { prometheus: spec, ... }, deviators: 'first' | 'all' }:
//     seats dealt an objective listed in byObjective play its spec; with
//     deviators 'first' (the default) only the first such seat does, so one
//     player deviates from the field.

import { POLICIES, heuristicPolicy } from './policies.js';
import { btPrometheusPolicy } from './bt-prometheus.js';

export const POLICY_FACTORIES = {
  ...POLICIES,
  // A weaker heuristic that picks at random among options within one unit of
  // its best: similar structure, different skill, for robustness checks.
  // (More uniform noise makes it hoard: idle options win.)
  noisy: (seed, opts = {}) => ({ ...heuristicPolicy(seed, { margin: 1, ...opts }), name: 'noisy' }),
  // The behaviour-tree policy: its own tree as Prometheus, the heuristic otherwise.
  bt: (seed, opts = {}) => btPrometheusPolicy(seed, opts),
};

export function specName(spec) {
  if (typeof spec === 'string') return spec;
  if (spec && spec.policy) return spec.label || spec.policy;
  return (spec && spec.name) || 'custom';
}

/** Builds a policy from a spec. */
export function makePolicy(spec, seed) {
  if (typeof spec === 'string') spec = { policy: spec };
  if (spec && typeof spec.decide === 'function') return spec;
  const make = POLICY_FACTORIES[spec && spec.policy];
  if (!make) throw new Error(`Unknown policy ${JSON.stringify(spec)}`);
  const p = make(seed, spec.options || {});
  return spec.label ? { ...p, name: spec.label } : p;
}

/** The spec for one seat, given its index and objective, and which seats came before. */
export function seatSpec(seating, { index, objective, objectivesBefore }) {
  if (Array.isArray(seating)) return seating[index % seating.length];
  if (seating && typeof seating === 'object' && (seating.byObjective || seating.default)) {
    const special = seating.byObjective && seating.byObjective[objective];
    const first = !objectivesBefore.includes(objective);
    if (special && (seating.deviators === 'all' || first)) return special;
    return seating.default || 'heuristic';
  }
  return seating;
}
