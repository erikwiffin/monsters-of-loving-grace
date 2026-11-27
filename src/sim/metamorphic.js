// Metamorphic checks for the AI: configuration changes whose effect on a
// sensible player is known in advance. A failure points at an AI flaw (a
// hard-coded ID, an action valued the wrong way round, money spent on
// nothing) that would otherwise pass for a balance result.
//
// Each check runs a base and a transformed batch on the same seeds and tests
// one relation:
//   - an action made strictly cheaper or safer is not used less;
//   - a research card with no effect is not bought;
//   - renaming every research type, or the players, changes nothing at all:
//     the same seeds give the same games, move for move (the AI must depend
//     on effects, never on IDs).
//
// The exact checks need only a few games; the statistical ones (not-less,
// rare) default to 150 and scale with `scale`.

import { DEFAULT_CONFIG, resolveConfig } from '../engine/index.js';
import { runGames } from './parallel.js';
import { compareRates, normalP } from './stats.js';

const clone = (x) => JSON.parse(JSON.stringify(x));

/** Mean and standard error of a per-game statistic. */
function meanSe(xs) {
  const n = xs.length;
  const m = xs.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / Math.max(1, n - 1);
  return { mean: m, se: Math.sqrt(v / Math.max(1, n)) };
}
const perPlayerRound = (actionId) => (r) => (r.economy.actions[actionId] ? r.economy.actions[actionId].placements : 0) / Math.max(1, r.rounds * r.playerCount);

/** Renames every research type of a configuration (x → prefix + x), retiring the old names from the deck. */
export function renameResearch(prefix = 'renamed_', cfg = DEFAULT_CONFIG) {
  const research = {};
  for (const [t, def] of Object.entries(cfg.research)) {
    research[prefix + t] = clone(def);
    research[t] = { copies: 0 };
  }
  return { research };
}

export const CHECKS = [
  {
    id: 'cheaper-specimens',
    text: 'Buying specimens at half price is not done less often',
    config: { actions: { specimens: { cost: 1 } } },
    relation: 'not-less', games: 150, stat: perPlayerRound('specimens'),
  },
  {
    id: 'cheaper-research',
    text: 'Research at half price is not done less often',
    config: { actions: { research: { cost: 1 } } },
    relation: 'not-less', games: 150, stat: perPlayerRound('research'),
  },
  {
    id: 'quiet-graves',
    text: 'Graves that never raise suspicion are not robbed less often',
    config: { actions: { graves: { suspicion: { die: 6, bands: [{ max: 6, amount: 0 }] } } } },
    relation: 'not-less', games: 150, stat: perPlayerRound('graves'),
  },
  {
    id: 'blank-research',
    // The Inquisitor may buy it to block a research slot, which is a reason.
    text: 'A research card with no effect is not bought, except to block a slot',
    config: { research: { blank: { name: 'Blank', text: 'No effect.', effects: [] } } },
    relation: 'rare', limit: 0.05, games: 100,
    stat: (r) => (((r.uptake.acquiredBy.blank || {}).research) || []).filter((pid) => r.objectives[pid] !== 'inquisitor').length,
  },
  {
    id: 'renamed-research',
    // Retired names keep their place with no copies, and the new names sort
    // in the same order, so the deck and every roll are the same: any
    // difference is the AI reading an ID.
    text: 'Renaming every research type changes nothing at all',
    // A function of the rules under test, so a changed card is renamed as changed.
    config: (cfg) => renameResearch('renamed_', cfg),
    relation: 'identical', games: 20, exact: true,
  },
  {
    id: 'renamed-players',
    text: 'Renaming the players changes nothing at all',
    config: { playerNames: ['Ada', 'Byron', 'Clerval', 'Dora', 'Elizabeth', 'Felix'] },
    relation: 'identical', games: 20, exact: true,
  },
];

function jobs(config, n, policies, games, seedPrefix, includeCommands = false) {
  return Array.from({ length: games }, (_, i) => ({ seed: `${seedPrefix}-${n}-${i}`, config: { ...config, playerCount: n }, policies, maxRounds: 60, includeCommands }));
}

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
/** Overrides on top of overrides, merged deeply (arrays replaced), as the engine merges them. */
export function mergeOverrides(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) out[k] = isObj(v) && isObj(a[k]) ? mergeOverrides(a[k], v) : v;
  return out;
}

/** Runs one check under one policy set and player count; `base` is the rules to start from (a candidate change). */
export async function runCheck(check, { players = 4, policies = 'heuristic', games: forced, scale = 1, alpha = 0.01, seedPrefix = 'meta', threads, base: rules = {} } = {}) {
  // Exact checks need few games; statistical ones scale.
  const games = forced ?? (check.exact ? check.games : Math.round((check.games || 150) * scale));
  const transform = typeof check.config === 'function' ? check.config(resolveConfig({ ...rules, playerCount: players })) : check.config;
  const [base, cand] = await Promise.all([
    runGames(jobs(rules, players, policies, games, seedPrefix, !!check.exact), { threads }),
    runGames(jobs(mergeOverrides(rules, transform), players, policies, games, seedPrefix, !!check.exact), { threads }),
  ]);
  const out = { id: check.id, text: check.text, players, policies, games };
  if (check.relation === 'not-less') {
    const a = meanSe(base.map(check.stat));
    const b = meanSe(cand.map(check.stat));
    const z = (b.mean - a.mean) / Math.sqrt(a.se * a.se + b.se * b.se || 1e-12);
    // One-sided: fail only if significantly lower.
    const p = z < 0 ? normalP(z) / 2 : 1;
    return { ...out, pass: p >= alpha, detail: `per player-round ${a.mean.toFixed(3)} → ${b.mean.toFixed(3)} (p for a drop ${p.toFixed(3)})` };
  }
  if (check.relation === 'rare') {
    const b = meanSe(cand.map(check.stat));
    return { ...out, pass: b.mean <= check.limit, detail: `${b.mean.toFixed(3)} per game (limit ${check.limit})` };
  }
  if (check.relation === 'unchanged') {
    const fails = [];
    const tallies = (rs) => {
      const dealt = {}; const wins = {};
      for (const r of rs) {
        for (const o of Object.values(r.objectives)) dealt[o] = (dealt[o] || 0) + 1;
        for (const o of r.winnerObjectives) wins[o] = (wins[o] || 0) + 1;
      }
      return { dealt, wins };
    };
    const ta = tallies(base);
    const tb = tallies(cand);
    const tests = [];
    for (const o of Object.keys(ta.dealt)) {
      const d = compareRates(ta.wins[o] || 0, ta.dealt[o], tb.wins[o] || 0, tb.dealt[o]);
      tests.push({ what: `${o} win rate`, a: d.a, b: d.b, p: d.p });
    }
    for (const id of Object.keys(DEFAULT_CONFIG.actions)) {
      const a = meanSe(base.map(perPlayerRound(id)));
      const b = meanSe(cand.map(perPlayerRound(id)));
      const z = (b.mean - a.mean) / Math.sqrt(a.se * a.se + b.se * b.se || 1e-12);
      tests.push({ what: `${id} use`, a: a.mean, b: b.mean, p: normalP(z) });
    }
    // Many tests at once: Bonferroni, so one check fails by chance at most alpha of the time.
    const cut = alpha / tests.length;
    for (const t of tests) if (t.p < cut) fails.push(`${t.what} ${t.a.toFixed(3)} → ${t.b.toFixed(3)} (p ${t.p.toExponential(1)})`);
    return { ...out, pass: !fails.length, detail: fails.length ? fails.join('; ') : `${tests.length} quantities unchanged` };
  }
  if (check.relation === 'identical') {
    // Move for move: the same commands, in the same order.
    const key = (r) => JSON.stringify([r.winners, r.rounds, r.commandCount, r.finalSuspicion, r.commands]);
    const diff = base.filter((r, i) => key(r) !== key(cand[i])).length;
    return { ...out, pass: diff === 0, detail: `${diff} of ${games} games differ` };
  }
  throw new Error(`unknown relation ${check.relation}`);
}
