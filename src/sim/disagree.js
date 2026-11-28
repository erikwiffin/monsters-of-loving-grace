// Explanations and disagreement analysis.
//
// explainDecision replays a game to one decision and asks the heuristic why
// it chose what it did: every option with its score, broken into the
// action's value, its suspicion risk, the Scientist tax and the Igor reserve.
//
// disagreement plays games with one policy (the actor) while a second (the
// shadow) is asked the same decisions without acting. Where they differ, the
// pair of choices is tallied by phase, so reviewing the most common
// disagreements points at a bug or a blind spot in one of them. When the
// actor is the heuristic, each example carries the heuristic's own score gap
// between the two choices: a small gap is a judgement call, a large one a
// real difference of view.

import { createGame, dispatch, getPlayerView, enumerateLegalCommands } from '../engine/index.js';
import { makePolicy, seatSpec } from './registry.js';
import { runGame } from './runner.js';

/** A short label for a command. */
export function describe(cmd) {
  if (!cmd) return '-';
  if (cmd.type === 'PASS_TURN') return 'pass';
  if (cmd.type === 'SUBDUE_MONSTER') return cmd.subdue ? 'subdue' : 'decline';
  if (cmd.type === 'PICK_PART') return `keep ${cmd.partId}`;
  const who = cmd.workerId.startsWith('scientist') ? 'S' : 'I';
  const c = cmd.choices || {};
  const extra = c.partIds ? ` ×${c.partIds.length}` : c.researchCardId ? ` ${c.researchCardId}` : '';
  return `${who}:${cmd.actionId}${extra}`;
}

/** What kind of choice a command is, ignoring part and card details. */
const kindOf = (cmd) => (cmd.type === 'PLACE_MEEPLE' ? cmd.actionId : cmd.type === 'SUBDUE_MONSTER' ? (cmd.subdue ? 'subdue' : 'decline') : cmd.type === 'PASS_TURN' ? 'pass' : 'pick');

/**
 * Replays a game (seed, config, seating as for runGame) to its command number
 * `at` and returns the heuristic's scored options for that decision.
 */
export function explainDecision({ seed, config = {}, policies = 'heuristic', at, options = {} }) {
  const { state } = runGame({ seed, config, policies, includeCommands: true, maxCommands: at, hoardLimit: null });
  const pid = state.activePlayerId;
  if (!pid) return null;
  let explained = null;
  const h = makePolicy({ policy: 'heuristic', options: { ...options, noise: 0, explain: (e) => { explained = e; } } }, `explain:${pid}`);
  const view = getPlayerView(state, pid, { includeEvents: false });
  const chosen = h.decide({ playerId: pid, view, legal: enumerateLegalCommands(state, pid) });
  return { playerId: pid, objective: state.objectives[pid], round: state.round, phase: state.phase, chosen, ...explained };
}

/** Formats an explanation as a table of the best options. */
export function formatExplanation(x, top = 10) {
  if (!x) return 'no decision at that point';
  const lines = [`${x.playerId} (${x.objective}), round ${x.round} ${x.phase}: chose ${describe(x.chosen)}`];
  const opts = [...(x.options || [])].sort((a, b) => (b.base ?? b.score) - (a.base ?? a.score)).slice(0, top);
  lines.push('  option                      score   value    risk  sciTax reserve');
  for (const o of opts) {
    const p = o.parts || {};
    const f = (v) => (typeof v === 'number' ? v.toFixed(2).padStart(7) : String(v ?? '').padStart(7));
    lines.push(`  ${describe(o.command).padEnd(26)} ${f(o.base ?? o.score)} ${f(p.value)} ${f(p.risk)} ${f(p.sciTax)} ${f(p.reserve)}${p.rule ? `  ${p.rule}` : ''}`);
  }
  return lines.join('\n');
}

/**
 * Plays `games` games with `actor` (a seating) and asks `shadow` (a policy
 * spec) the same decisions for every seat whose objective is in `objectives`
 * (all seats if omitted). Returns agreement by phase and the commonest
 * disagreements, with examples.
 */
export function disagreement({ actor = 'heuristic', shadow, players = 4, games = 50, objectives = null, seedPrefix = 'dis', examples = 3 }) {
  const byPhase = {};
  const pairs = {};
  for (let i = 0; i < games; i++) {
    const seed = `${seedPrefix}-${players}-${i}`;
    const probe = createGame({ playerCount: players }, seed);
    const shadows = {};
    const seating = (pid, index, objective) => {
      const before = probe.players.slice(0, index).map((p) => probe.objectives[p.id]);
      const spec = seatSpec(actor, { index, objective, objectivesBefore: before });
      // The runner's seed convention, so an example replays with explainDecision.
      const name = typeof spec === 'string' ? spec : (spec && spec.policy) || 'custom';
      const actorPolicy = makePolicy(spec, `${seed}:${pid}:${name}`);
      if (objectives && !objectives.includes(objective)) return actorPolicy;
      const sh = shadows[pid] || (shadows[pid] = makePolicy(shadow, `${seed}:${pid}:shadow`));
      let scored = null;
      const explainer = makePolicy({ policy: 'heuristic', options: { noise: 0, explain: (e) => { scored = e; } } }, `${seed}:${pid}:explain`);
      return {
        name: actorPolicy.name,
        decide(input) {
          const a = actorPolicy.decide(input);
          const b = sh.decide(input);
          const key = `${input.view.phase}`;
          const ph = byPhase[key] || (byPhase[key] = { decisions: 0, agree: 0 });
          ph.decisions += 1;
          if (kindOf(a) === kindOf(b) && (a.workerId || '').split('-')[0] === (b.workerId || '').split('-')[0]) { ph.agree += 1; return a; }
          const pk = `${input.view.phase} ${objective}: actor ${describe(a).split(' ')[0]} / shadow ${describe(b).split(' ')[0]}`;
          const x = pairs[pk] || (pairs[pk] = { count: 0, examples: [] });
          x.count += 1;
          if (x.examples.length < examples) {
            scored = null;
            explainer.decide(input);
            const find = (cmd) => scored && scored.options && scored.options.find((o) => JSON.stringify(o.command) === JSON.stringify(cmd));
            const sa = find(a);
            const sb = find(b);
            x.examples.push({
              seed, command: input.view.commandCount, round: input.view.round,
              actor: describe(a), shadow: describe(b),
              heuristicGap: sa && sb ? Math.round(((sa.base ?? sa.score) - (sb.base ?? sb.score)) * 100) / 100 : null,
            });
          }
          return a;
        },
      };
    };
    runGame({ seed, config: { playerCount: players }, policies: seating, includeCommands: false, maxRounds: 60 });
  }
  const phases = Object.fromEntries(Object.entries(byPhase).map(([k, v]) => [k, { ...v, agreement: v.decisions ? v.agree / v.decisions : 1 }]));
  const top = Object.entries(pairs).sort((a, b) => b[1].count - a[1].count).map(([pair, v]) => ({ pair, ...v }));
  return { phases, disagreements: top };
}
