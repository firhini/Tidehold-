/**
 * TIDEHOLD — canonical game data model.
 * Every system (server, client, tests) builds against these types.
 * All game logic that consumes them must be pure and deterministic.
 */

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Axial hex coordinates (pointy-top). */
export interface AxialCoord {
  q: number;
  r: number;
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export type TerrainType =
  | 'ocean' // permanently underwater (elevation 0 or long-flooded)
  | 'drowned' // recently flooded land; explorable ruins beneath the surface
  | 'coast' // low shoreline, buildable, allows ports
  | 'plains'
  | 'forest'
  | 'hills'
  | 'mountains'
  | 'peak' // highest ground; endgame refuges
  | 'ruins'; // remnants of the old world, guarded, explorable

export type BuildingType =
  | 'lumber_camp' // forest: produces timber
  | 'mine' // hills/mountains: produces ore
  | 'farm' // plains/coast: produces food
  | 'port' // coast: launches expeditions, cuts market fees
  | 'watchtower' // any land: defense bonus on tile + neighbors
  | 'shrine'; // any land: banks relics into score (the win condition)

export interface Tile {
  q: number;
  r: number;
  /** 0..MAX_ELEVATION. Floods when tideLevel >= elevation (elevation 0 = original ocean). */
  elevation: number;
  terrain: TerrainType;
  /** True once the Tide has claimed this tile. */
  flooded: boolean;
  /** 1..3 multiplier class for production richness. */
  richness: number;
  /** Loot quality for ruins/drowned tiles (1..3). */
  ruinTier?: number;
  /** Strength of the neutral remnant garrison guarding a ruin. */
  garrison?: number;
  building?: {
    type: BuildingType;
    level: number; // 1..3
    ownerId: string;
    /** Tick until which the building is disabled by battle damage. */
    disabledUntilTick?: number;
  };
  ownerId?: string;
}

export type SeasonPhase = 'expansion' | 'conflict' | 'endgame' | 'ended';

export interface WorldMeta {
  seed: number;
  radius: number;
  tick: number;
  tideLevel: number;
  nextTideTick: number;
  phase: SeasonPhase;
  /** Season number, increments when a world ends and regenerates. */
  season: number;
}

// ---------------------------------------------------------------------------
// Resources & economy
// ---------------------------------------------------------------------------

export type ResourceType = 'timber' | 'ore' | 'food' | 'relics';

export type Resources = Record<ResourceType, number>;

export interface MarketState {
  /** Current unit price of each resource, in gold-standard "shells". */
  prices: Record<ResourceType, number>;
  /** Rolling net volume (positive = players bought from market) used for price drift. */
  pressure: Record<ResourceType, number>;
}

// ---------------------------------------------------------------------------
// Players & the Ark
// ---------------------------------------------------------------------------

export interface Ark {
  q: number;
  r: number;
  /** Ark level: raises influence radius, cargo protection and HP. */
  level: number;
  hp: number;
  maxHp: number;
  /** Tick at which the Ark may move again. */
  moveReadyTick: number;
  /** Tick until which Ark systems are damaged (production penalty). */
  damagedUntilTick: number;
}

export type CommanderTrait = 'aggression' | 'bulwark' | 'logistics';

export interface Commander {
  id: string;
  name: string;
  trait: CommanderTrait;
  level: number; // 1..5
  status: 'ready' | 'assigned' | 'captured';
  /** Player currently holding this commander captive. */
  capturedById?: string;
}

export interface PlayerState {
  id: string;
  username: string;
  ark: Ark;
  resources: Resources;
  /** 0..200, starts at 100. Below OATHBREAKER_THRESHOLD → oathbreaker. */
  reputation: number;
  score: number;
  /** Permanent boons discovered through expeditions. */
  techs: string[];
  commanders: Commander[];
  createdTick: number;
  lastSeenTick: number;
  defeated: boolean;
}

// ---------------------------------------------------------------------------
// Armies & combat
// ---------------------------------------------------------------------------

/** Counter triangle: blades > bows > shields > blades. */
export type UnitType = 'shields' | 'blades' | 'bows';

export type UnitCounts = Record<UnitType, number>;

export interface Army {
  id: string;
  ownerId: string;
  q: number;
  r: number;
  units: UnitCounts;
  commanderId?: string;
  /** Remaining path (excluding current position); empty = holding. */
  path: AxialCoord[];
  /** Tick at which the army steps onto path[0]. */
  nextMoveTick: number;
  /** Set while this army is committed to a pending battle. */
  battleId?: string;
}

export interface Battle {
  id: string;
  attackerArmyId: string;
  attackerId: string;
  /** Defending player, or undefined for neutral garrisons. */
  defenderId?: string;
  target: AxialCoord;
  createdTick: number;
  /** Battles resolve after a preparation window — strategy, not click speed. */
  resolveTick: number;
}

export interface BattleSideReport {
  playerId?: string;
  before: UnitCounts;
  losses: UnitCounts;
  effectiveStrength: number;
}

export interface BattleReport {
  battleId: string;
  tick: number;
  target: AxialCoord;
  winner: 'attacker' | 'defender';
  attacker: BattleSideReport;
  defender: BattleSideReport;
  garrisonBefore?: number;
  loot: Partial<Resources>;
  capturedCommanderId?: string;
  /** One-paragraph human-readable account for the event log. */
  narrative: string;
}

// ---------------------------------------------------------------------------
// Expeditions & exploration
// ---------------------------------------------------------------------------

export interface Expedition {
  id: string;
  ownerId: string;
  target: AxialCoord;
  departTick: number;
  resolveTick: number;
}

export interface ExpeditionOutcome {
  loot: Partial<Resources>;
  /** Permanent tech boon id, if one was discovered. */
  tech?: string;
  /** Human-readable story beat for the event log. */
  story: string;
  scoreGained: number;
}

// ---------------------------------------------------------------------------
// The Ledger — contracts, reputation, diplomacy
// ---------------------------------------------------------------------------

export type ContractType =
  | 'alliance' // mutual defense; attacking = major betrayal
  | 'non_aggression' // no attacks between parties
  | 'trade' // recurring resource exchange each interval
  | 'tribute' // one-way protection payment
  | 'ransom'; // one-time payment to release a captured commander

export type ContractStatus =
  | 'proposed'
  | 'active'
  | 'completed'
  | 'declined'
  | 'broken'
  | 'expired';

export interface ContractTerms {
  /** Resources the proposer gives each interval (or once). */
  give: Partial<Resources>;
  /** Resources the proposer receives each interval (or once). */
  receive: Partial<Resources>;
  /** For recurring contracts: interval in ticks. Absent = one-time. */
  intervalTicks?: number;
  /** For ransom: the commander to be released. */
  commanderId?: string;
  note?: string;
}

export interface Contract {
  id: string;
  type: ContractType;
  fromId: string;
  toId: string;
  status: ContractStatus;
  terms: ContractTerms;
  createdTick: number;
  /** Tick when the contract lapses naturally. */
  expiresTick: number;
  /** Next tick a recurring exchange is due. */
  nextDueTick?: number;
}

// ---------------------------------------------------------------------------
// Events (public log / private notifications)
// ---------------------------------------------------------------------------

export type GameEventType =
  | 'tide'
  | 'battle'
  | 'build'
  | 'expedition'
  | 'contract'
  | 'market'
  | 'ark'
  | 'season'
  | 'player';

export interface GameEvent {
  id: number;
  tick: number;
  type: GameEventType;
  message: string;
  actorId?: string;
  targetId?: string;
  q?: number;
  r?: number;
  /** Public events appear in the world chronicle; private only to actor/target. */
  isPublic: boolean;
}

// ---------------------------------------------------------------------------
// Client-facing snapshots (what the server sends over the wire)
// ---------------------------------------------------------------------------

export interface PublicPlayerInfo {
  id: string;
  username: string;
  score: number;
  reputation: number;
  isOathbreaker: boolean;
  defeated: boolean;
  ark: { q: number; r: number; level: number };
  tilesOwned: number;
}

export interface WorldSnapshot {
  meta: WorldMeta;
  tiles: Tile[];
  players: PublicPlayerInfo[];
  armies: Army[]; // own armies full detail; enemy armies visible per scouting rules
  battles: Battle[];
  market: MarketState;
}
