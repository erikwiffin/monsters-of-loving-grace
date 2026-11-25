# 022 — Action spaces

Each action space has a phase, a capacity per phase, an Igor permission and an effect. Scientists may take any action; Igors only those marked "Igor: yes". An action may only be chosen if its full cost and every prerequisite can be met. Balances never go negative. All numbers below are default configuration values (spec 010).

## Day actions

| ID | Location | Capacity | Igor | Effect |
|---|---|---:|---|---|
| medicine | Hospital | 2 | Yes | Gain 3 money, whichever worker is placed. Medical Expertise adds +1 per effective copy. |
| research | University | 2 | No | Pay 2. Take one eligible research card from the market. |
| specimens | Anatomical supplier | 2 | Yes | Pay 2. Choose any one body part by named variant. |
| hire | Tavern | Unlimited | No | Pay the player's next Igor cost (4, then 7; at most three Igors, counting the starting one). The Igor can act at once. |
| charity | Town hall | Unlimited | Yes | Pay 3. Suspicion −2, minimum 0. Only legal while suspicion is above 0. |
| lecture | Scientific society | 2 | No | Gain 1, plus 1 for each discovery this player has published. No cap. |
| garrison | Watch house | 2 | Igor only | No cost and no immediate effect. Lets the player subdue other players' monsters during this round's resolution (spec 025). |

**Ruling (lecture):** the original v0.3 document both said lecture counts "personally discovered research types" and that it "counts public discoveries only". The designer ruled that lecture counts the discoveries *this player has personally published*. Types other players have published, and unpublished discoveries, do not count. **Ruling:** the former cap of 4 is removed.

**Publishing** is not an action space. It is a free action taken on the player's own turn (spec 023).

**Garrison.** Only Igors may take this space; Scientists may not. An Igor placed here stays counted until dawn clears occupancy, so it covers that round's resurrection resolution. A player needs a garrisoned Igor to subdue another player's monster, but not their own (spec 025).

## Night actions

| ID | Location | Capacity | Igor | Effect |
|---|---|---:|---|---|
| graves | Graveyard | 2 | Yes | Gain 2 random loose parts. Roll d6: 1–4 → +1 suspicion; 5–6 → none. |
| morgue | Morgue | 1 | Yes | Draw 3 random parts and keep 1 of them. Roll d6: 1–2 → +2 suspicion; 3–4 → +1; 5–6 → none. |
| assemble | Private laboratory | Unlimited | Yes | Move 1 chosen loose part into a matching empty body slot. Advanced Anatomy adds +1 per effective copy. |
| experiment | Private laboratory | Unlimited | No | Spend any 2 chosen loose parts. Take one eligible market research card free. |

## Details

**Graves and morgue.** The random parts are drawn first, then the discovery die is rolled (spec 024 covers random draws). The suspicion from the die is reduced by 1 for each effective copy of Discreet Methods the acting player has, to a minimum of 0. The roll, the base suspicion, the reduction and the final increase are all logged, and any increase checks the mob threshold immediately (spec 020).

**Morgue.** After the draw and the discovery die, the acting player chooses which drawn part to keep with `PICK_PARTS` (spec 011), as a separate decision before play moves on. The other two are discarded. The drawn, kept and discarded parts are all public. If the discovery die brings the mob, the game ends before the pick.

**Research and experiment.** Both use identical card selection rules (spec 023): the card must be in the face-up market, and the player must not have personally discovered its type. If no eligible card is in the market, the action is unavailable. Experiment may spend any two loose parts, including parts that would fit empty slots.

**Specimens.** These let a player pick an exact variant, at the same price whatever the part is. Supply is unlimited.

**Assemble.** Each chosen part must fill a distinct empty slot of its own type, and at least one part must be placed. Parts fill slots in order: first arm slot, then second arm slot, and so on.

**Hire.** The new Igor's cost depends on how many Igors the player has already hired; the starting Igor is free and does not count towards the cost. **Ruling:** a hired Igor can act immediately, later the same day or that night, so actions can be chained within a round.

There is no direct trading between players in this version.
