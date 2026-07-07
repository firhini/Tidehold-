/**
 * The Daily Tide — one shared drowning world per day, a local leaderboard of
 * your attempts, and a shareable seed link. Everyone plays the same map.
 */
import React from 'react';
import { dayKeyFor, prettyDay, useSolo } from '../store.js';
import { fmt } from '../ui.js';

function back(): void {
  const s = useSolo.getState();
  useSolo.setState({ screen: s.result ? 'gameover' : 'run' });
}

export function DailyScreen() {
  const daily = useSolo((s) => s.daily);
  const startRun = useSolo((s) => s.startRun);
  const toast = useSolo((s) => s.toast);

  const today = dayKeyFor(new Date());
  const board = daily.days[today] ?? [];

  const shareSeed = async () => {
    const url = new URL(location.href);
    url.search = `?day=${today}`;
    try {
      await navigator.clipboard.writeText(
        `🌊 TIDEHOLD — today's Daily Tide (${prettyDay(today)}). Same drowning world for everyone. How long can you last?\n${url.toString()}`,
      );
      toast('success', 'Link copied — challenge a friend.');
    } catch {
      toast('info', 'Copy failed; copy the address bar with ?day=' + today);
    }
  };

  return (
    <div className="overlay">
      <div className="sheet">
        <div className="row-between" style={{ marginBottom: 6 }}>
          <button className="btn btn-ghost" onClick={back}>← Back to the sea</button>
          <span className="tag tag-gold">{prettyDay(today)}</span>
        </div>
        <h2 style={{ marginBottom: 2 }}>The Daily Tide</h2>
        <div className="sub">Everyone plays the same drowning world today. Beat your friends' scores.</div>

        {board.length === 0 ? (
          <p className="faint" style={{ textAlign: 'center', padding: '18px 0' }}>
            No runs logged for today's seed yet — the sea is waiting.
          </p>
        ) : (
          <div style={{ margin: '10px 0' }}>
            {board.map((e, i) => (
              <div className="lb-row" key={i}>
                <span className="row" style={{ gap: 10 }}>
                  <span className="lb-rank">#{i + 1}</span>
                  <b className="gold">{fmt(e.score)}</b>
                </span>
                <span className="muted">Tide {e.tide}/8 · placed #{e.placement}</span>
              </div>
            ))}
          </div>
        )}

        <button className="btn btn-block" style={{ marginTop: 8 }} onClick={() => startRun('daily')}>▶ Play today's Daily</button>
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={() => startRun('endless')}>🎲 Endless run</button>
          <button className="btn btn-ghost" onClick={shareSeed}>Share seed ↗</button>
        </div>
      </div>
    </div>
  );
}
