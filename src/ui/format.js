// Presentation helpers: turn engine data and events into readable text.
// No rules logic lives here — only wording.

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ATTR = { vitality: 'Vitality', humanity: 'Humanity' };
export const attrName = (a) => ATTR[a] || a;
const signed = (n) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

export function effectText(e) {
  if (e.op === 'die') return `${attrName(e.attribute)} ${e.sign > 0 ? '+' : '−'}d${e.die}`;
  if (e.op === 'fixed') return `${attrName(e.attribute)} ${signed(e.amount)}`;
  return '';
}

export function variantText(cfg, variantId) {
  const v = cfg.partVariants[variantId];
  if (!v) return variantId;
  return v.effects.length ? v.effects.map(effectText).join(', ') : 'No effect';
}

export const variantName = (cfg, id) => (cfg.partVariants[id] ? cfg.partVariants[id].name : id);
export const scienceName = (cfg, t) => (cfg.science[t] ? cfg.science[t].name : t);

const has = (cfg, kind) => Object.values(cfg.science).some((d) => d.copies > 0 && d.effects.some((e) => e.kind === kind));
const plusSuspicion = (def) => (def.suspicion ? ` Suspicion +${def.suspicion}.` : '');

export function actionText(id, def, cfg) {
  switch (id) {
    case 'medicine': return `Gain ${def.gain} money.${has(cfg, 'medicineBonus') ? ' +1 with Medical Expertise.' : ''}`;
    case 'research': return `Pay ${def.cost}: take any science card from the market.${has(cfg, 'researchCalm') ? ' Public Lectures: suspicion −1.' : ''}`;
    case 'specimens': return `Pay ${def.cost}: draw ${def.draw} body parts, keep one, discard the rest.`;
    case 'hire': return `Pay ${def.cost}: hire an Igor who can work at once (max ${cfg.maxIgors} Igors).`;
    case 'charity': return (def.maxUnits || 1) > 1
      ? `Pay ${def.cost} per unit, up to ${def.maxUnits} units: suspicion −${def.reduction} per unit${has(cfg, 'charityBonus') ? ', −1 more with Parish Benefactor' : ''}.`
      : `Pay ${def.cost}: suspicion −${def.reduction}.${has(cfg, 'charityBonus') ? ' −1 more with Parish Benefactor.' : ''}`;
    case 'garrison': return 'Lets you try to subdue monsters this round, your own included.';
    case 'graves': return `Draw ${def.parts} body parts.${plusSuspicion(def)}`;
    case 'sell': return `Discard ${def.parts} parts: gain ${def.gain} money.${plusSuspicion(def)}`;
    case 'prepare': return `Lay out a full set with Vitality ${cfg.resurrection.thresholds.vitality}+; resurrect after night. Public and binding.`;
    case 'experiment': return `Discard ${def.parts} parts: draw ${def.cards} science cards and keep them.${plusSuspicion(def)}`;
    case 'vespers': return `Suspicion −${def.reduction}.`;
    case 'rest': return 'Go first next round.';
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
  graves: 'grave robbing', sell: 'selling parts', experiment: 'experiments', vespers: 'vespers', public_lecture: 'public lecture',
  monster_not_subdued: 'monster not subdued', monster_subdued: 'monster subdued',
};

/** One-line description of a public event, or null to omit it from the log. */
export function describeEvent(e, ctx) {
  const n = (pid) => `<b class="pc pc-${ctx.seat(pid)}">${esc(ctx.name(pid))}</b>`;
  const cfg = ctx.cfg;
  switch (e.type) {
    case 'GAME_STARTED': return `The experiment begins. ${n(e.firstPlayerId)} has initiative.`;
    case 'ROUND_STARTED': return `<span class="log-round">Round ${e.round}</span> — ${n(e.firstPlayerId)} leads.`;
    case 'PHASE_STARTED': return { day: '☀ Day breaks.', night: '☾ Night falls.', resolution: '⚡ Resurrections resolve.', dawn: '🌅 Dawn.' }[e.phase] || null;
    case 'WORKER_PLACED': return `${n(e.playerId)} sends ${e.workerKind === 'scientist' ? 'their Scientist' : 'an Igor'} to the ${esc(e.location)} (${esc(cfg.actions[e.actionId].name.toLowerCase())}).`;
    case 'TURN_PASSED': return `${n(e.playerId)} passes for the ${e.phase}.`;
    case 'MONEY_CHANGED': return `${n(e.playerId)} ${e.delta >= 0 ? 'gains' : 'pays'} ${Math.abs(e.delta)} money (now ${e.balance}).`;
    case 'SCIENCE_DRAWN': return `${n(e.playerId)} draws ${e.cards.map((k) => esc(scienceName(cfg, k.type))).join(', ')} from the science deck.`;
    case 'SPECIMENS_DRAWN': return `${n(e.playerId)} draws specimens: ${e.parts.map((p) => esc(variantName(cfg, p.variantId))).join(', ')}.`;
    case 'RESURRECTION_PREPARED': return `${n(e.playerId)} lays out a body (Vitality ${e.vitality}) and prepares a resurrection.`;
    case 'PLAYER_RESTED': return `${n(e.playerId)} rests and will go first next round.`;
    case 'PARTS_GAINED': return `${n(e.playerId)} obtains ${e.parts.map((p) => esc(variantName(cfg, p.variantId))).join(', ')}.`;
    case 'PARTS_DISCARDED': return e.reason === 'resurrection' ? null : `${e.reason === 'specimens' ? 'Discarded' : `${n(e.playerId)} ${e.reason === 'sell' ? 'sells' : 'experiments on'}`} ${e.parts.map((p) => esc(variantName(cfg, p.variantId))).join(', ')}.`;
    case 'PARTS_DECK_RESHUFFLED': return `The discard pile is shuffled into a new body-part deck (${e.deckSize} cards).`;
    case 'SCIENCE_ACQUIRED': return `${n(e.playerId)} gains <b>${esc(scienceName(cfg, e.scienceType))}</b>.`;
    case 'MARKET_REFILLED': return `New science in the market: ${esc(scienceName(cfg, e.scienceType))} (${e.deckRemaining} left in deck).`;
    case 'MARKET_DECK_EMPTY': return 'The science deck is exhausted.';
    case 'IGOR_HIRED': return `${n(e.playerId)} hires an Igor for ${e.cost}.`;
    case 'SUSPICION_CHANGED': return `Suspicion ${e.delta >= 0 ? 'rises' : 'falls'} ${e.delta >= 0 ? '+' : '−'}${Math.abs(e.delta)} → <b>${e.value}/${e.max}</b> (${REASONS[e.reason] || e.reason}${e.playerId ? `, ${n(e.playerId)}` : ''}).`;
    case 'RESURRECTIONS_ANNOUNCED': return e.playerIds.length ? `Attempting resurrection: ${e.playerIds.map(n).join(', ')}.` : null;
    case 'RESURRECTION_STARTED': return `${n(e.playerId)} throws the switch…`;
    case 'RESURRECTION_ROLLED': return `${n(e.playerId)}: Vitality ${e.vitality.total}, Humanity ${e.humanity.score}/${e.humanity.threshold} ${e.humanity.success ? '✓' : '✗'}.`;
    case 'CREATURE_STABILIZED': return `${n(e.playerId)}'s Creature lives — and is <b>${e.disposition.replace(/_/g, ' ')}</b>!`;
    case 'MONSTER_CREATED': return `${n(e.playerId)}'s Creature lives — but it is a <b class="danger">monster</b>! Who will subdue it?`;
    case 'SUBDUE_DECLINED': return `${n(e.playerId)} does not subdue the monster.`;
    case 'CONTROL_SKIPPED': return `${n(e.playerId)} has no one in the garrison and cannot subdue it.`;
    case 'CONTROL_ROLLED': return `${n(e.playerId)} tries to subdue the monster: <b>${e.score}</b> vs ${e.threshold}+ ${e.success ? '✓' : '✗'}.`;
    case 'MONSTER_SUBDUED': return `${n(e.playerId)} subdues and destroys the monster.`;
    case 'CREATURE_UNLEASHED': return `${n(e.playerId)}'s monster is <b class="danger">UNLEASHED</b>!`;
    case 'DAWN_CHECK': return e.stableTransitions.length ? `${e.stableTransitions.length} Creature(s) stabilized this round.` : null;
    case 'WORKER_ACTIVATED': return `${n(e.playerId)}'s new Igor reports for duty.`;
    case 'MOB_FORMED': return e.overwhelmed ? '<b class="danger">The villagers form a mob — but the monster tears through it!</b>' : '<b class="danger">The villagers form a mob!</b>';
    case 'SCIENTISTS_ARRESTED': return 'Every scientist is dragged from their laboratory and arrested.';
    case 'OBJECTIVES_REVEALED': return 'All secret objectives are revealed.';
    case 'GAME_ENDED': return `<b>Game over.</b> ${e.winners.length ? `Winners: ${e.winners.map(n).join(', ')}.` : 'Everyone loses.'}`;
    default: return null;
  }
}

export function sourceLabel(cfg, src) {
  if (src.kind === 'base') return 'Base die';
  if (src.kind === 'part') return `${variantName(cfg, src.variantId)} (${src.slot})`;
  if (src.kind === 'science') return `${scienceName(cfg, src.scienceType)}${src.copy > 1 ? ` ×${src.copy}` : ''}`;
  return src.kind;
}

export const pct = (x) => `${Math.round(x * 1000) / 10}%`;
