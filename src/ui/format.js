// Presentation helpers: turn engine data and events into readable text.
// No rules logic lives here — only wording.

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ATTR = { vitality: 'Vitality', control: 'Control', humanity: 'Humanity' };
export const attrName = (a) => ATTR[a] || a;
const signed = (n) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

export function effectText(e) {
  if (e.op === 'die') return `${attrName(e.attribute)} ${e.sign > 0 ? '+' : '−'}1d${e.die}`;
  if (e.op === 'fixed') return `${attrName(e.attribute)} ${signed(e.amount)}`;
  if (e.op === 'threshold') return `${attrName(e.attribute)} threshold ${signed(e.amount)}`;
  return '';
}

export function variantText(cfg, variantId) {
  const v = cfg.partVariants[variantId];
  if (!v) return variantId;
  return v.effects.length ? v.effects.map(effectText).join(', ') : 'No effect';
}

export const variantName = (cfg, id) => (cfg.partVariants[id] ? cfg.partVariants[id].name : id);
export const researchName = (cfg, t) => (cfg.research[t] ? cfg.research[t].name : t);

export function actionText(id, def, cfg) {
  switch (id) {
    case 'medicine': return `Gain ${def.gain} money (Igor gains ${def.igorGain}). +1 per Medical Expertise copy.`;
    case 'research': return `Pay ${def.cost}: take an eligible research card from the market.`;
    case 'specimens': return `Pay ${def.cost}: choose any ${def.count} named body parts.`;
    case 'hire': return `Pay ${cfg.igorCosts.join(' / ')}: hire an Igor (works from next round, max ${cfg.maxIgors}).`;
    case 'charity': return `Pay ${def.cost}: suspicion −${def.reduction}.`;
    case 'lecture': return `Gain ${def.base} + types you have published (max ${def.cap}).`;
    case 'publish': return `Publish a discovery for everyone; gain ${def.gain}.`;
    case 'graves': return `Gain ${def.parts} random parts. d6: 1–3 → +1 suspicion.`;
    case 'morgue': return `Gain ${def.parts} random parts. d6: 1–2 → +2, 3–4 → +1 suspicion.`;
    case 'assemble': return `Install ${def.max} loose parts into empty slots (+1 per Advanced Anatomy).`;
    case 'experiment': return `Spend ${def.partCost} loose parts: take an eligible research card free.`;
    case 'conceal': return `Suspicion −${def.reduction}.`;
    default: return '';
  }
}

export function workerLabel(w) {
  if (w.kind === 'scientist') return 'Scientist';
  if (w.kind === 'igor') return `Igor ${w.id.split('-').pop()}`;
  return w.id;
}

const REASONS = {
  medicine: 'medicine', research: 'research', specimens: 'specimens', hire: 'hiring', charity: 'charity',
  lecture: 'lecture', publish: 'publication', graves: 'grave robbing', morgue: 'morgue raid', conceal: 'covering tracks',
  failed_resurrection: 'failed resurrection',
};

/** One-line description of a public event, or null to omit it from the log. */
export function describeEvent(e, ctx) {
  const n = (pid) => `<b class="pc pc-${ctx.seat(pid)}">${esc(ctx.name(pid))}</b>`;
  const cfg = ctx.cfg;
  switch (e.type) {
    case 'GAME_STARTED': return `The experiment begins. ${n(e.firstPlayerId)} has initiative.`;
    case 'ROUND_STARTED': return `<span class="log-round">Round ${e.round}</span> — ${n(e.firstPlayerId)} leads.`;
    case 'PHASE_STARTED': return { day: '☀ Day breaks.', night: '☾ Night falls.', commitment: '⚡ Resurrection commitments.', resolution: '⚡ Resurrections resolve.', dawn: '🌅 Dawn.' }[e.phase] || null;
    case 'WORKER_PLACED': return `${n(e.playerId)} sends ${e.workerKind === 'scientist' ? 'their Scientist' : 'an Igor'} to the ${esc(e.location)} (${esc(cfg.actions[e.actionId].name.toLowerCase())}).`;
    case 'TURN_PASSED': return `${n(e.playerId)} passes for the ${e.phase}.`;
    case 'MONEY_CHANGED': return `${n(e.playerId)} ${e.delta >= 0 ? 'gains' : 'pays'} ${Math.abs(e.delta)} money (now ${e.balance}).`;
    case 'PARTS_GAINED': return `${n(e.playerId)} obtains ${e.parts.map((p) => esc(variantName(cfg, p.variantId))).join(', ')}.`;
    case 'PARTS_INSTALLED': return `${n(e.playerId)} installs ${e.installs.map((i) => `${esc(variantName(cfg, i.variantId))} (${i.slot})`).join(', ')}${e.bodyComplete ? ' — <i>the body is complete</i>' : ''}.`;
    case 'PARTS_SPENT': return `${n(e.playerId)} consumes ${e.parts.map((p) => esc(variantName(cfg, p.variantId))).join(', ')} in experiments.`;
    case 'RESEARCH_ACQUIRED': return `${n(e.playerId)} discovers <b>${esc(researchName(cfg, e.researchType))}</b>.`;
    case 'MARKET_REFILLED': return `New research in the market: ${esc(researchName(cfg, e.researchType))} (${e.deckRemaining} left in deck).`;
    case 'MARKET_DECK_EMPTY': return 'The research deck is exhausted.';
    case 'RESEARCH_PUBLISHED': return `${n(e.playerId)} publishes <b>${esc(researchName(cfg, e.researchType))}</b> for all.`;
    case 'IGOR_HIRED': return `${n(e.playerId)} hires an Igor for ${e.cost} (arrives round ${e.availableFromRound}).`;
    case 'DIE_ROLLED': return e.purpose === 'discovery' ? `${n(e.playerId)} rolls d6 for discovery: <b>${e.result}</b>.` : null;
    case 'DISCOVERY_RESOLVED': return e.increase ? null : `${n(e.playerId)} goes unnoticed${e.baseSuspicion && e.reduction ? ' (Discreet Methods)' : ''}.`;
    case 'SUSPICION_CHANGED': return `Suspicion ${e.delta >= 0 ? 'rises' : 'falls'} ${e.delta >= 0 ? '+' : '−'}${Math.abs(e.delta)} → <b>${e.value}/${e.max}</b> (${REASONS[e.reason] || e.reason}${e.playerId ? `, ${n(e.playerId)}` : ''}).`;
    case 'COMMITMENT_AUTO_DECLINED': return null;
    case 'COMMITMENT_LOCKED': return `${n(e.playerId)} locks a secret decision.`;
    case 'COMMITMENTS_REVEALED': return e.commitments.length ? `Revealed: ${e.commitments.map((c) => `${n(c.playerId)} ${c.attempt ? '<b>attempts</b>' : 'declines'}`).join(', ')}.` : null;
    case 'RESURRECTION_STARTED': return `${n(e.playerId)} throws the switch…`;
    case 'RESURRECTION_ROLLED': return `${n(e.playerId)}: ${['vitality', 'control', 'humanity'].map((a) => `${attrName(a)} ${e.attributes[a].score}/${e.attributes[a].threshold} ${e.attributes[a].success ? '✓' : '✗'}`).join(', ')}.`;
    case 'RESURRECTION_FAILED': return `${n(e.playerId)}'s body fails to quicken. ${e.refundedParts.length} parts salvaged.`;
    case 'CREATURE_STABILIZED': return `${n(e.playerId)}'s Creature lives — and is <b>${e.disposition.replace(/_/g, ' ')}</b>!`;
    case 'CREATURE_UNLEASHED': return `${n(e.playerId)}'s Creature is <b class="danger">UNLEASHED</b>!`;
    case 'DAWN_CHECK': return e.stableTransitions.length ? `${e.stableTransitions.length} Creature(s) stabilized this round.` : null;
    case 'WORKER_ACTIVATED': return `${n(e.playerId)}'s new Igor reports for duty.`;
    case 'MOB_FORMED': return '<b class="danger">The villagers form a mob!</b>';
    case 'SCIENTISTS_ARRESTED': return 'Every scientist is dragged from their laboratory and arrested.';
    case 'OBJECTIVES_REVEALED': return 'All secret objectives are revealed.';
    case 'GAME_ENDED': return `<b>Game over.</b> ${e.winners.length ? `Winners: ${e.winners.map(n).join(', ')}.` : 'Everyone loses.'}`;
    default: return null;
  }
}

export function sourceLabel(cfg, src) {
  if (src.kind === 'base') return 'Base die';
  if (src.kind === 'part') return `${variantName(cfg, src.variantId)} (${src.slot})`;
  if (src.kind === 'research') return `${researchName(cfg, src.researchType)}${src.copy > 1 ? ` ×${src.copy}` : ''}`;
  return src.kind;
}

export const pct = (x) => `${Math.round(x * 1000) / 10}%`;
