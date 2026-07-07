import { describe, expect, it } from 'vitest';
import {
  PHASE_CONFLICT_TIDE,
  PHASE_ENDGAME_TIDE,
  SEASON_END_TIDE,
  MAX_ELEVATION,
  DEFAULT_TIDE_INTERVAL_TICKS,
} from '../src/constants.js';
import type { Tile } from '../src/types.js';
import {
  applyTide,
  floodLevelOf,
  phaseForTide,
  ticksUntilFlood,
} from '../src/tide.js';

/** Hand-rolled synthetic tile factory — no worldgen dependency. */
function makeTile(overrides: Partial<Tile> = {}): Tile {
  return {
    q: 0,
    r: 0,
    elevation: 3,
    terrain: 'plains',
    flooded: false,
    richness: 1,
    ...overrides,
  };
}

describe('applyTide', () => {
  it('floods exactly the unflooded tiles with elevation <= newTideLevel', () => {
    const tiles = [
      makeTile({ q: 0, r: 0, elevation: 1 }),
      makeTile({ q: 1, r: 0, elevation: 2 }),
      makeTile({ q: 2, r: 0, elevation: 3 }),
      makeTile({ q: 3, r: 0, elevation: 4 }),
    ];
    const report = applyTide(tiles, 2);

    expect(tiles[0].flooded).toBe(true);
    expect(tiles[1].flooded).toBe(true); // elevation == level floods (tide >= elevation)
    expect(tiles[2].flooded).toBe(false);
    expect(tiles[3].flooded).toBe(false);
    expect(report.newlyFlooded).toHaveLength(2);
    expect(report.newlyFlooded).toContain(tiles[0]);
    expect(report.newlyFlooded).toContain(tiles[1]);
  });

  it('handles an empty tile array', () => {
    const report = applyTide([], 5);
    expect(report.newlyFlooded).toEqual([]);
    expect(report.destroyed).toEqual([]);
    expect(report.territoryLost).toEqual([]);
  });

  it('skips already-flooded tiles (no double reporting)', () => {
    const tiles = [
      makeTile({ elevation: 0, terrain: 'ocean', flooded: true }),
      makeTile({ q: 1, elevation: 1, terrain: 'drowned', flooded: true, ruinTier: 2 }),
    ];
    const report = applyTide(tiles, 4);
    expect(report.newlyFlooded).toEqual([]);
    expect(tiles[1].terrain).toBe('drowned');
    expect(tiles[1].ruinTier).toBe(2);
  });

  describe('building destruction', () => {
    it('reports destroyed buildings with owner and type, and removes them', () => {
      const tile = makeTile({
        q: 4,
        r: -2,
        elevation: 2,
        terrain: 'forest',
        ownerId: 'alice',
        building: { type: 'lumber_camp', level: 1, ownerId: 'alice' },
      });
      const report = applyTide([tile], 2);

      expect(report.destroyed).toEqual([
        { q: 4, r: -2, ownerId: 'alice', buildingType: 'lumber_camp' },
      ]);
      expect(tile.building).toBeUndefined();
      expect(tile.ownerId).toBeUndefined();
      expect(tile.flooded).toBe(true);
    });

    it('does not also count built tiles as territoryLost', () => {
      const tile = makeTile({
        elevation: 1,
        ownerId: 'alice',
        building: { type: 'farm', level: 2, ownerId: 'alice' },
      });
      const report = applyTide([tile], 3);
      expect(report.destroyed).toHaveLength(1);
      expect(report.territoryLost).toEqual([]);
    });

    it('uses the building ownerId in the destroyed record', () => {
      // Defensive: building owner is authoritative for the destroyed report.
      const tile = makeTile({
        elevation: 1,
        ownerId: 'alice',
        building: { type: 'watchtower', level: 1, ownerId: 'bob' },
      });
      const report = applyTide([tile], 1);
      expect(report.destroyed[0].ownerId).toBe('bob');
    });
  });

  describe('territory loss', () => {
    it('reports owned-but-unbuilt tiles and clears ownership', () => {
      const tiles = [
        makeTile({ q: 1, r: 1, elevation: 1, ownerId: 'bob' }),
        makeTile({ q: 2, r: 2, elevation: 1 }), // unowned — not reported
      ];
      const report = applyTide(tiles, 1);
      expect(report.territoryLost).toEqual([{ q: 1, r: 1, ownerId: 'bob' }]);
      expect(tiles[0].ownerId).toBeUndefined();
      expect(tiles[1].ownerId).toBeUndefined();
    });
  });

  describe('drowned vs ocean terrain decision', () => {
    it('plain unowned land becomes ocean with no ruinTier', () => {
      const tile = makeTile({ elevation: 1, terrain: 'plains' });
      applyTide([tile], 1);
      expect(tile.terrain).toBe('ocean');
      expect(tile.ruinTier).toBeUndefined();
    });

    it('owned-but-unbuilt land also becomes ocean', () => {
      const tile = makeTile({ elevation: 1, terrain: 'coast', ownerId: 'alice' });
      applyTide([tile], 1);
      expect(tile.terrain).toBe('ocean');
    });

    it('a tile with a level-1 building becomes drowned with ruinTier 1', () => {
      const tile = makeTile({
        elevation: 1,
        terrain: 'plains',
        building: { type: 'farm', level: 1, ownerId: 'alice' },
      });
      applyTide([tile], 1);
      expect(tile.terrain).toBe('drowned');
      expect(tile.ruinTier).toBe(1);
    });

    it('a tile with a level-2 building becomes drowned with ruinTier 1', () => {
      const tile = makeTile({
        elevation: 1,
        terrain: 'hills',
        building: { type: 'mine', level: 2, ownerId: 'alice' },
      });
      applyTide([tile], 1);
      expect(tile.terrain).toBe('drowned');
      expect(tile.ruinTier).toBe(1);
    });

    it('a tile with a level-3 building becomes drowned with ruinTier 2', () => {
      const tile = makeTile({
        elevation: 1,
        terrain: 'coast',
        building: { type: 'port', level: 3, ownerId: 'alice' },
      });
      applyTide([tile], 1);
      expect(tile.terrain).toBe('drowned');
      expect(tile.ruinTier).toBe(2);
    });

    it('ruins keep their existing ruinTier when drowned', () => {
      const tile = makeTile({
        elevation: 1,
        terrain: 'ruins',
        ruinTier: 3,
        garrison: 40,
      });
      applyTide([tile], 1);
      expect(tile.terrain).toBe('drowned');
      expect(tile.ruinTier).toBe(3);
    });

    it('an existing ruinTier takes precedence over the building-derived tier', () => {
      const tile = makeTile({
        elevation: 1,
        terrain: 'plains',
        ruinTier: 3,
        building: { type: 'shrine', level: 3, ownerId: 'alice' },
      });
      applyTide([tile], 1);
      expect(tile.terrain).toBe('drowned');
      expect(tile.ruinTier).toBe(3);
    });

    it('ruins without an explicit tier still become drowned', () => {
      const tile = makeTile({ elevation: 1, terrain: 'ruins' });
      applyTide([tile], 1);
      expect(tile.terrain).toBe('drowned');
    });

    it('a tile with only a ruinTier (no building, not ruins terrain) becomes drowned', () => {
      const tile = makeTile({ elevation: 1, terrain: 'coast', ruinTier: 2 });
      applyTide([tile], 1);
      expect(tile.terrain).toBe('drowned');
      expect(tile.ruinTier).toBe(2);
    });
  });

  describe('monotonicity and idempotence', () => {
    it('is idempotent: a second call at the same level is a no-op', () => {
      const tiles = [
        makeTile({ elevation: 1, ownerId: 'alice' }),
        makeTile({ q: 1, elevation: 2, building: { type: 'farm', level: 1, ownerId: 'bob' } }),
        makeTile({ q: 2, elevation: 5 }),
      ];
      applyTide(tiles, 3);
      const snapshot = JSON.parse(JSON.stringify(tiles));

      const second = applyTide(tiles, 3);
      expect(second.newlyFlooded).toEqual([]);
      expect(second.destroyed).toEqual([]);
      expect(second.territoryLost).toEqual([]);
      expect(JSON.parse(JSON.stringify(tiles))).toEqual(snapshot);
    });

    it('never un-floods: a lower level after a higher one is a no-op', () => {
      const tiles = [
        makeTile({ elevation: 2 }),
        makeTile({ q: 1, elevation: 4 }),
      ];
      applyTide(tiles, 4);
      const snapshot = JSON.parse(JSON.stringify(tiles));

      const report = applyTide(tiles, 1);
      expect(report.newlyFlooded).toEqual([]);
      expect(report.destroyed).toEqual([]);
      expect(report.territoryLost).toEqual([]);
      expect(JSON.parse(JSON.stringify(tiles))).toEqual(snapshot);
      expect(tiles.every((t) => t.flooded)).toBe(true);
    });

    it('successive rises only report the newly claimed band', () => {
      const tiles = [
        makeTile({ q: 0, elevation: 1, ownerId: 'alice' }),
        makeTile({ q: 1, elevation: 2, ownerId: 'alice' }),
        makeTile({ q: 2, elevation: 3, ownerId: 'alice' }),
      ];
      const first = applyTide(tiles, 1);
      expect(first.territoryLost).toEqual([{ q: 0, r: 0, ownerId: 'alice' }]);

      const second = applyTide(tiles, 2);
      expect(second.territoryLost).toEqual([{ q: 1, r: 0, ownerId: 'alice' }]);
      expect(second.newlyFlooded).toHaveLength(1);
    });
  });

  it('is deterministic: identical inputs produce identical mutations and reports', () => {
    const build = () => [
      makeTile({ q: 0, r: 0, elevation: 1, ownerId: 'a' }),
      makeTile({
        q: 1,
        r: -1,
        elevation: 2,
        terrain: 'forest',
        building: { type: 'lumber_camp', level: 3, ownerId: 'b' },
      }),
      makeTile({ q: 2, r: 0, elevation: 3, terrain: 'ruins', ruinTier: 2, garrison: 25 }),
      makeTile({ q: 3, r: 1, elevation: 7 }),
    ];
    const tilesA = build();
    const tilesB = build();
    const reportA = applyTide(tilesA, 3);
    const reportB = applyTide(tilesB, 3);
    expect(reportA).toEqual(reportB);
    expect(tilesA).toEqual(tilesB);
  });
});

describe('floodLevelOf', () => {
  it('returns the tile elevation', () => {
    expect(floodLevelOf(makeTile({ elevation: 0 }))).toBe(0);
    expect(floodLevelOf(makeTile({ elevation: 5 }))).toBe(5);
    expect(floodLevelOf(makeTile({ elevation: MAX_ELEVATION }))).toBe(MAX_ELEVATION);
  });
});

describe('phaseForTide', () => {
  it('maps tide levels to phases via the PHASE_* constants', () => {
    expect(phaseForTide(0)).toBe('expansion');
    expect(phaseForTide(PHASE_CONFLICT_TIDE - 1)).toBe('expansion');
    expect(phaseForTide(PHASE_CONFLICT_TIDE)).toBe('conflict');
    expect(phaseForTide(PHASE_ENDGAME_TIDE - 1)).toBe('conflict');
    expect(phaseForTide(PHASE_ENDGAME_TIDE)).toBe('endgame');
    expect(phaseForTide(SEASON_END_TIDE - 1)).toBe('endgame');
    expect(phaseForTide(SEASON_END_TIDE)).toBe('ended');
    expect(phaseForTide(SEASON_END_TIDE + 3)).toBe('ended');
  });

  it('treats a pre-rise (negative or zero) tide as expansion', () => {
    expect(phaseForTide(-1)).toBe('expansion');
  });
});

describe('ticksUntilFlood', () => {
  const INTERVAL = DEFAULT_TIDE_INTERVAL_TICKS;

  it('returns 0 for an already-flooded tile', () => {
    const tile = makeTile({ elevation: 0, terrain: 'ocean', flooded: true });
    expect(ticksUntilFlood(tile, 0, 100, 50, INTERVAL)).toBe(0);
  });

  it('returns 0 when the tile is already at or below the waterline', () => {
    const tile = makeTile({ elevation: 2 });
    expect(ticksUntilFlood(tile, 2, 100, 50, INTERVAL)).toBe(0);
    expect(ticksUntilFlood(tile, 5, 100, 50, INTERVAL)).toBe(0);
  });

  it('one rise needed: floods at nextTideTick', () => {
    const tile = makeTile({ elevation: 3 });
    // tideLevel 2 → needs 1 rise; next rise is 60 ticks away.
    expect(ticksUntilFlood(tile, 2, 160, 100, INTERVAL)).toBe(60);
  });

  it('multiple rises: nextTideTick plus interval per extra rise', () => {
    const tile = makeTile({ elevation: 5 });
    // tideLevel 2 → needs 3 rises: 60 + 2 * interval.
    expect(ticksUntilFlood(tile, 2, 160, 100, INTERVAL)).toBe(60 + 2 * INTERVAL);
  });

  it('scales with the provided tide interval', () => {
    const tile = makeTile({ elevation: 4 });
    expect(ticksUntilFlood(tile, 1, 10, 0, 100)).toBe(10 + 2 * 100);
    expect(ticksUntilFlood(tile, 1, 10, 0, 7)).toBe(10 + 2 * 7);
  });

  it('returns Infinity for ground above SEASON_END_TIDE (outlives the season)', () => {
    const peak = makeTile({ elevation: MAX_ELEVATION, terrain: 'peak' });
    expect(ticksUntilFlood(peak, 0, 100, 0, INTERVAL)).toBe(Infinity);
    const high = makeTile({ elevation: SEASON_END_TIDE + 1 });
    expect(ticksUntilFlood(high, 3, 100, 0, INTERVAL)).toBe(Infinity);
  });

  it('ground at exactly SEASON_END_TIDE floods with the final rise (finite)', () => {
    const tile = makeTile({ elevation: SEASON_END_TIDE });
    const result = ticksUntilFlood(tile, 0, 50, 0, INTERVAL);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBe(50 + (SEASON_END_TIDE - 1) * INTERVAL);
  });

  it('clamps a stale nextTideTick (already passed) to zero for the first rise', () => {
    const tile = makeTile({ elevation: 3 });
    // currentTick is past nextTideTick — the rise is due now.
    expect(ticksUntilFlood(tile, 2, 90, 100, INTERVAL)).toBe(0);
    const tile2 = makeTile({ elevation: 4 });
    expect(ticksUntilFlood(tile2, 2, 90, 100, INTERVAL)).toBe(INTERVAL);
  });

  it('is deterministic for identical inputs', () => {
    const tile = makeTile({ elevation: 6 });
    const a = ticksUntilFlood(tile, 1, 200, 40, INTERVAL);
    const b = ticksUntilFlood(makeTile({ elevation: 6 }), 1, 200, 40, INTERVAL);
    expect(a).toBe(b);
  });
});
