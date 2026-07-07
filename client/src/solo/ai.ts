/**
 * AI rival Arks. Each bot plays by exactly the same intents the human uses,
 * so the sim stays fair and reuses one rule set. Behavior is intentionally
 * simple but competent: survive the tide first, build an economy, grab relics,
 * and — as the land runs out — fight for what's left.
 *
 * Cheap by construction: each AI takes at most one "major" action on its
 * scheduled tick, and all actions are wrapped so a rejected move is a no-op.
 */
import {
  ARK_INFLUENCE_RADIUS,
  ARK_MOVE_RANGE,
  BUILDINGS,
  buildingCost,
  canAfford,
  CLAIM_TILE_COST,
  EXPEDITION_COST,
  hexDistance,
  hexNeighbors,
  totalUnits,
  unitCost,
  type PlayerState,
  type Tile,
} from '@tidehold/shared';
import {
  attack,
  build,
  claimTile,
  isLand,
  launchExpedition,
  moveArk,
  moveArmy,
  offerRelics,
  ownedTileCount,
  recruit,
  tileAt,
  type EngineState,
} from './engine.js';
import type { MetaState } from './types.js';

export interface AiMemory {
  lastBuildTick: number;
  lastMoveTick: number;
  aggressionSeed: number;
}

const ACT_EVERY = 3; // ticks between an AI's major actions

export function runAi(state: EngineState, meta: MetaState): void {
  state.aiIds.forEach((id, idx) => {
    // Stagger so not all AIs act on the same tick.
    if ((state.meta.tick + idx) % ACT_EVERY !== 0) return;
    const ai = state.players.get(id);
    const mem = state.aiMemory.get(id);
    if (!ai || !mem || ai.defeated) return;
    try {
      act(state, ai, mem, meta);
    } catch {
      /* an illegal action is simply skipped */
    }
  });
}

function act(state: EngineState, ai: PlayerState, mem: AiMemory, meta: MetaState): void {
  // 1) Survival — flee before the water takes the Ark's ground.
  if (fleeTideIfThreatened(state, ai, meta)) return;
  // 2) Economy — claim and build.
  if (buildEconomy(state, ai, mem)) return;
  // 3) Score — bank relics at a shrine, or send an expedition.
  if (bankRelicsOrExplore(state, ai)) return;
  // 4) War — as land shrinks, take it from someone.
  if (state.meta.tideLevel >= 2) makeWar(state, ai, mem);
}

function influenceTiles(state: EngineState, ai: PlayerState): Tile[] {
  const radius = ARK_INFLUENCE_RADIUS[ai.ark.level - 1];
  return state.tiles.filter((t) => hexDistance(ai.ark, t) <= radius);
}

function fleeTideIfThreatened(state: EngineState, ai: PlayerState, meta: MetaState): boolean {
  const here = tileAt(state, ai.ark.q, ai.ark.r);
  const threatened = !here || here.elevation <= state.meta.tideLevel + 1;
  if (!threatened || ai.ark.moveReadyTick > state.meta.tick) return false;
  // Move to the highest safe land within range.
  let best: Tile | null = null;
  for (const t of state.tiles) {
    if (!isLand(t) || t.terrain === 'ruins') continue;
    if (hexDistance(ai.ark, t) > ARK_MOVE_RANGE || hexDistance(ai.ark, t) === 0) continue;
    if (occupied(state, ai, t)) continue;
    if (!best || t.elevation > best.elevation) best = t;
  }
  if (best && best.elevation > (here?.elevation ?? 0)) {
    moveArk(state, ai, best.q, best.r, meta);
    return true;
  }
  return false;
}

function occupied(state: EngineState, self: PlayerState, t: Tile): boolean {
  return [...state.players.values()].some((p) => p.id !== self.id && !p.defeated && p.ark.q === t.q && p.ark.r === t.r);
}

function buildEconomy(state: EngineState, ai: PlayerState, mem: AiMemory): boolean {
  if (state.meta.tick - mem.lastBuildTick < ACT_EVERY) return false;
  // Build on an owned, empty tile first.
  const ownedEmpty = state.tiles.find(
    (t) => t.ownerId === ai.id && !t.building && !t.flooded && hexDistance(ai.ark, t) <= ARK_INFLUENCE_RADIUS[ai.ark.level - 1],
  );
  if (ownedEmpty) {
    const type = pickBuilding(state, ai, ownedEmpty);
    if (type && canAfford(ai.resources, buildingCost(type, 1))) {
      build(state, ai, ownedEmpty.q, ownedEmpty.r, type);
      mem.lastBuildTick = state.meta.tick;
      return true;
    }
  }
  // Otherwise claim a fresh, high, productive tile in reach.
  if (ownedTileCount(state, ai.id) < 14 && canAfford(ai.resources, CLAIM_TILE_COST)) {
    const claimable = influenceTiles(state, ai)
      .filter((t) => isLand(t) && !t.ownerId && t.terrain !== 'ruins' && t.elevation >= state.meta.tideLevel + 2)
      .sort((a, b) => b.elevation + b.richness - (a.elevation + a.richness))[0];
    if (claimable) {
      claimTile(state, ai, claimable.q, claimable.r);
      mem.lastBuildTick = state.meta.tick - ACT_EVERY; // allow an immediate build next time
      return true;
    }
  }
  return false;
}

function pickBuilding(state: EngineState, ai: PlayerState, tile: Tile): keyof typeof BUILDINGS | null {
  const has = (type: keyof typeof BUILDINGS) => state.tiles.some((t) => t.building?.type === type && t.building.ownerId === ai.id);
  // Priority: food, then production, then a shrine to score, then a tower.
  if (BUILDINGS.farm.terrain.includes(tile.terrain) && !has('farm')) return 'farm';
  if (BUILDINGS.lumber_camp.terrain.includes(tile.terrain)) return 'lumber_camp';
  if (BUILDINGS.mine.terrain.includes(tile.terrain)) return 'mine';
  if (BUILDINGS.farm.terrain.includes(tile.terrain)) return 'farm';
  if (!has('shrine') && ai.resources.relics >= 4) return 'shrine';
  if (!has('watchtower')) return 'watchtower';
  return null;
}

function bankRelicsOrExplore(state: EngineState, ai: PlayerState): boolean {
  // Offer relics at an owned shrine to convert them into score.
  if (ai.resources.relics >= 3) {
    const shrine = state.tiles.find((t) => t.building?.type === 'shrine' && t.building.ownerId === ai.id);
    if (shrine) {
      offerRelics(state, ai, shrine.q, shrine.r, Math.floor(ai.resources.relics));
      return true;
    }
  }
  // Send an expedition to an open ruin in reach.
  if (canAfford(ai.resources, EXPEDITION_COST)) {
    const ruin = state.tiles
      .filter((t) => (t.terrain === 'drowned' || (t.terrain === 'ruins' && (t.garrison ?? 0) === 0)) && (t.ruinTier ?? 0) > 0 && hexDistance(ai.ark, t) <= 10)
      .sort((a, b) => hexDistance(ai.ark, a) - hexDistance(ai.ark, b))[0];
    if (ruin) {
      launchExpedition(state, ai, ruin.q, ruin.r);
      return true;
    }
  }
  return false;
}

function makeWar(state: EngineState, ai: PlayerState, mem: AiMemory): boolean {
  const myArmy = [...state.armies.values()].find((a) => a.ownerId === ai.id && !a.battleId);
  const aggression = 0.35 + (mem.aggressionSeed % 100) / 250; // 0.35..0.75

  if (!myArmy) {
    // Raise a modest force if flush and inclined.
    const cost = unitCost({ blades: 8, bows: 4 });
    if (canAfford(ai.resources, cost) && (mem.aggressionSeed % 100) / 100 < aggression) {
      recruit(state, ai, { shields: 0, blades: 8, bows: 4 });
    }
    return true;
  }
  if (totalUnits(myArmy.units) <= 0) return false;

  // Target: a reachable garrisoned ruin (relics) or a neighbor's exposed tile.
  const ruin = state.tiles
    .filter((t) => t.terrain === 'ruins' && (t.garrison ?? 0) > 0)
    .sort((a, b) => hexDistance(myArmy, a) - hexDistance(myArmy, b))[0];
  const enemyTile = state.tiles
    .filter((t) => t.ownerId && t.ownerId !== ai.id && isLand(t))
    .sort((a, b) => hexDistance(myArmy, a) - hexDistance(myArmy, b))[0];
  const target = ruin && (!enemyTile || hexDistance(myArmy, ruin) <= hexDistance(myArmy, enemyTile)) ? ruin : enemyTile;
  if (!target) return false;

  if (hexDistance(myArmy, target) <= 1) {
    attack(state, ai, myArmy.id, target.q, target.r);
  } else {
    // Step toward it (adjacent tile).
    const approach = hexNeighbors(target)
      .map((c) => tileAt(state, c.q, c.r))
      .filter((t): t is Tile => !!t)
      .sort((a, b) => hexDistance(myArmy, a) - hexDistance(myArmy, b))[0];
    if (approach) moveArmy(state, ai, myArmy.id, approach.q, approach.r);
  }
  return true;
}
