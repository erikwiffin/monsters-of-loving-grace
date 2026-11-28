# Balance experiments

Experimental configuration overrides and experiment scripts. Nothing here is a
default or a spec.

Run a candidate configuration (JSON overrides) with:

```
node bin/balance.mjs 400 base path/to/candidate.json
node bin/simulate.mjs --players 4 --config path/to/candidate.json
```

`bin/balance.mjs` plays every player count under `heuristic` and
`cautious,bold`, averages the two, and compares each objective's win rate and
the no-winner share against the fair share 1/(N+1).

Earlier experiments (a research catalogue candidate, tuned heuristic weights,
and their results) were measured under rules that no longer exist: publishing,
stacking published copies, discovery rolls, assembly and control attempts.
They are in the git history. Tuned weights would have to be searched again
(`bin/tune.mjs`) for the current heuristic.

## Baseline under the current rules

Standard heuristic and cautious/bold, 200 games per player count and policy
set (`node bin/balance.mjs 200 base`), win rate per player dealt the role:

| Players | Fair | Prometheus | Visionary | Inquisitor | Unleasher | No winner | Median rounds |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 3 | .25 | .07 | – | .23 | .47 | .02 | 12 |
| 4 | .20 | .10 | .03 | .04 | .71 | .08 | 8 |
| 5 | .17 | .06 | .01 | .02 | .64 | .06 | 8 |
| 6 | .14 | .03 | .02 | .00 | .82 | .02 | 7.5 |

About a fifth of games (329 of 1,600) stopped as hoarding, nearly all an
Inquisitor holding more than 25 parts from robbing graves.

The Unleasher dominates. In 150 five-player games, 89% of unleashed monsters
were the Unleasher's own: a body built for Vitality with harmful brains.
Rivals did garrison (about two Igors a round) and usually got two or three
tries, but a control roll is d20 against 20 without control science, 5% a
try. Lowering the control threshold is the obvious lever (150 games per
count and policy set):

| Control threshold | 3p unl | 4p unl | 5p unl | 6p unl | RMS from fair |
|---:|---:|---:|---:|---:|---:|
| 20 (default) | .47 | .71 | .64 | .82 | .261 |
| 15 | .31 | .47 | .41 | .58 | .170 |
| 12 | .26 | .34 | .25 | .41 | .123 |

Even at 12 the Visionary and the Inquisitor (at four or more players) rarely
win. The Inquisitor is held back by vespers: free, unlimited suspicion relief
for every spare worker.

# Behaviour-tree Prometheus

An alternative policy architecture: `src/sim/bt.js` is a small behaviour-tree
library (selector, sequence, condition, action, guard), and
`src/sim/bt-prometheus.js` a tree that plays the Prometheus objective (it
defers to the heuristic for any other objective). It is not one of the
built-in policies of spec 014. It plans bodies with the shared planner in
`src/sim/body-plan.js`.

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
