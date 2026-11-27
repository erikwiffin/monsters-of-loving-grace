// Presentation helpers: turn engine data and events into readable text.
// No rules logic lives here — only wording.

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ATTR = { vitality: 'Vitality', humanity: 'Humanity' };
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
    case 'medicine': return `Gain ${def.gain} money. +1 per Medical Expertise copy.`;
    case 'research': return `Pay ${def.cost}: take an eligible research card from the market and publish it for everyone.${cfg.research.lectures ? ' −1 suspicion per Public Lectures copy.' : ''}`;
    case 'specimens': return `Pay ${def.cost}: choose ${def.count === 1 ? 'any named body part' : `any ${def.count} named body parts`}.`;
    case 'hire': return `Pay ${def.cost}: hire an Igor who can work at once (max ${cfg.maxIgors} Igors).`;
    case 'charity': return (def.maxUnits || 1) > 1
      ? `Pay ${def.cost} per unit, up to ${def.maxUnits} units: suspicion −${def.reduction} per unit${cfg.research.benefactor ? ', −1 more per Parish Benefactor copy' : ''}.`
      : `Pay ${def.cost}: suspicion −${def.reduction}.${cfg.research.benefactor ? ' −1 more per Parish Benefactor copy.' : ''}`;
    case 'garrison': return 'Lets you subdue other players\' monsters this round.';
    case 'graves': return `Gain ${def.parts} random parts. ${suspicionText(def.suspicion)}.`;
    case 'sell': return `Sell ${def.parts} loose parts for ${def.gain} money. ${suspicionText(def.suspicion)}.`;
    case 'assemble': return def.max == null ? 'Install any number of loose parts into empty slots.' : `Install up to ${def.max} loose part${def.max === 1 ? '' : 's'} into empty slots.`;
    case 'prepare': return 'Attempt a resurrection after night, if your body is complete by then. Public and binding.';
    case 'experiment': return `Discard up to ${def.maxParts} parts (loose or installed) and draw that many research cards; keep one (private). ${suspicionText(def.suspicion)}.`;
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
  graves: 'grave robbing', sell: 'selling parts', experiment: 'experiments',
  failed_resurrection: 'failed resurrection', monster_not_subdued: 'monster not subdued', monster_subdued: 'monster subdued',
};

/** "d6: 1–2 → +2, 3–4 → +1 suspicion" from a discovery roll (rolls with no suspicion are omitted). */
export function suspicionText(r) {
  if (!r) return '';
  let from = 1;
  const parts = [];
  for (const b of r.bands) {
    if (b.amount > 0) parts.push(`${from === b.max ? from : `${from}–${b.max}`} → +${b.amount}`);
    from = b.max + 1;
  }
  return `d${r.die}: ${parts.length ? parts.join(', ') : 'never'} suspicion`;
}

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
    case 'RESEARCH_DRAWN': return `${n(e.playerId)} draws ${e.cards.map((k) => esc(researchName(cfg, k.type))).join(', ')} from the research deck.`;
    case 'RESEARCH_RETURNED': return `${e.cards.length} research card${e.cards.length === 1 ? ' goes' : 's go'} to the bottom of the deck.`;
    case 'RESURRECTION_PREPARED': return `${n(e.playerId)} prepares a resurrection for tonight${e.bodyComplete ? '' : ' (the body is not yet complete)'}.`;
    case 'PLAYER_RESTED': return `${n(e.playerId)} rests and will go first next round.`;
    case 'PARTS_GAINED': return `${n(e.playerId)} obtains ${e.parts.map((p) => esc(variantName(cfg, p.variantId))).join(', ')}.`;
    case 'PARTS_INSTALLED': return `${n(e.playerId)} installs ${e.installs.map((i) => `${esc(variantName(cfg, i.variantId))} (${i.slot})`).join(', ')}${e.bodyComplete ? ' — <i>the body is complete</i>' : ''}.`;
    case 'PARTS_SPENT': return `${n(e.playerId)} ${e.reason === 'sell' ? 'sells' : 'consumes'} ${e.parts.map((p) => esc(variantName(cfg, p.variantId))).join(', ')}${e.reason === 'sell' ? '' : ' in experiments'}.`;
    case 'RESEARCH_ACQUIRED': return `${n(e.playerId)} discovers <b>${esc(researchName(cfg, e.researchType))}</b>.`;
    case 'MARKET_REFILLED': return `New research in the market: ${esc(researchName(cfg, e.researchType))} (${e.deckRemaining} left in deck).`;
    case 'MARKET_DECK_EMPTY': return 'The research deck is exhausted.';
    case 'RESEARCH_PUBLISHED': return `${n(e.playerId)} publishes <b>${esc(researchName(cfg, e.researchType))}</b> for all.`;
    case 'IGOR_HIRED': return `${n(e.playerId)} hires an Igor for ${e.cost}.`;
    case 'DIE_ROLLED': return e.purpose === 'discovery' ? `${n(e.playerId)} rolls d${e.die} for discovery: <b>${e.result}</b>.` : null;
    case 'DISCOVERY_RESOLVED': return e.increase ? null : `${n(e.playerId)} goes unnoticed${e.baseSuspicion && e.reduction ? ' (Discreet Methods)' : ''}.`;
    case 'SUSPICION_CHANGED': return `Suspicion ${e.delta >= 0 ? 'rises' : 'falls'} ${e.delta >= 0 ? '+' : '−'}${Math.abs(e.delta)} → <b>${e.value}/${e.max}</b> (${REASONS[e.reason] || e.reason}${e.playerId ? `, ${n(e.playerId)}` : ''}).`;
    case 'RESURRECTIONS_ANNOUNCED': return e.playerIds.length ? `Attempting resurrection: ${e.playerIds.map(n).join(', ')}.` : null;
    case 'RESURRECTION_CANCELLED': return `${n(e.playerId)}'s body is incomplete; the attempt is called off.`;
    case 'RESURRECTION_STARTED': return `${n(e.playerId)} throws the switch…`;
    case 'RESURRECTION_ROLLED': return `${n(e.playerId)}: ${Object.keys(e.attributes).map((a) => `${attrName(a)} ${e.attributes[a].score}/${e.attributes[a].threshold} ${e.attributes[a].success ? '✓' : '✗'}`).join(', ')}.`;
    case 'RESURRECTION_FAILED': return `${n(e.playerId)}'s body fails to quicken. ${e.refundedParts.length} parts salvaged.`;
    case 'CREATURE_STABILIZED': return `${n(e.playerId)}'s Creature lives — and is <b>${e.disposition.replace(/_/g, ' ')}</b>!`;
    case 'MONSTER_CREATED': return `${n(e.playerId)}'s Creature lives — but it is a <b class="danger">monster</b>! Who will subdue it?`;
    case 'SUBDUE_DECLINED': return `${n(e.playerId)} does not subdue the monster.`;
    case 'CONTROL_SKIPPED': return e.reason === 'not_garrisoned' ? `${n(e.playerId)} has no one in the garrison and cannot subdue it.` : e.reason === 'no_pursuit' ? `${n(e.playerId)} cannot give chase.` : `${n(e.playerId)} has no control attempts left.`;
    case 'PURSUIT_BEGUN': return `The monster flees, pursued by ${e.playerIds.map(n).join(', ')}.`;
    case 'ATTRIBUTE_REROLLED': return `${n(e.playerId)} rerolls a failed ${e.attribute} (${e.firstScore}).`;
    case 'CONTROL_ROLLED': return `${n(e.playerId)} tries to subdue the monster: <b>${e.score}</b> vs ${e.threshold}+ ${e.success ? '✓' : '✗'}.`;
    case 'MONSTER_SUBDUED': return `${n(e.playerId)} subdues and destroys the monster (${e.attemptsLeft} control attempt${e.attemptsLeft === 1 ? '' : 's'} left), salvaging ${e.salvagedParts.map((p) => esc(variantName(cfg, p.variantId))).join(', ')}.`;
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
  if (src.kind === 'research') return `${researchName(cfg, src.researchType)}${src.copy > 1 ? ` ×${src.copy}` : ''}`;
  return src.kind;
}

export const pct = (x) => `${Math.round(x * 1000) / 10}%`;
