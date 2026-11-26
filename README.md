# Monsters of Loving Grace — browser prototype (spec v0.3)

A rules-testing prototype of a worker-placement / engine-building board game about
resurrection, suspicion and secret ambition. It is played hot-seat by 3–6 people on
one device, and there is a headless rules engine for AI playtesting.

**Play:** <https://erikwiffin.github.io/monsters-of-loving-grace/>

- No build step, server, accounts, network or CDN. The site is plain HTML, CSS and ES modules with relative URLs.
- The browser game, the tests and the simulator all run on the same engine (`src/engine/`).

Behaviour is specified in [`specs/`](specs/000-specs.md), a set of short specs that replace the original v0.3 document and record the designer's rulings. Start with `specs/000-specs.md`.

---

## Running it

| What | How |
|---|---|
| Play locally | `npm run serve` (or `node bin/serve.mjs 8080`), then open <http://localhost:8080/>. The dev server only serves static files. ES modules need http(s), so double-clicking `index.html` will not work. |
| Run the tests | `npm test` (Node ≥ 18, no dependencies) |
| Simulate games | `npm run simulate -- --games 200 --policy heuristic` |

### GitHub Pages deployment

`.github/workflows/pages.yml` runs the tests and a short simulation on every push and pull request. On pushes to `main` it then copies `index.html`, `styles.css`, `assets/` and `src/` into `_site/`, uploads it in a build job, and deploys it with GitHub Pages from a separate deploy job.

**One-time setup:** in *Settings → Pages*, set **Source** to **GitHub Actions**. Because all URLs are relative, the site works under the `/<repo>/` subpath without any configuration.

---

## Rules summary

The in-game **Rules** button shows the same summary.

- **Setup:** each player starts with 3 money, 1 Scientist and 1 Igor. Suspicion starts at 0 and the starting player is random. Objective cards (N+1) are one each of Inquisitor and Unleasher, one Visionary with 4+ players, and Prometheus for the rest. They are dealt secretly through a pass-the-device screen, and one card stays unseen.
- **Objectives:**
  - *Prometheus*: be the only player whose Creature becomes stable in a round; win at dawn.
  - *Visionary*: two or more Creatures become stable in the same round.
  - *Inquisitor*: suspicion reaches the mob threshold of 10.
  - *Unleasher*: any monster is unleashed.
- **Catastrophes:** the mob (suspicion at the threshold) or an unleashed monster ends the game immediately. Only the matching antagonist wins, if that role was dealt; otherwise everyone loses. If the mob forms while a monster awaits subduing, the monster is unleashed instead.
- **Round:** Day → Night → resolution of every prepared resurrection, in initiative order → Dawn (objective check; any stable Creature ends the game; otherwise whoever rested goes first, or initiative rotates).
- **Workers:**
  - The Scientist acts once by day and once by night.
  - Everyone starts with one Igor. More cost a flat 4 (maximum 3 in all), can be hired by any worker and can act as soon as they're hired. Each Igor acts once per round in either phase. Igors may take every action except *Prepare resurrection*; only Igors may garrison.
- **Actions** (capacity "2/3" means 2 slots with 3–4 players, 3 with 5–6):

  | Phase | Actions |
  |---|---|
  | Day | medicine (unlimited), research (publishes the card), specimens, charity, hire, garrison (Igor only) |
  | Night | assemble (unlimited), prepare resurrection (Scientist only, unlimited), sell parts, experiments (discard installed parts, draw that many cards, keep one privately), graves, rest (1: go first next round) |

  Each action space shows its cost, effect, capacity and discovery-roll odds. Spec 022 has the details; every number is a configuration value meant for tuning (spec 016).
- **Resurrection:**
  - Roll d20 each for Vitality (needs 20+) and Humanity (20+). Installed parts and research add dice, fixed modifiers or threshold changes.
  - Vitality fails → three parts are salvaged and suspicion rises by 1.
  - Vitality and Humanity succeed → a stable Creature.
  - Vitality succeeds but Humanity fails → a monster. Its creator, then each player clockwise, may spend one of their control attempts (3 each, +1 per copy of Neural Conditioning) to try to subdue it — everyone except the creator needs an Igor in the garrison that round. A try rolls d20 + control research (Mesmerism +1d6, Restraining Apparatus +4 per copy) and needs 20+. Success destroys the monster, gives the subduer 3 of its parts at random and adds 1 suspicion; failure adds nothing and the monster passes on. Each player who could try but doesn't adds 2 suspicion. If nobody subdues it, it is unleashed.
- **Suspicion** comes only from discovery rolls on graves, sell and experiments, failed resurrections, subdued monsters (+1) and monsters left unsubdued (+2 per decline). Only charity lowers it (by 2).

### Designer rulings (clarifications to spec v0.3)

These rulings resolve ambiguities in the spec and are implemented in the engine:

1. **Publishing** happens only through the research action, which always publishes the card taken. There is no free publishing. Experiment discoveries are never published.
2. **Resurrection is prepared, not secretly committed.** Placing your Scientist on *Prepare resurrection* is public and binding; the body must be complete when the attempt resolves.
3. **Research copies stack.** A player's effective copies of a type are 1 for their own discovery, plus 1 for each publication of that type by *another* player. Every copy applies its effect:
   - Galvanic Mastery adds 1d6 per copy; Moral Philosophy adds +5 per copy.
   - Medical Expertise adds +1 money per copy.
   - Discreet Methods reduces suspicion by 1 per copy.

   Players still cannot buy a type they personally discovered.
4. **A stable Creature ends the game.** At the dawn of any round in which a Creature becomes stable, the game ends. If exactly one became stable and its owner is a Prometheus, that player wins. If two or more became stable, the Visionary wins if dealt. Otherwise everyone loses. Two Prometheus players stabilizing in the same round both lose. There are no Creature workers.

---

## Interface notes

- **Menu:**
  - **New Game** lets you choose the player count and names.
  - **Resume** continues the game saved in this browser.
  - **Import** loads a save file.
- **Game bar:** Rules, Export, Import, Restart (asks for confirmation) and Menu.
- **AI seats:** in New Game, set any player's *Played by* to *AI — heuristic* or *AI — random*. AI seats use the same policies as the headless simulator (`src/sim/policies.js`) and receive only their own filtered view and legal commands. They play automatically after a short delay, and **⏸ Pause AI** in the top bar stops them. AI seats skip the pass-device screens. Each AI decision is seeded from the game seed and the command count, so a resumed game replays the same AI choices. The AI assignment is stored in the save file.
- **Privacy screens:** objective dealing and *View my objective* use a pass-the-device screen. This gives casual privacy only; anyone can read browser storage or open developer tools.
- **Odds:** each complete body shows its exact odds of a stable, unleashed or failed result. These come from `estimateResurrection()` in the engine.
- **Saving:** the game saves to `localStorage` after every committed command. If storage is unavailable, play continues in memory and a banner says so. Export and Import always work, because they use a JSON file.
- **Developer / debug mode:** a checkbox on the main menu, shown with a magenta **DEBUG** badge. It adds:
  - a fixed seed and JSON config overrides when starting a game;
  - a panel showing all objectives, the resolution order, the deck order and the authoritative state;
  - a box for dispatching raw commands (they still go through the engine);
  - a replay-record download.

  Debug mode reveals hidden information, so do not use it in a real playtest.

---

## Architecture

```
index.html, styles.css    static entry point
src/engine/               pure rules engine (no DOM, storage, timers or Math.random)
  data.js                 catalogs and balance constants (actions, parts, research)
  rng.js                  seeded, serializable PRNG (sfc32)
  engine.js               state machine, command bus, legal moves, views, save/replay
  index.js                public API
src/ui/                   browser adapter (rendering + localStorage); calls only engine APIs
src/sim/                  policies and headless runner
bin/simulate.mjs          batch playtest CLI
bin/sweep.mjs             parameter sweep CLI (spec 016)
sweeps/                   sweep definitions
bin/agent-stdio.mjs       JSON-lines driver for external agents
bin/serve.mjs             static dev server (no game logic)
test/engine.test.mjs      rules, determinism, privacy and simulation tests
```

All balance values and catalogs live in `DEFAULT_CONFIG` (`src/engine/data.js`) and are copied into each game's state.

- `createGame(overrides, seed)` deep-merges your overrides into the defaults; arrays are replaced rather than merged. For example: `{ startingMoney: 5, actions: { graves: { suspicion: { die: 6, bands: [{ max: 2, amount: 1 }] } } } }`. An action's `capacity` (a number, `null` for unlimited, or tiers such as `{ 3: 2, 5: 3 }`) is always replaced whole.
- Part variants and research cards use effect records of the form `{ attribute, op: 'die' | 'fixed' | 'threshold', die, sign, amount }`. You can edit them without touching engine code.

### Engine API

```js
import * as E from './src/engine/index.js';

let state = E.createGame({ playerCount: 5 }, 'my-seed'); // advanced to the first decision
state.activePlayerId;                                     // whose decision it is ('p1'..'p5')
E.getLegalCommands(state, pid);       // templates; choice-bearing ones include choiceConstraints
E.enumerateLegalCommands(state, pid); // fully expanded concrete commands
E.getPlayerView(state, pid);          // filtered observation for one player
E.getPublicView(state);               // shared info only
const r = E.dispatch(state, command); // { ok, state, events, error? }
E.serialize(state); E.deserialize(json);  // deserialize verifies by replaying the command log
E.replay({ config, seed, commands });  E.getReplayRecord(state);
E.estimateResurrection(state, pid);   // exact odds, consumes no randomness
```

`dispatch` behaves as follows:

- **Validation first.** It checks the phase, the active player, worker availability, capacity, cost, prerequisites and every choice before changing anything.
- **Rejections are clean.** A rejected command returns the *same* state object, emits no events and leaves the RNG untouched. The error has the form `{ code, message }`, with codes such as `NOT_YOUR_TURN`, `SPACE_FULL`, `INSUFFICIENT_MONEY`, `UNKNOWN_FIELD` and `GAME_OVER`.
- **Accepted commands** return a new state and the ordered domain events. The engine then runs every forced step itself (dice, suspicion, phase changes, resurrection resolution, dawn, game end) until the next player decision.
- **Duplicate protection.** A command may carry an optional `seq` equal to the number of commands accepted so far. If `seq` doesn't match, the command is rejected as `STALE_COMMAND`. The UI uses this to prevent double execution.

### Command schemas

Every command needs `type` and `playerId`; `seq` is optional. Unknown fields are rejected.

| Command | Fields |
|---|---|
| `PASS_TURN` | — (gives up all remaining placements this day/night) |
| `PICK_RESEARCH` | `cardId` — after an experiment, the drawn card to keep (a type you haven't discovered); the only legal command until made |
| `SUBDUE_MONSTER` | `subdue: boolean` — only for the player currently deciding in a monster's control chain |
| `PLACE_MEEPLE` | `workerId`, `actionId`, `choices` (below) |

| `actionId` | `choices` |
|---|---|
| `medicine`, `hire`, `charity`, `garrison`, `graves`, `prepare`, `rest` | `{}` (or omitted) |
| `research` | `{ researchCardId: 'card-17' }`: a market card whose type you have not discovered |
| `specimens` | `{ variantIds: ['robust_chest'] }`: exactly 1 variant ID |
| `assemble` | `{ partIds: ['part-12', 'part-18'] }`: 1 or more unique loose part instances (up to a whole body), each needing an empty matching slot |
| `sell` | `{ partIds: ['part-3', 'part-9'] }`: exactly the configured number of loose parts |
| `experiment` | `{ partIds: ['part-3', 'part-9'] }`: 1 to the configured maximum of *installed* parts |

- **Worker IDs:**
  - Scientists are `scientist-p1`.
  - Igors are `igor-p1-1`, `igor-p1-2` and so on.
- **Choice constraints** returned by `getLegalCommands` take these forms:
  - `{ type: 'enum', values }`
  - `{ type: 'multiset', count, values }`
  - `{ type: 'subset', min, max, values, maxPerPartType? }`

### Events and privacy

- **Event fields:** every event has `seq`, `round`, `phase`, `type` and `visibility`. Visibility is either `'public'` or a list of player IDs.
- **Private events:** objective assignments (`OBJECTIVE_ASSIGNED`) are visible only to their own player.
- **Public reveals:** `RESURRECTIONS_ANNOUNCED` lists every prepared attempt before any roll, and `OBJECTIVES_REVEALED` publishes every objective at game end.
- **Filtered views:** `getPlayerView` and `filterEvents` never include other players' objectives, the seed, the RNG state or the deck order.
- **Dice detail:** `RESURRECTION_ROLLED` lists every die with its source, sign and result, plus fixed modifiers, threshold adjustments, the adjusted threshold and the final score. Dice are rolled in a fixed order:
  1. Vitality, then Humanity.
  2. Within each attribute: the base die, then parts in slot order, then research in sorted type ID order.

---

## Headless AI playtesting

```bash
# 200 games, all heuristic players, summary to stderr, full JSON to stdout
node bin/simulate.mjs --games 200 --policy heuristic > results.json

# mixed seats, 4 players, include command logs, write to a file
node bin/simulate.mjs --games 50 --players 4 --policy heuristic,random,random,heuristic --commands --out sim-results.json

# balance experiment with config overrides, one JSON line per game
node bin/simulate.mjs --games 500 --config overrides.json --jsonl --max-rounds 100
```

Each game result records:

- `seed`, `engineVersion` and the `policies` used
- `terminal`, `truncated`, `truncationReason` and `terminalReason` (`mob`, `unleashed` or `objective`)
- `winners`, `winnerObjectives` and `collectiveDefeat`
- `objectives` and `unseenObjectives`
- `rounds`, `commandCount` and `invalidCommands`
- `suspicionHistory` and `resurrections` (scores and outcome per attempt)
- `economy`: per-action placements, Igor placements, rounds used and full phases; each player's Igors and leftover money; round 1's initiative order
- the replay `commands`, when `--commands` is given

Games that hit `--max-commands` or `--max-rounds` are reported as `truncated: true` with no terminal reason. They are never counted as an in-game result.

Policies: `random`, `heuristic`, and the heuristic's `cautious` and `bold` styles.

### Parameter sweeps

`bin/sweep.mjs` runs a sweep file from `sweeps/` across player counts and policy styles, in parallel, and ranks the points against design targets (spec 016).

```bash
# one-at-a-time sensitivity around the baseline
node bin/sweep.mjs sweeps/sensitivity.json --out sweep-results.jsonl

# quick check with fewer games and only two player counts
node bin/sweep.mjs sweeps/sensitivity.json --games 40 --players 3,5
```

Variables are dotted config paths (`actions.medicine.gain`, `actions.research.capacity.5`, `actions.graves.suspicion.bands.0.max`); paths joined with `|` share one value. Samplers are `oat`, `grid`, `random` and `lhs`.

### Writing a policy

```js
import { runGame, runGameAsync, runBatch } from './src/sim/runner.js';

const myPolicy = {
  name: 'mine',
  decide({ playerId, view, legal }) {
    // view: this player's observation (its own objective is in view.private)
    // legal: fully expanded legal commands; return one of them or build your own
    return legal[0];
  },
};
const { summary } = runGame({ seed: 's1', policies: [myPolicy, 'heuristic', 'random'], config: { playerCount: 3 } });
```

- **Synchronous** policies work with `runGame`. **Async** policies, such as LLM calls, need `runGameAsync`.
- **Invalid commands** returned by a policy are counted in `invalidCommands`, and that decision falls back to the first legal command.
- **Information access:** policies only receive the filtered view and their legal commands. The orchestrator alone reads authoritative state, for metrics.

### Driving from another process

`bin/agent-stdio.mjs` lets an external agent play some or all seats over JSON lines:

```bash
node bin/agent-stdio.mjs --seed demo --players 5 --ai "p2,p3,p4,p5=heuristic"
```

For each decision belonging to a seat on stdin, the driver writes `{"type":"decision","playerId","view","legal"}` to stdout and reads back one command as a JSON line. A rejected command gets `{"type":"rejected","error"}` and the same decision is sent again. The game ends with `{"type":"result",...}`.

---

## Tests

`npm test` runs `node --test` on `test/engine.test.mjs`. The suite covers:

- setup and deck composition
- rejected commands leaving state unchanged
- capacity, Igor timing and night use
- suspicion tables and Discreet Methods
- capacity tiers, worker permissions, discovery-roll bands, sell, experiments and rest
- assembly limits, research publishing and research stacking
- every resurrection outcome and each victory or defeat path
- a stable Creature always ending the game at dawn
- prepared resurrections and filtered views
- sweep sampling, config paths and scoring
- save/load round trips and replay verification, including tamper detection
- stale-command protection
- every enumerated legal command being accepted
- batch simulations finishing with no invalid commands
- a static check that the engine never uses the DOM, storage, timers or `Math.random`
