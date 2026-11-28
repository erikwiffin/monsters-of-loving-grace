# 021 — Round structure and workers

A round is made up of four phases: day, night, resurrection resolution and dawn. Day is for legitimate activity that costs or earns money; night is generally free but raises suspicion (spec 022).

## Initiative

Each round has a first player. Initiative order runs from the first player clockwise, in seat order. At the end of each round that doesn't end the game, the player who took the Rest action that night becomes the first player. If nobody rested, the first player moves one seat to the left. The starting player for round 1 is random (spec 020).

## Day and night

Day and night follow the same procedure. Starting with the first player and going round the table, the active player either places one eligible unused worker on a legal action space, resolving its effect immediately, or passes. Play then moves to the next seat. This continues until every player has passed or has no legal placement.

- Passing is irrevocable for the rest of that phase. A player may pass the day while keeping unused Igors for the night.
- A player with no legal placement at the moment is skipped automatically; they don't have to pass. If another player's action later makes one of their placements legal, they get another turn.
- The phase ends automatically when nobody who hasn't passed has a legal placement.
- Passing is always allowed when it is your turn.
- There are no free actions: everything a player does by day or night is a placement.

At the start of night, everyone's pass status resets and the turn returns to the first player.

## Workers

Each worker has a stable ID. There are two kinds.

- **Scientist** (`scientist-pN`): every player has one from the start. It acts once by day and once by night, refreshing for the night. It may take any action.
- **Igor** (`igor-pN-k`): every player starts with one Igor (`igor-pN-1`), available from round 1. More are hired at the Tavern for a flat price, up to three Igors per player in all, by any worker. There are no wages. A newly hired Igor can act at once (spec 022). An Igor acts once per full round, in either day or night. An Igor used by day can't act that night; one left unused by day may act at night. There is no advance assignment. Igors may take every action except Prepare resurrection (spec 022).

## Resurrection resolution

**Ruling: there is no secret commitment.** A player attempts a resurrection by placing their Scientist on Prepare resurrection during the night, laying out a full set of body parts whose Vitality meets the threshold (spec 025). Preparing is public and binding, and the chosen parts are committed at once. When night ends, the attempts of every player who prepared are announced together, then resolve in initiative order: each is a single Humanity roll, made automatically (spec 025). If nobody prepared, the phase passes immediately.

Each stable Creature is recorded as a stable transition for the round. When an attempt creates a monster, resolution pauses while garrisoned players decide in its control chain, starting with its creator and going clockwise (spec 025), and continues with the next attempt once the monster is subdued. If the mob forms or a monster is unleashed during resolution, resolution stops at once: attempts not yet resolved have no effect.

## Dawn

At dawn, Prometheus and Visionary are checked together (spec 020). If any Creature became stable this round, the game ends, whether or not anyone wins. Otherwise:

- the player who rested becomes the first player, or, if nobody rested, the first player rotates one seat;
- all action-space occupancy and worker-used flags are cleared;
- the round's stable transitions are cleared;
- the round number increases, and a new day begins.

Dawn never changes suspicion.

## Action spaces and capacity

Action spaces have a capacity per phase that resets every round, and may depend on the player count (spec 022). Unlimited spaces still use a worker. Which workers occupy each space is public. Day and night spaces have distinct IDs, and occupancy is tracked separately for each phase. Spec 022 gives every space's cost, effect and capacity.

## Ending

The game ends immediately whenever suspicion reaches the mob threshold (spec 020) or a monster is unleashed, whatever the phase. It also ends at the dawn of any round in which a Creature became stable, even when nobody wins. There is no round limit.
