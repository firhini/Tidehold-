/**
 * The selected-tile command panel: claim, build, upgrade, expedition, shrine
 * offerings, and — when the Ark is selected — move/refit. Everything routes
 * through the solo store, which validates and toasts.
 */
import React, { useState } from 'react';
import {
  ARK_INFLUENCE_RADIUS,
  ARK_MAX_LEVEL,
  ARK_UPGRADE_COSTS,
  BUILDINGS,
  BUILDING_LIST,
  buildingCost,
  canAfford,
  CLAIM_TILE_COST,
  EXPEDITION_COST,
  EXPEDITION_RANGE,
  hexDistance,
  hexKey,
  hexNeighbors,
  MAX_BUILDING_LEVEL,
  RICHNESS_MULT,
  SHRINE_SCORE_PER_RELIC,
  ticksUntilFlood,
  type BuildingType,
  type Tile,
} from '@tidehold/shared';
import { useSolo } from '../store.js';
import { BUILDING_ICON, fmtTicks, resourceCost, RESOURCE_META } from '../ui.js';

export function TileSheet() {
  const selected = useSolo((s) => s.selected);
  const tileMap = useSolo((s) => s.tileMap);
  const me = useSolo((s) => s.me);
  const meta = useSolo((s) => s.meta);
  const players = useSolo((s) => s.players);
  const clearSelection = useSolo((s) => s.clearSelection);
  const claim = useSolo((s) => s.claim);
  const buildAct = useSolo((s) => s.build);
  const upgradeBuilding = useSolo((s) => s.upgradeBuilding);
  const upgradeArk = useSolo((s) => s.upgradeArk);
  const setTargeting = useSolo((s) => s.setTargeting);
  const expedition = useSolo((s) => s.expedition);
  const offerRelics = useSolo((s) => s.offerRelics);
  const [offer, setOffer] = useState(1);

  if (!selected || !me || !meta) return null;
  const tile = tileMap.get(hexKey(selected.q, selected.r));
  if (!tile) return null;

  const isWater = tile.flooded || tile.terrain === 'ocean' || tile.terrain === 'drowned';
  const mine = tile.ownerId === me.id;
  const owner = tile.ownerId ? players.find((p) => p.id === tile.ownerId) : null;
  const influence = ARK_INFLUENCE_RADIUS[me.ark.level - 1];
  const distFromArk = hexDistance(me.ark, tile);
  const isArkTile = me.ark.q === tile.q && me.ark.r === tile.r;
  const floodIn = ticksUntilFlood(tile, meta.tideLevel, meta.nextTideTick, meta.tick, meta.tideIntervalTicks);
  const doomSoon = Number.isFinite(floodIn) && !tile.flooded && tile.elevation <= meta.tideLevel + 1;
  const canExpedition =
    (tile.terrain === 'ruins' || tile.terrain === 'drowned') &&
    (tile.ruinTier ?? 0) > 0 &&
    !(tile.terrain === 'ruins' && (tile.garrison ?? 0) > 0);
  const portOk = hexNeighbors(tile).some((nb) => {
    const t = tileMap.get(hexKey(nb.q, nb.r));
    return !t || t.flooded || t.terrain === 'ocean' || t.terrain === 'drowned';
  });

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="panel-title">
          {label(tile.terrain)} <span className="faint">({tile.q}, {tile.r})</span>
        </div>
        <button className="panel-close" onClick={clearSelection} aria-label="Close">✕</button>
      </div>
      <div className="panel-body">
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          <span className="tag">⛰ elev {tile.elevation}/9</span>
          {!isWater && <span className="tag">{'★'.repeat(tile.richness)} rich</span>}
          {owner && (
            <span className="tag tag-gold">{owner.id === me.id ? 'Yours' : owner.username}</span>
          )}
          {!owner && !isWater && tile.terrain !== 'ruins' && <span className="tag">unclaimed</span>}
          {isArkTile && <span className="tag tag-gold">⛵ Your Ark</span>}
        </div>

        <div className="card">
          {tile.flooded ? (
            <span className="muted">🌊 Lost to the Tide.{(tile.ruinTier ?? 0) > 0 && ' Ruins wait below.'}</span>
          ) : Number.isFinite(floodIn) ? (
            <span className={doomSoon ? 'bad' : 'muted'}>🌊 The sea takes this in ~{fmtTicks(floodIn)}{doomSoon && ' — next rise!'}</span>
          ) : (
            <span className="good">⛰ High ground — outlives the season.</span>
          )}
        </div>

        {/* Ark actions */}
        {isArkTile && (
          <div className="card">
            <div className="panel-section-title">Your Ark · level {me.ark.level}</div>
            <div className="row" style={{ marginTop: 8 }}>
              <button
                className="btn grow"
                onClick={() => {
                  setTargeting({ kind: 'ark_move', hint: 'Choose new anchorage — tap higher ground' });
                  clearSelection();
                }}
              >
                ⚓ Move Ark
              </button>
              {me.ark.level < ARK_MAX_LEVEL && (
                <button
                  className="btn grow"
                  disabled={!canAfford(me.resources, ARK_UPGRADE_COSTS[me.ark.level - 1])}
                  onClick={upgradeArk}
                >
                  🔨 Refit ({resourceCost(ARK_UPGRADE_COSTS[me.ark.level - 1])})
                </button>
              )}
            </div>
          </div>
        )}

        {/* Expedition */}
        {canExpedition && (
          <div className="card">
            <div className="row-between">
              <span className="gold">🏛 Ruin tier {tile.ruinTier}</span>
              <span className="muted">{resourceCost(EXPEDITION_COST)}</span>
            </div>
            <p className="faint" style={{ margin: '6px 0' }}>
              {tile.terrain === 'drowned' ? 'Divers can reach what the sea took.' : 'The vaults stand open.'} Range {EXPEDITION_RANGE}.
            </p>
            <button className="btn btn-block" onClick={() => expedition(tile.q, tile.r)}>🧭 Launch expedition</button>
          </div>
        )}

        {/* Ruins garrison note */}
        {tile.terrain === 'ruins' && (tile.garrison ?? 0) > 0 && (
          <p className="faint">⚔ Remnant garrison of {tile.garrison}. Clear it with an army before you can explore.</p>
        )}

        {/* Claim */}
        {!isWater && !tile.ownerId && tile.terrain !== 'ruins' && (
          <div className="card">
            <div className="row-between">
              <span>Settle this land</span>
              <span className="muted">{resourceCost(CLAIM_TILE_COST)}</span>
            </div>
            {distFromArk > influence && (
              <p className="bad" style={{ margin: '6px 0', fontSize: 13 }}>
                Too far ({distFromArk} &gt; {influence} hexes). Move your Ark closer.
              </p>
            )}
            <button
              className="btn btn-block"
              style={{ marginTop: 6 }}
              disabled={distFromArk > influence || !canAfford(me.resources, CLAIM_TILE_COST)}
              onClick={() => claim(tile.q, tile.r)}
            >
              🚩 Claim tile
            </button>
          </div>
        )}

        {/* Build menu */}
        {mine && !tile.building && (
          <>
            <div className="panel-section-title">Build</div>
            {BUILDING_LIST.map((type: BuildingType) => {
              const spec = BUILDINGS[type];
              const cost = buildingCost(type, 1);
              const terrainOk = type === 'port' ? portOk : spec.terrain.includes(tile.terrain);
              const affordable = canAfford(me.resources, cost);
              const prod = Object.entries(spec.production).filter(([, v]) => (v ?? 0) > 0);
              return (
                <div className="card" key={type} style={{ opacity: terrainOk ? 1 : 0.45 }}>
                  <div className="row-between">
                    <span>{BUILDING_ICON[type]} <b>{spec.name}</b></span>
                    <span className="muted">{resourceCost(cost)}</span>
                  </div>
                  <p className="faint" style={{ margin: '4px 0' }}>
                    {spec.description}
                    {prod.length > 0 && (
                      <span className="good"> +{prod.map(([k, v]) => `${((v ?? 0) * RICHNESS_MULT[tile.richness - 1]).toFixed(1)} ${RESOURCE_META[k as keyof typeof RESOURCE_META].label.toLowerCase()}/t`).join(', ')}</span>
                    )}
                  </p>
                  {!terrainOk ? (
                    <p className="faint">{type === 'port' ? 'Needs water at its doorstep.' : `Needs: ${spec.terrain.join(', ')}`}</p>
                  ) : (
                    <button className="btn btn-block" disabled={!affordable} onClick={() => buildAct(tile.q, tile.r, type)}>
                      {affordable ? 'Build' : 'Not enough resources'}
                    </button>
                  )}
                </div>
              );
            })}
          </>
        )}

        {/* Existing building */}
        {mine && tile.building && (
          <div className="card">
            <div className="row-between">
              <span>
                {BUILDING_ICON[tile.building.type]} <b>{BUILDINGS[tile.building.type].name}</b>{' '}
                <span className="gold">{'▮'.repeat(tile.building.level)}{'▯'.repeat(MAX_BUILDING_LEVEL - tile.building.level)}</span>
              </span>
            </div>
            {tile.building.level < MAX_BUILDING_LEVEL && (
              <button
                className="btn btn-block"
                style={{ marginTop: 8 }}
                disabled={!canAfford(me.resources, buildingCost(tile.building.type, tile.building.level + 1))}
                onClick={() => upgradeBuilding(tile.q, tile.r)}
              >
                ⬆ Upgrade ({resourceCost(buildingCost(tile.building.type, tile.building.level + 1))})
              </button>
            )}
            {tile.building.type === 'shrine' && (
              <div style={{ marginTop: 10 }}>
                <div className="panel-section-title">Offer relics</div>
                <p className="faint" style={{ margin: '4px 0' }}>
                  {SHRINE_SCORE_PER_RELIC[tile.building.level - 1]} legacy per relic. You hold {Math.floor(me.resources.relics)}.
                </p>
                <div className="row">
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={Math.max(1, Math.floor(me.resources.relics))}
                    value={offer}
                    onChange={(e) => setOffer(Math.max(1, Number.parseInt(e.target.value, 10) || 1))}
                    style={{ width: 90 }}
                  />
                  <button className="btn grow" disabled={me.resources.relics < offer} onClick={() => offerRelics(tile.q, tile.r, offer)}>
                    🔱 Offer
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {owner && !mine && !tile.flooded && (
          <p className="faint">Hostile ground. March an army adjacent, then attack from the Armies panel.</p>
        )}
      </div>
    </div>
  );
}

function label(terrain: Tile['terrain']): string {
  const m: Record<string, string> = {
    ocean: 'Open Sea', drowned: 'Drowned Ruins', coast: 'Coast', plains: 'Plains',
    forest: 'Forest', hills: 'Hills', mountains: 'Mountains', peak: 'Peak', ruins: 'Ancient Ruins',
  };
  return m[terrain] ?? terrain;
}
