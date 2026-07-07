/**
 * Muster, march, and make war. Recruiting happens at the Ark; battles are
 * declared adjacent to their target and resolve after a preparation window.
 */
import React, { useState } from 'react';
import {
  armyUpkeep,
  canAfford,
  MAX_ARMY_SIZE,
  totalUnits,
  unitCost,
  UNIT_LIST,
  UNITS,
  type UnitCounts,
} from '@tidehold/shared';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { fmtTicks, playerColor, runAction, UNIT_META } from '../ui/util.js';
import { CostRow, Panel } from './Panel.js';

export function ArmiesPanel() {
  const me = useStore((s) => s.me);
  const meta = useStore((s) => s.meta);
  const armies = useStore((s) => s.armies);
  const battles = useStore((s) => s.battles);
  const players = useStore((s) => s.players);
  const setTargeting = useStore((s) => s.setTargeting);
  const setPanel = useStore((s) => s.setPanel);
  const [counts, setCounts] = useState<UnitCounts>({ shields: 0, blades: 0, bows: 0 });

  if (!me || !meta) return null;
  const myArmies = armies.filter((a) => a.ownerId === me.id);
  const myBattles = battles.filter((b) => b.attackerId === me.id || b.defenderId === me.id);
  const total = totalUnits(counts);
  const cost = unitCost(counts);
  const upkeep = armyUpkeep(counts);
  const nameOf = (id?: string) => (id ? players.find((p) => p.id === id)?.username ?? 'unknown' : 'the remnants');

  const step = (u: keyof UnitCounts, d: number) =>
    setCounts((c) => ({ ...c, [u]: Math.max(0, Math.min(MAX_ARMY_SIZE, c[u] + d)) }));

  return (
    <Panel title="⚔️ Armies">
      <div className="card">
        <div className="panel-section-title">Muster at the Ark</div>
        {UNIT_LIST.map((u) => (
          <div className="row-between" key={u} style={{ margin: '8px 0' }}>
            <div className="grow">
              <div>
                {UNIT_META[u].icon} <b>{UNITS[u].name}</b>{' '}
                <span className="faint">
                  ⚔{UNITS[u].attack} 🛡{UNITS[u].defense}
                </span>
              </div>
              <div className="faint">{UNIT_META[u].blurb}</div>
            </div>
            <div className="row">
              <button className="btn btn-ghost" onClick={() => step(u, -5)}>
                −
              </button>
              <span style={{ minWidth: 32, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{counts[u]}</span>
              <button className="btn btn-ghost" onClick={() => step(u, +5)}>
                +
              </button>
            </div>
          </div>
        ))}
        <div className="divider" />
        <div className="row-between" style={{ marginTop: 8 }}>
          <CostRow cost={cost} />
          <span className="faint">upkeep {upkeep.toFixed(1)} 🌾/tick</span>
        </div>
        <button
          className="btn btn-block"
          style={{ marginTop: 8 }}
          disabled={total === 0 || !canAfford(me.resources, cost)}
          onClick={async () => {
            const ok = await runAction(() => api.recruit(counts), 'Troops mustered at the Ark.');
            if (ok) setCounts({ shields: 0, blades: 0, bows: 0 });
          }}
        >
          Raise {total > 0 ? `${total} troops` : 'troops'}
        </button>
      </div>

      <div className="panel-section-title">Your hosts</div>
      {myArmies.length === 0 && <p className="faint">No banners in the field. The sea, at least, is patient.</p>}
      {myArmies.map((a) => {
        const commander = me.commanders.find((c) => c.id === a.commanderId);
        const readyCommanders = me.commanders.filter((c) => c.status === 'ready' || c.id === a.commanderId);
        return (
          <div className="card" key={a.id}>
            <div className="row-between">
              <b>
                {totalUnits(a.units)} troops <span className="faint">at ({a.q}, {a.r})</span>
              </b>
              {a.battleId ? (
                <span className="tag tag-danger">committed</span>
              ) : a.path.length > 0 ? (
                <span className="tag tag-gold">marching</span>
              ) : (
                <span className="tag">holding</span>
              )}
            </div>
            <div className="muted" style={{ margin: '4px 0' }}>
              🛡 {a.units.shields} · ⚔️ {a.units.blades} · 🏹 {a.units.bows}
            </div>
            <div className="row" style={{ margin: '6px 0' }}>
              <select
                className="input grow"
                value={a.commanderId ?? ''}
                onChange={(e) => void runAction(() => api.assignCommander(a.id, e.target.value || null))}
              >
                <option value="">No commander</option>
                {readyCommanders.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.trait})
                  </option>
                ))}
              </select>
            </div>
            {commander && <div className="faint" style={{ marginBottom: 6 }}>Led by {commander.name}.</div>}
            <div className="row">
              <button
                className="btn grow"
                disabled={!!a.battleId}
                onClick={() => {
                  setTargeting({ kind: 'army_move', armyId: a.id, hint: 'March where? Water is slower.' });
                  setPanel('none');
                }}
              >
                🥾 March
              </button>
              <button
                className="btn grow"
                disabled={!!a.battleId}
                onClick={() => {
                  setTargeting({
                    kind: 'army_attack',
                    armyId: a.id,
                    hint: 'Choose your target — adjacent tiles only',
                  });
                  setPanel('none');
                }}
              >
                ⚔️ Attack
              </button>
              <button
                className="btn btn-danger"
                disabled={!!a.battleId}
                onClick={() => {
                  if (window.confirm('Disband this army? The troops go home; nothing is refunded.')) {
                    void runAction(() => api.disbandArmy(a.id), 'The banners are furled.');
                  }
                }}
              >
                ✕
              </button>
            </div>
          </div>
        );
      })}

      <div className="panel-section-title">Battles joining</div>
      {myBattles.length === 0 && <p className="faint">No horns sound for you. Yet.</p>}
      {myBattles.map((b) => {
        const attacking = b.attackerId === me.id;
        return (
          <div className="card" key={b.id}>
            <div className="row-between">
              <span>
                {attacking ? (
                  <>
                    You strike <b style={{ color: playerColor(b.defenderId ?? '') }}>{nameOf(b.defenderId)}</b>
                  </>
                ) : (
                  <>
                    <b style={{ color: playerColor(b.attackerId) }}>{nameOf(b.attackerId)}</b> strikes you
                  </>
                )}
              </span>
              <span className="tag tag-danger">({b.target.q}, {b.target.r})</span>
            </div>
            <p className={attacking ? 'muted' : 'bad'} style={{ marginTop: 4 }}>
              Resolves in {fmtTicks(Math.max(0, b.resolveTick - meta.tick), meta)}.
              {!attacking && ' Reinforce the tile or evacuate before the horns.'}
            </p>
          </div>
        );
      })}
    </Panel>
  );
}
