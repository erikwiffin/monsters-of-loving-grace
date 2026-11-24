# 020 — Setup, objectives, suspicion and game end

Each player is a scientist competing to create life or to fulfil a secret ambition. The game supports 3–5 players, with 5 as the default.

## Setup

- Each player starts with 3 money, one Scientist, no Igors, no loose or installed body parts, no research and no Creature.
- Village suspicion starts at 0.
- The starting player is chosen at random.

The objective deck has N+1 cards for N players: N−2 Prometheus cards, plus one each of Visionary, Inquisitor and Unleasher. For five players that is 3/1/1/1, six cards in all. The deck is shuffled, and each player is dealt one card face down. The remaining card stays unseen until the game ends.

Objectives are secret. Each player sees only their own objective, through a pass-the-device privacy screen, and no other player's objective or the unseen card is shown until game over. The public rules explain every possible role. Objectives are not public character classes, and no player has special actions because of their objective. The Inquisitor uses the same legal actions as everyone else.

## Objectives

| Objective | Wins when |
|---|---|
| Prometheus | The player owns a Creature that newly became stable during the current round. Checked at dawn, provided the mob has not formed. |
| Visionary | At least two distinct Creatures became stable in the same round, whoever created them. Checked at dawn. |
| Inquisitor | Suspicion reaches the mob threshold before the game ends. |
| Unleasher | Any living Creature is unleashed because both Control and Humanity fail, whoever created it. |

## Catastrophes

Two catastrophes end the game immediately, in whatever phase they happen. No further actions, rolls or resurrection attempts are resolved after them.

- **The mob.** When suspicion reaches the threshold (16), the villagers form a mob and arrest every scientist. The Inquisitor wins if that card was dealt to a player.
- **An unleashed Creature.** The Unleasher wins if that card was dealt to a player.

In either case every other player loses, including anyone who already stabilized a Creature that round. If the matching antagonist is the unseen card, or otherwise not dealt, everyone loses together. Neither antagonist wins from the other's catastrophe.

## Dawn victories

If no catastrophe has occurred, Prometheus and Visionary are checked together at dawn, after all of the round's resurrections. Several players may win together, for example two Prometheus players, or a Prometheus player and the Visionary. A stable Creature made by a non-Prometheus player does not permanently spoil Prometheus: a Prometheus player can still win by stabilizing their own Creature in a later round.

When the game ends for any reason, every objective, including the unseen card, is revealed.

## Suspicion

Suspicion is one shared integer meter from 0 to 16, starting at 0. It is shown as a plain meter, with its current and maximum values and no named or visually distinct bands. Every change is public, attributed to the responsible player and reason, logged, and clamped to 0–16. Every increase immediately checks the mob threshold.

Only three things raise suspicion:

- discovered grave robbing (graves action);
- discovered morgue theft (morgue action);
- a failed resurrection, meaning a failed Vitality roll.

Only two things lower it: charity (−2) and covering tracks (−1). Specs 022 and 025 give the details. Suspicion never rises automatically, at dawn or over time, and dawn does not change it.

There is no individual suspicion per player in this version.

## No forced ending

There is no round cap and no in-game timeout. If players avoid both risk and resurrection, a game may continue indefinitely. External simulation tools may stop runaway games, but must report them as truncated, never as a result (spec 014).
