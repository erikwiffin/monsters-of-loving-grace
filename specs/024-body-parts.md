# 024 — Body parts and assembly

Body parts are a consumable resource. Each part is a named variant with resurrection effects defined as data.

## Part types and the body

A complete body needs exactly two arms, two legs, one chest and one head. Each player's installed body has six slots: `arm1`, `arm2`, `leg1`, `leg2`, `chest` and `head`. Arms are interchangeable with each other, and so are legs; there are no separate left and right parts. A player has at most one body under construction.

Loose parts are kept as a list of part instances. Each instance has a unique ID (`part-N`), a type and a variant ID. Surplus loose parts can be stored indefinitely; there is no decay or storage limit. Part names and effects are public.

## Variant catalogue

| Variant ID | Name | Type | Resurrection effect |
|---|---|---|---|
| ordinary_arm | Ordinary arm | arm | None |
| labourer_arm | Arm of a labourer | arm | Vitality +1d4 |
| damaged_arm | Damaged arm | arm | Vitality −1d4 |
| ordinary_leg | Ordinary leg | leg | None |
| athlete_leg | Leg of an athlete | leg | Vitality +1d6 |
| frail_leg | Frail leg | leg | Vitality −2 (fixed) |
| ordinary_chest | Ordinary chest | chest | None |
| robust_chest | Robust chest | chest | Vitality +1d8 |
| scarred_chest | Scarred chest | chest | Vitality −1d6 |
| ordinary_head | Ordinary head | head | None |
| criminal_brain | Brain of a criminal | head | Humanity success threshold +3 |
| scholar_brain | Brain of a scholar | head | Humanity +1d6 |
| poet_brain | Brain of a poet | head | Humanity +1d4 |

Named brains occupy the head slot; there is no separate brain resource or slot. These fictional traits are gameplay abstractions. The catalogue lives in configuration data and can be edited independently of engine logic. Each effect names an attribute and an operation: an additional signed die, a signed fixed modifier, or a threshold adjustment. Different installed parts contribute independently, including duplicates of the same variant.

## Acquiring parts

- **Random draws** (graves: 2 parts; morgue: 3 parts drawn, of which the player keeps 1). Each part is drawn independently, with replacement and from unlimited supply. First the type is chosen with weights arm 2/6, leg 2/6, chest 1/6 and head 1/6. Then a variant of that type is chosen uniformly.
- **Specimens** (day): choose exactly one variant by ID for 2 money (spec 022).
- **Salvage**: a failed resurrection returns three of the six consumed parts to its creator's loose inventory, and subduing a monster gives three of its six parts to the subduing player (spec 025).

## Assembly

The assemble action moves chosen loose parts into matching empty slots. It must fill at least one slot, and may fill one per action, plus one more per effective copy of Advanced Anatomy. Each part goes into the first empty slot of its type. A part can't be installed without an empty slot of its type, and installed parts can't be removed or swapped in this version.

## Spending parts

- Experiments spend any two chosen loose parts (spec 022).
- A resurrection attempt consumes all six installed parts, but never loose parts (spec 025).
