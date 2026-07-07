/**
 * Economy — production, costs, upkeep, and the shell market.
 * Pure functions; the server owns application/mutation of player state
 * except where a function explicitly takes and mutates MarketState.
 */
import type {
  BuildingType,
  MarketState,
  PlayerState,
  Resources,
  ResourceType,
  Tile,
  UnitCounts,
} from './types.js';
import {
  ARK_DAMAGE_PRODUCTION_PENALTY,
  BUILDING_LEVEL_COST_MULT,
  BUILDING_LEVEL_PROD_MULT,
  BUILDINGS,
  MARKET_BASE_PRICES,
  MARKET_MAX_PRICE_MULT,
  MARKET_MIN_PRICE_MULT,
  MARKET_PRESSURE_DECAY,
  MARKET_PRESSURE_FACTOR,
  MARKET_TIDE_PRICE_FACTOR,
  RESOURCE_LIST,
  RICHNESS_MULT,
  TECH_PRODUCTION_BONUS,
  UNIT_LIST,
  UNITS,
} from './constants.js';

/** Which expedition tech boosts production of which resource. */
const TECH_FOR_RESOURCE: Partial<Record<ResourceType, string>> = {
  timber: 'deep_saws',
  ore: 'fire_hardening',
  food: 'tide_terraces',
};

/** Round a shell amount to 2 decimal places. */
function roundShells(x: number): number {
  return Math.round(x * 100) / 100;
}

/** Empty resource bag. */
export function zeroResources(): Resources {
  return { timber: 0, ore: 0, food: 0, relics: 0 };
}

/** a + b (b partial). Returns new object. */
export function addResources(a: Resources, b: Partial<Resources>): Resources {
  const out: Resources = { ...a };
  for (const key of RESOURCE_LIST) {
    const delta = b[key];
    if (delta !== undefined) out[key] = out[key] + delta;
  }
  return out;
}

/** a - b (b partial). Returns new object; may go negative (caller checks canAfford). */
export function subResources(a: Resources, b: Partial<Resources>): Resources {
  const out: Resources = { ...a };
  for (const key of RESOURCE_LIST) {
    const delta = b[key];
    if (delta !== undefined) out[key] = out[key] - delta;
  }
  return out;
}

export function canAfford(have: Resources, cost: Partial<Resources>): boolean {
  for (const key of RESOURCE_LIST) {
    const need = cost[key] ?? 0;
    if ((have[key] ?? 0) < need) return false;
  }
  return true;
}

/** Scale a partial resource bag by k, flooring each entry. */
export function scaleResources(bag: Partial<Resources>, k: number): Partial<Resources> {
  const out: Partial<Resources> = {};
  for (const key of RESOURCE_LIST) {
    const v = bag[key];
    if (v !== undefined) out[key] = Math.floor(v * k);
  }
  return out;
}

/**
 * Cost to construct `type` at `level` (level 1 = base cost, each further level
 * multiplies by BUILDING_LEVEL_COST_MULT, rounded up per resource).
 */
export function buildingCost(type: BuildingType, level: number): Partial<Resources> {
  const spec = BUILDINGS[type];
  const mult = Math.pow(BUILDING_LEVEL_COST_MULT, level - 1);
  const out: Partial<Resources> = {};
  for (const key of RESOURCE_LIST) {
    const base = spec.cost[key];
    if (base !== undefined) out[key] = Math.ceil(base * mult);
  }
  return out;
}

/**
 * Production of one built tile per tick:
 * base production × BUILDING_LEVEL_PROD_MULT^(level-1) × RICHNESS_MULT[richness-1]
 * × (1 + TECH_PRODUCTION_BONUS if the owner has the matching tech:
 *    deep_saws→timber, fire_hardening→ore, tide_terraces→food)
 * × arkDamagePenalty (ARK_DAMAGE_PRODUCTION_PENALTY while damaged)
 * Disabled buildings (disabledUntilTick > tick) produce nothing.
 * Values may be fractional; the server accumulates floats.
 */
export function tileProduction(
  tile: Tile,
  owner: PlayerState,
  tick: number,
): Partial<Resources> {
  const building = tile?.building;
  if (!building) return {};
  if (building.disabledUntilTick !== undefined && building.disabledUntilTick > tick) return {};

  const spec = BUILDINGS[building.type];
  if (!spec) return {};

  const levelMult = Math.pow(BUILDING_LEVEL_PROD_MULT, building.level - 1);
  const richnessMult = RICHNESS_MULT[tile.richness - 1] ?? 1;
  const damageMult =
    (owner.ark?.damagedUntilTick ?? 0) > tick ? ARK_DAMAGE_PRODUCTION_PENALTY : 1;

  const out: Partial<Resources> = {};
  for (const key of RESOURCE_LIST) {
    const base = spec.production[key];
    if (base === undefined) continue;
    const techId = TECH_FOR_RESOURCE[key];
    const techMult =
      techId !== undefined && (owner.techs?.includes(techId) ?? false)
        ? 1 + TECH_PRODUCTION_BONUS
        : 1;
    out[key] = base * levelMult * richnessMult * techMult * damageMult;
  }
  return out;
}

/** Total food upkeep per tick for a set of unit counts. */
export function armyUpkeep(units: UnitCounts): number {
  let total = 0;
  for (const type of UNIT_LIST) {
    const count = units?.[type] ?? 0;
    if (count > 0) total += count * UNITS[type].upkeep;
  }
  return total;
}

/** Cost to recruit the given units. */
export function unitCost(units: Partial<UnitCounts>): Partial<Resources> {
  const out: Partial<Resources> = {};
  for (const type of UNIT_LIST) {
    const count = units?.[type];
    if (count === undefined || !Number.isFinite(count) || count <= 0) continue;
    const spec = UNITS[type];
    for (const key of RESOURCE_LIST) {
      const per = spec.cost[key];
      if (per === undefined) continue;
      out[key] = (out[key] ?? 0) + per * count;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Market
// ---------------------------------------------------------------------------

export function createMarket(): MarketState {
  return {
    prices: { ...MARKET_BASE_PRICES },
    pressure: zeroResources(),
  };
}

/**
 * Advance market prices one tick:
 * price = base × (1 + MARKET_TIDE_PRICE_FACTOR × tideLevel)
 *              × (1 + MARKET_PRESSURE_FACTOR × pressure), clamped to
 * [base×MARKET_MIN_PRICE_MULT, base×MARKET_MAX_PRICE_MULT].
 * Pressure decays by MARKET_PRESSURE_DECAY each tick. Mutates market.
 */
export function tickMarket(market: MarketState, tideLevel: number): void {
  const tideMult = 1 + MARKET_TIDE_PRICE_FACTOR * tideLevel;
  for (const key of RESOURCE_LIST) {
    const base = MARKET_BASE_PRICES[key];
    const pressure = market.pressure[key] ?? 0;
    const raw = base * tideMult * (1 + MARKET_PRESSURE_FACTOR * pressure);
    const min = base * MARKET_MIN_PRICE_MULT;
    const max = base * MARKET_MAX_PRICE_MULT;
    market.prices[key] = Math.min(max, Math.max(min, raw));
    market.pressure[key] = pressure * MARKET_PRESSURE_DECAY;
  }
}

export interface TradeQuote {
  /** Shells the player pays (buy) or receives (sell), fee included. */
  shells: number;
  fee: number;
  pricePerUnit: number;
}

/**
 * Quote for trading `amount` of `resource` at current prices.
 * feeRate: MARKET_FEE or MARKET_FEE_WITH_PORT, ×MARKET_FEE_OATHBREAKER_MULT
 * for oathbreakers (caller passes the final rate).
 * Buying costs price×amount×(1+fee); selling yields price×amount×(1-fee).
 */
export function tradeQuote(
  market: MarketState,
  resource: ResourceType,
  amount: number,
  side: 'buy' | 'sell',
  feeRate: number,
): TradeQuote {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new RangeError(`trade amount must be a positive integer, got ${amount}`);
  }
  const pricePerUnit = market.prices[resource];
  if (typeof pricePerUnit !== 'number' || !Number.isFinite(pricePerUnit)) {
    throw new RangeError(`no market price for resource "${resource}"`);
  }
  const gross = pricePerUnit * amount;
  const fee = roundShells(gross * feeRate);
  const shells =
    side === 'buy' ? roundShells(gross * (1 + feeRate)) : roundShells(gross * (1 - feeRate));
  return { shells, fee, pricePerUnit };
}

/** Record executed trade volume so prices react (mutates market.pressure). */
export function applyTradePressure(
  market: MarketState,
  resource: ResourceType,
  amount: number,
  side: 'buy' | 'sell',
): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new RangeError(`trade amount must be a positive integer, got ${amount}`);
  }
  const delta = side === 'buy' ? amount : -amount;
  market.pressure[resource] = (market.pressure[resource] ?? 0) + delta;
}
