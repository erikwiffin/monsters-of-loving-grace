#!/usr/bin/env node
// LLM playtest (src/sim/llm-policy.js): Claude plays one seat from the
// rulebook, the heuristic plays the rest, and the run writes a transcript of
// every move with the model's reason, plus its feedback on the rules.
//
// Needs the Anthropic SDK and credentials (ANTHROPIC_API_KEY, or a profile
// from `ant auth login`):
//   npm install @anthropic-ai/sdk
//   node bin/llm-playtest.mjs [--objective prometheus] [--players 4] [--seed llm]
//     [--effort low] [--max-calls 400] [--config overrides.json] [--out playtests]
// Every decision is one API call, so a game costs real money; --max-calls caps
// the calls (the heuristic plays the rest). --dry-run runs the whole pipeline
// with the heuristic standing in for the model, with no network and no cost.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { runGameAsync } from '../src/sim/runner.js';
import { makePolicy } from '../src/sim/registry.js';
import { llmPolicy, dryRunClient, LLM_MODEL } from '../src/sim/llm-policy.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const dry = args.includes('--dry-run');
const objective = opt('objective', 'prometheus');
const players = Number(opt('players', 4));
const seed = opt('seed', 'llm');
const outDir = opt('out', 'playtests');
const config = { ...(opt('config') ? JSON.parse(readFileSync(opt('config'), 'utf8')) : {}), playerCount: players };

let client;
if (dry) client = dryRunClient(seed);
else {
  let Anthropic;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch {
    console.error('The LLM playtester needs the Anthropic SDK: npm install @anthropic-ai/sdk (or use --dry-run).');
    process.exit(2);
  }
  client = new Anthropic();
}

const rulebook = readFileSync(new URL('../assets/rulebook.md', import.meta.url), 'utf8');
const log = [];
const llm = llmPolicy({ client, rulebook, effort: opt('effort', 'low'), seed, log, maxCalls: Number(opt('max-calls', 400)) });
let target = null;
const seating = (pid, index, obj) => {
  if (target || obj !== objective) return makePolicy('heuristic', `${seed}:${pid}:heuristic`);
  target = pid;
  return { name: dry ? 'llm (dry run)' : 'llm', async decide(input) { if (client.setInput) client.setInput(input); return llm.decide(input); } };
};

const started = Date.now();
const { summary } = await runGameAsync({ seed, config, policies: seating, includeCommands: false, maxRounds: 60 });
if (!target) { console.error(`No seat was dealt ${objective} with seed ${seed}; try another --seed.`); process.exit(1); }
const won = summary.winners.includes(target);
const resultText = `You (${target}, ${objective}) ${won ? 'won' : 'lost'}. The game ended in round ${summary.rounds} by ${summary.terminalReason || summary.truncationReason}; winners: ${summary.winners.map((w) => `${w} (${summary.objectives[w]})`).join(', ') || 'nobody'}.`;
const feedback = await llm.feedback(resultText);

mkdirSync(outDir, { recursive: true });
const stem = `${outDir}/${seed}-${players}p-${objective}${dry ? '-dry' : ''}`;
writeFileSync(`${stem}.jsonl`, `${log.map((x) => JSON.stringify(x)).join('\n')}\n`);
const bySource = log.reduce((a, x) => ({ ...a, [x.source]: (a[x.source] || 0) + 1 }), {});
const md = [
  `# LLM playtest: ${seed}, ${players} players, ${objective}`,
  '',
  `Model ${dry ? 'none (dry run)' : LLM_MODEL}. ${resultText}`,
  '',
  `Decisions: ${JSON.stringify(bySource)}. Tokens: ${JSON.stringify(llm.usage)}. ${Math.round((Date.now() - started) / 1000)} s.`,
  '',
  '## Feedback',
  '',
  ...Object.entries(feedback || {}).flatMap(([k, v]) => [`**${k}**`, '', ...(Array.isArray(v) && v.length ? v.map((x) => `- ${x}`) : [`- ${Array.isArray(v) ? 'none' : v}`]), '']),
  '## Moves',
  '',
  ...log.filter((x) => x.source !== 'forced').map((x) => `- r${x.round} ${x.phase} (${x.options} options): **${x.move}** — ${x.reason}${x.source === 'llm' ? '' : ` [${x.source}]`}`),
  '',
].join('\n');
writeFileSync(`${stem}.md`, md);
console.log(`${resultText}\nWrote ${stem}.md and ${stem}.jsonl`);
