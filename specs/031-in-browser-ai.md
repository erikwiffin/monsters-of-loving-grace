# 031 — In-browser AI seats

The browser game can mix human and AI players. AI seats use the same policies as headless playtesting (spec 014), with no browser-specific rules or strategy.

## Choosing AI seats

In New Game, each player row has a *Played by* selector with three options: Human, AI — heuristic and AI — random. Any combination is allowed, including all AI, which simply lets you watch a game. An AI seat left unnamed is called "Automaton N". Which seats are AI is saved with the game (spec 013), and kept by Resume, Export/Import, Restart, and starting a new game from the game-over screen.

## Playing

- An AI seat acts on its own after a short delay, about 0.7 seconds, so humans can follow the action in the Chronicle.
- On an AI's turn, the turn bar says "AI is thinking…". Action spaces can't be clicked, and the human-only controls (View my objective, Pass) are hidden.
- An AI seat receives only its own filtered player view and its legal commands, exactly as in headless play. It never sees authoritative state, other players' objectives or the deck order.
- Each AI decision is seeded from the game seed, the seat and the number of commands so far, so a reloaded or resumed game makes the same AI choices.
- If a policy returns an invalid command, or throws an error, the first legal command is played instead.

## Privacy screens

Privacy screens exist only for humans. Objective dealing skips AI seats; with exactly one human, it is a single screen, and with none, it is skipped. AI experiment picks, preparations and subdue decisions are public, and appear in the Chronicle and the resurrection report.

## Pausing and waiting

AI turns wait while any overlay or dialog is open:

- a privacy screen;
- a resurrection report;
- the game-over screen;
- the rules;
- debug tools;
- a confirmation.

So a human always sees reports before play continues. When at least one seat is AI and the game is in progress, a **Pause AI / Resume AI** control appears in the top bar.

## Strength

The built-in policies are simple. They exist for playtesting and casual opponents, not as a tuned challenge. 
