# 023 — Research engine and publishing

Research is persistent technology for building an engine. It is never spent and never consumed. Money and body parts are the consumable resources. Money, body parts and research are the game's only three primary resources.

## Research cards

There are seven research types, each with a persistent effect:

| ID | Name | Effect per effective copy |
|---|---|---|
| medicine | Medical Expertise | +1 money from the medicine action, for any worker |
| galvanism | Galvanic Mastery | Add 1d6 to the resurrection Vitality score |
| neurology | Neural Conditioning | +1 control attempt for subduing monsters (spec 025) |
| mesmerism | Mesmerism | Add 1d6 to control rolls (spec 025) |
| restraint | Restraining Apparatus | Add a fixed +4 to control rolls (spec 025) |
| philosophy | Moral Philosophy | Add a fixed +5 to the resurrection Humanity score |
| discretion | Discreet Methods | Reduce the suspicion from each discovery roll (graves, sell, experiment) by 1, to a minimum of 0 |

Effects are defined as data (spec 010), not scripts.

## Market and deck

The research deck has four copies of each type, 28 cards, shuffled at setup. Four cards are dealt face up as the market. When a card is taken from the market by the research action, the market refills immediately from the top of the deck while cards remain. There is no reshuffle and no market cycling in this version. Once the deck is empty, the market shrinks as cards are taken.

Experiments draw from the top of the deck instead of the market, and put the cards they don't keep back at the bottom (spec 022). The deck order is hidden; only its size is public.

A player cannot acquire a research type they have already personally discovered, by either route. The research action is unavailable when the market holds no card the player is eligible to take.

## Publishing

**Ruling: conducting research publishes.** A card taken by the research action is published at once: the player gains personal discovery credit and the type becomes available to all players. There is no other way to publish. There is no free publishing action and no `PUBLISH_RESEARCH` command. Every publication is recorded publicly with the publisher, the type and the round.

**Ruling: experiment discoveries stay private.** A card kept from an experiment gives the player personal discovery credit but is never published, so it never gives other players a copy. Because a player cannot acquire a type twice, a type first discovered by experiment can never later be published by that player.

A player may conduct research on a type another player has already published, and that publishes it again. A publication does not stop other players acquiring a personal copy of that type.

## Effective research and stacking

**Ruling: research copies stack.** A player's *effective copies* of a type are:

- 1 if the player personally discovered the type, plus
- 1 for each publication of that type by *another* player.

A player's own publication does not count again for themselves: it was already counted as their personal copy.

Every effective copy applies its effect in full. For example:

- With two copies of Galvanic Mastery, the player rolls two separate d6 for Vitality.
- With three copies of Moral Philosophy, the player adds +15 to Humanity.
- With two copies of Discreet Methods, discovery suspicion is reduced by 2.
- With two copies of Neural Conditioning, the player has 2 more control attempts. Because another player's publication adds a copy, it can grant attempts partway through the game.

Personal discoveries, by either route, are public, as are publications, so effective research counts are public and shown for every player.
