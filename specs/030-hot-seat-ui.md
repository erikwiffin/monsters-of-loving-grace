# 030 — Hot-seat browser interface

The browser game is a local hot-seat prototype for 3–6 players sharing one device. It renders engine views and submits commands; it contains no rules logic. Questions about legality go to the engine, for example by validating a command before showing a space as available.

## Main menu

- **New game**: choose 3–6 players (default 5), enter names (blank names get defaults), and choose who plays each seat (spec 031). In debug mode, a fixed seed and JSON configuration overrides can also be entered.
- **Resume**: continue the game saved in this browser, if there is one.
- **Import save**: load an exported save file.
- **Rulebook**: the rulebook (spec 032), which covers every possible role and the designer rulings.
- **Developer / debug mode**: a checkbox, remembered per browser.

## Privacy screens

Secret information is shown only behind opaque pass-the-device screens that hide the board completely:

- **Dealing objectives**: at the start of a game, each human player in turn gets a "Pass the device to X" screen, then "I am X — show my objective", then their objective card, then "Hide and pass".
- **View my objective**: available on the active human player's turn. A confirmation screen ("only X should look") comes first, then the objective is revealed.

This is casual privacy, not protection against browser storage or developer tools.

## Board

The shared board always shows only public information:

- the round and phase, and a plain suspicion meter showing value and maximum;
- a turn bar showing the active player, a selector for their available workers (an Igor is selected first, when one is available), and the pass button;
- every day and night action space, with its location, cost and effect text (including any suspicion it adds), its capacity at this player count, any worker restriction ("No Scientist" or "No Igor", left blank when any worker may go there) and the workers occupying it. On a human's turn, spaces in the current phase that the selected worker cannot legally take are hatched out, and the rest are outlined. When a space is unavailable, it explains why;
- the science market and deck count, and the body-part deck count and discard pile;
- one panel per player in initiative order, showing money, workers (used, pending, Scientist or Igor), science cards held (with counts), their hand of body parts, a body diagram while a resurrection is prepared with its Vitality total and Humanity odds, their control chance and whether they can subdue this round, and Creatures;
- the Chronicle, a readable log of public events.

The page switches between a light "day" palette and a dark "night" palette. It works at phone width without horizontal scrolling.

## Taking actions

Choosing a space opens a confirmation dialog for the action's choices:

- market cards for research;
- parts in hand for sell and experiment;
- a body picker for prepare, choosing two arms, two legs, a chest and a head, with the live Vitality total against the threshold and the exact Humanity odds;
- a summary for simple actions.

Nothing is sent until the player confirms. The prepare dialog says that preparing is public and binding, and allows confirming only a full set that meets the Vitality threshold. After buying specimens, a dialog shows the drawn parts with their effects, and the player chooses which to keep. Invalid choices are reported using the engine's error message, and the dialog stays open. Passing asks for confirmation first.

## Reports and game over

After resolution, a resurrection report shows who attempted and, for every attempt, the body's Vitality total, and the Humanity roll's dice, sources, threshold, score and outcome. It stays until dismissed. When a monster is created, the report appears before the control chain begins, and again after each decision that produced new events, so it also shows every control roll with its dice and modifiers, every decline, skip and suspicion change. The game-over screen shows the reason, the winners and their roles, every player's objective, the unseen card, the final round and suspicion, and buttons to view the board, export the save or start a new game.

## Subduing monsters

Subduing is a public decision, so there is no pass-the-device screen. While a human player is deciding in a control chain (spec 025), a dialog over the board names the monster's creator and shows the player's exact chance of a successful control roll, what a success gives them, the suspicion a decline adds, and who comes next in the chain, or that nobody else can stop the monster. It offers Try to subdue and Let it pass. Every player panel shows that player's control chance and whether they can subdue, and the turn bar names who is deciding.

## Game controls

- **Rules**: the rulebook, as in the main menu.
- **Print**: opens the print view (spec 032) in a new tab.
- **Export** and **Import**: spec 013.
- **Restart**: asks for confirmation, then starts a new game with the same players and seat assignments.
- **Menu**: return to the main menu.

The game saves automatically after every committed command. If storage is unavailable, a banner warns that the game is held in memory only.

## Debug mode

Debug mode is optional and clearly marked with a magenta **DEBUG** badge. It provides:

- the seed, engine version and command count;
- all objectives, the unseen card, the resolution order and deck order;
- the active player's legal commands and the authoritative state;
- a box for dispatching raw JSON commands, which still go through the engine;
- a download of the replay record.

It warns that it reveals hidden information.
