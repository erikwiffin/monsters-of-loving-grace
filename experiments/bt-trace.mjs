// Prints one game from the BT Prometheus seat's point of view.
// node experiments/bt-trace.mjs <players> <game index> [seed prefix] [--tree]
import { createGame, getPlayerView } from '../src/engine/index.js';
import { runGame } from '../src/sim/runner.js';
import { btPrometheusPolicy } from '../src/sim/bt-prometheus.js';

const [n = 5, i = 0, prefix = 'btp'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const showTree = process.argv.includes('--tree');
const seed = `${prefix}-${n}-${i}`;
const config = { playerCount: Number(n) };
const probe = createGame(config, seed);
const target = probe.players.find((p) => probe.objectives[p.id] === 'prometheus').id;
console.log('seed', seed, 'me', target, 'objectives', JSON.stringify(probe.objectives));
const lines = [];
const pol = btPrometheusPolicy(`${seed}:${target}:test`, { trace: (t) => lines.push(t) });
const { state } = runGame({ seed, config, policies: (pid) => (pid === target ? pol : 'heuristic'), includeCommands: false });
let last = '';
const short = (cmd) => !cmd ? '-' : cmd.type === 'PLACE_MEEPLE' ? `${cmd.workerId.split('-')[0]}:${cmd.actionId}${cmd.choices && Object.keys(cmd.choices).length ? JSON.stringify(cmd.choices) : ''}` : `${cmd.type}${cmd.subdue !== undefined ? `(${cmd.subdue})` : ''}`;
for (const t of lines) {
  const k = `${t.round}/${t.phase}`;
  if (k !== last) { console.log(`-- round ${t.round} ${t.phase}: ${t.state}`); last = k; }
  console.log('   ', short(t.command));
  if (showTree) console.log(t.trace.filter((l) => l.includes('success')).join('\n'));
}
for (const e of state.events) {
  if (['SUSPICION_CHANGED', 'RESURRECTION_RESOLVED', 'RESEARCH_PUBLISHED', 'MONSTER_SUBDUED', 'CREATURE_UNLEASHED', 'GAME_ENDED', 'ROUND_STARTED', 'CREATURE_STABLE', 'RESURRECTION_PREPARED', 'RESURRECTION_ROLLED'].includes(e.type)) {
    const { type, visibility, seq, ...rest } = e;
    console.log(type, JSON.stringify(rest).slice(0, 220));
  }
}
const me = state.players.find((p) => p.id === target);
console.log('final me', JSON.stringify({ money: me.money, research: me.research, loose: me.loose.map((x) => x.variantId), body: Object.values(me.body).map((x) => x && x.variantId) }));
