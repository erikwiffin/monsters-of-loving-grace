// Tuning and best-response measurement.
//
// A role's balance number is only as good as the bot playing it. The best
// response to a field is the strongest play of one seat of that role against
// standard opponents. Comparing it with the standard bot in the same seat
// shows how much of the role's win rate is the AI's skill, not the rules.
//
// tuneWeights searches the heuristic's weights (DEFAULT_WEIGHTS) for one
// objective with the cross-entropy method, starting from its current
// defaults (OBJECTIVE_WEIGHTS): sample weight vectors around a
// mean (in log space, so every weight stays positive), play each on the same
// seeds, keep the best quarter, and move the mean and spread towards them.
// Each generation uses fresh seeds, so the search can't overfit a few games.

import { DEFAULT_WEIGHTS, OBJECTIVE_WEIGHTS } from './policies.js';
import { runGames } from './parallel.js';
import { wilson, compareRates } from './stats.js';
import { seedState, nextUint32 } from '../engine/rng.js';

const INTEGER_WEIGHTS = new Set(['garrisonAlert', 'expectedRounds']);

/** The seat that deviates from the field: the first one dealt the objective. */
export const deviatorOf = (summary, objective) => Object.keys(summary.objectives).find((pid) => summary.objectives[pid] === objective) || null;

/**
 * Seats of `objective` play `spec`, everyone else `field`: only the first
 * such seat (deviators 'first', a best response to the field) or all of
 * them (deviators 'all', how the role does when everyone playing it plays
 * that way: the right test for a default).
 */
export function deviationSeating(objective, spec, field = 'heuristic', deviators = 'first') {
  return { default: field, byObjective: { [objective]: spec }, deviators };
}

/** Win rate of the deviating seats over games at the given player counts. */
export async function seatWinRate({ objective, spec, field = 'heuristic', deviators = 'first', players = [3, 4, 5, 6], games = 200, seedPrefix = 'br', maxRounds = 60, threads }) {
  const jobs = [];
  for (const n of players) for (let i = 0; i < games; i++) jobs.push({ seed: `${seedPrefix}-${n}-${i}`, config: { playerCount: n }, policies: deviationSeating(objective, spec, field, deviators), maxRounds });
  const results = await runGames(jobs, { threads });
  const byPlayers = {};
  let wins = 0;
  let seats = 0;
  for (const r of results) {
    const pids = deviators === 'all' ? Object.keys(r.objectives).filter((p) => r.objectives[p] === objective) : [deviatorOf(r, objective)].filter(Boolean);
    for (const pid of pids) {
      const won = r.winners.includes(pid) ? 1 : 0;
      const x = byPlayers[r.playerCount] || (byPlayers[r.playerCount] = { wins: 0, seats: 0 });
      x.wins += won; x.seats += 1; wins += won; seats += 1;
    }
  }
  return { wins, seats, ...wilson(wins, seats), byPlayers };
}

function gaussian(st) {
  const u = (nextUint32(st) + 1) / 4294967297;
  const v = (nextUint32(st) + 1) / 4294967297;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Weights at log offsets from an objective's current defaults. */
export function weightsFrom(logs, keys, objective = null) {
  const base = { ...DEFAULT_WEIGHTS, ...(OBJECTIVE_WEIGHTS[objective] || {}) };
  const w = {};
  keys.forEach((k, i) => {
    const x = base[k] * Math.exp(logs[i]);
    w[k] = INTEGER_WEIGHTS.has(k) ? Math.max(1, Math.round(x)) : Math.round(x * 1000) / 1000;
  });
  return w;
}

/**
 * Cross-entropy search over the heuristic's weights for one objective.
 * Returns the final mean weights and the history of each generation.
 */
export async function tuneWeights({
  objective, keys = Object.keys(DEFAULT_WEIGHTS), players = [4, 5], games = 80, generations = 6, population = 10,
  eliteShare = 0.25, sigma = 0.4, seed = 'tune', field = 'heuristic', deviators = 'first', threads, onGeneration = () => {},
}) {
  const st = seedState(`${seed}:${objective}`);
  let mean = keys.map(() => 0);
  let sd = keys.map(() => sigma);
  const history = [];
  for (let g = 0; g < generations; g++) {
    // The current mean is always a candidate, so progress is measured.
    const cands = [mean.slice()];
    while (cands.length < population) cands.push(mean.map((m, i) => m + sd[i] * gaussian(st)));
    const scored = [];
    for (const c of cands) {
      const spec = { policy: 'heuristic', options: { weights: weightsFrom(c, keys, objective) } };
      const r = await seatWinRate({ objective, spec, field, deviators, players, games, seedPrefix: `${seed}-${objective}-g${g}`, threads });
      scored.push({ logs: c, rate: r.rate, seats: r.seats });
    }
    scored.sort((a, b) => b.rate - a.rate);
    const elite = scored.slice(0, Math.max(2, Math.round(population * eliteShare)));
    mean = keys.map((_, i) => elite.reduce((a, e) => a + e.logs[i], 0) / elite.length);
    // Keep some spread, so a noisy generation can't collapse the search.
    sd = keys.map((_, i) => Math.max(0.05, Math.sqrt(elite.reduce((a, e) => a + (e.logs[i] - mean[i]) ** 2, 0) / elite.length)));
    const entry = { generation: g, meanCandidateRate: scored.find((x) => x.logs === cands[0]).rate, best: scored[0].rate, eliteMean: elite.reduce((a, e) => a + e.rate, 0) / elite.length };
    history.push(entry);
    onGeneration(entry);
  }
  return { objective, weights: weightsFrom(mean, keys, objective), history };
}

/**
 * Best-response report: for each objective, the standard bot and each
 * challenger in the same deviating seat, on the same seeds.
 */
export async function bestResponse({ objectives, challengers, players = [3, 4, 5, 6], games = 400, seedPrefix = 'br', field = 'heuristic', threads }) {
  const rows = [];
  for (const objective of objectives) {
    const base = await seatWinRate({ objective, spec: field, field, players, games, seedPrefix, threads });
    for (const [label, spec] of Object.entries(challengers[objective] || {})) {
      const ch = await seatWinRate({ objective, spec, field, players, games, seedPrefix, threads });
      const d = compareRates(base.wins, base.seats, ch.wins, ch.seats);
      const perN = Object.fromEntries(Object.keys(base.byPlayers).map((n) => [n, { standard: base.byPlayers[n].wins / base.byPlayers[n].seats, challenger: ch.byPlayers[n] ? ch.byPlayers[n].wins / ch.byPlayers[n].seats : null }]));
      rows.push({ objective, challenger: label, standard: base, best: ch, gap: d, byPlayers: perN });
    }
  }
  return rows;
}
