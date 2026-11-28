<!-- rules-fingerprint: 34b3df2b -->
<!-- This rulebook describes the physical game. It is maintained by hand (spec 032): every change to gameplay — the 02x specs or the default configuration — updates it in the same commit, together with the fingerprint above. `npm test` prints the new fingerprint when it is out of date. -->

![Monsters of Loving Grace logo: a stitched heart struck by lightning](logo.png)

# Monsters of Loving Grace — Rulebook

*A game of resurrection, suspicion and secret ambition for 3–6 players. Print-and-play prototype.*

Each of you is a scientist in a nervous village. By day you earn money and buy what you need honestly. By night you rob graves, sell parts in back alleys and experiment in your laboratory, and every risk you take makes the villagers more suspicious. Some of you want to create life. Others secretly want the village to rise up, or a monster to break loose.

Everything builds to one moment: a single roll of a handful of dice to see whether your Creature has a conscience, and the rolls of the players who try to stop it if it doesn't. No dice are rolled until then.

## Components

The print view prints everything except the dice and money.

- **Rulebook** (this document).
- **Village board**: the suspicion track (0–10), spaces for the science deck and the four-card market, and spaces for the body-part deck and its discard pile.
- **Action board**: one page with the 6 day spaces on the left and the 6 night spaces on the right. If a single space changes, reprint it and glue it over the old one.
- **6 player sheets**, one per colour, each with six body slots and a summary of the rules.
- **7 objective cards**: 3 Prometheus, 1 Visionary, 1 Inquisitor, 2 Unleashers.
- **31 science cards** of 12 types (see *Science*).
- **60 body-part cards** of 29 variants (see *Body parts*).
- **Worker tiles**: per colour, 1 Scientist and 3 Igors.
- **Money (not printed)**: use coins, poker chips, or pencil and paper. Money is unlimited.
- **Markers**: suspicion and first player.
- Everything prints single-sided. Use card stock or opaque sleeves so the decks don't show through from the back.
- **Dice (not printed)**: at least one d20, four d4, four d6 and two d8. If you are short of a die, roll it again and add the results.

## Overview

The game is played in rounds. Each round has four phases:

1. **Day**: take turns placing workers on day action spaces.
2. **Night**: take turns placing workers on night action spaces.
3. **Resolution**: everyone who prepared a resurrection attempts it.
4. **Dawn**: check whether the game is over; otherwise pass initiative and begin a new round.

There is no last round. The game ends only when a Creature becomes stable, the mob forms, or a monster is unleashed.

**Day and night.** Day actions generally cost money and never raise suspicion: you choose what you get. Night actions are generally free, but each risky one raises suspicion by exactly 1, and you take what the decks give you.

Everything is public except the objective cards and the order of the two decks: money, hands of parts, science, workers and suspicion are all open for everyone to see. There is no trading between players.

## Setup

1. **Seats.** Sit in a circle. Each player takes a colour, its player sheet, and its Scientist and 3 Igors.
2. **Starting resources.** Each player places their Scientist and **one** Igor in front of them, ready to work. The other two Igors stay beside the sheet until hired. Each player takes **3 money**.
3. **The village.** Put the village board in the middle. Place the suspicion marker on **0**. Put the action board beside it, and the money.
4. **Science.** Shuffle the 31 science cards into a face-down deck on the village board. Deal the top **4** face up into the market.
5. **Body parts.** Shuffle the 60 body-part cards into a face-down deck on the village board, leaving room for a discard pile beside it.
6. **Objectives.** Build the objective deck for your player count, shuffle it, and deal one card face down to each player. Look at your own card secretly. Set the remaining card aside, unseen and face down.

   | Players | Prometheus | Visionary | Inquisitor | Unleasher | Cards |
   |---|---:|---:|---:|---:|---:|
   | 3 | 2 | — | 1 | 1 | 4 |
   | 4 | 2 | 1 | 1 | 1 | 5 |
   | 5 | 3 | 1 | 1 | 1 | 6 |
   | 6 | 3 | 1 | 1 | 2 | 7 |

7. **First player.** Choose a first player at random and give them the first-player marker.

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

Each action space shows a worker slot per capacity. Most spaces hold **2 workers with 3–4 players** and **3 with 5–6 players**; the dashed slot is used only with 5–6 players. *Garrison the watch* holds 3 at every player count. *Practice medicine*, *Prepare resurrection* and *Attend vespers* have no limit. *Rest* holds one worker. Workers stay on their spaces until dawn, and which workers are where is public.

An action needs its full cost and every prerequisite. Money never goes below 0.

## Day actions

| Space | Location | Effect |
|---|---|---|
| **Practice medicine** | Hospital | Gain 3 money, plus 1 if you hold Medical Expertise. |
| **Conduct research** | University | Pay 2. Take any science card from the market. Refill the market from the deck at once. With Public Lectures, suspicion −1. |
| **Buy specimens** | Anatomical supplier | Pay 2. Draw 3 body parts, show them, and keep one. Discard the other two. |
| **Donate to charity** | Town hall | Pay 3. Suspicion −2, and 1 more with Parish Benefactor, to a minimum of 0. Only allowed while suspicion is above 0. |
| **Hire an Igor** | Tavern | Pay 4. Take one of your reserve Igors; it can act at once. At most 3 Igors each. |
| **Garrison the watch** | Watch house | Igors only. No cost and no immediate effect. Until dawn, you may try to subdue monsters, your own included (see *Control*). |

## Night actions

| Space | Location | Effect |
|---|---|---|
| **Prepare resurrection** | Private laboratory | Scientists only. Lay out a full set of body parts whose Vitality is at least 10. You will attempt a resurrection in this round's resolution. |
| **Sell parts** | Back alley | Discard exactly 2 parts from your hand and gain 7 money. Suspicion +1. |
| **Conduct experiments** | Private laboratory | Discard exactly 2 parts from your hand. Draw 2 science cards from the top of the deck and keep both. Suspicion +1. |
| **Rob graves** | Graveyard | Draw 2 body parts into your hand. Suspicion +1. |
| **Attend vespers** | Chapel | Free. Suspicion −1, to a minimum of 0. Only allowed while suspicion is above 0. |
| **Rest** | Home | You will go first next round. |

Night actions mirror day actions: robbing graves for buying specimens, selling for medicine, experiments for research. They are free or pay more, but the results are random and the village notices.

### Details

**Suspicion.** Rob graves, sell parts and conduct experiments each raise suspicion by exactly 1, after their other effects. Any rise can form the mob at once.

**Rob graves.** Draw both parts first, then raise suspicion.

**Sell parts.** Discard the parts and take the money first, then raise suspicion.

**Conduct experiments.** You need 2 parts in your hand and at least one card in the science deck. Discard the parts, then draw 2 science cards, or as many as remain, show them to everyone, and keep them all. Then raise suspicion.

**Buy specimens.** You may look at all three before choosing; everyone sees them too.

**Attend vespers.** Any number of workers may attend, Scientists and Igors alike. Parish Benefactor does not affect it.

**Prepare resurrection.** See *Preparing* below. Preparing is public and binding.

**Rest.** Only one player can rest each round.

## Body parts

All body parts come from one shuffled deck. Draw from the top. When a part is spent, put it face up on the **discard pile**. Whenever you need to draw and the deck is empty, shuffle the discard pile to form a new deck. Parts you hold are your **hand**: keep them face up beside your sheet, with no limit.

A **full set** is **two arms, two legs, one chest and one head**. Arms are interchangeable, and so are legs.

Each part may have a **Vitality** number (does the body live?) and a **Humanity** die (does it have a conscience?). Most parts are ordinary or worse, so a strong body comes from choosing well from a larger hand.

| Type | Variant | Copies | Vitality | Humanity |
|---|---|---:|---:|---|
| Arm | Ordinary arm | 5 | +1 | |
| Arm | Arm of a labourer | 2 | +3 | |
| Arm | Arm of a blacksmith | 1 | +4 | −d4 |
| Arm | Arm of a surgeon | 1 | +1 | +d4 |
| Arm | Arm of a strangler | 2 | +2 | −d6 |
| Arm | Damaged arm | 4 | −1 | |
| Arm | Withered arm | 3 | −2 | |
| Arm | Gangrenous arm | 2 | −3 | |
| Leg | Ordinary leg | 5 | +1 | |
| Leg | Leg of an athlete | 2 | +3 | |
| Leg | Leg of a highwayman | 1 | +3 | −d6 |
| Leg | Leg of a soldier | 2 | +2 | −d4 |
| Leg | Leg of a dancer | 1 | +1 | +d4 |
| Leg | Frail leg | 4 | −1 | |
| Leg | Lame leg | 3 | −2 | |
| Leg | Crushed leg | 2 | −3 | |
| Chest | Ordinary chest | 3 | +2 | |
| Chest | Robust chest | 1 | +4 | |
| Chest | Chest of a prizefighter | 1 | +4 | −d6 |
| Chest | Chest of a priest | 1 | +1 | +d6 |
| Chest | Scarred chest | 2 | −1 | |
| Chest | Consumptive chest | 2 | −3 | |
| Head | Ordinary head | 3 | | |
| Head | Brain of a scholar | 1 | | +d6 |
| Head | Brain of a poet | 1 | | +d4 |
| Head | Brain of a saint | 1 | | +d8 |
| Head | Brain of a criminal | 2 | | −d6 |
| Head | Brain of a madman | 1 | +2 | −d8 |
| Head | Brain of a drunkard | 1 | −1 | −d4 |

## Science

Science cards are permanent: once you hold one, it applies for the rest of the game. All science is yours alone: nothing you do gives other players a copy. You may hold several cards of the same type, and **every card you hold applies**. Keep them face up beside your sheet.

There are four kinds of science card:

| Kind | Card | Copies | Effect |
|---|---|---:|---|
| Vitality | **Comparative Anatomy** | 5 | Vitality +1 |
| Vitality | **Galvanic Mastery** | 4 | Vitality +2 |
| Vitality | **Voltaic Pile** | 2 | Vitality +3 |
| Humanity | **Sentimental Education** | 4 | Humanity +d4 |
| Humanity | **Moral Philosophy** | 4 | Humanity +d6 |
| Humanity | **Natural Theology** | 2 | Humanity +d8 |
| Control | **Restraining Apparatus** | 3 | Control rolls +3 |
| Control | **Mesmerism** | 3 | Control rolls +d6 |
| Other | **Medical Expertise** | 1 | +1 money from Practice medicine |
| Other | **Public Lectures** | 1 | When you conduct research, suspicion −1 |
| Other | **Parish Benefactor** | 1 | Your charity removes 1 more suspicion |
| Other | **Neural Conditioning** | 1 | You may try to subdue your own monster without an Igor in the garrison |

Every science effect is positive. For example, two Galvanic Mastery and a Comparative Anatomy add +5 Vitality to every body you prepare, and two Moral Philosophy add two d6 to every Humanity roll.

**The market.** The market holds 4 face-up cards. Refill it from the top of the deck as soon as a card is taken. There is no reshuffle. When the deck is empty, the market shrinks.

## Resurrection

### Preparing: Vitality

At night, place your Scientist on *Prepare resurrection* and choose a full set of six parts from your hand. Lay them on the six body slots of your player sheet.

**Vitality is not rolled: you count it.** Add the Vitality of the six parts and the Vitality of your science cards. You may prepare **only if the total is 10 or more**. A body you can prepare always lives.

The six parts stay on your sheet until resolution. They can't be sold, discarded or changed.

### Resolving: Humanity

When night ends, everyone who prepared announces it, then attempts resolve one at a time in initiative order, starting with the first player. If nobody prepared, skip to dawn.

Each attempt is **one roll**: a **d20**, plus every Humanity die on the six parts and on your science cards. Positive dice are added, negative dice subtracted. **20 or more** succeeds. There are no automatic results on a natural 1 or 20, and no rerolls. A bare d20 succeeds only on a 20, so good heads and Humanity science matter; and a body full of negative dice may have no chance at all.

Either way, discard the six parts. Then:

1. **Humanity succeeds.** A **stable Creature**! The game will end at dawn, after the round's other attempts.
2. **Humanity fails.** A **monster**. Resolve its control chain before the next attempt.

## Control: subduing monsters

When a monster is created, a **control chain** begins with its creator and goes clockwise, giving each player exactly one chance at it:

- Only players with an **Igor on Garrison the watch** this round may try, **the creator included**. (Neural Conditioning lets its holder try to subdue their own monster without one.) Anyone else is skipped, and being skipped adds no suspicion.
- Every player who may try chooses, openly:
  - **Try to subdue.** Make a control roll: **d20**, plus your control science (+3 for each Restraining Apparatus, +d6 for each Mesmerism). **20 or more** succeeds: the monster is destroyed and its parts stay discarded. Then suspicion +1. The chain ends and resolution continues. A failed roll adds nothing, and the chain moves on.
  - **Let it pass.** Suspicion +2, and the chain moves on. This applies to the creator too.

You may try to subdue any number of monsters over a game. Body parts never affect control rolls. If the chain gets back to the creator without anyone subduing the monster, it is **unleashed** and the game ends at once.

## Suspicion

Suspicion is one shared track from 0 to 10. Only these raise it:

- robbing graves, selling parts or conducting experiments (+1 each);
- subduing a monster (+1);
- letting a monster pass when you could have tried (+2).

Only these lower it: donating to charity (−2, more with Parish Benefactor), attending vespers (−1), and conducting research with Public Lectures (−1). It never changes on its own, and a stable Creature adds none. Suspicion can't go below 0 or above 10.

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

- **Shuffling** is the only randomness before resolution: the science deck, the body-part deck, and the body-part discard pile when the deck runs out.
- **Specimens and experiment cards** are shown to everyone.
- **Vitality** is a sum you count yourself; check each other's when a body is laid out.
- **Odds** are not printed.
- **Order of dice** doesn't matter at the table. Roll all the Humanity dice at once, add them up, and compare.

## Designer rulings

These rulings clarify the original v0.3 design and are part of the rules above:

1. **Resurrection is prepared, not secretly committed.** Preparing is public and binding, and the six parts are committed when you prepare.
2. **Vitality is a known total**, checked when you prepare; only Humanity is rolled.
3. **Science is personal, and every card you hold applies**, including several copies of one type.
4. **A stable Creature ends the game** at that round's dawn, whether or not anyone wins. Creatures never act.
5. **Hired Igors act at once**, and an Igor may hire another Igor.
6. **Subduing any monster needs an Igor in the garrison**, the creator's own included, unless the creator holds Neural Conditioning. A subduer gains nothing.
7. **The mob can't stop a monster** that is waiting to be subdued.
8. **The mob forms at 10** at every player count. The Visionary is used only with 4 or more players.
9. **Six players deal two Unleashers**, who win together without knowing each other.
