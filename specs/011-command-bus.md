# 011 — Command bus

Every committed action that a player would perform at the physical table is a serializable command, submitted through one dispatch interface: `dispatch(state, command)`. Everything else is either a UI interaction or an automatic engine consequence.

## What is and isn't a command

Commands are player decisions: placing a worker with all of its choices, picking drawn parts, passing, publishing research, committing to or declining a resurrection attempt, and choosing whether to subdue a monster. Clicking, hovering, highlighting, selecting an option before confirming, opening a panel and acknowledging a privacy screen are UI interactions, not commands, and never reach the engine.

Dice outcomes, suspicion changes, resource grants, research refills, phase transitions, resurrection results, victory and defeat are never commands. The engine resolves them automatically.

## Command types

Every command has a `type` and the acting `playerId`. It may also carry an optional `seq`, described below. Unknown command types and unknown fields are rejected.

- `PASS_TURN` gives up all of the player's remaining placements in the current day or night phase. Passing is irrevocable for that phase.
- `PICK_PARTS` with `partIds` is legal only for the player who has just raided the morgue, and is then their only legal command. It names exactly as many of the drawn parts as they may keep (spec 022).
- `PUBLISH_RESEARCH` with a `researchType` is legal for the active player on their day or night turn, for a type they have discovered and not yet published (spec 023). The player keeps the turn.
- `COMMIT_RESURRECTION` with `attempt: true | false` is legal only for the eligible player currently being prompted during the commitment phase.
- `SUBDUE_MONSTER` with `subdue: true | false` is legal only for the player currently deciding in a monster's control chain during resolution (spec 025).
- `PLACE_MEEPLE` names a `workerId`, an `actionId` and a `choices` object. `choices` may be omitted for actions that need no choices. The choices required by each action are:

| Action | Choices |
|---|---|
| medicine, hire, charity, lecture, garrison, graves, morgue | none (`{}`) |
| research | `researchCardId`: a market card |
| specimens | `variantIds`: exactly one part variant ID |
| assemble | `partIds`: one or more unique loose part instance IDs, each fitting a distinct empty slot |
| experiment | `partIds`: exactly two unique loose part instance IDs; `researchCardId`: a market card |

Specimen purchases select part *variants*. Assembly and experiment payments select specific part *instances*. Unknown choice keys and missing choice keys are both rejected.

## Validation

Before changing anything, dispatch checks:

- that the command is well formed;
- that the game is not over;
- that the player exists and is the one whose decision it is;
- that the phase is right for the command;
- that the worker belongs to the player, is active and has not already acted;
- that an Igor may take the action, and that a Scientist may (some actions are Igor-only);
- that the space has capacity left;
- that the player can pay the full cost and meets every prerequisite;
- that every choice is valid.

No action may be selected unless its full cost can be paid, and balances never go negative.

A rejected command returns `{ ok: false, error }`, where `error` is a structured `{ code, message }`. Codes are stable and machine-readable, for example `UNKNOWN_COMMAND`, `UNKNOWN_FIELD`, `MISSING_FIELD`, `NOT_YOUR_TURN`, `WRONG_PHASE`, `WORKER_USED`, `WORKER_PENDING`, `IGOR_NOT_PERMITTED`, `SCIENTIST_NOT_PERMITTED`, `SPACE_FULL`, `INSUFFICIENT_MONEY`, `INVALID_CHOICE`, `INVALID_TARGET`, `PICK_PENDING`, `STALE_COMMAND` and `GAME_OVER`. A rejection returns the very same state object. It leaves the RNG, the event history and the command log unchanged, and it emits no events.

## Acceptance and automatic progression

An accepted command returns `{ ok: true, state, events }`, with a new state and the ordered domain events produced. The command is appended to the state's command log, without its `seq`. The engine then automatically processes every forced transition and system outcome until it reaches the next player decision or a terminal result. This includes resolving dice, ending phases when nobody can act, skipping players with no legal placement, resolving resurrections, checking objectives at dawn and starting the next round. No acknowledgement from the UI and no "advance phase" command is ever needed. At any moment, `state.activePlayerId` names the only player who may act, or is `null` once the game has ended.

Terminal states reject all gameplay commands with `GAME_OVER`.

## Duplicate protection

A command may include `seq`, equal to the number of commands accepted so far. If it does not match, the command is rejected with `STALE_COMMAND`. This prevents a command from executing twice, for example after a resume or a double click. The browser always sends `seq`.

## Legal-command discovery

`getLegalCommands(state, playerId)` returns nothing unless that player is the one to act. Otherwise it lists every legal command template:

- `PASS_TURN`, which is always legal in day or night;
- one `PUBLISH_RESEARCH` per type the player may publish, in day or night;
- one entry per available worker and legal action;
- every allowed `PICK_PARTS` choice while a morgue pick is pending;
- both commitment options during the commitment phase;
- both subdue options for the player deciding in a control chain.

Templates for actions needing choices carry machine-readable constraints. These are an `enum` of values, a `multiset` with a count, or a `subset` with a minimum, a maximum and optional per-part-type maximums.

`enumerateLegalCommands` expands the templates into concrete, dispatchable commands. By default it collapses equivalent options, such as identical Igors or part selections with the same variants, to keep the list small. Every enumerated command must be accepted by dispatch, and a test enforces this.
