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

# Behaviour-tree Prometheus

An alternative policy architecture: `src/sim/bt.js` is a small behaviour-tree
library (selector, sequence, condition, action, guard), and
`src/sim/bt-prometheus.js` a tree that plays the Prometheus objective (it
defers to the heuristic for any other objective). It is not one of the
built-in policies of spec 014.

`experiments/bt-prometheus.mjs` gives the first seat dealt Prometheus the
policy under test and the heuristic to every other seat, and reports that
seat's win rate per player count, how the games it lost ended, and the odds of
its attempts. `experiments/bt-trace.mjs` prints one such game, decision by
decision.

```
node experiments/bt-prometheus.mjs --games 500
node experiments/bt-prometheus.mjs --games 500 --policy heuristic   # baseline
node experiments/bt-prometheus.mjs --games 100 --params '{"attemptMinStable":0.2}'
node experiments/bt-trace.mjs 5 12
```

Win rate of that one Prometheus seat, 500 games per player count, seeds
`btp-N-i`, 60-round budget:

| Players | Heuristic | BT |
|---:|---:|---:|
| 3 | 33.2% | 52.6% |
| 4 | 41.0% | 62.4% |
| 5 | 16.8% | 43.2% |
| 6 | 17.2% | 39.6% |

The ideas that mattered, roughly in order: planning the body from installed
and loose parts together, and discarding installed parts the plan replaces by
experiment; keeping every worker busy; buying research and specimens on one
value scale; taking Discreet Methods early, which makes graves, selling and
experiments free of suspicion and nearly removes the mob; and taking capped
spaces before unlimited ones. Threshold tuning moves the results by less
than the noise of a 100-game batch.

What is left is mostly outside one player's control. Rival Prometheus wins
start around round 8, a Visionary alone, or two Creatures in one round, end
another 10–15% of games, and at three players an Unleasher's monster escapes
the two remaining hunters about a quarter of the time. An unmodified body
stabilizes 0.25% of the time, and Humanity has few sources (four copies of
Moral Philosophy, each published copy helping every player equally), so no
policy can count on winning before round 6, which a 90% win rate would need.

## Best response, after the heuristic's repairs (main #8 and this branch)

`node bin/best-response.mjs --games 300`: one seat of each role plays the
challenger, everyone else the standard heuristic; same seeds for both.
Win rate of that seat:

| Role | Challenger | Standard | Challenger | Gap (95%) | 3p | 4p | 5p | 6p |
|---|---|---:|---:|---|---|---|---|---|
| Prometheus | tuned weights | 34.5% | 41.1% | +6.6 [2.7, 10.5] | 42.7→40.3 | 49.0→52.3 | 22.0→33.0 | 24.3→38.7 |
| Prometheus | behaviour tree | 34.5% | 39.4% | +4.9 [1.1, 8.8] | 42.7→43.3 | 49.0→45.7 | 22.0→34.3 | 24.3→34.3 |
| Visionary | tuned weights | 12.4% | 14.6% | +2.2 [−1.3, 5.6] | | 9.6→15.2 | 14.5→14.5 | 13.0→14.1 |
| Inquisitor | tuned weights | 11.4% | 11.0% | −0.4 [−3.3, 2.4] | 2.7→1.4 | 0.8→1.7 | 25.2→24.0 | 15.7→15.7 |
| Unleasher | tuned weights | 12.2% | 12.0% | −0.2 [−3.0, 2.6] | 39.1→36.9 | 8.2→7.8 | 4.8→4.4 | 1.3→3.0 |

- The standard heuristic under-plays Prometheus at five and six players by
  10–15 points, and two different challengers agree. Prometheus balance
  numbers at those counts measure the AI as much as the rules.
- The repaired heuristic has caught up with the behaviour tree at three and
  four players; the tree's lead is now only at five and six.
- Tuning found nothing measurable for the other roles. Their searches (six
  generations of ten candidates, 160 games each, at four and five players)
  are too noisy for roles that win 5–15% of the time: they need more games
  per candidate, or tuning at the counts where the role wins most.
- The tuned Prometheus never garrisons (`garrisonAlert` 8, above a whole
  body) and values preparing higher. Worth checking whether garrisoning is
  worth its Igor for a Prometheus at all.
