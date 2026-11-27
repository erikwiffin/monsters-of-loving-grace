// Print-and-play components (spec 032), built from engine configuration.
// Pure: returns data and HTML strings, never touches the DOM, so it also runs
// in Node tests. Contains no rules logic — every number comes from the engine.

import * as E from '../engine/index.js';
import { esc, actionText, effectText } from './format.js';

export const MAX_PLAYERS = 6;
export const MIN_PLAYERS = 3;
export const SEAT_COLOURS = ['#e03131', '#1971c2', '#e8590c', '#6741d9', '#2f9e44', '#c2255c'];
export const SEAT_NAMES = ['Red', 'Blue', 'Orange', 'Violet', 'Green', 'Magenta'];

/** Items per printed page for each layout. 'flow' pages break naturally. */
export const LAYOUTS = {
  flow: { perPage: null },
  sheet: { perPage: 1 },
  actions: { perPage: 12 }, // day in the left column, night in the right
  card: { perPage: 9 },
  part: { perPage: 36 },
  worker: { perPage: 24 },
  token: { perPage: 70 },
};

const range = (n) => Array.from({ length: n }, (_, i) => i);
const configFor = (cfg, playerCount) => ({ ...cfg, playerCount });
const PART_COPIES_PER_SLOT = 4;

// ---------------------------------------------------------------------------
// Dice tables: turn integer weights into a physical roll with the same odds.
// ---------------------------------------------------------------------------

/**
 * entries: [{ id, label, weight }] with positive integer weights.
 * Returns { die, rows: [{ id, label, from, to }], rerollFrom } or null when
 * no single die can represent the weights. Each weight unit gets the same
 * number of faces; faces above the last row (rerollFrom..die) are rerolled.
 */
export function diceTable(entries) {
  if (!entries.length || entries.some((e) => !Number.isInteger(e.weight) || e.weight < 1)) return null;
  const total = entries.reduce((a, e) => a + e.weight, 0);
  const dice = [...E.ALLOWED_DICE].sort((a, b) => a - b);
  let die = dice.find((d) => d % total === 0);
  if (!die) die = dice.find((d) => d >= total);
  if (!die) return null;
  const per = Math.floor(die / total);
  let face = 1;
  const rows = entries.map((e) => {
    const from = face;
    face += e.weight * per;
    return { id: e.id, label: e.label, from, to: face - 1 };
  });
  return { die, rows, rerollFrom: face <= die ? face : null };
}

/** The two-step body-part draw of spec 024 as dice tables. */
export function partDrawTables(cfg) {
  const type = diceTable(Object.entries(cfg.partTypes).map(([id, t]) => ({ id, label: t.name, weight: t.weight })));
  const variants = {};
  for (const id of Object.keys(cfg.partTypes)) {
    variants[id] = diceTable(Object.entries(cfg.partVariants)
      .filter(([, v]) => v.type === id)
      .map(([vid, v]) => ({ id: vid, label: v.name, weight: 1 })));
  }
  return { type, variants };
}

const faces = (r) => (r.from === r.to ? `${r.from}` : `${r.from}–${r.to}`);

function diceTableHtml(t, caption) {
  if (!t) return `<p class="pp-small">${esc(caption)}: shuffle one of each option face down and draw one.</p>`;
  return `<table class="pp-dice"><caption>${esc(caption)} — roll d${t.die}</caption>
    ${t.rows.map((r) => `<tr><td>${faces(r)}</td><td>${esc(r.label)}</td></tr>`).join('')}
    ${t.rerollFrom ? `<tr><td>${t.rerollFrom === t.die ? t.die : `${t.rerollFrom}–${t.die}`}</td><td>roll again</td></tr>` : ''}
  </table>`;
}

// ---------------------------------------------------------------------------
// Helpers read from configuration via the engine
// ---------------------------------------------------------------------------

/** Worker slots by player count: [{ playerCount, capacity }] for 3–6. */
function capacities(cfg, actionId) {
  return range(MAX_PLAYERS - MIN_PLAYERS + 1).map((i) => {
    const n = MIN_PLAYERS + i;
    return { playerCount: n, capacity: E.capacityFor(configFor(cfg, n), actionId) };
  });
}

/** The most copies of each objective that any player count's deck needs. */
export function objectiveCopies(cfg) {
  const most = {};
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
    const counts = {};
    for (const o of E.objectiveDeckFor(configFor(cfg, n))) counts[o] = (counts[o] || 0) + 1;
    for (const [o, c] of Object.entries(counts)) most[o] = Math.max(most[o] || 0, c);
  }
  return most;
}

function permissionText(def) {
  if (def.scientist === false) return 'Igors only';
  if (def.igor === false) return 'Scientist only';
  return 'Scientist or Igor';
}

function costText(id, def) {
  if (def.cost) return `Cost ${def.cost}`;
  return 'Free';
}

function slotsHtml(cfg, id) {
  const caps = capacities(cfg, id);
  if (caps.some((c) => c.capacity == null)) return '<div class="pp-slots pp-unlimited">No limit</div>';
  const most = Math.max(...caps.map((c) => c.capacity));
  const slots = range(most).map((i) => {
    const from = caps.find((c) => c.capacity > i).playerCount;
    const label = from === MIN_PLAYERS ? '' : `${from}${from < MAX_PLAYERS ? '–' + MAX_PLAYERS : ''}`;
    return `<span class="pp-slot${label ? ' pp-slot-more' : ''}"${label ? ` title="${label} players only"` : ''}>${label ? `<small>${label}</small>` : ''}</span>`;
  });
  return `<div class="pp-slots">${slots.join('')}</div>`;
}

const brand = '<span class="pp-brand">Monsters of Loving Grace</span>';

// ---------------------------------------------------------------------------
// Component renderers
// ---------------------------------------------------------------------------

function villageBoard(cfg) {
  const track = range(cfg.suspicionMax + 1).map((v) => `<span class="pp-box${v === cfg.suspicionMax ? ' pp-mob' : ''}">${v}${v === cfg.suspicionMax ? '<small>MOB</small>' : ''}</span>`).join('');
  const market = range(cfg.marketSize).map((i) => `<div class="pp-cardslot"><b>Market</b><small>slot ${i + 1}</small></div>`).join('');
  const deckSize = Object.keys(cfg.research).length * cfg.researchCopies;
  return `<div class="pp-board">
    <h2>${brand}<span>The village</span></h2>
    <section><h3>Suspicion <small>starts at 0 · the mob forms at ${cfg.suspicionMax}</small></h3><div class="pp-track pp-track-line">${track}</div></section>
    <section class="pp-market">
      <div class="pp-cardslot pp-deck"><b>Research deck</b><small>${deckSize} cards, face down. Experiments draw from the top and return cards to the bottom.</small></div>
      ${market}
    </section>
    <p class="pp-small">When a market card is taken, refill the slot from the top of the deck at once. When the deck runs out, the market shrinks.</p>
  </div>`;
}

function actionTile(cfg, id, def) {
  const phase = def.phase === 'day' ? '☀ Day' : '☾ Night';
  const note = id === 'charity' ? '<p class="pp-small">Only while suspicion is above 0.</p>' : '';
  return `<div class="pp-tile pp-${def.phase}">
    <div class="pp-tile-text">
      <div class="pp-tile-head"><span>${phase} · ${esc(def.location)}</span><span>${costText(id, def)} · ${permissionText(def)}</span></div>
      <h3>${esc(def.name)}</h3>
      <p>${esc(actionText(id, def, cfg))}</p>
      ${note}
    </div>
    ${slotsHtml(cfg, id)}
  </div>`;
}

function playerSheet(cfg, seat) {
  const slot = (s) => `<div class="pp-bodyslot" style="grid-area:${s}"><b>${esc(cfg.partTypes[s.replace(/\d$/, '')]?.name || s)}</b></div>`;
  const attemptsMax = cfg.control.startingAttempts + cfg.researchCopies;
  const attempts = range(attemptsMax + 1).map((v) => `<span class="pp-box pp-box-s${v === cfg.control.startingAttempts ? ' pp-start' : ''}">${v}</span>`).join('');
  const t = partDrawTables(cfg);
  const r = cfg.resurrection;
  const c = cfg.control;
  return `<div class="pp-player" style="--seat:${SEAT_COLOURS[seat]}">
    <h2>${brand}<span>${SEAT_NAMES[seat]} scientist</span></h2>
    <div class="pp-player-top">
      <div class="pp-body">${E.SLOT_ORDER.map(slot).join('')}</div>
      <div>
        <h4>Random body part</h4>
        ${diceTableHtml(t.type, 'Type')}
        ${Object.entries(t.variants).map(([id, v]) => diceTableHtml(v, cfg.partTypes[id].name)).join('')}
      </div>
    </div>
    <section><h3>Control attempts <small>start at ${c.startingAttempts}; +1 per effective Neural Conditioning</small></h3><div class="pp-track pp-track-line">${attempts}</div></section>
    <div class="pp-aid-cols">
      <div>
        <h4>Round</h4>
        <ol><li><b>Day</b>: in turn, place a worker and resolve it, or pass.</li>
          <li><b>Night</b>: the same. Scientists refresh; Igors used by day stay used.</li>
          <li><b>Resolution</b>: prepared resurrections, in turn order.</li>
          <li><b>Dawn</b>: any stable Creature ends the game. Otherwise the rester goes first, or initiative passes left.</li></ol>
        <p class="pp-small">Keep money and loose parts beside this sheet. Lay research cards above it, face up: those you <b>published</b> in one row, those <b>kept from experiments</b> in another.</p>
      </div>
      <div>
        <h4>Resurrection</h4>
        <p>Discard all six installed parts. Roll d${r.baseDie} + modifiers for Vitality (${r.thresholds.vitality}+) and Humanity (${r.thresholds.humanity}+).</p>
        <ul><li>Vitality fails: keep ${r.failedVitalityRefund} of the parts at random; suspicion +${r.failedVitalitySuspicion}.</li>
          <li>Both succeed: a stable Creature.</li>
          <li>Humanity fails: a monster. Control chain from its creator, clockwise.</li></ul>
        <h4>Control roll</h4>
        <p>Spend an attempt: d${c.baseDie} + control research, ${c.threshold}+ subdues (take ${c.subdueSalvage} parts at random, suspicion +${c.subdueSuspicion}). Declining: suspicion +${c.declineSuspicion}. Other players' monsters need your Igor in the garrison.</p>
      </div>
    </div>
  </div>`;
}

function objectiveCard(id) {
  const o = E.OBJECTIVE_INFO[id];
  return `<div class="pp-card pp-objective"><div class="pp-kind">Secret objective</div><h3>${esc(o.name)}</h3><p class="pp-summary">${esc(o.summary)}</p><p>${esc(o.condition)}</p><div class="pp-foot">${brand}</div></div>`;
}

function researchCard(cfg, id) {
  const r = cfg.research[id];
  return `<div class="pp-card pp-research"><div class="pp-kind">Research</div><h3>${esc(r.name)}</h3><p>${esc(r.text)}</p><p class="pp-small">Every effective copy applies: your own discovery, plus one for each publication by another player.</p><div class="pp-foot">${brand}</div></div>`;
}

function partCard(cfg, id) {
  const v = cfg.partVariants[id];
  const type = cfg.partTypes[v.type];
  const effects = v.effects.length ? v.effects.map((e) => esc(effectText(e))).join('<br>') : 'No effect';
  return `<div class="pp-part pp-part-${esc(v.type)}"><div class="pp-kind">${esc(type.name)}</div><h4>${esc(v.name)}</h4><p>${effects}</p></div>`;
}

// Simple line illustrations, drawn in white on the seat colour.
const ICONS = {
  scientist: `<svg viewBox="0 0 40 40" aria-hidden="true">
    <path d="M11 15 L8 9 L13 11 L13 5 L17 9 L20 3 L23 9 L27 5 L27 11 L32 9 L29 15 Z" fill="#fff"/>
    <circle cx="20" cy="17" r="7.5" fill="#fff"/>
    <circle cx="16.8" cy="16.5" r="2.6" fill="none" stroke="#1e1e1e" stroke-width="1.4"/>
    <circle cx="23.2" cy="16.5" r="2.6" fill="none" stroke="#1e1e1e" stroke-width="1.4"/>
    <path d="M19.4 16.5 h1.2" stroke="#1e1e1e" stroke-width="1.2"/>
    <path d="M17.5 21 q2.5 1.6 5 0" fill="none" stroke="#1e1e1e" stroke-width="1"/>
    <path d="M9 39 L12 28 Q20 24.5 28 28 L31 39 Z" fill="#fff"/>
    <path d="M20 27 L20 39" stroke="#1e1e1e" stroke-width=".8"/>
    <path d="M31 21 h4 M33 21 v4 l2.5 6 h-7 l2.5-6" fill="#fff" stroke="#fff" stroke-width="1.2" stroke-linejoin="round"/>
  </svg>`,
  igor: `<svg viewBox="0 0 40 40" aria-hidden="true">
    <path d="M6 39 L8 24 Q9 12 19 12 Q27 13 27 22 L29 39 Z" fill="#fff"/>
    <circle class="pp-outline" cx="27" cy="24" r="6.3" fill="#fff" stroke-width="1.6"/>
    <path d="M23 18.5 l-1 -2.5 M26 17.8 l0 -2.6 M29 18.3 l1.2 -2.3" stroke="#fff" stroke-width="1" stroke-linecap="round"/>
    <circle cx="29" cy="23" r="2.1" fill="#1e1e1e"/>
    <circle cx="24.8" cy="23.6" r="1" fill="#1e1e1e"/>
    <path d="M25 27.6 h4.5" stroke="#1e1e1e" stroke-width="1" stroke-linecap="round"/>
    <path class="pp-outline" d="M15 26 Q21 31 31 31" fill="none" stroke-width="1.4"/>
    <path d="M31 31 L34 31 L34 32.5" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>
    <rect x="31.5" y="32.5" width="5" height="6" rx="1" fill="#fff"/>
    <rect x="33" y="34" width="2" height="3" fill="#ffd43b"/>
  </svg>`,
};

function workerTile(seat, kind) {
  const label = kind === 'scientist' ? 'Scientist' : 'Igor';
  return `<div class="pp-worker pp-worker-${kind}" style="--seat:${SEAT_COLOURS[seat]}">${ICONS[kind]}<b>${label}</b><small>${SEAT_NAMES[seat]}</small></div>`;
}

const token = (label, extra = '', style = '') => `<div class="pp-token ${extra}"${style ? ` style="${style}"` : ''}>${label}</div>`;

// ---------------------------------------------------------------------------
// The component list
// ---------------------------------------------------------------------------

/**
 * Every print-and-play component, grouped into sections, from a configuration
 * (default: the engine's default configuration at six players).
 * A component is { id, name, copies, render(i) → html }.
 * rulebookHtml is the rendered rulebook, supplied by the caller.
 */
export function buildSections({ config = {}, rulebookHtml = '' } = {}) {
  const cfg = E.resolveConfig({ ...config, playerCount: MAX_PLAYERS });
  const actions = Object.entries(cfg.actions);
  const objectives = objectiveCopies(cfg);
  const seats = range(MAX_PLAYERS);
  return [
    { id: 'rulebook', name: 'Rulebook', layout: 'flow', components: [
      { id: 'rulebook', name: 'Rulebook', copies: 1, render: () => `<div class="pp-rulebook">${rulebookHtml}</div>` },
    ] },
    { id: 'village', name: 'Village board', layout: 'sheet', components: [
      { id: 'village-board', name: 'Village board', copies: 1, render: () => villageBoard(cfg) },
    ] },
    { id: 'actions', name: 'Action spaces', layout: 'actions', components: [
      ...actions.filter(([, d]) => d.phase === 'day'), ...actions.filter(([, d]) => d.phase === 'night'),
    ].map(([id, def]) => ({ id: `action:${id}`, name: `${def.name} (${def.phase})`, copies: 1, render: () => actionTile(cfg, id, def) })) },
    { id: 'players', name: 'Player sheets', layout: 'sheet', components: [
      { id: 'player-sheets', name: 'Player sheet', copies: MAX_PLAYERS, render: (i) => playerSheet(cfg, i) },
    ] },
    { id: 'objectives', name: 'Objective cards', layout: 'card', components:
      Object.keys(E.OBJECTIVE_INFO).filter((id) => objectives[id]).map((id) => ({
        id: `objective:${id}`, name: E.OBJECTIVE_INFO[id].name, copies: objectives[id], render: () => objectiveCard(id),
      })) },
    { id: 'research', name: 'Research cards', layout: 'card', components:
      Object.keys(cfg.research).map((id) => ({
        id: `research:${id}`, name: cfg.research[id].name, copies: cfg.researchCopies, render: () => researchCard(cfg, id),
      })) },
    { id: 'parts', name: 'Body parts', layout: 'part', components:
      Object.keys(cfg.partVariants).map((id) => ({
        id: `part:${id}`, name: cfg.partVariants[id].name,
        copies: cfg.partTypes[cfg.partVariants[id].type].slots.length * PART_COPIES_PER_SLOT,
        render: () => partCard(cfg, id),
      })) },
    { id: 'workers', name: 'Workers', layout: 'worker', components: seats.map((seat) => ({
      id: `workers:${seat + 1}`, name: `${SEAT_NAMES[seat]} workers`, copies: 1 + cfg.maxIgors,
      render: (i) => workerTile(seat, i === 0 ? 'scientist' : 'igor'),
    })) },
    { id: 'tokens', name: 'Tokens', layout: 'token', components: [
      { id: 'marker:suspicion', name: 'Suspicion marker', copies: 1, render: () => token('<b>!</b><small>suspicion</small>', 'pp-marker') },
      { id: 'marker:first', name: 'First-player marker', copies: 1, render: () => token('<b>1st</b><small>player</small>', 'pp-marker') },
      { id: 'marker:control', name: 'Control-attempt markers', copies: MAX_PLAYERS, render: (i) => token('<b>⚡</b><small>control</small>', 'pp-marker pp-seat', `--seat:${SEAT_COLOURS[i]}`) },
    ] },
  ];
}

/** Every component ID, in print order. */
export const componentIds = (sections) => sections.flatMap((s) => s.components.map((c) => c.id));

/**
 * Lay the enabled components out on pages. Returns
 * [{ section, layout, items: [html] }] — one entry per printed page
 * (a 'flow' entry may print as several pages).
 */
export function paginate(sections, enabled) {
  const pages = [];
  for (const s of sections) {
    const items = s.components.filter((c) => enabled(c.id))
      .flatMap((c) => range(c.copies).map((i) => c.render(i)));
    if (!items.length) continue;
    const n = LAYOUTS[s.layout].perPage || items.length;
    for (let i = 0; i < items.length; i += n) pages.push({ section: s.id, layout: s.layout, items: items.slice(i, i + n) });
  }
  return pages;
}
