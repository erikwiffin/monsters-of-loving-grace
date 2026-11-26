# 000 — Specs

This directory holds the specifications that direct development of Monsters of Loving Grace. Each spec describes one behaviour we want: an architectural capability, such as the command bus, or a gameplay mechanic, such as publishing research.

## Purpose

Specs are the source of truth for what the game and its tooling should do. Code, tests and the README describe and enforce that intent, but if they disagree with a spec, the spec wins until the designer says otherwise. Anyone changing the project, human or AI, reads the relevant specs before making a change and checks afterwards that the change has not broken any behaviour a spec describes.

## Creating specs

New specs are only created when the designer asks for one, or approves a proposal to write one. An assistant that thinks a new area deserves a spec should suggest it and wait for an answer rather than writing it. This keeps the directory a deliberate record of agreed behaviour, not a dumping ground for notes.

## Editing specs

Existing specs are not edited without asking first. If the designer requests a change that contradicts a spec, the assistant points out the conflict, names the spec and the behaviour affected, and asks before editing the spec or the code. Once approved, the spec and the code change together in the same commit. Typos and broken links can be fixed without asking, provided the meaning is unchanged.

If a spec is found to disagree with the current implementation, the assistant reports the discrepancy and asks which one is correct, rather than silently "fixing" either.

## Format

- Specs are Markdown files in `specs/`, named `NNN-short-name.md`.
- Numbering groups related specs: `000` is this meta-spec, `01x` covers architecture and tooling, `02x` gameplay rules, and `03x` the browser interface. New specs take the next free number in their group.
- Each spec is 1,000 words or fewer. If a topic grows beyond that, it is split, with the designer's approval, into smaller specs that each describe a coherent behaviour.
- Specs are written as free-form prose. Headings, lists and tables are used where they help, but no fixed template is required. A spec states what should happen, not how the code currently achieves it; it names code only where a name is part of the contract, such as a command type or API function.
- Designer rulings that clarify or override the original v0.3 document are labelled "Ruling" inline, so their origin is clear.
- Several small, closely related topics may share one spec if the combined text stays under the word limit and loses no detail.

## Verifying changes

Before any change is pushed:

1. Run the full test suite (`npm test`) and a short headless simulation batch, such as `node bin/simulate.mjs --games 20 --policy heuristic,random`, and confirm both succeed with no invalid commands.
2. Re-read every spec touching the area changed, and confirm by review that the change does not alter any behaviour they describe.
3. Where a change adds behaviour that a spec already describes, add or update tests covering it.

Tests are the automated safety net; the manual review against specs is required as well, because not every sentence in a spec has a dedicated test.

## Index

| Spec | Topic |
|---|---|
| 000 | Specs (this document) |
| 010 | Engine runtime: portability, determinism, configuration |
| 011 | Command bus: commands, validation, dispatch |
| 013 | Persistence, save files and replay |
| 014 | Headless AI playtesting |
| 015 | Deployment to GitHub Pages |
| 016 | Parameter sweeps |
| 020 | Setup, objectives, suspicion and game end |
| 021 | Round structure and workers |
| 022 | Action spaces |
| 023 | Research engine and publishing |
| 024 | Body parts and assembly |
| 025 | Resurrection |
| 030 | Hot-seat browser interface |
| 031 | In-browser AI seats |
