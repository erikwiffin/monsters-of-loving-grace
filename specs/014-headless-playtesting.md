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
  - It publishes every discovery it may, as soon as it can, except types its objective keeps back: Prometheus keeps philosophy, the Inquisitor keeps philosophy and Discreet Methods, and the Unleasher keeps philosophy and neurology.
  - It garrisons an Igor (spec 022) when a rival has four or more installed parts: Prometheus and the Visionary readily, the Inquisitor less so, and never twice or without attempts left. The Unleasher does too, to keep others out.
  - The Unleasher values body parts that lower Humanity, and avoids those that raise it.
  - It decides on resurrection using the engine's exact odds, remembering that any stable Creature ends the game (spec 020). With a control attempt left (to subdue its own monster), the stable chance must reach 20%, or 10% from round 12. Without one, it must clearly exceed the monster chance, accepting more risk from round 12.
    - **Prometheus** attempts under that odds rule.
    - **Visionary** attempts under the same odds rule, but only when at least three rivals (or every rival, with fewer players) have complete bodies. Commitments are secret, and a lone stable Creature loses for everyone.
    - **Unleasher** attempts when no rival with attempts left is garrisoned, since then its monster cannot be stopped, and the monster chance exceeds the stable chance. Otherwise it attempts only when the stable chance is at most 5% and the monster chance is at least four times it.
    - **Inquisitor** attempts only when suspicion is one below the mob threshold and failure is more likely than not, since a failed Vitality roll would then bring the mob.
  - It decides whether to subdue a monster (spec 025) by objective:
    - **Unleasher** never subdues.
    - **Inquisitor** subdues only when nobody later in the chain could, or when its decline would bring the mob and so unleash the monster. Otherwise it declines, adding suspicion.
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

Aggregates report the number of games, truncations, terminal reasons, wins by objective, collective defeats, average rounds, average final suspicion and resurrection outcome counts (failed, stable, subdued and unleashed). For balance work, they also report how many players were dealt each objective and each objective's win rate: wins divided by players dealt it.

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
