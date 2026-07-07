/**
 * Deterministic seeded RNG + 2D value noise.
 * All randomness in game logic MUST flow through these so that
 * worldgen and battle resolution are reproducible from a seed.
 */

/** Mulberry32 — small, fast, good-enough distribution for game logic. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Pick a uniformly random element. */
  pick<T>(arr: T[]): T;
  /** True with probability p. */
  chance(p: number): boolean;
}

export function rng(seed: number): Rng {
  const next = createRng(seed);
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
  };
}

/** Deterministic 32-bit hash of integer coordinates + seed. */
export function hash2(x: number, y: number, seed: number): number {
  let h = seed >>> 0;
  h = Math.imul(h ^ (x | 0), 0x85ebca6b);
  h = Math.imul(h ^ (y | 0), 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x27d4eb2f);
  h ^= h >>> 15;
  return h >>> 0;
}

/** Deterministic float in [0,1) from coordinates + seed. */
export function rand2(x: number, y: number, seed: number): number {
  return hash2(x, y, seed) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Single-octave 2D value noise in [0,1). `scale` = feature size in world units. */
export function valueNoise(x: number, y: number, scale: number, seed: number): number {
  const gx = x / scale;
  const gy = y / scale;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const tx = smoothstep(gx - x0);
  const ty = smoothstep(gy - y0);
  const v00 = rand2(x0, y0, seed);
  const v10 = rand2(x0 + 1, y0, seed);
  const v01 = rand2(x0, y0 + 1, seed);
  const v11 = rand2(x0 + 1, y0 + 1, seed);
  const a = v00 + (v10 - v00) * tx;
  const b = v01 + (v11 - v01) * tx;
  return a + (b - a) * ty;
}

/** Fractal (multi-octave) value noise in [0,1). */
export function fractalNoise(
  x: number,
  y: number,
  scale: number,
  seed: number,
  octaves = 4,
  persistence = 0.5,
): number {
  let amp = 1;
  let freq = 1;
  let total = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    total += amp * valueNoise(x * freq, y * freq, scale, seed + i * 1013);
    norm += amp;
    amp *= persistence;
    freq *= 2;
  }
  return total / norm;
}
