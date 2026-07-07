/**
 * The solo engine — the entire game running in the browser, no server.
 * It reuses the pure, deterministic shared logic (worldgen, tide, economy,
 * combat, expeditions) and adds: AI rival Arks, a run lifecycle, scoring,
 * and win/lose. All randomness flows through a seeded RNG so a seed fully
 * reproduces a run's world and events.
 */
import {
  addResources,
  applyTide,
  ARK_BASE_HP,
  ARK_DAMAGE_TICKS,
  ARK_HP_PER_LEVEL,
  ARK_INFLUENCE_RADIUS,
  ARK_MOVE_COOLDOWN_TICKS,
  ARK_MOVE_FOOD_PER_HEX,
  ARK_MOVE_RANGE,
  ARK_PLUNDER_FRACTION,
  ARK_UPGRADE_COSTS,
  ARK_MAX_LEVEL,
  armyUpkeep,
  BATTLE_LOOT_FRACTION,
  BATTLE_PREP_TICKS,
  BUILDINGS,
  buildingCost,
  canAfford,
  CLAIM_TILE_COST,
  generateWorld,
  GARRISON_BY_TIER,
  hash2,
  hexDistance,
  hexKey,
  hexNeighbors,
  hexPath,
  MAX_ARMY_SIZE,
  MAX_BUILDING_LEVEL,
  MAX_TILES_PER_PLAYER,
  MOVE_TICKS_LAND,
  MOVE_TICKS_WATER,
  phaseForTide,
  resolveBattle,
  resolveExpedition,
  rng,
  scaleResources,
  SCORE_BATTLE_WON,
  SCORE_RUIN_CLEARED,
  SCORE_TILE_SURVIVES_TIDE,
  SHRINE_SCORE_PER_RELIC,
  subResources,
  tileProduction,
  totalUnits,
  expeditionDuration,
  EXPEDITION_COST,
  EXPEDITION_RANGE,
  type Army,
  type Battle,
  type Commander,
  type Expedition,
  type PlayerState,
  type Tile,
  type UnitCounts,
  type WorldMeta,
} from '@tidehold/shared';
import {
  COMMANDERS,
  CONTINUE_ARK_HP,
  FIRST_CLAIM_SALVAGE_RELICS,
  HOLD_TIDE_TICKS,
  SALVAGE_PER_100_SCORE,
  SALVAGE_PER_TIDE_LEVEL,
  SCORE_PLACEMENT_BONUS,
  SCORE_PER_TIDE_LEVEL,
  SCORE_SURVIVAL_PER_TICK,
  SOLO_AI_COUNT,
  SOLO_FIRST_TIDE_TICK,
  SOLO_SEASON_END_TIDE,
  SOLO_START_RESOURCES,
  SOLO_START_SHELLS,
  SOLO_TIDE_INTERVAL,
  SOLO_WORLD_RADIUS,
  UPGRADES,
  type UpgradeSpec,
} from './config.js';
import { runAi, type AiMemory } from './ai.js';
import type { MetaState, OutcomeReason, RunStats } from './types.js';

export interface EngineEvent {
  id: number;
  tick: number;
  kind: 'tide' | 'battle' | 'build' | 'expedition' | 'ark' | 'reward' | 'info' | 'season';
  message: string;
  q?: number;
  r?: number;
  /** Highlights that matter to the player get toasted. */
  toast?: 'info' | 'success' | 'error';
}

export interface EngineState {
  meta: WorldMeta;
  tiles: Tile[];
  tileMap: Map<string, Tile>;
  players: Map<string, PlayerState>;
  armies: Map<string, Army>;
  battles: Map<string, Battle>;
  expeditions: Map<string, Expedition>;
  humanId: string;
  aiIds: string[];
  aiMemory: Map<string, AiMemory>;
  entityCounter: number;
  events: EngineEvent[];
  eventCounter: number;
  /** Run bookkeeping. */
  battlesWon: number;
  ruinsCleared: number;
  expeditionsDone: number;
  relicsBanked: number;
  survivedTicks: number;
  outcome: OutcomeReason | null;
  ended: boolean;
  /** First-run teaching state. */
  startTile: { q: number; r: number } | null;
  firstClaimRewarded: boolean;
}

const AI_NAMES = ['The Kestrel Clan', 'Deepmarch', 'The Salt Kings', 'Vareth Hold', 'The Grey Sails'];

export class ActionError extends Error {}
function fail(msg: string): never {
  throw new ActionError(msg);
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

function makeArkPlayer(
  id: string,
  username: string,
  spawn: Tile,
  tick: number,
  hpBonus: number,
  commanders: Commander[],
): PlayerState {
  const maxHp = ARK_BASE_HP + ARK_HP_PER_LEVEL + hpBonus;
  return {
    id,
    username,
    ark: { q: spawn.q, r: spawn.r, level: 1, hp: maxHp, maxHp, moveReadyTick: 0, damagedUntilTick: 0 },
    resources: { ...SOLO_START_RESOURCES },
    shells: SOLO_START_SHELLS,
    reputation: 100,
    score: 0,
    techs: [],
    commanders,
    createdTick: tick,
    lastSeenTick: tick,
    defeated: false,
  };
}

function pickSpawns(tiles: Tile[], count: number, seed: number): Tile[] {
  const r = rng(seed);
  const land = tiles.filter((t) => !t.flooded && t.elevation >= 3 && t.elevation <= 6 && t.terrain !== 'ruins');
  const chosen: Tile[] = [];
  let attempts = 0;
  while (chosen.length < count && attempts < 5000 && land.length > 0) {
    attempts++;
    const cand = land[r.int(0, land.length - 1)];
    if (chosen.every((c) => hexDistance(c, cand) >= 6)) chosen.push(cand);
  }
  // Relax if the map is tight.
  while (chosen.length < count && land.length > 0) {
    const cand = land[r.int(0, land.length - 1)];
    if (!chosen.includes(cand)) chosen.push(cand);
  }
  return chosen;
}

function commanderFor(specId: string, level = 1): Commander {
  const spec = COMMANDERS.find((c) => c.id === specId) ?? COMMANDERS[0];
  return { id: `cmd-${specId}-${Math.round(level)}`, name: spec.name, trait: spec.trait, level, status: 'ready' };
}

/** Build a fresh run from a seed and the player's meta upgrades. */
export function createRun(seed: number, meta: MetaState): EngineState {
  const tiles = generateWorld(seed, SOLO_WORLD_RADIUS);
  const tileMap = new Map(tiles.map((t) => [hexKey(t.q, t.r), t]));
  const worldMeta: WorldMeta = {
    seed,
    radius: SOLO_WORLD_RADIUS,
    tick: 0,
    tideLevel: 0,
    nextTideTick: SOLO_FIRST_TIDE_TICK,
    phase: 'expansion',
    season: 1,
    tickSeconds: 1,
    tideIntervalTicks: SOLO_TIDE_INTERVAL,
  };

  const upgrades = new Set(meta.upgrades);
  const hpBonus = upgrades.has('hull') ? 60 : 0;
  const spawns = pickSpawns(tiles, 1 + SOLO_AI_COUNT, seed ^ 0x1234);

  const players = new Map<string, PlayerState>();
  const humanId = 'you';
  const playerCommander = commanderFor(meta.selectedCommander, 1);
  const human = makeArkPlayer(humanId, 'Your Ark', spawns[0] ?? tiles[0], 0, hpBonus, [
    playerCommander,
    commanderFor('maren', 1),
  ]);
  players.set(humanId, human);

  const aiIds: string[] = [];
  const aiMemory = new Map<string, AiMemory>();
  const aiRng = rng(seed ^ 0x9e37);
  for (let i = 0; i < SOLO_AI_COUNT; i++) {
    const id = `ai${i}`;
    aiIds.push(id);
    const spawn = spawns[i + 1] ?? tiles[i + 1] ?? tiles[0];
    const trait = COMMANDERS[aiRng.int(0, COMMANDERS.length - 1)].id;
    players.set(id, makeArkPlayer(id, AI_NAMES[i % AI_NAMES.length], spawn, 0, aiRng.int(0, 40), [commanderFor(trait, 1)]));
    aiMemory.set(id, { lastBuildTick: -999, lastMoveTick: -999, aggressionSeed: aiRng.int(1, 1_000_000) });
  }

  const state: EngineState = {
    meta: worldMeta,
    tiles,
    tileMap,
    players,
    armies: new Map(),
    battles: new Map(),
    expeditions: new Map(),
    humanId,
    aiIds,
    aiMemory,
    entityCounter: 1,
    events: [],
    eventCounter: 1,
    battlesWon: 0,
    ruinsCleared: 0,
    expeditionsDone: 0,
    relicsBanked: 0,
    survivedTicks: 0,
    outcome: null,
    ended: false,
    startTile: null,
    firstClaimRewarded: false,
  };

  applyStartUpgrades(state, human, meta);
  // Pick a glowing start tile next to the player's Ark for the cold open.
  state.startTile = pickStartTile(state, human);
  return state;
}

function applyStartUpgrades(state: EngineState, human: PlayerState, meta: MetaState): void {
  const owned = new Set(meta.upgrades);
  const specs = UPGRADES.filter((u) => owned.has(u.id));
  for (const spec of specs) applyUpgrade(state, human, spec);
}

function applyUpgrade(state: EngineState, human: PlayerState, spec: UpgradeSpec): void {
  const e = spec.effect;
  if (e.kind === 'resources') {
    human.resources = addResources(human.resources, e.add);
  } else if (e.kind === 'arkHp') {
    human.ark.maxHp += e.add;
    human.ark.hp = human.ark.maxHp;
  } else if (e.kind === 'tech') {
    if (!human.techs.includes(e.tech)) human.techs.push(e.tech);
  } else if (e.kind === 'startArmy') {
    const army: Army = {
      id: newId(state),
      ownerId: human.id,
      q: human.ark.q,
      r: human.ark.r,
      units: { shields: 0, blades: e.blades, bows: 0 },
      path: [],
      nextMoveTick: 0,
      commanderId: human.commanders[0]?.id,
    };
    if (human.commanders[0]) human.commanders[0].status = 'assigned';
    state.armies.set(army.id, army);
  } else if (e.kind === 'startBuildings') {
    // Placed post-tilemap: find two suitable adjacent tiles.
    const near = hexNeighbors(human.ark)
      .map((c) => tileAt(state, c.q, c.r))
      .filter((t): t is Tile => !!t && !t.flooded && !t.ownerId);
    const farm = near.find((t) => BUILDINGS.farm.terrain.includes(t.terrain));
    if (farm) {
      farm.ownerId = human.id;
      farm.building = { type: 'farm', level: 1, ownerId: human.id };
    }
    const lumber = near.find((t) => t !== farm && BUILDINGS.lumber_camp.terrain.includes(t.terrain));
    if (lumber) {
      lumber.ownerId = human.id;
      lumber.building = { type: 'lumber_camp', level: 1, ownerId: human.id };
    }
  } else if (e.kind === 'arkSpeed') {
    // Applied at move time via moveArk cooldown reduction lookup.
  }
}

function pickStartTile(state: EngineState, human: PlayerState): { q: number; r: number } | null {
  const radius = ARK_INFLUENCE_RADIUS[0];
  const candidates = state.tiles.filter(
    (t) =>
      !t.flooded &&
      !t.ownerId &&
      !t.building &&
      t.terrain !== 'ruins' &&
      t.terrain !== 'ocean' &&
      t.terrain !== 'drowned' &&
      hexDistance(human.ark, t) <= radius &&
      hexDistance(human.ark, t) >= 1,
  );
  if (candidates.length === 0) return null;
  // Prefer a productive, safely-high tile so the first build feels good.
  candidates.sort((a, b) => b.elevation + b.richness - (a.elevation + a.richness));
  const t = candidates[0];
  return { q: t.q, r: t.r };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function tileAt(state: EngineState, q: number, r: number): Tile | undefined {
  return state.tileMap.get(hexKey(q, r));
}
function newId(state: EngineState): string {
  state.entityCounter++;
  return `e${state.entityCounter}`;
}
function nextSeed(state: EngineState): number {
  state.entityCounter++;
  return hash2(state.entityCounter, state.meta.tick, state.meta.seed);
}
function armiesAt(state: EngineState, q: number, r: number): Army[] {
  const out: Army[] = [];
  for (const a of state.armies.values()) if (a.q === q && a.r === r) out.push(a);
  return out;
}
export function ownedTileCount(state: EngineState, playerId: string): number {
  let n = 0;
  for (const t of state.tiles) if (t.ownerId === playerId) n++;
  return n;
}
function emitEvent(state: EngineState, ev: Omit<EngineEvent, 'id' | 'tick'>): void {
  state.events.push({ ...ev, id: state.eventCounter++, tick: state.meta.tick });
  if (state.events.length > 120) state.events.splice(0, state.events.length - 120);
}
export function isLand(tile: Tile): boolean {
  return !tile.flooded && tile.terrain !== 'ocean' && tile.terrain !== 'drowned';
}
function withinInfluence(player: PlayerState, tile: Tile): boolean {
  return hexDistance(player.ark, tile) <= ARK_INFLUENCE_RADIUS[player.ark.level - 1];
}
export function human(state: EngineState): PlayerState {
  return state.players.get(state.humanId)!;
}

// ---------------------------------------------------------------------------
// Player intents (also used by AI via the same rules)
// ---------------------------------------------------------------------------

export function claimTile(state: EngineState, player: PlayerState, q: number, r: number): void {
  const tile = tileAt(state, q, r);
  if (!tile) fail('Beyond the edge of the world.');
  if (!isLand(tile)) fail('The sea holds that ground now.');
  if (tile.terrain === 'ruins') fail('The remnants hold those ruins.');
  if (tile.ownerId === player.id) fail('You already hold this land.');
  if (tile.ownerId) fail('Another banner flies here.');
  if (!withinInfluence(player, tile)) fail('Too far from your Ark.');
  if (ownedTileCount(state, player.id) >= MAX_TILES_PER_PLAYER) fail('Your people are stretched thin.');
  if (!canAfford(player.resources, CLAIM_TILE_COST)) fail('Not enough resources to settle.');
  player.resources = subResources(player.resources, CLAIM_TILE_COST);
  tile.ownerId = player.id;

  // Guaranteed first reward — teach that claiming pays.
  if (player.id === state.humanId && !state.firstClaimRewarded) {
    state.firstClaimRewarded = true;
    player.resources = addResources(player.resources, { relics: FIRST_CLAIM_SALVAGE_RELICS });
    emitEvent(state, {
      kind: 'reward',
      message: `Salvage in the old ruins beneath your new claim — +${FIRST_CLAIM_SALVAGE_RELICS} relics.`,
      q,
      r,
      toast: 'success',
    });
  }
}

export function build(state: EngineState, player: PlayerState, q: number, r: number, type: string): void {
  const tile = tileAt(state, q, r);
  if (!tile) fail('Beyond the edge of the world.');
  if (!(type in BUILDINGS)) fail('Unknown building.');
  const bt = type as keyof typeof BUILDINGS;
  const spec = BUILDINGS[bt];
  if (tile.ownerId !== player.id) fail('Claim this land first.');
  if (tile.building) fail('Already built.');
  if (bt === 'port') {
    const touchesWater = hexNeighbors(tile).some((nb) => {
      const t = tileAt(state, nb.q, nb.r);
      return !t || t.flooded || t.terrain === 'ocean' || t.terrain === 'drowned';
    });
    if (!touchesWater) fail('A port needs water at its doorstep.');
  } else if (!spec.terrain.includes(tile.terrain)) {
    fail(`Needs: ${spec.terrain.join(', ')}.`);
  }
  const cost = buildingCost(bt, 1);
  if (!canAfford(player.resources, cost)) fail(`Not enough for a ${spec.name}.`);
  player.resources = subResources(player.resources, cost);
  tile.building = { type: bt, level: 1, ownerId: player.id };
  if (player.id === state.humanId) {
    emitEvent(state, { kind: 'build', message: `You raised a ${spec.name}.`, q, r });
  }
}

export function upgradeBuilding(state: EngineState, player: PlayerState, q: number, r: number): void {
  const tile = tileAt(state, q, r);
  if (!tile?.building || tile.building.ownerId !== player.id) fail('No building of yours here.');
  if (tile.building.level >= MAX_BUILDING_LEVEL) fail('Already at its finest.');
  const cost = buildingCost(tile.building.type, tile.building.level + 1);
  if (!canAfford(player.resources, cost)) fail('Not enough resources.');
  player.resources = subResources(player.resources, cost);
  tile.building.level++;
}

export function moveArk(state: EngineState, player: PlayerState, q: number, r: number, meta?: MetaState): void {
  const tile = tileAt(state, q, r);
  if (!tile) fail('Beyond the edge of the world.');
  if (!isLand(tile)) fail('The Ark must anchor on standing land.');
  if (tile.terrain === 'ruins') fail('The remnants will not share their ruins.');
  const dist = hexDistance(player.ark, tile);
  if (dist === 0) fail('The Ark is already here.');
  if (dist > ARK_MOVE_RANGE) fail(`At most ${ARK_MOVE_RANGE} hexes per move.`);
  if (player.ark.moveReadyTick > state.meta.tick) fail("The Ark's engines are not ready.");
  for (const other of state.players.values()) {
    if (other.id !== player.id && !other.defeated && other.ark.q === tile.q && other.ark.r === tile.r) {
      fail('Another Ark anchors there.');
    }
  }
  let foodPerHex = ARK_MOVE_FOOD_PER_HEX;
  if (player.techs.includes('hull_lore')) foodPerHex = Math.ceil(foodPerHex / 2);
  const cost = { food: foodPerHex * dist };
  if (!canAfford(player.resources, cost)) fail(`Moving that far needs ${cost.food} food.`);
  player.resources = subResources(player.resources, cost);
  player.ark.q = tile.q;
  player.ark.r = tile.r;
  const owned = meta ? new Set(meta.upgrades) : new Set<string>();
  const cd = ARK_MOVE_COOLDOWN_TICKS - (owned.has('engines') ? 3 : 0);
  player.ark.moveReadyTick = state.meta.tick + Math.max(2, cd);
  if (player.id === state.humanId) {
    emitEvent(state, { kind: 'ark', message: 'Your Ark weighed anchor for higher ground.', q, r });
  }
}

export function upgradeArk(state: EngineState, player: PlayerState): void {
  if (player.ark.level >= ARK_MAX_LEVEL) fail('Your Ark is already a legend.');
  const cost = ARK_UPGRADE_COSTS[player.ark.level - 1];
  if (!canAfford(player.resources, cost)) fail('The shipwrights demand more.');
  player.resources = subResources(player.resources, cost);
  player.ark.level++;
  player.ark.maxHp += ARK_HP_PER_LEVEL;
  player.ark.hp = player.ark.maxHp;
}

export function recruit(state: EngineState, player: PlayerState, units: UnitCounts): Army {
  const total = totalUnits(units);
  if (total <= 0) fail('Recruit at least one unit.');
  const existing = armiesAt(state, player.ark.q, player.ark.r).find((a) => a.ownerId === player.id && !a.battleId);
  const existingTotal = existing ? totalUnits(existing.units) : 0;
  if (existingTotal + total > MAX_ARMY_SIZE) fail(`An army fields at most ${MAX_ARMY_SIZE}.`);
  const cost = unitCostOf(units);
  if (!canAfford(player.resources, cost)) fail('Not enough resources for these troops.');
  player.resources = subResources(player.resources, cost);
  if (existing) {
    existing.units.shields += units.shields;
    existing.units.blades += units.blades;
    existing.units.bows += units.bows;
    return existing;
  }
  const army: Army = {
    id: newId(state),
    ownerId: player.id,
    q: player.ark.q,
    r: player.ark.r,
    units: { ...units },
    path: [],
    nextMoveTick: 0,
  };
  state.armies.set(army.id, army);
  return army;
}

// local unit cost (shared unitCost needs the full map; re-expose)
import { unitCost as sharedUnitCost } from '@tidehold/shared';
function unitCostOf(units: UnitCounts) {
  return sharedUnitCost(units);
}

function requireOwnArmy(state: EngineState, player: PlayerState, armyId: string): Army {
  const army = state.armies.get(armyId);
  if (!army || army.ownerId !== player.id) fail('That army does not answer to you.');
  return army;
}

export function stepCost(state: EngineState, tile: Tile): number {
  return tile.flooded || tile.terrain === 'ocean' || tile.terrain === 'drowned' ? MOVE_TICKS_WATER : MOVE_TICKS_LAND;
}

export function moveArmy(state: EngineState, player: PlayerState, armyId: string, q: number, r: number): void {
  const army = requireOwnArmy(state, player, armyId);
  if (army.battleId) fail('This army is committed to battle.');
  const dest = tileAt(state, q, r);
  if (!dest) fail('Beyond the edge of the world.');
  const path = hexPath({ q: army.q, r: army.r }, { q: dest.q, r: dest.r }, (c) => {
    const t = tileAt(state, c.q, c.r);
    return t ? stepCost(state, t) : Infinity;
  });
  if (!path) fail('No route leads there.');
  army.path = path;
  if (path.length > 0) {
    const first = tileAt(state, path[0].q, path[0].r)!;
    army.nextMoveTick = state.meta.tick + stepCost(state, first);
  }
}

export function assignCommander(state: EngineState, player: PlayerState, armyId: string, commanderId: string | null): void {
  const army = requireOwnArmy(state, player, armyId);
  if (army.commanderId) {
    const prev = player.commanders.find((c) => c.id === army.commanderId);
    if (prev && prev.status === 'assigned') prev.status = 'ready';
  }
  if (!commanderId) {
    delete army.commanderId;
    return;
  }
  const c = player.commanders.find((cm) => cm.id === commanderId);
  if (!c) fail('No such commander.');
  if (c.status === 'captured') fail(`${c.name} is held captive.`);
  army.commanderId = c.id;
  c.status = 'assigned';
}

export function attack(state: EngineState, player: PlayerState, armyId: string, q: number, r: number): Battle {
  const army = requireOwnArmy(state, player, armyId);
  if (army.battleId) fail('Already committed to a battle.');
  if (totalUnits(army.units) <= 0) fail('An empty army wins no wars.');
  const tile = tileAt(state, q, r);
  if (!tile) fail('Beyond the edge of the world.');
  if (hexDistance(army, tile) > 1) fail('March adjacent before attacking.');
  const defenderId = defenderIdFor(state, tile, player.id);
  const hasGarrison = (tile.garrison ?? 0) > 0;
  if (!defenderId && !hasGarrison) fail('Nothing there to fight.');
  const battle: Battle = {
    id: newId(state),
    attackerArmyId: army.id,
    attackerId: player.id,
    defenderId,
    target: { q: tile.q, r: tile.r },
    createdTick: state.meta.tick,
    resolveTick: state.meta.tick + BATTLE_PREP_TICKS,
  };
  state.battles.set(battle.id, battle);
  army.battleId = battle.id;
  army.path = [];
  if (player.id === state.humanId) {
    emitEvent(state, { kind: 'battle', message: `Horns sound — battle joins in ${BATTLE_PREP_TICKS} ticks.`, q, r });
  }
  return battle;
}

function defenderIdFor(state: EngineState, tile: Tile, attackerId: string): string | undefined {
  const enemies = armiesAt(state, tile.q, tile.r).filter((a) => a.ownerId !== attackerId);
  if (enemies.length > 0) return enemies[0].ownerId;
  for (const p of state.players.values()) {
    if (p.id !== attackerId && !p.defeated && p.ark.q === tile.q && p.ark.r === tile.r) return p.id;
  }
  if (tile.building && tile.building.ownerId !== attackerId) return tile.building.ownerId;
  if (tile.ownerId && tile.ownerId !== attackerId) return tile.ownerId;
  return undefined;
}

export function launchExpedition(state: EngineState, player: PlayerState, q: number, r: number): Expedition {
  const tile = tileAt(state, q, r);
  if (!tile) fail('Beyond the edge of the world.');
  if (tile.terrain !== 'ruins' && tile.terrain !== 'drowned') fail('Expeditions seek ruins.');
  if ((tile.ruinTier ?? 0) < 1) fail('These ruins are spent.');
  if (tile.terrain === 'ruins' && (tile.garrison ?? 0) > 0) fail('Clear the remnants first.');
  if ([...state.expeditions.values()].some((e) => e.ownerId === player.id && e.target.q === q && e.target.r === r)) {
    fail('Your divers are already down there.');
  }
  let dist = hexDistance(player.ark, tile);
  for (const t of state.tiles) {
    if (t.building?.type === 'port' && t.building.ownerId === player.id) dist = Math.min(dist, hexDistance(t, tile));
  }
  if (dist > EXPEDITION_RANGE) fail(`Beyond reach — get within ${EXPEDITION_RANGE} hexes.`);
  if (!canAfford(player.resources, EXPEDITION_COST)) fail('Provisioning takes food and timber.');
  player.resources = subResources(player.resources, EXPEDITION_COST);
  const exp: Expedition = {
    id: newId(state),
    ownerId: player.id,
    target: { q, r },
    departTick: state.meta.tick,
    resolveTick: state.meta.tick + expeditionDuration(dist, player),
  };
  state.expeditions.set(exp.id, exp);
  if (player.id === state.humanId) {
    emitEvent(state, { kind: 'expedition', message: 'Your expedition sets out for the ruins.', q, r });
  }
  return exp;
}

export function offerRelics(state: EngineState, player: PlayerState, q: number, r: number, amount: number): void {
  const tile = tileAt(state, q, r);
  if (!tile?.building || tile.building.type !== 'shrine' || tile.building.ownerId !== player.id) {
    fail('You need your own Shrine of the Deep.');
  }
  if (player.resources.relics < amount || amount <= 0) fail('Not enough relics to offer.');
  const per = SHRINE_SCORE_PER_RELIC[tile.building.level - 1];
  player.resources = subResources(player.resources, { relics: amount });
  const gained = per * amount;
  player.score += gained;
  if (player.id === state.humanId) {
    state.relicsBanked += amount;
    emitEvent(state, { kind: 'reward', message: `You commit ${amount} relics to the deep — +${gained} legacy.`, q, r, toast: 'success' });
  }
}

// ---------------------------------------------------------------------------
// Rewarded-ad effects
// ---------------------------------------------------------------------------

/** "Hold back the tide one turn" — push the next rise later. */
export function holdBackTide(state: EngineState): void {
  state.meta.nextTideTick += HOLD_TIDE_TICKS;
  emitEvent(state, { kind: 'tide', message: 'The waters hesitate. You have bought time — use it well.', toast: 'info' });
}

/** Rewarded continue after defeat: revive the Ark on safe ground, restore hull. */
export function reviveArk(state: EngineState): void {
  const you = human(state);
  you.defeated = false;
  state.outcome = null;
  state.ended = false;
  you.ark.hp = Math.min(you.ark.maxHp, CONTINUE_ARK_HP);
  you.ark.damagedUntilTick = 0;
  const safe = findSafeLand(state, you);
  if (safe) {
    you.ark.q = safe.q;
    you.ark.r = safe.r;
  }
  // Ease the pressure: back the tide off a step of progress.
  state.meta.nextTideTick = state.meta.tick + Math.floor(SOLO_TIDE_INTERVAL / 2);
  emitEvent(state, { kind: 'ark', message: 'Your Ark rises from the waves, battered but afloat. Sail on.', toast: 'success' });
}

function findSafeLand(state: EngineState, player: PlayerState): Tile | null {
  let best: Tile | null = null;
  for (const t of state.tiles) {
    if (!isLand(t) || t.terrain === 'ruins') continue;
    if ([...state.players.values()].some((p) => p.id !== player.id && !p.defeated && p.ark.q === t.q && p.ark.r === t.r)) continue;
    if (!best || t.elevation > best.elevation) best = t;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

export function tick(state: EngineState, meta: MetaState): void {
  if (state.ended) return;
  state.meta.tick++;
  const t = state.meta.tick;
  state.survivedTicks = t;

  runProduction(state, t);
  runUpkeep(state);
  runMovement(state, t);
  runBattles(state, t);
  runExpeditions(state, t);
  runAi(state, meta);
  runTide(state, t);
  human(state).score += SCORE_SURVIVAL_PER_TICK;
  checkOutcome(state);
}

function runProduction(state: EngineState, tick: number): void {
  for (const tile of state.tiles) {
    if (!tile.building) continue;
    const owner = state.players.get(tile.building.ownerId);
    if (!owner || owner.defeated) continue;
    owner.resources = addResources(owner.resources, tileProduction(tile, owner, tick));
  }
}

function runUpkeep(state: EngineState): void {
  const byOwner = new Map<string, number>();
  for (const a of state.armies.values()) byOwner.set(a.ownerId, (byOwner.get(a.ownerId) ?? 0) + armyUpkeep(a.units));
  for (const [id, up] of byOwner) {
    const p = state.players.get(id);
    if (!p) continue;
    if (p.resources.food >= up) {
      p.resources.food -= up;
    } else {
      p.resources.food = 0;
      for (const a of state.armies.values()) {
        if (a.ownerId !== id) continue;
        for (const u of ['shields', 'blades', 'bows'] as const) a.units[u] = Math.max(0, a.units[u] - Math.ceil(a.units[u] * 0.08));
        if (totalUnits(a.units) <= 0 && !a.battleId) state.armies.delete(a.id);
      }
    }
  }
}

function runMovement(state: EngineState, tick: number): void {
  for (const army of state.armies.values()) {
    if (army.battleId || army.path.length === 0 || army.nextMoveTick > tick) continue;
    const step = army.path.shift()!;
    army.q = step.q;
    army.r = step.r;
    for (const other of armiesAt(state, army.q, army.r)) {
      if (other.id !== army.id && other.ownerId === army.ownerId && !other.battleId) {
        army.units.shields += other.units.shields;
        army.units.blades += other.units.blades;
        army.units.bows += other.units.bows;
        state.armies.delete(other.id);
      }
    }
    if (army.path.length > 0) {
      const next = tileAt(state, army.path[0].q, army.path[0].r);
      if (!next) army.path = [];
      else army.nextMoveTick = tick + stepCost(state, next);
    }
  }
}

function watchtowerLevelAt(state: EngineState, tile: Tile, defenderId?: string): number {
  let best = 0;
  const consider = (t?: Tile) => {
    if (!t?.building || t.building.type !== 'watchtower') return;
    if (defenderId && t.building.ownerId !== defenderId) return;
    best = Math.max(best, t.building.level);
  };
  consider(tile);
  for (const nb of hexNeighbors(tile)) consider(tileAt(state, nb.q, nb.r));
  return best;
}

function runBattles(state: EngineState, tick: number): void {
  for (const battle of [...state.battles.values()]) {
    if (battle.resolveTick > tick) continue;
    state.battles.delete(battle.id);
    const army = state.armies.get(battle.attackerArmyId);
    const attacker = state.players.get(battle.attackerId);
    const tile = tileAt(state, battle.target.q, battle.target.r);
    if (!army || !attacker || !tile || totalUnits(army.units) === 0) {
      if (army) delete army.battleId;
      continue;
    }
    delete army.battleId;
    if (tile.flooded) continue;

    const defenderId = battle.defenderId;
    const defender = defenderId ? state.players.get(defenderId) : undefined;
    const defArmies = defenderId ? armiesAt(state, tile.q, tile.r).filter((a) => a.ownerId === defenderId) : [];
    const defUnits = defArmies.reduce(
      (acc, a) => ({ shields: acc.shields + a.units.shields, blades: acc.blades + a.units.blades, bows: acc.bows + a.units.bows }),
      { shields: 0, blades: 0, bows: 0 } as UnitCounts,
    );
    const attackerCommander = attacker.commanders.find((c) => c.id === army.commanderId);
    const defenderCommander = defender
      ? defArmies.map((a) => defender.commanders.find((c) => c.id === a.commanderId)).find((c) => c)
      : undefined;
    const garrison = tile.garrison ?? 0;
    const arkPresent = defender && defender.ark.q === tile.q && defender.ark.r === tile.r;
    if (!defender && garrison <= 0) continue;

    const report = resolveBattle({
      battleId: battle.id,
      tick,
      target: { q: tile.q, r: tile.r },
      attacker: { playerId: attacker.id, units: { ...army.units }, commander: attackerCommander },
      defender: { playerId: defender?.id, units: defUnits, commander: defenderCommander },
      garrison,
      terrain: tile.terrain,
      watchtowerLevel: watchtowerLevelAt(state, tile, defenderId),
      seed: nextSeed(state),
    });

    applyLosses(state, [army], report.attacker.losses, attacker);
    if (defender) applyLosses(state, defArmies, report.defender.losses, defender);

    if (report.winner === 'attacker') {
      if (garrison > 0) {
        tile.garrison = 0;
        const relics = tile.ruinTier ?? 1;
        attacker.resources = addResources(attacker.resources, { relics });
        attacker.score += SCORE_RUIN_CLEARED;
        if (attacker.id === state.humanId) state.ruinsCleared++;
      }
      if (defender) {
        attacker.score += SCORE_BATTLE_WON;
        if (attacker.id === state.humanId) state.battlesWon++;
        if (tile.building && tile.building.ownerId === defender.id) {
          const spoils = scaleResources(defender.resources, BATTLE_LOOT_FRACTION);
          defender.resources = subResources(defender.resources, spoils);
          attacker.resources = addResources(attacker.resources, spoils);
          delete tile.building;
          delete tile.ownerId;
        } else if (tile.ownerId === defender.id) {
          delete tile.ownerId;
        }
        if (arkPresent) {
          const plunder = scaleResources(defender.resources, ARK_PLUNDER_FRACTION);
          defender.resources = subResources(defender.resources, plunder);
          attacker.resources = addResources(attacker.resources, plunder);
          defender.ark.hp = Math.max(0, Math.floor(defender.ark.hp / 2));
          defender.ark.damagedUntilTick = tick + ARK_DAMAGE_TICKS;
          relocateArk(state, defender, tile);
        }
      }
    } else if (defender) {
      defender.score += SCORE_BATTLE_WON;
    }

    if (attacker.id === state.humanId || defender?.id === state.humanId) {
      emitEvent(state, {
        kind: 'battle',
        message: report.narrative,
        q: tile.q,
        r: tile.r,
        toast: attacker.id === state.humanId ? (report.winner === 'attacker' ? 'success' : 'error') : report.winner === 'defender' ? 'success' : 'error',
      });
    }
  }
}

function applyLosses(state: EngineState, armies: Army[], losses: UnitCounts, owner: PlayerState): void {
  for (const u of ['shields', 'blades', 'bows'] as const) {
    let rem = losses[u];
    for (const a of armies) {
      if (rem <= 0) break;
      const take = Math.min(a.units[u], rem);
      a.units[u] -= take;
      rem -= take;
    }
  }
  for (const a of armies) {
    if (totalUnits(a.units) <= 0) {
      if (a.commanderId) {
        const c = owner.commanders.find((cm) => cm.id === a.commanderId);
        if (c && c.status === 'assigned') c.status = 'ready';
      }
      state.armies.delete(a.id);
    }
  }
}

function relocateArk(state: EngineState, player: PlayerState, from: Tile): void {
  let best: Tile | null = null;
  let bestD = Infinity;
  for (const t of state.tiles) {
    if (!isLand(t) || t.terrain === 'ruins') continue;
    const d = hexDistance(t, from);
    if (d < 2) continue;
    if ([...state.players.values()].some((p) => p.id !== player.id && !p.defeated && p.ark.q === t.q && p.ark.r === t.r)) continue;
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  if (best) {
    player.ark.q = best.q;
    player.ark.r = best.r;
  }
}

function runExpeditions(state: EngineState, tick: number): void {
  for (const exp of [...state.expeditions.values()]) {
    if (exp.resolveTick > tick) continue;
    state.expeditions.delete(exp.id);
    const owner = state.players.get(exp.ownerId);
    const tile = tileAt(state, exp.target.q, exp.target.r);
    if (!owner || !tile) continue;
    const tier = tile.ruinTier ?? 0;
    if (tier < 1) continue;
    const outcome = resolveExpedition(tile, tier, owner, nextSeed(state));
    owner.resources = addResources(owner.resources, outcome.loot);
    if (outcome.tech && !owner.techs.includes(outcome.tech)) owner.techs.push(outcome.tech);
    owner.score += outcome.scoreGained;
    tile.ruinTier = tier - 1;
    if (owner.id === state.humanId) {
      state.expeditionsDone++;
      emitEvent(state, { kind: 'expedition', message: outcome.story, q: tile.q, r: tile.r, toast: 'success' });
    }
  }
}

function runTide(state: EngineState, tick: number): void {
  if (tick < state.meta.nextTideTick || state.meta.tideLevel >= SOLO_SEASON_END_TIDE) return;
  state.meta.tideLevel++;
  state.meta.nextTideTick = tick + SOLO_TIDE_INTERVAL;
  const report = applyTide(state.tiles, state.meta.tideLevel);
  for (const t of state.tiles) if (t.ownerId && !t.flooded) {
    const owner = state.players.get(t.ownerId);
    if (owner) owner.score += SCORE_TILE_SURVIVES_TIDE;
  }
  human(state).score += SCORE_PER_TIDE_LEVEL;
  const phase = phaseForTide(state.meta.tideLevel);
  state.meta.phase = phase;
  emitEvent(state, {
    kind: 'tide',
    message: `THE TIDE RISES to ${state.meta.tideLevel}/8 — ${report.newlyFlooded.length} tiles slip under.`,
    toast: 'info',
  });
  if (phase === 'ended') {
    emitEvent(state, { kind: 'season', message: 'The sea has taken the world. Only the peaks remain.', toast: 'info' });
  }
}

// ---------------------------------------------------------------------------
// Outcome + scoring
// ---------------------------------------------------------------------------

function arkHasLandRefuge(state: EngineState, player: PlayerState): boolean {
  const here = tileAt(state, player.ark.q, player.ark.r);
  if (here && isLand(here)) return true;
  return hexNeighbors(player.ark).some((c) => {
    const t = tileAt(state, c.q, c.r);
    return t && isLand(t);
  });
}

function checkOutcome(state: EngineState): void {
  const you = human(state);
  // Breached: Ark hull gone.
  if (you.ark.hp <= 0) {
    you.defeated = true;
    endRun(state, 'breached');
    return;
  }
  // Drowned: Ark's tile flooded and no adjacent land remains.
  if (!arkHasLandRefuge(state, you)) {
    endRun(state, 'drowned');
    return;
  }
  // Outlasted: the sea reached its peak and you still stand.
  if (state.meta.tideLevel >= SOLO_SEASON_END_TIDE && state.meta.phase === 'ended') {
    // Give a short grace so the ending reads, then end.
    if (state.meta.tick >= state.meta.nextTideTick + 4) {
      endRun(state, 'outlasted');
    }
  }
  // AI eliminations (drowned/breached) — flip to defeated so placement is fair.
  for (const id of state.aiIds) {
    const ai = state.players.get(id);
    if (!ai || ai.defeated) continue;
    if (ai.ark.hp <= 0 || !arkHasLandRefuge(state, ai)) ai.defeated = true;
  }
}

export function placementOf(state: EngineState, playerId: string): { placement: number; field: number } {
  const field = 1 + state.aiIds.length;
  const ranked = [...state.players.values()].sort((a, b) => {
    if (a.defeated !== b.defeated) return a.defeated ? 1 : -1;
    return b.score - a.score;
  });
  const placement = ranked.findIndex((p) => p.id === playerId) + 1;
  return { placement: placement || field, field };
}

function endRun(state: EngineState, outcome: OutcomeReason): void {
  if (state.ended) return;
  state.ended = true;
  state.outcome = outcome;
  const you = human(state);
  const { placement } = placementOf(state, state.humanId);
  you.score += SCORE_PER_TIDE_LEVEL * state.meta.tideLevel;
  you.score += SCORE_PLACEMENT_BONUS[Math.min(SCORE_PLACEMENT_BONUS.length - 1, placement - 1)] ?? 0;
}

export function runStats(state: EngineState): RunStats {
  const you = human(state);
  const { placement, field } = placementOf(state, state.humanId);
  const nextTideIn = Math.max(0, state.meta.nextTideTick - state.meta.tick);
  return {
    tick: state.meta.tick,
    tideLevel: state.meta.tideLevel,
    nextTideInTicks: nextTideIn,
    phase: state.meta.phase,
    score: Math.round(you.score),
    placement,
    fieldSize: field,
    ownedTiles: ownedTileCount(state, state.humanId),
    aliveArks: [...state.players.values()].filter((p) => !p.defeated).length,
    tideImminent: nextTideIn <= 6 && state.meta.tideLevel < SOLO_SEASON_END_TIDE,
  };
}

/** Salvage a completed run awards. */
export function salvageFor(score: number, tide: number): number {
  return Math.floor((score / 100) * SALVAGE_PER_100_SCORE) + tide * SALVAGE_PER_TIDE_LEVEL;
}
