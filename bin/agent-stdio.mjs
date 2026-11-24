#!/usr/bin/env node
// Drive a game from an external process (e.g. an LLM agent harness) over
// JSON lines. For every decision the driver writes one line to stdout:
//   {"type":"decision","playerId":"p3","view":{...filtered observation...},"legal":[...]}
// and reads one line from stdin containing the command to dispatch.
// Rejections are reported as {"type":"rejected","error":{...}} and the same
// decision is re-sent. At the end it writes {"type":"result","summary":{...}}.
// Usage: node bin/agent-stdio.mjs [--seed s] [--players 5] [--ai p2,p3=heuristic]
//   --ai lets built-in policies play some seats; other seats go to stdin.
import { createInterface } from 'node:readline';
import { createGame, dispatch, getPlayerView, enumerateLegalCommands } from '../src/engine/index.js';
import { POLICIES } from '../src/sim/policies.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const seed = opt('seed', 'agent');
let state = createGame({ playerCount: Number(opt('players', 5)) }, seed);
const ai = {};
for (const spec of (opt('ai', '') || '').split(';').filter(Boolean)) {
  const [ids, name = 'heuristic'] = spec.split('=');
  for (const id of ids.split(',')) ai[id] = POLICIES[name](`${seed}:${id}`);
}

const rl = createInterface({ input: process.stdin });
const lines = rl[Symbol.asyncIterator]();
const send = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

while (!state.result) {
  const pid = state.activePlayerId;
  const view = getPlayerView(state, pid);
  const legal = enumerateLegalCommands(state, pid);
  let cmd;
  if (ai[pid]) cmd = ai[pid].decide({ playerId: pid, view, legal });
  else {
    send({ type: 'decision', playerId: pid, view, legal });
    const { value, done } = await lines.next();
    if (done) process.exit(1);
    try { cmd = JSON.parse(value); } catch { send({ type: 'rejected', error: { code: 'INVALID_JSON' } }); continue; }
  }
  const r = dispatch(state, cmd);
  if (!r.ok) { send({ type: 'rejected', error: r.error }); continue; }
  state = r.state;
}
send({ type: 'result', summary: { reason: state.result.reason, winners: state.result.winners, objectives: state.result.objectives, unseenObjectives: state.result.unseenObjectives, rounds: state.round } });
rl.close();
