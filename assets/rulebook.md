<!-- rules-fingerprint: c00081f1 -->
<!-- This rulebook describes the physical game. It is maintained by hand (spec 032): every change to gameplay — the 02x specs or the default configuration — updates it in the same commit, together with the fingerprint above. `npm test` prints the new fingerprint when it is out of date. -->

![Monsters of Loving Grace logo: a stitched heart struck by lightning](logo.png)

# Monsters of Loving Grace — Rulebook

*A game of resurrection, suspicion and secret ambition for 3–6 players. Print-and-play prototype.*

Each of you is a scientist in a nervous village. By day you earn money and buy what you need honestly. By night you rob graves, sell parts in back alleys and experiment in your laboratory, and every risk you take makes the villagers more suspicious. Some of you want to create life. Others secretly want the village to rise up, or a monster to break loose.

## Components

The print view prints everything except the dice and money.

- **Rulebook** (this document).
- **Village board**: the suspicion track (0–10), and spaces for the research deck and the four-card market.
- **Action board**: one page with the 6 day spaces on the left and the 6 night spaces on the right. If a single space changes, reprint it and glue it over the old one.
- **6 player sheets**, one per colour, each with six body slots, a control-attempt track, the random body-part table and a summary of the rules.
- **7 objective cards**: 3 Prometheus, 1 Visionary, 1 Inquisitor, 2 Unleashers.
- **36 research cards**: 4 copies of each of 9 types.
- **Body part cards**: 13 named variants. The supply is meant to be unlimited; if a variant runs out, use any proxy.
- **Worker tiles**: per colour, 1 Scientist and 3 Igors.
- **Money (not printed)**: use coins, poker chips, or pencil and paper. Money is unlimited.
- **Markers**: suspicion, first player, and one control-attempt marker per colour.
- Everything prints single-sided. Use card stock or opaque sleeves so cards don't show through from the back.
- **Dice (not printed)**: at least one d20, two d4, four d6 and one d8. If you are short of a die, roll it again and add the results.

## Overview

The game is played in rounds. Each round has four phases:

1. **Day**: take turns placing workers on day action spaces.
2. **Night**: take turns placing workers on night action spaces.
3. **Resolution**: everyone who prepared a resurrection attempts it.
4. **Dawn**: check whether the game is over; otherwise pass initiative and begin a new round.

There is no last round. The game ends only when a Creature becomes stable, the mob forms, or a monster is unleashed.

Everything is public except the objective cards and the order of the research deck: money, parts, research, workers, control attempts and suspicion are all open for everyone to see. There is no trading between players.

## Setup

1. **Seats.** Sit in a circle. Each player takes a colour, its player sheet, its Scientist and 3 Igors, and its control-attempt marker.
2. **Starting resources.** Each player places their Scientist and **one** Igor in front of them, ready to work. The other two Igors stay beside the sheet until hired. Each player takes **3 money** and sets their control-attempt marker on **3**.
3. **The village.** Put the village board in the middle. Place the suspicion marker on **0**. Put the action board beside it. Sort the body part cards into a face-up supply by variant, and put the money beside it.
4. **Research.** Shuffle the 36 research cards into a face-down deck on the village board. Deal the top **4** face up into the market.
5. **Objectives.** Build the objective deck for your player count, shuffle it, and deal one card face down to each player. Look at your own card secretly. Set the remaining card aside, unseen and face down.

   | Players | Prometheus | Visionary | Inquisitor | Unleasher | Cards |
   |---|---:|---:|---:|---:|---:|
   | 3 | 2 | — | 1 | 1 | 4 |
   | 4 | 2 | 1 | 1 | 1 | 5 |
   | 5 | 3 | 1 | 1 | 1 | 6 |
   | 6 | 3 | 1 | 1 | 2 | 7 |

6. **First player.** Choose a first player at random and give them the first-player marker.

## Objectives

Your objective is secret. It gives you no special actions: everyone plays by the same rules, whatever they hold.

| Objective | You win when |
|---|---|
| **Prometheus** — *Create life.* | Your Creature is the **only** Creature that became stable this round. Checked at dawn. |
| **Visionary** — *Witness a new age.* | **Two or more** Creatures became stable in the same round, whoever made them. Checked at dawn. Not used with 3 players. |
| **Inquisitor** — *Expose the blasphemers.* | Suspicion reaches the mob threshold (10). |
| **Unleasher** — *Let the monster loose.* | Any monster is unleashed, whoever made it. With 6 players there are two Unleashers: they win together, though neither knows who the other is. |

At most one player can win, except that two Unleashers win together. If the role that matches the ending was not dealt to anyone, for example because it is the unseen card, everyone loses together.

## Workers

- **Scientist.** Acts once by day and once again by night. A Scientist may take any action except *Garrison the watch*.
- **Igor.** Acts **once per round**, by day or by night, but not both. An Igor used by day stays used at night; one left unused by day may work at night. An Igor may take any action except *Prepare resurrection*. Only Igors may garrison the watch.
- **Hiring.** Each player starts with one Igor and may hire more at the Tavern, up to **3 Igors** in all. A newly hired Igor can act straight away, the same day or that night. Igors have no wages.

## Day and night

Day and night are played the same way. Starting with the first player and going clockwise, the active player does one of two things:

- **Place a worker.** Put one of your unused workers on an action space it is allowed to use, pay the cost, and resolve the effect at once. Play passes to the next player.
- **Pass.** You take no more turns this phase. Passing is final for the phase. You may pass the day while keeping Igors back for the night.

A player who has no legal placement at the moment is simply skipped; they do not have to pass. If someone else's action later gives them a legal placement, they get a turn again. The phase ends when nobody who hasn't passed has a legal placement.

At the start of night, everyone who passed is back in, and the turn returns to the first player. Scientists are ready again.

### Capacity

Each action space shows a worker slot per capacity. Most spaces hold **2 workers with 3–4 players** and **3 with 5–6 players**; the dashed slot is used only with 5–6 players. *Garrison the watch* holds 3 at every player count. *Practice medicine*, *Assemble body* and *Prepare resurrection* have no limit. *Rest* holds one worker. Workers stay on their spaces until dawn, and which workers are where is public.

An action needs its full cost and every prerequisite. Money never goes below 0.

## Day actions

| Space | Location | Effect |
|---|---|---|
| **Practice medicine** | Hospital | Gain 3 money, plus 1 for each effective copy of Medical Expertise. |
| **Conduct research** | University | Pay 2. Take a market card of a type you have not discovered and **publish** it (see *Research*). Refill the market from the deck at once. Then suspicion −1 for each effective copy of Public Lectures. |
| **Buy specimens** | Anatomical supplier | Pay 2. Choose a type of body part: arm, leg, chest or head. Roll for its variant on the table on your player sheet and take that part from the supply. |
| **Donate to charity** | Town hall | Pay 3. Suspicion −2, and 1 more for each effective copy of Parish Benefactor, to a minimum of 0. Only allowed while suspicion is above 0. |
| **Hire an Igor** | Tavern | Pay 4. Take one of your reserve Igors; it can act at once. At most 3 Igors each. |
| **Garrison the watch** | Watch house | Igors only. No cost and no immediate effect. Until dawn, you may try to subdue other players' monsters (see *Control*). |

## Night actions

| Space | Location | Effect |
|---|---|---|
| **Assemble body** | Private laboratory | Move any number of your loose parts onto matching empty slots of your player sheet, at least one. |
| **Prepare resurrection** | Private laboratory | Scientists only. You will attempt a resurrection in this round's resolution. |
| **Sell parts** | Back alley | Discard exactly 2 of your loose parts and gain 7 money. Then make a discovery roll: d6, 1–2 → suspicion +1. |
| **Conduct experiments** | Private laboratory | Discard 1 to 3 of your parts, loose or installed, and draw that many research cards; keep one. Then make a discovery roll: d6, 1–3 → suspicion +1. |
| **Rob graves** | Graveyard | Draw 2 random body parts. Then make a discovery roll: d6, 1–4 → suspicion +1. |
| **Rest** | Home | You will go first next round. |

Night actions mirror day actions: graves for specimens, selling for medicine, experiments for research. They are free, but the results are random and the village may notice.

### Details

**Discovery rolls.** Roll the die shown on the space and add 1 for each effective copy of Discreet Methods you have. If the total is in the range shown, suspicion rises by 1. For example, with one copy, robbing graves is noticed only on a roll of 1–3. Any rise can form the mob at once.

**Rob graves.** Draw both random parts first (below), then make the discovery roll.

**Sell parts.** Only loose parts can be sold. Discard them and take the money first, then make the discovery roll.

**Conduct experiments.** You may discard no more parts than there are cards in the research deck, and you need at least one part and a non-empty deck. Discarding an installed part empties its slot. Draw one card from the top of the deck per part discarded and show them to everyone, then make the discovery roll. If the mob forms, the game ends at once. Otherwise, if any drawn card is a type you have not discovered, you must keep one such card. It is **not published** (see *Research*). Put the other cards on the bottom of the deck, in the order drawn.

**Assemble body.** Each part goes into an empty slot of its own type: arms into arm slots, legs into leg slots, the chest and the head into theirs. Installed parts can't be removed, swapped or taken back. The only way to empty a slot is to discard its part in an experiment.

**Prepare resurrection.** Preparing is public and binding. Your body does not have to be complete when you place your Scientist, only when your attempt resolves, so you may still assemble afterwards that night, for example with an Igor.

**Rest.** Only one player can rest each round.

## Body parts

A complete body has **two arms, two legs, one chest and one head**: one part in each of the six slots on your player sheet. Arms are interchangeable, and so are legs. You have one body under construction at a time. Loose parts can be kept for as long as you like, with no limit.

Each part may change the resurrection rolls:

| Type | Variant | Effect |
|---|---|---|
| Arm | Ordinary arm | None |
| Arm | Arm of a labourer | Vitality +1d4 |
| Arm | Damaged arm | Vitality −1d4 |
| Leg | Ordinary leg | None |
| Leg | Leg of an athlete | Vitality +1d6 |
| Leg | Frail leg | Vitality −2 |
| Chest | Ordinary chest | None |
| Chest | Robust chest | Vitality +1d8 |
| Chest | Scarred chest | Vitality −1d6 |
| Head | Ordinary head | None |
| Head | Brain of a criminal | Humanity threshold +3 |
| Head | Brain of a scholar | Humanity +1d6 |
| Head | Brain of a poet | Humanity +1d4 |

### Random parts

Each random part is drawn separately, from an unlimited supply. Roll for its type, then for its variant, using the table on your player sheet. When you buy specimens you choose the type yourself and roll only for the variant:

| Type (d6) | | Variant |
|---|---|---|
| 1–2 | Arm | d6: 1–2 ordinary, 3–4 labourer, 5–6 damaged |
| 3–4 | Leg | d6: 1–2 ordinary, 3–4 athlete, 5–6 frail |
| 5 | Chest | d6: 1–2 ordinary, 3–4 robust, 5–6 scarred |
| 6 | Head | d4: 1 ordinary, 2 criminal, 3 scholar, 4 poet |

The player sheet's table is generated from the game's data, so if the two ever disagree, the player sheet is right.

## Research

Research cards are permanent: they are never spent. There are nine types:

| Research | Effect of each effective copy |
|---|---|
| **Medical Expertise** | +1 money from Practice medicine |
| **Galvanic Mastery** | Add 1d6 to resurrection Vitality |
| **Neural Conditioning** | +1 control attempt |
| **Mesmerism** | Add 1d6 to control rolls |
| **Restraining Apparatus** | Add +4 to control rolls |
| **Moral Philosophy** | Add +3 to resurrection Humanity |
| **Discreet Methods** | Add 1 to each of your discovery rolls |
| **Public Lectures** | When you conduct research, suspicion −1 after you publish |
| **Parish Benefactor** | Each Donate to charity you make removes 1 more suspicion |

**Two ways to discover research.** Conducting research takes a card from the market and **publishes** it. An experiment keeps a card from the deck **privately**: it is still face up for all to see, but never published. Keep published cards in one row above your player sheet and experiment discoveries in another.

**One of each type.** You can never take a type you have already discovered, by either route. You may take a type another player has already published, and that publishes it again. Conducting research is not allowed when the market has no card you may take.

**Effective copies stack.** Your effective copies of a type are:

- **1** if you have that card in front of you, plus
- **1 for each other player** who has **published** that type (a card in their published row).

Your own publication doesn't count twice. Every effective copy applies in full: two copies of Galvanic Mastery roll two d6, and three of Moral Philosophy add +9. Because other players' publications count, a publication can give you new control attempts in the middle of the game: move your control marker up when it happens.

**The market.** The market holds 4 face-up cards. Refill it from the top of the deck as soon as a card is taken. There is no reshuffle. When the deck is empty, the market shrinks.

## Resolution: resurrection

When night ends, everyone who prepared announces it, then attempts resolve one at a time in initiative order, starting with the first player. A player whose body is not complete when their turn comes does nothing: the attempt is called off and no parts are lost. If nobody prepared, skip to dawn.

### Rolling

The attempt uses up all six installed parts; loose parts are untouched. Set the six parts aside, then roll two attributes:

- **Vitality** — does it live? Roll **d20**, add every Vitality die and modifier from your parts and research. It succeeds on **20 or more**.
- **Humanity** — does it have a conscience? Roll **d20**, add every Humanity die and modifier. It succeeds on **20 or more**, plus any threshold changes (the Brain of a criminal makes it 23).

Negative dice are rolled and subtracted. There are no automatic results on a natural 1 or 20, and no rerolls. Unmodified, each attribute succeeds only on a natural 20, so parts and research matter.

### Outcomes

1. **Vitality fails.** No Creature. Shuffle the six used parts face down and take **3** at random back as loose parts; discard the rest. Suspicion +1.
2. **Vitality and Humanity succeed.** A **stable Creature**! The game will end at dawn, after the round's other attempts. Discard the parts.
3. **Vitality succeeds, Humanity fails.** A **monster**. Resolve its control chain before the next attempt.

## Control: subduing monsters

Everyone starts with **3 control attempts**, plus one for each effective copy of Neural Conditioning. Track them on your player sheet. Spent attempts never come back.

When a monster is created, a **control chain** begins with its creator and goes clockwise, giving each player exactly one chance:

- A player who has no control attempts left, or who is not the creator and has **no Igor on Garrison the watch** this round, is skipped. Being skipped adds no suspicion.
- Every other player chooses, openly:
  - **Try to subdue.** Spend one attempt and make a control roll: **d20**, plus 1d6 per effective Mesmerism and +4 per effective Restraining Apparatus. **20 or more** succeeds: the monster is destroyed. Shuffle its six parts face down, the subduer takes **3** at random as loose parts, and the rest are discarded. Then suspicion +1. The chain ends and resolution continues. A failed roll adds nothing, and the chain moves on.
  - **Let it pass.** Suspicion +2, and the chain moves on. This applies to the creator too.

Body parts never affect control rolls. If the chain gets back to the creator without anyone subduing the monster, it is **unleashed** and the game ends at once.

## Suspicion

Suspicion is one shared track from 0 to 10. Only these raise it:

- discovery rolls when robbing graves, selling parts or conducting experiments;
- a failed Vitality roll (+1);
- subduing a monster (+1);
- letting a monster pass when you could have tried (+2).

Donate to charity lowers it (−2, more with Parish Benefactor), and so does conducting research with Public Lectures. It never changes on its own, and a stable Creature adds none. Suspicion can't go below 0 or above 10.

**When suspicion reaches 10, the mob forms** and arrests every scientist: the game ends at once.

## Dawn

If any Creature became stable this round, the game ends (see below). Otherwise:

1. The player who rested becomes the first player. If nobody rested, the first-player marker moves one seat clockwise.
2. Every worker returns to its owner, and every space is empty again.
3. Begin a new day.

## End of the game

The game ends immediately, in any phase, when:

- **The mob forms.** The Inquisitor wins, if that card was dealt.
- **A monster is unleashed.** Every Unleasher who was dealt a card wins. If a player's decision to let a monster pass brings the mob while the monster is still loose, the mob can't stop it: the monster is unleashed, and the game ends as an unleashing, not a mob.

Nothing else happens after a catastrophe: no more actions or rolls, and unresolved resurrections are lost. Everyone else loses, even someone who stabilized a Creature this round.

Otherwise, the game ends **at the dawn of any round in which a Creature became stable**:

- **Exactly one Creature**: if its owner is a Prometheus, they win alone. Otherwise everyone loses.
- **Two or more Creatures**: the Visionary wins, if that card was dealt. Otherwise everyone loses. No Prometheus wins, even one whose Creature lived.

When the game ends, everyone reveals their objective, and the unseen card is turned over.

## Playing at the table

The browser game handles some things automatically. At the table:

- **Random parts** use the dice table on the player sheets; specimens use only its variant column.
- **Random salvage** is three parts drawn from the six shuffled face down.
- **Experiment cards** are shown to everyone; only the kept card stays with you, face up in your experiment row.
- **Odds** are not printed. Discovery rolls are printed on their spaces.
- **Order of dice** doesn't matter at the table. Roll all of an attribute's dice, add them up, and compare.

## Designer rulings

These rulings clarify the original v0.3 design and are part of the rules above:

1. **Conducting research publishes.** There is no other way to publish, and experiment discoveries are never published.
2. **Resurrection is prepared, not secretly committed.** Preparing is public and binding; the body must be complete when the attempt resolves.
3. **Research copies stack**: 1 for your own discovery, plus 1 per publication of that type by another player.
4. **A stable Creature ends the game** at that round's dawn, whether or not anyone wins. Creatures never act.
5. **Hired Igors act at once**, and an Igor may hire another Igor.
6. **Assembly has no limit**: a whole body can be built in one action.
7. **Every player starts with 3 control attempts**; subduing another player's monster needs an Igor in the garrison, and the creator needs none.
8. **The mob can't stop a monster** that is waiting to be subdued.
9. **The mob forms at 10** at every player count. The Visionary is used only with 4 or more players.
10. **Six players deal two Unleashers**, who win together without knowing each other.
