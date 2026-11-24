# Working on Monsters of Loving Grace

The `specs/` directory is the source of truth for what this project should do. Start with `specs/000-specs.md`.

- Before changing code, read the specs that cover the area you are touching.
- Do not create a new spec unless the designer asks for one or approves your proposal. Specs are free-form prose of 1,000 words or fewer.
- Do not edit an existing spec without asking first. If a request contradicts a spec, name the spec and the behaviour in conflict and ask before changing anything. Once approved, update the spec and the code in the same commit.
- If a spec and the code disagree, report it and ask which one is right.
- Before pushing, run `npm test` and `node bin/simulate.mjs --games 20 --policy heuristic,random`. Both must pass with no invalid commands. Then re-read the relevant specs to confirm that no specified behaviour changed.
- The rules live only in `src/engine/`. The UI (`src/ui/`) and the simulator (`src/sim/`) must go through the engine API and never re-implement rules.
