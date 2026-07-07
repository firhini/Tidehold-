/**
 * Contract tests for worldgen — the drowning continent must be deterministic,
 * correctly shaped, and obey every rule in the module spec, for every seed.
 */
import { describe, expect, it } from 'vitest';
import { MAX_ELEVATION } from '../src/constants.js';
import { hexKey, hexNeighbors, hexSpiral } from '../src/hex.js';
import type { Tile } from '../src/types.js';
import {
  GARRISON_BY_TIER,
  generateWorld,
  richnessFor,
  ruinTierFor,
} from '../src/worldgen.js';

const SEEDS = [1, 42, 421337, 999983];
const RADIUS = 26;

/** One generated world per contract seed, shared across tests. */
const WORLDS = new Map<number, Tile[]>(SEEDS.map((s) => [s, generateWorld(s, RADIUS)]));

function landTiles(tiles: Tile[]): Tile[] {
  return tiles.filter((t) => t.elevation >= 1);
}

/** Ocean-adjacency exactly as worldgen defines it: off-map hexes are sea. */
function touchesOcean(tile: Tile, elevByKey: Map<string, number>): boolean {
  return hexNeighbors({ q: tile.q, r: tile.r }).some(
    (nb) => (elevByKey.get(hexKey(nb.q, nb.r)) ?? 0) === 0,
  );
}

function elevationMap(tiles: Tile[]): Map<string, number> {
  return new Map(tiles.map((t) => [hexKey(t.q, t.r), t.elevation]));
}

describe('generateWorld — determinism', () => {
  it('produces identical tiles in identical order for the same (seed, radius)', () => {
    for (const seed of SEEDS) {
      const again = generateWorld(seed, RADIUS);
      expect(again).toEqual(WORLDS.get(seed)!);
    }
  });

  it('produces different worlds for different seeds', () => {
    const a = WORLDS.get(SEEDS[0])!;
    const b = WORLDS.get(SEEDS[1])!;
    expect(a.some((t, i) => t.elevation !== b[i].elevation || t.terrain !== b[i].terrain)).toBe(
      true,
    );
  });
});

describe('generateWorld — tile grid', () => {
  it('returns one tile per hexSpiral coord, in spiral order', () => {
    const spiral = hexSpiral({ q: 0, r: 0 }, RADIUS);
    for (const seed of SEEDS) {
      const tiles = WORLDS.get(seed)!;
      expect(tiles.length).toBe(spiral.length);
      expect(tiles.length).toBe(3 * RADIUS * (RADIUS + 1) + 1);
      for (let i = 0; i < tiles.length; i++) {
        expect(tiles[i].q).toBe(spiral[i].q);
        expect(tiles[i].r).toBe(spiral[i].r);
      }
    }
  });

  it('never sets building or ownerId on generated tiles', () => {
    for (const seed of SEEDS) {
      for (const t of WORLDS.get(seed)!) {
        expect(t.building).toBeUndefined();
        expect(t.ownerId).toBeUndefined();
      }
    }
  });
});

describe('generateWorld — elevation & continent shape', () => {
  it('keeps elevation an integer in 0..MAX_ELEVATION', () => {
    for (const seed of SEEDS) {
      for (const t of WORLDS.get(seed)!) {
        expect(Number.isInteger(t.elevation)).toBe(true);
        expect(t.elevation).toBeGreaterThanOrEqual(0);
        expect(t.elevation).toBeLessThanOrEqual(MAX_ELEVATION);
      }
    }
  });

  it('makes every elevation-0 tile flooded ocean, and only those', () => {
    for (const seed of SEEDS) {
      for (const t of WORLDS.get(seed)!) {
        if (t.elevation === 0) {
          expect(t.terrain).toBe('ocean');
          expect(t.flooded).toBe(true);
        } else {
          expect(t.terrain).not.toBe('ocean');
          expect(t.flooded).toBe(false);
        }
        // Genesis has no recently-drowned land.
        expect(t.terrain).not.toBe('drowned');
      }
    }
  });

  it('yields 35–65% land (elevation >= 1) for every seed', () => {
    for (const seed of SEEDS) {
      const tiles = WORLDS.get(seed)!;
      const landFrac = landTiles(tiles).length / tiles.length;
      expect(landFrac).toBeGreaterThanOrEqual(0.35);
      expect(landFrac).toBeLessThanOrEqual(0.65);
    }
  });

  it('yields at least 8% of tiles at elevation >= 7 for every seed', () => {
    for (const seed of SEEDS) {
      const tiles = WORLDS.get(seed)!;
      const highFrac = tiles.filter((t) => t.elevation >= 7).length / tiles.length;
      expect(highFrac).toBeGreaterThanOrEqual(0.08);
    }
  });

  it('slopes toward the center: inner third is mostly land, the rim is ocean-heavy', () => {
    for (const seed of SEEDS) {
      const tiles = WORLDS.get(seed)!;
      const dist = (t: Tile) => (Math.abs(t.q) + Math.abs(t.r) + Math.abs(t.q + t.r)) / 2;
      const inner = tiles.filter((t) => dist(t) <= RADIUS / 3);
      const rim = tiles.filter((t) => dist(t) === RADIUS);
      const innerLand = inner.filter((t) => t.elevation >= 1).length / inner.length;
      const rimLand = rim.filter((t) => t.elevation >= 1).length / rim.length;
      expect(innerLand).toBeGreaterThan(0.8);
      expect(rimLand).toBeLessThan(0.1);
    }
  });
});

describe('generateWorld — terrain assignment', () => {
  it('maps elevation bands to terrain (ruins may replace any non-coast land)', () => {
    for (const seed of SEEDS) {
      const tiles = WORLDS.get(seed)!;
      const elevByKey = elevationMap(tiles);
      for (const t of tiles) {
        if (t.elevation === 0 || t.terrain === 'ruins') continue;
        if (t.elevation === MAX_ELEVATION) {
          expect(t.terrain).toBe('peak');
        } else if (t.elevation >= 7) {
          expect(t.terrain).toBe('mountains');
        } else if (t.elevation >= 5) {
          expect(t.terrain).toBe('hills');
        } else if (t.elevation === 1 && touchesOcean(t, elevByKey)) {
          expect(t.terrain).toBe('coast');
        } else {
          expect(['forest', 'plains']).toContain(t.terrain);
        }
      }
    }
  });

  it('marks coast exactly on elevation-1 land adjacent to ocean', () => {
    for (const seed of SEEDS) {
      const tiles = WORLDS.get(seed)!;
      const elevByKey = elevationMap(tiles);
      for (const t of tiles) {
        if (t.terrain === 'coast') {
          expect(t.elevation).toBe(1);
          expect(touchesOcean(t, elevByKey)).toBe(true);
        }
        if (t.elevation === 1 && touchesOcean(t, elevByKey) && t.terrain !== 'ruins') {
          expect(t.terrain).toBe('coast');
        }
      }
    }
  });

  it('has a ports-legal shoreline: at least 30 coast tiles per seed', () => {
    for (const seed of SEEDS) {
      const coast = WORLDS.get(seed)!.filter((t) => t.terrain === 'coast');
      expect(coast.length).toBeGreaterThanOrEqual(30);
    }
  });

  it('grows both forest and plains in meaningful quantity', () => {
    for (const seed of SEEDS) {
      const tiles = WORLDS.get(seed)!;
      expect(tiles.filter((t) => t.terrain === 'forest').length).toBeGreaterThanOrEqual(25);
      expect(tiles.filter((t) => t.terrain === 'plains').length).toBeGreaterThanOrEqual(25);
    }
  });
});

describe('generateWorld — ruins', () => {
  it('scatters a sensible number of ruins (>= 5, and ~1.5% of land, never a flood)', () => {
    for (const seed of SEEDS) {
      const tiles = WORLDS.get(seed)!;
      const land = landTiles(tiles);
      const ruins = tiles.filter((t) => t.terrain === 'ruins');
      expect(ruins.length).toBeGreaterThanOrEqual(5);
      expect(ruins.length / land.length).toBeLessThanOrEqual(0.04);
      for (const t of ruins) expect(t.elevation).toBeGreaterThanOrEqual(1);
    }
  });

  it('never places ruins on coast-eligible tiles', () => {
    for (const seed of SEEDS) {
      const tiles = WORLDS.get(seed)!;
      const elevByKey = elevationMap(tiles);
      for (const t of tiles) {
        if (t.terrain !== 'ruins') continue;
        const coastEligible = t.elevation === 1 && touchesOcean(t, elevByKey);
        expect(coastEligible).toBe(false);
      }
    }
  });

  it('gives every ruin a tier 1..3 and a garrison within ±20% of GARRISON_BY_TIER', () => {
    for (const seed of SEEDS) {
      for (const t of WORLDS.get(seed)!) {
        if (t.terrain !== 'ruins') {
          expect(t.ruinTier).toBeUndefined();
          expect(t.garrison).toBeUndefined();
          continue;
        }
        expect([1, 2, 3]).toContain(t.ruinTier);
        const base = GARRISON_BY_TIER[t.ruinTier! - 1];
        expect(Number.isInteger(t.garrison)).toBe(true);
        expect(t.garrison!).toBeGreaterThanOrEqual(Math.floor(base * 0.8));
        expect(t.garrison!).toBeLessThanOrEqual(Math.ceil(base * 1.2));
        expect(t.garrison!).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('biases ruin tiers higher on higher ground (structural monotonicity)', () => {
    for (let roll = 0; roll < 1; roll += 0.01) {
      let prev = 0;
      for (let elevation = 1; elevation <= MAX_ELEVATION; elevation++) {
        const tier = ruinTierFor(elevation, roll);
        expect(tier).toBeGreaterThanOrEqual(1);
        expect(tier).toBeLessThanOrEqual(3);
        // Tier ordering by roll is inverted (low roll = high tier), so check
        // that raising elevation never lowers the tier for a fixed roll.
        expect(tier).toBeGreaterThanOrEqual(prev);
        prev = tier;
      }
    }
  });

  it('biases ruin tiers higher on higher ground (observed in generated worlds)', () => {
    const low: number[] = [];
    const high: number[] = [];
    for (const seed of SEEDS) {
      for (const t of WORLDS.get(seed)!) {
        if (t.terrain !== 'ruins') continue;
        if (t.elevation <= 4) low.push(t.ruinTier!);
        else high.push(t.ruinTier!);
      }
    }
    expect(low.length).toBeGreaterThan(0);
    expect(high.length).toBeGreaterThan(0);
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean(high)).toBeGreaterThan(mean(low));
  });
});

describe('generateWorld — richness', () => {
  it('assigns richness 1..3 to every tile', () => {
    for (const seed of SEEDS) {
      for (const t of WORLDS.get(seed)!) {
        expect([1, 2, 3]).toContain(t.richness);
      }
    }
  });

  it('weights land richness roughly 60/30/10 for every seed', () => {
    for (const seed of SEEDS) {
      const land = landTiles(WORLDS.get(seed)!);
      const frac = (k: number) => land.filter((t) => t.richness === k).length / land.length;
      expect(frac(1)).toBeGreaterThanOrEqual(0.5);
      expect(frac(1)).toBeLessThanOrEqual(0.7);
      expect(frac(2)).toBeGreaterThanOrEqual(0.22);
      expect(frac(2)).toBeLessThanOrEqual(0.42);
      expect(frac(3)).toBeGreaterThanOrEqual(0.05);
      expect(frac(3)).toBeLessThanOrEqual(0.16);
    }
  });

  it('biases richness 2–3 toward low elevation (rich land drowns first)', () => {
    for (const seed of SEEDS) {
      const land = landTiles(WORLDS.get(seed)!);
      const mean = (ts: Tile[]) => ts.reduce((s, t) => s + t.richness, 0) / ts.length;
      const lowland = land.filter((t) => t.elevation <= 3);
      const highland = land.filter((t) => t.elevation >= 6);
      expect(lowland.length).toBeGreaterThan(0);
      expect(highland.length).toBeGreaterThan(0);
      expect(mean(lowland)).toBeGreaterThan(mean(highland));
    }
  });

  it('richnessFor is structurally biased: fixed roll never gets richer uphill', () => {
    for (let roll = 0; roll < 1; roll += 0.01) {
      let prev = 3;
      for (let elevation = 1; elevation <= MAX_ELEVATION; elevation++) {
        const rich = richnessFor(elevation, roll);
        expect(rich).toBeGreaterThanOrEqual(1);
        expect(rich).toBeLessThanOrEqual(3);
        expect(rich).toBeLessThanOrEqual(prev);
        prev = rich;
      }
    }
  });
});

describe('generateWorld — edge cases', () => {
  it('handles radius 0: a single well-formed tile at the origin', () => {
    const tiles = generateWorld(7, 0);
    expect(tiles.length).toBe(1);
    const t = tiles[0];
    expect(t.q).toBe(0);
    expect(t.r).toBe(0);
    expect(t.elevation).toBeGreaterThanOrEqual(0);
    expect(t.elevation).toBeLessThanOrEqual(MAX_ELEVATION);
    expect([1, 2, 3]).toContain(t.richness);
    expect(t.building).toBeUndefined();
    expect(t.ownerId).toBeUndefined();
  });

  it('handles negative radius gracefully (empty world)', () => {
    expect(generateWorld(7, -3)).toEqual([]);
  });

  it('floors fractional radii deterministically', () => {
    expect(generateWorld(7, 5.9)).toEqual(generateWorld(7, 5));
  });

  it('produces well-formed tiles at small radii', () => {
    const tiles = generateWorld(123, 3);
    expect(tiles.length).toBe(3 * 3 * 4 + 1);
    for (const t of tiles) {
      expect(Number.isInteger(t.elevation)).toBe(true);
      expect(t.elevation).toBeGreaterThanOrEqual(0);
      expect(t.elevation).toBeLessThanOrEqual(MAX_ELEVATION);
      expect(t.flooded).toBe(t.elevation === 0);
      expect([1, 2, 3]).toContain(t.richness);
    }
  });
});
