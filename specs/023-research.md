# 023 — Research engine and publishing

Research is persistent technology for building an engine. It is never spent and never consumed. Money and body parts are the consumable resources. Money, body parts and research are the game's only three primary resources.

## Research cards

There are six research types, each with a persistent effect:

| ID | Name | Effect per effective copy |
|---|---|---|
| medicine | Medical Expertise | +1 money from the medicine action, including Igor placements |
| anatomy | Advanced Anatomy | Assemble one more part per assemble action |
| galvanism | Galvanic Mastery | Add 1d6 to the resurrection Vitality score |
| neurology | Neural Conditioning | +1 control attempt for subduing monsters (spec 025) |
| philosophy | Moral Philosophy | Add a fixed +5 to the resurrection Humanity score |
| discretion | Discreet Methods | Reduce the suspicion caused by each graves or morgue action by 1, to a minimum of 0 |

Effects are defined as data (spec 010), not scripts.

## Market and deck

The research deck has four copies of each type, 24 cards, shuffled at setup. Four cards are dealt face up as the market. When a card is taken, by research or by experiment, the market refills immediately from the top of the deck while cards remain. The deck is finite: there is no reshuffle and no market cycling in this version. Once the deck is empty, the market shrinks as cards are taken.

A player cannot acquire a research type they have already personally discovered. Research and experiment use identical selection rules, and are unavailable when the market holds no card the player is eligible to take.

## Publishing

**Ruling: publishing is a free action.** During their own day or night turn, before placing a worker or passing, a player may publish any number of research types they have personally discovered, using `PUBLISH_RESEARCH` (spec 011). Publishing needs no worker, costs nothing, pays nothing immediately and does not end the turn. It makes the type permanently available to all players. The publisher keeps personal discovery credit. Every publication is recorded publicly with the publisher, the type and the round.

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
- With two copies of Neural Conditioning, the player has 2 more control attempts. Because another player's publication adds a copy, it can grant attempts partway through the game.

Effective research counts are public, since they derive from public discoveries and publications, and are shown for every player.

## Lecture

**Ruling:** lecture income is 1, plus 1 for each discovery this player has published, with no cap. See spec 022. Publishing pays off through lectures, so sharing research is worth more over time.
