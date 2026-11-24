# 025 — Resurrection

Resurrection is optional, and happens after the night actions. It is not a worker-placement action. A viable body is enough to attempt it; safety research is optional. Without preparation, a living Creature is naturally likely to be hostile. Control and Humanity offer two separate routes to stability.

## Eligibility and commitment

A player is eligible if their body is complete, with all six slots filled. **Ruling:** owning a stable Creature, which becomes a worker under spec 021, does not block a new attempt. Eligible players secretly commit to attempt or decline, following the procedure in spec 021. Every commitment is locked before any roll is revealed.

## Rolling

An attempt consumes all six installed parts; loose parts are untouched. Then three independent attributes are rolled, each with a base fair d20 and a base success threshold of 18:

- **Vitality**: does the body live?
- **Control**: can it be directed?
- **Humanity**: does it have a conscience?

Installed parts (spec 024) and effective research (spec 023) may add or subtract extra dice (d4, d6, d8, d10, d12 or d20), add signed fixed modifiers, or adjust thresholds. For each attribute:

1. Roll the base die and every applicable additional die independently.
2. Score = base result + the signed results of the additional dice + the signed fixed modifiers.
3. Threshold = base threshold + all threshold adjustments.
4. The roll succeeds if score ≥ threshold.

Scores and thresholds are not clamped. There are no automatic results on a natural 1 or 20, and no rerolls or player choices during resolution. Fixed modifiers use no randomness.

Dice are rolled automatically, in this fixed order:

1. Vitality, then Control, then Humanity.
2. Within each attribute: the base die first, then installed parts in slot order (`arm1`, `arm2`, `leg1`, `leg2`, `chest`, `head`), then research in alphabetical order of type ID, with one roll per effective copy.

Every raw die roll is displayed and logged with its source, size and sign, along with every fixed modifier and threshold adjustment with its source, the adjusted threshold, the final score and success or failure.

## Outcomes

Outcomes are checked in this order:

1. **Vitality fails.** No Creature is created. Three of the six consumed parts are salvaged into loose inventory, chosen uniformly at random without replacement; the other three are lost. Suspicion rises by 1 (spec 020), which may form the mob.
2. **Vitality succeeds, and Control or Humanity succeeds.** A stable Creature is created and owned by the player, and its ID is recorded as a stable transition for this round. It is described as *controlled*, *humane* or *controlled and humane*. These descriptions carry no ongoing mechanical difference in this version. If the game continues past dawn, it becomes its owner's worker (spec 021).
3. **Vitality succeeds, but Control and Humanity both fail.** The Creature is unleashed, and the game ends immediately with an Unleasher victory or a collective defeat (spec 020). Suspicion is not added, and the mob is not checked as a secondary consequence. No later commitment is resolved.

## Odds estimate

The engine can compute exact probabilities for a player's current complete body and effective research, without consuming randomness. It gives each attribute's success chance and the overall chances of a stable, unleashed or failed result. The browser shows these odds wherever a complete body is displayed, including on the private commitment screen. The heuristic AI uses them to decide whether to attempt.
