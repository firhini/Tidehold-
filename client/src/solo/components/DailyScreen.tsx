/**
 * The Daily Tide — one shared, deterministic drowning world per calendar day.
 * Shows your local leaderboard of attempts at today's seed, lets you play the
 * Daily (or a random Endless run), and copies a shareable ?day= link so friends
 * face the exact same map. Everyone races the same rising sea.
 */
import React from 'react';
import { dayKeyFor, prettyDay, useSolo } from '../store.js';
import { fmt } from '../ui.js';

/** Leave the leaderboard back to wherever the player came from — a live run, else game-over. */
function back(): void {
  const s = useSolo.getState();
  if (s.me && !s.result) useSolo.setState({ screen: 'run' });
  else useSolo.setState({ screen: 'gameover' });
}

const PRIMARY_BTN: React.CSSProperties = { minHeight: 44 };

export function DailyScreen() {
  const daily = useSolo((s) => s.daily);
  const meta = useSolo((s) => s.metaState);
  const startRun = useSolo((s) => s.startRun);
  const toast = useSolo((s) => s.toast);

  const today = dayKeyFor(new Date());
  const board = daily.days[today] ?? [];

  const shareSeed = async () => {
    try {
      const url = new URL(window.location.href);
      url.search = `?day=${today}`;
      await navigator.clipboard.writeText(url.toString());
      toast('success', "Link copied — challenge a friend to today's tide.");
    } catch {
      toast('info', `Copy failed — share the address bar with ?day=${today}`);
    }
  };

  return (
    <div className="overlay" role="dialog" aria-label="The Daily Tide">
      <div className="sheet">
        <div className="row-between" style={{ marginBottom: 14 }}>
          <button className="btn btn-ghost" style={{ minHeight: 40 }} onClick={back}>
            ← Back to the sea
          </button>
          <span className="tag tag-gold">{prettyDay(today)}</span>
        </div>

        <h2>The Daily Tide</h2>
        <p className="sub">Everyone plays the same drowning world each day. Beat your friends' scores.</p>

        {board.length === 0 ? (
          <div
            className="card"
            style={{ textAlign: 'center', padding: '24px 16px', color: 'var(--ink-faint)', lineHeight: 1.5 }}
          >
            No runs logged for today's seed yet — the sea is waiting.
          </div>
        ) : (
          <div style={{ margin: '4px 0 8px' }}>
            {board.map((e, i) => (
              <div className="lb-row" key={i}>
                <span className="row" style={{ gap: 10, minWidth: 0 }}>
                  <span className="lb-rank">#{i + 1}</span>
                  <b className="gold" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(e.score)}</b>
                  <span className="faint">Tide {e.tide}/8</span>
                </span>
                <span className="muted" style={{ whiteSpace: 'nowrap' }}>placed #{e.placement}</span>
              </div>
            ))}
          </div>
        )}

        {meta.bestScore > 0 && (
          <p className="faint" style={{ textAlign: 'center', marginTop: 2 }}>
            Your all-time best: <span className="gold">{fmt(meta.bestScore)}</span> · reached Tide {meta.bestTide}/8
          </p>
        )}

        <button className="btn btn-block" style={{ ...PRIMARY_BTN, marginTop: 12 }} onClick={() => startRun('daily')}>
          Play today's Daily ▶
        </button>
        <div className="btn-row">
          <button className="btn btn-ghost" style={PRIMARY_BTN} onClick={() => startRun('endless')}>
            Endless run 🎲 (random seed)
          </button>
          <button className="btn btn-ghost" style={PRIMARY_BTN} onClick={shareSeed}>
            Share today's seed ↗
          </button>
        </div>
      </div>
    </div>
  );
}
