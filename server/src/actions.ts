/**
 * Player actions. Every mutation the client can request flows through here
 * and is validated against authoritative state — never trust the client.
 * Throws ActionError with a player-readable message on any violation.
 */
import {
  addResources,
  ARK_INFLUENCE_RADIUS,
  ARK_MAX_LEVEL,
  ARK_MOVE_COOLDOWN_TICKS,
  ARK_MOVE_FOOD_PER_HEX,
  ARK_MOVE_RANGE,
  ARK_HP_PER_LEVEL,
  ARK_UPGRADE_COSTS,
  attackConsequences,
  BATTLE_PREP_TICKS,
  BUILDINGS,
  buildingCost,
  canAfford,
  CLAIM_TILE_COST,
  clampReputation,
  COMMANDER_SPEED_BONUS,
  CONTRACT_MIN_DURATION_TICKS,
  createProposal,
  expeditionDuration,
  EXPEDITION_COST,
  EXPEDITION_RANGE,
  hexDistance,
  hexPath,
  isOathbreaker,
  MARKET_FEE,
  MARKET_FEE_OATHBREAKER_MULT,
  MARKET_FEE_WITH_PORT,
  MAX_ARMY_SIZE,
  MAX_BUILDING_LEVEL,
  MAX_TILES_PER_PLAYER,
  MOVE_TICKS_LAND,
  MOVE_TICKS_WATER,
  REP_BREAK_CONTRACT,
  REP_COMPLETE_CONTRACT,
  SHRINE_SCORE_PER_RELIC,
  subResources,
  tradeQuote,
  applyTradePressure,
  unitCost,
  UNIT_LIST,
  validateProposal,
  type Army,
  type Battle,
  type Contract,
  type ContractTerms,
  type ContractType,
  type PlayerState,
  type ResourceType,
  type Tile,
  type UnitCounts,
} from '@tidehold/shared';
import type { Db } from './db.js';
import {
  addEvent,
  armiesAt,
  newId,
  ownedTileCount,
  tileAt,
  type GameState,
} from './state.js';

export class ActionError extends Error {}

function fail(message: string): never {
  throw new ActionError(message);
}

function requireLiveWorld(state: GameState): void {
  if (state.meta.phase === 'ended') fail('The season has ended. The last peaks belong to history now.');
}

function intInRange(n: unknown, min: number, max: number): number {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
    fail(`Expected an integer between ${min} and ${max}.`);
  }
  return n;
}

function requireTile(state: GameState, q: unknown, r: unknown): Tile {
  const qi = intInRange(q, -1000, 1000);
  const ri = intInRange(r, -1000, 1000);
  const tile = tileAt(state, qi, ri);
  if (!tile) fail('That place lies beyond the edge of the world.');
  return tile;
}

function isLand(tile: Tile): boolean {
  return !tile.flooded && tile.terrain !== 'ocean' && tile.terrain !== 'drowned';
}

function withinInfluence(player: PlayerState, tile: Tile): boolean {
  const radius = ARK_INFLUENCE_RADIUS[player.ark.level - 1];
  return hexDistance(player.ark, tile) <= radius;
}

function playerOwnsPort(state: GameState, playerId: string): boolean {
  return state.tiles.some(
    (t) =>
      t.building?.type === 'port' &&
      t.building.ownerId === playerId &&
      !(t.building.disabledUntilTick && t.building.disabledUntilTick > state.meta.tick),
  );
}

function marketFeeFor(state: GameState, player: PlayerState): number {
  const base = playerOwnsPort(state, player.id) ? MARKET_FEE_WITH_PORT : MARKET_FEE;
  return isOathbreaker(player) ? base * MARKET_FEE_OATHBREAKER_MULT : base;
}

// ---------------------------------------------------------------------------
// Territory & construction
// ---------------------------------------------------------------------------

export function claimTile(db: Db, state: GameState, player: PlayerState, q: unknown, r: unknown): Tile {
  requireLiveWorld(state);
  const tile = requireTile(state, q, r);
  if (!isLand(tile)) fail('The sea holds that ground now.');
  if (tile.terrain === 'ruins') fail('The ruins belong to the remnants. Clear or explore them instead.');
  if (tile.ownerId === player.id) fail('You already hold this land.');
  if (tile.ownerId) fail('Another banner already flies here.');
  if (!withinInfluence(player, tile)) fail('Too far from your Ark. Move it closer or upgrade it.');
  if (ownedTileCount(state, player.id) >= MAX_TILES_PER_PLAYER) fail('Your people are stretched thin — you cannot hold more land.');
  if (!canAfford(player.resources, CLAIM_TILE_COST)) fail('Not enough resources to settle here.');
  player.resources = subResources(player.resources, CLAIM_TILE_COST);
  tile.ownerId = player.id;
  return tile;
}

export function build(
  db: Db,
  state: GameState,
  player: PlayerState,
  q: unknown,
  r: unknown,
  type: unknown,
): Tile {
  requireLiveWorld(state);
  const tile = requireTile(state, q, r);
  if (typeof type !== 'string' || !(type in BUILDINGS)) fail('Unknown building.');
  const buildingType = type as keyof typeof BUILDINGS;
  const spec = BUILDINGS[buildingType];
  if (tile.ownerId !== player.id) fail('You must claim this land before building on it.');
  if (tile.building) fail('This tile is already built.');
  if (!spec.terrain.includes(tile.terrain)) {
    fail(`A ${spec.name} cannot stand on ${tile.terrain}. It needs: ${spec.terrain.join(', ')}.`);
  }
  const cost = buildingCost(buildingType, 1);
  if (!canAfford(player.resources, cost)) fail(`Not enough resources for a ${spec.name}.`);
  player.resources = subResources(player.resources, cost);
  tile.building = { type: buildingType, level: 1, ownerId: player.id };
  addEvent(db, state, {
    type: 'build',
    message: `${player.username} raised a ${spec.name}.`,
    actorId: player.id,
    q: tile.q,
    r: tile.r,
  });
  return tile;
}

export function upgradeBuilding(db: Db, state: GameState, player: PlayerState, q: unknown, r: unknown): Tile {
  requireLiveWorld(state);
  const tile = requireTile(state, q, r);
  if (!tile.building || tile.building.ownerId !== player.id) fail('No building of yours stands here.');
  if (tile.building.level >= MAX_BUILDING_LEVEL) fail('Already at its finest.');
  const cost = buildingCost(tile.building.type, tile.building.level + 1);
  if (!canAfford(player.resources, cost)) fail('Not enough resources for the upgrade.');
  player.resources = subResources(player.resources, cost);
  tile.building.level++;
  return tile;
}

// ---------------------------------------------------------------------------
// The Ark
// ---------------------------------------------------------------------------

export function moveArk(db: Db, state: GameState, player: PlayerState, q: unknown, r: unknown): PlayerState {
  requireLiveWorld(state);
  const tile = requireTile(state, q, r);
  if (!isLand(tile)) fail('The Ark must anchor on land that still stands.');
  if (tile.terrain === 'ruins') fail('The remnants will not share their ruins with your Ark.');
  const dist = hexDistance(player.ark, tile);
  if (dist === 0) fail('The Ark is already here.');
  if (dist > ARK_MOVE_RANGE) fail(`The Ark can travel at most ${ARK_MOVE_RANGE} hexes per move.`);
  if (player.ark.moveReadyTick > state.meta.tick) {
    fail(`The Ark's engines need ${player.ark.moveReadyTick - state.meta.tick} more ticks.`);
  }
  for (const other of state.players.values()) {
    if (other.id !== player.id && !other.defeated && other.ark.q === tile.q && other.ark.r === tile.r) {
      fail('Another Ark already anchors there.');
    }
  }
  let foodPerHex = ARK_MOVE_FOOD_PER_HEX;
  if (player.techs.includes('hull_lore')) foodPerHex = Math.ceil(foodPerHex / 2);
  const cost = { food: foodPerHex * dist };
  if (!canAfford(player.resources, cost)) fail(`Moving that far needs ${cost.food} food.`);
  player.resources = subResources(player.resources, cost);
  player.ark.q = tile.q;
  player.ark.r = tile.r;
  player.ark.moveReadyTick = state.meta.tick + ARK_MOVE_COOLDOWN_TICKS;
  addEvent(db, state, {
    type: 'ark',
    message: `${player.username}'s Ark weighed anchor and moved to higher purpose.`,
    actorId: player.id,
    q: tile.q,
    r: tile.r,
  });
  return player;
}

export function upgradeArk(db: Db, state: GameState, player: PlayerState): PlayerState {
  requireLiveWorld(state);
  if (player.ark.level >= ARK_MAX_LEVEL) fail('Your Ark is already a legend of the seas.');
  const cost = ARK_UPGRADE_COSTS[player.ark.level - 1];
  if (!canAfford(player.resources, cost)) fail('The shipwrights demand more than you have.');
  player.resources = subResources(player.resources, cost);
  player.ark.level++;
  player.ark.maxHp += ARK_HP_PER_LEVEL;
  player.ark.hp = player.ark.maxHp;
  addEvent(db, state, {
    type: 'ark',
    message: `${player.username}'s Ark grew grander — its influence now reaches ${ARK_INFLUENCE_RADIUS[player.ark.level - 1]} hexes.`,
    actorId: player.id,
  });
  return player;
}

// ---------------------------------------------------------------------------
// Armies
// ---------------------------------------------------------------------------

function sanitizeUnits(input: unknown): UnitCounts {
  if (typeof input !== 'object' || input === null) fail('Malformed unit request.');
  const raw = input as Record<string, unknown>;
  const units: UnitCounts = { shields: 0, blades: 0, bows: 0 };
  for (const u of UNIT_LIST) {
    const n = raw[u] ?? 0;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > MAX_ARMY_SIZE) {
      fail('Malformed unit request.');
    }
    units[u] = n;
  }
  return units;
}

export function recruit(db: Db, state: GameState, player: PlayerState, unitsIn: unknown): Army {
  requireLiveWorld(state);
  const units = sanitizeUnits(unitsIn);
  const total = units.shields + units.blades + units.bows;
  if (total <= 0) fail('Recruit at least one unit.');
  const existing = armiesAt(state, player.ark.q, player.ark.r).find(
    (a) => a.ownerId === player.id && !a.battleId,
  );
  const existingTotal = existing ? existing.units.shields + existing.units.blades + existing.units.bows : 0;
  if (existingTotal + total > MAX_ARMY_SIZE) fail(`An army can field at most ${MAX_ARMY_SIZE} units.`);
  const cost = unitCost(units);
  if (!canAfford(player.resources, cost)) fail('Not enough resources to raise these troops.');
  player.resources = subResources(player.resources, cost);
  if (existing) {
    existing.units.shields += units.shields;
    existing.units.blades += units.blades;
    existing.units.bows += units.bows;
    return existing;
  }
  const army: Army = {
    id: newId(),
    ownerId: player.id,
    q: player.ark.q,
    r: player.ark.r,
    units,
    path: [],
    nextMoveTick: 0,
  };
  state.armies.set(army.id, army);
  return army;
}

function requireOwnArmy(state: GameState, player: PlayerState, armyId: unknown): Army {
  if (typeof armyId !== 'string') fail('Malformed army id.');
  const army = state.armies.get(armyId);
  if (!army || army.ownerId !== player.id) fail('That army does not answer to you.');
  return army;
}

/** Per-hex movement cost in ticks for an army, given its commander. */
export function stepCost(state: GameState, army: Army, player: PlayerState, tile: Tile): number {
  const water = tile.flooded || tile.terrain === 'ocean' || tile.terrain === 'drowned';
  let cost = water ? MOVE_TICKS_WATER : MOVE_TICKS_LAND;
  const commander = army.commanderId
    ? player.commanders.find((c) => c.id === army.commanderId)
    : undefined;
  if (commander?.trait === 'logistics') cost = Math.max(1, Math.round(cost * (1 - COMMANDER_SPEED_BONUS)));
  return cost;
}

export function moveArmy(db: Db, state: GameState, player: PlayerState, armyId: unknown, q: unknown, r: unknown): Army {
  requireLiveWorld(state);
  const army = requireOwnArmy(state, player, armyId);
  if (army.battleId) fail('This army is committed to battle and cannot withdraw.');
  const dest = requireTile(state, q, r);
  const path = hexPath(
    { q: army.q, r: army.r },
    { q: dest.q, r: dest.r },
    (c) => {
      const t = tileAt(state, c.q, c.r);
      if (!t) return Infinity;
      return stepCost(state, army, player, t);
    },
  );
  if (!path) fail('No route leads there.');
  army.path = path;
  if (path.length > 0) {
    const first = tileAt(state, path[0].q, path[0].r)!;
    army.nextMoveTick = state.meta.tick + stepCost(state, army, player, first);
  }
  return army;
}

export function assignCommander(db: Db, state: GameState, player: PlayerState, armyId: unknown, commanderId: unknown): Army {
  requireLiveWorld(state);
  const army = requireOwnArmy(state, player, armyId);
  if (commanderId === null || commanderId === undefined || commanderId === '') {
    if (army.commanderId) {
      const prev = player.commanders.find((c) => c.id === army.commanderId);
      if (prev && prev.status === 'assigned') prev.status = 'ready';
    }
    delete army.commanderId;
    return army;
  }
  if (typeof commanderId !== 'string') fail('Malformed commander id.');
  const commander = player.commanders.find((c) => c.id === commanderId);
  if (!commander) fail('No such commander in your retinue.');
  if (commander.status === 'captured') fail(`${commander.name} languishes in an enemy brig. Negotiate a ransom.`);
  if (commander.status === 'assigned') fail(`${commander.name} already leads another army.`);
  if (army.commanderId) {
    const prev = player.commanders.find((c) => c.id === army.commanderId);
    if (prev && prev.status === 'assigned') prev.status = 'ready';
  }
  army.commanderId = commander.id;
  commander.status = 'assigned';
  return army;
}

export function disbandArmy(db: Db, state: GameState, player: PlayerState, armyId: unknown): void {
  const army = requireOwnArmy(state, player, armyId);
  if (army.battleId) fail('This army is committed to battle.');
  if (army.commanderId) {
    const c = player.commanders.find((cm) => cm.id === army.commanderId);
    if (c && c.status === 'assigned') c.status = 'ready';
  }
  state.armies.delete(army.id);
}

// ---------------------------------------------------------------------------
// Attack — the moment The Ledger gets tested
// ---------------------------------------------------------------------------

/** Who defends a tile right now? */
export function defenderIdFor(state: GameState, tile: Tile, attackerId: string): string | undefined {
  const enemyArmies = armiesAt(state, tile.q, tile.r).filter((a) => a.ownerId !== attackerId);
  if (enemyArmies.length > 0) return enemyArmies[0].ownerId;
  for (const p of state.players.values()) {
    if (p.id !== attackerId && !p.defeated && p.ark.q === tile.q && p.ark.r === tile.r) return p.id;
  }
  if (tile.building && tile.building.ownerId !== attackerId) return tile.building.ownerId;
  if (tile.ownerId && tile.ownerId !== attackerId) return tile.ownerId;
  return undefined;
}

export function attack(db: Db, state: GameState, player: PlayerState, armyId: unknown, q: unknown, r: unknown): Battle {
  requireLiveWorld(state);
  const army = requireOwnArmy(state, player, armyId);
  if (army.battleId) fail('This army is already committed to a battle.');
  const total = army.units.shields + army.units.blades + army.units.bows;
  if (total <= 0) fail('An empty army wins no wars.');
  const tile = requireTile(state, q, r);
  if (hexDistance(army, tile) > 1) fail('March adjacent to the target before attacking.');

  const defenderId = defenderIdFor(state, tile, player.id);
  const hasGarrison = (tile.garrison ?? 0) > 0;
  if (!defenderId && !hasGarrison) fail('There is nothing there to fight.');

  // The Ledger remembers: attacking a contract partner is betrayal.
  if (defenderId) {
    const defender = state.players.get(defenderId);
    const { broken, repDelta } = attackConsequences(
      [...state.contracts.values()],
      player.id,
      defenderId,
      defender ? isOathbreaker(defender) : false,
    );
    for (const c of broken) {
      c.status = 'broken';
      addEvent(db, state, {
        type: 'contract',
        message: `OATH BROKEN — ${player.username} turned on ${defender?.username ?? 'their partner'}, shattering their ${c.type.replace('_', '-')} pact.`,
        actorId: player.id,
        targetId: defenderId,
      });
    }
    player.reputation = clampReputation(player.reputation + repDelta);
  }

  const battle: Battle = {
    id: newId(),
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

  const defenderName = defenderId
    ? state.players.get(defenderId)?.username ?? 'an unknown power'
    : 'the remnant garrison';
  addEvent(db, state, {
    type: 'battle',
    message: `${player.username} sounded the horns against ${defenderName}. Battle joins in ${BATTLE_PREP_TICKS} ticks.`,
    actorId: player.id,
    targetId: defenderId,
    q: tile.q,
    r: tile.r,
  });
  return battle;
}

// ---------------------------------------------------------------------------
// Expeditions
// ---------------------------------------------------------------------------

export function launchExpedition(db: Db, state: GameState, player: PlayerState, q: unknown, r: unknown) {
  requireLiveWorld(state);
  const tile = requireTile(state, q, r);
  if (tile.terrain !== 'ruins' && tile.terrain !== 'drowned') {
    fail('Expeditions seek ruins — sunken or standing.');
  }
  if ((tile.ruinTier ?? 0) < 1) fail('These ruins have given up everything they held.');
  if (tile.terrain === 'ruins' && (tile.garrison ?? 0) > 0) {
    fail('The remnants hold this place. Clear them with an army first.');
  }
  const alreadyRunning = [...state.expeditions.values()].some(
    (e) => e.ownerId === player.id && e.target.q === tile.q && e.target.r === tile.r,
  );
  if (alreadyRunning) fail('Your divers are already down there.');

  // Range from the Ark or any working port.
  let dist = hexDistance(player.ark, tile);
  for (const t of state.tiles) {
    if (
      t.building?.type === 'port' &&
      t.building.ownerId === player.id &&
      !(t.building.disabledUntilTick && t.building.disabledUntilTick > state.meta.tick)
    ) {
      dist = Math.min(dist, hexDistance(t, tile));
    }
  }
  if (dist > EXPEDITION_RANGE) fail(`Beyond reach — get your Ark or a port within ${EXPEDITION_RANGE} hexes.`);
  if (!canAfford(player.resources, EXPEDITION_COST)) fail('Provisioning an expedition takes food and timber.');
  player.resources = subResources(player.resources, EXPEDITION_COST);

  const expedition = {
    id: newId(),
    ownerId: player.id,
    target: { q: tile.q, r: tile.r },
    departTick: state.meta.tick,
    resolveTick: state.meta.tick + expeditionDuration(dist, player),
  };
  state.expeditions.set(expedition.id, expedition);
  addEvent(db, state, {
    type: 'expedition',
    message: `${player.username} launched an expedition toward the ${tile.terrain === 'drowned' ? 'drowned' : 'ancient'} ruins.`,
    actorId: player.id,
    q: tile.q,
    r: tile.r,
    isPublic: false,
  });
  return expedition;
}

// ---------------------------------------------------------------------------
// Market & shrine
// ---------------------------------------------------------------------------

const TRADABLE: ResourceType[] = ['timber', 'ore', 'food', 'relics'];

export function trade(
  db: Db,
  state: GameState,
  player: PlayerState,
  resource: unknown,
  amount: unknown,
  side: unknown,
) {
  requireLiveWorld(state);
  if (typeof resource !== 'string' || !TRADABLE.includes(resource as ResourceType)) fail('Unknown resource.');
  const res = resource as ResourceType;
  const amt = intInRange(amount, 1, 100000);
  if (side !== 'buy' && side !== 'sell') fail('Trade side must be buy or sell.');
  const quote = tradeQuote(state.market, res, amt, side, marketFeeFor(state, player));
  if (side === 'buy') {
    if (player.shells < quote.shells) fail(`That costs ${quote.shells} shells; you have ${Math.floor(player.shells)}.`);
    player.shells -= quote.shells;
    player.resources = addResources(player.resources, { [res]: amt });
  } else {
    if (player.resources[res] < amt) fail(`You do not have ${amt} ${res}.`);
    player.resources = subResources(player.resources, { [res]: amt });
    player.shells += quote.shells;
  }
  applyTradePressure(state.market, res, amt, side);
  return { quote, shells: player.shells, resources: player.resources };
}

export function offerRelics(db: Db, state: GameState, player: PlayerState, q: unknown, r: unknown, amount: unknown) {
  requireLiveWorld(state);
  const tile = requireTile(state, q, r);
  const amt = intInRange(amount, 1, 10000);
  if (!tile.building || tile.building.type !== 'shrine' || tile.building.ownerId !== player.id) {
    fail('You need your own Shrine of the Deep for offerings.');
  }
  if (tile.building.disabledUntilTick && tile.building.disabledUntilTick > state.meta.tick) {
    fail('The shrine still smolders from battle.');
  }
  if (player.resources.relics < amt) fail('Not enough relics to offer.');
  const perRelic = SHRINE_SCORE_PER_RELIC[tile.building.level - 1];
  player.resources = subResources(player.resources, { relics: amt });
  const gained = perRelic * amt;
  player.score += gained;
  addEvent(db, state, {
    type: 'player',
    message: `${player.username} committed ${amt} relic${amt > 1 ? 's' : ''} to the deep — legacy grows by ${gained}.`,
    actorId: player.id,
    q: tile.q,
    r: tile.r,
  });
  return { score: player.score, resources: player.resources };
}

// ---------------------------------------------------------------------------
// The Ledger
// ---------------------------------------------------------------------------

const CONTRACT_TYPES: ContractType[] = ['alliance', 'non_aggression', 'trade', 'tribute', 'ransom'];

function sanitizeTerms(input: unknown): ContractTerms {
  if (typeof input !== 'object' || input === null) fail('Malformed contract terms.');
  const raw = input as Record<string, unknown>;
  const readBag = (v: unknown): Partial<Record<ResourceType, number>> => {
    if (v === undefined || v === null) return {};
    if (typeof v !== 'object') fail('Malformed contract terms.');
    const bag: Partial<Record<ResourceType, number>> = {};
    for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
      if (!TRADABLE.includes(k as ResourceType)) fail(`Unknown resource in terms: ${k}`);
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 1000000) fail('Malformed contract amounts.');
      if (n > 0) bag[k as ResourceType] = n;
    }
    return bag;
  };
  const terms: ContractTerms = {
    give: readBag(raw.give),
    receive: readBag(raw.receive),
  };
  if (raw.intervalTicks !== undefined) terms.intervalTicks = intInRange(raw.intervalTicks, 10, 10000);
  if (raw.commanderId !== undefined) {
    if (typeof raw.commanderId !== 'string') fail('Malformed commander id.');
    terms.commanderId = raw.commanderId;
  }
  if (raw.note !== undefined) {
    if (typeof raw.note !== 'string' || raw.note.length > 280) fail('Notes are capped at 280 characters.');
    terms.note = raw.note;
  }
  return terms;
}

export function proposeContract(
  db: Db,
  state: GameState,
  player: PlayerState,
  toId: unknown,
  type: unknown,
  termsIn: unknown,
  durationTicks: unknown,
): Contract {
  requireLiveWorld(state);
  if (typeof toId !== 'string') fail('Choose a counterparty.');
  const other = state.players.get(toId);
  if (!other || other.defeated) fail('No such power sails these waters.');
  if (typeof type !== 'string' || !CONTRACT_TYPES.includes(type as ContractType)) fail('Unknown contract type.');
  const ctype = type as ContractType;
  const terms = sanitizeTerms(termsIn);
  const duration = intInRange(durationTicks ?? CONTRACT_MIN_DURATION_TICKS, 1, 100000);

  let captorHoldsCommander = false;
  if (ctype === 'ransom' && terms.commanderId) {
    const captive =
      other.commanders.find((c) => c.id === terms.commanderId && c.capturedById === player.id) ??
      player.commanders.find((c) => c.id === terms.commanderId && c.capturedById === other.id);
    captorHoldsCommander = !!captive && captive.status === 'captured';
  }

  const error = validateProposal(ctype, player.id, other.id, terms, duration, captorHoldsCommander);
  if (error) fail(error);

  const openBetween = [...state.contracts.values()].filter(
    (c) =>
      c.status === 'proposed' &&
      ((c.fromId === player.id && c.toId === other.id) || (c.fromId === other.id && c.toId === player.id)),
  );
  if (openBetween.length >= 5) fail('Too many open proposals between you two. Settle those first.');

  const contract = createProposal(newId(), ctype, player.id, other.id, terms, state.meta.tick, duration);
  state.contracts.set(contract.id, contract);
  addEvent(db, state, {
    type: 'contract',
    message: `${player.username} inscribed a ${ctype.replace('_', '-')} proposal to ${other.username} in The Ledger.`,
    actorId: player.id,
    targetId: other.id,
    isPublic: false,
  });
  return contract;
}

/** Transfer for one exchange cycle: from gives terms.give / receives terms.receive. */
function executeExchange(state: GameState, contract: Contract): string | null {
  const from = state.players.get(contract.fromId);
  const to = state.players.get(contract.toId);
  if (!from || !to) return 'A party has vanished from the world.';
  if (!canAfford(from.resources, contract.terms.give)) return `${from.username} cannot cover their side.`;
  if (!canAfford(to.resources, contract.terms.receive)) return `${to.username} cannot cover their side.`;
  from.resources = subResources(from.resources, contract.terms.give);
  to.resources = addResources(to.resources, contract.terms.give);
  to.resources = subResources(to.resources, contract.terms.receive);
  from.resources = addResources(from.resources, contract.terms.receive);
  return null;
}

export function respondContract(
  db: Db,
  state: GameState,
  player: PlayerState,
  contractId: unknown,
  accept: unknown,
): Contract {
  requireLiveWorld(state);
  if (typeof contractId !== 'string') fail('Malformed contract id.');
  const contract = state.contracts.get(contractId);
  if (!contract || contract.toId !== player.id) fail('No such proposal awaits your seal.');
  if (contract.status !== 'proposed') fail('That page of The Ledger has already turned.');
  const from = state.players.get(contract.fromId);
  if (!from) fail('The proposer has vanished from the world.');

  if (accept !== true) {
    contract.status = 'declined';
    addEvent(db, state, {
      type: 'contract',
      message: `${player.username} declined ${from.username}'s ${contract.type.replace('_', '-')} proposal.`,
      actorId: player.id,
      targetId: from.id,
      isPublic: false,
    });
    return contract;
  }

  if (contract.type === 'ransom') {
    const captive =
      player.commanders.find((c) => c.id === contract.terms.commanderId && c.status === 'captured') ??
      from.commanders.find((c) => c.id === contract.terms.commanderId && c.status === 'captured');
    if (!captive) fail('The captive is no longer held.');
    const err = executeExchange(state, contract);
    if (err) fail(err);
    captive.status = 'ready';
    delete captive.capturedById;
    contract.status = 'completed';
    for (const p of [from, player]) {
      p.reputation = clampReputation(p.reputation + REP_COMPLETE_CONTRACT);
      p.score += REP_COMPLETE_CONTRACT;
    }
    addEvent(db, state, {
      type: 'contract',
      message: `Commander ${captive.name} walks free — a ransom honored between ${from.username} and ${player.username}.`,
      actorId: from.id,
      targetId: player.id,
    });
    return contract;
  }

  if (contract.type === 'trade' && !contract.terms.intervalTicks) {
    const err = executeExchange(state, contract);
    if (err) fail(err);
    contract.status = 'completed';
    for (const p of [from, player]) p.reputation = clampReputation(p.reputation + REP_COMPLETE_CONTRACT);
  } else {
    contract.status = 'active';
    if (contract.terms.intervalTicks) {
      contract.nextDueTick = state.meta.tick + contract.terms.intervalTicks;
    }
  }
  addEvent(db, state, {
    type: 'contract',
    message: `The Ledger binds ${from.username} and ${player.username}: ${contract.type.replace('_', '-')} sealed.`,
    actorId: from.id,
    targetId: player.id,
  });
  return contract;
}

export function cancelContract(db: Db, state: GameState, player: PlayerState, contractId: unknown): Contract {
  if (typeof contractId !== 'string') fail('Malformed contract id.');
  const contract = state.contracts.get(contractId);
  if (!contract || (contract.fromId !== player.id && contract.toId !== player.id)) {
    fail('That page of The Ledger is not yours.');
  }
  if (contract.status === 'proposed') {
    if (contract.fromId !== player.id) fail('Respond to the proposal instead.');
    contract.status = 'declined';
    return contract;
  }
  if (contract.status !== 'active') fail('That contract is already closed.');
  contract.status = 'broken';
  player.reputation = clampReputation(player.reputation + REP_BREAK_CONTRACT);
  const other = state.players.get(contract.fromId === player.id ? contract.toId : contract.fromId);
  addEvent(db, state, {
    type: 'contract',
    message: `OATH BROKEN — ${player.username} tore their ${contract.type.replace('_', '-')} pact with ${other?.username ?? 'a lost soul'} from The Ledger.`,
    actorId: player.id,
    targetId: other?.id,
  });
  return contract;
}
