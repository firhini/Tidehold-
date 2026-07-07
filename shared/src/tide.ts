/**
 * The Tide — the world's true antagonist.
 *
 * applyTide mutates the given tiles for a rise to `newTideLevel` and reports
 * what was lost. Rules:
 * - A tile floods when tile.elevation <= newTideLevel and !tile.flooded.
 * - Flooding sets flooded=true. Terrain becomes:
 *     'drowned' if the tile had a building, was 'ruins', or ruinTier is set
 *       (drowned tiles keep/gain ruinTier: existing tier, or 1 for a lost
 *       building of level 1-2, or 2 for level 3) — they become explorable;
 *     'ocean' otherwise.
 * - A flooding tile loses its building and owner (recorded in the report).
 * - Never un-floods anything; calling with a lower level is a no-op.
 */
import {
  PHASE_CONFLICT_TIDE,
  PHASE_ENDGAME_TIDE,
  SEASON_END_TIDE,
} from './constants.js';
import type { SeasonPhase, Tile } from './types.js';

export interface TideReport {
  newlyFlooded: Tile[];
  /** Buildings destroyed: tile plus the building it had (before removal). */
  destroyed: { q: number; r: number; ownerId: string; buildingType: string }[];
  /** Owned-but-unbuilt tiles that were lost. */
  territoryLost: { q: number; r: number; ownerId: string }[];
}

export function applyTide(tiles: Tile[], newTideLevel: number): TideReport {
  const report: TideReport = {
    newlyFlooded: [],
    destroyed: [],
    territoryLost: [],
  };

  for (const tile of tiles) {
    if (tile.flooded || tile.elevation > newTideLevel) continue;

    const building = tile.building;
    const wasRuins = tile.terrain === 'ruins';

    // Record what the water takes.
    if (building) {
      report.destroyed.push({
        q: tile.q,
        r: tile.r,
        ownerId: building.ownerId,
        buildingType: building.type,
      });
    } else if (tile.ownerId !== undefined) {
      report.territoryLost.push({ q: tile.q, r: tile.r, ownerId: tile.ownerId });
    }

    // Decide what remains beneath the surface.
    if (building || wasRuins || tile.ruinTier !== undefined) {
      tile.terrain = 'drowned';
      const gainedTier =
        tile.ruinTier ?? (building ? ruinTierForBuildingLevel(building.level) : undefined);
      if (gainedTier !== undefined) tile.ruinTier = gainedTier;
    } else {
      tile.terrain = 'ocean';
    }

    tile.flooded = true;
    delete tile.building;
    delete tile.ownerId;

    report.newlyFlooded.push(tile);
  }

  return report;
}

/** Ruin tier left behind by a drowned building: level 1-2 → tier 1, level 3 → tier 2. */
function ruinTierForBuildingLevel(level: number): number {
  return level >= 3 ? 2 : 1;
}

/** Tide level at which a tile floods (its elevation). Ocean = already flooded. */
export function floodLevelOf(tile: Tile): number {
  return tile.elevation;
}

/** Season phase for a tide level (uses PHASE_* constants). */
export function phaseForTide(tideLevel: number): SeasonPhase {
  if (tideLevel < PHASE_CONFLICT_TIDE) return 'expansion';
  if (tideLevel < PHASE_ENDGAME_TIDE) return 'conflict';
  if (tideLevel < SEASON_END_TIDE) return 'endgame';
  return 'ended';
}

/** Ticks until a tile floods, given tide state; Infinity if it outlives the season. */
export function ticksUntilFlood(
  tile: Tile,
  tideLevel: number,
  nextTideTick: number,
  currentTick: number,
  tideIntervalTicks: number,
): number {
  if (tile.flooded) return 0;

  const floodLevel = floodLevelOf(tile);
  const risesNeeded = floodLevel - tideLevel;
  // Already at or below the waterline (about to be applied / degenerate state).
  if (risesNeeded <= 0) return 0;
  // The season ends when the tide reaches SEASON_END_TIDE; higher ground outlives it.
  if (floodLevel > SEASON_END_TIDE) return Infinity;

  // First rise lands at nextTideTick, each subsequent one tideIntervalTicks later.
  const untilFirstRise = Math.max(0, nextTideTick - currentTick);
  return untilFirstRise + (risesNeeded - 1) * tideIntervalTicks;
}
