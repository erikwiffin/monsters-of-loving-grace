# 022 — Action spaces

Each action space has a phase, a capacity, a worker permission and an effect. An action may only be chosen if its full cost and every prerequisite can be met. Balances never go negative. All numbers are default configuration values (spec 010): a baseline for tuning by parameter sweeps (spec 016), not settled balance.

## Capacity

Every space's capacity is configured as one of:

- **unlimited** (`null`): the fallback spaces, which never fill;
- **a number**, the same at every player count;
- **tiers by player count**, keyed by the smallest player count of each tier. `{ 3: 2, 5: 3 }`, written "2/3" below, means two slots with three or four players and three with five or six. More tiers may be added.

## Worker permissions

Scientists and Igors may take every action, with two exceptions: **Garrison the watch** is for Igors only, and **Prepare resurrection** is for Scientists only.

## Day actions

| ID | Name | Location | Capacity | Effect |
|---|---|---|---:|---|
| medicine | Practise medicine | Hospital | unlimited | Gain 3 money. Medical Expertise adds +1 per effective copy. |
| research | Conduct research | University | 2/3 | Pay 2. Take one eligible research card from the market and publish it (spec 023). |
| specimens | Buy specimens | Anatomical supplier | 2/3 | Pay 2. Choose any one body part by named variant. |
| charity | Donate to charity | Town hall | 2/3 | Pay 3. Suspicion −2, minimum 0. Only legal while suspicion is above 0. |
| hire | Hire an Igor | Tavern | 2/3 | Pay 4. Gain one Igor, who can act at once. At most three Igors per player, counting the starting one. |
| garrison | Garrison the watch | Watch house | 2/3 | Igors only. No cost and no immediate effect. Lets the player subdue other players' monsters during this round's resolution (spec 025). |

## Night actions

| ID | Name | Location | Capacity | Effect |
|---|---|---|---:|---|
| assemble | Assemble body | Private laboratory | unlimited | Move any number of chosen loose parts, up to a whole body, into matching empty body slots. |
| prepare | Prepare resurrection | Private laboratory | unlimited | Scientists only. The player will attempt a resurrection in this round's resolution (spec 025). |
| sell | Sell parts | Back alley | 2/3 | Discard exactly 2 chosen loose parts. Gain 3 money. Discovery roll: d6, 1–2 → +1 suspicion. |
| experiment | Conduct experiments | Private laboratory | 2/3 | Discard 1 to 3 chosen installed parts and draw that many research cards; keep one (spec 023). Discovery roll: d6, 1–3 → +1 suspicion. |
| graves | Rob graves | Graveyard | 2/3 | Gain 2 random loose parts. Discovery roll: d6, 1–4 → +1 suspicion. |
| rest | Rest | Home | 1 | The player goes first next round (spec 021). |

## Discovery rolls

Every action that can raise suspicion does so through a configurable discovery roll: a die size and an ordered list of bands, each with a highest roll and a suspicion amount. The first band whose highest roll is at least the result applies; a result above every band adds nothing. So a sweep can vary the chance and the size of a discovery independently. A flat increase is one band covering every face.

The suspicion from the roll is reduced by 1 for each effective copy of Discreet Methods the acting player has, to a minimum of 0. The roll, the base suspicion, the reduction and the final increase are all logged, and any increase checks the mob threshold immediately (spec 020).

## Details

**Graves.** The random parts are drawn first, then the discovery die is rolled (spec 024 covers random draws).

**Sell.** The player chooses which loose parts to sell. Installed parts can't be sold. The parts are discarded, the money is paid, and then the discovery die is rolled.

**Experiment.** The player discards installed parts of their choice, at least one and at most the configured maximum or the cards left in the research deck; their slots become empty. They draw one card from the top of the research deck per part discarded, then the discovery die is rolled. If any drawn card is of a type the player has not personally discovered, they keep one of those with `PICK_RESEARCH` (spec 011), as a separate decision before play moves on. It is never published (spec 023). The other cards go to the bottom of the deck in the order drawn; if none is eligible, all go there. Drawn, kept and returned cards are public. If the discovery die brings the mob, the game ends before the pick. The action is unavailable with no installed part or an empty deck.

**Research.** The card must be in the face-up market, of a type the player has not personally discovered; otherwise the action is unavailable.

**Specimens.** Any exact variant, at the same price. Supply is unlimited.

**Assemble.** Each chosen part must fill a distinct empty slot of its own type, and at least one part must be placed. **Ruling:** there is no limit on parts per action, so a player can build a whole body in one action. Parts fill slots in order: first arm slot, then second arm slot, and so on.

**Hire.** **Ruling:** a hired Igor can act immediately, later the same day or that night, so actions can be chained within a round. An Igor may itself hire another Igor.

**Prepare.** The body need not be complete when the Scientist is placed, only when the attempt resolves (spec 025). Preparing is public and binding.

**Garrison.** The Igor stays counted until dawn clears occupancy, so it covers that round's resolution. It is needed to subdue another player's monster, not one's own (spec 025).

There is no direct trading between players in this version.
