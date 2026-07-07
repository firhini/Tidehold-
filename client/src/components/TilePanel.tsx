/**
 * Everything about one tile: what it is, when it drowns, and what you can
 * do with it — claim, build, upgrade, offer relics, launch expeditions.
 */
import React, { useState } from 'react';
import {
  ARK_INFLUENCE_RADIUS,
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
import { api } from '../api.js';
import { useStore } from '../store.js';
import { BUILDING_ICONS, fmtTicks, playerColor, RESOURCE_META, runAction, TERRAIN_META } from '../ui/util.js';
import { CostRow, Panel } from './Panel.js';

export function TilePanel() {
  const selected = useStore((s) => s.selected);
  const tileMap = useStore((s) => s.tileMap);
  const tiles = useStore((s) => s.tiles);
  const me = useStore((s) => s.me);
  const meta = useStore((s) => s.meta);
  const players = useStore((s) => s.players);
  const setPanel = useStore((s) => s.setPanel);
  const [offerAmount, setOfferAmount] = useState(1);

  if (!selected || !meta || !me) return null;
  const tile = tileMap.get(hexKey(selected.q, selected.r));
  if (!tile) return null;

  const terrain = TERRAIN_META[tile.terrain];
  const owner = tile.ownerId ? players.find((p) => p.id === tile.ownerId) : null;
  const mine = tile.ownerId === me.id;
  const isWater = tile.flooded || tile.terrain === 'ocean' || tile.terrain === 'drowned';
  const distFromArk = hexDistance(me.ark, tile);
  const influence = ARK_INFLUENCE_RADIUS[me.ark.level - 1];

  const floodIn = ticksUntilFlood(tile, meta.tideLevel, meta.nextTideTick, meta.tick, meta.tideIntervalTicks);
  const doomSoon = Number.isFinite(floodIn) && !tile.flooded && tile.elevation <= meta.tideLevel + 1;

  const canExpedition =
    (tile.terrain === 'ruins' || tile.terrain === 'drowned') &&
    (tile.ruinTier ?? 0) > 0 &&
    !(tile.terrain === 'ruins' && (tile.garrison ?? 0) > 0);

  return (
    <Panel
      title={
        <span>
          {terrain.label} <span className="faint">({tile.q}, {tile.r})</span>
        </span>
      }
    >
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <span className="tag">⛰ elevation {tile.elevation}/9</span>
        {!isWater && <span className="tag">{'★'.repeat(tile.richness)} richness</span>}
        {owner && (
          <span className="tag" style={{ color: playerColor(owner.id), borderColor: playerColor(owner.id) }}>
            {owner.username}
          </span>
        )}
        {!owner && !isWater && tile.terrain !== 'ruins' && <span className="tag">unclaimed</span>}
      </div>

      {/* Doom clock */}
      <div className="card">
        {tile.flooded ? (
          <span className="muted">🌊 Lost to the Tide. {(tile.ruinTier ?? 0) > 0 && 'Its ruins wait below.'}</span>
        ) : Number.isFinite(floodIn) ? (
          <span className={doomSoon ? 'bad' : 'muted'}>
            🌊 The sea takes this land in ~{fmtTicks(floodIn, meta)}
            {doomSoon && ' — next rise!'}
          </span>
        ) : (
          <span className="good">⛰ High ground — outlives the season.</span>
        )}
      </div>

      {/* Ruins */}
      {tile.terrain === 'ruins' && (tile.garrison ?? 0) > 0 && (
        <div className="card">
          <div className="row-between">
            <span className="bad">⚔ Remnant garrison: {tile.garrison}</span>
          </div>
          <p className="faint" style={{ marginTop: 4 }}>
            The old world still defends its vaults. Clear them with an army, then send expeditions.
          </p>
        </div>
      )}

      {canExpedition && (
        <div className="card">
          <div className="row-between">
            <span className="gold">🏛 Ruin tier {tile.ruinTier}</span>
            <CostRow cost={EXPEDITION_COST} />
          </div>
          <p className="faint" style={{ margin: '6px 0' }}>
            {tile.terrain === 'drowned'
              ? 'Divers can reach what the sea took.'
              : 'The vaults stand open to explorers.'}{' '}
            Range {EXPEDITION_RANGE} from your Ark or a port.
          </p>
          <button
            className="btn btn-block"
            onClick={() => void runAction(() => api.expedition(tile.q, tile.r), 'The expedition sets out.')}
          >
            🧭 Launch expedition
          </button>
        </div>
      )}

      {/* Claim */}
      {!isWater && !tile.ownerId && tile.terrain !== 'ruins' && (
        <div className="card">
          <div className="row-between">
            <span>Settle this land</span>
            <CostRow cost={CLAIM_TILE_COST} />
          </div>
          {distFromArk > influence && (
            <p className="bad" style={{ margin: '6px 0', fontSize: 13 }}>
              Too far from your Ark ({distFromArk} &gt; {influence} hexes). Move it closer or upgrade it.
            </p>
          )}
          <button
            className="btn btn-block"
            style={{ marginTop: 6 }}
            disabled={distFromArk > influence || !canAfford(me.resources, CLAIM_TILE_COST)}
            onClick={() => void runAction(() => api.claimTile(tile.q, tile.r), 'The banner is planted.')}
          >
            🚩 Claim tile
          </button>
        </div>
      )}

      {/* Build */}
      {mine && !tile.building && <BuildMenu tile={tile} />}

      {/* Existing building */}
      {tile.building && <BuildingCard tile={tile} mine={mine} offerAmount={offerAmount} setOfferAmount={setOfferAmount} />}

      {/* Enemy presence hint */}
      {owner && !mine && !tile.flooded && (
        <p className="faint">
          Hostile ground. March an army adjacent, then strike from the{' '}
          <button className="gold" style={{ textDecoration: 'underline' }} onClick={() => setPanel('armies')}>
            Armies panel
          </button>
          .
        </p>
      )}
    </Panel>
  );
}

function BuildMenu({ tile }: { tile: Tile }) {
  const me = useStore((s) => s.me);
  const tileMap = useStore((s) => s.tileMap);
  if (!me) return null;
  // Ports follow the climbing shoreline: buildable on land touching water.
  const touchesWater = hexNeighbors(tile).some((nb) => {
    const t = tileMap.get(hexKey(nb.q, nb.r));
    return !t || t.flooded || t.terrain === 'ocean' || t.terrain === 'drowned';
  });
  return (
    <>
      <div className="panel-section-title">Build</div>
      {BUILDING_LIST.map((type: BuildingType) => {
        const spec = BUILDINGS[type];
        const cost = buildingCost(type, 1);
        const terrainOk = type === 'port' ? touchesWater : spec.terrain.includes(tile.terrain);
        const affordable = canAfford(me.resources, cost);
        const prod = Object.entries(spec.production).filter(([, v]) => (v ?? 0) > 0);
        return (
          <div className="card" key={type} style={{ opacity: terrainOk ? 1 : 0.45 }}>
            <div className="row-between">
              <span>
                {BUILDING_ICONS[type]} <b>{spec.name}</b>
              </span>
              <CostRow cost={cost} />
            </div>
            <p className="faint" style={{ margin: '4px 0' }}>
              {spec.description}
              {prod.length > 0 && (
                <>
                  {' '}
                  <span className="good">
                    +
                    {prod
                      .map(([k, v]) => `${((v ?? 0) * RICHNESS_MULT[tile.richness - 1]).toFixed(1)} ${RESOURCE_META[k as keyof typeof RESOURCE_META].label.toLowerCase()}/tick here`)
                      .join(', ')}
                  </span>
                </>
              )}
            </p>
            {!terrainOk ? (
              <p className="faint">{type === 'port' ? 'Needs water at its doorstep.' : `Needs: ${spec.terrain.join(', ')}`}</p>
            ) : (
              <button
                className="btn btn-block"
                disabled={!affordable}
                onClick={() => void runAction(() => api.build(tile.q, tile.r, type), `${spec.name} raised.`)}
              >
                {affordable ? 'Build' : 'Not enough resources'}
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}

function BuildingCard({
  tile,
  mine,
  offerAmount,
  setOfferAmount,
}: {
  tile: Tile;
  mine: boolean;
  offerAmount: number;
  setOfferAmount: (n: number) => void;
}) {
  const me = useStore((s) => s.me);
  const meta = useStore((s) => s.meta);
  const building = tile.building;
  if (!building || !me || !meta) return null;
  const spec = BUILDINGS[building.type];
  const disabled = (building.disabledUntilTick ?? 0) > meta.tick;
  const nextCost = building.level < MAX_BUILDING_LEVEL ? buildingCost(building.type, building.level + 1) : null;

  return (
    <div className="card">
      <div className="row-between">
        <span>
          {BUILDING_ICONS[building.type]} <b>{spec.name}</b>{' '}
          <span className="gold">{'▮'.repeat(building.level)}{'▯'.repeat(MAX_BUILDING_LEVEL - building.level)}</span>
        </span>
      </div>
      {disabled && (
        <p className="bad" style={{ marginTop: 4 }}>
          Damaged in battle — offline for {fmtTicks((building.disabledUntilTick ?? 0) - meta.tick, meta)}.
        </p>
      )}
      {mine && nextCost && (
        <div style={{ marginTop: 8 }}>
          <div className="row-between">
            <span className="muted">Upgrade to level {building.level + 1}</span>
            <CostRow cost={nextCost} />
          </div>
          <button
            className="btn btn-block"
            style={{ marginTop: 6 }}
            disabled={!canAfford(me.resources, nextCost)}
            onClick={() => void runAction(() => api.upgradeBuilding(tile.q, tile.r), `${spec.name} improved.`)}
          >
            ⬆ Upgrade
          </button>
        </div>
      )}
      {mine && building.type === 'shrine' && !disabled && (
        <div style={{ marginTop: 10 }}>
          <div className="panel-section-title">Offer relics</div>
          <p className="faint" style={{ margin: '4px 0' }}>
            {SHRINE_SCORE_PER_RELIC[building.level - 1]} legacy per relic. You hold {Math.floor(me.resources.relics)}.
          </p>
          <div className="row">
            <input
              className="input"
              type="number"
              min={1}
              max={Math.max(1, Math.floor(me.resources.relics))}
              value={offerAmount}
              onChange={(e) => setOfferAmount(Math.max(1, Number.parseInt(e.target.value, 10) || 1))}
              style={{ width: 90 }}
            />
            <button
              className="btn grow"
              disabled={me.resources.relics < offerAmount}
              onClick={() =>
                void runAction(() => api.offerRelics(tile.q, tile.r, offerAmount), 'The deep accepts your offering.')
              }
            >
              🔱 Offer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
