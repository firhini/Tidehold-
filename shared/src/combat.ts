/**
 * Combat resolution — deterministic given a seed. The best strategist wins:
 * composition counters, terrain, watchtowers, commanders, and preparation
 * decide battles; there is no click-speed component.
 *
 * Model:
 * - Each side's base power = Σ units × (attack | defense per role).
 *   Attacker uses attack values; defender uses defense values.
 * - Counter triangle (blades > bows > shields > blades): for each pair of
 *   opposing unit classes, the favored class contributes COUNTER_BONUS × its
 *   power against the countered class, weighted by the enemy's composition
 *   share. (Implementation: effective power per unit class is scaled by
 *   1 + (COUNTER_BONUS - 1) × enemyShareOfCounteredClass.)
 * - Defender power × (1 + TERRAIN_DEFENSE_MOD[terrain] ?? 0)
 *   × (1 + WATCHTOWER_DEFENSE_BONUS × towerLevel) (tile or adjacent tower,
 *   caller passes the strongest applicable level)
 *   + garrison (neutral remnants add flat defense power).
 * - Commanders: aggression adds COMMANDER_ATTACK_BONUS×level to attacker mult,
 *   bulwark adds COMMANDER_DEFENSE_BONUS×level to defender mult (logistics has
 *   no battle effect).
 * - Seeded variance: each side's power × uniform(0.9, 1.1) from rng(seed).
 * - Winner = higher effective power. Loser loses all units? No — losses:
 *   loser loses 60–90% of units, winner loses proportional to power ratio
 *   (loserPower/winnerPower × 50%), distributed across unit classes by share
 *   (rounded, at least 1 from the largest class if any loss).
 * - Commander capture: if the losing side had an assigned commander, they are
 *   captured with COMMANDER_CAPTURE_CHANCE (seeded).
 * - Narrative: 1–3 sentence dramatic account naming terrain and the decisive
 *   factor (counters/terrain/towers/commander/numbers).
 */
import type {
  BattleReport,
  Commander,
  TerrainType,
  UnitCounts,
} from './types.js';

export interface CombatSide {
  playerId?: string;
  units: UnitCounts;
  commander?: Commander;
}

export interface CombatContext {
  battleId: string;
  tick: number;
  target: { q: number; r: number };
  attacker: CombatSide;
  defender: CombatSide;
  /** Neutral garrison strength defending the tile (ruins). */
  garrison?: number;
  terrain: TerrainType;
  /** Highest watchtower level covering the tile (0 = none). */
  watchtowerLevel: number;
  seed: number;
}

export function totalUnits(units: UnitCounts): number {
  return units.shields + units.blades + units.bows;
}

export function resolveBattle(ctx: CombatContext): BattleReport {
  throw new Error('unimplemented');
}
