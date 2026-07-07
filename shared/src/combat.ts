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
 *
 * Canonical formula (clarified spec, implemented below):
 * - counterScale(class) = 1 + (COUNTER_BONUS - 1) × enemyCountOfCounteredClass
 *   / enemyTotalUnits; counterScale = 1 when the enemy fields zero units
 *   (e.g. a pure neutral garrison).
 * - attackerPower = Σ count × attack × counterScale
 *   × (1 + COMMANDER_ATTACK_BONUS × level, aggression commander only)
 *   × variance_att
 * - defenderPower = (Σ count × defense × counterScale
 *   × (1 + TERRAIN_DEFENSE_MOD[terrain] ?? 0)
 *   × (1 + WATCHTOWER_DEFENSE_BONUS × watchtowerLevel)
 *   × (1 + COMMANDER_DEFENSE_BONUS × level, bulwark commander only)
 *   + garrison)          ← garrison is FLAT power, added AFTER the multipliers
 *   × variance_def
 * - variance_att and variance_def are two independent uniforms in [0.9, 1.1]
 *   drawn in that exact order from rng(seed); the commander-capture roll is
 *   drawn third, ALWAYS, so the draw sequence is stable across contexts.
 * - Exactly equal powers → the defender wins (ties go to the defender).
 * - loserLossFraction = 0.6 + 0.3 × winnerPower / (winnerPower + loserPower);
 *   winnerLossFraction = 0.5 × loserPower / winnerPower. Each unit class loses
 *   roundHalfUp(count × fraction), capped at count. A side with zero units has
 *   zero losses.
 */
import type {
  BattleReport,
  BattleSideReport,
  Commander,
  TerrainType,
  UnitCounts,
  UnitType,
} from './types.js';
import {
  COMMANDER_ATTACK_BONUS,
  COMMANDER_CAPTURE_CHANCE,
  COMMANDER_DEFENSE_BONUS,
  COUNTER_BONUS,
  TERRAIN_DEFENSE_MOD,
  UNITS,
  UNIT_LIST,
  WATCHTOWER_DEFENSE_BONUS,
} from './constants.js';
import { rng } from './rng.js';

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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** The class each unit type counters: blades > bows > shields > blades. */
const COUNTER_TARGET: Record<UnitType, UnitType> = {
  blades: 'bows',
  bows: 'shields',
  shields: 'blades',
};

/**
 * Counter multiplier for one unit class against the enemy composition:
 * 1 + (COUNTER_BONUS - 1) × (enemy units of the countered class / enemy total).
 * Returns exactly 1 against an enemy with zero units (pure garrison).
 */
function counterScale(cls: UnitType, enemy: UnitCounts): number {
  const enemyTotal = totalUnits(enemy);
  if (enemyTotal <= 0) return 1;
  return 1 + (COUNTER_BONUS - 1) * (enemy[COUNTER_TARGET[cls]] / enemyTotal);
}

/** Σ count × stat × counterScale over all unit classes. */
function unitPower(units: UnitCounts, enemy: UnitCounts, role: 'attack' | 'defense'): number {
  let power = 0;
  for (const u of UNIT_LIST) {
    power += units[u] * UNITS[u][role] * counterScale(u, enemy);
  }
  return power;
}

/** Σ count × stat with no counter scaling (used to isolate the counter edge). */
function unitBasePower(units: UnitCounts, role: 'attack' | 'defense'): number {
  let power = 0;
  for (const u of UNIT_LIST) power += units[u] * UNITS[u][role];
  return power;
}

/** Round half up: 2.5 → 3 (Math.round semantics for non-negative values). */
function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5);
}

/** Round to one decimal place (report presentation). */
function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** Per-class losses: roundHalfUp(count × fraction), capped at count. */
function lossesAtFraction(units: UnitCounts, fraction: number): UnitCounts {
  const out: UnitCounts = { shields: 0, blades: 0, bows: 0 };
  for (const u of UNIT_LIST) {
    out[u] = Math.min(units[u], roundHalfUp(units[u] * fraction));
  }
  return out;
}

/** Most numerous unit class, ties broken by UNIT_LIST order; null if empty. */
function dominantClass(units: UnitCounts): UnitType | null {
  let best: UnitType | null = null;
  for (const u of UNIT_LIST) {
    if (units[u] > 0 && (best === null || units[u] > units[best])) best = u;
  }
  return best;
}

/** The unit class contributing the most counter-bonus power, or null. */
function bestCounterClass(
  units: UnitCounts,
  enemy: UnitCounts,
  role: 'attack' | 'defense',
): UnitType | null {
  let best: UnitType | null = null;
  let bestGain = 0;
  for (const u of UNIT_LIST) {
    const gain = units[u] * UNITS[u][role] * (counterScale(u, enemy) - 1);
    if (gain > bestGain) {
      bestGain = gain;
      best = u;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Narrative
// ---------------------------------------------------------------------------

type DecisiveFactor = 'counters' | 'terrain' | 'tower' | 'commander' | 'garrison' | 'numbers';

interface NarrativeArgs {
  ctx: CombatContext;
  winner: 'attacker' | 'defender';
  garrison: number;
  attackerCounterEdge: number;
  defenderCounterEdge: number;
  terrainMult: number;
  towerMult: number;
  bulwarkMult: number;
  attackerMult: number;
  capturedCommander?: Commander;
}

function describeAttackers(units: UnitCounts): string {
  const total = totalUnits(units);
  const dom = dominantClass(units);
  if (total === 0 || dom === null) return 'an empty banner';
  return `a host of ${total} led by ${UNITS[dom].name}`;
}

function describeDefenders(units: UnitCounts, garrison: number): string {
  const total = totalUnits(units);
  const dom = dominantClass(units);
  if (total > 0 && dom !== null) return `${total} defenders anchored by ${UNITS[dom].name}`;
  if (garrison > 0) return 'the remnant garrison of the old world';
  return 'open, undefended ground';
}

function pickDecisiveFactor(a: NarrativeArgs): DecisiveFactor {
  const EPS = 1e-9;
  if (a.winner === 'attacker') {
    const candidates: [DecisiveFactor, number][] = [
      ['counters', Math.max(0, a.attackerCounterEdge - a.defenderCounterEdge)],
      ['commander', a.attackerMult - 1],
    ];
    let best: [DecisiveFactor, number] = ['numbers', EPS];
    for (const c of candidates) if (c[1] > best[1]) best = c;
    return best[0];
  }
  // Defender won. A pure-garrison stand is its own story.
  if (totalUnits(a.ctx.defender.units) === 0 && a.garrison > 0) return 'garrison';
  const candidates: [DecisiveFactor, number][] = [
    ['counters', Math.max(0, a.defenderCounterEdge - a.attackerCounterEdge)],
    ['terrain', a.terrainMult - 1],
    ['tower', a.towerMult - 1],
    ['commander', a.bulwarkMult - 1],
  ];
  let best: [DecisiveFactor, number] = ['numbers', EPS];
  for (const c of candidates) if (c[1] > best[1]) best = c;
  return best[0];
}

/**
 * 1–3 sentence account: the scene (terrain + forces), the decisive factor,
 * and — if it happened — the commander capture. Pure function of its inputs;
 * no RNG draws, so it never perturbs the seeded draw sequence.
 */
function buildNarrative(a: NarrativeArgs): string {
  const { ctx, winner, garrison } = a;
  const sentences: string[] = [];
  sentences.push(
    `On the ${ctx.terrain} at (${ctx.target.q}, ${ctx.target.r}), ` +
      `${describeAttackers(ctx.attacker.units)} assaulted ` +
      `${describeDefenders(ctx.defender.units, garrison)}.`,
  );

  const factor = pickDecisiveFactor(a);
  switch (factor) {
    case 'counters': {
      if (winner === 'attacker') {
        const c = bestCounterClass(ctx.attacker.units, ctx.defender.units, 'attack');
        if (c !== null) {
          sentences.push(
            `The ${UNITS[c].name} broke the enemy ${UNITS[COUNTER_TARGET[c]].name}, and the line collapsed.`,
          );
          break;
        }
      } else {
        const c = bestCounterClass(ctx.defender.units, ctx.attacker.units, 'defense');
        if (c !== null) {
          sentences.push(
            `The defending ${UNITS[c].name} turned the ${UNITS[COUNTER_TARGET[c]].name} aside and held.`,
          );
          break;
        }
      }
      sentences.push(`Raw strength carried the field for the ${winner}s.`);
      break;
    }
    case 'terrain':
      sentences.push(`The ${ctx.terrain} gave the defenders ground the attackers could not take.`);
      break;
    case 'tower':
      sentences.push(`Watchtower fire raked the assault until it broke.`);
      break;
    case 'commander':
      if (winner === 'attacker' && ctx.attacker.commander) {
        sentences.push(`Commander ${ctx.attacker.commander.name} pressed the assault home without mercy.`);
      } else if (ctx.defender.commander) {
        sentences.push(`Commander ${ctx.defender.commander.name} stood as a bulwark, and the line did not bend.`);
      } else {
        sentences.push(`Raw strength carried the field for the ${winner}s.`);
      }
      break;
    case 'garrison':
      sentences.push(`The remnant garrison rose from the stones and threw the attackers back.`);
      break;
    case 'numbers':
      sentences.push(
        winner === 'attacker'
          ? `Sheer weight of arms carried the field for the attackers.`
          : `The defense outmatched the assault, and the attackers withdrew in disorder.`,
      );
      break;
  }

  if (a.capturedCommander) {
    sentences.push(`In the rout, Commander ${a.capturedCommander.name} fell into enemy hands.`);
  }
  return sentences.join(' ');
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export function resolveBattle(ctx: CombatContext): BattleReport {
  const { attacker, defender } = ctx;
  const garrison = Math.max(0, ctx.garrison ?? 0);
  const towerLevel = Math.max(0, ctx.watchtowerLevel);

  // Seeded draws in a FIXED order so the sequence is stable no matter which
  // optional features (commanders, garrison, towers) are present:
  //   1. attacker variance   2. defender variance   3. commander-capture roll
  const draws = rng(ctx.seed);
  const attackerVariance = 0.9 + 0.2 * draws.next();
  const defenderVariance = 0.9 + 0.2 * draws.next();
  const captureRoll = draws.next();

  const aggressionLevel = attacker.commander?.trait === 'aggression' ? attacker.commander.level : 0;
  const bulwarkLevel = defender.commander?.trait === 'bulwark' ? defender.commander.level : 0;

  const attackerMult = 1 + COMMANDER_ATTACK_BONUS * aggressionLevel;
  const terrainMult = 1 + (TERRAIN_DEFENSE_MOD[ctx.terrain] ?? 0);
  const towerMult = 1 + WATCHTOWER_DEFENSE_BONUS * towerLevel;
  const bulwarkMult = 1 + COMMANDER_DEFENSE_BONUS * bulwarkLevel;

  const attackerUnitPower = unitPower(attacker.units, defender.units, 'attack');
  const defenderUnitPower = unitPower(defender.units, attacker.units, 'defense');

  const attackerPower = attackerUnitPower * attackerMult * attackerVariance;
  // Garrison is flat power added after the defensive multipliers; the side's
  // variance then applies to the total.
  const defenderPower =
    (defenderUnitPower * terrainMult * towerMult * bulwarkMult + garrison) * defenderVariance;

  // Exactly equal powers go to the defender.
  const winner: 'attacker' | 'defender' = attackerPower > defenderPower ? 'attacker' : 'defender';
  const winnerPower = winner === 'attacker' ? attackerPower : defenderPower;
  const loserPower = winner === 'attacker' ? defenderPower : attackerPower;

  const powerSum = winnerPower + loserPower;
  const loserFraction = powerSum > 0 ? 0.6 + 0.3 * (winnerPower / powerSum) : 0;
  const winnerFraction = winnerPower > 0 ? 0.5 * (loserPower / winnerPower) : 0;

  const attackerLosses = lossesAtFraction(
    attacker.units,
    winner === 'attacker' ? winnerFraction : loserFraction,
  );
  const defenderLosses = lossesAtFraction(
    defender.units,
    winner === 'defender' ? winnerFraction : loserFraction,
  );

  const loserSide = winner === 'attacker' ? defender : attacker;
  const capturedCommander =
    loserSide.commander && captureRoll < COMMANDER_CAPTURE_CHANCE
      ? loserSide.commander
      : undefined;

  const attackerReport: BattleSideReport = {
    playerId: attacker.playerId,
    before: { ...attacker.units },
    losses: attackerLosses,
    effectiveStrength: round1(attackerPower),
  };
  const defenderReport: BattleSideReport = {
    playerId: defender.playerId,
    before: { ...defender.units },
    losses: defenderLosses,
    effectiveStrength: round1(defenderPower),
  };

  const attackerBase = unitBasePower(attacker.units, 'attack');
  const defenderBase = unitBasePower(defender.units, 'defense');

  const report: BattleReport = {
    battleId: ctx.battleId,
    tick: ctx.tick,
    target: { q: ctx.target.q, r: ctx.target.r },
    winner,
    attacker: attackerReport,
    defender: defenderReport,
    // Loot is intentionally left empty here: the SERVER computes loot from the
    // loser's remaining stockpile (BATTLE_LOOT_FRACTION) when it applies the
    // report — shared combat code has no visibility into player resources.
    loot: {},
    narrative: buildNarrative({
      ctx,
      winner,
      garrison,
      attackerCounterEdge: attackerBase > 0 ? attackerUnitPower / attackerBase - 1 : 0,
      defenderCounterEdge: defenderBase > 0 ? defenderUnitPower / defenderBase - 1 : 0,
      terrainMult,
      towerMult,
      bulwarkMult,
      attackerMult,
      capturedCommander,
    }),
  };
  if (garrison > 0) report.garrisonBefore = garrison;
  if (capturedCommander) report.capturedCommanderId = capturedCommander.id;
  return report;
}
