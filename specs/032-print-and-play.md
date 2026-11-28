# 032 — Print and play

The game is also playtested as a physical copy. The print view is a printable page holding every component needed to play at a table, together with a rulebook. Components are drawn from the engine's configuration (spec 010) through the engine API, so when a card, part or action space changes, the print view changes with it and needs no print-specific edit. The print view contains no rules logic.

## Opening it

The main menu (spec 030) has a **Print and play** button that opens the print view in a new tab at `index.html?print`. The print view is part of the static site (spec 015): its code lives in `src/ui/`, and the rulebook in `assets/`, so it deploys with no change to the build. It never creates or loads a game.

## Components

Components are generated from the default configuration and sized for the largest player count, six. Each component has a stable ID, a name and a number of copies. They are grouped into sections, printed in this order:

| Section | Components | Size |
|---|---|---|
| Rulebook | The rulebook (below) | Flowing pages |
| Village board | Suspicion track from 0 to the mob threshold on one line, a space for the science deck, the market slots in a 2 × 2 grid, and spaces for the body-part deck and its discard pile. There is no round track: no rule depends on the round number | One page |
| Action spaces | One tile per action space: location, phase, name, cost and effect, any suspicion change, any worker restriction, and a worker slot per capacity, marking slots used only at higher player counts. Unlimited spaces say so | One page: day spaces in the left column, night spaces in the right |
| Player sheets | One per seat, in its colour: the six body slots, sized for body-part cards, and a player aid covering the round, resurrection and control rolls | One page |
| Objective cards | One component per objective, with as many copies as any player count needs | Card, nine per page |
| Science cards | One component per science type, with the configured number of copies | Card, nine per page |
| Body parts | One component per variant, with the configured number of copies, forming the body-part deck | Small card, thirty-six per page |
| Workers | One component per seat: a Scientist and the most Igors a player may have, as tiles in the seat's colour, each with an icon of its kind | Tile, all on one page |
| Tokens | The suspicion and first-player markers | Round token, seventy per page |

Cards are 63 × 88 mm and body parts 30 × 42 mm. Cut lines are dashed. Pages fit both US Letter and A4 with 7 mm margins, and print correctly at 100% scale.

Everything prints single-sided; cards have plain backs. Card stock or opaque sleeves keep the objective deal and the order of the science and body-part decks hidden.

## Choosing what to print

Every component has a checkbox, so a playtester who has changed only a few components can reprint just those. There are **Enable all** and **Disable all** controls for the whole view, and for each section. A disabled component is left out of the printout entirely, and the enabled components in its section repack onto as few pages as possible. The control panel shows the number of pages to be printed, and is itself never printed.

The selection and the paper size (Letter or A4) are remembered in this browser. Without storage, the view still works, with everything enabled.

## Physical adaptations

At a table, people do by hand what the browser game does automatically. The rulebook explains each:

- **Shuffling.** The engine's shuffles (spec 010) are ordinary shuffles of the science deck, the body-part deck and, when the body-part deck runs out, its discard pile.
- **Secret objectives.** The objective deck for the player count is dealt face down; the remaining card is set aside face down.
- **Science and hands.** Science cards and parts in hand are kept face up beside the owner's sheet, so everyone can see them (specs 023 and 024).
- **Odds.** Exact odds are not printed. Vitality is a sum players count themselves.
- **Dice and money.** Neither is printed. The rulebook lists the dice needed, and players use any coins, chips or paper for money.

## Rulebook

The rulebook is `assets/rulebook.md`, a Markdown file describing how to play the physical game: components, setup, the round, every action, science, body parts, resurrection, control, suspicion, the end of the game, the physical adaptations, and the designer rulings. It was written once, from the specs, and is maintained by hand, never regenerated. Its first page shows the game's logo, `assets/logo.png`, which is also the favicon and main-menu logo. The print view renders it as its first section, using a small built-in Markdown renderer, with no external libraries.

**Keeping it current.** The specs remain the source of truth. Any change to gameplay, meaning the 02x specs or the default configuration, updates the rulebook in the same commit. To enforce this, the rulebook begins with a comment holding a rules fingerprint: a hash of the default configuration, the objective descriptions and the text of the 02x specs. A test recomputes the fingerprint and fails, printing the new value, when it does not match. Whoever changed the rules then reviews the rulebook, updates it, and records the new fingerprint.
