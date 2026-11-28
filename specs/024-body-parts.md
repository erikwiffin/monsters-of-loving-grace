# 024 — Body parts

Body parts are a consumable resource. Each part is a card: a named variant of a type, with resurrection effects defined as data.

## Part types and the body

A full set of body parts is exactly two arms, two legs, one chest and one head. Arms are interchangeable with each other, and so are legs; there are no separate left and right parts. Each player sheet has six body slots, `arm1`, `arm2`, `leg1`, `leg2`, `chest` and `head`, which hold the parts of a prepared resurrection between preparing and resolution (spec 025). At any other time the slots are empty.

A player keeps their parts in a hand, as a list of part instances. Each instance has a unique ID (`part-N`), a type and a variant ID. There is no storage limit. Every hand is public, as are part names and effects.

## Effects

A part may affect Vitality, Humanity, both or neither:

- **Vitality** is a signed whole number, added to the body's Vitality total.
- **Humanity** is a signed die (d4, d6, d8, …), rolled with the Humanity roll and added or subtracted.

There are no other kinds of part effect. Different parts contribute independently, including duplicates of the same variant. The deck is deliberately biased towards negative values: most parts are ordinary or worse, and a strong body is built by choosing well from a larger hand, together with Vitality science (spec 023).

## The body-part deck

All parts come from one shuffled deck. Its contents, by default 60 cards, are:

| Variant ID | Name | Type | Copies | Vitality | Humanity |
|---|---|---|---:|---:|---|
| ordinary_arm | Ordinary arm | arm | 5 | +1 | |
| labourer_arm | Arm of a labourer | arm | 2 | +3 | |
| blacksmith_arm | Arm of a blacksmith | arm | 1 | +4 | −d4 |
| surgeon_arm | Arm of a surgeon | arm | 1 | +1 | +d4 |
| strangler_arm | Arm of a strangler | arm | 2 | +2 | −d6 |
| damaged_arm | Damaged arm | arm | 4 | −1 | |
| withered_arm | Withered arm | arm | 3 | −2 | |
| gangrenous_arm | Gangrenous arm | arm | 2 | −3 | |
| ordinary_leg | Ordinary leg | leg | 5 | +1 | |
| athlete_leg | Leg of an athlete | leg | 2 | +3 | |
| highwayman_leg | Leg of a highwayman | leg | 1 | +3 | −d6 |
| soldier_leg | Leg of a soldier | leg | 2 | +2 | −d4 |
| dancer_leg | Leg of a dancer | leg | 1 | +1 | +d4 |
| frail_leg | Frail leg | leg | 4 | −1 | |
| lame_leg | Lame leg | leg | 3 | −2 | |
| crushed_leg | Crushed leg | leg | 2 | −3 | |
| ordinary_chest | Ordinary chest | chest | 3 | +2 | |
| robust_chest | Robust chest | chest | 1 | +4 | |
| prizefighter_chest | Chest of a prizefighter | chest | 1 | +4 | −d6 |
| priest_chest | Chest of a priest | chest | 1 | +1 | +d6 |
| scarred_chest | Scarred chest | chest | 2 | −1 | |
| consumptive_chest | Consumptive chest | chest | 2 | −3 | |
| ordinary_head | Ordinary head | head | 3 | | |
| scholar_brain | Brain of a scholar | head | 1 | | +d6 |
| poet_brain | Brain of a poet | head | 1 | | +d4 |
| saint_brain | Brain of a saint | head | 1 | | +d8 |
| criminal_brain | Brain of a criminal | head | 2 | | −d6 |
| madman_brain | Brain of a madman | head | 1 | +2 | −d8 |
| drunkard_brain | Brain of a drunkard | head | 1 | −1 | −d4 |

Named brains occupy the head slot; there is no separate brain resource or slot. These fictional traits are gameplay abstractions. The catalogue, including every copy count, lives in configuration data and can be edited independently of engine logic.

At setup, one part instance is made for every copy and the deck is shuffled. Its order is hidden; only its size is public. Beside it is a face-up **discard pile**, which is public. Whenever a part is to be drawn and the deck is empty, the discard pile is shuffled to form a new deck first. If both are empty, nothing more is drawn.

## Acquiring parts

- **Buy specimens** (day): draw 3, keep one, and discard the other two (spec 022).
- **Rob graves** (night): draw 2 into the hand (spec 022).

## Spending parts

Every spent part goes to the discard pile:

- selling discards 2 parts from the hand (spec 022);
- an experiment discards 2 parts from the hand (spec 022);
- the two specimens not kept;
- every resurrection consumes its six parts, whatever the outcome, including a monster that is subdued or unleashed (spec 025).
