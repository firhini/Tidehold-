import { describe, expect, it } from 'vitest';
import {
  COMMANDER_ATTACK_BONUS,
  COMMANDER_CAPTURE_CHANCE,
  COMMANDER_DEFENSE_BONUS,
  COUNTER_BONUS,
  TERRAIN_DEFENSE_MOD,
  UNITS,
  UNIT_LIST,
  WATCHTOWER_DEFENSE_BONUS,
} from '../src/constants.js';
import { rng } from '../src/rng.js';
import type { Commander, UnitCounts } from '../src/types.js';
import { resolveBattle, totalUnits, type CombatContext, type CombatSide } from '../src/combat.js';

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

function units(partial: Partial<UnitCounts> = {}): UnitCounts {
  return { shields: 0, blades: 0, bows: 0, ...partial };
}

function side(u: Partial<UnitCounts> = {}, extra: Partial<CombatSide> = {}): CombatSide {
  return { playerId: 'P', units: units(u), ...extra };
}

function makeCtx(overrides: Partial<CombatContext> = {}): CombatContext {
  return {
    battleId: 'battle-1',
    tick: 42,
    target: { q: 3, r: -2 },
    attacker: side({}, { playerId: 'att' }),
    defender: side({}, { playerId: 'def' }),
    terrain: 'plains',
    watchtowerLevel: 0,
    seed: 1234,
    ...overrides,
  };
}

function commander(overrides: Partial<Commander> = {}): Commander {
  return {
    id: 'cmd-1',
    name: 'Maro',
    trait: 'aggression',
    level: 3,
    status: 'assigned',
    ...overrides,
  };
}

/**
 * Replicate the module's seeded draw sequence:
 * attacker variance, defender variance, capture roll — in that order.
 */
function drawsFor(seed: number): { varA: number; varD: number; captureRoll: number } {
  const r = rng(seed);
  const varA = 0.9 + 0.2 * r.next();
  const varD = 0.9 + 0.2 * r.next();
  const captureRoll = r.next();
  return { varA, varD, captureRoll };
}

function findSeed(pred: (d: ReturnType<typeof drawsFor>) => boolean): number {
  for (let seed = 1; seed <= 50_000; seed++) {
    if (pred(drawsFor(seed))) return seed;
  }
  throw new Error('no seed found matching predicate');
}

function roundHalfUp(x: number): number {
  return Math.floor(x + 0.5);
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

// Plains carries no terrain modifier — sanity-pin that assumption.
const PLAINS_MOD = TERRAIN_DEFENSE_MOD.plains ?? 0;

// ---------------------------------------------------------------------------
// totalUnits
// ---------------------------------------------------------------------------

describe('totalUnits', () => {
  it('sums all classes', () => {
    expect(totalUnits(units({ shields: 3, blades: 4, bows: 5 }))).toBe(12);
  });

  it('is zero for an empty army', () => {
    expect(totalUnits(units())).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('resolveBattle — determinism', () => {
  it('same context + seed produces an identical report', () => {
    const build = () =>
      makeCtx({
        attacker: side({ shields: 10, blades: 25, bows: 12 }, { playerId: 'att', commander: commander() }),
        defender: side(
          { shields: 20, blades: 5, bows: 15 },
          { playerId: 'def', commander: commander({ id: 'cmd-2', name: 'Sella', trait: 'bulwark', level: 2 }) },
        ),
        terrain: 'hills',
        watchtowerLevel: 2,
        garrison: 25,
        seed: 777,
      });
    const a = resolveBattle(build());
    const b = resolveBattle(build());
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('different seeds produce different effective strengths', () => {
    const base = { attacker: side({ blades: 50 }, { playerId: 'att' }), defender: side({ bows: 50 }, { playerId: 'def' }) };
    const a = resolveBattle(makeCtx({ ...base, seed: 1 }));
    const b = resolveBattle(makeCtx({ ...base, seed: 2 }));
    expect(a.attacker.effectiveStrength).not.toBe(b.attacker.effectiveStrength);
  });

  it('does not mutate the input context', () => {
    const attackerUnits = units({ blades: 30 });
    const defenderUnits = units({ bows: 30 });
    const ctx = makeCtx({
      attacker: { playerId: 'att', units: attackerUnits },
      defender: { playerId: 'def', units: defenderUnits },
    });
    const report = resolveBattle(ctx);
    expect(attackerUnits).toEqual(units({ blades: 30 }));
    expect(defenderUnits).toEqual(units({ bows: 30 }));
    // `before` is a copy, not the live army object.
    expect(report.attacker.before).not.toBe(attackerUnits);
    expect(report.defender.before).not.toBe(defenderUnits);
  });
});

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

describe('resolveBattle — report shape', () => {
  it('copies identifiers, tick, target, and before-counts; loot is left empty for the server', () => {
    const ctx = makeCtx({
      attacker: side({ blades: 10 }, { playerId: 'att' }),
      defender: side({ shields: 4 }, { playerId: 'def' }),
    });
    const report = resolveBattle(ctx);
    expect(report.battleId).toBe('battle-1');
    expect(report.tick).toBe(42);
    expect(report.target).toEqual({ q: 3, r: -2 });
    expect(report.target).not.toBe(ctx.target);
    expect(report.attacker.playerId).toBe('att');
    expect(report.defender.playerId).toBe('def');
    expect(report.attacker.before).toEqual(units({ blades: 10 }));
    expect(report.defender.before).toEqual(units({ shields: 4 }));
    expect(report.loot).toEqual({});
    expect(typeof report.narrative).toBe('string');
    expect(report.narrative.length).toBeGreaterThan(0);
  });

  it('reports garrisonBefore only when a garrison is present', () => {
    const withGarrison = resolveBattle(
      makeCtx({ attacker: side({ blades: 5 }), defender: side(), garrison: 60, terrain: 'ruins' }),
    );
    expect(withGarrison.garrisonBefore).toBe(60);

    const without = resolveBattle(makeCtx({ attacker: side({ blades: 5 }), defender: side({ shields: 5 }) }));
    expect(without.garrisonBefore).toBeUndefined();
  });

  it('effectiveStrength is rounded to one decimal', () => {
    const report = resolveBattle(
      makeCtx({ attacker: side({ blades: 33 }), defender: side({ bows: 17 }), seed: 99 }),
    );
    for (const s of [report.attacker.effectiveStrength, report.defender.effectiveStrength]) {
      expect(round1(s)).toBe(s);
    }
  });
});

// ---------------------------------------------------------------------------
// Power math: roles, counters, multipliers
// ---------------------------------------------------------------------------

describe('resolveBattle — power computation', () => {
  it('attacker uses attack stats, defender uses defense stats (counterScale=1 vs empty enemy)', () => {
    const seed = 31;
    const { varA, varD } = drawsFor(seed);
    // Shields: attack 2, defense 6. Empty opposing army → counterScale 1.
    const asAttacker = resolveBattle(
      makeCtx({ attacker: side({ shields: 10 }), defender: side(), seed }),
    );
    expect(asAttacker.attacker.effectiveStrength).toBe(round1(10 * UNITS.shields.attack * varA));
    const asDefender = resolveBattle(
      makeCtx({ attacker: side(), defender: side({ shields: 10 }), seed }),
    );
    expect(asDefender.defender.effectiveStrength).toBe(round1(10 * UNITS.shields.defense * varD));
  });

  it('applies the full counter scale against a pure countered enemy (blades vs bows)', () => {
    const seed = 7;
    const { varA, varD } = drawsFor(seed);
    const report = resolveBattle(
      makeCtx({ attacker: side({ blades: 100 }), defender: side({ bows: 100 }), seed }),
    );
    // Attacker: 100 × attack(6) × COUNTER_BONUS (enemy is 100% bows).
    expect(report.attacker.effectiveStrength).toBe(
      round1(100 * UNITS.blades.attack * COUNTER_BONUS * varA),
    );
    // Defender bows counter shields; attacker has none → scale 1.
    expect(report.defender.effectiveStrength).toBe(round1(100 * UNITS.bows.defense * (1 + PLAINS_MOD) * varD));
  });

  it('weights the counter scale by the enemy composition share', () => {
    const seed = 11;
    const { varA } = drawsFor(seed);
    const report = resolveBattle(
      makeCtx({ attacker: side({ blades: 100 }), defender: side({ bows: 50, shields: 50 }), seed }),
    );
    const scale = 1 + (COUNTER_BONUS - 1) * (50 / 100);
    expect(report.attacker.effectiveStrength).toBe(round1(100 * UNITS.blades.attack * scale * varA));
  });

  it('gives no counter bonus against an uncountered composition', () => {
    const seed = 13;
    const { varA } = drawsFor(seed);
    // Blades counter bows; defender fields only shields → scale 1.
    const report = resolveBattle(
      makeCtx({ attacker: side({ blades: 100 }), defender: side({ shields: 100 }), seed }),
    );
    expect(report.attacker.effectiveStrength).toBe(round1(100 * UNITS.blades.attack * varA));
  });

  it('applies terrain, watchtower, and bulwark multipliers to the defender', () => {
    const seed = 17;
    const { varD } = drawsFor(seed);
    const report = resolveBattle(
      makeCtx({
        attacker: side({ bows: 10 }),
        defender: side({ blades: 40 }, { commander: commander({ trait: 'bulwark', level: 4, name: 'Sella' }) }),
        terrain: 'hills',
        watchtowerLevel: 2,
        seed,
      }),
    );
    // Defender blades counter bows: attacker is 100% bows → full COUNTER_BONUS.
    const unitDef = 40 * UNITS.blades.defense * COUNTER_BONUS;
    const expected =
      unitDef *
      (1 + TERRAIN_DEFENSE_MOD.hills!) *
      (1 + WATCHTOWER_DEFENSE_BONUS * 2) *
      (1 + COMMANDER_DEFENSE_BONUS * 4) *
      varD;
    expect(report.defender.effectiveStrength).toBe(round1(expected));
  });

  it('treats terrain without a defense modifier as neutral', () => {
    const seed = 19;
    const { varD } = drawsFor(seed);
    const report = resolveBattle(
      makeCtx({ attacker: side(), defender: side({ blades: 100 }), terrain: 'coast', seed }),
    );
    expect(TERRAIN_DEFENSE_MOD.coast).toBeUndefined();
    expect(report.defender.effectiveStrength).toBe(round1(100 * UNITS.blades.defense * varD));
  });

  it('adds garrison as flat power after the defensive multipliers, inside variance', () => {
    const seed = 23;
    const { varD } = drawsFor(seed);
    const report = resolveBattle(
      makeCtx({
        attacker: side({ blades: 100 }),
        defender: side({ shields: 10 }),
        terrain: 'peak',
        garrison: 50,
        seed,
      }),
    );
    // Shields counter blades: attacker 100% blades → full COUNTER_BONUS.
    const unitDef = 10 * UNITS.shields.defense * COUNTER_BONUS;
    // Garrison is NOT multiplied by the peak terrain bonus.
    const expected = (unitDef * (1 + TERRAIN_DEFENSE_MOD.peak!) + 50) * varD;
    expect(report.defender.effectiveStrength).toBe(round1(expected));
  });

  it('applies the aggression commander bonus to the attacker only', () => {
    const seed = 29;
    const { varA } = drawsFor(seed);
    const report = resolveBattle(
      makeCtx({
        attacker: side({ blades: 100 }, { commander: commander({ trait: 'aggression', level: 3 }) }),
        defender: side({ bows: 100 }),
        seed,
      }),
    );
    expect(report.attacker.effectiveStrength).toBe(
      round1(100 * UNITS.blades.attack * COUNTER_BONUS * (1 + COMMANDER_ATTACK_BONUS * 3) * varA),
    );
  });

  it('ignores commanders whose trait does not apply to their side', () => {
    const seed = 37;
    const bare = resolveBattle(
      makeCtx({ attacker: side({ blades: 50 }), defender: side({ shields: 50 }), seed }),
    );
    // Bulwark on the attacker: no effect. Aggression on the defender: no effect.
    // Logistics anywhere: no effect.
    const decorated = resolveBattle(
      makeCtx({
        attacker: side({ blades: 50 }, { commander: commander({ trait: 'bulwark', level: 5 }) }),
        defender: side({ shields: 50 }, { commander: commander({ id: 'cmd-9', trait: 'aggression', level: 5 }) }),
        seed,
      }),
    );
    const logistics = resolveBattle(
      makeCtx({
        attacker: side({ blades: 50 }, { commander: commander({ trait: 'logistics', level: 5 }) }),
        defender: side({ shields: 50 }, { commander: commander({ id: 'cmd-9', trait: 'logistics', level: 5 }) }),
        seed,
      }),
    );
    expect(decorated.attacker.effectiveStrength).toBe(bare.attacker.effectiveStrength);
    expect(decorated.defender.effectiveStrength).toBe(bare.defender.effectiveStrength);
    expect(logistics.attacker.effectiveStrength).toBe(bare.attacker.effectiveStrength);
    expect(logistics.defender.effectiveStrength).toBe(bare.defender.effectiveStrength);
  });

  it('keeps variance within [0.9, 1.1] of deterministic power across many seeds', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const report = resolveBattle(
        makeCtx({ attacker: side({ blades: 100 }), defender: side({ shields: 100 }), seed }),
      );
      const attBase = 100 * UNITS.blades.attack;
      expect(report.attacker.effectiveStrength).toBeGreaterThanOrEqual(round1(attBase * 0.9));
      expect(report.attacker.effectiveStrength).toBeLessThanOrEqual(round1(attBase * 1.1));
    }
  });
});

// ---------------------------------------------------------------------------
// Outcomes: counters, terrain flips, garrison, ties
// ---------------------------------------------------------------------------

describe('resolveBattle — outcomes', () => {
  it('counter triangle: blades beat an equal-cost bow army on every seed', () => {
    // 100 blades and 100 bows cost the same total resources (24 each).
    for (let seed = 1; seed <= 30; seed++) {
      const report = resolveBattle(
        makeCtx({ attacker: side({ blades: 100 }), defender: side({ bows: 100 }), seed }),
      );
      expect(report.winner).toBe('attacker');
    }
  });

  it('counter triangle: shields repel an equal-count blade assault on every seed', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const report = resolveBattle(
        makeCtx({ attacker: side({ blades: 100 }), defender: side({ shields: 100 }), seed }),
      );
      expect(report.winner).toBe('defender');
    }
  });

  it('terrain and watchtower flip a battle the attacker would otherwise win', () => {
    // Attacker 50 blades (300 attack) vs defender 100 blades (200 defense):
    // guaranteed attacker win on bare plains (min 270 > max 220), guaranteed
    // defender win on a towered peak (min 391.5 > max 330) for ANY variance.
    for (let seed = 1; seed <= 30; seed++) {
      const open = resolveBattle(
        makeCtx({ attacker: side({ blades: 50 }), defender: side({ blades: 100 }), terrain: 'plains', seed }),
      );
      expect(open.winner).toBe('attacker');
      const fortified = resolveBattle(
        makeCtx({
          attacker: side({ blades: 50 }),
          defender: side({ blades: 100 }),
          terrain: 'peak',
          watchtowerLevel: 3,
          seed,
        }),
      );
      expect(fortified.winner).toBe('defender');
    }
  });

  it('a garrison-only defense can win, and the garrison side suffers no unit losses', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const report = resolveBattle(
        makeCtx({
          attacker: side({ blades: 5 }),
          defender: { units: units() }, // neutral: no playerId, no units
          garrison: 100,
          terrain: 'ruins',
          seed,
        }),
      );
      expect(report.winner).toBe('defender');
      expect(report.garrisonBefore).toBe(100);
      expect(report.defender.losses).toEqual(units());
      // Attacker is the loser: loses 60–90% of its 5 blades (rounded half up).
      expect(report.attacker.losses.blades).toBeGreaterThanOrEqual(4);
      expect(report.attacker.losses.blades).toBeLessThanOrEqual(5);
      expect(report.attacker.losses.shields).toBe(0);
      expect(report.attacker.losses.bows).toBe(0);
    }
  });

  it('an exact tie goes to the defender (empty vs empty)', () => {
    const report = resolveBattle(makeCtx({ attacker: side(), defender: side(), seed: 5 }));
    expect(report.winner).toBe('defender');
    expect(report.attacker.effectiveStrength).toBe(0);
    expect(report.defender.effectiveStrength).toBe(0);
    expect(report.attacker.losses).toEqual(units());
    expect(report.defender.losses).toEqual(units());
    expect(report.capturedCommanderId).toBeUndefined();
  });

  it('an attacker with zero units always loses and neither side takes losses', () => {
    const report = resolveBattle(
      makeCtx({ attacker: side(), defender: side({ shields: 10 }), seed: 8 }),
    );
    expect(report.winner).toBe('defender');
    expect(report.attacker.losses).toEqual(units());
    expect(report.defender.losses).toEqual(units());
  });
});

// ---------------------------------------------------------------------------
// Losses
// ---------------------------------------------------------------------------

describe('resolveBattle — losses', () => {
  it('computes exact loser and winner losses from the power ratio', () => {
    const seed = 4242;
    const { varA, varD } = drawsFor(seed);
    const report = resolveBattle(
      makeCtx({ attacker: side({ blades: 100 }), defender: side({ bows: 100 }), seed }),
    );
    const attackerPower = 100 * UNITS.blades.attack * COUNTER_BONUS * 1 * varA;
    const defenderPower = (100 * UNITS.bows.defense * 1 * 1 * 1 + 0) * varD;
    expect(report.winner).toBe('attacker');
    const loserFraction = 0.6 + 0.3 * (attackerPower / (attackerPower + defenderPower));
    const winnerFraction = 0.5 * (defenderPower / attackerPower);
    expect(report.defender.losses.bows).toBe(Math.min(100, roundHalfUp(100 * loserFraction)));
    expect(report.attacker.losses.blades).toBe(Math.min(100, roundHalfUp(100 * winnerFraction)));
    expect(report.attacker.effectiveStrength).toBe(round1(attackerPower));
    expect(report.defender.effectiveStrength).toBe(round1(defenderPower));
  });

  it('never loses more units than a class has, and zero-count classes lose zero', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const report = resolveBattle(
        makeCtx({
          attacker: side({ shields: 20, blades: 30, bows: 1 }),
          defender: side({ shields: 15, bows: 25 }),
          terrain: 'forest',
          watchtowerLevel: 1,
          garrison: 10,
          seed,
        }),
      );
      for (const u of UNIT_LIST) {
        expect(report.attacker.losses[u]).toBeGreaterThanOrEqual(0);
        expect(report.attacker.losses[u]).toBeLessThanOrEqual(report.attacker.before[u]);
        expect(Number.isInteger(report.attacker.losses[u])).toBe(true);
        expect(report.defender.losses[u]).toBeGreaterThanOrEqual(0);
        expect(report.defender.losses[u]).toBeLessThanOrEqual(report.defender.before[u]);
        expect(Number.isInteger(report.defender.losses[u])).toBe(true);
      }
      // Defender fields no blades → loses no blades.
      expect(report.defender.losses.blades).toBe(0);
      // Loser bleeds at least the 75% floor per class; winner at most ~50%.
      const loser = report.winner === 'attacker' ? report.defender : report.attacker;
      const winner = report.winner === 'attacker' ? report.attacker : report.defender;
      for (const u of UNIT_LIST) {
        expect(loser.losses[u]).toBeGreaterThanOrEqual(
          Math.min(loser.before[u], roundHalfUp(loser.before[u] * 0.75)),
        );
        expect(winner.losses[u]).toBeLessThanOrEqual(roundHalfUp(winner.before[u] * 0.5));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Commander capture
// ---------------------------------------------------------------------------

describe('resolveBattle — commander capture', () => {
  // Guaranteed attacker win: 100 blades vs 100 bows (see outcomes above).
  const captureSeed = findSeed((d) => d.captureRoll < COMMANDER_CAPTURE_CHANCE);
  const escapeSeed = findSeed((d) => d.captureRoll >= COMMANDER_CAPTURE_CHANCE);

  it('captures the losing defender commander when the capture roll succeeds', () => {
    const report = resolveBattle(
      makeCtx({
        attacker: side({ blades: 100 }),
        defender: side({ bows: 100 }, { commander: commander({ id: 'cmd-def', name: 'Sella', trait: 'bulwark', level: 1 }) }),
        seed: captureSeed,
      }),
    );
    expect(report.winner).toBe('attacker');
    expect(report.capturedCommanderId).toBe('cmd-def');
    expect(report.narrative).toContain('Sella');
  });

  it('does not capture when the roll fails', () => {
    const report = resolveBattle(
      makeCtx({
        attacker: side({ blades: 100 }),
        defender: side({ bows: 100 }, { commander: commander({ id: 'cmd-def', name: 'Sella' }) }),
        seed: escapeSeed,
      }),
    );
    expect(report.winner).toBe('attacker');
    expect(report.capturedCommanderId).toBeUndefined();
  });

  it('captures the losing ATTACKER commander (capture applies to whichever side loses)', () => {
    const report = resolveBattle(
      makeCtx({
        // Guaranteed defender win: shields counter blades.
        attacker: side({ blades: 100 }, { commander: commander({ id: 'cmd-att', name: 'Maro', trait: 'logistics' }) }),
        defender: side({ shields: 100 }),
        seed: captureSeed,
      }),
    );
    expect(report.winner).toBe('defender');
    expect(report.capturedCommanderId).toBe('cmd-att');
  });

  it('never captures the winning side commander, or when the loser has none', () => {
    const winnerHasOne = resolveBattle(
      makeCtx({
        attacker: side({ blades: 100 }, { commander: commander({ id: 'cmd-att' }) }),
        defender: side({ bows: 100 }),
        seed: captureSeed,
      }),
    );
    expect(winnerHasOne.winner).toBe('attacker');
    expect(winnerHasOne.capturedCommanderId).toBeUndefined();

    const nobodyHasOne = resolveBattle(
      makeCtx({ attacker: side({ blades: 100 }), defender: side({ bows: 100 }), seed: captureSeed }),
    );
    expect(nobodyHasOne.capturedCommanderId).toBeUndefined();
  });

  it('draws capture after both variance draws, so power math is unaffected by commander presence', () => {
    const seed = captureSeed;
    const { varA } = drawsFor(seed);
    const report = resolveBattle(
      makeCtx({
        attacker: side({ blades: 100 }),
        defender: side({ bows: 100 }, { commander: commander({ id: 'cmd-def', trait: 'logistics' }) }),
        seed,
      }),
    );
    expect(report.attacker.effectiveStrength).toBe(
      round1(100 * UNITS.blades.attack * COUNTER_BONUS * varA),
    );
  });
});

// ---------------------------------------------------------------------------
// Narrative
// ---------------------------------------------------------------------------

describe('resolveBattle — narrative', () => {
  it('is 1–3 sentences and names the terrain and a unit from constants', () => {
    const report = resolveBattle(
      makeCtx({
        attacker: side({ blades: 60, bows: 10 }),
        defender: side({ shields: 40 }),
        terrain: 'mountains',
        seed: 55,
      }),
    );
    expect(report.narrative).toContain('mountains');
    const unitNames = UNIT_LIST.map((u) => UNITS[u].name);
    expect(unitNames.some((n) => report.narrative.includes(n))).toBe(true);
    const sentences = report.narrative.split(/(?<=[.!?])\s+/).filter((s) => s.length > 0);
    expect(sentences.length).toBeGreaterThanOrEqual(1);
    expect(sentences.length).toBeLessThanOrEqual(3);
  });

  it('is deterministic for a given seed and varies content with the decisive factor', () => {
    // Defender base power (150×2×1.5 = 450) beats the attacker's ceiling
    // (50×6×1.1 = 330) even at minimum variance, so the outcome is decisive
    // for any seed and the assertion below cannot flip on the variance draw.
    const fortress = makeCtx({
      attacker: side({ blades: 50 }),
      defender: side({ blades: 150 }),
      terrain: 'peak',
      watchtowerLevel: 0,
      seed: 3,
    });
    const a = resolveBattle(fortress);
    const b = resolveBattle(fortress);
    expect(a.narrative).toBe(b.narrative);
    // Defender wins on the peak with no tower and no commander → terrain story.
    expect(a.winner).toBe('defender');
    expect(a.narrative).toContain('peak');
  });

  it('tells a garrison story for pure-garrison stands', () => {
    const report = resolveBattle(
      makeCtx({
        attacker: side({ blades: 5 }),
        defender: { units: units() },
        garrison: 100,
        terrain: 'ruins',
        seed: 9,
      }),
    );
    expect(report.winner).toBe('defender');
    expect(report.narrative.toLowerCase()).toContain('garrison');
    expect(report.narrative).toContain('ruins');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('resolveBattle — edge cases', () => {
  it('treats negative or missing garrison and negative tower level as zero', () => {
    const seed = 61;
    const { varD } = drawsFor(seed);
    const report = resolveBattle(
      makeCtx({
        attacker: side(),
        defender: side({ shields: 10 }),
        garrison: -50,
        watchtowerLevel: -2,
        seed,
      }),
    );
    expect(report.garrisonBefore).toBeUndefined();
    expect(report.defender.effectiveStrength).toBe(round1(10 * UNITS.shields.defense * varD));
  });

  it('handles a neutral defender with no playerId', () => {
    const report = resolveBattle(
      makeCtx({
        attacker: side({ blades: 50 }, { playerId: 'att' }),
        defender: { units: units() },
        garrison: 10,
        terrain: 'ruins',
        seed: 71,
      }),
    );
    expect(report.defender.playerId).toBeUndefined();
    expect(report.winner).toBe('attacker');
  });

  it('a zero-unit winner takes zero losses even against a garrison tie at zero', () => {
    // Attacker empty, defender empty, no garrison → tie → defender wins at 0 power.
    const report = resolveBattle(makeCtx({ attacker: side(), defender: side(), garrison: 0, seed: 100 }));
    expect(report.winner).toBe('defender');
    expect(report.defender.losses).toEqual(units());
    expect(report.attacker.losses).toEqual(units());
  });
});
