/**
 * The Ark — mobile capital, influence projector, home of your commanders
 * and everything the old world taught you.
 */
import React from 'react';
import {
  ARK_INFLUENCE_RADIUS,
  ARK_MAX_LEVEL,
  ARK_MOVE_FOOD_PER_HEX,
  ARK_MOVE_RANGE,
  ARK_UPGRADE_COSTS,
  canAfford,
  TECHS,
} from '@tidehold/shared';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { fmtTicks, runAction } from '../ui/util.js';
import { CostRow, Panel } from './Panel.js';

const TRAIT_META: Record<string, { icon: string; blurb: string }> = {
  aggression: { icon: '🔥', blurb: '+12% attack per level when leading an assault.' },
  bulwark: { icon: '🛡', blurb: '+12% defense per level when holding ground.' },
  logistics: { icon: '🧭', blurb: 'Armies march 25% faster.' },
};

export function ArkPanel() {
  const me = useStore((s) => s.me);
  const meta = useStore((s) => s.meta);
  const players = useStore((s) => s.players);
  const setTargeting = useStore((s) => s.setTargeting);
  const setPanel = useStore((s) => s.setPanel);

  if (!me || !meta) return null;
  const ark = me.ark;
  const influence = ARK_INFLUENCE_RADIUS[ark.level - 1];
  const damaged = ark.damagedUntilTick > meta.tick;
  const moveReady = ark.moveReadyTick <= meta.tick;
  const nextCost = ark.level < ARK_MAX_LEVEL ? ARK_UPGRADE_COSTS[ark.level - 1] : null;
  const foodPerHex = me.techs.includes('hull_lore') ? Math.ceil(ARK_MOVE_FOOD_PER_HEX / 2) : ARK_MOVE_FOOD_PER_HEX;

  return (
    <Panel title="⛵ The Ark">
      <div className="card">
        <div className="row-between">
          <span>
            <b>Level {ark.level}</b> <span className="faint">of {ARK_MAX_LEVEL}</span>
          </span>
          <span className="muted">anchored at ({ark.q}, {ark.r})</span>
        </div>
        <div style={{ marginTop: 8 }}>
          <div className="row-between faint">
            <span>Hull</span>
            <span>
              {ark.hp}/{ark.maxHp}
            </span>
          </div>
          <div className="hud-tide-bar" style={{ marginTop: 3 }}>
            <div
              className="hud-tide-fill"
              style={{
                width: `${(ark.hp / ark.maxHp) * 100}%`,
                background: damaged ? 'linear-gradient(90deg,#a14b2b,#e0604f)' : undefined,
              }}
            />
          </div>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          Influence: you can claim land within <b className="gold">{influence} hexes</b>.
        </p>
        {damaged && (
          <p className="bad" style={{ marginTop: 4 }}>
            🔥 Systems damaged — production halved for {fmtTicks(ark.damagedUntilTick - meta.tick, meta)}.
          </p>
        )}
      </div>

      <div className="card">
        <div className="panel-section-title">Relocate</div>
        <p className="faint" style={{ margin: '6px 0' }}>
          Up to {ARK_MOVE_RANGE} hexes per move, {foodPerHex} food per hex
          {me.techs.includes('hull_lore') && <span className="good"> (Hull Lore)</span>}. The Tide does not
          negotiate — move before your land drowns.
        </p>
        <button
          className="btn btn-block"
          disabled={!moveReady}
          onClick={() => {
            setTargeting({ kind: 'ark_move', hint: 'Choose new anchorage for your Ark' });
            setPanel('none');
          }}
        >
          {moveReady ? '⚓ Weigh anchor' : `Engines ready in ${fmtTicks(ark.moveReadyTick - meta.tick, meta)}`}
        </button>
      </div>

      {nextCost && (
        <div className="card">
          <div className="row-between">
            <span className="panel-section-title">Refit to level {ark.level + 1}</span>
            <CostRow cost={nextCost} />
          </div>
          <p className="faint" style={{ margin: '6px 0' }}>
            Influence {influence} → {ARK_INFLUENCE_RADIUS[ark.level]}, hull reinforced and repaired.
          </p>
          <button
            className="btn btn-block"
            disabled={!canAfford(me.resources, nextCost)}
            onClick={() => void runAction(() => api.upgradeArk(), 'The shipwrights outdo themselves.')}
          >
            🔨 Refit the Ark
          </button>
        </div>
      )}

      <div className="panel-section-title">Commanders</div>
      {me.commanders.map((c) => {
        const captor = c.capturedById ? players.find((p) => p.id === c.capturedById) : null;
        return (
          <div className="card" key={c.id}>
            <div className="row-between">
              <span>
                {TRAIT_META[c.trait]?.icon} <b>{c.name}</b> <span className="faint">lv {c.level}</span>
              </span>
              {c.status === 'ready' && <span className="tag">ready</span>}
              {c.status === 'assigned' && <span className="tag tag-gold">in the field</span>}
              {c.status === 'captured' && <span className="tag tag-danger">captured</span>}
            </div>
            <p className="faint" style={{ marginTop: 4 }}>
              {TRAIT_META[c.trait]?.blurb}
              {c.status === 'captured' && captor && (
                <span className="bad">
                  {' '}
                  Held by {captor.username} — negotiate a ransom in The Ledger.
                </span>
              )}
            </p>
          </div>
        );
      })}

      <div className="panel-section-title">Recovered knowledge</div>
      {me.techs.length === 0 ? (
        <p className="faint">The old world keeps its secrets — for now. Send expeditions into the ruins.</p>
      ) : (
        me.techs.map((id) => (
          <div className="card" key={id}>
            <b className="gold">{TECHS[id]?.name ?? id}</b>
            <p className="faint" style={{ marginTop: 2 }}>
              {TECHS[id]?.description}
            </p>
          </div>
        ))
      )}
    </Panel>
  );
}
