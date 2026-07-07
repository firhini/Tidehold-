/**
 * World generation — a dying continent, deterministic from a seed.
 *
 * Requirements (the contract tests assert these):
 * - Deterministic: same (seed, radius) → identical tiles in identical order.
 * - Returns one Tile per coord in hexSpiral({q:0,r:0}, radius).
 * - Elevation 0..MAX_ELEVATION shaped like a continent: high central/scattered
 *   highlands falling away to ocean at the rim. Elevation 0 tiles are 'ocean'
 *   with flooded=true. At least 8% of tiles at elevation >= 7 (late-game land),
 *   and 35–65% of tiles at elevation >= 1 (initial land).
 * - Terrain assignment for land: elevation 1 adjacent-to-ocean → 'coast';
 *   9 → 'peak'; 7..8 → 'mountains'; 5..6 → 'hills'; else moisture noise picks
 *   'forest' (wet) or 'plains' (dry). A sprinkle of 'ruins' (~1.5% of land,
 *   never on coast) with ruinTier 1..3 (higher tiers on higher ground) and a
 *   garrison sized GARRISON_BY_TIER[tier-1] ± 20%.
 * - richness: 1..3, weighted so ~60% are 1, ~30% are 2, ~10% are 3; higher
 *   richness slightly biased toward LOW elevation (rich land drowns first —
 *   this is the core dramatic tension of the game).
 * - No building/owner on generated tiles.
 *
 * How elevation is shaped: every coord gets a "continent score" — fractal
 * value noise sampled at its pixel position, blended with a radial falloff
 * (1 at the center, 0 at the rim). Tiles are then RANKED by score and
 * elevation is assigned by quantile against ELEVATION_CDF. Ranking preserves
 * the spatial shape of the score field (contiguous continent, ocean rim,
 * scattered highlands) while making the land-fraction and high-ground
 * constraints hold exactly for ANY seed, not just lucky ones.
 */
import { MAX_ELEVATION } from './constants.js';
import { hexDistance, hexKey, hexNeighbors, hexSpiral, hexToPixel } from './hex.js';
import { fractalNoise, hash2, rand2 } from './rng.js';
import type { AxialCoord, TerrainType, Tile } from './types.js';

/** Garrison strength per ruin tier. */
export const GARRISON_BY_TIER = [25, 60, 120] as const;

// ---------------------------------------------------------------------------
// Worldgen tuning (structure of the generator, not cross-system balance —
// cross-system numbers like MAX_ELEVATION live in constants.ts).
// ---------------------------------------------------------------------------

const ORIGIN: AxialCoord = { q: 0, r: 0 };

/** Hex pixel size used purely to sample noise fields (rendering-independent). */
const NOISE_HEX_SIZE = 1;
/** Feature size (noise-pixel units) of the elevation field. */
const ELEVATION_NOISE_SCALE = 10;
/** Feature size of the moisture field; smaller → interleaved forest/plains. */
const MOISTURE_NOISE_SCALE = 6;
/** Blend weights of noise vs radial falloff in the raw continent score. */
const NOISE_WEIGHT = 0.45;
const FALLOFF_WEIGHT = 0.55;

/**
 * Cumulative quantile ceiling per elevation 0..MAX_ELEVATION. A tile whose
 * score-rank quantile is <= ELEVATION_CDF[e] (and > ELEVATION_CDF[e-1]) gets
 * elevation e. Land fraction = 1 - CDF[0] = 51.5% (spec: 35–65%); tiles at
 * elevation >= 7 = 1 - CDF[6] = 10.5% (spec: >= 8%). Length MAX_ELEVATION+1.
 */
const ELEVATION_CDF = [
  0.485, // 0 ocean
  0.585, // 1 shoreline lowlands
  0.665, // 2
  0.735, // 3
  0.795, // 4
  0.845, // 5 hills
  0.895, // 6 hills
  0.94, // 7 mountains
  0.975, // 8 mountains
  1, // 9 peak
] as const;

/** Elevation bands for terrain assignment. */
const PEAK_MIN_ELEVATION = MAX_ELEVATION; // 9 → 'peak'
const MOUNTAINS_MIN_ELEVATION = 7; // 7..8 → 'mountains'
const HILLS_MIN_ELEVATION = 5; // 5..6 → 'hills'

/** Moisture at or above this grows forest; drier land is plains. */
const FOREST_MOISTURE_THRESHOLD = 0.5;

/** Chance a (non-coast) land tile hides ruins of the old world (~1.5%). */
const RUIN_CHANCE = 0.015;
/** Garrison jitter around GARRISON_BY_TIER: base ± 20%. */
const GARRISON_JITTER = 0.2;

/** Ruin-tier weights: tier 3/2 probability grows with elevation. */
const RUIN_TIER3_BASE = 0.1;
const RUIN_TIER3_HIGHLAND_BONUS = 0.3;
const RUIN_TIER2_BASE = 0.3;
const RUIN_TIER2_HIGHLAND_BONUS = 0.15;

/**
 * Richness weights: richness 3/2 probability grows toward LOW elevation.
 * Averaged over the land elevation distribution this lands near 60/30/10.
 */
const RICHNESS_P3_BASE = 0.04;
const RICHNESS_P3_LOWLAND_BONUS = 0.12;
const RICHNESS_P2_BASE = 0.18;
const RICHNESS_P2_LOWLAND_BONUS = 0.24;

/** Labels for decorrelated per-field sub-seeds derived from the world seed. */
const SUBSEED_MOISTURE = 1;
const SUBSEED_RICHNESS = 2;
const SUBSEED_RUIN_SCATTER = 3;
const SUBSEED_RUIN_TIER = 4;
const SUBSEED_GARRISON = 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Deterministically derive an independent sub-seed for one noise field. */
function subSeed(label: number, seed: number): number {
  return hash2(label, 0x7fd1, seed);
}

/** Elevation for a score-rank quantile in (0,1], per ELEVATION_CDF. */
function elevationForQuantile(quantile: number): number {
  for (let e = 0; e < ELEVATION_CDF.length; e++) {
    if (quantile <= ELEVATION_CDF[e]) return e;
  }
  return MAX_ELEVATION;
}

/**
 * Richness class 1..3 for a land tile. `roll` is a uniform [0,1) draw.
 * Weighted ~60/30/10 across the continent, with richness 2–3 more likely at
 * LOW elevation — rich land drowns first, the game's core dramatic tension.
 * Exported so tests (and balance tooling) can probe the bias directly.
 */
export function richnessFor(elevation: number, roll: number): number {
  const lowland = 1 - clamp01(elevation / MAX_ELEVATION); // 1 at sea level → 0 at peak
  const p3 = RICHNESS_P3_BASE + RICHNESS_P3_LOWLAND_BONUS * lowland;
  const p2 = RICHNESS_P2_BASE + RICHNESS_P2_LOWLAND_BONUS * lowland;
  if (roll < p3) return 3;
  if (roll < p3 + p2) return 2;
  return 1;
}

/**
 * Ruin tier 1..3 for a ruin at the given elevation. `roll` is a uniform
 * [0,1) draw. For any fixed roll the tier is non-decreasing in elevation:
 * the old world's greatest vaults were built on high ground.
 * Exported so tests can verify the bias structurally.
 */
export function ruinTierFor(elevation: number, roll: number): 1 | 2 | 3 {
  const highland = clamp01(elevation / MAX_ELEVATION);
  const p3 = RUIN_TIER3_BASE + RUIN_TIER3_HIGHLAND_BONUS * highland;
  const p2 = RUIN_TIER2_BASE + RUIN_TIER2_HIGHLAND_BONUS * highland;
  if (roll < p3) return 3;
  if (roll < p3 + p2) return 2;
  return 1;
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export function generateWorld(seed: number, radius: number): Tile[] {
  if (!Number.isFinite(radius) || radius < 0) return [];
  const r = Math.floor(radius);
  const coords = hexSpiral({ q: 0, r: 0 }, r);
  const n = coords.length;
  if (n === 0) return [];

  const moistureSeed = subSeed(SUBSEED_MOISTURE, seed);
  const richnessSeed = subSeed(SUBSEED_RICHNESS, seed);
  const ruinScatterSeed = subSeed(SUBSEED_RUIN_SCATTER, seed);
  const ruinTierSeed = subSeed(SUBSEED_RUIN_TIER, seed);
  const garrisonSeed = subSeed(SUBSEED_GARRISON, seed);

  // -- Pass 1: continent score = fractal noise blended with radial falloff.
  const scores = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const c = coords[i];
    const { x, y } = hexToPixel(c, NOISE_HEX_SIZE);
    const noise = fractalNoise(x, y, ELEVATION_NOISE_SCALE, seed);
    const d01 = hexDistance(c, ORIGIN) / Math.max(1, r);
    const falloff = clamp01(1 - d01 * d01); // 1 at center → 0 at the rim
    scores[i] = NOISE_WEIGHT * noise + FALLOFF_WEIGHT * falloff;
  }

  // -- Pass 2: rank scores and assign elevation by quantile so the stated
  // land/high-ground fractions hold for any seed. Ties (astronomically rare
  // with float scores) break by spiral index, keeping output deterministic.
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => scores[a] - scores[b] || a - b,
  );
  const elevations = new Array<number>(n);
  for (let rank = 0; rank < n; rank++) {
    elevations[order[rank]] = elevationForQuantile((rank + 0.5) / n);
  }

  // -- Pass 3: elevation lookup for coast detection. Hexes beyond the map rim
  // are the endless sea, so a missing neighbor counts as ocean.
  const elevationByKey = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    elevationByKey.set(hexKey(coords[i].q, coords[i].r), elevations[i]);
  }
  const touchesOcean = (c: AxialCoord): boolean =>
    hexNeighbors(c).some((nb) => (elevationByKey.get(hexKey(nb.q, nb.r)) ?? 0) === 0);

  // -- Pass 4: build tiles in spiral order.
  const tiles: Tile[] = [];
  for (let i = 0; i < n; i++) {
    const c = coords[i];
    const elevation = elevations[i];

    if (elevation === 0) {
      tiles.push({
        q: c.q,
        r: c.r,
        elevation: 0,
        terrain: 'ocean',
        flooded: true,
        richness: 1,
      });
      continue;
    }

    let terrain: TerrainType;
    if (elevation >= PEAK_MIN_ELEVATION) {
      terrain = 'peak';
    } else if (elevation >= MOUNTAINS_MIN_ELEVATION) {
      terrain = 'mountains';
    } else if (elevation >= HILLS_MIN_ELEVATION) {
      terrain = 'hills';
    } else if (elevation === 1 && touchesOcean(c)) {
      terrain = 'coast';
    } else {
      const { x, y } = hexToPixel(c, NOISE_HEX_SIZE);
      const moisture = fractalNoise(x, y, MOISTURE_NOISE_SCALE, moistureSeed);
      terrain = moisture >= FOREST_MOISTURE_THRESHOLD ? 'forest' : 'plains';
    }

    const tile: Tile = {
      q: c.q,
      r: c.r,
      elevation,
      terrain,
      flooded: false,
      richness: richnessFor(elevation, rand2(c.q, c.r, richnessSeed)),
    };

    // Ruins: a deterministic scatter over land, never on the coast — the old
    // world built inland, and ports must stay legal on every shoreline.
    if (terrain !== 'coast' && rand2(c.q, c.r, ruinScatterSeed) < RUIN_CHANCE) {
      const tier = ruinTierFor(elevation, rand2(c.q, c.r, ruinTierSeed));
      const base = GARRISON_BY_TIER[tier - 1];
      const jitter = 1 - GARRISON_JITTER + 2 * GARRISON_JITTER * rand2(c.q, c.r, garrisonSeed);
      tile.terrain = 'ruins';
      tile.ruinTier = tier;
      tile.garrison = Math.max(1, Math.round(base * jitter));
    }

    tiles.push(tile);
  }

  return tiles;
}
