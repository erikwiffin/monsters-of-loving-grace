# 014 — Headless AI playtesting

Rules testing relies on playing many games without a browser. Headless playtesting uses the same engine as the browser game (spec 010), and never a copy of the rules.

## Policies

A policy is anything that, given `{ playerId, view, legal }`, returns a command. `view` is that player's filtered observation, and `legal` is the list of expanded legal commands. Policies may be scripted strategies, AI agents or human relays, and may be synchronous or asynchronous. Swapping policies requires no engine changes. Policies never receive authoritative state.

Built-in policies ship in `src/sim/policies.js`. Each has its own seeded randomness, separate from the engine's RNG.

- **random** chooses uniformly among legal non-pass commands, and passes only occasionally, about 10% of the time.
- **heuristic** is a simple scripted player that pursues its own objective using only its view and the engine's exact odds. It must value actions from the configuration's numbers rather than fixed per-action scores, so that it plays sensibly when a parameter sweep changes them (spec 016). Otherwise its strategy is not specified and may be tuned freely to keep playtests meaningful.
- **cautious** and **bold** are the heuristic with suspicion and resurrection risk priced higher or lower.

## Runner

`src/sim/runner.js` provides:

- `runGame`, which is synchronous;
- `runGameAsync`, which awaits each policy decision;
- `runBatch`, which runs many seeded games;
- `aggregate`, which summarises a batch.

The runner creates a game, and then, until the game ends, asks the active player's policy for a command and dispatches it. Policies may be given as a name, an object, an array assigned to seats in order, or a function of the player. If a policy returns an invalid command, the runner counts it and falls back to the first legal command for that decision.

## Results

Each game produces a machine-readable summary containing:

- the seed, engine version, player count and policy names;
- whether the game ended, whether it was truncated and why, and the terminal reason (`mob`, `unleashed` or `objective`);
- the winners and their objectives, and whether it was a collective defeat;
- every objective assignment and the unseen card;
- the round count, command count and invalid-command count;
- the final suspicion and the full suspicion history;
- every resurrection, with its scores and outcome;
- action-economy metrics: per-action placements, Igor placements, rounds used and full phases, each player's Igors and leftover money, and round 1's initiative order;
- optionally, the full replay command list.

Aggregates report the number of games, truncations, terminal reasons, wins by objective, collective defeats, average rounds, the median round in which games end, average final suspicion and resurrection outcome counts (failed, stable, subdued and unleashed). For balance work, they also report how many players were dealt each objective and each objective's win rate: wins divided by players dealt it. They also aggregate the action-economy metrics (spec 016) and the invalid-command total.

## Command-line tools

`bin/simulate.mjs` runs batches. Its options are:

- the number of games, the seed prefix and the player count;
- the policy or comma-separated per-seat policies;
- the command and round budgets;
- a JSON file of configuration overrides;
- whether to include commands;
- the output file;
- JSON-lines streaming.

It writes the aggregate to stderr and the results to stdout or to the output file.

`bin/agent-stdio.mjs` lets an external process, such as an LLM agent harness, play some or all seats over JSON lines:

- For each decision belonging to a seat on standard input, it writes `{"type":"decision","playerId","view","legal"}` and reads one command line back.
- A rejected command gets `{"type":"rejected","error"}` and the same decision is asked again.
- Seats may be assigned to built-in policies instead.
- The game ends with a `result` line.

Neither tool needs a browser or a server. The README documents the command schemas, the launch instructions and how to integrate a policy.
