# 020 — Setup, objectives, suspicion and game end

Each player is a scientist competing to create life or to fulfil a secret ambition. The game supports 3–6 players, with 5 as the default.

## Setup

- Each player starts with 3 money, one Scientist, one Igor, 3 control attempts (spec 025), no loose or installed body parts, no research and no Creature.
- Village suspicion starts at 0.
- The starting player is chosen at random.

The objective deck has N+1 cards for N players: one Inquisitor, one Unleasher, one Visionary, and Prometheus cards for the rest. For five players that is 3/1/1/1, six cards in all; for six, 4/1/1/1. **Ruling:** the Visionary is only a viable role with four or more players, so the three-player deck has no Visionary: two Prometheus, one Inquisitor and one Unleasher. The deck is shuffled, and each player is dealt one card face down. The remaining card stays unseen until the game ends.

Objectives are secret. Each player sees only their own objective, through a pass-the-device privacy screen, and no other player's objective or the unseen card is shown until game over. The public rules explain every possible role. Objectives are not public character classes, and no player has special actions because of their objective. The Inquisitor uses the same legal actions as everyone else.

## Objectives

| Objective | Wins when |
|---|---|
| Prometheus | The player's Creature is the *only* Creature that became stable that round. Checked at dawn, provided the mob has not formed. |
| Visionary | At least two distinct Creatures became stable in the same round, whoever created them. Checked at dawn. |
| Inquisitor | Suspicion reaches the mob threshold before the game ends. |
| Unleasher | Any monster is unleashed because its Humanity fails and no player subdues it, whoever created it (spec 025). |

## Catastrophes

Two catastrophes end the game immediately, in whatever phase they happen. No further actions, rolls or resurrection attempts are resolved after them.

- **The mob.** When suspicion reaches the mob threshold, the villagers form a mob and arrest every scientist. The Inquisitor wins if that card was dealt to a player.
- **An unleashed monster.** The Unleasher wins if that card was dealt to a player.

**Ruling:** if the mob forms while a monster awaits subduing, the mob cannot stop it. The monster is unleashed instead, and the game ends as an unleashing, not a mob.

In either case every other player loses, including anyone who already stabilized a Creature that round. If the matching antagonist is the unseen card, or otherwise not dealt, everyone loses together. Neither antagonist wins from the other's catastrophe.

## Dawn victories

If no catastrophe has occurred, Prometheus and Visionary are checked together at dawn, after all of the round's resurrections.

**A stable Creature always ends the game.** At the dawn of any round in which one or more Creatures became stable, the game ends. The rest of that round's resurrections still resolve first, so a second Creature can stabilize in the same round. Then:

- **Exactly one Creature became stable.** If its owner is a Prometheus, that player wins alone. If its owner holds any other objective, everyone loses.
- **Two or more Creatures became stable.** The Visionary wins if that card was dealt to a player; otherwise everyone loses. No Prometheus wins, even one who stabilized a Creature that round. For example, two Prometheus players stabilizing in the same round both lose.

If no Creature became stable, the game continues into the next round. Because a Prometheus win needs exactly one stable Creature and a Visionary win needs at least two, at most one player wins at dawn. Stable Creatures never act in the game.

When the game ends for any reason, every objective, including the unseen card, is revealed.

## Suspicion

**Ruling:** the mob threshold shrinks as the table grows: 10 with three or four players, 9 with five, and 8 with six. Suspicion is one shared integer meter from 0 to that threshold, starting at 0. It is shown as a plain meter, with its current and maximum values and no named or visually distinct bands. Every change is public, attributed to the responsible player and reason, logged, and clamped between 0 and the threshold. Every increase immediately checks the mob threshold.

Only five things raise suspicion:

- discovered grave robbing (graves action);
- discovered morgue theft (morgue action);
- a failed resurrection, meaning a failed Vitality roll (+1);
- subduing a monster (+1 per subdue);
- declining to subdue a monster when able to (+2 per player who declines).

**Ruling:** a stable Creature adds no suspicion. A subdue destroys the monster before its +1 is added, so a mob formed by a subdue is an ordinary mob, won by the Inquisitor (spec 025).

Only charity lowers it (−2). Specs 022 and 025 give the details. Suspicion never rises automatically, at dawn or over time, and dawn does not change it.

There is no individual suspicion per player in this version.

## No forced ending

There is no round cap and no in-game timeout. If players avoid both risk and resurrection, a game may continue indefinitely. External simulation tools may stop runaway games, but must report them as truncated, never as a result (spec 014).
