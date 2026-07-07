/**
 * The pause overlay. The tide waits while you plan — a quick read of where the
 * run stands, the ways out, and a compact controls legend for anyone who
 * dropped in mid-flood.
 */
import React from 'react';
import { useSolo } from '../store.js';
import { fmt } from '../ui.js';
import { SOLO_SEASON_END_TIDE } from '../config.js';

const CONTROLS: { keys: string[]; label: string }[] = [
  { keys: ['Drag', 'Pinch'], label: 'pan and zoom the map' },
  { keys: ['Wheel'], label: 'zoom in and out' },
  { keys: ['W A S D', '↑ ↓ ← →'], label: 'pan the view' },
  { keys: ['+', '−'], label: 'zoom in and out' },
  { keys: ['Esc'], label: 'cancel a targeting order' },
];

export function PauseSheet() {
  const stats = useSolo((s) => s.stats);
  const togglePause = useSolo((s) => s.togglePause);
  const openMeta = useSolo((s) => s.openMeta);
  const quitToMenu = useSolo((s) => s.quitToMenu);

  const giveUp = () => {
    if (window.confirm('Give up this run? Your score so far is banked and the run ends.')) quitToMenu();
  };

  return (
    <div className="overlay">
      <div className="sheet">
        <h2>Paused</h2>
        <div className="sub">The tide holds its breath while you plan.</div>

        {stats && (
          <div className="result-grid">
            <div className="result-cell">
              <div className="k">Score</div>
              <div className="v gold">{fmt(stats.score)}</div>
            </div>
            <div className="result-cell">
              <div className="k">Tide</div>
              <div className="v">{stats.tideLevel}/{SOLO_SEASON_END_TIDE}</div>
            </div>
            <div className="result-cell">
              <div className="k">Placement</div>
              <div className="v">#{stats.placement}/{stats.fieldSize}</div>
            </div>
            <div className="result-cell">
              <div className="k">Arks afloat</div>
              <div className="v">{stats.aliveArks}</div>
            </div>
          </div>
        )}

        <div className="btn-row">
          <button type="button" className="btn btn-block" onClick={() => togglePause()}>
            ▶ Resume
          </button>
        </div>
        <div className="btn-row">
          <button type="button" className="btn btn-ghost" onClick={() => openMeta()}>
            Upgrades 🛠️
          </button>
          <button type="button" className="btn btn-danger" onClick={giveUp}>
            Give up
          </button>
        </div>

        <div className="card" style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="panel-section-title" style={{ marginTop: 0 }}>
            Controls
          </div>
          {CONTROLS.map((c) => (
            <div className="row" key={c.label + c.keys.join()} style={{ gap: 8, flexWrap: 'wrap' }}>
              <div className="row" style={{ gap: 4 }}>
                {c.keys.map((k, i) => (
                  <React.Fragment key={k}>
                    {i > 0 && <span className="faint">or</span>}
                    <span className="tag" style={{ color: 'var(--ink)' }}>
                      {k}
                    </span>
                  </React.Fragment>
                ))}
              </div>
              <span className="muted">{c.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
