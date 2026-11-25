# 025 — Resurrection

Resurrection is optional, and happens after the night actions. It is not a worker-placement action. A viable body is enough to attempt it; safety research is optional. Without preparation, a living Creature is naturally likely to be a monster. Humanity is the only route to a stable Creature; control attempts are the table's shared defence against monsters.

## Eligibility and commitment

A player is eligible if their body is complete, with all six slots filled. Eligible players secretly commit to attempt or decline, following the procedure in spec 021. Every commitment is locked before any roll is revealed.

## Rolling

An attempt consumes all six installed parts; loose parts are untouched. Then two independent attributes are rolled, each with a base fair d20:

- **Vitality**: does the body live? Base success threshold 20.
- **Humanity**: does it have a conscience? Base success threshold 20.

**Ruling:** both thresholds are 20, so an unmodified roll can succeed, but only on a natural 20. Control is not rolled (see *Control attempts* below).

Installed parts (spec 024) and effective research (spec 023) may add or subtract extra dice (d4, d6, d8, d10, d12 or d20), add signed fixed modifiers, or adjust thresholds. For each attribute:

1. Roll the base die and every applicable additional die independently.
2. Score = base result + the signed results of the additional dice + the signed fixed modifiers.
3. Threshold = base threshold + all threshold adjustments.
4. The roll succeeds if score ≥ threshold.

Scores and thresholds are not clamped. There are no automatic results on a natural 1 or 20, and no rerolls or player choices during resolution. Fixed modifiers use no randomness.

Dice are rolled automatically, in this fixed order:

1. Vitality, then Humanity.
2. Within each attribute: the base die first, then installed parts in slot order (`arm1`, `arm2`, `leg1`, `leg2`, `chest`, `head`), then research in alphabetical order of type ID, with one roll per effective copy.

The random choice of parts salvaged after a failed Vitality roll is made right after the rolls; the choice of parts given to a subduing player is made when that player subdues.

Every raw die roll is displayed and logged with its source, size and sign, along with every fixed modifier and threshold adjustment with its source, the adjusted threshold, the final score and success or failure.

## Outcomes

Outcomes are checked in this order:

1. **Vitality fails.** No Creature is created. Three of the six consumed parts are salvaged into loose inventory, chosen uniformly at random without replacement; the other three are lost. Suspicion rises by 1 (spec 020), which may form the mob.
2. **Vitality and Humanity succeed.** A stable, *humane* Creature is created and owned by the player, and its ID is recorded as a stable transition for this round. The game ends at that round's dawn (spec 020).
3. **Vitality succeeds, but Humanity fails.** A monster is created. Resolution pauses for its control chain (below). The next commitment resolves only after the chain ends with the monster subdued.

## Control attempts

**Ruling:** every player starts the game with 3 control attempts, plus one for each effective copy of Neural Conditioning (spec 023). Each player's remaining attempts are public. Spent attempts never return.

When a monster is created, a control chain begins with its creator and continues clockwise (to the left, in seat order) around the table, giving each player exactly one chance. **Ruling:** to subdue another player's monster, a player needs an Igor in the garrison this round (spec 022). The creator is present at the resurrection and needs no garrison. A player who cannot subdue, for lack of attempts or a garrison, is skipped automatically, adds no suspicion, and the skip is logged. Every other player in turn decides publicly, one at a time, with `SUBDUE_MONSTER` (spec 011), whether to subdue it:

- **Subdue.** The player spends one control attempt. The monster is destroyed: no Creature exists and nothing is recorded as a stable transition. Three of the six consumed parts, chosen uniformly at random without replacement, go to the subduing player's loose inventory; the other three are lost. Then suspicion rises by 1, attributed to the subduing player; the monster is already destroyed, so if this forms the mob, the Inquisitor wins as usual. Otherwise the chain ends, and resolution continues with the next commitment.
- **Decline.** Suspicion rises by 2, attributed to the declining player, and the chain moves to the next player. This applies to the creator as well.

If the chain gets back to the creator without anyone subduing the monster, it is unleashed, and the game ends immediately with an Unleasher victory or a collective defeat (spec 020). No later commitment is resolved.

**Ruling:** the mob cannot stop a monster. If a decline raises suspicion to the mob threshold, the mob forms but the monster is unleashed at once. The game ends as an unleashing (terminal reason `unleashed`): the Unleasher wins if dealt, and the Inquisitor does not.

## Odds estimate

The engine can compute exact probabilities for a player's current complete body and effective research, without consuming randomness. It gives each attribute's success chance and the overall chances of a stable Creature, a monster or a failed result. Whether a monster is subdued depends on players' decisions, so it is not estimated. The browser shows these odds wherever a complete body is displayed, including on the private commitment screen. The heuristic AI uses them to decide whether to attempt.
