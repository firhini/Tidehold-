import React from 'react';
import { useSolo } from '../store.js';

/**
 * Cold-open teaching hint — a single glowing line above the dock.
 * Step 0 nudges the first claim; step 1 the first building. It retires itself
 * once the player has settled and built (coldOpenStep >= 2).
 */
export function ColdOpenHint() {
  const step = useSolo((s) => s.coldOpenStep);
  const show = useSolo((s) => s.showColdOpenHint);
  const me = useSolo((s) => s.me);

  if (!show || step >= 2 || !me) return null;

  const line =
    step === 0
      ? 'Tap the glowing tile to settle your first land.'
      : 'Now tap your tile and raise a Farm or Lumber Camp.';

  return <div className="coldopen">{line}</div>;
}
