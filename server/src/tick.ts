/**
 * The tick engine — the heartbeat of the drowning world.
 * Order each tick: production → upkeep → movement → battles → expeditions →
 * contracts → market → reputation drift → tide → persist → broadcast.
 */
import {
  addResources,
  applyTide,
  ARK_DAMAGE_TICKS,
  ARK_PLUNDER_FRACTION,
  armyUpkeep,
  BATTLE_LOOT_FRACTION,
  clampReputation,
  contractExchangeApplied,
  dueExchanges,
  expireContracts,
  hexDistance,
  hexNeighbors,
  isOathbreaker,
  phaseForTide,
  REP_BREAK_CONTRACT,
  REP_TRADE_TICK,
  REP_REGEN_PER_100_TICKS,
  resolveBattle,
  resolveExpedition,
  SCORE_BATTLE_WON,
  SCORE_RUIN_CLEARED,
  SCORE_TILE_SURVIVES_TIDE,
  SEASON_END_TIDE,
  SEASON_REST_TICKS,
  STARTING_REPUTATION,
  scaleResources,
  subResources,
  tickMarket,
  tileProduction,
  totalUnits,
  WATCHTOWER_DEFENSE_BONUS,
  type Army,
  type BattleReport,
  type PlayerState,
  type Tile,
  type UnitCounts,
} from '@tidehold/shared';
import type { Db } from './db.js';
import { config } from './config.js';
import {
  addEvent,
  armiesAt,
  nextSeed,
  persistAll,
  startNewSeason,
  tileAt,
  type GameState,
} from './state.js';
import { stepCost } from './actions.js';

export interface TickResult {
  dirtyTiles: Tile[];
  battleReports: BattleReport[];
  tideRose: boolean;
}

const STARVATION_DESERTION = 0.08;

export function runTick(db: Db, state: GameState): TickResult {
  state.meta.tick++;
  const tick = state.meta.tick;
  const dirty = new Map<string, Tile>();
  const battleReports: BattleReport[] = [];
  const markDirty = (t: Tile) => dirty.set(`${t.q},${t.r}`, t);

  if (state.meta.phase !== 'ended') {
    runProduction(state, tick);
    runUpkeep(db, state);
    runMovement(state, tick);
    runBattles(db, state, tick, markDirty, battleReports);
    runExpeditions(db, state, tick, markDirty);
    runContracts(db, state, tick);
    tickMarket(state.market, state.meta.tideLevel);
    runReputationDrift(state, tick);
  } else if (tick >= (state.meta.endedAtTick ?? tick) + SEASON_REST_TICKS) {
    // The rest between seasons is over — raise a new continent.
    startNewSeason(db, state);
    for (const t of state.tiles) markDirty(t);
  }

  const tideRose = runTide(db, state, tick, markDirty);

  persistAll(db, state);
  return { dirtyTiles: [...dirty.values()], battleReports, tideRose };
}

// ---------------------------------------------------------------------------

function runProduction(state: GameState, tick: number): void {
  for (const tile of state.tiles) {
    if (!tile.building) continue;
    const owner = state.players.get(tile.building.ownerId);
    if (!owner || owner.defeated) continue;
    const prod = tileProduction(tile, owner, tick);
    owner.resources = addResources(owner.resources, prod);
  }
}

function runUpkeep(db: Db, state: GameState): void {
  const upkeepByPlayer = new Map<string, number>();
  for (const army of state.armies.values()) {
    upkeepByPlayer.set(army.ownerId, (upkeepByPlayer.get(army.ownerId) ?? 0) + armyUpkeep(army.units));
  }
  for (const [playerId, upkeep] of upkeepByPlayer) {
    const player = state.players.get(playerId);
    if (!player) continue;
    if (player.resources.food >= upkeep) {
      player.resources.food -= upkeep;
      continue;
    }
    // Starvation: troops desert.
    player.resources.food = 0;
    let deserted = 0;
    for (const army of state.armies.values()) {
      if (army.ownerId !== playerId) continue;
      for (const u of ['shields', 'blades', 'bows'] as const) {
        const loss = Math.ceil(army.units[u] * STARVATION_DESERTION);
        army.units[u] -= loss;
        deserted += loss;
      }
      if (totalUnits(army.units) <= 0 && !army.battleId) state.armies.delete(army.id);
    }
    if (deserted > 0) {
      addEvent(db, state, {
        type: 'player',
        message: `Hunger stalks ${player.username}'s camps — ${deserted} soldiers deserted.`,
        actorId: playerId,
        isPublic: false,
      });
    }
  }
}

function runMovement(state: GameState, tick: number): void {
  for (const army of state.armies.values()) {
    if (army.battleId || army.path.length === 0 || army.nextMoveTick > tick) continue;
    const step = army.path.shift()!;
    army.q = step.q;
    army.r = step.r;
    // Merge with an idle friendly army on the same tile.
    const here = armiesAt(state, army.q, army.r).filter(
      (a) => a.id !== army.id && a.ownerId === army.ownerId && !a.battleId,
    );
    for (const other of here) {
      army.units.shields += other.units.shields;
      army.units.blades += other.units.blades;
      army.units.bows += other.units.bows;
      if (!army.commanderId && other.commanderId) army.commanderId = other.commanderId;
      state.armies.delete(other.id);
    }
    if (army.path.length > 0) {
      const owner = state.players.get(army.ownerId);
      const next = tileAt(state, army.path[0].q, army.path[0].r);
      if (!owner || !next) {
        army.path = [];
        continue;
      }
      army.nextMoveTick = tick + stepCost(state, army, owner, next);
    }
  }
}

// ---------------------------------------------------------------------------
// Battles
// ---------------------------------------------------------------------------

function emptyUnits(): UnitCounts {
  return { shields: 0, blades: 0, bows: 0 };
}

/** Highest friendly watchtower level covering a tile (tile itself or neighbor). */
function watchtowerLevelAt(state: GameState, tile: Tile, defenderId?: string): number {
  let best = 0;
  const consider = (t: Tile | undefined) => {
    if (!t?.building || t.building.type !== 'watchtower') return;
    if (defenderId && t.building.ownerId !== defenderId) return;
    if (t.building.disabledUntilTick && t.building.disabledUntilTick > state.meta.tick) return;
    best = Math.max(best, t.building.level);
  };
  consider(tile);
  for (const nb of hexNeighbors(tile)) consider(tileAt(state, nb.q, nb.r));
  return best;
}

function runBattles(
  db: Db,
  state: GameState,
  tick: number,
  markDirty: (t: Tile) => void,
  battleReports: BattleReport[],
): void {
  for (const battle of [...state.battles.values()]) {
    if (battle.resolveTick > tick) continue;
    state.battles.delete(battle.id);

    const attackerArmy = state.armies.get(battle.attackerArmyId);
    const attacker = state.players.get(battle.attackerId);
    const tile = tileAt(state, battle.target.q, battle.target.r);
    if (!attackerArmy || !attacker || !tile || totalUnits(attackerArmy.units) === 0) {
      if (attackerArmy) delete attackerArmy.battleId;
      continue;
    }
    delete attackerArmy.battleId;
    if (tile.flooded) {
      addEvent(db, state, {
        type: 'battle',
        message: `The sea settled the matter first — the battlefield at (${tile.q}, ${tile.r}) drowned before blades met.`,
        actorId: battle.attackerId,
        q: tile.q,
        r: tile.r,
      });
      continue;
    }

    // Reassess the defense at resolution time (reinforce/evacuate window).
    const defenderId = battle.defenderId;
    const defender = defenderId ? state.players.get(defenderId) : undefined;
    const defenderArmies = defenderId
      ? armiesAt(state, tile.q, tile.r).filter((a) => a.ownerId === defenderId)
      : [];
    const defenderUnits = defenderArmies.reduce(
      (acc, a) => ({
        shields: acc.shields + a.units.shields,
        blades: acc.blades + a.units.blades,
        bows: acc.bows + a.units.bows,
      }),
      emptyUnits(),
    );
    const defenderCommander = defender
      ? defenderArmies
          .map((a) => defender.commanders.find((c) => c.id === a.commanderId))
          .find((c) => c !== undefined)
      : undefined;
    const attackerCommander = attacker.commanders.find((c) => c.id === attackerArmy.commanderId);
    const garrison = tile.garrison ?? 0;
    const arkPresent = defender && defender.ark.q === tile.q && defender.ark.r === tile.r;

    if (!defender && garrison <= 0) continue; // nothing left to fight

    const report = resolveBattle({
      battleId: battle.id,
      tick,
      target: { q: tile.q, r: tile.r },
      attacker: { playerId: attacker.id, units: { ...attackerArmy.units }, commander: attackerCommander },
      defender: { playerId: defender?.id, units: defenderUnits, commander: defenderCommander },
      garrison,
      terrain: tile.terrain,
      watchtowerLevel: watchtowerLevelAt(state, tile, defenderId),
      seed: nextSeed(state),
    });

    // -- Apply attacker losses.
    applyLosses(state, [attackerArmy], report.attacker.losses, attacker);
    // -- Apply defender losses.
    if (defender) applyLosses(state, defenderArmies, report.defender.losses, defender);

    let loot: Partial<Record<'timber' | 'ore' | 'food' | 'relics', number>> = {};

    if (report.winner === 'attacker') {
      attacker.score += defender ? SCORE_BATTLE_WON : 0;

      if (garrison > 0) {
        tile.garrison = 0;
        attacker.score += SCORE_RUIN_CLEARED;
        const relics = tile.ruinTier ?? 1;
        attacker.resources = addResources(attacker.resources, { relics });
        loot = addPartial(loot, { relics });
        markDirty(tile);
      }

      if (defender) {
        if (tile.building && tile.building.ownerId === defender.id) {
          const spoils = scaleResources(defender.resources, BATTLE_LOOT_FRACTION);
          defender.resources = subResources(defender.resources, spoils);
          attacker.resources = addResources(attacker.resources, spoils);
          loot = addPartial(loot, spoils);
          delete tile.building;
          delete tile.ownerId;
          markDirty(tile);
        } else if (tile.ownerId === defender.id) {
          delete tile.ownerId;
          markDirty(tile);
        }

        if (arkPresent) {
          const plunder = scaleResources(defender.resources, ARK_PLUNDER_FRACTION);
          defender.resources = subResources(defender.resources, plunder);
          attacker.resources = addResources(attacker.resources, plunder);
          loot = addPartial(loot, plunder);
          defender.ark.hp = Math.max(1, Math.floor(defender.ark.hp / 2));
          defender.ark.damagedUntilTick = tick + ARK_DAMAGE_TICKS;
          relocateArk(db, state, defender, tile);
        }

        if (report.capturedCommanderId) {
          const captive = defender.commanders.find((c) => c.id === report.capturedCommanderId);
          if (captive) {
            captive.status = 'captured';
            captive.capturedById = attacker.id;
          }
        }
      }
    } else {
      // Defender victorious.
      if (defender) defender.score += SCORE_BATTLE_WON;
      if (report.capturedCommanderId) {
        const captive = attacker.commanders.find((c) => c.id === report.capturedCommanderId);
        if (captive && defender) {
          captive.status = 'captured';
          captive.capturedById = defender.id;
        }
      }
    }

    report.loot = loot;
    battleReports.push(report);
    db.prepare('INSERT INTO battle_reports (id, tick, v) VALUES (?, ?, ?)').run(
      report.battleId,
      tick,
      JSON.stringify(report),
    );
    addEvent(db, state, {
      type: 'battle',
      message: report.narrative,
      actorId: attacker.id,
      targetId: defender?.id,
      q: tile.q,
      r: tile.r,
    });
  }
}

function addPartial(
  a: Partial<Record<'timber' | 'ore' | 'food' | 'relics', number>>,
  b: Partial<Record<'timber' | 'ore' | 'food' | 'relics', number>>,
) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (!v) continue;
    out[k as keyof typeof out] = (out[k as keyof typeof out] ?? 0) + v;
  }
  return out;
}

/** Distribute battle losses across the armies that fought, largest first. */
function applyLosses(state: GameState, armies: Army[], losses: UnitCounts, owner: PlayerState): void {
  for (const u of ['shields', 'blades', 'bows'] as const) {
    let remaining = losses[u];
    for (const army of armies) {
      if (remaining <= 0) break;
      const take = Math.min(army.units[u], remaining);
      army.units[u] -= take;
      remaining -= take;
    }
  }
  for (const army of armies) {
    if (totalUnits(army.units) <= 0) {
      if (army.commanderId) {
        const c = owner.commanders.find((cm) => cm.id === army.commanderId);
        if (c && c.status === 'assigned') c.status = 'ready';
      }
      state.armies.delete(army.id);
    }
  }
}

/** After a breach, the Ark limps to the nearest safe land. */
function relocateArk(db: Db, state: GameState, player: PlayerState, battleTile: Tile): void {
  let best: Tile | null = null;
  let bestDist = Infinity;
  for (const t of state.tiles) {
    if (t.flooded || t.terrain === 'ocean' || t.terrain === 'drowned' || t.terrain === 'ruins') continue;
    const d = hexDistance(t, battleTile);
    if (d < 3) continue;
    const occupied = [...state.players.values()].some(
      (p) => p.id !== player.id && !p.defeated && p.ark.q === t.q && p.ark.r === t.r,
    );
    if (occupied) continue;
    if (d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  if (best) {
    player.ark.q = best.q;
    player.ark.r = best.r;
  }
  addEvent(db, state, {
    type: 'ark',
    message: `${player.username}'s Ark was breached and fled, trailing smoke across the water.`,
    actorId: player.id,
  });
}

// ---------------------------------------------------------------------------
// Expeditions
// ---------------------------------------------------------------------------

function runExpeditions(db: Db, state: GameState, tick: number, markDirty: (t: Tile) => void): void {
  for (const exp of [...state.expeditions.values()]) {
    if (exp.resolveTick > tick) continue;
    state.expeditions.delete(exp.id);
    const owner = state.players.get(exp.ownerId);
    const tile = tileAt(state, exp.target.q, exp.target.r);
    if (!owner || !tile) continue;
    const tier = tile.ruinTier ?? 0;
    if (tier < 1) {
      addEvent(db, state, {
        type: 'expedition',
        message: 'The divers surfaced empty-handed — someone had been there first.',
        actorId: owner.id,
        q: tile.q,
        r: tile.r,
        isPublic: false,
      });
      continue;
    }
    const outcome = resolveExpedition(tile, tier, owner, nextSeed(state));
    owner.resources = addResources(owner.resources, outcome.loot);
    if (outcome.tech && !owner.techs.includes(outcome.tech)) owner.techs.push(outcome.tech);
    owner.score += outcome.scoreGained;
    tile.ruinTier = tier - 1;
    markDirty(tile);
    addEvent(db, state, {
      type: 'expedition',
      message: outcome.story,
      actorId: owner.id,
      q: tile.q,
      r: tile.r,
      isPublic: false,
    });
    if (outcome.tech) {
      addEvent(db, state, {
        type: 'expedition',
        message: `${owner.username}'s explorers returned changed — the world whispers of a discovery.`,
        actorId: owner.id,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

function runContracts(db: Db, state: GameState, tick: number): void {
  const all = [...state.contracts.values()];

  for (const changed of expireContracts(all, tick)) {
    if (changed.status === 'expired') {
      const from = state.players.get(changed.fromId);
      const to = state.players.get(changed.toId);
      addEvent(db, state, {
        type: 'contract',
        message: `The ${changed.type.replace('_', '-')} between ${from?.username ?? '?'} and ${to?.username ?? '?'} lapsed with the tide.`,
        actorId: changed.fromId,
        targetId: changed.toId,
        isPublic: false,
      });
    }
  }

  for (const contract of dueExchanges(all, tick)) {
    const from = state.players.get(contract.fromId);
    const to = state.players.get(contract.toId);
    if (!from || !to) {
      contract.status = 'expired';
      continue;
    }
    const fromCan = canCover(from, contract.terms.give);
    const toCan = canCover(to, contract.terms.receive);
    if (!fromCan || !toCan) {
      const defaulter = !fromCan ? from : to;
      contract.status = 'broken';
      defaulter.reputation = clampReputation(defaulter.reputation + REP_BREAK_CONTRACT);
      addEvent(db, state, {
        type: 'contract',
        message: `DEFAULT — ${defaulter.username} failed to honor their ${contract.type.replace('_', '-')} contract. The Ledger remembers.`,
        actorId: defaulter.id,
        targetId: defaulter.id === from.id ? to.id : from.id,
      });
      continue;
    }
    from.resources = subResources(from.resources, contract.terms.give);
    to.resources = addResources(to.resources, contract.terms.give);
    to.resources = subResources(to.resources, contract.terms.receive);
    from.resources = addResources(from.resources, contract.terms.receive);
    from.reputation = clampReputation(from.reputation + REP_TRADE_TICK);
    to.reputation = clampReputation(to.reputation + REP_TRADE_TICK);
    contractExchangeApplied(contract, tick);
  }

  // Clean out long-dead pages of The Ledger to keep state lean.
  for (const c of all) {
    if (
      (c.status === 'declined' || c.status === 'expired' || c.status === 'completed' || c.status === 'broken') &&
      tick - c.createdTick > 5000
    ) {
      state.contracts.delete(c.id);
    }
  }
}

function canCover(player: PlayerState, bag: Partial<Record<'timber' | 'ore' | 'food' | 'relics', number>>): boolean {
  for (const [k, v] of Object.entries(bag)) {
    if ((player.resources[k as keyof typeof player.resources] ?? 0) < (v ?? 0)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------

function runReputationDrift(state: GameState, tick: number): void {
  if (tick % 100 !== 0) return;
  for (const p of state.players.values()) {
    if (p.reputation < STARTING_REPUTATION) {
      p.reputation = clampReputation(p.reputation + REP_REGEN_PER_100_TICKS);
    }
  }
}

// ---------------------------------------------------------------------------
// The Tide
// ---------------------------------------------------------------------------

function runTide(db: Db, state: GameState, tick: number, markDirty: (t: Tile) => void): boolean {
  if (state.meta.phase === 'ended') return false;
  if (tick < state.meta.nextTideTick || state.meta.tideLevel >= SEASON_END_TIDE) return false;

  state.meta.tideLevel++;
  state.meta.nextTideTick = tick + config.tideIntervalTicks;
  const report = applyTide(state.tiles, state.meta.tideLevel);
  for (const t of report.newlyFlooded) markDirty(t);

  for (const destroyed of report.destroyed) {
    const owner = state.players.get(destroyed.ownerId);
    addEvent(db, state, {
      type: 'tide',
      message: `The sea took ${owner?.username ?? 'someone'}'s ${destroyed.buildingType.replace('_', ' ')} at (${destroyed.q}, ${destroyed.r}).`,
      actorId: destroyed.ownerId,
      q: destroyed.q,
      r: destroyed.r,
    });
  }

  // Reward foresight: every surviving owned tile earns score.
  for (const t of state.tiles) {
    if (t.ownerId && !t.flooded) {
      const owner = state.players.get(t.ownerId);
      if (owner) owner.score += SCORE_TILE_SURVIVES_TIDE;
    }
  }

  addEvent(db, state, {
    type: 'tide',
    message: `THE TIDE RISES to level ${state.meta.tideLevel}. ${report.newlyFlooded.length} tiles slip beneath the waves.`,
  });

  const newPhase = phaseForTide(state.meta.tideLevel);
  if (newPhase !== state.meta.phase) {
    state.meta.phase = newPhase;
    const phaseText: Record<string, string> = {
      conflict: 'The lowlands are gone. Now the drowning world turns neighbor against neighbor.',
      endgame: 'Only the high country remains. The final migration begins.',
      ended: 'The season ends. The peaks stand alone above an endless sea.',
    };
    addEvent(db, state, {
      type: 'season',
      message: phaseText[newPhase] ?? `The world enters its ${newPhase} phase.`,
    });
    if (newPhase === 'ended') {
      state.meta.endedAtTick = tick;
      const standings = [...state.players.values()]
        .filter((p) => !p.defeated)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map((p, i) => `${i + 1}. ${p.username} (${Math.round(p.score)})`)
        .join('  ');
      addEvent(db, state, {
        type: 'season',
        message: `FINAL RECKONING — ${standings || 'No souls survived to be counted.'}`,
      });
    }
  }
  return true;
}
