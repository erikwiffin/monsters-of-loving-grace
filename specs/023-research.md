# 023 — Research engine and publishing

Research is persistent technology for building an engine. It is never spent and never consumed. Money and body parts are the consumable resources. Money, body parts and research are the game's only three primary resources.

## Research cards

There are six research types, each with a persistent effect:

| ID | Name | Effect per effective copy |
|---|---|---|
| medicine | Medical Expertise | +1 money from the medicine action, including Igor placements |
| anatomy | Advanced Anatomy | Assemble one more part per assemble action |
| galvanism | Galvanic Mastery | Add 1d6 to the resurrection Vitality score |
| neurology | Neural Conditioning | Add 1d4 to the resurrection Control score |
| philosophy | Moral Philosophy | Add a fixed +5 to the resurrection Humanity score |
| discretion | Discreet Methods | Reduce the suspicion caused by each graves or morgue action by 1, to a minimum of 0 |

Effects are defined as data (spec 010), not scripts.

## Market and deck

The research deck has four copies of each type, 24 cards, shuffled at setup. Four cards are dealt face up as the market. When a card is taken, by research or by experiment, the market refills immediately from the top of the deck while cards remain. The deck is finite: there is no reshuffle and no market cycling in this version. Once the deck is empty, the market shrinks as cards are taken.

A player cannot acquire a research type they have already personally discovered. Research and experiment use identical selection rules, and are unavailable when the market holds no card the player is eligible to take.

## Publishing

The publish action (day, Scientist or Creature worker only) makes one research type the player has personally discovered permanently available to all players, and pays the publisher 2 money. The publisher keeps personal discovery credit. Every publication is recorded publicly with the publisher, the type and the round.

**Ruling:** a player may publish any type they have personally discovered and have not already published themselves, *even if another player has already published that type*. Each player may publish a given type at most once.

A publication does not stop other players acquiring a personal copy of that type.

## Effective research and stacking

**Ruling: research copies stack.** A player's *effective copies* of a type are:

- 1 if the player personally discovered the type, plus
- 1 for each publication of that type by *another* player.

A player's own publication does not count again for themselves: it was already counted as their personal copy.

Every effective copy applies its effect in full. For example:

- With two copies of Galvanic Mastery, the player rolls two separate d6 for Vitality.
- With three copies of Moral Philosophy, the player adds +15 to Humanity.
- With two copies of Advanced Anatomy, the player may assemble 4 parts per action.
- With two copies of Discreet Methods, discovery suspicion is reduced by 2.

Effective research counts are public, since they derive from public discoveries and publications, and are shown for every player.

## Lecture

**Ruling:** lecture income is 1 + the number of types this player has published, capped at 4 total. See spec 022.
