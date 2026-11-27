// Compare two arms of games, each a configuration and a seating, on the same
// seeds (common random numbers), under several policy sets at once.
//
// A rule change compares two configurations under the same policies; a
// policy change compares two seatings under the same rules. For every player
// count and policy set the comparison reports each objective's win rate in
// both arms, the difference with a 95% interval, and a p-value. With a game
// budget above `games` (maxGames), it plays more games, doubling, until every
// difference is either significant or known to within the requested
// precision, or the budget runs out; by default it plays `games` and stops.
//
// Across policy sets it gives a verdict per objective and player count:
//   robust          every set that shows a significant change agrees on its direction
//   policy-dependent sets disagree significantly: the effect comes from how the AI plays
//   no clear effect  no set shows a significant change

import { runGames } from './parallel.js';
import { compareRates } from './stats.js';
import { specName } from './registry.js';

/**
 * A policy set given as text: 'heuristic', 'cautious,bold' for seats in
 * order, or JSON for a seating or spec (registry.js), such as
 * '{"policy":"heuristic","options":{"weights":{"mobStake":0}},"label":"old"}'.
 */
export function parsePolicySet(text) {
  const t = text.trim();
  if (t.startsWith('{') || t.startsWith('[')) return JSON.parse(t);
  return t.includes(',') ? t.split(',') : t;
}
const setLabel = (set) => (Array.isArray(set) ? set.map(specName).join(',') : typeof set === 'object' && set.label ? set.label : specName(set));

function jobsFor(arm, n, set, from, to, seedPrefix, maxRounds) {
  const jobs = [];
  for (let i = from; i < to; i++) {
    jobs.push({ seed: `${seedPrefix}-${n}-${i}`, config: { ...(arm.config || {}), playerCount: n }, policies: arm.policies || set, maxRounds });
  }
  return jobs;
}

export function tally(results) {
  const dealt = {};
  const wins = {};
  let none = 0;
  for (const r of results) {
    for (const o of Object.values(r.objectives)) dealt[o] = (dealt[o] || 0) + 1;
    for (const o of r.winnerObjectives) wins[o] = (wins[o] || 0) + 1;
    if (!r.winners.length) none += 1;
  }
  return { dealt, wins, none, games: results.length, truncated: results.filter((r) => r.truncated).length };
}

export function diffs(ta, tb) {
  const out = {};
  for (const o of Object.keys({ ...ta.dealt, ...tb.dealt }).sort()) out[o] = compareRates(ta.wins[o] || 0, ta.dealt[o] || 0, tb.wins[o] || 0, tb.dealt[o] || 0);
  out['(no winner)'] = compareRates(ta.none, ta.games, tb.none, tb.games);
  return out;
}

const settled = (d, alpha, precision) => d.p < alpha || (d.hi - d.lo) / 2 <= precision;

/**
 * Runs the comparison. Arms are { config, policies?, label? }; an arm without
 * `policies` plays each policy set in turn. Returns per-cell results and the
 * verdicts.
 */
export async function compareArms({
  a, b, players = [3, 4, 5, 6], policySets = ['heuristic'], games = 200, maxGames = games,
  precision = 0.03, alpha = 0.05, seedPrefix = 'cmp', maxRounds = 60, threads, onProgress = () => {},
}) {
  const cells = [];
  for (const n of players) {
    for (const set of policySets) {
      let ra = [];
      let rb = [];
      let target = games;
      for (;;) {
        const [na, nb] = await Promise.all([
          runGames(jobsFor(a, n, set, ra.length, target, seedPrefix, maxRounds), { threads }),
          runGames(jobsFor(b, n, set, rb.length, target, seedPrefix, maxRounds), { threads }),
        ]);
        ra = ra.concat(na);
        rb = rb.concat(nb);
        const d = diffs(tally(ra), tally(rb));
        const open = Object.values(d).filter((x) => !settled(x, alpha, precision)).length;
        onProgress({ players: n, set: setLabel(set), games: target, open });
        if (!open || target * 2 > maxGames) {
          cells.push({ players: n, set: setLabel(set), games: target, a: tally(ra), b: tally(rb), diffs: d });
          break;
        }
        target *= 2;
      }
    }
  }
  return { cells, verdicts: verdicts(cells, alpha) };
}

export function verdicts(cells, alpha = 0.05) {
  const out = {};
  for (const n of [...new Set(cells.map((c) => c.players))]) {
    const mine = cells.filter((c) => c.players === n);
    const objectives = [...new Set(mine.flatMap((c) => Object.keys(c.diffs)))];
    out[n] = {};
    for (const o of objectives) {
      const sig = mine.map((c) => c.diffs[o]).filter((d) => d && d.p < alpha);
      const ups = sig.filter((d) => d.diff > 0).length;
      const downs = sig.filter((d) => d.diff < 0).length;
      const dir = ups ? 'increase' : 'decrease';
      out[n][o] = !sig.length ? 'no clear effect'
        : ups && downs ? 'policy-dependent'
          : mine.length === 1 ? `${dir} (one policy set: robustness untested)`
            : sig.length === mine.length ? `robust ${dir}` : `${dir} under ${sig.length} of ${mine.length} sets, none opposed`;
    }
  }
  return out;
}

const p1 = (x) => `${(100 * x).toFixed(1)}`;
const signed = (x) => `${x >= 0 ? '+' : ''}${p1(x)}`;

/** A plain-text report of a comparison. */
export function formatComparison({ cells, verdicts: v }, { labels = ['A', 'B'] } = {}) {
  const lines = [];
  for (const c of cells) {
    lines.push(`${c.players}p  ${c.set}  (${c.games} games per arm; truncated ${c.a.truncated}/${c.b.truncated})`);
    lines.push(`  ${'objective'.padEnd(13)} ${labels[0].padStart(7)} ${labels[1].padStart(7)}   change [95% interval]      p`);
    for (const [o, d] of Object.entries(c.diffs)) {
      const mark = d.p < 0.05 ? ' *' : '';
      lines.push(`  ${o.padEnd(13)} ${p1(d.a).padStart(6)}% ${p1(d.b).padStart(6)}%   ${signed(d.diff).padStart(6)} [${signed(d.lo)}, ${signed(d.hi)}]`.padEnd(62) + `${d.p.toFixed(3)}${mark}`);
    }
  }
  const tests = cells.reduce((a, c) => a + Object.keys(c.diffs).length, 0);
  lines.push('');
  lines.push(`* p < 0.05. With ${tests} comparisons, about ${(tests * 0.05).toFixed(1)} would be marked by chance alone.`);
  lines.push('');
  lines.push('Verdicts across policy sets:');
  for (const [n, row] of Object.entries(v)) {
    lines.push(`  ${n}p  ${Object.entries(row).map(([o, x]) => `${o}: ${x}`).join('; ')}`);
  }
  return lines.join('\n');
}
