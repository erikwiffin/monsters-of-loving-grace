// Headless sandbox orchestrator. Drives games through the same engine the
// browser uses. The orchestrator may read authoritative state for metrics,
// but policies only receive filtered observations and legal commands.

import {
  createGame, dispatch, getPlayerView, enumerateLegalCommands, getReplayRecord, capacityFor,
} from '../engine/index.js';
import { POLICIES } from './policies.js';

function resolvePolicyFactory(policies, seed) {
  // policies: string | policy | array of (string | policy) | (playerId, index) => policy
  const cache = {};
  return (pid, index) => {
    if (cache[pid]) return cache[pid];
    let spec = policies;
    if (typeof policies === 'function') spec = policies(pid, index);
    else if (Array.isArray(policies)) spec = policies[index % policies.length];
    if (typeof spec === 'string') {
      const make = POLICIES[spec];
      if (!make) throw new Error(`Unknown policy ${spec}`);
      spec = make(`${seed}:${pid}:${spec}`);
    }
    cache[pid] = spec;
    return spec;
  };
}

/**
 * Action-economy metrics from the event log: placements per action, how many
 * phases each capped space filled, worker hires, money left at the end, and
 * the seat order of round 1 (for first-player advantage).
 */
function economyMetrics(state) {
  const actions = {};
  for (const id of Object.keys(state.config.actions)) actions[id] = { placements: 0, igorPlacements: 0, full: 0, roundsUsed: 0, capacity: capacityFor(state.config, id) };
  const perPhase = {};
  const usedIn = new Set();
  let firstRound = null;
  for (const e of state.events) {
    if (e.type === 'ROUND_STARTED' && e.round === 1) firstRound = e.initiative;
    if (e.type !== 'WORKER_PLACED') continue;
    const a = actions[e.actionId];
    a.placements += 1;
    if (e.workerKind === 'igor') a.igorPlacements += 1;
    if (!usedIn.has(`${e.round}:${e.actionId}`)) { usedIn.add(`${e.round}:${e.actionId}`); a.roundsUsed += 1; }
    const key = `${e.round}:${e.phase}:${e.actionId}`;
    perPhase[key] = (perPhase[key] || 0) + 1;
    if (a.capacity != null && perPhase[key] === a.capacity) a.full += 1;
  }
  return {
    actions,
    igors: Object.fromEntries(state.players.map((p) => [p.id, Object.values(state.workers).filter((w) => w.ownerId === p.id && w.kind === 'igor').length])),
    moneyLeft: Object.fromEntries(state.players.map((p) => [p.id, p.money])),
    initialOrder: firstRound || [],
  };
}

function summarize(state, { seed, commands, truncated, truncationReason, invalidCommands, policyNames, includeCommands }) {
  const r = state.result;
  return {
    seed: String(seed),
    engineVersion: state.engineVersion,
    playerCount: state.players.length,
    policies: policyNames,
    terminal: !!r,
    truncated,
    truncationReason: truncationReason || null,
    terminalReason: r ? r.reason : null,
    winners: r ? r.winners : [],
    winnerObjectives: r ? r.winners.map((pid) => state.objectives[pid]) : [],
    collectiveDefeat: r ? r.collectiveDefeat : null,
    objectives: { ...state.objectives },
    unseenObjectives: [...state.unseenObjectives],
    rounds: state.round,
    commandCount: commands.length,
    invalidCommands,
    finalSuspicion: state.suspicion,
    suspicionHistory: state.suspicionHistory.map((h) => ({ round: h.round, phase: h.phase, value: h.value, delta: h.delta, reason: h.reason, playerId: h.playerId })),
    resurrections: state.resurrections,
    economy: economyMetrics(state),
    ...(includeCommands ? { commands: getReplayRecord(state).commands } : {}),
  };
}

function setup(opts) {
  const { seed = 'sim', config = {}, policies = 'heuristic' } = opts;
  const state = createGame(config, seed);
  const policyFor = resolvePolicyFactory(policies, seed);
  return { state, policyFor };
}

function step(state, policyFor, decision, pid, counters) {
  let res = dispatch(state, decision);
  if (!res.ok) {
    counters.invalid += 1;
    // A misbehaving policy forfeits this decision: fall back to the first legal command.
    res = dispatch(state, enumerateLegalCommands(state, pid)[0]);
  }
  return res.state;
}

function budgetExceeded(state, commands, maxCommands, maxRounds) {
  if (commands >= maxCommands) return 'command_budget';
  if (state.round > maxRounds) return 'round_budget';
  return null;
}

/** Run one game synchronously. Policies must return commands synchronously. */
export function runGame(opts = {}) {
  const { maxCommands = 20000, maxRounds = 200, includeCommands = true } = opts;
  let { state, policyFor } = setup(opts);
  const counters = { invalid: 0 };
  let truncationReason = null;
  while (!state.result) {
    truncationReason = budgetExceeded(state, state.commandLog.length, maxCommands, maxRounds);
    if (truncationReason) break;
    const pid = state.activePlayerId;
    const idx = state.players.findIndex((p) => p.id === pid);
    const policy = policyFor(pid, idx);
    const view = getPlayerView(state, pid, { includeEvents: !!policy.wantsEvents });
    const legal = enumerateLegalCommands(state, pid);
    const decision = policy.decide({ playerId: pid, view, legal });
    if (decision && typeof decision.then === 'function') throw new Error('Async policy: use runGameAsync');
    state = step(state, policyFor, decision, pid, counters);
  }
  const policyNames = state.players.map((p, i) => policyFor(p.id, i).name || 'custom');
  return {
    summary: summarize(state, { seed: opts.seed ?? 'sim', commands: state.commandLog, truncated: !state.result, truncationReason, invalidCommands: counters.invalid, policyNames, includeCommands }),
    state,
  };
}

/** Same as runGame, but awaits policies (for LLM agents or remote players). */
export async function runGameAsync(opts = {}) {
  const { maxCommands = 20000, maxRounds = 200, includeCommands = true } = opts;
  let { state, policyFor } = setup(opts);
  const counters = { invalid: 0 };
  let truncationReason = null;
  while (!state.result) {
    truncationReason = budgetExceeded(state, state.commandLog.length, maxCommands, maxRounds);
    if (truncationReason) break;
    const pid = state.activePlayerId;
    const idx = state.players.findIndex((p) => p.id === pid);
    const policy = policyFor(pid, idx);
    const view = getPlayerView(state, pid, { includeEvents: policy.wantsEvents !== false });
    const legal = enumerateLegalCommands(state, pid);
    const decision = await policy.decide({ playerId: pid, view, legal });
    state = step(state, policyFor, decision, pid, counters);
  }
  const policyNames = state.players.map((p, i) => policyFor(p.id, i).name || 'custom');
  return {
    summary: summarize(state, { seed: opts.seed ?? 'sim', commands: state.commandLog, truncated: !state.result, truncationReason, invalidCommands: counters.invalid, policyNames, includeCommands }),
    state,
  };
}

/** Run many seeded games and aggregate outcomes. */
export function runBatch({ games = 100, seedPrefix = 'batch', ...opts } = {}) {
  const results = [];
  for (let i = 0; i < games; i++) results.push(runGame({ ...opts, seed: `${seedPrefix}-${i}` }).summary);
  return { results, aggregate: aggregate(results) };
}

export function aggregate(results) {
  const agg = {
    games: results.length, truncated: 0, byReason: {}, winsByObjective: {}, collectiveDefeats: 0,
    avgRounds: 0, avgFinalSuspicion: 0, resurrections: { attempts: 0, failed: 0, stable: 0, subdued: 0, unleashed: 0 },
  };
  const dealt = {};
  for (const r of results) {
    for (const o of Object.values(r.objectives)) dealt[o] = (dealt[o] || 0) + 1;
    if (r.truncated) agg.truncated++;
    const reason = r.terminalReason || 'truncated';
    agg.byReason[reason] = (agg.byReason[reason] || 0) + 1;
    if (r.collectiveDefeat) agg.collectiveDefeats++;
    for (const o of r.winnerObjectives) agg.winsByObjective[o] = (agg.winsByObjective[o] || 0) + 1;
    agg.avgRounds += r.rounds / results.length;
    agg.avgFinalSuspicion += r.finalSuspicion / results.length;
    for (const x of r.resurrections) { agg.resurrections.attempts++; agg.resurrections[x.outcome]++; }
  }
  // Per-role balance: the share of players dealt each objective who won.
  agg.dealtByObjective = dealt;
  agg.winRateByObjective = Object.fromEntries(Object.keys(dealt).sort().map((o) => [o, Math.round(1000 * (agg.winsByObjective[o] || 0) / dealt[o]) / 1000]));
  agg.avgRounds = Math.round(agg.avgRounds * 100) / 100;
  // The round the median game ended in (truncated games count at the round they stopped).
  const rounds = results.map((r) => r.rounds).sort((x, y) => x - y);
  const mid = rounds.length >> 1;
  agg.medianRounds = rounds.length ? (rounds.length % 2 ? rounds[mid] : (rounds[mid - 1] + rounds[mid]) / 2) : 0;
  agg.avgFinalSuspicion = Math.round(agg.avgFinalSuspicion * 100) / 100;
  Object.assign(agg, aggregateEconomy(results));
  return agg;
}

const round3 = (x) => Math.round(x * 1000) / 1000;

/**
 * Action-economy aggregates: per-action placements per round and the share
 * of phases each capped space was full; mean Igors and leftover money; and
 * win rate by seat in round 1's initiative order.
 */
function aggregateEconomy(results) {
  const withEco = results.filter((r) => r.economy);
  const totalRounds = withEco.reduce((a, r) => a + r.rounds, 0);
  const actions = {};
  for (const r of withEco) {
    for (const [id, a] of Object.entries(r.economy.actions)) {
      const x = actions[id] || (actions[id] = { capacity: a.capacity, placements: 0, igorPlacements: 0, full: 0, roundsUsed: 0 });
      x.placements += a.placements;
      x.roundsUsed += a.roundsUsed;
      x.igorPlacements += a.igorPlacements;
      x.full += a.full;
    }
  }
  for (const x of Object.values(actions)) {
    x.perRound = totalRounds ? round3(x.placements / totalRounds) : 0;
    x.fullRate = x.capacity == null || !totalRounds ? null : round3(x.full / totalRounds);
    x.igorShare = x.placements ? round3(x.igorPlacements / x.placements) : 0;
    x.usedRate = totalRounds ? round3(x.roundsUsed / totalRounds) : 0;
    delete x.full; delete x.igorPlacements; delete x.roundsUsed;
  }
  const players = withEco.reduce((a, r) => a + Object.keys(r.economy.igors).length, 0);
  const sum = (f) => withEco.reduce((a, r) => a + Object.values(f(r)).reduce((b, v) => b + v, 0), 0);
  const seatWins = [];
  const seatGames = [];
  for (const r of withEco) {
    r.economy.initialOrder.forEach((pid, i) => {
      seatGames[i] = (seatGames[i] || 0) + 1;
      if (r.winners.includes(pid)) seatWins[i] = (seatWins[i] || 0) + 1;
    });
  }
  return {
    invalidCommands: withEco.reduce((a, r) => a + r.invalidCommands, 0),
    actions,
    avgIgors: players ? round3(sum((r) => r.economy.igors) / players) : 0,
    avgMoneyLeft: players ? round3(sum((r) => r.economy.moneyLeft) / players) : 0,
    winRateBySeat: seatGames.map((g, i) => round3((seatWins[i] || 0) / g)),
  };
}
