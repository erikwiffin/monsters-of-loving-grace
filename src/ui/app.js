// Browser UI adapter. Renders engine views and submits commands through
// the engine's dispatch(). Contains no rules logic of its own.

import * as E from '../engine/index.js';
import {
  esc, effectText, variantText, variantName, researchName, actionText, workerLabel, describeEvent,
  sourceLabel, attrName, pct,
} from './format.js';
import { POLICIES } from '../sim/policies.js';
import { storageAvailable, writeSave, readSave, clearSave, makeSave, SAVE_FORMAT, readDebugFlag, writeDebugFlag } from './storage.js';

const root = document.getElementById('app');
const HAS_STORAGE = storageAvailable();

const ui = {
  state: null,
  meta: null, // { objIndex, objStep, objectivesDone, reportSeq }
  screen: 'menu',
  modal: null, // { kind, ... }
  selectedWorker: null,
  debug: readDebugFlag(),
  toast: null,
  storageOk: HAS_STORAGE,
  hideGameOver: false,
  menuError: null,
  aiPaused: false,
  logOpen: false, // Chronicle expanded; collapsed it shows only the latest entry
  aiDelay: 700,
  aiTimer: null,
};

const AI_KINDS = { heuristic: 'AI — heuristic', random: 'AI — random' };
const DEFAULT_SEAT_KIND = 'heuristic';
const seatPlaceholder = (kind, i) => `${kind === 'human' ? 'Scientist' : 'Automaton'} ${i + 1}`;
const aiKind = (pid) => (ui.meta && ui.meta.ai && ui.meta.ai[pid]) || null;
const humanIds = () => ui.state.players.filter((p) => !aiKind(p.id)).map((p) => p.id);

const OBJ = E.OBJECTIVE_INFO;
const ACTIONS_DAY = () => Object.entries(ui.state.config.actions).filter(([, d]) => d.phase === 'day');
const ACTIONS_NIGHT = () => Object.entries(ui.state.config.actions).filter(([, d]) => d.phase === 'night');

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

function ctx() {
  const s = ui.state;
  return {
    cfg: s.config,
    name: (pid) => (E.getPlayer(s, pid) || { name: pid }).name,
    seat: (pid) => (E.getPlayer(s, pid) || { seat: 0 }).seat,
  };
}

function persist() {
  if (!ui.state) return;
  ui.storageOk = writeSave(ui.state, ui.meta);
}

function toast(msg, kind = 'error') {
  ui.toast = { msg, kind };
  render();
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { ui.toast = null; render(); }, 4000);
}

function act(cmd) {
  const r = E.dispatch(ui.state, { ...cmd, seq: ui.state.commandLog.length });
  if (!r.ok) {
    toast(r.error.message || r.error.code);
    return false;
  }
  ui.state = r.state;
  ui.selectedWorker = null;
  persist();
  return true;
}

function newGame({ names, seed, overrides, kinds = [] }) {
  const config = { ...(overrides || {}), playerCount: names.length, playerNames: names };
  ui.state = E.createGame(config, seed);
  const ai = {};
  ui.state.players.forEach((p, i) => { if (AI_KINDS[kinds[i]]) ai[p.id] = kinds[i]; });
  ui.meta = { objIndex: 0, objStep: 'pass', objectivesDone: false, reportSeq: 0, ai };
  if (!humanIds().length) ui.meta.objectivesDone = true;
  ui.aiPaused = false;
  ui.screen = 'game';
  ui.modal = null;
  ui.hideGameOver = false;
  persist();
}

function loadSaveObject(obj) {
  if (!obj || obj.format !== SAVE_FORMAT) throw new Error('This file is not a Monsters of Loving Grace save.');
  const state = E.deserialize(obj.state);
  ui.state = state;
  ui.meta = { objIndex: 0, objStep: 'pass', objectivesDone: true, reportSeq: 0, ai: {}, ...(obj.meta || {}) };
  if (!ui.meta.ai) ui.meta.ai = {};
  ui.screen = 'game';
  ui.modal = null;
  ui.hideGameOver = false;
  persist();
}

function exportSave() {
  const blob = new Blob([JSON.stringify(makeSave(ui.state, ui.meta), null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `molg-round${ui.state.round}-${ui.state.phase}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

function importSave() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      loadSaveObject(JSON.parse(await file.text()));
      render();
    } catch (e) {
      if (ui.screen === 'menu') { ui.menuError = e.message; render(); } else toast(`Import failed: ${e.message}`);
    }
  };
  input.click();
}

function randomSeed() {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return `${a[0].toString(36)}${a[1].toString(36)}`;
}

// The report covers the latest resolution phase. It is shown again whenever
// that phase produces events the players have not yet seen, for example
// after each decision in a monster's control chain.
function pendingReport() {
  const s = ui.state;
  const evs = s.events;
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i];
    if (e.type !== 'RESURRECTIONS_ANNOUNCED') continue;
    const out = [];
    for (let j = i + 1; j < evs.length; j++) {
      if (evs[j].type === 'PHASE_ENDED' || evs[j].type === 'GAME_ENDED') break;
      out.push(evs[j]);
    }
    if (!e.playerIds.length) return null;
    const seq = out.length ? out[out.length - 1].seq : e.seq;
    if (seq <= ui.meta.reportSeq) return null;
    return { seq, reveal: e, events: out };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rendering: shared pieces
// ---------------------------------------------------------------------------

function suspicionMeter(v, max) {
  let cells = '';
  for (let i = 1; i <= max; i++) cells += `<span class="cell ${i <= v ? 'on' : ''}"></span>`;
  return `<div class="meter" role="meter" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${v}" aria-label="Village suspicion">
    <span class="meter-label">Suspicion</span><span class="cells">${cells}</span><span class="meter-val">${v}<small>/${max}</small></span></div>`;
}

function partChip(cfg, part, extra = '', slotLabel = '') {
  if (!part) return `<span class="part empty" title="${slotLabel ? `${slotLabel}: empty` : 'empty'}">${slotLabel ? slotLabel.toLowerCase() : 'empty'}</span>`;
  const v = cfg.partVariants[part.variantId];
  const cls = v.effects.length ? (v.effects.some((e) => (e.op === 'die' && e.sign < 0) || (e.op === 'fixed' && e.amount < 0) || (e.op === 'threshold' && e.amount > 0)) ? 'bad' : 'good') : '';
  return `<span class="part ${cls}" title="${slotLabel ? `${slotLabel}: ` : ''}${esc(variantText(cfg, part.variantId))}">${esc(v.name)}${extra}</span>`;
}

function bodyDiagram(cfg, p) {
  const slot = (id, label) => `<div class="slot slot-${id}">${partChip(cfg, p.body[id], '', label)}</div>`;
  return `<div class="body-grid">
    ${slot('head', 'Head')}${slot('arm1', 'Arm')}${slot('chest', 'Chest')}${slot('arm2', 'Arm')}${slot('leg1', 'Leg')}${slot('leg2', 'Leg')}
  </div>`;
}

function oddsLine(o) {
  if (!o) return '';
  return `<div class="odds" title="Exact odds with the current body and effective research">
    <span>Vit ${pct(o.attributes.vitality.success)}</span><span>Hum ${pct(o.attributes.humanity.success)}</span>
    <span class="o-stable">Stable ${pct(o.pStable)}</span><span class="o-unleash">Monster ${pct(o.pMonster)}</span><span class="o-fail">Fail ${pct(o.pFailed)}</span>
  </div>`;
}

function playerPanel(view, p) {
  const cfg = view.config;
  const active = view.activePlayerId === p.id;
  const first = view.firstPlayerId === p.id;
  const research = Object.keys(cfg.research).sort().map((t) => {
    const n = p.effectiveResearch[t];
    if (!n) return '';
    const own = p.research.includes(t);
    const pub = p.published.includes(t);
    return `<span class="rchip ${own ? 'own' : 'shared'}" title="${esc(cfg.research[t].text)}${own ? '' : ' (via publication)'}">${esc(cfg.research[t].name)}${n > 1 ? ` ×${n}` : ''}${pub ? ' <i>pub.</i>' : ''}</span>`;
  }).join('');
  const workers = p.workers.map((w) => `<span class="wchip ${w.kind} ${w.active ? '' : 'pending'} ${(view.phase === 'day' || view.phase === 'night') && !w.availableNow && w.active ? 'used' : ''}" title="${w.active ? '' : 'Available next round'}">${workerLabel(w)}</span>`).join('');
  const loose = {};
  for (const part of p.loose) (loose[part.variantId] = loose[part.variantId] || []).push(part);
  const looseHtml = Object.entries(loose).map(([vid, arr]) => partChip(cfg, arr[0], arr.length > 1 ? ` ×${arr.length}` : '')).join('') || '<span class="muted">none</span>';
  const creatures = view.creatures.filter((c) => c.ownerId === p.id && c.status === 'stable').length;
  return `<section class="player seat-${p.seat} ${active ? 'active' : ''} ${p.passed && (view.phase === 'day' || view.phase === 'night') ? 'passed' : ''}">
    <header><span class="pname pc pc-${p.seat}">${esc(p.name)}</span>${aiKind(p.id) ? `<span class="badge ai" title="${esc(AI_KINDS[aiKind(p.id)])}">AI</span>` : ''}${first ? '<span class="badge" title="Has initiative this round">1st</span>' : ''}${p.passed && (view.phase === 'day' || view.phase === 'night') ? '<span class="badge muted">passed</span>' : ''}<span class="money" title="Money">⚱ ${p.money}</span></header>
    <div class="row" aria-label="Workers">${workers}${p.nextIgorCost != null ? `<span class="muted small" title="Next Igor costs ${p.nextIgorCost}">+Igor ${p.nextIgorCost}</span>` : ''}</div>
    <div class="row"><span class="lbl">Research</span>${research || '<span class="muted">none</span>'}</div>
    <div class="row" title="${p.controlAttempts} control attempt${p.controlAttempts === 1 ? '' : 's'} left, ${pct(p.controlChance)} chance per roll"><span class="lbl">Control</span>${p.controlAttempts} left · ${pct(p.controlChance)}/roll${p.garrisoned ? ' · <b>garrisoned</b>' : ''}</div>
    ${bodyDiagram(cfg, p)}
    ${oddsLine(p.resurrectionOdds)}
    <div class="row"><span class="lbl">Loose</span>${looseHtml}</div>
    ${creatures ? `<div class="row"><span class="lbl">Creatures</span>${creatures} stable</div>` : ''}
  </section>`;
}

function marketPanel(view) {
  const cfg = view.config;
  const cards = view.market.map((c) => `<div class="rcard r-${c.type}"><b>${esc(cfg.research[c.type].name)}</b><span>${esc(cfg.research[c.type].text)}</span></div>`).join('');
  const pubs = view.publications.length
    ? view.publications.map((x) => `<li>${esc(researchName(cfg, x.type))} — <span class="pc pc-${ctx().seat(x.playerId)}">${esc(ctx().name(x.playerId))}</span> (round ${x.round})</li>`).join('')
    : '<li class="muted">Nothing published yet.</li>';
  return `<section class="panel market"><h2>Research market <small>${view.deckCount} in deck</small></h2><div class="rcards">${cards || '<span class="muted">Market empty.</span>'}</div>
    <h3>Publications</h3><ul class="pubs">${pubs}</ul></section>`;
}

function logPanel(view) {
  const c = ctx();
  const lines = [];
  for (let i = view.events.length - 1; i >= 0 && lines.length < 200; i--) {
    const txt = describeEvent(view.events[i], c);
    if (txt) lines.push(`<li class="ev-${view.events[i].type.toLowerCase()}">${txt}</li>`);
  }
  const open = ui.logOpen;
  return `<section class="panel log ${open ? 'open' : ''}"><h2><button class="log-toggle" data-act="log-toggle" aria-expanded="${open}">Chronicle <small>${open ? 'hide' : 'show all'}</small></button></h2>
    <ol>${open ? lines.join('') : lines.slice(0, 1).join('')}</ol></section>`;
}

// ---------------------------------------------------------------------------
// Rendering: board
// ---------------------------------------------------------------------------

function availableWorkers(view, pid) {
  return view.players.find((p) => p.id === pid).workers.filter((w) => w.availableNow);
}

function spaceStatus(actionId, workerId) {
  const s = ui.state;
  if (!workerId) return { ok: false, reason: 'Select a worker first.' };
  const e = E.validateCommand(s, { type: 'PLACE_MEEPLE', playerId: s.activePlayerId, workerId, actionId });
  if (!e || e.code === 'MISSING_CHOICE') return { ok: true };
  return { ok: false, reason: e.message };
}

function actionSpace(view, id, def, enabledPhase) {
  const cfg = view.config;
  const occ = (view.occupancy[def.phase] && view.occupancy[def.phase][id]) || [];
  const chips = occ.map((wid) => {
    const w = ui.state.workers[wid];
    return `<span class="meeple pc-bg-${ctx().seat(w.ownerId)}" title="${esc(ctx().name(w.ownerId))} — ${workerLabel(w)}">${w.kind === 'scientist' ? 'S' : 'I'}</span>`;
  }).join('');
  const capacity = view.capacities[id];
  const cap = capacity == null ? '∞' : capacity;
  let status = { ok: false, reason: '' };
  if (enabledPhase && !view.result && !aiKind(view.activePlayerId)) status = spaceStatus(id, ui.selectedWorker);
  const igorOk = def.scientist === false ? '<span class="tag" title="Igors only">Igor only</span>' : def.igor ? '<span class="tag">Igor</span>' : '<span class="tag no" title="Scientist only">Scientist</span>';
  return `<button class="space ${def.phase} ${status.ok ? 'can' : ''}" data-act="space" data-id="${id}" ${status.ok ? '' : 'aria-disabled="true"'} title="${esc(status.reason || '')}">
    <span class="sp-top"><b>${esc(def.name)}</b><span class="sp-loc">${esc(def.location)}</span><span class="sp-occ">${chips}<span class="cap">${occ.length}/${cap}</span></span>${igorOk}</span>
    <span class="sp-txt">${esc(actionText(id, def, cfg))}</span>
  </button>`;
}

function turnBar(view) {
  if (view.result) {
    return `<div class="turnbar over"><b>The game is over.</b> <button data-act="show-gameover">Show results</button></div>`;
  }
  if (view.phase === 'resolution' && view.control) {
    const p = view.players.find((x) => x.id === view.activePlayerId);
    return `<div class="turnbar seat-${p.seat}"><span class="who">A monster is loose — <span class="pc pc-${p.seat}">${esc(p.name)}</span> decides whether to subdue it</span>
      ${aiKind(p.id) ? `<span class="spacer"></span><span class="ai-status">${ui.aiPaused ? 'AI paused' : 'AI is thinking…'}</span>` : ''}</div>`;
  }
  if (view.phase !== 'day' && view.phase !== 'night') return '<div class="turnbar">Resolving…</div>';
  const pid = view.activePlayerId;
  const p = view.players.find((x) => x.id === pid);
  const ws = availableWorkers(view, pid);
  if (!ui.selectedWorker || !ws.some((w) => w.id === ui.selectedWorker)) {
    ui.selectedWorker = (ws.find((w) => w.kind === 'scientist') || ws[0] || {}).id || null;
  }
  const chips = ws.map((w) => `<button class="wsel ${w.kind} ${ui.selectedWorker === w.id ? 'sel' : ''}" data-act="worker" data-id="${w.id}">${workerLabel(w)}</button>`).join('');
  return `<div class="turnbar seat-${p.seat}">
    <span class="who"><span class="pc pc-${p.seat}">${esc(p.name)}</span>'s turn <small>(${view.phase === 'day' ? '☀ day' : '☾ night'})</small></span>
    <span class="wsels">Worker: ${chips}</span>
    <span class="spacer"></span>
    ${aiKind(pid) ? `<span class="ai-status">${ui.aiPaused ? 'AI paused' : 'AI is thinking…'}</span>` : `<button data-act="peek" class="ghost">View my objective</button>
    <button data-act="pass" class="ghost danger-outline">Pass ${view.phase}</button>`}
  </div>`;
}

function renderBoard() {
  const view = E.getPublicView(ui.state);
  const night = view.phase === 'night';
  const order = view.initiative.map((pid) => view.players.find((p) => p.id === pid));
  return `<div class="game ${night ? 'is-night' : 'is-day'}">
    <header class="topbar">
      <h1>Monsters of Loving Grace</h1>
      <span class="phase">Round ${view.round} · ${{ day: '☀ Day', night: '☾ Night', resolution: '⚡ Resolution', dawn: 'Dawn', ended: 'Game over' }[view.phase]}</span>
      ${suspicionMeter(view.suspicion, view.suspicionMax)}
      <nav class="menu">
        ${Object.keys(ui.meta.ai || {}).length && !view.result ? `<button data-act="ai-pause" class="ghost">${ui.aiPaused ? '▶ Resume AI' : '⏸ Pause AI'}</button>` : ''}
        <button data-act="rules" class="ghost">Rules</button>
        <button data-act="export" class="ghost">Export</button>
        <button data-act="import" class="ghost">Import</button>
        <button data-act="restart" class="ghost">Restart</button>
        <button data-act="to-menu" class="ghost">Menu</button>
        ${ui.debug ? '<button data-act="debug-panel" class="debug-btn">DEBUG</button>' : ''}
      </nav>
    </header>
    ${ui.storageOk ? '' : '<div class="warn">Browser storage is unavailable — this game is held in memory only. Use Export to keep a copy.</div>'}
    ${turnBar(view)}
    <main class="layout">
      <section class="board">
        <div class="phase-col ${view.phase === 'day' ? 'current' : ''}"><h2>☀ Day</h2><div class="spaces">${ACTIONS_DAY().map(([id, d]) => actionSpace(view, id, d, view.phase === 'day')).join('')}</div></div>
        <div class="phase-col ${view.phase === 'night' ? 'current' : ''}"><h2>☾ Night</h2><div class="spaces">${ACTIONS_NIGHT().map(([id, d]) => actionSpace(view, id, d, view.phase === 'night')).join('')}</div></div>
      </section>
      <aside class="side">${marketPanel(view)}${logPanel(view)}</aside>
      <section class="players">${order.map((p) => playerPanel(view, p)).join('')}</section>
    </main>
  </div>`;
}

// ---------------------------------------------------------------------------
// Rendering: overlays
// ---------------------------------------------------------------------------

function privacy(inner, cls = '') {
  return `<div class="privacy ${cls}" role="dialog" aria-modal="true"><div class="privacy-card">${inner}</div></div>`;
}

function modal(title, body, actions) {
  return `<div class="modal-back" data-act="modal-back"><div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header><h2>${title}</h2><button class="x" data-act="close" aria-label="Close">×</button></header>
    <div class="modal-body">${body}</div>
    ${actions ? `<footer>${actions}</footer>` : ''}
  </div></div>`;
}

function objectiveCard(obj) {
  const o = OBJ[obj];
  return `<div class="objcard obj-${obj}"><span class="objname">${esc(o.name)}</span><span class="objsum">${esc(o.summary)}</span><p>${esc(o.condition)}</p></div>`;
}

function objectivesFlow() {
  const s = ui.state;
  const humans = humanIds();
  const p = E.getPlayer(s, humans[ui.meta.objIndex]);
  if (ui.meta.objStep === 'pass') {
    return privacy(`<p class="eyebrow">Secret objectives · ${ui.meta.objIndex + 1} of ${humans.length}</p>
      <h2>Pass the device to <span class="pc pc-${p.seat}">${esc(p.name)}</span></h2>
      <p class="muted">Everyone else, look away.</p>
      <button class="big" data-act="obj-reveal">I am ${esc(p.name)} — show my objective</button>`);
  }
  return privacy(`<p class="eyebrow">${esc(p.name)}, your secret objective</p>
    ${objectiveCard(s.objectives[p.id])}
    <p class="muted small">Other roles in play may include ${[...new Set(E.objectiveDeckFor(s.config))].map((o) => OBJ[o].name).join(', ')}. One card is left unseen.</p>
    <button class="big" data-act="obj-hide">Hide and pass the device</button>`);
}

// After an experiment the player keeps one eligible drawn research card (public).
function pickFlow() {
  const s = ui.state;
  const cfg = s.config;
  const k = s.pendingPick;
  const opts = E.getLegalCommands(s, s.activePlayerId);
  const typeOf = (id) => k.cards.find((x) => x.id === id).type;
  return modal(`${esc(cfg.actions[k.actionId].name)}: keep one`,
    `<p>You draw ${k.cards.map((x) => esc(researchName(cfg, x.type))).join(', ')}. Keep one you have not discovered; it stays private. The rest go to the bottom of the deck.</p><div class="opts">${opts.map((c, i) => `<button class="opt" data-act="pick" data-i="${i}"><b>${esc(researchName(cfg, typeOf(c.cardId)))}</b> <small class="muted">— ${esc(cfg.research[typeOf(c.cardId)].text)}</small></button>`).join('')}</div>`,
    '');
}

// Subduing is a public decision, so there is no pass-the-device screen.
function subdueFlow() {
  const view = E.getPublicView(ui.state, { includeEvents: false });
  const k = view.control;
  const c = ctx();
  const me = view.players.find((x) => x.id === view.activePlayerId);
  const own = k.creatorId === me.id;
  const later = k.upcoming;
  const inc = view.config.control.declineSuspicion;
  return modal('⚡ A monster is loose',
    `<p>${own ? 'Your' : `<span class="pc pc-${c.seat(k.creatorId)}">${esc(c.name(k.creatorId))}</span>'s`} Creature lives, but its Humanity failed.</p>
    <p><span class="pc pc-${me.seat}">${esc(me.name)}</span>, you have <b>${me.controlAttempts}</b> control attempt${me.controlAttempts === 1 ? '' : 's'}. Trying spends one and rolls d20 + your control research: you need ${view.config.control.threshold}+, a <b>${pct(me.controlChance)}</b> chance. Success destroys the monster, gives you ${view.config.control.subdueSalvage} of its parts at random and adds ${view.config.control.subdueSuspicion} suspicion. Failure adds nothing and passes the monster on.</p>
    <p class="small muted">If you don't, suspicion rises by ${inc} (now ${view.suspicion}/${view.suspicionMax}) and ${later.length ? `the monster passes to ${later.map((pid) => esc(c.name(pid))).join(', then ')}` : '<b>nobody else can stop it: it will be unleashed</b>'}. If the mob forms, it cannot stop the monster either.</p>`,
    `<button class="big" data-act="subdue" data-v="1">Try to subdue (${pct(me.controlChance)})</button><button class="big ghost danger-outline" data-act="subdue" data-v="0">Let it pass</button>`);
}

function reportOverlay(rep) {
  const cfg = ui.state.config;
  const c = ctx();
  const blocks = [];
  for (const e of rep.events) {
    if (e.type === 'RESURRECTION_ROLLED') {
      const rows = Object.keys(e.attributes).map((a) => {
        const at = e.attributes[a];
        const dice = at.dice.map((d) => `<li>${esc(sourceLabel(cfg, d.source))}: ${d.source.kind === 'base' ? '' : d.sign < 0 ? '−' : '+'}d${d.die} → <b>${d.sign < 0 ? '−' : ''}${d.result}</b></li>`).join('');
        const fixed = at.fixed.map((f) => `<li>${esc(sourceLabel(cfg, f.source))}: fixed ${f.amount >= 0 ? '+' : '−'}${Math.abs(f.amount)}</li>`).join('');
        const thr = at.thresholdAdjustments.map((t) => `<li>${esc(sourceLabel(cfg, t.source))}: threshold ${t.amount >= 0 ? '+' : '−'}${Math.abs(t.amount)}</li>`).join('');
        return `<div class="attr ${at.success ? 'ok' : 'no'}"><h4>${attrName(a)} <span>${at.score} vs ${at.threshold}+ ${at.success ? '✓' : '✗'}</span></h4><ul>${dice}${fixed}${thr}</ul><small>Base threshold ${at.baseThreshold}</small></div>`;
      }).join('');
      blocks.push(`<div class="attempt"><h3><span class="pc pc-${c.seat(e.playerId)}">${esc(c.name(e.playerId))}</span></h3><div class="attrs">${rows}</div>`);
    } else if (e.type === 'RESURRECTION_CANCELLED') {
      blocks.push(`<p class="outcome minor">${esc(c.name(e.playerId))}'s body is incomplete; the attempt is called off.</p>`);
    } else if (e.type === 'RESURRECTION_FAILED') {
      blocks.push(`<p class="outcome fail">Vitality failed — no Creature. Salvaged: ${e.refundedParts.map((x) => esc(variantName(cfg, x.variantId))).join(', ')}.</p></div>`);
    } else if (e.type === 'CREATURE_STABILIZED') {
      blocks.push(`<p class="outcome stable">It lives — a stable, ${esc(e.disposition.replace(/_/g, ' '))} Creature!</p></div>`);
    } else if (e.type === 'MONSTER_CREATED') {
      blocks.push('<p class="outcome unleash">It lives — but Humanity failed. It is a monster!</p>');
    } else if (e.type === 'SUBDUE_DECLINED') {
      blocks.push(`<p class="outcome minor">${esc(c.name(e.playerId))} does not subdue it.</p>`);
    } else if (e.type === 'CONTROL_SKIPPED') {
      blocks.push(`<p class="outcome minor">${esc(c.name(e.playerId))} ${e.reason === 'not_garrisoned' ? 'has no one in the garrison' : 'has no control attempts left'}.</p>`);
    } else if (e.type === 'CONTROL_ROLLED') {
      const parts = [...e.dice.map((d) => `${esc(sourceLabel(cfg, d.source))} d${d.die} → ${d.result}`), ...e.fixed.map((f) => `${esc(sourceLabel(cfg, f.source))} +${f.amount}`)].join(', ');
      blocks.push(`<p class="outcome minor">${esc(c.name(e.playerId))} tries to subdue it: ${parts} = <b>${e.score}</b> vs ${e.threshold}+ ${e.success ? '✓' : '✗ — it breaks free'}</p>`);
    } else if (e.type === 'MONSTER_SUBDUED') {
      blocks.push(`<p class="outcome stable">${esc(c.name(e.playerId))} subdues and destroys the monster, salvaging ${e.salvagedParts.map((x) => esc(variantName(cfg, x.variantId))).join(', ')}.</p></div>`);
    } else if (e.type === 'CREATURE_UNLEASHED') {
      blocks.push('<p class="outcome unleash">The monster is UNLEASHED!</p></div>');
    } else if (e.type === 'MOB_FORMED') {
      blocks.push(e.overwhelmed ? '<p class="outcome unleash">The mob forms — but it cannot stop the monster!</p>' : '<p class="outcome unleash">The suspicion is too much: the mob forms!</p>');
    } else if (e.type === 'SUSPICION_CHANGED' && (e.reason === 'monster_not_subdued' || e.reason === 'monster_subdued')) {
      blocks.push(`<p class="outcome minor">Suspicion +${e.delta} → ${e.value}/${e.max}.</p>`);
    }
  }
  const reveal = `Attempting: ${rep.reveal.playerIds.map((pid) => `<span class="pc pc-${c.seat(pid)}">${esc(c.name(pid))}</span>`).join(' · ')}`;
  return modal(`⚡ Resurrections — round ${rep.reveal.round}`, `<p class="reveal">${reveal}</p>${blocks.join('')}`, '<button data-act="report-done" class="big">Continue</button>');
}

function gameOverOverlay() {
  const s = ui.state;
  const r = s.result;
  const c = ctx();
  const headline = { mob: 'The mob has formed. Every scientist is arrested.', unleashed: 'A Creature has been unleashed upon the village.', objective: r.winners.length ? 'Dawn breaks on a new age of science.' : 'A Creature walks the earth, but no one can claim the glory.' }[r.reason];
  const winners = r.winners.length
    ? r.winners.map((pid) => `<span class="pc pc-${c.seat(pid)}">${esc(c.name(pid))}</span> (${OBJ[r.objectives[pid]].name})`).join(', ')
    : 'Nobody — collective defeat.';
  const rows = s.players.map((p) => `<tr class="${r.winners.includes(p.id) ? 'win' : ''}"><td><span class="pc pc-${p.seat}">${esc(p.name)}</span></td><td>${OBJ[r.objectives[p.id]].name}</td><td>${r.winners.includes(p.id) ? 'Wins' : 'Loses'}</td></tr>`).join('');
  return modal('Game over', `<p class="headline">${headline}</p><p><b>Winners:</b> ${winners}</p>
    <table class="results"><thead><tr><th>Player</th><th>Objective</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <p class="muted">Unseen card: ${r.unseenObjectives.map((o) => OBJ[o].name).join(', ')}. Ended in round ${r.round} with suspicion ${s.suspicion}/${s.config.suspicionMax}.</p>`,
  '<button data-act="close">View board</button><button data-act="export">Export save</button><button data-act="new-from-over" class="big">New game</button>');
}

function choiceModal() {
  const m = ui.modal;
  const s = ui.state;
  const cfg = s.config;
  const def = cfg.actions[m.actionId];
  const p = E.getPlayer(s, s.activePlayerId);
  const w = s.workers[m.workerId];
  const title = `${esc(def.name)} <small>${esc(def.location)} · ${workerLabel(w)}</small>`;
  let body = `<p>${esc(actionText(m.actionId, def, cfg))}</p>`;
  const marketOptions = (name) => s.market.map((c) => {
    const owned = p.research.includes(c.type);
    return `<label class="opt ${owned ? 'disabled' : ''}"><input type="radio" name="${name}" value="${c.id}" ${owned ? 'disabled' : ''}> <b>${esc(cfg.research[c.type].name)}</b> <span class="muted">${esc(cfg.research[c.type].text)}${owned ? ' (already discovered)' : ''}</span></label>`;
  }).join('');
  const installedOptions = () => Object.entries(p.body).filter(([, x]) => x).map(([slot, x]) => `<label class="opt"><input type="checkbox" name="part" value="${x.id}"> ${esc(variantName(cfg, x.variantId))} <span class="muted">${slot} — ${esc(variantText(cfg, x.variantId))}</span></label>`).join('') || '<p class="muted">No installed parts.</p>';
  const looseOptions = (filterFits) => {
    const open = {};
    for (const [t, d] of Object.entries(cfg.partTypes)) open[t] = d.slots.filter((sl) => p.body[sl] === null).length;
    return p.loose.map((x) => {
      const fits = !filterFits || open[x.type] > 0;
      return `<label class="opt ${fits ? '' : 'disabled'}"><input type="checkbox" name="part" value="${x.id}" ${fits ? '' : 'disabled'}> ${esc(variantName(cfg, x.variantId))} <span class="muted">${esc(variantText(cfg, x.variantId))}</span></label>`;
    }).join('') || '<p class="muted">No loose parts.</p>';
  };
  switch (m.actionId) {
    case 'research': body += `<div class="opts">${marketOptions('card')}</div>`; break;
    case 'experiment': body += `<h3>Discard 1–${Math.min(def.maxParts, s.deck.length)} installed parts</h3><div class="opts">${installedOptions()}</div><p class="small muted">You draw one research card per part discarded and keep one you have not discovered.</p>`; break;
    case 'sell': body += `<h3>Sell exactly ${def.parts} loose parts</h3><div class="opts">${looseOptions(false)}</div>`; break;
    case 'assemble': body += `<p class="small">Choose any parts for empty slots — up to a whole body.</p><div class="opts">${looseOptions(true)}</div>`; break;
    case 'specimens': {
      const opts = Object.entries(cfg.partTypes).map(([t, td]) => `<optgroup label="${esc(td.name)}">${Object.entries(cfg.partVariants).filter(([, v]) => v.type === t).map(([id, v]) => `<option value="${id}">${esc(v.name)} — ${esc(v.effects.length ? v.effects.map(effectText).join(', ') : 'no effect')}</option>`).join('')}</optgroup>`).join('');
      body += Array.from({ length: def.count }, (_, i) => `<label class="sel">Part ${i + 1} <select name="variant${i}">${opts}</select></label>`).join('');
      break;
    }
    case 'hire': body += `<p>Cost: <b>${def.cost}</b> money. You have ${p.money}. The Igor can work straight away.</p>`; break;
    case 'prepare': body += `<p>Your body is ${p.body && Object.values(p.body).every(Boolean) ? '<b>complete</b>' : '<b>not yet complete</b> — finish it tonight with another worker, or the attempt is called off'}. Everyone will see that you prepared, and you cannot back out.</p>`; break;
    default: break;
  }
  return modal(title, body, '<button data-act="close" class="ghost">Cancel</button><button data-act="confirm-place" class="big">Confirm</button>');
}

function collectChoices() {
  const m = ui.modal;
  const q = (sel) => root.querySelector(sel);
  const qa = (sel) => [...root.querySelectorAll(sel)];
  const checkedParts = () => qa('.modal input[name=part]:checked').map((x) => x.value);
  const card = () => (q('.modal input[name=card]:checked') || {}).value;
  switch (m.actionId) {
    case 'research': return { researchCardId: card() };
    case 'experiment': case 'sell': return { partIds: checkedParts() };
    case 'assemble': return { partIds: checkedParts() };
    case 'specimens': return { variantIds: qa('.modal select[name^=variant]').map((x) => x.value) };
    default: return undefined;
  }
}

function peekOverlay() {
  const s = ui.state;
  const p = E.getPlayer(s, ui.modal.pid);
  if (!ui.modal.revealed) {
    return privacy(`<h2>Private: <span class="pc pc-${p.seat}">${esc(p.name)}</span> only</h2><p class="muted">Make sure nobody else can see the screen.</p>
      <div class="choice-row"><button class="big" data-act="peek-reveal">Reveal</button><button class="ghost" data-act="close">Cancel</button></div>`);
  }
  return privacy(`<p class="eyebrow">${esc(p.name)}, your secret objective</p>${objectiveCard(s.objectives[p.id])}<button class="big" data-act="close">Hide</button>`);
}

function confirmOverlay() {
  return modal(esc(ui.modal.title), `<p>${esc(ui.modal.text)}</p>`, `<button data-act="close" class="ghost">Cancel</button><button data-act="confirm-yes" class="big danger">${esc(ui.modal.yes || 'Confirm')}</button>`);
}

function rulesOverlay() {
  return modal('Rules summary', document.getElementById('rules-template').innerHTML, '<button data-act="close" class="big">Close</button>');
}

function debugOverlay() {
  const s = ui.state;
  const objs = s.players.map((p) => `${esc(p.name)}: ${OBJ[s.objectives[p.id]].name}`).join(' · ');
  return modal('<span class="debug-btn">DEBUG</span> Developer tools', `
    <p class="warn">Debug mode reveals hidden information (objectives, deck order, RNG). Do not open during a real playtest.</p>
    <p><b>Seed:</b> <code>${esc(s.seed)}</code> · <b>Engine:</b> ${esc(s.engineVersion)} · <b>Commands:</b> ${s.commandLog.length} · <b>Events:</b> ${s.events.length}</p>
    <p><b>Objectives:</b> ${objs} · <b>Unseen:</b> ${s.unseenObjectives.map((o) => OBJ[o].name).join(', ')}</p>
    <p><b>Resolution:</b> <code>${esc(JSON.stringify(s.resolution))}</code> · <b>Rested:</b> ${esc(s.restedBy || 'nobody')}</p>
    <p><b>Deck (top first):</b> ${s.deck.map((c) => esc(c.type)).join(', ') || 'empty'}</p>
    <h3>Dispatch raw command (goes through the engine)</h3>
    <textarea id="dbg-cmd" rows="3" spellcheck="false">${esc(JSON.stringify(E.getLegalCommands(s, s.activePlayerId)[0] || {}))}</textarea>
    <div class="choice-row"><button data-act="dbg-dispatch">Dispatch</button><button data-act="dbg-replay">Download replay record</button></div>
    <details><summary>Legal commands for active player</summary><pre>${esc(JSON.stringify(E.getLegalCommands(s, s.activePlayerId), null, 1))}</pre></details>
    <details><summary>Authoritative state</summary><pre>${esc(JSON.stringify({ ...s, events: `[${s.events.length} events]` }, null, 1))}</pre></details>`,
  '<button data-act="close" class="big">Close</button>');
}

// ---------------------------------------------------------------------------
// Rendering: menu
// ---------------------------------------------------------------------------

function renderMenu() {
  const save = readSave();
  const n = ui.menuCount || 5;
  // Seats default to AI; naming a seat makes it human (see the input listener).
  const kindOf = (i) => (ui.menuKinds || [])[i] || DEFAULT_SEAT_KIND;
  const kindOpts = (i) => [['human', 'Human'], ...Object.entries(AI_KINDS)].map(([k, label]) => `<option value="${k}" ${kindOf(i) === k ? 'selected' : ''}>${label}</option>`).join('');
  const names = Array.from({ length: n }, (_, i) => `<div class="prow"><label>Player ${i + 1} <input name="pname" maxlength="24" value="${esc((ui.menuNames || [])[i] || '')}" ${((ui.menuNames || [])[i] || '').trim() ? 'data-named="1"' : ''} placeholder="${seatPlaceholder(kindOf(i), i)}"></label><label>Played by <select name="pkind">${kindOpts(i)}</select></label></div>`).join('');
  return `<div class="menu-screen">
    <div class="title"><h1>Monsters of Loving Grace</h1><p>A game of science, suspicion and secret ambition for 3–6 players.</p></div>
    <div class="menu-grid">
      <section class="panel">
        <h2>New game</h2>
        <label>Players <select id="pcount">${[3, 4, 5, 6].map((k) => `<option ${k === n ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
        <div class="names">${names}</div>
        ${ui.debug ? `<label>Seed (debug) <input id="seed" placeholder="random"></label>
          <label>Config overrides JSON (debug) <textarea id="overrides" rows="3" placeholder='{"startingMoney": 5}'></textarea></label>` : ''}
        <button class="big" data-act="start">Begin the experiment</button>
      </section>
      <section class="panel">
        <h2>Continue</h2>
        ${save && save.state ? `<p>Saved game: round ${save.state.round}, ${esc(save.state.phase)}${save.state.result ? ' (finished)' : ''}.</p><button class="big" data-act="resume">Resume</button>` : '<p class="muted">No saved game in this browser.</p>'}
        <button data-act="import">Import save…</button>
        ${HAS_STORAGE ? '' : '<p class="warn">Browser storage is unavailable; use Export/Import to keep games.</p>'}
        ${ui.menuError ? `<p class="warn">${esc(ui.menuError)}</p>` : ''}
        <h2>Learn</h2>
        <button data-act="rules">Rules summary</button>
        <label class="debug-toggle"><input type="checkbox" id="debug" ${ui.debug ? 'checked' : ''}> Developer / debug mode <small>(reveals hidden information)</small></label>
      </section>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

function render() {
  let html;
  if (ui.screen === 'menu' || !ui.state) {
    html = renderMenu();
    if (ui.modal && ui.modal.kind === 'rules') html += rulesOverlay();
  } else {
    html = renderBoard();
    const s = ui.state;
    let forced = null;
    if (!ui.meta.objectivesDone) forced = objectivesFlow();
    else {
      const rep = pendingReport();
      if (rep) forced = reportOverlay(rep);
      else if (s.result && !ui.hideGameOver && !ui.modal) forced = gameOverOverlay();
      else if (s.phase === 'resolution' && s.control && !aiKind(s.activePlayerId) && !ui.modal) forced = subdueFlow();
      else if (s.pendingPick && !s.result && !aiKind(s.activePlayerId) && !ui.modal) forced = pickFlow();
    }
    ui.blocked = !!forced || !!ui.modal;
    if (forced) html += forced;
    else if (ui.modal) {
      const k = ui.modal.kind;
      html += k === 'choice' ? choiceModal() : k === 'peek' ? peekOverlay() : k === 'confirm' ? confirmOverlay() : k === 'rules' ? rulesOverlay() : k === 'debug' ? debugOverlay() : '';
    }
  }
  if (ui.toast) html += `<div class="toast ${ui.toast.kind}" role="status">${esc(ui.toast.msg)}</div>`;
  const scroll = root.querySelector('.log ol')?.scrollTop;
  root.innerHTML = html;
  if (scroll) { const ol = root.querySelector('.log ol'); if (ol) ol.scrollTop = scroll; }
  document.body.classList.toggle('night', !!ui.state && ui.screen === 'game' && ui.state.phase !== 'day');
  scheduleAI();
}

// ---------------------------------------------------------------------------
// In-browser AI seats: the same policies the headless simulator uses.
// Policies receive only the filtered player view and legal commands.
// ---------------------------------------------------------------------------

function scheduleAI() {
  clearTimeout(ui.aiTimer);
  const s = ui.state;
  if (ui.screen !== 'game' || !s || s.result || ui.aiPaused || ui.blocked) return;
  if (!aiKind(s.activePlayerId)) return;
  ui.aiTimer = setTimeout(aiStep, ui.aiDelay);
}

function aiStep() {
  const s = ui.state;
  const pid = s.activePlayerId;
  const kind = aiKind(pid);
  if (!kind || s.result) return;
  // Seeded per decision so a resumed game makes the same AI choices.
  const policy = POLICIES[kind](`${s.seed}:${pid}:${s.commandLog.length}`);
  const legal = E.enumerateLegalCommands(s, pid);
  const view = E.getPlayerView(s, pid, { includeEvents: false });
  let cmd;
  try { cmd = policy.decide({ playerId: pid, view, legal }); } catch { cmd = null; }
  if (!cmd || !act(cmd)) act(legal[0]);
  render();
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function askConfirm(title, text, yes, fn) {
  ui.modal = { kind: 'confirm', title, text, yes, fn };
  render();
}

const handlers = {
  start() {
    const kinds = [...root.querySelectorAll('select[name=pkind]')].map((x) => x.value);
    const names = [...root.querySelectorAll('input[name=pname]')].map((x, i) => x.value.trim() || (kinds[i] !== 'human' ? `Automaton ${i + 1}` : `Scientist ${i + 1}`));
    ui.menuKinds = kinds;
    let overrides = {};
    const ov = root.querySelector('#overrides');
    if (ov && ov.value.trim()) {
      try { overrides = JSON.parse(ov.value); } catch (e) { ui.menuError = `Invalid overrides JSON: ${e.message}`; render(); return; }
    }
    const seedInput = root.querySelector('#seed');
    const seed = (seedInput && seedInput.value.trim()) || randomSeed();
    try { newGame({ names, seed, overrides, kinds }); } catch (e) { ui.menuError = e.message; }
    ui.menuError = null;
    render();
  },
  resume() {
    try { loadSaveObject(readSave()); } catch (e) { ui.menuError = `Could not resume: ${e.message}`; }
    render();
  },
  import: () => importSave(),
  export: () => exportSave(),
  rules() { ui.modal = { kind: 'rules' }; render(); },
  'to-menu'() { ui.screen = 'menu'; ui.modal = null; render(); },
  restart() {
    askConfirm('Restart game?', 'This discards the current game and starts a new one with the same players. The current save will be overwritten.', 'Restart', () => {
      const names = ui.state.players.map((p) => p.name);
      const kinds = ui.state.players.map((p) => aiKind(p.id) || 'human');
      newGame({ names, seed: randomSeed(), overrides: ui.debug ? ui.state.configOverrides : {}, kinds });
    });
  },
  'new-from-over'() {
    ui.menuNames = ui.state.players.map((p) => p.name);
    ui.menuKinds = ui.state.players.map((p) => aiKind(p.id) || 'human');
    ui.menuCount = ui.state.players.length;
    ui.screen = 'menu';
    ui.modal = null;
    render();
  },
  'confirm-yes'() { const fn = ui.modal.fn; ui.modal = null; fn(); render(); },
  close() {
    if (ui.state && ui.state.result && !ui.modal) ui.hideGameOver = true;
    ui.modal = null;
    render();
  },
  'modal-back'(el, ev) {
    if (ev.target !== el) return;
    if (pendingReport() || (ui.state && ui.state.result && !ui.modal && !ui.hideGameOver)) return;
    ui.modal = null; render();
  },
  'show-gameover'() { ui.hideGameOver = false; render(); },
  'log-toggle'() { ui.logOpen = !ui.logOpen; render(); },
  'obj-reveal'() { ui.meta.objStep = 'show'; persist(); render(); },
  'obj-hide'() {
    ui.meta.objStep = 'pass';
    ui.meta.objIndex += 1;
    if (ui.meta.objIndex >= humanIds().length) ui.meta.objectivesDone = true;
    persist();
    render();
  },
  pick(el) {
    const s = ui.state;
    const c = E.getLegalCommands(s, s.activePlayerId)[Number(el.dataset.i)];
    if (c) act(c);
    render();
  },
  subdue(el) {
    const s = ui.state;
    act({ type: 'SUBDUE_MONSTER', playerId: s.activePlayerId, subdue: el.dataset.v === '1' });
    render();
  },
  'report-done'() { const r = pendingReport(); if (r) ui.meta.reportSeq = r.seq; persist(); render(); },
  worker(el) { ui.selectedWorker = el.dataset.id; render(); },
  'ai-pause'() { ui.aiPaused = !ui.aiPaused; render(); },
  pass() {
    const s = ui.state;
    askConfirm(`Pass the ${s.phase}?`, `${E.getPlayer(s, s.activePlayerId).name} will place no more workers this ${s.phase}. Unused Igors can still act ${s.phase === 'day' ? 'tonight' : 'next round'}.`, 'Pass', () => {
      act({ type: 'PASS_TURN', playerId: s.activePlayerId });
    });
  },
  peek() { ui.modal = { kind: 'peek', pid: ui.state.activePlayerId, revealed: false }; render(); },
  'peek-reveal'() { ui.modal.revealed = true; render(); },
  space(el) {
    if (aiKind(ui.state.activePlayerId)) return;
    const id = el.dataset.id;
    const st = spaceStatus(id, ui.selectedWorker);
    if (!st.ok) { if (st.reason) toast(st.reason); return; }
    ui.modal = { kind: 'choice', actionId: id, workerId: ui.selectedWorker };
    render();
  },
  'confirm-place'() {
    const m = ui.modal;
    const choices = collectChoices();
    const cmd = { type: 'PLACE_MEEPLE', playerId: ui.state.activePlayerId, workerId: m.workerId, actionId: m.actionId };
    if (choices) cmd.choices = choices;
    const r = E.validateCommand(ui.state, cmd);
    if (r) { toast(r.code === 'MISSING_CHOICE' ? 'Make a selection first.' : r.message); return; }
    ui.modal = null;
    act(cmd);
    render();
  },
  'debug-panel'() { ui.modal = { kind: 'debug' }; render(); },
  'dbg-dispatch'() {
    let cmd;
    try { cmd = JSON.parse(root.querySelector('#dbg-cmd').value); } catch (e) { toast(`Invalid JSON: ${e.message}`); return; }
    const r = E.dispatch(ui.state, cmd);
    if (!r.ok) { toast(`${r.error.code}: ${r.error.message}`); return; }
    ui.state = r.state; persist(); toast(`Accepted (${r.events.length} events)`, 'ok');
  },
  'dbg-replay'() {
    const blob = new Blob([JSON.stringify(E.getReplayRecord(ui.state), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `molg-replay-${ui.state.seed}.json`; a.click();
  },
};

root.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el || !root.contains(el)) return;
  const h = handlers[el.dataset.act];
  if (!h) return;
  if (el.dataset.act !== 'modal-back') ev.stopPropagation();
  h(el, ev);
});

root.addEventListener('change', (ev) => {
  if (ev.target.id === 'pcount') {
    ui.menuNames = [...root.querySelectorAll('input[name=pname]')].map((x) => x.value);
    ui.menuKinds = [...root.querySelectorAll('select[name=pkind]')].map((x) => x.value);
    ui.menuCount = Number(ev.target.value);
    render();
  } else if (ev.target.name === 'pkind') {
    const input = ev.target.closest('.prow')?.querySelector('input[name=pname]');
    const i = [...root.querySelectorAll('select[name=pkind]')].indexOf(ev.target);
    if (input) input.placeholder = seatPlaceholder(ev.target.value, i);
  } else if (ev.target.id === 'debug') {
    ui.debug = ev.target.checked;
    writeDebugFlag(ui.debug);
    render();
  }
});

// Giving an AI seat a name switches it to Human. Only the first character
// typed into an empty name does this, so a named seat can still be set to AI.
root.addEventListener('input', (ev) => {
  if (ev.target.name !== 'pname') return;
  const named = ev.target.value.trim() !== '';
  if (named && !ev.target.dataset.named) {
    const sel = ev.target.closest('.prow')?.querySelector('select[name=pkind]');
    if (sel && sel.value !== 'human') {
      sel.value = 'human';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  if (named) ev.target.dataset.named = '1'; else delete ev.target.dataset.named;
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && ui.modal && ui.modal.kind !== 'peek') { ui.modal = null; render(); }
});

render();
