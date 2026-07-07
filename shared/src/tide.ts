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
import type { SeasonPhase, Tile } from './types.js';

export interface TideReport {
  newlyFlooded: Tile[];
  /** Buildings destroyed: tile plus the building it had (before removal). */
  destroyed: { q: number; r: number; ownerId: string; buildingType: string }[];
  /** Owned-but-unbuilt tiles that were lost. */
  territoryLost: { q: number; r: number; ownerId: string }[];
}

export function applyTide(tiles: Tile[], newTideLevel: number): TideReport {
  throw new Error('unimplemented');
}

/** Tide level at which a tile floods (its elevation). Ocean = already flooded. */
export function floodLevelOf(tile: Tile): number {
  throw new Error('unimplemented');
}

/** Season phase for a tide level (uses PHASE_* constants). */
export function phaseForTide(tideLevel: number): SeasonPhase {
  throw new Error('unimplemented');
}

/** Ticks until a tile floods, given tide state; Infinity if it outlives the season. */
export function ticksUntilFlood(
  tile: Tile,
  tideLevel: number,
  nextTideTick: number,
  currentTick: number,
  tideIntervalTicks: number,
): number {
  throw new Error('unimplemented');
}
