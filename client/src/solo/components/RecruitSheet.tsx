import React from 'react';
import { canAfford, UNIT_LIST, UNITS, unitCost, armyUpkeep, type UnitCounts, type UnitType } from '@tidehold/shared';
import { useSolo } from '../store.js';
import { UNIT_META, resourceCost } from '../ui.js';
import { SOLO_SHEET_EVENT, type SoloSheetName } from './ActionDock.js';

const ZERO: UnitCounts = { shields: 0, blades: 0, bows: 0 };

/**
 * Recruit sheet — muster fresh companies at the Ark. Opened by the ActionDock's
 * "Recruit" button via the `solo-sheet` window event. Steppers build up a draft
 * order; the live cost + upkeep update as you tune it, and the order is placed
 * (optimistically) through the store, which toasts its own success/errors.
 */
export function RecruitSheet() {
  const [open, setOpen] = React.useState(false);
  const [counts, setCounts] = React.useState<UnitCounts>(ZERO);

  const me = useSolo((s) => s.me);
  const recruit = useSolo((s) => s.recruit);

  React.useEffect(() => {
    const onSheet = (e: Event) => {
      if ((e as CustomEvent<SoloSheetName>).detail === 'recruit') setOpen(true);
    };
    window.addEventListener(SOLO_SHEET_EVENT, onSheet);
    return () => window.removeEventListener(SOLO_SHEET_EVENT, onSheet);
  }, []);

  if (!open || !me) return null;

  const adjust = (type: UnitType, delta: number) =>
    setCounts((c) => ({ ...c, [type]: Math.max(0, c[type] + delta) }));

  const total = counts.shields + counts.blades + counts.bows;
  const cost = unitCost(counts);
  const upkeep = armyUpkeep(counts);
  const affordable = canAfford(me.resources, cost);
  const disabled = total === 0 || !affordable;

  const submit = () => {
    // Optimistic: reset the draft immediately; the store toasts success/errors.
    recruit(counts);
    setCounts(ZERO);
  };

  return (
    <aside className="panel" aria-label="Recruit">
      <div className="panel-head">
        <span className="panel-title">Muster Troops</span>
        <button className="panel-close" onClick={() => setOpen(false)} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="panel-body">
        <p className="faint">
          Fresh companies rally at your Ark <span className="gold">({me.ark.q}, {me.ark.r})</span>.
          Balance the blade against the tide.
        </p>

        {UNIT_LIST.map((type) => {
          const meta = UNIT_META[type];
          const spec = UNITS[type];
          const n = counts[type];
          return (
            <div key={type} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="row-between">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
                  <span aria-hidden="true" style={{ fontSize: 18 }}>{meta.icon}</span>
                  {meta.label}
                </span>
                <span className="faint" style={{ whiteSpace: 'nowrap' }}>
                  ⚔ {spec.attack} · 🛡 {spec.defense}
                </span>
              </div>
              <div className="faint">{meta.blurb}</div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div className="row" style={{ gap: 6 }}>
                  <StepBtn label="−5" onClick={() => adjust(type, -5)} disabled={n === 0} />
                  <StepBtn label="−1" onClick={() => adjust(type, -1)} disabled={n === 0} />
                </div>
                <span
                  style={{
                    minWidth: 44,
                    textAlign: 'center',
                    fontSize: 20,
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    color: n > 0 ? 'var(--brass)' : 'var(--ink-faint)',
                  }}
                >
                  {n}
                </span>
                <div className="row" style={{ gap: 6 }}>
                  <StepBtn label="+1" onClick={() => adjust(type, 1)} />
                  <StepBtn label="+5" onClick={() => adjust(type, 5)} />
                </div>
              </div>
            </div>
          );
        })}

        <div className="divider" />

        <div className="row-between">
          <span className="muted">Cost</span>
          <span style={{ fontWeight: 700 }} className={affordable ? undefined : 'bad'}>
            {resourceCost(cost)}
          </span>
        </div>
        <div className="row-between">
          <span className="muted">Upkeep</span>
          <span className="faint">🌾 {upkeep.toFixed(2)} / tick</span>
        </div>

        <button
          type="button"
          className="btn btn-block"
          style={{ minHeight: 44, marginTop: 4 }}
          disabled={disabled}
          onClick={submit}
        >
          {total === 0 ? 'Choose your troops' : !affordable ? 'Not enough resources' : `Recruit ${total} ${total === 1 ? 'unit' : 'units'}`}
        </button>
      </div>
    </aside>
  );
}

function StepBtn({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      style={{ minWidth: 44, minHeight: 40, padding: 0, fontVariantNumeric: 'tabular-nums' }}
    >
      {label}
    </button>
  );
}
