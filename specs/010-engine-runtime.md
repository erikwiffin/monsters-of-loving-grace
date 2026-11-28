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
- compute a body's Vitality total and exact Humanity odds, and control-roll odds, without consuming randomness.

## Determinism and randomness

All randomness comes from a seeded pseudo-random generator whose complete state is a small JSON-compatible value (four unsigned 32-bit integers) stored inside the game state. Given the same configuration, seed and sequence of accepted commands, the engine produces exactly the same state and events every time. There is no unseeded randomness anywhere in the engine. Creating a game without a seed is an error: callers such as the browser generate a seed outside the engine.

Randomness is consumed in a fixed, documented order, so replays are stable:

- At setup: choose the starting player, then shuffle the objective deck, then the science deck, then the body-part deck.
- During day and night, randomness is used only to shuffle the body-part discard pile into a new deck when a draw finds the deck empty (spec 024). No action rolls dice.
- Humanity and control rolls: see spec 025.

Random draws use unbiased rejection sampling, and shuffles use Fisher–Yates.

## State

Game state is a single plain object containing only JSON-compatible data: no class instances, functions, `Infinity` or `undefined`-dependent semantics. Unlimited capacity, for example, is represented as `null`. The state includes the resolved configuration, the seed, the RNG state, all players, workers, science cards, the body-part deck and discard pile, part instances and Creatures, the occupancy of action spaces, the full event history, the log of accepted commands, and the result once the game is over. Stable string IDs identify players (`p1`…`p5`), workers, science cards (`card-N`), part instances (`part-N`) and Creatures (`creature-N`).

Dispatch never mutates the state it was given; it returns a new state. Emitted events are immutable, so a new state may share the event list structurally with the old one.

## Configuration and balance

Every balance constant and catalogue lives in one default configuration (`src/engine/data.js`). This covers starting money, the suspicion maximum, the control roll and its suspicion amounts, the Igor limit, market size, the Vitality and Humanity thresholds, every action space's phase, capacity (which may vary by player count), worker permissions, numbers and suspicion, part types, the part variant catalogue with its copy counts, and the science catalogue with its copy counts.

`createGame(overrides, seed)` deep-merges overrides into the defaults. Nested objects merge, and arrays replace. An action's `capacity` is always replaced whole, so overriding capacity tiers never mixes them with the default tiers. The resolved configuration is copied into the game state, so a game, and its replay, carries its own rules. This lets controlled experiments change balance without touching engine code. Invalid configurations are rejected at creation, for example a player count outside 3–6, unknown part types, unsupported dice, a Vitality effect that is not a whole number, a Humanity effect that is not a die, a science effect that is not positive, capacity tiers that don't cover three players, or an action with no rules handler.

Card and part effects are data, not code. A resurrection effect is a record naming an attribute and an operation: Vitality takes a signed fixed number, and Humanity an additional signed die (d4, d6, d8, d10, d12 or d20). Science cards may also carry non-resurrection effect kinds: control-roll modifiers (a positive die or fixed number), a medicine bonus, a research calm, a charity bonus, and subduing one's own monster without a garrison. Science effects are always positive. There is deliberately no general scripting language. New effects should be expressible by editing the data catalogues, and the effect system should stay easy to extend with other dice mechanics.

## Versioning

The engine exposes an engine version and a save schema version. Both are recorded in every game state, so saves and replays can be checked for compatibility.
