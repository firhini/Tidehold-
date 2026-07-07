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
 */
import type { Tile } from './types.js';

/** Garrison strength per ruin tier. */
export const GARRISON_BY_TIER = [25, 60, 120] as const;

export function generateWorld(seed: number, radius: number): Tile[] {
  throw new Error('unimplemented');
}
