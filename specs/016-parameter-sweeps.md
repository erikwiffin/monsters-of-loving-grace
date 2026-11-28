# 016 — Parameter sweeps

The numbers on the action spaces (spec 022) are a baseline, not settled balance. Parameter sweeps search for better values by running many headless games (spec 014) at many configurations and scoring each one against design targets. Sweeps change only configuration; they never change rules, and every value they try is validated by the engine like any other override (spec 010).

## Sweep files

A sweep is described by a JSON file, run with `node bin/sweep.mjs <file>`. It names:

- **games**: the games played per point, per player count and per policy set;
- **players**: the player counts to test, normally 3, 4, 5 and 6;
- **policies**: one or more policy sets. A set is a policy name, or comma-separated names assigned to seats in order;
- **base**: configuration overrides applied to every point;
- **params**: the variables to sweep;
- **sampler**, **samples** and **seed**: how points are chosen (below);
- **targets**: overrides of the default design targets;
- **maxRounds**: the round budget, after which a game counts as truncated.

Sweep files live in `sweeps/`.

## Variables

A variable is named by a dotted path into the configuration, such as `actions.medicine.gain`, `actions.research.capacity.5` (the 5–6 player tier) or `partVariants.ordinary_arm.copies`. Paths may reach into arrays, so the dice in an effect list can be swept. Several paths joined with `|` share one value, so one variable can drive several numbers, for example the larger tier of every 2/3 space. A variable's values are a list, or an integer range with an optional step.

Each point's configuration is the full default configuration, then the sweep's base overrides, then the point's values. A path that does not exist, or a value the engine rejects, stops the sweep with an error before any game is played.

## Samplers

- **oat** (one at a time): the baseline, then each variable's values with every other variable at its baseline. Used first, to find which variables matter.
- **grid**: every combination. Practical for one to three variables.
- **random**: independent uniform draws of each variable.
- **lhs** (Latin hypercube): each variable's values spread evenly over the samples, then shuffled independently. Used to explore several variables together.

Sampling is seeded, so a sweep file always produces the same points.

## Fair comparison

Every point uses the same game seeds for a given player count, so differences between points come from the rules, not from luck. Batches run in parallel across CPU cores; the results do not depend on the number of threads.

## Policies

Sweeps rely on the heuristic policy (spec 014) deciding sensibly whatever the numbers are. The heuristic therefore values actions from the configuration in its view, in a common currency of money, rather than from fixed scores per action: what an action gives and costs, the suspicion it adds, and the worth of parts, science and workers to its objective. When a sweep changes a cost or a gain, the heuristic's valuation changes with it.

Two variants, **cautious** and **bold**, price suspicion and resurrection risk higher and lower than the standard heuristic. Running a point under several styles shows whether a value works only for one way of playing. Mixed sets, such as `heuristic,random`, are also allowed.

The values a sweep finds suit these policies, not necessarily human players. Sweeps narrow the range; human playtesting decides.

## Metrics and targets

Every batch reports the aggregate of spec 014, plus action-economy metrics: for each space, placements per round, the share of rounds in which it was used, the share in which it was full, and the share of placements made by Igors; the mean number of Igors and leftover money per player; win rate by seat in round 1's initiative order; and invalid commands.

Each batch is scored as a total penalty, where 0 means every target is met. The default targets are:

| Target | Default |
|---|---|
| Largest gap between objectives' win rates | 0.10 |
| Median ending round | 7 to 10 |
| Truncated games | none |
| Each capped space used in at least this share of rounds | 0.30 |
| No capped space full in more than this share of rounds | 0.85 |
| Fallback space (medicine) placements per round | at least 1 |
| Largest gap between seats' win rates | 0.10 |

The private space (prepare) has no usage target. The score lists the penalty for each missed target, so a reader can see why a point scored badly. Any invalid command adds a penalty large enough to rank the point last, and the sweep exits with an error.

## Output

The sweep prints the points ranked by mean penalty over player counts and policy sets, each with its three largest penalties. With `--out`, it also writes one JSON line per batch with the point, player count, policy set, score and aggregate, for further analysis.

## Process

1. **Sensitivity**: a one-at-a-time sweep around the baseline over every variable, to find those that move the metrics.
2. **Joint search**: a Latin hypercube over the variables that matter.
3. **Narrowing**: a grid or smaller hypercube around the best points.
4. **Confirmation**: large batches of the chosen values at every player count, under every policy style.

Chosen values become new defaults only with the designer's approval, and spec 022 is updated in the same commit.
