# 022 — Action spaces

Each action space has a phase, a capacity, a worker permission and an effect. An action needs its full cost and every prerequisite; balances never go negative. All numbers are default configuration values (spec 010), a baseline for tuning by sweeps (spec 016).

## Design principle: day is steady, night is risky

- **Day actions** generally cost money and never raise suspicion. They have a medium expected value with low variance: the player chooses what they get, from cards they can see or a few they draw.
- **Night actions** are generally free but raise suspicion by exactly 1. They have a slightly higher expected value and a much higher variance: the player takes what the decks give them, sight unseen.

Night mirrors day: rob graves mirrors buy specimens (random parts versus a chosen one), sell mirrors medicine (money), and experiment mirrors research (science cards). A night action that costs parts gives more to compensate. Sweeps (spec 016) should keep an Igor's night work worth about as much as its day work.

**No dice before resolution.** Nothing in the day or night uses dice. The only randomness before resolution is the order of the shuffled decks. The game builds to one Humanity roll per attempt, and the control rolls that answer a monster (spec 025).

## Capacity

A capacity is unlimited (`null`), a number, or tiers keyed by the smallest player count of each tier: `{ 3: 2, 5: 3 }`, written "2/3" below, means two slots with three or four players and three with five or six.

## Worker permissions

Scientists and Igors may take every action, with two exceptions: **Garrison the watch** is for Igors only, and **Prepare resurrection** is for Scientists only.

## Day actions

| ID | Name | Location | Capacity | Effect |
|---|---|---|---:|---|
| medicine | Practice medicine | Hospital | unlimited | Gain 3 money, +1 per Medical Expertise card held. |
| research | Conduct research | University | 2/3 | Pay 2. Take any science card from the market (spec 023). |
| specimens | Buy specimens | Anatomical supplier | 2/3 | Pay 2. Draw 3 body parts and keep one (spec 024). |
| charity | Donate to charity | Town hall | 2/3 | Buy 1 unit: pay 3, suspicion −2 (more with Parish Benefactor), minimum 0. Only legal while suspicion is above 0. |
| hire | Hire an Igor | Tavern | 2/3 | Pay 4. Gain one Igor, who can act at once. At most three Igors per player, counting the starting one. |
| garrison | Garrison the watch | Watch house | 3 | Igors only. No cost or immediate effect. Lets the player try to subdue monsters this round (spec 025). |

## Night actions

| ID | Name | Location | Capacity | Effect |
|---|---|---|---:|---|
| prepare | Prepare resurrection | Private laboratory | unlimited | Scientists only. Lay out a full set of body parts with Vitality at least the threshold; attempt a resurrection in this round's resolution (spec 025). |
| sell | Sell parts | Back alley | 2/3 | Discard exactly 2 chosen body parts. Gain 7 money. Suspicion +1. |
| experiment | Conduct experiments | Private laboratory | 2/3 | Discard exactly 2 chosen body parts. Draw 2 science cards from the deck and keep both. Suspicion +1. |
| graves | Rob graves | Graveyard | 2/3 | Draw 2 body parts. Suspicion +1. |
| vespers | Attend vespers | Chapel | unlimited | Suspicion −1, minimum 0. Only legal while suspicion is above 0. |
| rest | Rest | Home | 1 | The player goes first next round (spec 021). |

## Suspicion from actions

A night action that raises suspicion has a configured `suspicion` amount, a non-negative integer, default 1. It is added after the action's other effects, it is logged and attributed to the player, and it checks the mob threshold at once (spec 020).

## Details

**Specimens.** The player draws up to 3 cards from the body-part deck (spec 024), all public, and must keep one with `PICK_PART` (spec 011) before play moves on. The others are discarded. The action needs at least one card in the deck or the discard pile.

**Graves.** The player draws up to 2 cards from the body-part deck into their hand, then suspicion rises. The action needs at least one card in the deck or the discard pile.

**Sell.** Only parts in hand can be sold. Sell pays more than medicine because it costs parts. The parts are discarded and the money is paid, then suspicion rises.

**Experiment.** The player discards exactly 2 parts from their hand, then draws 2 cards from the top of the science deck, or as many as remain, and keeps them all (spec 023). These cards are public. Then suspicion rises. The action needs 2 parts in hand and a non-empty science deck.

**Charity.** An action buys 1 to a configured maximum of units, default 1, each at the configured price and reduction; never more than the player can afford or than it takes to reach 0. With a maximum above 1, the player chooses `units` (spec 011).

**Vespers.** A low-value fallback: free, unlimited, and open to any worker. Parish Benefactor does not affect it.

**Hire.** **Ruling:** a hired Igor can act at once, by day or that night, and may itself hire.

**Prepare.** The player chooses six parts from their hand: two arms, two legs, a chest and a head. Their Vitality total, plus the player's Vitality science, must be at least the threshold when the Scientist is placed (spec 025). The parts leave the hand at once for the player's body slots, where they can't be changed. Preparing is public and binding.

**Garrison.** The Igor stays counted until dawn, covering that round's resolution (spec 025).

There is no trading between players.
