# 013 — Persistence, save files and replay

Games must survive page reloads, move between devices as files, and be reproducible exactly from their inputs.

## Replay record

Every game records:

- its configuration overrides;
- its seed;
- the engine version;
- the ordered list of accepted commands.

This record alone deterministically reproduces the whole game. `replay({ config, seed, commands })` rebuilds a game and throws if any command is rejected along the way. `getReplayRecord(state)` extracts the record from a state.

## Serialization

`serialize(state)` produces JSON. `deserialize(json)` parses it and validates it:

- the format marker, the schema version and the RNG state shape;
- the phase, and that the core collections are present;
- by default, that replaying the state's own seed, configuration and command log reproduces the saved state exactly.

Any mismatch is reported as an error, which catches hand-edited or corrupted saves. A save from a different schema version is rejected with a clear message.

Saves preserve all rule-relevant state:

- RNG state, action-space occupancy, and workers that are used or pending;
- objectives;
- the full event history and command log.

Loading a save and continuing gives exactly the same results as if play had never stopped.

## Browser persistence

The browser stores the current game in `localStorage` after every accepted command and every change to interface progress worth keeping. Interface progress means where the objective-dealing sequence has reached, which resurrection reports have been seen, and which seats are AI. Every storage access is wrapped so that errors are caught: if storage is unavailable, blocked or full, play continues in memory and the interface shows a notice suggesting Export.

Storage stores a wrapper object containing a format marker (`molg-save`), the wrapper version, a timestamp, the UI metadata and the engine state. Resume reads this wrapper, runs the engine's validation, and restores the game. Because the engine checks `seq` (spec 011), resuming can never execute a command twice.

## Export and import

Export downloads the same wrapper object as a JSON file. Import accepts such a file, validates it through the engine, and replaces the current game. Export and import must work even when `localStorage` is unavailable. A failed import shows its error and leaves the current game untouched.

The format is JSON-compatible throughout.

## Privacy caveat

Hot-seat privacy is casual. A save file, or browser storage, contains every secret, and anyone using developer tools can read it. This is accepted for a prototype and should be stated in user-facing documentation.
