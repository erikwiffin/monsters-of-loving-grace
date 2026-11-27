// An LLM playtester: a policy that asks Claude to choose each move, from the
// player-facing rulebook, a text summary of its view and the numbered legal
// moves. It is for qualitative playtesting of new rules and content (does the
// model use a new card sensibly, does a rule read clearly), not for win-rate
// statistics: it is slow, costs money per decision, and varies run to run.
//
// Like every policy it sees only its view and the legal commands. Every
// choice and the model's one-line reason are logged. A reply that fails to
// parse, a refusal or an API error falls back to the heuristic for that
// decision, and is logged too.

import { heuristicPolicy } from './policies.js';
import { describe } from './disagree.js';

export const LLM_MODEL = 'claude-opus-5-5';

const CHOICE_SCHEMA = {
  type: 'object',
  properties: {
    choice: { type: 'integer', description: 'The number of the chosen move.' },
    reason: { type: 'string', description: 'One sentence: why this move.' },
  },
  required: ['choice', 'reason'],
  additionalProperties: false,
};

const FEEDBACK_SCHEMA = {
  type: 'object',
  properties: {
    unclearRules: { type: 'array', items: { type: 'string' }, description: 'Rules that were unclear or easy to misread, quoting the rulebook where you can.' },
    neverWorthIt: { type: 'array', items: { type: 'string' }, description: 'Actions, research or parts that never seemed worth taking, and why.' },
    tooStrong: { type: 'array', items: { type: 'string' }, description: 'Anything that seemed too strong or decided the game.' },
    otherNotes: { type: 'array', items: { type: 'string' } },
  },
  required: ['unclearRules', 'neverWorthIt', 'tooStrong', 'otherNotes'],
  additionalProperties: false,
};

function systemPrompt(rulebook) {
  return `You are playtesting a board game, Monsters of Loving Grace, as one player. Play to win your own secret objective. Use only the rules below and the game state you are given; the state is exactly what your player can see.

Each turn you get the state and a numbered list of every legal move. Reply with the number of your move and one short sentence saying why. If a rule seems unclear, choose as the rulebook most plausibly means and say so in your reason.

<rulebook>
${rulebook}
</rulebook>`;
}

const variantName = (cfg, v) => (cfg.partVariants[v] ? cfg.partVariants[v].name : v);
const pct = (x) => `${Math.round(100 * x)}%`;

/** A compact text rendering of a player's view. */
export function summarizeView(view, recent = []) {
  const cfg = view.config;
  const me = view.players.find((p) => p.id === view.viewerId);
  const lines = [];
  lines.push(`Round ${view.round}, ${view.phase}. You are ${me.id}; your secret objective is ${view.private.objective}.`);
  lines.push(`Suspicion ${view.suspicion}/${view.suspicionMax}. Initiative: ${(view.initiative || []).join(', ')}. Research deck: ${view.deckCount} cards.`);
  lines.push(`Market: ${view.market.map((k) => `${k.id} ${cfg.research[k.type] ? cfg.research[k.type].name : k.type}`).join('; ') || 'empty'}.`);
  const player = (p, self) => {
    const body = Object.entries(p.body).map(([sl, x]) => `${sl}=${x ? variantName(cfg, x.variantId) : '-'}`).join(', ');
    const research = Object.entries(p.effectiveResearch).filter(([, n]) => n > 0).map(([t, n]) => `${cfg.research[t].name}×${n}`).join(', ') || 'none';
    const workers = p.workers.map((w) => `${w.kind}${w.availableNow ? '' : ' (used)'}`).join(', ');
    const odds = p.resurrectionOdds ? ` Odds if attempted now: stable ${pct(p.resurrectionOdds.pStable)}, monster ${pct(p.resurrectionOdds.pMonster)}, failure ${pct(p.resurrectionOdds.pFailed)}.` : '';
    return `${self ? 'You' : p.id}: money ${p.money}; workers ${workers}; control attempts ${p.controlAttempts} (control roll ${pct(p.controlChance)})${p.garrisoned ? ', garrisoned' : ''}${p.passed ? ', passed' : ''}.
  Body: ${body}.
  Loose parts: ${p.loose.map((x) => `${x.id} ${variantName(cfg, x.variantId)}`).join(', ') || 'none'}.
  Effective research: ${research}.${odds}`;
  };
  lines.push(player(me, true));
  for (const p of view.players) if (p.id !== me.id) lines.push(player(p, false));
  if ((view.prepared || []).length) lines.push(`Prepared to resurrect tonight: ${view.prepared.join(', ')}.`);
  if (view.control) lines.push(`A monster made by ${view.control.creatorId} is loose; you decide now whether to try to subdue it. Players after you who could still subdue it: ${view.control.upcoming.join(', ') || 'none'}.`);
  if (view.pendingPick) lines.push(`Your experiment drew: ${view.pendingPick.cards.map((k) => `${k.id} ${cfg.research[k.type].name}`).join('; ')}. Keep one.`);
  if (recent.length) lines.push(`Your recent moves: ${recent.map((r) => `${r.move} (${r.reason})`).join(' | ')}`);
  return lines.join('\n');
}

/** A legal command, spelled out for the model. */
export function describeMove(view, cmd) {
  const cfg = view.config;
  if (cmd.type === 'PASS_TURN') return 'Pass for the rest of this phase.';
  if (cmd.type === 'SUBDUE_MONSTER') return cmd.subdue ? 'Try to subdue the monster.' : 'Decline to subdue the monster.';
  if (cmd.type === 'PICK_RESEARCH') {
    const k = view.pendingPick.cards.find((x) => x.id === cmd.cardId);
    return `Keep ${cfg.research[k.type].name}.`;
  }
  const def = cfg.actions[cmd.actionId];
  const me = view.players.find((p) => p.id === view.viewerId);
  const partName = (id) => {
    const x = me.loose.find((y) => y.id === id) || Object.values(me.body).find((y) => y && y.id === id);
    return x ? `${variantName(cfg, x.variantId)}${me.loose.some((y) => y.id === id) ? '' : ' (installed)'}` : id;
  };
  const c = cmd.choices || {};
  let detail = '';
  if (c.researchCardId) detail = `: ${cfg.research[view.market.find((k) => k.id === c.researchCardId).type].name}`;
  if (c.partTypes) detail = `: ${c.partTypes.join(', ')}`;
  if (c.partIds) detail = `: ${c.partIds.map(partName).join(', ')}`;
  if (c.units) detail = `: ${c.units} unit(s)`;
  return `${cmd.workerId.startsWith('scientist') ? 'Scientist' : 'Igor'} → ${def.name}${detail}.`;
}

/** The first text block of a response, parsed as JSON, or null. */
function parseReply(response) {
  if (!response || response.stop_reason === 'refusal') return null;
  const block = (response.content || []).find((b) => b.type === 'text');
  if (!block) return null;
  try { return JSON.parse(block.text); } catch { return null; }
}

/**
 * Builds the policy. `client` is an Anthropic client (or a stand-in with the
 * same beta.messages.create); `log` collects one entry per decision.
 */
export function llmPolicy({ client, rulebook, model = LLM_MODEL, effort = 'low', seed = 'llm', log = [], maxCalls = Infinity, fallbacks = true }) {
  const backup = heuristicPolicy(`${seed}:backup`);
  const system = [{ type: 'text', text: systemPrompt(rulebook), cache_control: { type: 'ephemeral' } }];
  const recent = [];
  let calls = 0;
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const request = (content, schema) => client.beta.messages.create({
    model,
    max_tokens: 16000,
    // On a policy decline, the API retries on a fallback model in the same call.
    ...(fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
    output_config: { effort, format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content }],
  });
  const count = (r) => {
    const u = (r && r.usage) || {};
    usage.input += u.input_tokens || 0;
    usage.output += u.output_tokens || 0;
    usage.cacheRead += u.cache_read_input_tokens || 0;
    usage.cacheWrite += u.cache_creation_input_tokens || 0;
  };
  return {
    name: 'llm',
    log,
    usage,
    async decide(input) {
      const { view, legal } = input;
      const entry = { round: view.round, phase: view.phase, options: legal.length };
      // A forced move needs no call.
      if (legal.length === 1) {
        log.push({ ...entry, move: describe(legal[0]), reason: 'only legal move', source: 'forced' });
        return legal[0];
      }
      if (calls >= maxCalls) {
        const cmd = backup.decide(input);
        log.push({ ...entry, move: describe(cmd), reason: 'call budget spent', source: 'heuristic' });
        return cmd;
      }
      const moves = legal.map((c, i) => `${i + 1}. ${describeMove(view, c)}`).join('\n');
      calls += 1;
      let reply = null;
      let error = null;
      try {
        const r = await request(`${summarizeView(view, recent.slice(-5))}\n\nLegal moves:\n${moves}`, CHOICE_SCHEMA);
        count(r);
        reply = parseReply(r);
        if (!reply && r && r.stop_reason === 'refusal') error = 'refusal';
      } catch (e) {
        error = e.message;
      }
      const ok = reply && Number.isInteger(reply.choice) && reply.choice >= 1 && reply.choice <= legal.length;
      const cmd = ok ? legal[reply.choice - 1] : backup.decide(input);
      const record = { ...entry, move: describe(cmd), reason: ok ? reply.reason : `fallback to heuristic (${error || 'unparseable reply'})`, source: ok ? 'llm' : 'heuristic' };
      log.push(record);
      recent.push({ move: record.move, reason: record.reason });
      return cmd;
    },
    /** After the game: ask for designer feedback on the rules and content. */
    async feedback(resultText) {
      const moves = log.filter((x) => x.source === 'llm').map((x) => `r${x.round} ${x.phase}: ${x.move} — ${x.reason}`).join('\n');
      try {
        const r = await request(`The game is over. ${resultText}\n\nYour moves and reasons:\n${moves}\n\nAs a playtester, report on the rules and content.`, FEEDBACK_SCHEMA);
        count(r);
        return parseReply(r);
      } catch (e) {
        return { error: e.message };
      }
    },
  };
}

/**
 * A stand-in client for --dry-run: answers with the heuristic's choice, so
 * the whole pipeline runs without network access or cost.
 */
export function dryRunClient(seed = 'dry') {
  const h = heuristicPolicy(`${seed}:dry`, { noise: 0 });
  let lastInput = null;
  return {
    setInput(input) { lastInput = input; },
    beta: {
      messages: {
        async create({ messages, output_config: oc }) {
          const text = messages[0].content;
          if (oc.format.schema.required.includes('choice')) {
            const cmd = h.decide(lastInput);
            const choice = lastInput.legal.findIndex((c) => JSON.stringify(c) === JSON.stringify(cmd)) + 1;
            return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ choice, reason: 'dry run: the heuristic\'s choice' }) }], usage: { input_tokens: Math.round(text.length / 4) } };
          }
          return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ unclearRules: [], neverWorthIt: [], tooStrong: [], otherNotes: ['dry run'] }) }], usage: {} };
        },
      },
    },
  };
}
