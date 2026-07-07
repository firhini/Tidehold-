import { describe, expect, it } from 'vitest';
import {
  ARK_BASE_HP,
  ARK_DAMAGE_PRODUCTION_PENALTY,
  BUILDING_LEVEL_COST_MULT,
  BUILDING_LEVEL_PROD_MULT,
  BUILDING_LIST,
  BUILDINGS,
  MARKET_BASE_PRICES,
  MARKET_FEE,
  MARKET_FEE_OATHBREAKER_MULT,
  MARKET_FEE_WITH_PORT,
  MARKET_MAX_PRICE_MULT,
  MARKET_MIN_PRICE_MULT,
  MARKET_PRESSURE_DECAY,
  MARKET_PRESSURE_FACTOR,
  MARKET_TIDE_PRICE_FACTOR,
  RESOURCE_LIST,
  RICHNESS_MULT,
  STARTING_REPUTATION,
  STARTING_RESOURCES,
  STARTING_SHELLS,
  TECH_PRODUCTION_BONUS,
  UNIT_LIST,
  UNITS,
} from '../src/constants.js';
import type { Ark, PlayerState, Resources, Tile } from '../src/types.js';
import {
  addResources,
  applyTradePressure,
  armyUpkeep,
  buildingCost,
  canAfford,
  createMarket,
  scaleResources,
  subResources,
  tickMarket,
  tileProduction,
  tradeQuote,
  unitCost,
  zeroResources,
} from '../src/economy.js';

// ---------------------------------------------------------------------------
// Test factories — hand-rolled, no worldgen dependency.
// ---------------------------------------------------------------------------

function makeArk(overrides: Partial<Ark> = {}): Ark {
  return {
    q: 0,
    r: 0,
    level: 1,
    hp: ARK_BASE_HP,
    maxHp: ARK_BASE_HP,
    moveReadyTick: 0,
    damagedUntilTick: 0,
    ...overrides,
  };
}

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    username: 'tester',
    ark: makeArk(),
    resources: { ...STARTING_RESOURCES },
    shells: STARTING_SHELLS,
    reputation: STARTING_REPUTATION,
    score: 0,
    techs: [],
    commanders: [],
    createdTick: 0,
    lastSeenTick: 0,
    defeated: false,
    ...overrides,
  };
}

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

const round2 = (x: number) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------------------
// Resource math
// ---------------------------------------------------------------------------

describe('zeroResources', () => {
  it('returns all four resources at zero', () => {
    expect(zeroResources()).toEqual({ timber: 0, ore: 0, food: 0, relics: 0 });
  });

  it('returns a fresh object on each call', () => {
    const a = zeroResources();
    const b = zeroResources();
    expect(a).not.toBe(b);
    a.timber = 99;
    expect(b.timber).toBe(0);
  });
});

describe('addResources', () => {
  it('adds a partial bag onto a full bag', () => {
    const a: Resources = { timber: 10, ore: 5, food: 0, relics: 1 };
    expect(addResources(a, { timber: 3, relics: 2 })).toEqual({
      timber: 13,
      ore: 5,
      food: 0,
      relics: 3,
    });
  });

  it('returns a new object and does not mutate either input', () => {
    const a: Resources = { timber: 1, ore: 1, food: 1, relics: 1 };
    const b = { timber: 5 };
    const out = addResources(a, b);
    expect(out).not.toBe(a);
    expect(a).toEqual({ timber: 1, ore: 1, food: 1, relics: 1 });
    expect(b).toEqual({ timber: 5 });
  });

  it('treats missing keys in b as zero', () => {
    const a = zeroResources();
    expect(addResources(a, {})).toEqual(zeroResources());
  });

  it('supports negative deltas', () => {
    const a: Resources = { timber: 10, ore: 0, food: 0, relics: 0 };
    expect(addResources(a, { timber: -4 }).timber).toBe(6);
  });

  it('supports fractional amounts (server accumulates floats)', () => {
    const a = zeroResources();
    expect(addResources(a, { food: 0.5 }).food).toBeCloseTo(0.5, 12);
  });
});

describe('subResources', () => {
  it('subtracts a partial bag', () => {
    const a: Resources = { timber: 10, ore: 5, food: 8, relics: 2 };
    expect(subResources(a, { ore: 3, food: 8 })).toEqual({
      timber: 10,
      ore: 2,
      food: 0,
      relics: 2,
    });
  });

  it('may go negative (caller checks canAfford)', () => {
    const a = zeroResources();
    expect(subResources(a, { relics: 3 }).relics).toBe(-3);
  });

  it('returns a new object and does not mutate the input', () => {
    const a: Resources = { timber: 7, ore: 7, food: 7, relics: 7 };
    const out = subResources(a, { timber: 7 });
    expect(out).not.toBe(a);
    expect(a.timber).toBe(7);
  });

  it('add then sub of the same bag round-trips', () => {
    const a: Resources = { timber: 3, ore: 4, food: 5, relics: 6 };
    const bag = { timber: 2, ore: 1, food: 9, relics: 4 };
    expect(subResources(addResources(a, bag), bag)).toEqual(a);
  });
});

describe('canAfford', () => {
  it('true when every resource covers the cost', () => {
    const have: Resources = { timber: 100, ore: 50, food: 30, relics: 2 };
    expect(canAfford(have, { timber: 100, ore: 50 })).toBe(true);
  });

  it('exact equality affords', () => {
    const have: Resources = { timber: 40, ore: 0, food: 20, relics: 0 };
    expect(canAfford(have, BUILDINGS.lumber_camp.cost)).toBe(true);
  });

  it('false when any single resource falls short', () => {
    const have: Resources = { timber: 1000, ore: 1000, food: 1000, relics: 0 };
    expect(canAfford(have, { relics: 1 })).toBe(false);
  });

  it('empty cost is always affordable', () => {
    expect(canAfford(zeroResources(), {})).toBe(true);
  });

  it('a zero-amount cost entry is affordable at zero stock', () => {
    expect(canAfford(zeroResources(), { timber: 0 })).toBe(true);
  });

  it('negative stock cannot afford a positive cost', () => {
    const have: Resources = { timber: -1, ore: 0, food: 0, relics: 0 };
    expect(canAfford(have, { timber: 1 })).toBe(false);
  });
});

describe('scaleResources', () => {
  it('scales and floors each entry', () => {
    expect(scaleResources({ timber: 10, ore: 3 }, 0.3)).toEqual({ timber: 3, ore: 0 });
  });

  it('only includes keys present in the input bag', () => {
    const out = scaleResources({ food: 9 }, 2);
    expect(out).toEqual({ food: 18 });
    expect('timber' in out).toBe(false);
  });

  it('k = 0 zeroes everything present', () => {
    expect(scaleResources({ timber: 5, relics: 5 }, 0)).toEqual({ timber: 0, relics: 0 });
  });

  it('empty bag stays empty', () => {
    expect(scaleResources({}, 5)).toEqual({});
  });

  it('does not mutate the input', () => {
    const bag = { ore: 4 };
    scaleResources(bag, 10);
    expect(bag).toEqual({ ore: 4 });
  });

  it('floors, not rounds', () => {
    expect(scaleResources({ timber: 1 }, 0.99)).toEqual({ timber: 0 });
    expect(scaleResources({ timber: 199 }, 0.01)).toEqual({ timber: 1 });
  });
});

// ---------------------------------------------------------------------------
// buildingCost
// ---------------------------------------------------------------------------

describe('buildingCost', () => {
  it('level 1 equals the base cost for every building', () => {
    for (const type of BUILDING_LIST) {
      expect(buildingCost(type, 1)).toEqual(BUILDINGS[type].cost);
    }
  });

  it('level 2 is ceil(base × mult) per resource', () => {
    for (const type of BUILDING_LIST) {
      const cost = buildingCost(type, 2);
      for (const key of RESOURCE_LIST) {
        const base = BUILDINGS[type].cost[key];
        if (base === undefined) {
          expect(cost[key]).toBeUndefined();
        } else {
          expect(cost[key]).toBe(Math.ceil(base * BUILDING_LEVEL_COST_MULT));
        }
      }
    }
  });

  it('level 3 is ceil(base × mult²) per resource', () => {
    for (const type of BUILDING_LIST) {
      const cost = buildingCost(type, 3);
      for (const key of RESOURCE_LIST) {
        const base = BUILDINGS[type].cost[key];
        if (base === undefined) {
          expect(cost[key]).toBeUndefined();
        } else {
          expect(cost[key]).toBe(Math.ceil(base * BUILDING_LEVEL_COST_MULT ** 2));
        }
      }
    }
  });

  it('only contains resources present in the base cost', () => {
    // farm costs timber+ore only — no food or relics entries at any level.
    for (const level of [1, 2, 3]) {
      const cost = buildingCost('farm', level);
      expect(Object.keys(cost).sort()).toEqual(['ore', 'timber']);
    }
  });

  it('costs are integers (rounded up) and strictly increase with level', () => {
    for (const type of BUILDING_LIST) {
      for (const key of RESOURCE_LIST) {
        if (BUILDINGS[type].cost[key] === undefined) continue;
        const l1 = buildingCost(type, 1)[key]!;
        const l2 = buildingCost(type, 2)[key]!;
        const l3 = buildingCost(type, 3)[key]!;
        expect(Number.isInteger(l1)).toBe(true);
        expect(Number.isInteger(l2)).toBe(true);
        expect(Number.isInteger(l3)).toBe(true);
        expect(l2).toBeGreaterThan(l1);
        expect(l3).toBeGreaterThan(l2);
      }
    }
  });

  it('is deterministic', () => {
    expect(buildingCost('port', 3)).toEqual(buildingCost('port', 3));
  });
});

// ---------------------------------------------------------------------------
// tileProduction
// ---------------------------------------------------------------------------

describe('tileProduction', () => {
  const baseFood = BUILDINGS.farm.production.food!;
  const baseTimber = BUILDINGS.lumber_camp.production.timber!;
  const baseOre = BUILDINGS.mine.production.ore!;

  it('returns {} for a tile with no building', () => {
    expect(tileProduction(makeTile(), makePlayer(), 10)).toEqual({});
  });

  it('returns {} when tile.building is explicitly undefined', () => {
    expect(tileProduction(makeTile({ building: undefined }), makePlayer(), 10)).toEqual({});
  });

  it('returns {} while the building is disabled (disabledUntilTick > tick)', () => {
    const tile = makeTile({
      building: { type: 'farm', level: 1, ownerId: 'p1', disabledUntilTick: 11 },
    });
    expect(tileProduction(tile, makePlayer(), 10)).toEqual({});
  });

  it('produces again once disabledUntilTick is reached (not > tick)', () => {
    const tile = makeTile({
      building: { type: 'farm', level: 1, ownerId: 'p1', disabledUntilTick: 10 },
    });
    expect(tileProduction(tile, makePlayer(), 10)).toEqual({ food: baseFood });
  });

  it('level 1, richness 1, no techs, undamaged → exactly base production', () => {
    const tile = makeTile({
      terrain: 'forest',
      building: { type: 'lumber_camp', level: 1, ownerId: 'p1' },
    });
    expect(tileProduction(tile, makePlayer(), 0)).toEqual({ timber: baseTimber });
  });

  it('applies BUILDING_LEVEL_PROD_MULT per level above 1', () => {
    const t2 = makeTile({ building: { type: 'farm', level: 2, ownerId: 'p1' } });
    const t3 = makeTile({ building: { type: 'farm', level: 3, ownerId: 'p1' } });
    expect(tileProduction(t2, makePlayer(), 0).food).toBeCloseTo(
      baseFood * BUILDING_LEVEL_PROD_MULT,
      12,
    );
    expect(tileProduction(t3, makePlayer(), 0).food).toBeCloseTo(
      baseFood * BUILDING_LEVEL_PROD_MULT ** 2,
      12,
    );
  });

  it('applies RICHNESS_MULT by richness class', () => {
    for (const richness of [1, 2, 3]) {
      const tile = makeTile({
        richness,
        building: { type: 'farm', level: 1, ownerId: 'p1' },
      });
      expect(tileProduction(tile, makePlayer(), 0).food).toBeCloseTo(
        baseFood * RICHNESS_MULT[richness - 1],
        12,
      );
    }
  });

  describe('tech bonuses', () => {
    it('deep_saws boosts timber production', () => {
      const tile = makeTile({
        terrain: 'forest',
        building: { type: 'lumber_camp', level: 1, ownerId: 'p1' },
      });
      const owner = makePlayer({ techs: ['deep_saws'] });
      expect(tileProduction(tile, owner, 0).timber).toBeCloseTo(
        baseTimber * (1 + TECH_PRODUCTION_BONUS),
        12,
      );
    });

    it('fire_hardening boosts ore production', () => {
      const tile = makeTile({
        terrain: 'hills',
        building: { type: 'mine', level: 1, ownerId: 'p1' },
      });
      const owner = makePlayer({ techs: ['fire_hardening'] });
      expect(tileProduction(tile, owner, 0).ore).toBeCloseTo(
        baseOre * (1 + TECH_PRODUCTION_BONUS),
        12,
      );
    });

    it('tide_terraces boosts food production', () => {
      const tile = makeTile({ building: { type: 'farm', level: 1, ownerId: 'p1' } });
      const owner = makePlayer({ techs: ['tide_terraces'] });
      expect(tileProduction(tile, owner, 0).food).toBeCloseTo(
        baseFood * (1 + TECH_PRODUCTION_BONUS),
        12,
      );
    });

    it('non-matching techs have no effect', () => {
      const tile = makeTile({ building: { type: 'farm', level: 1, ownerId: 'p1' } });
      const owner = makePlayer({
        techs: ['deep_saws', 'fire_hardening', 'star_charts', 'hull_lore'],
      });
      expect(tileProduction(tile, owner, 0)).toEqual({ food: baseFood });
    });
  });

  describe('ark damage penalty', () => {
    it('halves production while owner.ark.damagedUntilTick > tick', () => {
      const tile = makeTile({ building: { type: 'farm', level: 1, ownerId: 'p1' } });
      const owner = makePlayer({ ark: makeArk({ damagedUntilTick: 50 }) });
      expect(tileProduction(tile, owner, 49).food).toBeCloseTo(
        baseFood * ARK_DAMAGE_PRODUCTION_PENALTY,
        12,
      );
    });

    it('no penalty once tick reaches damagedUntilTick', () => {
      const tile = makeTile({ building: { type: 'farm', level: 1, ownerId: 'p1' } });
      const owner = makePlayer({ ark: makeArk({ damagedUntilTick: 50 }) });
      expect(tileProduction(tile, owner, 50)).toEqual({ food: baseFood });
    });
  });

  it('all multipliers stack: level × richness × tech × ark damage', () => {
    const tile = makeTile({
      terrain: 'forest',
      richness: 3,
      building: { type: 'lumber_camp', level: 3, ownerId: 'p1' },
    });
    const owner = makePlayer({
      techs: ['deep_saws'],
      ark: makeArk({ damagedUntilTick: 100 }),
    });
    const expected =
      baseTimber *
      BUILDING_LEVEL_PROD_MULT ** 2 *
      RICHNESS_MULT[2] *
      (1 + TECH_PRODUCTION_BONUS) *
      ARK_DAMAGE_PRODUCTION_PENALTY;
    expect(tileProduction(tile, owner, 0)).toEqual({ timber: expected });
  });

  it('non-producing buildings (port, watchtower, shrine) yield {}', () => {
    for (const type of ['port', 'watchtower', 'shrine'] as const) {
      const tile = makeTile({
        terrain: 'coast',
        richness: 3,
        building: { type, level: 3, ownerId: 'p1' },
      });
      expect(tileProduction(tile, makePlayer(), 0)).toEqual({});
    }
  });

  it('values may be fractional', () => {
    const tile = makeTile({
      richness: 2,
      building: { type: 'farm', level: 2, ownerId: 'p1' },
    });
    const owner = makePlayer({ ark: makeArk({ damagedUntilTick: 10 }) });
    const value = tileProduction(tile, owner, 0).food!;
    expect(value).toBeCloseTo(
      baseFood * BUILDING_LEVEL_PROD_MULT * RICHNESS_MULT[1] * ARK_DAMAGE_PRODUCTION_PENALTY,
      12,
    );
    expect(Number.isInteger(value)).toBe(false);
  });

  it('does not mutate the tile or the owner', () => {
    const tile = makeTile({ building: { type: 'farm', level: 2, ownerId: 'p1' } });
    const owner = makePlayer({ techs: ['tide_terraces'] });
    const tileSnap = JSON.parse(JSON.stringify(tile));
    const ownerSnap = JSON.parse(JSON.stringify(owner));
    tileProduction(tile, owner, 5);
    expect(JSON.parse(JSON.stringify(tile))).toEqual(tileSnap);
    expect(JSON.parse(JSON.stringify(owner))).toEqual(ownerSnap);
  });

  it('is deterministic for identical inputs', () => {
    const build = () =>
      tileProduction(
        makeTile({ richness: 3, building: { type: 'mine', level: 3, ownerId: 'p1' } }),
        makePlayer({ techs: ['fire_hardening'] }),
        42,
      );
    expect(build()).toEqual(build());
  });
});

// ---------------------------------------------------------------------------
// armyUpkeep & unitCost
// ---------------------------------------------------------------------------

describe('armyUpkeep', () => {
  it('an empty army costs nothing', () => {
    expect(armyUpkeep({ shields: 0, blades: 0, bows: 0 })).toBe(0);
  });

  it('sums count × per-unit upkeep across all unit types', () => {
    const units = { shields: 10, blades: 5, bows: 20 };
    const expected =
      10 * UNITS.shields.upkeep + 5 * UNITS.blades.upkeep + 20 * UNITS.bows.upkeep;
    expect(armyUpkeep(units)).toBeCloseTo(expected, 12);
  });

  it('single unit type matches the constant exactly', () => {
    expect(armyUpkeep({ shields: 100, blades: 0, bows: 0 })).toBeCloseTo(
      100 * UNITS.shields.upkeep,
      12,
    );
  });

  it('ignores negative counts (defensive)', () => {
    expect(armyUpkeep({ shields: -5, blades: 0, bows: 10 })).toBeCloseTo(
      10 * UNITS.bows.upkeep,
      12,
    );
  });
});

describe('unitCost', () => {
  it('empty order costs nothing', () => {
    expect(unitCost({})).toEqual({});
  });

  it('zero counts cost nothing', () => {
    expect(unitCost({ shields: 0, blades: 0, bows: 0 })).toEqual({});
  });

  it('single unit type: count × per-unit cost', () => {
    const cost = unitCost({ bows: 3 });
    for (const key of RESOURCE_LIST) {
      const per = UNITS.bows.cost[key];
      if (per === undefined) expect(cost[key]).toBeUndefined();
      else expect(cost[key]).toBe(per * 3);
    }
  });

  it('mixed order sums per-resource across unit types', () => {
    const order = { shields: 2, blades: 3, bows: 4 };
    const cost = unitCost(order);
    for (const key of RESOURCE_LIST) {
      let expected = 0;
      for (const type of UNIT_LIST) {
        expected += (UNITS[type].cost[key] ?? 0) * order[type];
      }
      if (expected === 0) expect(cost[key] ?? 0).toBe(0);
      else expect(cost[key]).toBe(expected);
    }
  });

  it('ignores negative counts (defensive)', () => {
    expect(unitCost({ shields: -10, bows: 1 })).toEqual(unitCost({ bows: 1 }));
  });

  it('recruit order is affordable exactly at its own cost', () => {
    const cost = unitCost({ shields: 1, blades: 1, bows: 1 });
    const have = addResources(zeroResources(), cost);
    expect(canAfford(have, cost)).toBe(true);
    expect(canAfford(subResources(have, { food: 1 }), cost)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Market
// ---------------------------------------------------------------------------

describe('createMarket', () => {
  it('starts at base prices with zero pressure', () => {
    const market = createMarket();
    expect(market.prices).toEqual(MARKET_BASE_PRICES);
    expect(market.pressure).toEqual({ timber: 0, ore: 0, food: 0, relics: 0 });
  });

  it('copies base prices — mutating the market never touches the constants', () => {
    const market = createMarket();
    market.prices.timber = 999;
    expect(MARKET_BASE_PRICES.timber).not.toBe(999);
  });

  it('returns independent instances', () => {
    const a = createMarket();
    const b = createMarket();
    a.pressure.ore = 50;
    a.prices.food = 3;
    expect(b.pressure.ore).toBe(0);
    expect(b.prices.food).toBe(MARKET_BASE_PRICES.food);
  });
});

describe('tickMarket', () => {
  it('tide 0, no pressure → prices stay at base', () => {
    const market = createMarket();
    tickMarket(market, 0);
    for (const key of RESOURCE_LIST) {
      expect(market.prices[key]).toBeCloseTo(MARKET_BASE_PRICES[key], 12);
    }
  });

  it('prices rise with the tide level', () => {
    const market = createMarket();
    tickMarket(market, 4);
    for (const key of RESOURCE_LIST) {
      expect(market.prices[key]).toBeCloseTo(
        MARKET_BASE_PRICES[key] * (1 + MARKET_TIDE_PRICE_FACTOR * 4),
        12,
      );
    }
  });

  it('a higher tide means higher prices (monotone in tide)', () => {
    const low = createMarket();
    const high = createMarket();
    tickMarket(low, 1);
    tickMarket(high, 5);
    for (const key of RESOURCE_LIST) {
      expect(high.prices[key]).toBeGreaterThan(low.prices[key]);
    }
  });

  it('uses the pre-decay pressure for the price, then decays pressure', () => {
    const market = createMarket();
    applyTradePressure(market, 'ore', 100, 'buy');
    tickMarket(market, 0);
    expect(market.prices.ore).toBeCloseTo(
      MARKET_BASE_PRICES.ore * (1 + MARKET_PRESSURE_FACTOR * 100),
      12,
    );
    expect(market.pressure.ore).toBeCloseTo(100 * MARKET_PRESSURE_DECAY, 12);
  });

  it('buy pressure raises the price above the tide baseline', () => {
    const market = createMarket();
    const baseline = MARKET_BASE_PRICES.food * (1 + MARKET_TIDE_PRICE_FACTOR * 2);
    applyTradePressure(market, 'food', 500, 'buy');
    tickMarket(market, 2);
    expect(market.prices.food).toBeGreaterThan(baseline);
    // Other resources untouched by the trade stay at baseline.
    expect(market.prices.timber).toBeCloseTo(
      MARKET_BASE_PRICES.timber * (1 + MARKET_TIDE_PRICE_FACTOR * 2),
      12,
    );
  });

  it('sell pressure pushes the price below the tide baseline', () => {
    const market = createMarket();
    const baseline = MARKET_BASE_PRICES.timber * (1 + MARKET_TIDE_PRICE_FACTOR * 3);
    applyTradePressure(market, 'timber', 800, 'sell');
    tickMarket(market, 3);
    expect(market.prices.timber).toBeLessThan(baseline);
  });

  it('pressure decays each tick and the price drifts back toward the tide baseline', () => {
    const market = createMarket();
    applyTradePressure(market, 'food', 1000, 'buy');
    tickMarket(market, 1);
    const baseline = MARKET_BASE_PRICES.food * (1 + MARKET_TIDE_PRICE_FACTOR * 1);
    let prev = market.prices.food;
    expect(prev).toBeGreaterThan(baseline);
    for (let i = 0; i < 700; i++) {
      tickMarket(market, 1);
      expect(market.prices.food).toBeLessThan(prev);
      expect(market.prices.food).toBeGreaterThan(baseline);
      prev = market.prices.food;
    }
    // After 700+ decay ticks the residual pressure is negligible.
    expect(market.prices.food).toBeCloseTo(baseline, 4);
    expect(Math.abs(market.pressure.food)).toBeLessThan(0.01);
  });

  it('clamps at the maximum price under extreme buy pressure', () => {
    const market = createMarket();
    applyTradePressure(market, 'relics', 1_000_000, 'buy');
    tickMarket(market, 5);
    expect(market.prices.relics).toBe(MARKET_BASE_PRICES.relics * MARKET_MAX_PRICE_MULT);
  });

  it('clamps at the minimum price under extreme sell pressure', () => {
    const market = createMarket();
    applyTradePressure(market, 'food', 1_000_000, 'sell');
    tickMarket(market, 0);
    expect(market.prices.food).toBe(MARKET_BASE_PRICES.food * MARKET_MIN_PRICE_MULT);
  });

  it('clamps an absurd tide level at the maximum price', () => {
    const market = createMarket();
    tickMarket(market, 10_000);
    for (const key of RESOURCE_LIST) {
      expect(market.prices[key]).toBe(MARKET_BASE_PRICES[key] * MARKET_MAX_PRICE_MULT);
    }
  });

  it('clamping never zeroes or explodes any price across a long noisy run', () => {
    const market = createMarket();
    for (let t = 0; t < 100; t++) {
      applyTradePressure(market, 'ore', 5000, t % 2 === 0 ? 'buy' : 'sell');
      tickMarket(market, t % 9);
      const base = MARKET_BASE_PRICES.ore;
      expect(market.prices.ore).toBeGreaterThanOrEqual(base * MARKET_MIN_PRICE_MULT);
      expect(market.prices.ore).toBeLessThanOrEqual(base * MARKET_MAX_PRICE_MULT);
    }
  });

  it('is deterministic: identical trade/tick sequences produce identical states', () => {
    const run = () => {
      const market = createMarket();
      applyTradePressure(market, 'timber', 250, 'buy');
      tickMarket(market, 1);
      applyTradePressure(market, 'food', 90, 'sell');
      tickMarket(market, 2);
      tickMarket(market, 3);
      return market;
    };
    expect(run()).toEqual(run());
  });
});

describe('tradeQuote', () => {
  it('buy costs price × amount × (1 + feeRate), rounded to 2 decimals', () => {
    const market = createMarket();
    const quote = tradeQuote(market, 'food', 10, 'buy', MARKET_FEE);
    const gross = MARKET_BASE_PRICES.food * 10;
    expect(quote.shells).toBe(round2(gross * (1 + MARKET_FEE)));
    expect(quote.fee).toBe(round2(gross * MARKET_FEE));
    expect(quote.pricePerUnit).toBe(MARKET_BASE_PRICES.food);
  });

  it('sell yields price × amount × (1 - feeRate), rounded to 2 decimals', () => {
    const market = createMarket();
    const quote = tradeQuote(market, 'ore', 7, 'sell', MARKET_FEE);
    const gross = MARKET_BASE_PRICES.ore * 7;
    expect(quote.shells).toBe(round2(gross * (1 - MARKET_FEE)));
    expect(quote.fee).toBe(round2(gross * MARKET_FEE));
  });

  it('rounds shells to exactly 2 decimals', () => {
    const market = createMarket();
    market.prices.timber = 1 / 3; // 0.3333...
    const quote = tradeQuote(market, 'timber', 1, 'buy', 0);
    expect(quote.shells).toBe(0.33);
    expect(quote.fee).toBe(0);
  });

  it('quotes against the CURRENT (drifted) price, not the base price', () => {
    const market = createMarket();
    tickMarket(market, 5);
    const quote = tradeQuote(market, 'timber', 4, 'buy', 0);
    expect(quote.pricePerUnit).toBe(market.prices.timber);
    expect(quote.shells).toBe(round2(market.prices.timber * 4));
  });

  it('relics ARE tradable (a strategic sink)', () => {
    const market = createMarket();
    const buy = tradeQuote(market, 'relics', 2, 'buy', MARKET_FEE);
    const sell = tradeQuote(market, 'relics', 2, 'sell', MARKET_FEE);
    expect(buy.shells).toBe(round2(MARKET_BASE_PRICES.relics * 2 * (1 + MARKET_FEE)));
    expect(sell.shells).toBe(round2(MARKET_BASE_PRICES.relics * 2 * (1 - MARKET_FEE)));
    expect(buy.shells).toBeGreaterThan(sell.shells); // the fee spread is the sink
  });

  it('a port halves the fee; oathbreakers pay double (caller passes the rate)', () => {
    const market = createMarket();
    const normal = tradeQuote(market, 'timber', 100, 'buy', MARKET_FEE);
    const port = tradeQuote(market, 'timber', 100, 'buy', MARKET_FEE_WITH_PORT);
    const oath = tradeQuote(
      market,
      'timber',
      100,
      'buy',
      MARKET_FEE * MARKET_FEE_OATHBREAKER_MULT,
    );
    expect(port.fee).toBeLessThan(normal.fee);
    expect(oath.fee).toBeCloseTo(normal.fee * MARKET_FEE_OATHBREAKER_MULT, 10);
    expect(port.shells).toBeLessThan(normal.shells);
    expect(oath.shells).toBeGreaterThan(normal.shells);
  });

  it('zero feeRate: buy and sell meet at the raw price', () => {
    const market = createMarket();
    const buy = tradeQuote(market, 'ore', 10, 'buy', 0);
    const sell = tradeQuote(market, 'ore', 10, 'sell', 0);
    expect(buy.shells).toBe(sell.shells);
    expect(buy.fee).toBe(0);
  });

  it('throws RangeError for non-positive amounts', () => {
    const market = createMarket();
    expect(() => tradeQuote(market, 'food', 0, 'buy', MARKET_FEE)).toThrow(RangeError);
    expect(() => tradeQuote(market, 'food', -5, 'sell', MARKET_FEE)).toThrow(RangeError);
  });

  it('throws RangeError for non-integer amounts', () => {
    const market = createMarket();
    expect(() => tradeQuote(market, 'food', 2.5, 'buy', MARKET_FEE)).toThrow(RangeError);
    expect(() => tradeQuote(market, 'food', NaN, 'buy', MARKET_FEE)).toThrow(RangeError);
    expect(() => tradeQuote(market, 'food', Infinity, 'sell', MARKET_FEE)).toThrow(RangeError);
  });

  it('does not mutate the market', () => {
    const market = createMarket();
    const snapshot = JSON.parse(JSON.stringify(market));
    tradeQuote(market, 'relics', 3, 'buy', MARKET_FEE);
    expect(JSON.parse(JSON.stringify(market))).toEqual(snapshot);
  });

  it('is deterministic', () => {
    const market = createMarket();
    const a = tradeQuote(market, 'ore', 13, 'sell', MARKET_FEE_WITH_PORT);
    const b = tradeQuote(market, 'ore', 13, 'sell', MARKET_FEE_WITH_PORT);
    expect(a).toEqual(b);
  });
});

describe('applyTradePressure', () => {
  it('buying adds positive pressure', () => {
    const market = createMarket();
    applyTradePressure(market, 'timber', 40, 'buy');
    expect(market.pressure.timber).toBe(40);
  });

  it('selling adds negative pressure', () => {
    const market = createMarket();
    applyTradePressure(market, 'timber', 40, 'sell');
    expect(market.pressure.timber).toBe(-40);
  });

  it('accumulates across trades and nets buy against sell', () => {
    const market = createMarket();
    applyTradePressure(market, 'ore', 100, 'buy');
    applyTradePressure(market, 'ore', 30, 'sell');
    applyTradePressure(market, 'ore', 5, 'buy');
    expect(market.pressure.ore).toBe(75);
  });

  it('only affects the traded resource', () => {
    const market = createMarket();
    applyTradePressure(market, 'relics', 9, 'buy');
    expect(market.pressure.timber).toBe(0);
    expect(market.pressure.ore).toBe(0);
    expect(market.pressure.food).toBe(0);
    expect(market.pressure.relics).toBe(9);
  });

  it('does not touch prices until the next tickMarket', () => {
    const market = createMarket();
    applyTradePressure(market, 'food', 5000, 'buy');
    expect(market.prices.food).toBe(MARKET_BASE_PRICES.food);
  });

  it('throws RangeError for invalid amounts, leaving pressure unchanged', () => {
    const market = createMarket();
    expect(() => applyTradePressure(market, 'food', 0, 'buy')).toThrow(RangeError);
    expect(() => applyTradePressure(market, 'food', -1, 'sell')).toThrow(RangeError);
    expect(() => applyTradePressure(market, 'food', 1.5, 'buy')).toThrow(RangeError);
    expect(market.pressure.food).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// End-to-end market scenario
// ---------------------------------------------------------------------------

describe('market drift scenario', () => {
  it('a buying spree spikes the price, then the market cools back to the tide baseline', () => {
    const market = createMarket();
    const tide = 2;
    const baseline = MARKET_BASE_PRICES.ore * (1 + MARKET_TIDE_PRICE_FACTOR * tide);

    // Quiet market sits on the baseline.
    tickMarket(market, tide);
    expect(market.prices.ore).toBeCloseTo(baseline, 12);

    // Spree: repeated buys quoted at ever-higher prices.
    let lastQuote = tradeQuote(market, 'ore', 50, 'buy', MARKET_FEE).shells;
    for (let i = 0; i < 5; i++) {
      applyTradePressure(market, 'ore', 500, 'buy');
      tickMarket(market, tide);
      const quote = tradeQuote(market, 'ore', 50, 'buy', MARKET_FEE).shells;
      expect(quote).toBeGreaterThan(lastQuote);
      lastQuote = quote;
    }
    expect(market.prices.ore).toBeGreaterThan(baseline);

    // Cooldown: no trades, price decays back toward baseline but never below.
    for (let i = 0; i < 800; i++) tickMarket(market, tide);
    expect(market.prices.ore).toBeCloseTo(baseline, 3);
    expect(market.prices.ore).toBeGreaterThanOrEqual(baseline);
  });
});
