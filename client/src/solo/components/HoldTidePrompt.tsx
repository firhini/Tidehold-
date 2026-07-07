import React from 'react';
import { useSolo } from '../store.js';

/**
 * The rewarded "hold back the tide" hook — a floating prompt that surfaces only
 * when the next rise is imminent. The bonus label tells players it's optional.
 */
export function HoldTidePrompt() {
  const stats = useSolo((s) => s.stats);
  const holdBackTide = useSolo((s) => s.holdBackTide);

  if (!stats || !stats.tideImminent) return null;

  return (
    <div className="hold-tide">
      <span>🌊 The tide is about to rise —</span>
      <button
        type="button"
        className="btn btn-reward"
        onClick={() => void holdBackTide()}
        title="Watch a short clip to delay the next rise"
      >
        ▶ Hold it back
      </button>
    </div>
  );
}
