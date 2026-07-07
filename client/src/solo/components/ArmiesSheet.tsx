import React from 'react';
import type { Army } from '@tidehold/shared';
import { useSolo } from '../store.js';
import { UNIT_META, fmtTicks } from '../ui.js';
import { SOLO_SHEET_EVENT, type SoloSheetName } from './ActionDock.js';

/**
 * Armies sheet — your banners in the field. Opened by the ActionDock's "Armies"
 * button via the `solo-sheet` window event. Lists each column with its makeup,
 * its assigned commander, and orders to march or assault (which arm the map's
 * targeting mode and close the sheet). Pending battles you're party to show
 * their countdown so you can reinforce or retreat in time.
 */
export function ArmiesSheet() {
  const [open, setOpen] = React.useState(false);

  const me = useSolo((s) => s.me);
  const armies = useSolo((s) => s.armies);
  const battles = useSolo((s) => s.battles);
  const meta = useSolo((s) => s.meta);
  const assignCommander = useSolo((s) => s.assignCommander);
  const setTargeting = useSolo((s) => s.setTargeting);

  React.useEffect(() => {
    const onSheet = (e: Event) => {
      if ((e as CustomEvent<SoloSheetName>).detail === 'armies') setOpen(true);
    };
    window.addEventListener(SOLO_SHEET_EVENT, onSheet);
    return () => window.removeEventListener(SOLO_SHEET_EVENT, onSheet);
  }, []);

  if (!open || !me) return null;

  const close = () => setOpen(false);
  const mine = armies.filter((a) => a.ownerId === 'you');
  const myBattles = battles.filter((b) => b.attackerId === 'you' || b.defenderId === 'you');
  const tick = meta?.tick ?? 0;

  const order = (kind: 'army_move' | 'army_attack', armyId: string, hint: string) => {
    setTargeting({ kind, armyId, hint });
    close();
  };

  return (
    <aside className="panel" aria-label="Armies">
      <div className="panel-head">
        <span className="panel-title">Your Banners</span>
        <button className="panel-close" onClick={close} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="panel-body">
        {mine.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '22px 16px' }}>
            <div style={{ fontSize: 30, marginBottom: 6 }} aria-hidden="true">🏳️</div>
            <div className="muted">No banners in the field yet — muster at your Ark.</div>
          </div>
        ) : (
          mine.map((army) => (
            <ArmyCard
              key={army.id}
              army={army}
              atArk={army.q === me.ark.q && army.r === me.ark.r}
              commanders={me.commanders}
              onAssign={(id) => assignCommander(army.id, id)}
              onMove={() => order('army_move', army.id, 'March where?')}
              onAttack={() => order('army_attack', army.id, 'Choose an adjacent target')}
            />
          ))
        )}

        {myBattles.length > 0 && (
          <>
            <div className="panel-section-title">Pending Battles</div>
            {myBattles.map((b) => {
              const attacking = b.attackerId === 'you';
              return (
                <div key={b.id} className="card row-between">
                  <span className={attacking ? 'gold' : 'bad'} style={{ fontWeight: 600 }}>
                    {attacking ? '⚔ Assault on' : '🛡 Defending'} ({b.target.q}, {b.target.r})
                  </span>
                  <span className="faint" style={{ whiteSpace: 'nowrap' }}>
                    resolves in {fmtTicks(Math.max(0, b.resolveTick - tick))}
                  </span>
                </div>
              );
            })}
          </>
        )}

        <p className="faint" style={{ marginTop: 4 }}>
          New companies always muster at your Ark <span className="gold">({me.ark.q}, {me.ark.r})</span>.
        </p>
      </div>
    </aside>
  );
}

function ArmyCard({
  army,
  atArk,
  commanders,
  onAssign,
  onMove,
  onAttack,
}: {
  army: Army;
  atArk: boolean;
  commanders: { id: string; name: string; level: number; status: string }[];
  onAssign: (id: string | null) => void;
  onMove: () => void;
  onAttack: () => void;
}) {
  const total = army.units.shields + army.units.blades + army.units.bows;
  const inBattle = !!army.battleId;
  const marching = !inBattle && army.path.length > 0;

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="row-between">
        <span style={{ fontWeight: 700 }}>
          {total} {total === 1 ? 'soldier' : 'soldiers'}
        </span>
        <span
          className={inBattle ? 'tag tag-danger' : marching ? 'tag tag-gold' : 'tag'}
          style={{ whiteSpace: 'nowrap' }}
        >
          {inBattle ? 'In battle' : marching ? 'Marching' : atArk ? 'At the Ark' : 'Holding'}
        </span>
      </div>

      <div className="faint" style={{ display: 'flex', gap: 12 }}>
        <span>{UNIT_META.shields.icon} {army.units.shields}</span>
        <span>{UNIT_META.blades.icon} {army.units.blades}</span>
        <span>{UNIT_META.bows.icon} {army.units.bows}</span>
        <span className="grow" />
        <span>({army.q}, {army.r})</span>
      </div>

      <div>
        <label className="field-label" htmlFor={`cmd-${army.id}`}>Commander</label>
        <select
          id={`cmd-${army.id}`}
          className="input"
          style={{ minHeight: 42 }}
          value={army.commanderId ?? ''}
          onChange={(e) => onAssign(e.target.value || null)}
        >
          <option value="">No commander</option>
          {commanders
            .filter((c) => c.status === 'ready' || c.id === army.commanderId)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · Lv {c.level}
              </option>
            ))}
        </select>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <button
          type="button"
          className="btn btn-ghost grow"
          style={{ minHeight: 44 }}
          onClick={onMove}
          disabled={inBattle}
          title={inBattle ? 'Committed to battle' : 'March this column'}
        >
          🚩 Move
        </button>
        <button
          type="button"
          className="btn grow"
          style={{ minHeight: 44 }}
          onClick={onAttack}
          disabled={inBattle}
          title={inBattle ? 'Committed to battle' : 'Assault an adjacent target'}
        >
          ⚔ Attack
        </button>
      </div>
    </div>
  );
}
