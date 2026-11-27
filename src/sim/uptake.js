// Uptake and idleness metrics, read from a finished game's event log.
//
// Uptake says whether the AI uses each piece of content: research acquired
// (by route) and applied, part variants put into attempted bodies, and the
// effects that triggered. A new card nobody takes, or takes but never
// applies, is weak or not understood by the AI; either way the balance
// numbers say little about it until that is fixed.
//
// Idleness says whether workers were left unused: an Igor unused for a whole
// round, or a Scientist unused in a phase. Practising medicine is always
// possible by day, so an idle day is a choice, not a lack of options.

import { effectiveCopies } from '../engine/index.js';

/** Per-game uptake and idleness. The runner may read authoritative state for metrics. */
export function uptakeMetrics(state) {
  const cfg = state.config;
  const acquired = {}; // type -> { research, experiment }
  const acquiredBy = {}; // type -> { research: [playerId...], experiment: [...] }
  const published = {};
  const applied = {}; // type -> roll contributions
  const holders = {}; // type -> players who discovered it
  const variants = {}; // variantId -> attempted bodies containing it
  let attempts = 0;
  const effects = { suspicionSaved: 0, researchCalm: 0, medicineBonus: 0 };
  const placed = {}; // `${round}:${phase}:${workerId}`
  const lastRound = state.round;
  const credit = (src) => {
    if (src && src.kind === 'research') applied[src.researchType] = (applied[src.researchType] || 0) + 1;
  };
  for (const e of state.events) {
    switch (e.type) {
      case 'RESEARCH_ACQUIRED': {
        const a = acquired[e.researchType] || (acquired[e.researchType] = {});
        a[e.via] = (a[e.via] || 0) + 1;
        const b = acquiredBy[e.researchType] || (acquiredBy[e.researchType] = {});
        (b[e.via] || (b[e.via] = [])).push(e.playerId);
        (holders[e.researchType] || (holders[e.researchType] = new Set())).add(e.playerId);
        break;
      }
      case 'RESEARCH_PUBLISHED': published[e.researchType] = (published[e.researchType] || 0) + 1; break;
      case 'RESURRECTION_STARTED':
        attempts += 1;
        for (const x of e.parts) variants[x.variantId] = (variants[x.variantId] || 0) + 1;
        break;
      case 'RESURRECTION_ROLLED':
        for (const a of Object.values(e.attributes)) {
          for (const d of a.dice) credit(d.source);
          for (const f of a.fixed) credit(f.source);
          for (const t of a.thresholdAdjustments) credit(t.source);
        }
        break;
      case 'CONTROL_ROLLED':
        for (const d of e.dice) credit(d.source);
        for (const f of e.fixed) credit(f.source);
        break;
      case 'DISCOVERY_RESOLVED': {
        // Saved by a roll bonus (the roll alone would have been noticed), and by a flat cut.
        const byRoll = Math.max(0, (e.unmodifiedSuspicion ?? e.baseSuspicion) - e.baseSuspicion);
        const byCut = Math.min(e.reduction, e.baseSuspicion);
        effects.suspicionSaved += byRoll + byCut;
        // Credit the research behind it as applied.
        if (byRoll + byCut > 0) {
          for (const [t, def] of Object.entries(cfg.research)) {
            const kinds = [...(byRoll ? ['discoveryRollBonus'] : []), ...(byCut ? ['suspicionReduction'] : [])];
            if (def.effects.some((x) => kinds.includes(x.kind)) && effectiveCopies(state, e.playerId, t) > 0) applied[t] = (applied[t] || 0) + 1;
          }
        }
        break;
      }
      case 'SUSPICION_CHANGED': if (e.reason === 'public_lecture') effects.researchCalm -= e.delta; break;
      case 'MONEY_CHANGED':
        if (e.reason === 'medicine' && cfg.actions.medicine) effects.medicineBonus += e.delta - cfg.actions.medicine.gain;
        break;
      case 'WORKER_PLACED': placed[`${e.round}:${e.phase}:${e.workerId}`] = true; break;
      default:
    }
  }
  // Idleness, over completed rounds only (the last round may stop mid-phase).
  const hiredIn = {};
  for (const e of state.events) if (e.type === 'IGOR_HIRED') hiredIn[e.workerId] = e.round;
  const idle = {};
  for (const p of state.players) {
    const x = { igorRounds: 0, idleIgorRounds: 0, sciPhases: 0, idleSciDay: 0, idleSciNight: 0 };
    const sci = `scientist-${p.id}`;
    const igors = Object.values(state.workers).filter((w) => w.ownerId === p.id && w.kind === 'igor');
    for (let r = 1; r < lastRound; r++) {
      for (const w of igors) {
        // An Igor hired this round may already act; count it from the next.
        if ((hiredIn[w.id] ?? 0) >= r) continue;
        x.igorRounds += 1;
        if (!placed[`${r}:day:${w.id}`] && !placed[`${r}:night:${w.id}`]) x.idleIgorRounds += 1;
      }
      x.sciPhases += 1;
      if (!placed[`${r}:day:${sci}`]) x.idleSciDay += 1;
      if (!placed[`${r}:night:${sci}`]) x.idleSciNight += 1;
    }
    idle[p.id] = x;
  }
  return {
    acquired, acquiredBy, published, applied, attempts, variants, effects, idle,
    holders: Object.fromEntries(Object.entries(holders).map(([t, s]) => [t, [...s]])),
  };
}

const r3 = (x) => Math.round(x * 1000) / 1000;

/**
 * Aggregate uptake over games: per research type, per part variant and per
 * action, plus idleness by objective and policy, and a list of content the
 * AI never or barely used.
 */
export function aggregateUptake(results, config) {
  const withU = results.filter((r) => r.uptake);
  const n = withU.length;
  if (!n) return null;
  const types = new Set(config ? Object.keys(config.research) : []);
  const variantIds = new Set(config ? Object.keys(config.partVariants) : []);
  for (const r of withU) {
    for (const t of [...Object.keys(r.uptake.acquired), ...Object.keys(r.uptake.applied)]) types.add(t);
    for (const v of Object.keys(r.uptake.variants)) variantIds.add(v);
  }
  const research = {};
  for (const t of [...types].sort()) {
    let games = 0; let viaResearch = 0; let viaExperiment = 0; let pub = 0; let app = 0;
    let holderWins = 0; let holderSeats = 0; let otherWins = 0; let otherSeats = 0;
    for (const r of withU) {
      const a = r.uptake.acquired[t] || {};
      if (Object.keys(a).length) games += 1;
      viaResearch += a.research || 0;
      viaExperiment += a.experiment || 0;
      pub += r.uptake.published[t] || 0;
      app += r.uptake.applied[t] || 0;
      const h = new Set(r.uptake.holders[t] || []);
      for (const pid of Object.keys(r.objectives)) {
        const won = r.winners.includes(pid) ? 1 : 0;
        if (h.has(pid)) { holderSeats += 1; holderWins += won; } else { otherSeats += 1; otherWins += won; }
      }
    }
    research[t] = {
      acquiredInGames: r3(games / n),
      perGame: { research: r3(viaResearch / n), experiment: r3(viaExperiment / n), published: r3(pub / n), appliedInRolls: r3(app / n) },
      // Correlation, not cause: strong players acquire more research.
      winRateHolders: holderSeats ? r3(holderWins / holderSeats) : null,
      winRateOthers: otherSeats ? r3(otherWins / otherSeats) : null,
    };
  }
  const attempts = withU.reduce((a, r) => a + r.uptake.attempts, 0);
  const variants = {};
  for (const v of [...variantIds].sort()) {
    const k = withU.reduce((a, r) => a + (r.uptake.variants[v] || 0), 0);
    variants[v] = attempts ? r3(k / attempts) : 0;
  }
  const effects = {};
  for (const r of withU) for (const [k, v] of Object.entries(r.uptake.effects)) effects[k] = (effects[k] || 0) + v / n;
  for (const k of Object.keys(effects)) effects[k] = r3(effects[k]);
  const idleBy = {};
  for (const r of withU) {
    const pids = Object.keys(r.objectives);
    pids.forEach((pid, i) => {
      const key = `${r.objectives[pid]}/${(r.policies || [])[i] || 'unknown'}`;
      const x = idleBy[key] || (idleBy[key] = { igorRounds: 0, idleIgorRounds: 0, sciPhases: 0, idleSciDay: 0, idleSciNight: 0 });
      for (const f of Object.keys(x)) x[f] += r.uptake.idle[pid][f];
    });
  }
  const idle = Object.fromEntries(Object.entries(idleBy).sort().map(([k, x]) => [k, {
    idleIgorShare: x.igorRounds ? r3(x.idleIgorRounds / x.igorRounds) : 0,
    idleScientistDayShare: x.sciPhases ? r3(x.idleSciDay / x.sciPhases) : 0,
    idleScientistNightShare: x.sciPhases ? r3(x.idleSciNight / x.sciPhases) : 0,
  }]));
  const actions = {};
  for (const r of withU) for (const [id, a] of Object.entries(r.economy.actions)) actions[id] = (actions[id] || 0) + a.placements;
  const unused = [
    ...Object.entries(research).filter(([, x]) => x.acquiredInGames < 0.05).map(([t]) => `research:${t}`),
    ...Object.entries(research).filter(([t, x]) => x.acquiredInGames >= 0.05 && x.perGame.appliedInRolls === 0 && isRollEffect(config, t)).map(([t]) => `research-never-applied:${t}`),
    ...Object.entries(actions).filter(([, k]) => k === 0).map(([id]) => `action:${id}`),
  ];
  // Variants never put into an attempted body. Harmful parts belong here, so
  // this is listed apart from rarelyUsed.
  const variantsNeverAttempted = attempts >= 20 ? Object.entries(variants).filter(([, x]) => x === 0).map(([v]) => v) : [];
  return { games: n, attempts, research, variantsPerBody: variants, variantsNeverAttempted, effects, idle, rarelyUsed: unused };
}

// Research whose effects act on resurrection or control rolls, so "applied in
// rolls" is meaningful for it.
function isRollEffect(config, type) {
  const def = config && config.research[type];
  return !!def && def.effects.some((e) => ['resurrection', 'control', 'discoveryRollBonus', 'suspicionReduction'].includes(e.kind));
}
