# 023 — Science

Science cards are persistent technology for building an engine. A card is never spent or consumed: once a player holds it, it applies for the rest of the game. Money and body parts are the consumable resources. Money, body parts and science are the game's only three primary resources.

All science is personal. A card helps only the player holding it, and nothing a player does gives other players a copy. Every science effect is positive.

## Kinds of card

Every science card is one of four kinds. Each kind has a strong identity, and the deck holds them in different numbers.

| Kind | What it does | Copies in the deck |
|---|---|---|
| Vitality | Adds a fixed positive number to the holder's Vitality total (spec 025) | Several of each |
| Humanity | Adds a positive die (d4, d6, d8, …) to the holder's Humanity roll | Several of each |
| Control | Adds a positive fixed number or a positive die to the holder's control rolls | Several of each |
| Other | Makes an action better, or unlocks something new | One of each |

## Default catalogue

| ID | Name | Kind | Copies | Effect |
|---|---|---|---:|---|
| anatomy | Comparative Anatomy | Vitality | 5 | Vitality +1 |
| galvanism | Galvanic Mastery | Vitality | 4 | Vitality +2 |
| voltaic | Voltaic Pile | Vitality | 2 | Vitality +3 |
| sentiment | Sentimental Education | Humanity | 4 | Humanity +d4 |
| philosophy | Moral Philosophy | Humanity | 4 | Humanity +d6 |
| theology | Natural Theology | Humanity | 2 | Humanity +d8 |
| restraint | Restraining Apparatus | Control | 3 | Control +3 |
| mesmerism | Mesmerism | Control | 3 | Control +d6 |
| medicine | Medical Expertise | Other | 1 | +1 money from Practice medicine, for any of the holder's workers |
| lectures | Public Lectures | Other | 1 | When the holder conducts research, suspicion falls by 1, to a minimum of 0, after the card is taken |
| benefactor | Parish Benefactor | Other | 1 | Each charity unit the holder buys removes 1 more suspicion |
| neurology | Neural Conditioning | Other | 1 | The holder may try to subdue their *own* monster without a garrisoned Igor (spec 025) |

The deck holds 31 cards. Effects are defined as data (spec 010), not scripts, and every copy count is configuration. A type with no cards in the deck is never seen.

## Market and deck

The science deck is shuffled at setup, and four cards are dealt face up as the market. When a card is taken from the market by the research action, the market refills immediately from the top of the deck while cards remain. There is no reshuffle and no market cycling. Once the deck is empty, the market shrinks as cards are taken.

Experiments draw from the top of the deck instead of the market, and the player keeps every card drawn (spec 022). The deck order is hidden; only its size is public.

The research action may take any card in the market, and is unavailable only when the market is empty.

## Holding cards and stacking

A player may hold any number of cards, including several copies of the same type. **Every card held applies its effect in full.** For example:

- With two Galvanic Mastery and one Comparative Anatomy, the player adds +5 to Vitality.
- With two Moral Philosophy, the player adds two separate d6 to the Humanity roll.
- With Restraining Apparatus and Mesmerism, each control roll is d20 + 3 + d6.

Cards of the Other kind are singletons, so no player holds two of them. Every card a player holds is public, kept face up beside their player sheet, and shown for every player.
