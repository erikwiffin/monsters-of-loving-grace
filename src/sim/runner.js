// Headless sandbox orchestrator. Drives games through the same engine the
// browser uses. The orchestrator may read authoritative state for metrics,
// but policies only receive filtered observations and legal commands.

import {
  createGame, dispatch, getPlayerView, enumerateLegalCommands, getReplayRecord,
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
  agg.avgFinalSuspicion = Math.round(agg.avgFinalSuspicion * 100) / 100;
  return agg;
}
