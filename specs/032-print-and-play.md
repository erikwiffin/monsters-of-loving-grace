# 032 — Print and play

The game is also playtested as a physical copy. The print view is a printable page holding every component needed to play at a table, together with a rulebook. Components are drawn from the engine's configuration (spec 010) through the engine API, so when a card, part or action space changes, the print view changes with it and needs no print-specific edit. The print view contains no rules logic.

## Opening it

The main menu (spec 030) has a **Print and play** button that opens the print view in a new tab at `index.html?print`. The print view is part of the static site (spec 015): its code lives in `src/ui/`, and the rulebook in `assets/`, so it deploys with no change to the build. It never creates or loads a game.

## Components

Components are generated from the default configuration and sized for the largest player count, six. Each component has a stable ID, a name and a number of copies. They are grouped into sections, printed in this order:

| Section | Components | Size |
|---|---|---|
| Rulebook | The rulebook (below) | Flowing pages |
| Village board | Suspicion track from 0 to the mob threshold, a space for the research deck, and the market slots in a 2 × 2 grid. There is no round track: no rule depends on the round number | One page |
| Action spaces | One tile per action space: location, phase, name, cost and effect, discovery roll, worker permission, and a worker slot per capacity, marking slots used only at higher player counts. Unlimited spaces say so | One page: day spaces in the left column, night spaces in the right |
| Player mats | One per seat, in that seat's colour: the six body slots, a control-attempt track, and where to keep money, loose parts and research | One page |
| Player aids | One per seat: the round, resurrection, control rolls and the body-part draw table | Two per page |
| Objective cards | One component per objective, with as many copies as any player count needs | Card, nine per page |
| Research cards | One component per research type, with the configured number of copies | Card, nine per page |
| Body parts | One component per variant, with four copies per body slot of its type, since the supply is unlimited | Mini card, sixteen per page |
| Workers | Scientists and Igors, folding stand-up tokens in seat colours, enough for six players | Mini card, sixteen per page |
| Tokens | Money in 1s and 5s, the suspicion and first-player markers, and a control-attempt marker per seat | Round token, seventy per page |

Cards are 63 × 88 mm and mini cards 44 × 63 mm. Components have dashed cut lines. Pages fit both US Letter and A4 with 7 mm margins, and print correctly at 100% scale.

Everything prints single-sided; cards have plain backs. Card stock or opaque sleeves keep the objective deal and the research deck hidden.

## Choosing what to print

Every component has a checkbox, so a playtester who has changed only a few components can reprint just those. There are **Enable all** and **Disable all** controls for the whole view, and for each section. A disabled component is left out of the printout entirely, and the enabled components in its section repack onto as few pages as possible. A section with nothing enabled prints nothing. The control panel shows the number of pages to be printed, and is itself never printed.

The selection and the paper size (Letter or A4) are remembered in this browser. Without storage, the view still works, with everything enabled.

## Physical adaptations

The browser game does some things automatically that people at a table must do by hand. The rulebook explains each, and the components support them:

- **Random body parts.** The engine draws a type by weight, then a variant uniformly (spec 024). The print view turns those weights into a dice table with exactly the same odds, for example d6 for the type, then a die for the variant, rerolling unused faces where the counts don't divide a die evenly. The table is printed on the player aids and is generated from the configuration, not written by hand.
- **Random salvage.** Salvaged parts are chosen by shuffling the six parts face down and taking three.
- **Secret objectives.** The objective deck for the player count is dealt face down; the remaining card is set aside face down.
- **Effective research.** Researched cards are kept face up in a published row beside the owner's mat, and experiment discoveries in a separate row, so everyone can count effective copies (spec 023).
- **Odds.** Exact odds are not printed. Discovery rolls are printed on their action spaces.
- **Dice.** The rulebook lists the dice needed. Dice are not printed.

## Rulebook

The rulebook is `assets/rulebook.md`, a Markdown file describing how to play the physical game: components, setup, the round, every action, research, body parts, resurrection, control, suspicion, the end of the game, the physical adaptations, and the designer rulings. It was written once, from the specs, and is maintained by hand. It is not regenerated from the specs or the code. The print view renders it as its first section, using a small built-in Markdown renderer, with no external libraries.

**Keeping it current.** The specs remain the source of truth. Any change to gameplay, meaning the 02x specs or the default configuration, updates the rulebook in the same commit. To enforce this, the rulebook begins with a comment holding a rules fingerprint: a hash of the default configuration, the objective descriptions and the text of the 02x specs. A test recomputes the fingerprint and fails, printing the new value, when it does not match. Whoever changed the rules then reviews the rulebook, updates it, and records the new fingerprint.
