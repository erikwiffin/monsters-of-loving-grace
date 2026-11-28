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
| Print and play | Open `index.html?print` (or **Print and play** in the main menu) to print every component and the [rulebook](assets/rulebook.md) for a physical playtest. Untick components you don't need to reprint. |

### GitHub Pages deployment

`.github/workflows/pages.yml` runs the tests and a short simulation on every push and pull request. On pushes to `main` it then copies `index.html`, `styles.css`, `assets/` and `src/` into `_site/`, uploads it in a build job, and deploys it with GitHub Pages from a separate deploy job.

**One-time setup:** in *Settings → Pages*, set **Source** to **GitHub Actions**. Because all URLs are relative, the site works under the `/<repo>/` subpath without any configuration.

---

## Rules summary

The in-game **Rules** button shows the same summary.

- **Setup:** each player starts with 3 money, 1 Scientist and 1 Igor. Suspicion starts at 0 and the starting player is random. The science deck (31 cards) and the body-part deck (60 cards) are shuffled. Objective cards (N+1) are one each of Inquisitor and Unleasher, one Visionary with 4+ players, and Prometheus for the rest. They are dealt secretly through a pass-the-device screen, and one card stays unseen.
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
- **Day and night:** day actions generally cost money and never raise suspicion, with medium value and low variance (you choose what you get). Night actions are generally free and each risky one adds exactly 1 suspicion, with slightly higher value and much higher variance (you take what the decks give). No dice are rolled before resolution.
- **Actions** (capacity "2/3" means 2 slots with 3–4 players, 3 with 5–6):

  | Phase | Actions |
  |---|---|
  | Day | medicine (unlimited), research (any market card), specimens (draw 3 parts, keep 1), charity, hire, garrison (Igor only) |
  | Night | prepare resurrection (Scientist only, unlimited), sell 2 parts (+1 suspicion), experiments (discard 2 parts, draw and keep 2 science cards, +1 suspicion), graves (draw 2 parts, +1 suspicion), vespers (suspicion −1, unlimited), rest (1: go first next round) |

  Spec 022 has the details; every number is a configuration value meant for tuning (spec 016).
- **Body parts:** one shuffled 60-card deck with a public discard pile that is reshuffled when the deck runs out. Each part may carry a fixed Vitality number and a Humanity die; the deck is biased towards negative values.
- **Science:** personal and permanent. Vitality cards (fixed +), Humanity cards (+dice) and control cards (fixed + or +dice) come in several copies; other cards (Medical Expertise, Public Lectures, Parish Benefactor, Neural Conditioning) are singletons. Every card held applies, duplicates included.
- **Resurrection:**
  - *Prepare* (Scientist, night): lay out a full set from your hand (two arms, two legs, a chest, a head) whose Vitality, with Vitality science, is at least 10. The parts are committed at once.
  - At resolution, roll d20 plus every Humanity die from the parts and science: 20+ is a stable Creature, anything less a monster. The parts are discarded either way.
  - A monster's control chain runs from its creator clockwise. Only players with an Igor in the garrison may try, the creator included (Neural Conditioning waives this for one's own monster). A try rolls d20 + control science and needs 20+: success destroys the monster and adds 1 suspicion; failure adds nothing and passes it on. Each player who could try but declines adds 2 suspicion. If nobody subdues it, it is unleashed.
- **Suspicion** comes only from graves, sell and experiments (+1 each), subdued monsters (+1) and monsters let pass (+2 per decline). Charity (−2, plus 1 with Parish Benefactor), vespers (−1) and research with Public Lectures (−1) lower it.

### Designer rulings (clarifications to spec v0.3)

These rulings resolve ambiguities in the spec and are implemented in the engine:

1. **Resurrection is prepared, not secretly committed.** Placing your Scientist on *Prepare resurrection* is public and binding, and commits the six chosen parts.
2. **Vitality is a known total**, checked when preparing; only Humanity is rolled.
3. **Science is personal, and every card held applies**, duplicates included.
4. **A stable Creature ends the game.** At the dawn of any round in which a Creature becomes stable, the game ends. If exactly one became stable and its owner is a Prometheus, that player wins. If two or more became stable, the Visionary wins if dealt. Otherwise everyone loses. Two Prometheus players stabilizing in the same round both lose. There are no Creature workers.
5. **Subduing needs a garrison**, the creator's own monster included, unless the creator holds Neural Conditioning; a subduer gains nothing.

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
  data.js                 catalogs and balance constants (actions, parts, science)
  rng.js                  seeded, serializable PRNG (sfc32)
  engine.js               state machine, command bus, legal moves, views, save/replay
  index.js                public API
src/ui/                   browser adapter (rendering + localStorage); calls only engine APIs
src/sim/                  policies, headless runner and AI quality tools
bin/simulate.mjs          batch playtest CLI
bin/quick-check.mjs       sanity check of a rule change in about 30 seconds
bin/compare.mjs           two arms (rules or policies) on the same seeds, with intervals
bin/ai-checks.mjs         metamorphic checks of the AI policies
bin/explain.mjs           one decision's scored options; disagreements between policies
bin/tune.mjs              tune the heuristic's weights for one role
bin/best-response.mjs     each role's headroom over the standard heuristic
bin/llm-playtest.mjs      Claude plays one seat from the rulebook
bin/sweep.mjs             parameter sweep CLI (spec 016)
sweeps/                   sweep definitions
bin/agent-stdio.mjs       JSON-lines driver for external agents
bin/serve.mjs             static dev server (no game logic)
test/engine.test.mjs      rules, determinism, privacy and simulation tests
test/policy-scenarios.test.mjs  how the bots should behave in set situations
```

All balance values and catalogs live in `DEFAULT_CONFIG` (`src/engine/data.js`) and are copied into each game's state.

- `createGame(overrides, seed)` deep-merges your overrides into the defaults; arrays are replaced rather than merged. For example: `{ startingMoney: 5, actions: { graves: { suspicion: 2 } }, partVariants: { ordinary_arm: { copies: 8 } } }`. An action's `capacity` (a number, `null` for unlimited, or tiers such as `{ 3: 2, 5: 3 }`) is always replaced whole.
- Part variants and science cards use effect records: Vitality `{ attribute: 'vitality', op: 'fixed', amount }` and Humanity `{ attribute: 'humanity', op: 'die', die, sign }`. Science may also add control rolls (`{ kind: 'control', op: 'die' | 'fixed', ... }`) and a few named abilities. Every science effect is positive. You can edit them without touching engine code.

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
E.estimateResurrection(state, pid, partIds?); // Vitality total and exact Humanity odds, consumes no randomness
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
| `PICK_PART` | `partId` — after buying specimens, the drawn part to keep; the only legal command until made |
| `SUBDUE_MONSTER` | `subdue: boolean` — only for the player currently deciding in a monster's control chain |
| `PLACE_MEEPLE` | `workerId`, `actionId`, `choices` (below) |

| `actionId` | `choices` |
|---|---|
| `medicine`, `hire`, `charity`, `garrison`, `graves`, `specimens`, `vespers`, `rest` | `{}` (or omitted) |
| `research` | `{ researchCardId: 'card-17' }`: any market card |
| `prepare` | `{ partIds: [...] }`: six parts from your hand, a full set whose Vitality meets the threshold |
| `sell` | `{ partIds: ['part-3', 'part-9'] }`: exactly the configured number of parts from your hand |
| `experiment` | `{ partIds: ['part-3', 'part-9'] }`: exactly the configured number of parts from your hand |

- **Worker IDs:**
  - Scientists are `scientist-p1`.
  - Igors are `igor-p1-1`, `igor-p1-2` and so on.
- **Choice constraints** returned by `getLegalCommands` take these forms:
  - `{ type: 'enum', values }`
  - `{ type: 'subset', min, max, values, perPartType?, minVitality?, vitalityBonus? }`

### Events and privacy

- **Event fields:** every event has `seq`, `round`, `phase`, `type` and `visibility`. Visibility is either `'public'` or a list of player IDs.
- **Private events:** objective assignments (`OBJECTIVE_ASSIGNED`) are visible only to their own player.
- **Public reveals:** `RESURRECTIONS_ANNOUNCED` lists every prepared attempt before any roll, and `OBJECTIVES_REVEALED` publishes every objective at game end.
- **Filtered views:** `getPlayerView` and `filterEvents` never include other players' objectives, the seed, the RNG state or the deck order.
- **Dice detail:** `RESURRECTION_ROLLED` lists the Vitality total with its sources, and every Humanity die with its source, sign and result, the threshold and the final score. Dice are rolled in a fixed order: the base die, then parts in slot order, then science in sorted type ID order.

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
- `terminal`, `truncated`, `truncationReason` (`command_budget`, `round_budget` or `hoarding`) and `terminalReason` (`mob`, `unleashed` or `objective`)
- `hoarding`: when a bot was stopped for hoarding, its `playerId`, `objective`, `policy`, the `resource` (`money` or `parts`), its `value`, the `limit`, and the `round` and `phase`
- `winners`, `winnerObjectives` and `collectiveDefeat`
- `objectives` and `unseenObjectives`
- `rounds`, `commandCount` and `invalidCommands`
- `suspicionHistory` and `resurrections` (scores and outcome per attempt)
- `economy`: per-action placements, Igor placements, rounds used and full phases; each player's Igors and leftover money; round 1's initiative order
- the replay `commands`, when `--commands` is given

Games that hit `--max-commands` or `--max-rounds` are reported as `truncated: true` with no terminal reason. They are never counted as an in-game result.

A bot holding more than 25 money or 25 parts in hand is no longer playing realistically, so the runner stops the game there and flags it (`truncationReason: "hoarding"` and the `hoarding` record above). Aggregates count stops by reason (`truncatedByReason`) and hoarders by objective and resource (`hoardingBy`). Change the limits with `--hoard-money` and `--hoard-parts`, or turn the stop off with `--no-hoard-limit` (`hoardLimit` in `runGame`/`runBatch`; `null` disables it). Seats played by the `random` policy are exempt, since random play is not meant to be realistic.

Policies: `random`, `heuristic`, and the heuristic's `cautious` and `bold` styles, plus, for robustness checks, `noisy` (picks at random among options near its best) and `bt` (the behaviour-tree Prometheus in `src/sim/bt-prometheus.js`, the heuristic for other roles). Names resolve through `src/sim/registry.js`, which also takes specs such as `{"policy":"heuristic","options":{"weights":{...}}}` and seatings such as `{"default":"heuristic","byObjective":{"prometheus":"bt"}}` (only the first Prometheus seat deviates unless `"deviators":"all"`).

Every result also has an `uptake` record, aggregated as `uptake`:
- each science type: how often it was acquired (by research or experiment) and applied in rolls, with the win rate of the players who held it (a correlation, not a cause);
- how often each part variant went into an attempted body;
- suspicion lowered by Public Lectures and by vespers, and money from Medical Expertise;
- the share of Igor-rounds and Scientist phases left idle, by objective and policy;
- `rarelyUsed`: science and actions the bots barely touched. A new card here is weak or not understood by the AI; fix that before reading its balance numbers.

### Parameter sweeps

`bin/sweep.mjs` runs a sweep file from `sweeps/` across player counts and policy styles, in parallel, and ranks the points against design targets (spec 016).

```bash
# one-at-a-time sensitivity around the baseline
node bin/sweep.mjs sweeps/sensitivity.json --out sweep-results.jsonl

# quick check with fewer games and only two player counts
node bin/sweep.mjs sweeps/sensitivity.json --games 40 --players 3,5
```

Variables are dotted config paths (`actions.medicine.gain`, `actions.research.capacity.5`, `actions.graves.suspicion.bands.0.max`); paths joined with `|` share one value. Samplers are `oat`, `grid`, `random` and `lhs`.

### AI quality tools

Balance numbers are only as good as the bots producing them. These tools check that a result comes from the rules, not from how the AI plays.

```bash
# first: a quick sanity check of a rule change (about 30 seconds)
node bin/quick-check.mjs change.json

# then, if it flags something or before relying on a change: the full comparison,
# under several policy sets, with confidence intervals (--max-games keeps adding
# games until each difference is significant or known to within 3 points)
node bin/compare.mjs --candidate change.json --policies 'heuristic;cautious,bold;noisy' --games 400 --max-games 800

# a policy change under the same rules
node bin/compare.mjs --base-policies heuristic --candidate-policies bt --players 4,5

# metamorphic checks: changes with a known effect on a sensible player (about 1.5 minutes;
# --exact for the move-for-move ones only, --scale 3 for more statistical power)
npm run ai-checks

# why did the bot do that: the heuristic's scored options at one decision
node bin/explain.mjs --seed s1 --players 4 --at 120

# where two policies disagree most, with replayable examples
node bin/explain.mjs --disagree --actor heuristic --shadow bt --objectives prometheus

# tune the heuristic's weights for one role, then measure each role's headroom
node bin/tune.mjs --objective unleasher
node bin/best-response.mjs

# an LLM plays one seat from the rulebook and reports on the rules (costs money; --dry-run is free)
node bin/llm-playtest.mjs --objective visionary --players 5
```

- **Quick check** (`bin/quick-check.mjs`): the scenario tests and the exact metamorphic checks under the changed rules, a screening comparison (standard heuristic, 3 and 5 players, 200 games per arm, so changes of about ±7 points show), and the uptake of the content the change touches. It lists what it flagged and what to run next. It is for catching big effects and AI blind spots before a full run, not for balance numbers.
- **Compare** (`src/sim/compare.js`): both arms play the same seeds. For each player count and policy set it reports each objective's win rate in both arms, the change with a 95% interval and a p-value, and how many marks chance alone would give. Its verdict per objective is *robust* (every policy set agrees), *policy-dependent* (sets disagree significantly: the effect comes from the AI), or *no clear effect*.
- **Metamorphic checks** (`src/sim/metamorphic.js`): cheaper or safer actions are not used less; a science card with no effect is not bought (except by an Inquisitor blocking a slot); renaming every science type, or the players, changes no game at all, move for move, so the AI depends on effects, not IDs. A failure is an AI flaw to fix before trusting balance numbers.
- **Scenario tests** (`test/policy-scenarios.test.mjs`, part of `npm test`): set up a situation, let a policy play the phase, and check what it did. They state how the bots should behave.
- **Explanations** (`src/sim/disagree.js`): the heuristic takes an `explain` callback that receives every option's score, split into value, suspicion risk, Scientist tax and Igor reserve.
- **Effect values** (`src/sim/effect-values.js`): every policy values science from one two-layer table. Layer 1 (`EFFECT_IMPACT`) says what each effect kind does in a few game quantities (Vitality and Humanity points, control points, money, suspicion kept off the table, subduing one's own monster); it is the same for every role. Layer 2 prices each quantity per role, for itself (`QUANTITY_PRICE`) and in a rival's hands (`RIVAL_PRICE`). A new card that uses existing effect kinds needs no code. A new effect kind needs one layer-1 entry, and a new quantity only for a genuinely new kind of benefit, priced once per role.
- **Body planning** (`src/sim/body-plan.js`): both AI policies plan the best full set a hand can make for their objective (Vitality first, then Humanity), with exact Humanity odds, and value a part by how much it improves that plan.
- **Occasional tools**, too slow or too uncertain for routine use: tuning, best response and the LLM playtest.
- **Tuning and best response** (`src/sim/tune.js`): the heuristic's numbers are `DEFAULT_WEIGHTS` in `src/sim/policies.js`, with per-role defaults in `OBJECTIVE_WEIGHTS` overridable with the `weights` option. `bin/tune.mjs` searches them for one objective with the cross-entropy method, as a best response to standard opponents, and saves them under `experiments/tuned/`. `bin/best-response.mjs` puts one seat of each role on its best known policy against a standard field: a large gap over the standard heuristic means that role's balance numbers measure AI skill as much as rules.
- **LLM playtest** (`src/sim/llm-policy.js`): Claude (`claude-opus-5-5`, low effort, with server-side refusal fallbacks) plays one seat from `assets/rulebook.md`, one API call per decision, and writes a transcript of its moves and reasons and its feedback on unclear rules and unused content to `playtests/`. It needs `npm install @anthropic-ai/sdk` and credentials. Use it for qualitative checks of new content, not for statistics.
- **Statistics** (`src/sim/stats.js`): Wilson intervals, two-proportion tests and `gamesForHalfWidth`. At a 50% rate, 100 games give about ±10 points and 500 about ±4.4.

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

`npm test` runs `node --test` on every `test/*.test.mjs`. Besides the print view and the policy scenarios, the engine suite covers:

- setup and deck composition
- rejected commands leaving state unchanged
- capacity, Igor timing and night use
- the body-part deck: specimens, graves, the discard pile and reshuffling
- capacity tiers, worker permissions, flat night suspicion, sell, experiments, vespers and rest
- preparing a body: full sets, the Vitality threshold and committed parts
- science: the market, duplicates and every card applying
- every resurrection outcome and each victory or defeat path
- a stable Creature always ending the game at dawn
- prepared resurrections and filtered views
- sweep sampling, config paths and scoring
- save/load round trips and replay verification, including tamper detection
- stale-command protection
- every enumerated legal command being accepted
- batch simulations finishing with no invalid commands
- a static check that the engine never uses the DOM, storage, timers or `Math.random`
