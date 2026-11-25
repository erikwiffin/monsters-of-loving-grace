# 014 — Headless AI playtesting

Rules testing relies on playing many games without a browser. Headless playtesting uses the same engine as the browser game (spec 010), and never a copy of the rules.

## Policies

A policy is anything that, given `{ playerId, view, legal }`, returns a command. `view` is that player's filtered observation, and `legal` is the list of expanded legal commands. Policies may be scripted strategies, AI agents or human relays, and may be synchronous or asynchronous. Swapping policies requires no engine changes. Policies never receive authoritative state.

Two built-in policies ship in `src/sim/policies.js`. Each has its own seeded randomness, separate from the engine's RNG.

- **random** chooses uniformly among legal non-pass commands, and passes only occasionally, about 10% of the time.
- **heuristic** is a simple greedy player:
  - It earns money when short, and gathers and assembles good parts.
  - It values research according to its objective. The Unleasher wants galvanism and avoids safety research (neurology, philosophy). The Inquisitor avoids galvanism and Discreet Methods. Everyone else values safety research and galvanism.
  - It manages suspicion unless it is the Inquisitor.
  - It decides on resurrection using the engine's exact odds, remembering that any stable Creature ends the game (spec 020). A player with a control attempt left will subdue their own monster, so the odds rule depends on it. With an attempt left, the stable chance must reach 20%, or 10% from round 12. Without one, the stable chance must clearly exceed the monster chance, with more risk accepted from round 12.
    - **Prometheus** attempts under that odds rule.
    - **Visionary** attempts under the same odds rule, but only when another player also has a complete body, since a lone stable Creature loses for everyone.
    - **Unleasher** attempts only when the monster chance exceeds the stable chance.
    - **Inquisitor** attempts only when suspicion is one below the mob threshold and failure is more likely than not, since a failed Vitality roll would then bring the mob.
  - It decides whether to subdue a monster (spec 025) by objective:
    - **Unleasher** never subdues.
    - **Inquisitor** subdues only when it is the last player in the chain with an attempt left, or when its decline would bring the mob, which would unleash the monster (spec 025). Otherwise it declines, since a decline adds suspicion.
    - **Prometheus** subdues its own monster. It subdues another player's when it is the last in the chain, when a decline would bring the mob, or when it has more than one attempt left.
    - **Visionary** always subdues.

## Runner

`src/sim/runner.js` provides:

- `runGame`, which is synchronous;
- `runGameAsync`, which awaits each policy decision;
- `runBatch`, which runs many seeded games;
- `aggregate`, which summarises a batch.

The runner creates a game, and then, until the game ends, asks the active player's policy for a command and dispatches it. Policies may be given as a name, an object, an array assigned to seats in order, or a function of the player. If a policy returns an invalid command, the runner counts it and falls back to the first legal command for that decision.

An external runner may impose a command budget and a round budget to stop stalled simulations. A game stopped this way is reported as truncated and non-terminal, with the reason (`command_budget` or `round_budget`). It is never reported as an in-game defeat or a mob victory. The engine itself imposes no round limit (spec 021).

## Results

Each game produces a machine-readable summary containing:

- the seed, engine version, player count and policy names;
- whether the game ended, whether it was truncated and why, and the terminal reason (`mob`, `unleashed` or `objective`);
- the winners and their objectives, and whether it was a collective defeat;
- every objective assignment and the unseen card;
- the round count, command count and invalid-command count;
- the final suspicion and the full suspicion history;
- every resurrection, with its scores and outcome;
- optionally, the full replay command list.

Aggregates report the number of games, truncations, terminal reasons, wins by objective, collective defeats, average rounds, average final suspicion and resurrection outcome counts (failed, stable, subdued and unleashed).

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
