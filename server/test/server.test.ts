/**
 * Server integration tests: real SQLite (in-memory), real state, real ticks.
 * Covers the loops that unit tests can't: production accrual, tide destruction,
 * battle resolution through the tick engine, contract exchange, season rollover,
 * and the server-authoritative validation in actions.ts.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BATTLE_PREP_TICKS,
  hexNeighbors,
  SEASON_END_TIDE,
  SEASON_REST_TICKS,
  STARTING_RESOURCES,
  totalUnits,
} from '@tidehold/shared';
import { openDb, type Db } from '../src/db.js';
import { createPlayer, loadOrCreateState, tileAt, type GameState } from '../src/state.js';
import * as actions from '../src/actions.js';
import { ActionError } from '../src/actions.js';
import { runTick } from '../src/tick.js';
import { hashPassword, verifyPassword, createSession, sessionPlayerId } from '../src/auth.js';

let db: Db;
let state: GameState;

beforeEach(() => {
  db = openDb(`/tmp/tidehold-test-${Math.random().toString(36).slice(2)}.db`);
  state = loadOrCreateState(db);
});

function newPlayer(name: string) {
  const p = createPlayer(db, state, name, hashPassword('salt-and-oath'));
  expect(p).not.toBeNull();
  return p!;
}

describe('auth', () => {
  it('hashes and verifies passwords, rejects wrong ones', () => {
    const hash = hashPassword('correct horse');
    expect(verifyPassword('correct horse', hash)).toBe(true);
    expect(verifyPassword('wrong horse', hash)).toBe(false);
    expect(verifyPassword('x', 'garbage')).toBe(false);
  });

  it('sessions resolve to players and unknown tokens to null', () => {
    const p = newPlayer('Sess');
    const token = createSession(db, p.id);
    expect(sessionPlayerId(db, token)).toBe(p.id);
    expect(sessionPlayerId(db, 'not-a-token')).toBeNull();
    expect(sessionPlayerId(db, undefined)).toBeNull();
  });
});

describe('spawning', () => {
  it('spawns players on live land with starting kit', () => {
    const p = newPlayer('Spawn');
    const tile = tileAt(state, p.ark.q, p.ark.r);
    expect(tile).toBeDefined();
    expect(tile!.flooded).toBe(false);
    expect(p.resources).toEqual(STARTING_RESOURCES);
    expect(p.commanders).toHaveLength(2);
  });

  it('keeps spawning even on a nearly-drowned world', () => {
    state.meta.tideLevel = SEASON_END_TIDE - 1;
    // flood everything below the line, as the tide would have
    for (const t of state.tiles) {
      if (t.elevation <= state.meta.tideLevel) {
        t.flooded = true;
        t.terrain = 'ocean';
      }
    }
    const p = newPlayer('LateJoiner');
    const tile = tileAt(state, p.ark.q, p.ark.r)!;
    expect(tile.flooded).toBe(false);
  });
});

describe('server-authoritative validation', () => {
  it('rejects claims outside influence, on water, and when broke', () => {
    const p = newPlayer('Rules');
    const far = state.tiles.find((t) => !t.flooded && !t.ownerId && Math.abs(t.q - p.ark.q) > 15);
    expect(() => actions.claimTile(db, state, p, far!.q, far!.r)).toThrow(ActionError);
    const ocean = state.tiles.find((t) => t.terrain === 'ocean')!;
    expect(() => actions.claimTile(db, state, p, ocean.q, ocean.r)).toThrow(ActionError);
    expect(() => actions.claimTile(db, state, p, 9999, 9999)).toThrow(ActionError);
  });

  it('rejects malformed unit payloads outright', () => {
    const p = newPlayer('Cheater');
    for (const units of [
      { shields: -1, blades: 0, bows: 0 },
      { shields: 1.5, blades: 0, bows: 0 },
      { shields: 99999, blades: 0, bows: 0 },
      'nonsense',
      null,
    ]) {
      expect(() => actions.recruit(db, state, p, units)).toThrow(ActionError);
    }
  });

  it('port needs shoreline; other buildings need their terrain', () => {
    const p = newPlayer('Docks');
    // find a claimable tile NOT touching water near the ark
    const inland = state.tiles.find(
      (t) =>
        !t.flooded &&
        !t.ownerId &&
        t.terrain === 'plains' &&
        Math.max(Math.abs(t.q - p.ark.q), Math.abs(t.r - p.ark.r)) <= 3 &&
        hexNeighbors(t).every((nb) => {
          const n = tileAt(state, nb.q, nb.r);
          return n && !n.flooded && n.terrain !== 'ocean' && n.terrain !== 'drowned';
        }),
    );
    if (inland) {
      actions.claimTile(db, state, p, inland.q, inland.r);
      expect(() => actions.build(db, state, p, inland.q, inland.r, 'port')).toThrow(/shoreline|doorstep/i);
      expect(() => actions.build(db, state, p, inland.q, inland.r, 'mine')).toThrow(ActionError);
      actions.build(db, state, p, inland.q, inland.r, 'farm');
      expect(tileAt(state, inland.q, inland.r)!.building?.type).toBe('farm');
    }
  });
});

describe('the tick engine', () => {
  it('production accrues to building owners', () => {
    const p = newPlayer('Farmer');
    const spot = state.tiles.find(
      (t) => !t.flooded && !t.ownerId && ['plains', 'coast'].includes(t.terrain) &&
        Math.abs(t.q - p.ark.q) + Math.abs(t.r - p.ark.r) < 8,
    )!;
    actions.claimTile(db, state, p, spot.q, spot.r);
    actions.build(db, state, p, spot.q, spot.r, 'farm');
    const foodBefore = p.resources.food;
    runTick(db, state);
    expect(p.resources.food).toBeGreaterThan(foodBefore);
  });

  it('the tide floods, destroys, and reports', () => {
    const p = newPlayer('Doomed');
    // Claim + build on the lowest claimable land near the ark, then raise the sea.
    const low = state.tiles
      .filter((t) => !t.flooded && !t.ownerId && ['plains', 'coast'].includes(t.terrain))
      .sort((a, b) => a.elevation - b.elevation)[0]!;
    low.ownerId = p.id;
    low.building = { type: 'farm', level: 1, ownerId: p.id };

    state.meta.nextTideTick = state.meta.tick + 1;
    // Force enough tide to swallow that tile.
    const target = low.elevation;
    let rose = 0;
    for (let i = 0; i < 400 && state.meta.tideLevel < target; i++) {
      const res = runTick(db, state);
      if (res.tideRose) rose++;
      state.meta.nextTideTick = state.meta.tick + 1; // accelerate
    }
    expect(rose).toBeGreaterThan(0);
    expect(low.flooded).toBe(true);
    expect(low.building).toBeUndefined();
    expect(low.ownerId).toBeUndefined();
  });

  it('battles resolve through the prep window and loot flows', () => {
    const attacker = newPlayer('Wolf');
    const defender = newPlayer('Sheep');
    // Stage: defender owns a built tile adjacent to attacker's army.
    const spot = state.tiles.find(
      (t) => !t.flooded && !t.ownerId && t.terrain !== 'ruins' &&
        Math.abs(t.q - attacker.ark.q) + Math.abs(t.r - attacker.ark.r) <= 2,
    )!;
    spot.ownerId = defender.id;
    spot.building = { type: 'farm', level: 1, ownerId: defender.id };

    attacker.resources = { timber: 999, ore: 999, food: 999, relics: 0 };
    const army = actions.recruit(db, state, attacker, { shields: 30, blades: 30, bows: 20 });
    // Teleport the army adjacent for the test (movement is covered by E2E).
    const nb = hexNeighbors(spot).map((c) => tileAt(state, c.q, c.r)).find((t) => t)!;
    army.q = nb.q;
    army.r = nb.r;

    const battle = actions.attack(db, state, attacker, army.id, spot.q, spot.r);
    expect(battle.resolveTick).toBe(state.meta.tick + BATTLE_PREP_TICKS);
    expect(army.battleId).toBe(battle.id);
    // Attacker took the unprovoked-attack rep hit at declaration time.
    expect(attacker.reputation).toBeLessThan(100);

    const defFoodBefore = defender.resources.food;
    let reports: ReturnType<typeof runTick>['battleReports'] = [];
    for (let i = 0; i <= BATTLE_PREP_TICKS + 1 && reports.length === 0; i++) {
      reports = runTick(db, state).battleReports;
    }
    expect(reports).toHaveLength(1);
    const report = reports[0];
    expect(report.narrative.length).toBeGreaterThan(20);
    // 80 troops vs an undefended farm: the attacker razes it.
    expect(report.winner).toBe('attacker');
    expect(tileAt(state, spot.q, spot.r)!.building).toBeUndefined();
    expect(defender.resources.food).toBeLessThanOrEqual(defFoodBefore);
    expect(army.battleId).toBeUndefined();
  });

  it('recurring contract exchanges transfer resources and defaults break', () => {
    const a = newPlayer('Alpha');
    const b = newPlayer('Beta');
    const contract = actions.proposeContract(
      db, state, a, b.id, 'trade',
      { give: { timber: 10 }, receive: { ore: 5 }, intervalTicks: 10 },
      600,
    );
    actions.respondContract(db, state, b, contract.id, true);
    expect(contract.status).toBe('active');

    const aT = a.resources.timber;
    const bO = b.resources.ore;
    for (let i = 0; i < 11; i++) runTick(db, state);
    expect(a.resources.timber).toBeLessThan(aT); // gave timber (production may offset slightly, no farms though)
    expect(b.resources.ore).toBeLessThan(bO); // gave ore back

    // Bankrupt a → default → broken + rep hit.
    a.resources.timber = 0;
    const repBefore = a.reputation;
    for (let i = 0; i < 11 && contract.status === 'active'; i++) runTick(db, state);
    expect(contract.status).toBe('broken');
    expect(a.reputation).toBeLessThan(repBefore);
  });

  it('season ends at the last tide and a new world rises after the rest', () => {
    newPlayer('Endurer');
    state.meta.tideLevel = SEASON_END_TIDE - 1;
    state.meta.nextTideTick = state.meta.tick + 1;
    runTick(db, state); // final rise
    expect(state.meta.tideLevel).toBe(SEASON_END_TIDE);
    expect(state.meta.phase).toBe('ended');
    const season = state.meta.season;

    // Actions are frozen during the rest.
    const p = [...state.players.values()][0];
    expect(() => actions.recruit(db, state, p, { shields: 1, blades: 0, bows: 0 })).toThrow(/season has ended/i);

    for (let i = 0; i <= SEASON_REST_TICKS + 1; i++) runTick(db, state);
    expect(state.meta.season).toBe(season + 1);
    expect(state.meta.tideLevel).toBe(0);
    expect(state.meta.phase).toBe('expansion');
    expect(state.tiles.some((t) => !t.flooded)).toBe(true);
    for (const pl of state.players.values()) {
      expect(pl.score).toBe(0);
      expect(tileAt(state, pl.ark.q, pl.ark.r)!.flooded).toBe(false);
    }
  });
});

describe('persistence round-trip', () => {
  it('state survives a save/load cycle', () => {
    const p = newPlayer('Persist');
    const spot = state.tiles.find(
      (t) => !t.flooded && !t.ownerId && ['plains', 'coast'].includes(t.terrain) &&
        Math.abs(t.q - p.ark.q) + Math.abs(t.r - p.ark.r) < 8,
    )!;
    actions.claimTile(db, state, p, spot.q, spot.r);
    runTick(db, state); // persists

    const reloaded = loadOrCreateState(db);
    expect(reloaded.meta.tick).toBe(state.meta.tick);
    expect(reloaded.players.get(p.id)?.username).toBe('Persist');
    expect(tileAt(reloaded, spot.q, spot.r)!.ownerId).toBe(p.id);
  });
});
