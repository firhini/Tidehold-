/**
 * TIDEHOLD — single source of truth for all balance numbers.
 * Change values here, never inline in systems code.
 */
import type {
  BuildingType,
  Resources,
  ResourceType,
  TerrainType,
  UnitType,
} from './types.js';

export const GAME_NAME = 'TIDEHOLD';

// ---------------------------------------------------------------------------
// Time. One tick is the atomic unit of game time.
// Defaults tune a season to be lively and observable; production deployments
// slow this down via env (see server/src/config.ts).
// ---------------------------------------------------------------------------

export const DEFAULT_TICK_SECONDS = 20;
/** Ticks between tide rises. 9 rises end the season. */
export const DEFAULT_TIDE_INTERVAL_TICKS = 360;
/** Ticks after a season ends before the world regenerates for the next one. */
export const SEASON_REST_TICKS = 90;

export const MAX_ELEVATION = 9;
/** Tide level at which the season ends (peaks at MAX_ELEVATION survive). */
export const SEASON_END_TIDE = 8;
/** Phase thresholds by tide level. */
export const PHASE_CONFLICT_TIDE = 3;
export const PHASE_ENDGAME_TIDE = 6;

export const DEFAULT_WORLD_RADIUS = 26;
export const DEFAULT_WORLD_SEED = 421_337;

// ---------------------------------------------------------------------------
// Player start
// ---------------------------------------------------------------------------

export const STARTING_RESOURCES: Resources = {
  timber: 140,
  ore: 110,
  food: 160,
  relics: 0,
};

export const STARTING_REPUTATION = 100;
export const MAX_REPUTATION = 200;
export const OATHBREAKER_THRESHOLD = 60;

// ---------------------------------------------------------------------------
// The Ark
// ---------------------------------------------------------------------------

/** Build radius around the Ark, per Ark level. Index by level-1. */
export const ARK_INFLUENCE_RADIUS = [4, 5, 6] as const;
export const ARK_MAX_LEVEL = 3;
export const ARK_BASE_HP = 100;
export const ARK_HP_PER_LEVEL = 60;
/** Ticks between Ark moves. */
export const ARK_MOVE_COOLDOWN_TICKS = 12;
/** Max hexes per Ark move. */
export const ARK_MOVE_RANGE = 4;
/** Food cost per hex moved. */
export const ARK_MOVE_FOOD_PER_HEX = 8;
/** Upgrade costs to reach level 2 and 3. */
export const ARK_UPGRADE_COSTS: Partial<Resources>[] = [
  { timber: 300, ore: 200, relics: 2 },
  { timber: 700, ore: 500, relics: 6 },
];
/** Fraction of stored resources lost when the Ark falls in battle. */
export const ARK_PLUNDER_FRACTION = 0.3;
/** Ticks of production penalty after the Ark is breached. */
export const ARK_DAMAGE_TICKS = 90;
export const ARK_DAMAGE_PRODUCTION_PENALTY = 0.5;

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

export const MAX_BUILDING_LEVEL = 3;

export interface BuildingSpec {
  name: string;
  description: string;
  /** Terrain the building may occupy. */
  terrain: TerrainType[];
  cost: Partial<Resources>;
  /** Base production per tick at level 1, richness 1. */
  production: Partial<Resources>;
}

export const BUILDINGS: Record<BuildingType, BuildingSpec> = {
  lumber_camp: {
    name: 'Lumber Camp',
    description: 'Fells the old-growth forests for timber.',
    terrain: ['forest'],
    cost: { timber: 40, food: 20 },
    production: { timber: 2 },
  },
  mine: {
    name: 'Mine',
    description: 'Digs ore from the high country before it drowns.',
    terrain: ['hills', 'mountains'],
    cost: { timber: 60, food: 30 },
    production: { ore: 2 },
  },
  farm: {
    name: 'Farm',
    description: 'Feeds your people and your armies.',
    terrain: ['plains', 'coast'],
    cost: { timber: 30, ore: 10 },
    production: { food: 3 },
  },
  port: {
    name: 'Port',
    // Placement rule is special-cased: any land tile ADJACENT TO WATER
    // (see server actions.build / client TilePanel) — the shoreline climbs
    // as the world drowns, so ports follow it. `terrain` here is advisory.
    description: 'Launches expeditions and halves market fees. Needs water at its doorstep.',
    terrain: ['coast', 'plains', 'forest', 'hills', 'mountains', 'peak'],
    cost: { timber: 120, ore: 60 },
    production: {},
  },
  watchtower: {
    name: 'Watchtower',
    description: 'Defensive bastion. Bolsters this tile and its neighbors.',
    terrain: ['coast', 'plains', 'forest', 'hills', 'mountains', 'peak'],
    cost: { timber: 80, ore: 80 },
    production: {},
  },
  shrine: {
    name: 'Shrine of the Deep',
    description: 'Banks relics as legacy — the measure of victory.',
    terrain: ['coast', 'plains', 'forest', 'hills', 'mountains', 'peak'],
    cost: { timber: 100, ore: 100, food: 50 },
    production: {},
  },
};

/** Cost multiplier per building level (level 2 = ×, level 3 = ×²). */
export const BUILDING_LEVEL_COST_MULT = 2.2;
/** Production multiplier per building level. */
export const BUILDING_LEVEL_PROD_MULT = 1.6;
/** Production multiplier per richness class (index richness-1). */
export const RICHNESS_MULT = [1, 1.5, 2.25] as const;
/** Watchtower defense bonus per level, applied on tile and neighbors. */
export const WATCHTOWER_DEFENSE_BONUS = 0.15;
/** Score banked per relic offered at a shrine, per shrine level. */
export const SHRINE_SCORE_PER_RELIC = [10, 12, 15] as const;

/** Cost to claim an unowned land tile (flat). */
export const CLAIM_TILE_COST: Partial<Resources> = { timber: 15, food: 10 };
/** Maximum tiles a single player may own. */
export const MAX_TILES_PER_PLAYER = 40;

// ---------------------------------------------------------------------------
// Units & combat
// ---------------------------------------------------------------------------

export interface UnitSpec {
  name: string;
  attack: number;
  defense: number;
  cost: Partial<Resources>;
  /** Food per tick. */
  upkeep: number;
}

export const UNITS: Record<UnitType, UnitSpec> = {
  shields: {
    name: 'Shieldbearers',
    attack: 2,
    defense: 6,
    cost: { ore: 12, food: 8 },
    upkeep: 0.04,
  },
  blades: {
    name: 'Bladesworn',
    attack: 6,
    defense: 2,
    cost: { timber: 6, ore: 10, food: 8 },
    upkeep: 0.05,
  },
  bows: {
    name: 'Tidebows',
    attack: 4,
    defense: 3,
    cost: { timber: 16, food: 8 },
    upkeep: 0.04,
  },
};

/** blades > bows > shields > blades. Damage multiplier for the favored side. */
export const COUNTER_BONUS = 1.5;

/** Terrain combat modifiers applied to the DEFENDER's effective strength. */
export const TERRAIN_DEFENSE_MOD: Partial<Record<TerrainType, number>> = {
  hills: 0.2,
  mountains: 0.35,
  peak: 0.5,
  forest: 0.15,
  ruins: 0.1,
};

/** Ticks between an attack order and battle resolution (the preparation window). */
export const BATTLE_PREP_TICKS = 3;
/** Army movement: ticks per hex over land. */
export const MOVE_TICKS_LAND = 2;
/** Ticks per hex over water (flotilla crossing). */
export const MOVE_TICKS_WATER = 4;
/** Max units in a single army. */
export const MAX_ARMY_SIZE = 200;
/** Fraction of the loser's remaining stockpile looted when a tile/ark falls. */
export const BATTLE_LOOT_FRACTION = 0.2;
/** Chance an assigned commander is captured when their side loses. */
export const COMMANDER_CAPTURE_CHANCE = 0.5;

/** Commander trait bonuses. */
export const COMMANDER_ATTACK_BONUS = 0.12; // aggression, per level
export const COMMANDER_DEFENSE_BONUS = 0.12; // bulwark, per level
export const COMMANDER_SPEED_BONUS = 0.25; // logistics: flat move-time reduction

// ---------------------------------------------------------------------------
// Reputation deltas
// ---------------------------------------------------------------------------

export const REP_BREAK_CONTRACT = -30;
export const REP_ATTACK_ALLY = -40;
export const REP_UNPROVOKED_ATTACK = -5;
export const REP_PUNISH_OATHBREAKER = +5;
export const REP_COMPLETE_CONTRACT = +5;
export const REP_TRADE_TICK = +1;
export const REP_REGEN_PER_100_TICKS = +1;

// ---------------------------------------------------------------------------
// Market
// ---------------------------------------------------------------------------

export const MARKET_BASE_PRICES: Record<ResourceType, number> = {
  timber: 1.0,
  ore: 1.5,
  food: 0.8,
  relics: 25,
};
/** Price growth per tide level — scarcity as the world drowns. */
export const MARKET_TIDE_PRICE_FACTOR = 0.1;
/** Price impact per unit of net buy/sell pressure. */
export const MARKET_PRESSURE_FACTOR = 0.0004;
/** Pressure decays toward 0 by this factor each tick. */
export const MARKET_PRESSURE_DECAY = 0.98;
export const MARKET_FEE = 0.15;
export const MARKET_FEE_WITH_PORT = 0.08;
export const MARKET_FEE_OATHBREAKER_MULT = 2;
/** Hard bounds so prices never collapse or explode. */
export const MARKET_MIN_PRICE_MULT = 0.4;
export const MARKET_MAX_PRICE_MULT = 8;
/** Players trade against the exchange with shells (implicit currency held as balance). */
export const STARTING_SHELLS = 100;

// ---------------------------------------------------------------------------
// Expeditions
// ---------------------------------------------------------------------------

export const EXPEDITION_BASE_TICKS = 4;
export const EXPEDITION_TICKS_PER_HEX = 1;
/** Max distance from Ark (or any owned port) an expedition can target. */
export const EXPEDITION_RANGE = 10;
export const EXPEDITION_COST: Partial<Resources> = { food: 30, timber: 10 };
/** Relic yield ranges by ruin tier (index tier-1): [min, max]. */
export const EXPEDITION_RELICS_BY_TIER: [number, number][] = [
  [1, 2],
  [2, 4],
  [4, 7],
];
/** Chance an expedition discovers a permanent tech boon, by ruin tier. */
export const EXPEDITION_TECH_CHANCE = [0.08, 0.15, 0.3] as const;

/** Permanent boons discoverable through exploration. */
export const TECHS: Record<string, { name: string; description: string }> = {
  deep_saws: { name: 'Deep Saws', description: '+25% timber production.' },
  fire_hardening: { name: 'Fire Hardening', description: '+25% ore production.' },
  tide_terraces: { name: 'Tide Terraces', description: '+25% food production.' },
  star_charts: { name: 'Star Charts', description: 'Expeditions travel 30% faster.' },
  drowned_tongue: { name: 'The Drowned Tongue', description: '+1 relic from every expedition.' },
  hull_lore: { name: 'Hull Lore', description: 'Ark moves cost half the food.' },
};

/** Production tech multiplier. */
export const TECH_PRODUCTION_BONUS = 0.25;

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export const CONTRACT_MIN_DURATION_TICKS = 60;
export const CONTRACT_MAX_DURATION_TICKS = 4000;
export const CONTRACT_PROPOSAL_TTL_TICKS = 120;

// ---------------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------------

export const SCORE_BATTLE_WON = 15;
export const SCORE_RUIN_CLEARED = 10;
export const SCORE_CONTRACT_COMPLETED = 8;
export const SCORE_TILE_SURVIVES_TIDE = 2;
export const SCORE_EXPEDITION = 3;

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const PASSWORD_MIN = 8;
/** How many event-log entries the API returns at most. */
export const EVENT_LOG_LIMIT = 100;

export const RESOURCE_LIST: ResourceType[] = ['timber', 'ore', 'food', 'relics'];
export const UNIT_LIST: UnitType[] = ['shields', 'blades', 'bows'];
export const BUILDING_LIST: BuildingType[] = [
  'lumber_camp',
  'mine',
  'farm',
  'port',
  'watchtower',
  'shrine',
];
