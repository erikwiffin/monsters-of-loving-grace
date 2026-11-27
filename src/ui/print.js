// Print-and-play view (spec 032), opened at index.html?print.
// Renders components from print-components.js and lets the player choose
// which to print. No rules logic and no game state.

import { esc } from './format.js';
import { renderMarkdown } from './markdown.js';
import { buildSections, paginate } from './print-components.js';

const RULEBOOK_URL = 'assets/rulebook.md';
const STORE_KEY = 'molg-print-v1';
const root = document.getElementById('app');

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(prefs)); } catch { /* in memory only */ }
}

const stored = load();
const prefs = {
  disabled: Array.isArray(stored.disabled) ? stored.disabled : [],
  paper: stored.paper === 'a4' ? 'a4' : 'letter',
};
let sections = [];

const isEnabled = (id) => !prefs.disabled.includes(id);
function setEnabled(ids, on) {
  const set = new Set(prefs.disabled);
  for (const id of ids) (on ? set.delete(id) : set.add(id));
  prefs.disabled = [...set];
  save();
  render();
}

function pageStyle() {
  const size = prefs.paper === 'a4' ? 'A4' : 'letter';
  return `@page { size: ${size} portrait; margin: 7mm; }`;
}

function controls(pages) {
  const sheetCount = pages.filter((p) => p.layout !== 'flow').length;
  const flow = pages.some((p) => p.layout === 'flow');
  const sectionHtml = sections.map((s) => {
    const ids = s.components.map((c) => c.id);
    const on = ids.filter(isEnabled).length;
    const boxes = s.components.map((c) => `<label class="pp-check"><input type="checkbox" data-id="${esc(c.id)}" ${isEnabled(c.id) ? 'checked' : ''}> <span>${esc(c.name)}${c.copies > 1 ? ` <small>×${c.copies}</small>` : ''}</span></label>`).join('');
    return `<fieldset class="pp-section"><legend>${esc(s.name)} <small>${on}/${ids.length}</small></legend>
      <div class="pp-section-btns"><button data-section-on="${esc(s.id)}">All</button><button data-section-off="${esc(s.id)}">None</button></div>
      ${boxes}
    </fieldset>`;
  }).join('');
  return `<aside class="pp-controls">
    <h1>Print and play</h1>
    <p class="muted small">Print at 100% scale (“actual size”). Cut along the dashed lines. Untick anything you don't need to reprint.</p>
    <div class="pp-row"><button class="big" data-act="print">Print</button><a href="./" class="pp-back-link">Back to the game</a></div>
    <p class="pp-count"><b>${sheetCount}</b> component page${sheetCount === 1 ? '' : 's'}${flow ? ' + the rulebook' : ''}</p>
    <div class="pp-row"><button data-act="all-on">Enable all</button><button data-act="all-off">Disable all</button></div>
    <label>Paper <select id="pp-paper"><option value="letter" ${prefs.paper === 'letter' ? 'selected' : ''}>US Letter</option><option value="a4" ${prefs.paper === 'a4' ? 'selected' : ''}>A4</option></select></label>
    ${sectionHtml}
  </aside>`;
}

function pagesHtml(pages) {
  if (!pages.length) return '<p class="pp-empty">Nothing selected to print.</p>';
  return pages.map((p) => (p.layout === 'flow'
    ? `<div class="pp-page pp-flow">${p.items.join('')}</div>`
    : `<div class="pp-page pp-L-${p.layout}"><div class="pp-grid">${p.items.join('')}</div></div>`)).join('');
}

function render() {
  const pages = paginate(sections, isEnabled);
  const scroll = root.querySelector('.pp-controls')?.scrollTop || 0;
  root.innerHTML = `<style>${pageStyle()}</style>
    <div class="pp-view paper-${prefs.paper}">${controls(pages)}<main class="pp-pages">${pagesHtml(pages)}</main></div>`;
  const panel = root.querySelector('.pp-controls');
  if (panel) panel.scrollTop = scroll;
}

root.addEventListener('click', (ev) => {
  const t = ev.target.closest('button');
  if (!t) return;
  const all = sections.flatMap((s) => s.components.map((c) => c.id));
  const sectionIds = (id) => sections.find((s) => s.id === id).components.map((c) => c.id);
  if (t.dataset.act === 'print') window.print();
  else if (t.dataset.act === 'all-on') setEnabled(all, true);
  else if (t.dataset.act === 'all-off') setEnabled(all, false);
  else if (t.dataset.sectionOn) setEnabled(sectionIds(t.dataset.sectionOn), true);
  else if (t.dataset.sectionOff) setEnabled(sectionIds(t.dataset.sectionOff), false);
});

root.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.dataset.id) setEnabled([t.dataset.id], t.checked);
  else if (t.id === 'pp-paper') { prefs.paper = t.value === 'a4' ? 'a4' : 'letter'; save(); render(); }
});

async function start() {
  document.title = 'Print and play — Monsters of Loving Grace';
  document.body.classList.add('print-view');
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = 'src/ui/print.css';
  document.head.append(css);
  let rulebookHtml;
  try {
    const res = await fetch(RULEBOOK_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    rulebookHtml = renderMarkdown(await res.text(), { base: RULEBOOK_URL.replace(/[^/]*$/, '') });
  } catch (err) {
    rulebookHtml = `<p class="pp-error">The rulebook could not be loaded (${esc(err.message)}).</p>`;
  }
  sections = buildSections({ rulebookHtml });
  render();
}

start();
