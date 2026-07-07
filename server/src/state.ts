/**
 * Authoritative in-memory game state, persistence, and snapshot building.
 * All mutation happens on the server; SQLite is flushed each tick.
 */
import crypto from 'node:crypto';
import {
  ARK_BASE_HP,
  ARK_HP_PER_LEVEL,
  createMarket,
  generateWorld,
  hash2,
  hexDistance,
  hexKey,
  MAX_ELEVATION,
  rng,
  STARTING_REPUTATION,
  STARTING_RESOURCES,
  STARTING_SHELLS,
  OATHBREAKER_THRESHOLD,
  type Army,
  type Battle,
  type Commander,
  type Contract,
  type Expedition,
  type GameEvent,
  type GameEventType,
  type MarketState,
  type PlayerState,
  type PublicPlayerInfo,
  type Tile,
  type WorldMeta,
} from '@tidehold/shared';
import type { Db } from './db.js';
import { config } from './config.js';

export interface GameState {
  meta: WorldMeta;
  tiles: Tile[];
  tileMap: Map<string, Tile>;
  players: Map<string, PlayerState>;
  armies: Map<string, Army>;
  battles: Map<string, Battle>;
  expeditions: Map<string, Expedition>;
  contracts: Map<string, Contract>;
  market: MarketState;
  /** Monotonic counter for deterministic per-event seeds. */
  entityCounter: number;
}

// ---------------------------------------------------------------------------
// Load / create / persist
// ---------------------------------------------------------------------------

export function loadOrCreateState(db: Db): GameState {
  const metaRow = db.prepare('SELECT v FROM meta WHERE k = ?').get('world') as
    | { v: string }
    | undefined;

  if (metaRow) {
    const meta = JSON.parse(metaRow.v) as WorldMeta & { entityCounter?: number };
    meta.tickSeconds = config.tickSeconds;
    meta.tideIntervalTicks = config.tideIntervalTicks;
    const tiles = (db.prepare('SELECT v FROM tiles').all() as { v: string }[]).map(
      (r) => JSON.parse(r.v) as Tile,
    );
    const state: GameState = {
      meta,
      tiles,
      tileMap: new Map(tiles.map((t) => [hexKey(t.q, t.r), t])),
      players: loadMap<PlayerState>(db, 'SELECT state as v FROM players'),
      armies: loadMap<Army>(db, 'SELECT v FROM armies'),
      battles: loadMap<Battle>(db, 'SELECT v FROM battles'),
      expeditions: loadMap<Expedition>(db, 'SELECT v FROM expeditions'),
      contracts: loadMap<Contract>(db, 'SELECT v FROM contracts'),
      market: JSON.parse(
        (db.prepare('SELECT v FROM meta WHERE k = ?').get('market') as { v: string }).v,
      ) as MarketState,
      entityCounter: meta.entityCounter ?? 1,
    };
    return state;
  }

  const meta: WorldMeta = {
    seed: config.worldSeed,
    radius: config.worldRadius,
    tick: 0,
    tideLevel: 0,
    nextTideTick: config.tideIntervalTicks,
    phase: 'expansion',
    season: 1,
    tickSeconds: config.tickSeconds,
    tideIntervalTicks: config.tideIntervalTicks,
  };
  const tiles = generateWorld(meta.seed, meta.radius);
  const state: GameState = {
    meta,
    tiles,
    tileMap: new Map(tiles.map((t) => [hexKey(t.q, t.r), t])),
    players: new Map(),
    armies: new Map(),
    battles: new Map(),
    expeditions: new Map(),
    contracts: new Map(),
    market: createMarket(),
    entityCounter: 1,
  };
  persistAll(db, state);
  return state;
}

function loadMap<T extends { id: string }>(db: Db, sql: string): Map<string, T> {
  const rows = db.prepare(sql).all() as { v: string }[];
  return new Map(rows.map((r) => {
    const val = JSON.parse(r.v) as T;
    return [val.id, val];
  }));
}

export function persistAll(db: Db, state: GameState): void {
  const upsertMeta = db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v');
  const upsertTile = db.prepare('INSERT INTO tiles (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v');
  const upsertPlayer = db.prepare('UPDATE players SET state = ? WHERE id = ?');
  const replaceDoc = (table: string) =>
    db.prepare(`INSERT INTO ${table} (id, v) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET v = excluded.v`);
  const upsertArmy = replaceDoc('armies');
  const upsertBattle = replaceDoc('battles');
  const upsertExpedition = replaceDoc('expeditions');
  const upsertContract = replaceDoc('contracts');

  const tx = db.transaction(() => {
    upsertMeta.run('world', JSON.stringify({ ...state.meta, entityCounter: state.entityCounter }));
    upsertMeta.run('market', JSON.stringify(state.market));
    for (const t of state.tiles) upsertTile.run(hexKey(t.q, t.r), JSON.stringify(t));
    for (const p of state.players.values()) upsertPlayer.run(JSON.stringify(p), p.id);
    db.prepare('DELETE FROM armies').run();
    for (const a of state.armies.values()) upsertArmy.run(a.id, JSON.stringify(a));
    db.prepare('DELETE FROM battles').run();
    for (const b of state.battles.values()) upsertBattle.run(b.id, JSON.stringify(b));
    db.prepare('DELETE FROM expeditions').run();
    for (const e of state.expeditions.values()) upsertExpedition.run(e.id, JSON.stringify(e));
    for (const c of state.contracts.values()) upsertContract.run(c.id, JSON.stringify(c));
  });
  tx();
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type EventListener = (ev: GameEvent) => void;
const eventListeners: EventListener[] = [];

export function onEvent(fn: EventListener): void {
  eventListeners.push(fn);
}

export function addEvent(
  db: Db,
  state: GameState,
  ev: {
    type: GameEventType;
    message: string;
    actorId?: string;
    targetId?: string;
    q?: number;
    r?: number;
    isPublic?: boolean;
  },
): GameEvent {
  const isPublic = ev.isPublic ?? true;
  const info = db
    .prepare(
      'INSERT INTO events (tick, type, message, actor_id, target_id, q, r, is_public) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      state.meta.tick,
      ev.type,
      ev.message,
      ev.actorId ?? null,
      ev.targetId ?? null,
      ev.q ?? null,
      ev.r ?? null,
      isPublic ? 1 : 0,
    );
  const event: GameEvent = {
    id: Number(info.lastInsertRowid),
    tick: state.meta.tick,
    type: ev.type,
    message: ev.message,
    actorId: ev.actorId,
    targetId: ev.targetId,
    q: ev.q,
    r: ev.r,
    isPublic,
  };
  for (const fn of eventListeners) fn(event);
  return event;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function tileAt(state: GameState, q: number, r: number): Tile | undefined {
  return state.tileMap.get(hexKey(q, r));
}

export function armiesAt(state: GameState, q: number, r: number): Army[] {
  const out: Army[] = [];
  for (const a of state.armies.values()) if (a.q === q && a.r === r) out.push(a);
  return out;
}

export function ownedTileCount(state: GameState, playerId: string): number {
  let n = 0;
  for (const t of state.tiles) if (t.ownerId === playerId) n++;
  return n;
}

export function newId(): string {
  return crypto.randomUUID();
}

/** Deterministic seed for the next game-logic random event. */
export function nextSeed(state: GameState): number {
  state.entityCounter++;
  return hash2(state.entityCounter, state.meta.tick, state.meta.seed);
}

// ---------------------------------------------------------------------------
// Player spawning
// ---------------------------------------------------------------------------

const COMMANDER_NAMES = [
  'Maren', 'Odessa', 'Kael', 'Brackish Tom', 'Yseult', 'Harrow', 'Pell',
  'Signe', 'Corvo', 'Ilse', 'Fenn', 'Amara', 'Dredge', 'Liv', 'Oro',
  'Selk', 'Nerissa', 'Gull', 'Tarn', 'Vesper',
];
const TRAITS = ['aggression', 'bulwark', 'logistics'] as const;

function makeCommanders(seed: number): Commander[] {
  const r = rng(seed);
  const names = [...COMMANDER_NAMES];
  const out: Commander[] = [];
  for (let i = 0; i < 2; i++) {
    const name = names.splice(r.int(0, names.length - 1), 1)[0];
    out.push({
      id: newId(),
      name,
      trait: TRAITS[r.int(0, 2)],
      level: 1,
      status: 'ready',
    });
  }
  // Guarantee at least one combat-relevant trait so new players always have
  // a meaningful battle commander.
  if (out.every((c) => c.trait === 'logistics')) out[0].trait = 'aggression';
  return out;
}

/**
 * Choose a spawn tile: unflooded land with breathing room above the current
 * waterline, far from other Arks. Late in the season the constraints relax —
 * a newcomer always gets whatever land the sea has left.
 */
export function findSpawnTile(state: GameState): Tile | null {
  const arks = [...state.players.values()].filter((p) => !p.defeated).map((p) => p.ark);
  const tide = state.meta.tideLevel;
  const candidates = state.tiles.filter(
    (t) =>
      !t.flooded &&
      t.terrain !== 'ruins' &&
      t.terrain !== 'ocean' &&
      t.terrain !== 'drowned' &&
      !t.building &&
      !t.ownerId &&
      !arks.some((a) => a.q === t.q && a.r === t.r),
  );
  const idealElevation = Math.min(MAX_ELEVATION, tide + 3);
  const score = (t: Tile, minArkDist: number) =>
    Math.min(minArkDist, 14) +
    (t.richness - 1) * 0.75 -
    Math.abs(t.elevation - idealElevation) * 0.4;

  let best: Tile | null = null;
  let bestScore = -Infinity;
  for (const minDist of [6, 3, 1]) {
    for (const t of candidates) {
      let minArkDist = Infinity;
      for (const a of arks) minArkDist = Math.min(minArkDist, hexDistance(t, a));
      if (minArkDist < minDist) continue;
      const sc = score(t, minArkDist);
      if (sc > bestScore) {
        bestScore = sc;
        best = t;
      }
    }
    if (best) break; // relax the ark-distance rule only when the world is crowded
  }
  return best;
}

export function createPlayer(
  db: Db,
  state: GameState,
  username: string,
  passhash: string,
): PlayerState | null {
  const spawn = findSpawnTile(state);
  if (!spawn) return null;
  const id = newId();
  const player: PlayerState = {
    id,
    username,
    ark: {
      q: spawn.q,
      r: spawn.r,
      level: 1,
      hp: ARK_BASE_HP + ARK_HP_PER_LEVEL,
      maxHp: ARK_BASE_HP + ARK_HP_PER_LEVEL,
      moveReadyTick: 0,
      damagedUntilTick: 0,
    },
    resources: { ...STARTING_RESOURCES },
    shells: STARTING_SHELLS,
    reputation: STARTING_REPUTATION,
    score: 0,
    techs: [],
    commanders: makeCommanders(nextSeed(state)),
    createdTick: state.meta.tick,
    lastSeenTick: state.meta.tick,
    defeated: false,
  };
  db.prepare('INSERT INTO players (id, username, passhash, state) VALUES (?, ?, ?, ?)').run(
    id,
    username,
    passhash,
    JSON.stringify(player),
  );
  state.players.set(id, player);
  return player;
}

// ---------------------------------------------------------------------------
// Season rollover — the sea always wins; the world always returns.
// ---------------------------------------------------------------------------

/**
 * Regenerate the world for a new season. Accounts and reputation persist;
 * everything on the map — and every seasonal gain — starts fresh.
 */
export function startNewSeason(db: Db, state: GameState): void {
  const meta = state.meta;
  meta.season++;
  meta.seed = hash2(meta.season, 0x5ea, meta.seed);
  meta.tideLevel = 0;
  meta.nextTideTick = meta.tick + meta.tideIntervalTicks;
  meta.phase = 'expansion';
  delete meta.endedAtTick;

  const tiles = generateWorld(meta.seed, meta.radius);
  state.tiles = tiles;
  state.tileMap = new Map(tiles.map((t) => [hexKey(t.q, t.r), t]));
  state.armies.clear();
  state.battles.clear();
  state.expeditions.clear();
  state.contracts.clear();
  state.market = createMarket();

  db.prepare('DELETE FROM tiles').run();
  db.prepare('DELETE FROM armies').run();
  db.prepare('DELETE FROM battles').run();
  db.prepare('DELETE FROM expeditions').run();
  db.prepare('DELETE FROM contracts').run();

  for (const p of state.players.values()) {
    p.resources = { ...STARTING_RESOURCES };
    p.shells = STARTING_SHELLS;
    p.score = 0;
    p.techs = [];
    p.defeated = false;
    for (const c of p.commanders) {
      c.status = 'ready';
      delete c.capturedById;
    }
    p.ark.level = 1;
    p.ark.maxHp = ARK_BASE_HP + ARK_HP_PER_LEVEL;
    p.ark.hp = p.ark.maxHp;
    p.ark.moveReadyTick = 0;
    p.ark.damagedUntilTick = 0;
    const spawn = findSpawnTile(state);
    if (spawn) {
      p.ark.q = spawn.q;
      p.ark.r = spawn.r;
    }
    // Reputation persists across seasons — fame and infamy outlive the flood.
  }

  addEvent(db, state, {
    type: 'season',
    message: `SEASON ${meta.season} — the waters recede over a new continent. Every Ark finds new shores. The Tide, as ever, is already rising.`,
  });
}

// ---------------------------------------------------------------------------
// Snapshots (what clients see)
// ---------------------------------------------------------------------------

export function publicPlayerInfo(state: GameState, p: PlayerState): PublicPlayerInfo {
  return {
    id: p.id,
    username: p.username,
    score: Math.round(p.score),
    reputation: Math.round(p.reputation),
    isOathbreaker: p.reputation < OATHBREAKER_THRESHOLD,
    defeated: p.defeated,
    ark: { q: p.ark.q, r: p.ark.r, level: p.ark.level },
    tilesOwned: ownedTileCount(state, p.id),
  };
}

/**
 * Armies as seen by `viewerId`. Own armies: full detail. Enemy armies are
 * visible as positions with unit counts rounded to a band unless "scouted":
 * within 3 hexes of the viewer's Ark, any army, or a watchtower tile.
 */
export function visibleArmies(state: GameState, viewerId: string | null): Army[] {
  const viewer = viewerId ? state.players.get(viewerId) : undefined;
  const scoutPoints: { q: number; r: number }[] = [];
  if (viewer) {
    scoutPoints.push(viewer.ark);
    for (const a of state.armies.values()) if (a.ownerId === viewerId) scoutPoints.push(a);
    for (const t of state.tiles)
      if (t.building?.type === 'watchtower' && t.building.ownerId === viewerId) scoutPoints.push(t);
  }
  const out: Army[] = [];
  for (const a of state.armies.values()) {
    if (viewer && a.ownerId === viewerId) {
      out.push(a);
      continue;
    }
    const scouted = scoutPoints.some((p) => hexDistance(p, a) <= 3);
    if (scouted) {
      out.push({ ...a, path: [] });
    } else {
      // Fog-of-strength: report only a band (10 / 50 / 100 / 200).
      const total = a.units.shields + a.units.blades + a.units.bows;
      const band = total <= 10 ? 10 : total <= 50 ? 50 : total <= 100 ? 100 : 200;
      out.push({
        ...a,
        path: [],
        units: { shields: 0, blades: 0, bows: band },
      });
    }
  }
  return out;
}

export function worldSnapshot(state: GameState, viewerId: string | null) {
  return {
    meta: state.meta,
    tiles: state.tiles,
    players: [...state.players.values()].map((p) => publicPlayerInfo(state, p)),
    armies: visibleArmies(state, viewerId),
    battles: [...state.battles.values()],
    market: state.market,
  };
}
