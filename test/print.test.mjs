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
  for (const id of ['rulebook', 'village-board', 'player-sheets', 'workers:1', 'workers:6', 'marker:suspicion']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.some((id) => id.startsWith('money:')), 'money is not printed');
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
  assert.equal(comp('objective:prometheus').copies, 3);
  assert.equal(comp('objective:unleasher').copies, 2, 'six players deal two Unleashers');
  assert.equal(comp('workers:1').copies, 1 + DEFAULT_CONFIG.maxIgors);
  // Overrides flow through: more research copies print more cards.
  const more = buildSections({ config: { researchCopies: 5 } }).flatMap((s) => s.components).find((c) => c.id === 'research:medicine');
  assert.equal(more.copies, 5);
  // So do per-type counts (spec 023).
  const fewer = buildSections({ config: { research: { restraint: { copies: 2 } } } }).flatMap((s) => s.components).find((c) => c.id === 'research:restraint');
  assert.equal(fewer.copies, 2);
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
  const full = paginate(sections, all);
  const researchPages = full.filter((p) => p.section === 'research');
  assert.equal(researchPages.length, Math.ceil(28 / LAYOUTS.card.perPage));
  const only = new Set(['research:galvanism']);
  const some = paginate(sections, (id) => only.has(id));
  assert.equal(some.length, 1);
  assert.equal(some[0].items.length, DEFAULT_CONFIG.researchCopies);
  assert.deepEqual(paginate(sections, () => false), []);
});

test('all action spaces fit on one page; the village board has no round track or unseen-objective space', () => {
  const sections = buildSections();
  const pages = paginate(sections, all).filter((p) => p.section === 'actions');
  assert.equal(pages.length, 1);
  assert.equal(pages[0].items.length, Object.keys(DEFAULT_CONFIG.actions).length);
  const board = sections.find((s) => s.id === 'village').components[0].render(0);
  assert.doesNotMatch(board, /Round|Unseen/);
  assert.equal((board.match(/<b>Market<\/b>/g) || []).length, DEFAULT_CONFIG.marketSize);
  const ids = componentIds(sections);
  assert.ok(!ids.includes('marker:round'));
  assert.ok(paginate(sections, all).every((p) => !p.items.some((h) => h.includes('pp-back'))), 'no card backs');
});

test('one page per player sheet; all workers on one page; the suspicion track is one line', () => {
  const sections = buildSections();
  const pages = paginate(sections, all);
  assert.equal(pages.filter((p) => p.section === 'players').length, 6);
  const workers = pages.filter((p) => p.section === 'workers');
  assert.equal(workers.length, 1);
  assert.equal(workers[0].items.length, 6 * (1 + DEFAULT_CONFIG.maxIgors));
  assert.equal(workers[0].items.filter((h) => h.includes('pp-worker-scientist')).length, 6);
  assert.ok(workers[0].items.every((h) => h.includes('<svg')), 'every worker has an icon');
  const board = sections.find((s) => s.id === 'village').components[0].render(0);
  assert.match(board, /pp-track pp-track-line/);
  const sheet = sections.find((s) => s.id === 'players').components[0].render(0);
  assert.match(sheet, /Random body part/);
  assert.match(sheet, /Control attempts/);
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
  assert.match(renderMarkdown('![A logo](logo.png)', { base: 'assets/' }), /<img src="assets\/logo.png" alt="A logo">/);
  assert.match(renderMarkdown('![x](https://example.com/a.png)', { base: 'assets/' }), /src="https:\/\/example.com\/a.png"/);
  assert.doesNotMatch(renderMarkdown('![x](javascript:alert(1))'), /<img/);
  const book = renderMarkdown(rulebook, { base: 'assets/' });
  assert.match(book, /<img src="assets\/logo.png"/);
  assert.ok(!book.includes('rules-fingerprint'));
  assert.ok(!/^\s*\|/m.test(book), 'every table is rendered');
});

test('print components are pure: no DOM or storage', () => {
  for (const f of ['print-components.js', 'markdown.js']) {
    const src = readFileSync(new URL(`../src/ui/${f}`, import.meta.url), 'utf8');
    for (const banned of ['window', 'document', 'localStorage', 'fetch(']) assert.ok(!src.includes(banned), `${f} uses ${banned}`);
  }
});
