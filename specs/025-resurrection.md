# 025 — Resurrection

Resurrection is optional, and happens after the night actions. Everything before it is known or chosen; the whole game builds to a single roll of a handful of dice, and the counter-rolls of the players who answer a monster. Humanity is the only route to a stable Creature; garrisoned players are the table's shared defence against monsters.

## Preparing: Vitality

A player attempts a resurrection by placing their Scientist on Prepare resurrection during the night (spec 022) and choosing a full set of six parts from their hand: two arms, two legs, a chest and a head.

**Vitality** asks whether the body can live, and it is not rolled. It is a known total: the Vitality values of the six chosen parts (spec 024) plus the Vitality science the player holds (spec 023). **The placement is legal only if the total is at least the Vitality threshold, 10.** A body that can't reach the threshold can't be prepared, so a prepared body always lives.

**Ruling:** there is no secret commitment. Preparing is public and binding, and every attempt is announced before any roll (spec 021). The six parts leave the hand at once and are laid out on the player's body slots, in slot order (`arm1`, `arm2`, `leg1`, `leg2`, `chest`, `head`), arms and legs in the order chosen. They can't be sold, discarded or changed afterwards. Science gained later can't lower Vitality, because every science effect is positive.

## Resolving: Humanity

Each attempt is one Humanity roll. **Humanity** asks whether the Creature has a conscience.

1. Roll a d20, the base die, and every Humanity die from the six parts and the player's Humanity science, each independently.
2. Score = the base die + the signed results of the other dice.
3. The roll succeeds if the score is at least the Humanity threshold, 20.

With no other dice, a natural 20 succeeds, so every attempt has a chance. Negative dice can make success impossible. Scores are not clamped. There are no automatic results on a natural 1 or 20, and no rerolls or player choices during the roll. Humanity science counts as held when the attempt resolves.

Dice are rolled automatically in a fixed order: the base die first, then parts in slot order, then science in alphabetical order of type ID, one roll per card held. Every raw die roll is logged with its source, size and sign, together with the Vitality total and its sources, the threshold, the final score and the outcome.

## Outcomes

The six parts are consumed and go to the discard pile (spec 024). Then:

1. **Humanity succeeds.** A stable, *humane* Creature is created and owned by the player, and its ID is recorded as a stable transition for this round. The game ends at that round's dawn (spec 020).
2. **Humanity fails.** A monster is created. Resolution pauses for its control chain (below). The next attempt resolves only after the chain ends with the monster subdued.

## Control chain

When a monster is created, a control chain begins with its creator and continues clockwise (to the left, in seat order) around the table, giving each player exactly one chance at that monster.

**Ruling:** to try to subdue any monster, a player needs an Igor in the garrison this round (spec 022). This includes the creator, except that a creator holding Neural Conditioning (spec 023) needs no garrison for their own monster. A player who can't try is skipped automatically, adds no suspicion, and the skip is logged. There is no limit on how many monsters a player may try to subdue over a game. Every player who can try decides publicly, one at a time, with `SUBDUE_MONSTER` (spec 011):

- **Try to subdue.** The player makes a control roll (below). If it fails, nothing else happens: no suspicion is added, and the chain moves to the next player. If it succeeds, the monster is destroyed: no Creature exists, nothing is recorded as a stable transition, and the subduer gains nothing. Then suspicion rises by 1, attributed to the subduing player; the monster is already destroyed, so if this forms the mob, the Inquisitor wins as usual. Otherwise the chain ends, and resolution continues with the next attempt.
- **Decline.** The player does not try. Suspicion rises by 2, attributed to the declining player, and the chain moves to the next player. This applies to the creator as well.

**Ruling: control rolls.** A control roll is a fair d20 plus the player's control science (spec 023): one fixed modifier or die per card, in alphabetical order of type ID. It succeeds if the score is 20 or more. Body parts never modify control. Every die, modifier, score and outcome is logged publicly.

If the chain gets back to the creator without anyone subduing the monster, it is unleashed, and the game ends immediately with an Unleasher victory or a collective defeat (spec 020). No later attempt is resolved.

**Ruling:** the mob cannot stop a monster. If a decline raises suspicion to the mob threshold, the mob forms but the monster is unleashed at once. The game ends as an unleashing (terminal reason `unleashed`): the Unleasher wins if dealt, and the Inquisitor does not.

## Odds estimate

The engine computes, without consuming randomness, the Vitality total of any full set of parts in a player's hand and the exact chance of its Humanity roll succeeding with the player's current science, and the same for a prepared body. Subduing depends on decisions, so it is not estimated, but the engine gives each player's public control-roll success chance. The browser shows these odds when choosing a body, on every prepared body, on player panels and in the subdue dialog.
