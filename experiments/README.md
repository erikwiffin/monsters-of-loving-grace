# Research balance experiments

Experimental configuration overrides. Nothing here is a default or a spec;
the engine supports the effect kinds used, but they are inert unless a
config file turns them on.

Run a candidate with:

```
node bin/balance.mjs 400 base experiments/research-candidate.json
node bin/simulate.mjs --players 4 --config experiments/research-candidate.json
```

`bin/balance.mjs` plays every player count under `heuristic` and
`cautious,bold`, averages the two, and compares each objective's win rate and
the no-winner share against the fair share 1/(N+1).

## Design rule: stacking is a player-count lever

Published copies stack, and more players means more publications. A stacking
card therefore gets stronger as the table grows, and a one-off card (`stacks:
false`) stays flat. To tilt a role across player counts, pair a flat card with
a stacking counter:

- Control (Mesmerism, Restraint) became one-off and stronger per copy, so
  control no longer runs away at 5–6 players and kills the Unleasher.
- Transfusion's ferocity grows per rival able to hunt the monster, which
  directly offsets the larger hunting party at high counts.
- Public Lectures and Parish Benefactor stack, so they check the Inquisitor
  hardest where it is strongest (5–6 players).
- Lunar Society Correspondence rewards attempting in the same round as
  rivals, which feeds the Visionary more as the table grows.

## Candidate catalogue (`research-candidate.json`)

| Card | Kind | Copies | Effect |
|---|---|---:|---|
| Galvanic Mastery | stacks | 4 | Vitality +1d6 |
| Moral Philosophy | stacks | 4 | Humanity +3 (was +5) |
| Medical Expertise | stacks | 4 | Medicine +1 money |
| Discreet Methods | stacks | 4 | Discovery suspicion −1 |
| Neural Conditioning | stacks | 4 | +1 control attempt |
| Mesmerism | one-off | 4 | Control +1d10 (was 1d6, stacking) |
| Restraining Apparatus | one-off | 4 | Control +8 (was +4, stacking) |
| Transfusion of Animal Blood | stacks | 2 | Vitality +1d6; your monsters are 2 harder to subdue per rival able to subdue them, beyond the first |
| Public Lectures | stacks | 4 | When you conduct research, suspicion −1 |
| Parish Benefactor | stacks | 4 | Your charity removes 1 more suspicion per unit |
| Lunar Society Correspondence | stacks | 3 | Humanity +1d8 per rival attempting a resurrection this round |
| Bloodhounds | one-off | 1 | You may subdue rivals' monsters without a garrison |
| Arctic Pursuit | one-off, once per game | 1 | When a monster would be unleashed, one more control roll against it |

Tried and dropped: Lightning Rod (once per game, reroll a failed Vitality:
little effect), Inflammatory Pamphlets (your noticed discoveries add +1:
far too strong once published, Inquisitor ~0.5 everywhere).

Copy counts follow spec 023: weak stackable modifiers four, rule-bending
abilities singletons, two or three in between. With these counts the
catalogue scores RMS 0.078 at 240 games per count (3p .30/–/.15/.44/.11,
4p .24/.16/.10/.26/.20, 5p .14/.16/.30/.15/.14, 6p .12/.14/.24/.13/.14).
Making Arctic Pursuit fire every time instead of once stalled about 100
games in 3,840 and was rejected.

## Results before copy counts were scaled (400 games per count, both policy sets)

| | 3p | 4p | 5p | 6p |
|---|---|---|---|---|
| Fair share | 0.25 | 0.20 | 0.17 | 0.14 |
| **Default** pro/vis/inq/unl/none | .33/–/.18/.39/.07 | .36/.11/.11/.09/.16 | .20/.12/.34/.02/.11 | .16/.11/.32/.01/.08 |
| **Candidate** pro/vis/inq/unl/none | .29/–/.19/.42/.10 | .23/.17/.10/.26/.21 | .13/.15/.30/.21/.14 | .10/.13/.22/.21/.17 |

RMS distance from fair: 0.109 → 0.075. Median game length rises by about
one round (7 → 8), and resurrection attempts per game rise from 1–1.8 to
1.4–2.7 (more monsters, more subduing).

Still open: the 3-player Unleasher (≈0.4), the Inquisitor's tilt (low at
4, high at 5), and the 3-player no-winner share (≈0.1 vs 0.25).
