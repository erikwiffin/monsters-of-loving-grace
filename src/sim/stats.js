// Small statistics helpers for comparing batches of games.

const Z95 = 1.959964;

/** Wilson score interval for k successes in n trials. */
export function wilson(k, n, z = Z95) {
  if (!n) return { rate: 0, lo: 0, hi: 1, n: 0 };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { rate: p, lo: Math.max(0, c - h), hi: Math.min(1, c + h), n };
}

/** Two-sided p-value of a standard normal score. */
export function normalP(z) {
  // Abramowitz and Stegun 7.1.26, accurate to about 1e-7.
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 1 - erf;
}

/**
 * Difference of two proportions (b minus a), with its 95% interval and a
 * two-sided p-value for "no difference".
 */
export function compareRates(ka, na, kb, nb, z = Z95) {
  const pa = na ? ka / na : 0;
  const pb = nb ? kb / nb : 0;
  const diff = pb - pa;
  const se = Math.sqrt((pa * (1 - pa)) / Math.max(1, na) + (pb * (1 - pb)) / Math.max(1, nb));
  const pooled = (ka + kb) / Math.max(1, na + nb);
  const se0 = Math.sqrt(pooled * (1 - pooled) * (1 / Math.max(1, na) + 1 / Math.max(1, nb)));
  const score = se0 > 0 ? diff / se0 : 0;
  return { a: pa, b: pb, diff, lo: diff - z * se, hi: diff + z * se, p: se0 > 0 ? normalP(score) : 1 };
}

/** Games needed for a 95% interval of ±halfWidth around a rate near p. */
export function gamesForHalfWidth(halfWidth, p = 0.5, z = Z95) {
  return Math.ceil((z * z * p * (1 - p)) / (halfWidth * halfWidth));
}

/** Win rate with interval per objective: wins / players dealt it. */
export function objectiveRates(results) {
  const dealt = {};
  const wins = {};
  for (const r of results) {
    for (const o of Object.values(r.objectives)) dealt[o] = (dealt[o] || 0) + 1;
    for (const o of r.winnerObjectives) wins[o] = (wins[o] || 0) + 1;
  }
  return Object.fromEntries(Object.keys(dealt).sort().map((o) => [o, { wins: wins[o] || 0, dealt: dealt[o], ...wilson(wins[o] || 0, dealt[o]) }]));
}

export const pct = (x, d = 1) => `${(100 * x).toFixed(d)}%`;
