// Deterministic, serializable PRNG (sfc32 seeded with xmur3-style hashing).
// The state is a plain array of four unsigned 32-bit integers, so it can be
// stored in JSON and restored exactly.

export function seedState(seed) {
  const str = String(seed);
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  const next = () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
  const st = [next(), next(), next(), next()];
  for (let i = 0; i < 15; i++) nextUint32(st);
  return st;
}

/** Advances the state array in place and returns an unsigned 32-bit integer. */
export function nextUint32(st) {
  let a = st[0] | 0, b = st[1] | 0, c = st[2] | 0, d = st[3] | 0;
  let t = (a + b) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  d = (d + 1) | 0;
  t = (t + d) | 0;
  c = (c + t) | 0;
  st[0] = a >>> 0; st[1] = b >>> 0; st[2] = c >>> 0; st[3] = d >>> 0;
  return t >>> 0;
}

/** Unbiased integer in [0, n). */
export function randInt(st, n) {
  if (!Number.isInteger(n) || n <= 0) throw new Error(`randInt: invalid bound ${n}`);
  const limit = Math.floor(0x100000000 / n) * n;
  let x;
  do { x = nextUint32(st); } while (x >= limit);
  return x % n;
}

/** Fair die in [1, sides]. */
export function rollDie(st, sides) {
  return randInt(st, sides) + 1;
}

/** In-place Fisher–Yates shuffle. */
export function shuffle(st, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(st, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function isRngState(x) {
  return Array.isArray(x) && x.length === 4 && x.every((v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff);
}
