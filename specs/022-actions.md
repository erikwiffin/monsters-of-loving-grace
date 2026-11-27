# 022 — Action spaces

Each action space has a phase, a capacity, a worker permission and an effect. An action needs its full cost and every prerequisite; balances never go negative. All numbers are default configuration values (spec 010), a baseline for tuning by sweeps (spec 016).

## Design principle: night mirrors day

Day is legitimate; night is free but risky (spec 021). Most night actions mirror a day action: they reach a similar outcome with a similar expected value, but higher variance, paid for in random results and discovery rolls rather than money. Graves mirrors specimens (random parts, free, versus a chosen type bought), sell mirrors medicine (money), and experiment mirrors research (a card). Where a night action costs an input the day action doesn't, such as parts, its output is larger to compensate. Sweeps (spec 016) should keep an Igor's night work worth about as much as its day work.

## Capacity

A capacity is unlimited (`null`, the fallback spaces), a number, or tiers keyed by the smallest player count of each tier: `{ 3: 2, 5: 3 }`, written "2/3" below, means two slots with three or four players and three with five or six. More tiers may be added.

## Worker permissions

Scientists and Igors may take every action, with two exceptions: **Garrison the watch** is for Igors only, and **Prepare resurrection** is for Scientists only.

## Day actions

| ID | Name | Location | Capacity | Effect |
|---|---|---|---:|---|
| medicine | Practise medicine | Hospital | unlimited | Gain 3 money. Medical Expertise adds +1 per effective copy. |
| research | Conduct research | University | 2/3 | Pay 2. Take a market card of a type you haven't discovered, and publish it (spec 023). |
| specimens | Buy specimens | Anatomical supplier | 2/3 | Pay 2. Choose a part type; its variant is random. |
| charity | Donate to charity | Town hall | 2/3 | Buy 1 unit: pay 3, suspicion −2 (more with Parish Benefactor), minimum 0. Only legal while suspicion is above 0. |
| hire | Hire an Igor | Tavern | 2/3 | Pay 4. Gain one Igor, who can act at once. At most three Igors per player, counting the starting one. |
| garrison | Garrison the watch | Watch house | 3 | Igors only. No cost or immediate effect. Lets the player subdue other players' monsters this round (spec 025). |

## Night actions

| ID | Name | Location | Capacity | Effect |
|---|---|---|---:|---|
| assemble | Assemble body | Private laboratory | unlimited | Move any number of chosen loose parts, up to a whole body, into matching empty body slots. |
| prepare | Prepare resurrection | Private laboratory | unlimited | Scientists only. The player will attempt a resurrection in this round's resolution (spec 025). |
| sell | Sell parts | Back alley | 2/3 | Discard exactly 2 chosen loose parts. Gain 7 money. Discovery roll: d6, 1–2 → +1 suspicion. |
| experiment | Conduct experiments | Private laboratory | 2/3 | Discard 1 to 3 chosen parts, loose or installed, and draw that many research cards; keep one (spec 023). Discovery roll: d6, 1–3 → +1 suspicion. |
| graves | Rob graves | Graveyard | 2/3 | Gain 2 random loose parts. Discovery roll: d6, 1–4 → +1 suspicion. |
| rest | Rest | Home | 1 | The player goes first next round (spec 021). |

## Discovery rolls

Every action that can raise suspicion uses a configurable discovery roll: a die size and an ordered list of bands, each with a highest roll and a suspicion amount. The first band whose highest roll is at least the result applies; a higher result adds nothing. A flat increase is one band covering every face.

Each effective copy of Discreet Methods adds 1 to the result before the band is found, so a discovery is less likely; copies stack without limit, and a result above every band adds nothing. **Ruling:** this replaces the earlier rule, under which each copy took 1 off the suspicion a discovery adds: published copies stack, so that rule made night actions free of suspicion for the whole table once the card was out, and closed off the Inquisitor's route to the mob. The roll, the bonus, the result and every adjustment are logged, and any increase checks the mob threshold immediately (spec 020).

## Details

**Graves.** The random parts are drawn first (spec 024), then the discovery die is rolled.

**Sell.** Only loose parts can be sold. Sell pays more than medicine because it costs parts. The parts are discarded and the money paid, then the discovery die is rolled.

**Experiment.** The player discards 1 or more parts, loose or installed, at most the configured maximum or the cards left in the deck; discarded installed parts empty their slots. They draw a card from the top of the research deck per part, then the discovery die is rolled. If any drawn card is of a type they have not personally discovered, they keep one with `PICK_RESEARCH` (spec 011) before play moves on; it is never published (spec 023). The other cards go to the bottom of the deck in the order drawn. All these cards are public. If the roll brings the mob, the game ends before the pick. The action needs a part and a non-empty deck.

**Assemble.** Each chosen part fills a distinct empty slot of its type, in slot order; at least one is placed. **Ruling:** there is no limit on parts per action, so a whole body can be built at once.

**Charity.** An action buys 1 to a configured maximum of units, default 1, each at the configured price and reduction; never more than the player can afford or than it takes to reach 0. With a maximum above 1, the player chooses `units` (spec 011).

**Hire.** **Ruling:** a hired Igor can act immediately, the same day or that night. An Igor may hire another Igor.

**Prepare.** The body need not be complete when the Scientist is placed, only when the attempt resolves (spec 025). Preparing is public and binding.

**Garrison.** The Igor stays counted until dawn, covering that round's resolution. It is needed to subdue another player's monster, not one's own (spec 025).

There is no direct trading between players.
