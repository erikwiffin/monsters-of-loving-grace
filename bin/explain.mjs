#!/usr/bin/env node
// Why did the bot do that? Two modes (src/sim/disagree.js):
//
// One decision: replay a game to a command number and show the heuristic's
// scored options there.
//   node bin/explain.mjs --seed s --players 4 --at 120 [--policy heuristic] [--top 10]
//
// Disagreements: play games with one policy while another is asked the same
// decisions, and list where they differ most.
//   node bin/explain.mjs --disagree --actor heuristic --shadow bt
//     [--objectives prometheus] [--players 4] [--games 50] [--examples 3]
import { explainDecision, formatExplanation, disagreement } from '../src/sim/disagree.js';
import { parsePolicySet } from '../src/sim/compare.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const players = Number(opt('players', 4));

if (args.includes('--disagree')) {
  const shadow = opt('shadow');
  if (!shadow) { console.error('Give --shadow <policy>'); process.exit(2); }
  const r = disagreement({
    actor: parsePolicySet(opt('actor', 'heuristic')), shadow: parsePolicySet(shadow), players,
    games: Number(opt('games', 50)), objectives: opt('objectives') ? opt('objectives').split(',') : null,
    examples: Number(opt('examples', 3)), seedPrefix: opt('seed', 'dis'),
  });
  console.log('Agreement by phase:');
  for (const [ph, v] of Object.entries(r.phases)) console.log(`  ${ph.padEnd(10)} ${(100 * v.agreement).toFixed(1)}% of ${v.decisions} decisions`);
  console.log('\nCommonest disagreements (heuristic gap: how much more the heuristic scores the actor\'s choice):');
  for (const d of r.disagreements.slice(0, Number(opt('top', 12)))) {
    console.log(`  ${String(d.count).padStart(5)}  ${d.pair}`);
    for (const e of d.examples) console.log(`         e.g. --seed ${e.seed} --at ${e.command} (round ${e.round}): ${e.actor} vs ${e.shadow}${e.heuristicGap == null ? '' : `, heuristic gap ${e.heuristicGap}`}`);
  }
} else {
  const seed = opt('seed');
  const at = Number(opt('at'));
  if (!seed || !Number.isInteger(at)) { console.error('Give --seed and --at, or --disagree. See --help in the source header.'); process.exit(2); }
  const x = explainDecision({ seed, config: { playerCount: players }, policies: parsePolicySet(opt('policy', 'heuristic')), at });
  console.log(formatExplanation(x, Number(opt('top', 10))));
}
