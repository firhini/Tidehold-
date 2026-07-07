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

/** Empty resource bag. */
export function zeroResources(): Resources {
  return { timber: 0, ore: 0, food: 0, relics: 0 };
}

/** a + b (b partial). Returns new object. */
export function addResources(a: Resources, b: Partial<Resources>): Resources {
  throw new Error('unimplemented');
}

/** a - b (b partial). Returns new object; may go negative (caller checks canAfford). */
export function subResources(a: Resources, b: Partial<Resources>): Resources {
  throw new Error('unimplemented');
}

export function canAfford(have: Resources, cost: Partial<Resources>): boolean {
  throw new Error('unimplemented');
}

/** Scale a partial resource bag by k, flooring each entry. */
export function scaleResources(bag: Partial<Resources>, k: number): Partial<Resources> {
  throw new Error('unimplemented');
}

/**
 * Cost to construct `type` at `level` (level 1 = base cost, each further level
 * multiplies by BUILDING_LEVEL_COST_MULT, rounded up per resource).
 */
export function buildingCost(type: BuildingType, level: number): Partial<Resources> {
  throw new Error('unimplemented');
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
  throw new Error('unimplemented');
}

/** Total food upkeep per tick for a set of unit counts. */
export function armyUpkeep(units: UnitCounts): number {
  throw new Error('unimplemented');
}

/** Cost to recruit the given units. */
export function unitCost(units: Partial<UnitCounts>): Partial<Resources> {
  throw new Error('unimplemented');
}

// ---------------------------------------------------------------------------
// Market
// ---------------------------------------------------------------------------

export function createMarket(): MarketState {
  throw new Error('unimplemented');
}

/**
 * Advance market prices one tick:
 * price = base × (1 + MARKET_TIDE_PRICE_FACTOR × tideLevel)
 *              × (1 + MARKET_PRESSURE_FACTOR × pressure), clamped to
 * [base×MARKET_MIN_PRICE_MULT, base×MARKET_MAX_PRICE_MULT].
 * Pressure decays by MARKET_PRESSURE_DECAY each tick. Mutates market.
 */
export function tickMarket(market: MarketState, tideLevel: number): void {
  throw new Error('unimplemented');
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
  throw new Error('unimplemented');
}

/** Record executed trade volume so prices react (mutates market.pressure). */
export function applyTradePressure(
  market: MarketState,
  resource: ResourceType,
  amount: number,
  side: 'buy' | 'sell',
): void {
  throw new Error('unimplemented');
}
