/**
 * The bottom action dock — the run's primary command bar.
 *
 * Two of these buttons (Recruit, Armies) open sheets that are siblings of this
 * component, not children, so there is no shared React parent to lift state
 * into. Rather than reach for a context/provider or bolt UI-open flags onto the
 * game store, the dock broadcasts a tiny window CustomEvent and the sheets
 * listen for it. The contract is exported below so the sheets consume the same
 * constant and payload type:
 *
 *   window.dispatchEvent(new CustomEvent(SOLO_SHEET_EVENT, { detail: 'recruit' }))
 *   window.addEventListener(SOLO_SHEET_EVENT, (e) => open(e.detail))  // in the sheet
 *
 * Everything else (Ark move, Daily, Upgrades) flows through the store actions.
 */
import React from 'react';
import { useSolo } from '../store.js';

/** The sheets the dock can summon. */
export type SoloSheetName = 'recruit' | 'armies';

/** The window event name RecruitSheet / ArmiesSheet listen on. */
export const SOLO_SHEET_EVENT = 'solo-sheet';

/** Broadcast a request to open one of the sibling sheets. */
export function openSoloSheet(name: SoloSheetName): void {
  window.dispatchEvent(new CustomEvent<SoloSheetName>(SOLO_SHEET_EVENT, { detail: name }));
}

const ARK_MOVE_HINT = 'Choose new anchorage — tap higher ground';

export function ActionDock() {
  const me = useSolo((s) => s.me);
  const targeting = useSolo((s) => s.targeting);
  const setTargeting = useSolo((s) => s.setTargeting);
  const openDaily = useSolo((s) => s.openDaily);
  const openMeta = useSolo((s) => s.openMeta);

  if (!me) return null;

  const armingArk = targeting?.kind === 'ark_move';

  return (
    <nav className="solo-dock" aria-label="Actions">
      <button
        className={armingArk ? 'active' : undefined}
        aria-pressed={armingArk}
        onClick={() => setTargeting(armingArk ? null : { kind: 'ark_move', hint: ARK_MOVE_HINT })}
      >
        <span className="ico" aria-hidden="true">⛵</span>
        <span className="lbl">Ark</span>
      </button>

      <button onClick={() => openSoloSheet('recruit')}>
        <span className="ico" aria-hidden="true">⚔️</span>
        <span className="lbl">Recruit</span>
      </button>

      <button onClick={() => openSoloSheet('armies')}>
        <span className="ico" aria-hidden="true">🛡️</span>
        <span className="lbl">Armies</span>
      </button>

      <button onClick={() => openDaily()}>
        <span className="ico" aria-hidden="true">🏆</span>
        <span className="lbl">Daily</span>
      </button>

      <button onClick={() => openMeta()}>
        <span className="ico" aria-hidden="true">🛠️</span>
        <span className="lbl">Upgrades</span>
      </button>
    </nav>
  );
}
