// Replaceable decision policies for headless playtests.
// A policy is any object with decide({ playerId, view, legal }) -> command.
// `view` is the engine's filtered player observation; `legal` is the
// expanded list of legal commands. Policies never see authoritative state.
// Policies may be async (return a Promise) — the async runner awaits them.

import { seedState, randInt, nextUint32 } from '../engine/rng.js';

function makeRandom(seed) {
  const st = seedState(seed);
  return {
    int: (n) => randInt(st, n),
    float: () => nextUint32(st) / 0x100000000,
  };
}

/** Uniformly random legal command; passes only occasionally. */
export function randomPolicy(seed = 'random') {
  const r = makeRandom(seed);
  return {
    name: 'random',
    decide({ legal }) {
      const nonPass = legal.filter((c) => c.type !== 'PASS_TURN');
      if (nonPass.length && r.float() > 0.1) return nonPass[r.int(nonPass.length)];
      return legal[r.int(legal.length)];
    },
  };
}

function effectValue(e) {
  if (e.op === 'die') return e.sign * (e.die + 1) / 2;
  if (e.op === 'fixed') return e.amount;
  if (e.op === 'threshold') return -e.amount;
  return 0;
}

function variantValue(cfg, variantId) {
  return cfg.partVariants[variantId].effects.reduce((a, e) => a + effectValue(e) * (e.attribute === 'vitality' ? 1 : 1.5), 0);
}

/**
 * A simple greedy strategy: earn money, buy useful research, gather the best
 * parts it can, assemble, and attempt resurrection once it has some safety
 * research (or immediately, if its objective favours chaos).
 */
export function heuristicPolicy(seed = 'heuristic', { noise = 0.75 } = {}) {
  const r = makeRandom(seed);
  return {
    name: 'heuristic',
    decide({ view, legal }) {
      const me = view.players.find((p) => p.id === view.viewerId);
      const objective = view.private.objective;
      const cfg = view.config;
      if (view.phase === 'commitment') {
        // Any stable Creature ends the game at dawn (spec 020), so each
        // objective weighs the outcomes differently.
        const odds = me.resurrectionOdds;
        const safeEnough = odds.pStable >= odds.pUnleashed * 1.2 || (view.round >= 12 && odds.pStable >= odds.pUnleashed * 0.6);
        let attempt;
        if (objective === 'prometheus') {
          // Needs a lone stable Creature.
          attempt = safeEnough;
        } else if (objective === 'visionary') {
          // A lone Creature loses for everyone; only try alongside a rival body.
          const rivalBodies = view.players.some((p) => p.id !== me.id && p.bodyComplete);
          attempt = rivalBodies && safeEnough;
        } else if (objective === 'unleasher') {
          // Wants an unleashed Creature; a stable one loses.
          attempt = odds.pUnleashed > odds.pStable;
        } else {
          // Inquisitor: only a failed Vitality helps (+1 suspicion), and only
          // when that failure would bring the mob.
          attempt = view.suspicion >= view.suspicionMax - 1 && odds.pFailed > 0.5;
        }
        return legal.find((c) => c.attempt === attempt) || legal[0];
      }
      const open = {};
      for (const [type, def] of Object.entries(cfg.partTypes)) open[type] = def.slots.filter((sl) => me.body[sl] === null).length;
      const needed = Object.values(open).reduce((a, b) => a + b, 0);
      const looseFits = me.loose.filter((x) => open[x.type] > 0).length;
      const susp = view.suspicion / view.suspicionMax;
      const wantsSuspicion = objective === 'inquisitor';

      const score = (c) => {
        if (c.type === 'PASS_TURN') return 0.2;
        const a = c.actionId;
        const def = cfg.actions[a];
        switch (a) {
          case 'medicine': return me.money < 4 ? 4 : 1.5;
          case 'research': case 'experiment': {
            const card = view.market.find((k) => k.id === c.choices.researchCardId);
            const want = (objective === 'unleasher'
              ? { galvanism: 4.5, neurology: 0.5, philosophy: 0.5, anatomy: 2, medicine: 2.5, discretion: susp > 0.3 ? 3 : 1 }
              : objective === 'inquisitor'
                ? { galvanism: 0.5, neurology: 1, philosophy: 1, anatomy: 1.5, medicine: 3, discretion: 0 }
                : { galvanism: 4, neurology: 4.5, philosophy: 4.5, anatomy: 2, medicine: 2.5, discretion: susp > 0.3 ? 3 : 1 })[card.type] || 1;
            if (a === 'experiment') {
              const fitsLost = c.choices.partIds.filter((id) => { const x = me.loose.find((y) => y.id === id); return open[x.type] > 0; }).length;
              return want - fitsLost * 1.5 + 0.5;
            }
            return me.money >= def.cost + 2 ? want : want - 1.5;
          }
          case 'specimens': {
            if (!needed) return 0;
            const left = { ...open };
            let v = 0;
            for (const vid of c.choices.variantIds) {
              const t = cfg.partVariants[vid].type;
              if (left[t] > 0) { left[t]--; v += 2 + variantValue(cfg, vid) * 0.4; } else v -= 1;
            }
            return looseFits >= needed ? v - 4 : v;
          }
          case 'hire': return view.round <= 5 ? 3.5 : 1;
          case 'charity': return wantsSuspicion ? -1 : susp * 6 - 1;
          case 'lecture': return 1 + me.published.length;
          case 'publish': return objective === 'visionary' ? 3.5 : 2;
          case 'graves': case 'morgue': {
            if (wantsSuspicion) return 4;
            if (looseFits >= needed) return 0.5 - susp * 3;
            return (a === 'morgue' ? 3.5 : 3) - susp * 4;
          }
          case 'assemble': {
            return 5 + c.choices.partIds.reduce((acc, id) => acc + variantValue(cfg, me.loose.find((x) => x.id === id).variantId) * 0.5 + 1, 0);
          }
          case 'conceal': return wantsSuspicion ? -1 : susp * 6 - 0.5;
          default: return 0.5;
        }
      };
      let best = legal[0];
      let bestScore = -Infinity;
      for (const c of legal) {
        const sc = score(c) + r.float() * noise;
        if (sc > bestScore) { bestScore = sc; best = c; }
      }
      return best;
    },
  };
}

export const POLICIES = { random: randomPolicy, heuristic: heuristicPolicy };
