/**
 * Exploration — expeditions into ruins and the drowned world.
 * Deterministic given a seed. Every expedition should read like a story beat.
 */
import type { ExpeditionOutcome, PlayerState, Tile } from './types.js';

/**
 * Travel time in ticks: EXPEDITION_BASE_TICKS + distance × EXPEDITION_TICKS_PER_HEX,
 * ×0.7 (rounded up) if the owner has 'star_charts'.
 */
export function expeditionDuration(distance: number, owner: PlayerState): number {
  throw new Error('unimplemented');
}

/**
 * Resolve an expedition against `tile` (terrain 'ruins' or 'drowned').
 * - Relic yield: EXPEDITION_RELICS_BY_TIER[tier-1] uniform range (seeded),
 *   +1 if owner has 'drowned_tongue'.
 * - Bonus resources: modest seeded timber/ore/food salvage scaled by tier.
 * - Tech: with EXPEDITION_TECH_CHANCE[tier-1], grant a random tech the owner
 *   lacks (from TECHS); no duplicate techs. If all known, more relics instead.
 * - scoreGained: SCORE_EXPEDITION.
 * - story: 1–2 evocative sentences; vary by terrain (sunken vs surface ruins),
 *   tier and what was found. Seeded pick from templates — same seed, same story.
 * The tile's ruinTier degrades by 1 after a successful expedition (caller
 * mutates); tier is passed here explicitly.
 */
export function resolveExpedition(
  tile: Tile,
  tier: number,
  owner: PlayerState,
  seed: number,
): ExpeditionOutcome {
  throw new Error('unimplemented');
}
