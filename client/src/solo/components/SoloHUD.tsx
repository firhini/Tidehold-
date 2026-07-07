import React from 'react';
import { useSolo } from '../store.js';
import { fmt, fmtTicks, RESOURCE_META, PHASE_LABEL, toggleFullscreen } from '../ui.js';
import { SOLO_RESOURCE_ORDER, SOLO_SEASON_END_TIDE } from '../config.js';

/**
 * Run HUD — the compact top strip.
 * Left: resource chips + score. Center: the tide gauge. Right: standing,
 * fullscreen, pause. Kept short-labelled so the theme can wrap on mobile.
 */
export function SoloHUD() {
  const me = useSolo((s) => s.me);
  const stats = useSolo((s) => s.stats);
  const togglePause = useSolo((s) => s.togglePause);

  if (!me || !stats) return null;

  const tidePct = Math.max(0, Math.min(100, (stats.tideLevel / SOLO_SEASON_END_TIDE) * 100));
  const phase = PHASE_LABEL[stats.phase];

  return (
    <div className="solo-hud-top">
      {/* LEFT — the ledger */}
      <div className="hud-resources">
        {SOLO_RESOURCE_ORDER.map((res) => (
          <span key={res} className="solo-stat" title={RESOURCE_META[res].label}>
            <span aria-hidden="true">{RESOURCE_META[res].icon}</span>
            {fmt(me.resources[res])}
          </span>
        ))}
        <span className="solo-stat" title="Score">
          <span aria-hidden="true">⭐</span>
          {fmt(stats.score)}
        </span>
      </div>

      {/* CENTER — the rising sea */}
      <div className={stats.tideImminent ? 'solo-tide imminent' : 'solo-tide'}>
        <div className="solo-tide-row">
          <span className="hud-tide-label">🌊 TIDE {stats.tideLevel}/{SOLO_SEASON_END_TIDE}</span>
          <span className="hud-tide-when">rises in {fmtTicks(stats.nextTideInTicks)}</span>
          {phase && <span className={`hud-phase ${phase.cls}`}>{phase.text}</span>}
        </div>
        <div className="solo-tide-fill-track">
          <div className="solo-tide-fill" style={{ width: `${tidePct}%` }} />
        </div>
      </div>

      {/* RIGHT — standing + controls */}
      <div className="solo-hud-right">
        <span className="solo-stat" title="Your standing in the field">
          #{stats.placement}/{stats.fieldSize}
        </span>
        <button
          type="button"
          className="icon-btn"
          onClick={() => void toggleFullscreen()}
          title="Fullscreen"
          aria-label="Toggle fullscreen"
        >
          ⛶
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => togglePause()}
          title="Pause"
          aria-label="Pause"
        >
          ⏸
        </button>
      </div>
    </div>
  );
}
