// Print and play (spec 032): components, pagination, the Markdown renderer
// and the rulebook's freshness check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_CONFIG, OBJECTIVE_INFO, resolveConfig, objectiveDeckFor, capacityFor } from '../src/engine/index.js';
import { buildSections, paginate, componentIds, diceTable, partDrawTables, objectiveCopies, LAYOUTS } from '../src/ui/print-components.js';
import { renderMarkdown } from '../src/ui/markdown.js';
import { rulesFingerprint, recordedFingerprint, RULEBOOK_PATH } from '../bin/rulebook-fingerprint.mjs';

const rulebook = readFileSync(new URL(`../${RULEBOOK_PATH}`, import.meta.url), 'utf8');
const all = () => true;

test('the rulebook records the current rules fingerprint', () => {
  const now = rulesFingerprint();
  assert.equal(recordedFingerprint(), now,
    `Gameplay (02x specs or default configuration) changed. Review ${RULEBOOK_PATH}, update it, then set <!-- rules-fingerprint: ${now} -->.`);
});

test('the rulebook names every action, research type, part variant and objective', () => {
  const cfg = DEFAULT_CONFIG;
  const names = [
    ...Object.values(cfg.actions).flatMap((a) => [a.name, a.location]),
    ...Object.values(cfg.research).map((r) => r.name),
    ...Object.values(cfg.partVariants).map((v) => v.name),
    ...Object.values(OBJECTIVE_INFO).map((o) => o.name),
  ];
  for (const n of names) assert.ok(rulebook.includes(n), `rulebook does not mention ${n}`);
});

test('there is a component for every action space, objective, research type and part variant', () => {
  const ids = componentIds(buildSections());
  assert.equal(new Set(ids).size, ids.length, 'component IDs are unique');
  for (const id of Object.keys(DEFAULT_CONFIG.actions)) assert.ok(ids.includes(`action:${id}`), id);
  for (const id of Object.keys(DEFAULT_CONFIG.research)) assert.ok(ids.includes(`research:${id}`), id);
  for (const id of Object.keys(DEFAULT_CONFIG.partVariants)) assert.ok(ids.includes(`part:${id}`), id);
  for (const id of Object.keys(OBJECTIVE_INFO)) assert.ok(ids.includes(`objective:${id}`), id);
  for (const id of ['rulebook', 'village-board', 'player-mats', 'player-aids', 'workers:scientist', 'workers:igor', 'money:1', 'money:5']) assert.ok(ids.includes(id), id);
});

test('card counts come from the configuration and cover every player count', () => {
  const sections = buildSections();
  const comp = (id) => sections.flatMap((s) => s.components).find((c) => c.id === id);
  assert.equal(comp('research:galvanism').copies, DEFAULT_CONFIG.researchCopies);
  const copies = objectiveCopies(resolveConfig({ playerCount: 6 }));
  for (let n = 3; n <= 6; n++) {
    const deck = objectiveDeckFor(resolveConfig({ playerCount: n }));
    for (const o of new Set(deck)) assert.ok(copies[o] >= deck.filter((x) => x === o).length, `${o} at ${n} players`);
  }
  assert.equal(comp('objective:prometheus').copies, 4);
  assert.equal(comp('workers:igor').copies, 6 * DEFAULT_CONFIG.maxIgors);
  // Overrides flow through: more research copies print more cards.
  const more = buildSections({ config: { researchCopies: 5 } }).flatMap((s) => s.components).find((c) => c.id === 'research:medicine');
  assert.equal(more.copies, 5);
});

test('action tiles show a slot per capacity, marking slots used only at higher player counts', () => {
  const tile = (id) => buildSections().find((s) => s.id === 'actions').components.find((c) => c.id === `action:${id}`).render(0);
  const big = capacityFor(resolveConfig({ playerCount: 6 }), 'graves');
  const small = capacityFor(resolveConfig({ playerCount: 3 }), 'graves');
  assert.equal((tile('graves').match(/class="pp-slot[ "]/g) || []).length, big);
  assert.equal((tile('graves').match(/pp-slot-more/g) || []).length, big - small);
  assert.match(tile('graves'), /d6: 1–4 → \+1 suspicion/);
  assert.match(tile('medicine'), /No limit/);
  assert.match(tile('garrison'), /Igors only/);
  assert.match(tile('prepare'), /Scientist only/);
});

test('dice tables reproduce the engine\'s random part odds exactly', () => {
  const cfg = DEFAULT_CONFIG;
  const t = partDrawTables(cfg);
  const totalWeight = Object.values(cfg.partTypes).reduce((a, p) => a + p.weight, 0);
  const share = (table, id) => {
    const row = table.rows.find((r) => r.id === id);
    const used = table.rerollFrom ? table.rerollFrom - 1 : table.die;
    return (row.to - row.from + 1) / used;
  };
  for (const [vid, v] of Object.entries(cfg.partVariants)) {
    const siblings = Object.values(cfg.partVariants).filter((x) => x.type === v.type).length;
    const expected = (cfg.partTypes[v.type].weight / totalWeight) / siblings;
    const actual = share(t.type, v.type) * share(t.variants[v.type], vid);
    assert.ok(Math.abs(expected - actual) < 1e-12, `${vid}: ${actual} vs ${expected}`);
  }
  assert.equal(t.type.die, 6);
  assert.equal(t.variants.head.die, 4);
  // Counts that don't divide a die reroll the spare faces.
  const five = diceTable([1, 2, 3, 4, 5].map((i) => ({ id: i, label: i, weight: 1 })));
  assert.equal(five.die, 10);
  const seven = diceTable([1, 2, 3, 4, 5, 6, 7].map((i) => ({ id: i, label: i, weight: 1 })));
  assert.deepEqual([seven.die, seven.rerollFrom], [8, 8]);
  assert.equal(diceTable([{ id: 'x', label: 'x', weight: 1.5 }]), null);
});

test('disabled components are left out and the rest repack onto fewer pages', () => {
  const sections = buildSections();
  const full = paginate(sections, all, { backs: false });
  const researchPages = full.filter((p) => p.section === 'research');
  assert.equal(researchPages.length, Math.ceil(28 / LAYOUTS.card.perPage));
  const only = new Set(['research:galvanism']);
  const some = paginate(sections, (id) => only.has(id), { backs: false });
  assert.equal(some.length, 1);
  assert.equal(some[0].items.length, DEFAULT_CONFIG.researchCopies);
  assert.deepEqual(paginate(sections, () => false), []);
});

test('card backs follow each page of cards, mirrored for long-edge duplex', () => {
  const sections = buildSections();
  const pages = paginate(sections, (id) => id === 'objective:prometheus' || id === 'objective:visionary', { backs: true });
  assert.equal(pages.length, 2);
  assert.ok(!pages[0].isBack && pages[1].isBack);
  assert.equal(pages[1].items.length, 6, 'five cards pad to two full rows of backs');
  // Row 1 holds cards 1–3, so its backs are reversed; row 2 holds 4–5 and a blank, reversed to blank-first.
  assert.match(pages[1].items[3], /pp-blank/);
  assert.match(pages[1].items[4], /pp-back/);
  const noBacks = paginate(sections, (id) => id.startsWith('objective:'), { backs: false });
  assert.ok(noBacks.every((p) => !p.isBack));
  const partPages = paginate(sections, (id) => id.startsWith('part:'), { backs: true });
  assert.ok(partPages.every((p) => !p.isBack), 'body parts need no backs');
});

test('the Markdown renderer handles the rulebook\'s constructs and escapes HTML', () => {
  const html = renderMarkdown(`<!-- hidden -->
# Title

Some **bold**, *italic* and \`code\` with <script>.

- one
  - nested
- two

1. first
2. second

| A | B |
|---|--:|
| x | 1 |

> note
`);
  assert.ok(!html.includes('hidden'));
  assert.match(html, /<h1 id="title">Title<\/h1>/);
  assert.match(html, /<b>bold<\/b>, <i>italic<\/i> and <code>code<\/code> with &lt;script&gt;/);
  assert.match(html, /<ul><li>one<ul><li>nested<\/li><\/ul><\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.match(html, /<th>A<\/th><th style="text-align:right">B<\/th>/);
  assert.match(html, /<blockquote><p>note<\/p><\/blockquote>/);
  const book = renderMarkdown(rulebook);
  assert.ok(!book.includes('rules-fingerprint'));
  assert.ok(!/^\s*\|/m.test(book), 'every table is rendered');
});

test('print components are pure: no DOM or storage', () => {
  for (const f of ['print-components.js', 'markdown.js']) {
    const src = readFileSync(new URL(`../src/ui/${f}`, import.meta.url), 'utf8');
    for (const banned of ['window', 'document', 'localStorage', 'fetch(']) assert.ok(!src.includes(banned), `${f} uses ${banned}`);
  }
});
