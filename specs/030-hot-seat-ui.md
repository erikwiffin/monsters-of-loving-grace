# 030 — Hot-seat browser interface

The browser game is a local hot-seat prototype for 3–5 players sharing one device. It renders engine views and submits commands; it contains no rules logic. Questions about legality go to the engine, for example by validating a command before showing a space as available.

## Main menu

- **New game**: choose 3–5 players (default 5), enter names (blank names get defaults), and choose who plays each seat (spec 031). In debug mode, a fixed seed and JSON configuration overrides can also be entered.
- **Resume**: continue the game saved in this browser, if there is one.
- **Import save**: load an exported save file.
- **Rules summary**: the public rules, including every possible role and the designer rulings.
- **Developer / debug mode**: a checkbox, remembered per browser.

## Privacy screens

Secret information is shown only behind opaque pass-the-device screens that hide the board completely:

- **Dealing objectives**: at the start of a game, each human player in turn gets a "Pass the device to X" screen, then "I am X — show my objective", then their objective card, then "Hide and pass".
- **Resurrection commitments**: before each eligible human player's decision there is a pass screen. The decision screen shows only that player's objective, body, exact odds and the risks, with Attempt and Decline. A "Decision locked — hide and pass" screen follows, which doesn't reveal the choice.
- **View my objective**: available on the active human player's turn. A confirmation screen ("only X should look") comes first, then the objective is revealed.

This is casual privacy, not protection against browser storage or developer tools.

## Board

The shared board always shows only public information:

- the round and phase, and a plain suspicion meter showing value and maximum;
- a turn bar showing the active player, a selector for their available workers, a Publish button when they have an unpublished discovery, and the pass button;
- every day and night action space, with its location, cost and effect text, capacity, Igor permission and the workers occupying it. Spaces in the current phase are highlighted when the selected worker can legally take them. When a space is unavailable, it explains why;
- the research market and deck count, plus the publication record;
- one panel per player in initiative order, showing money, workers (used, pending, Scientist or Igor), effective research (own copies, copies via publication, published marks), a body diagram, remaining control attempts and whether they are garrisoned, odds for a complete body, loose parts and Creatures;
- the Chronicle, a readable log of public events.

The page switches between a light "day" palette and a dark "night" palette. It works at phone width without horizontal scrolling.

## Taking actions

Choosing a space opens a confirmation dialog for the action's choices:

- market cards for research;
- variant pickers for specimens;
- loose parts for assemble and experiment;
- a summary for simple actions.

Nothing is sent until the player confirms. Publish opens a dialog listing the player's publishable discoveries; choosing one publishes it at once and the turn continues. Invalid choices are reported using the engine's error message, and the dialog stays open. Passing asks for confirmation first.

## Reports and game over

After resolution, a resurrection report shows the revealed commitments and, for every attempt, each attribute's dice, sources, modifiers, threshold, score and outcome. It stays until dismissed. When a monster is created, the report appears before the control chain begins, and again after each decision that produced new events, so it also shows every subdue, decline, skip and suspicion change.

## Subduing monsters

Subduing is a public decision, so there is no pass-the-device screen. While a human player is deciding in a control chain (spec 025), a dialog over the board names the monster's creator and shows the player's remaining control attempts, what subduing gives them, the suspicion a decline adds, and who comes next in the chain, or that nobody else can stop the monster. It offers Subdue it and Let it pass. Every player panel shows that player's remaining control attempts, and the turn bar names who is deciding. The game-over screen shows the reason, the winners and their roles, every player's objective, the unseen card, the final round and suspicion, and buttons to view the board, export the save or start a new game.

## Game controls

- **Export** and **Import**: spec 013.
- **Restart**: asks for confirmation, then starts a new game with the same players and seat assignments.
- **Menu**: return to the main menu.

The game saves automatically after every committed command. If storage is unavailable, a banner warns that the game is held in memory only.

## Debug mode

Debug mode is optional and clearly marked with a magenta **DEBUG** badge. It provides:

- the seed, engine version and command count;
- all objectives, the unseen card, current commitments and deck order;
- the active player's legal commands and the authoritative state;
- a box for dispatching raw JSON commands, which still go through the engine;
- a download of the replay record.

It warns that it reveals hidden information.
