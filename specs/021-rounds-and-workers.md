# 021 — Round structure and workers

A round is made up of five phases: day, night, resurrection commitment, resurrection resolution and dawn. Day is for legitimate activity that earns money; night is generally free but risky.

## Initiative

Each round has a first player. Initiative order runs from the first player clockwise, in seat order. At the end of each round that doesn't end the game, the first player moves one seat to the left. The starting player for round 1 is random (spec 020).

## Day and night

Day and night follow the same procedure. Starting with the first player and going round the table, the active player either places one eligible unused worker on a legal action space, resolving its effect immediately, or passes. Play then moves to the next seat. This continues until every player has passed or has no legal placement.

- Passing is irrevocable for the rest of that phase. A player may pass the day while keeping unused Igors for the night.
- A player with no legal placement at the moment is skipped automatically; they don't have to pass. If another player's action later makes one of their placements legal, they get another turn.
- The phase ends automatically when nobody who hasn't passed has a legal placement.
- Passing is always allowed when it is your turn.

At the start of night, everyone's pass status resets and the turn returns to the first player.

## Workers

Each worker has a stable ID. There are two kinds.

- **Scientist** (`scientist-pN`): every player has one from the start. It acts once by day and once by night, refreshing for the night. It may take any action.
- **Igor** (`igor-pN-k`): hired at the Tavern for 4, then 7, then 10 money, up to three per player. There are no wages. A newly hired Igor is pending and becomes available at the start of the next round, which prevents chaining actions within one round. An Igor acts once per full round, in either day or night. An Igor used by day can't act that night; one left unused by day may act at night. There is no advance assignment. An Igor may only take actions marked as Igor-permitted (spec 022).

## Resurrection commitment

After night, every player with a complete assembled body (spec 024) is eligible to attempt a resurrection. Attempting needs no worker. Players without a complete body decline automatically.

Eligible players decide in initiative order, one at a time and in private. In the browser, a pass-the-device screen is shown before each decision. Each player secretly chooses to attempt or to decline. Others may see that a player has locked a decision, but not what it was. Every commitment is locked before any is revealed. If no one is eligible, the phase passes immediately.

## Resurrection resolution

All commitments are revealed together. The attempts then resolve in initiative order, with dice rolled automatically and research applied automatically (spec 025). Each stable Creature is recorded as a stable transition for the round. If the mob forms or a Creature is unleashed during resolution, resolution stops at once: commitments not yet resolved consume no parts and have no effect.

## Dawn

At dawn, Prometheus and Visionary are checked together (spec 020). If any Creature became stable this round, the game ends, whether or not anyone wins. Otherwise:

- the first player rotates one seat;
- all action-space occupancy and worker-used flags are cleared;
- pending workers (newly hired Igors) become available;
- the round's stable transitions are cleared;
- the round number increases, and a new day begins.

Dawn never changes suspicion.

## Action spaces and capacity

Shared action spaces have a capacity per phase that resets every round. Private actions (assemble, experiment) have unlimited capacity but still use a worker. Which workers occupy each space is public. Day and night spaces have distinct IDs, and occupancy is tracked separately for each phase. Spec 022 gives every space's cost, effect and capacity.

## Ending

The game ends immediately whenever suspicion reaches 16 or a Creature is unleashed, whatever the phase. It also ends at the dawn of any round in which a Creature became stable, even when nobody wins. There is no round limit.
