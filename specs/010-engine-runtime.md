# 010 — Engine runtime

The complete game runs on a single headless rules engine. The browser game, the automated tests and the AI playtest tools all use this same engine; rules are never duplicated in the user interface or the simulator. If the UI needs to know whether something is legal, it asks the engine.

## Portability

The engine is a set of plain JavaScript ES modules (`src/engine/`) that run unchanged in modern browsers and in Node.js 18 or later. It has no dependencies and no build step. It must not touch the DOM, `localStorage`, the network, timers, animation, interactive prompts or any UI framework state. Rendering and persistence are separate adapters layered on top. A test checks the engine source for forbidden globals such as `window`, `document`, `localStorage`, `Math.random`, `Date.now`, `setTimeout` and `fetch`.

The public API is exported from `src/engine/index.js`. Function names may change over time, but these capabilities are required:

- create a game from a configuration and a seed, already advanced to the first player decision;
- list a player's legal commands, both as templates with machine-readable choice constraints and as fully expanded concrete commands;
- produce a filtered observation for one player, and a public-only view;
- dispatch a command, returning the new state and the events it caused, or a structured error;
- serialize, deserialize and replay games;
- compute exact resurrection odds for a player's current body, and control-roll odds, without consuming randomness.

## Determinism and randomness

All randomness comes from a seeded pseudo-random generator whose complete state is a small JSON-compatible value (four unsigned 32-bit integers) stored inside the game state. Given the same configuration, seed and sequence of accepted commands, the engine produces exactly the same state and events every time. There is no unseeded randomness anywhere in the engine. Creating a game without a seed is an error: callers such as the browser generate a seed outside the engine.

Randomness is consumed in a fixed, documented order, so replays are stable:

- At setup: choose the starting player, then shuffle the objective deck, then shuffle the research deck.
- Graves and morgue: draw all random parts first, then roll the discovery die.
- Resurrection and control rolls: see spec 025.

Random draws use unbiased rejection sampling, and shuffles use Fisher–Yates.

## State

Game state is a single plain object containing only JSON-compatible data: no class instances, functions, `Infinity` or `undefined`-dependent semantics. Unlimited capacity, for example, is represented as `null`. The state includes the resolved configuration, the seed, the RNG state, all players, workers, cards, part instances and Creatures, the occupancy of action spaces, the full event history, the log of accepted commands, and the result once the game is over. Stable string IDs identify players (`p1`…`p5`), workers, research cards (`card-N`), part instances (`part-N`) and Creatures (`creature-N`).

Dispatch never mutates the state it was given; it returns a new state. Emitted events are immutable, so a new state may share the event list structurally with the old one.

## Configuration and balance

Every balance constant and catalogue lives in one default configuration (`src/engine/data.js`). This covers starting money, the suspicion maximum, control attempts and their suspicion and salvage amounts, Igor costs and limit, market size, research copies, resurrection thresholds and refund amounts, every action space's phase, capacity, Igor permission and numbers, part types and their draw weights, the part variant catalogue, and the research catalogue.

`createGame(overrides, seed)` deep-merges overrides into the defaults. Nested objects merge, and arrays replace. The resolved configuration is copied into the game state, so a game, and its replay, carries its own rules. This lets controlled experiments change balance without touching engine code. Invalid configurations are rejected at creation, for example a player count outside 3–6, unknown part types, unsupported dice, or an action with no rules handler.

Card and part effects are data, not code. A resurrection effect is a record naming an attribute (vitality or humanity) and one of three operations: an additional signed die (d4, d6, d8, d10, d12 or d20), a signed fixed modifier, or a threshold adjustment. Research cards may also carry non-resurrection effect kinds: medicine bonus, suspicion reduction, extra control attempts, and control-roll modifiers (a signed die or a fixed modifier). There is deliberately no general scripting language. New effects should be expressible by editing the data catalogues, and the effect system should stay easy to extend with other dice mechanics.

## Versioning

The engine exposes an engine version and a save schema version. Both are recorded in every game state, so saves and replays can be checked for compatibility.
