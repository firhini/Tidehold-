import React, { useEffect } from 'react';
import { useStore } from '../store.js';
import { playerColor } from '../ui/util.js';
import { Panel } from './Panel.js';

export function RankingsPanel() {
  const rankings = useStore((s) => s.rankings);
  const refreshRankings = useStore((s) => s.refreshRankings);
  const playerId = useStore((s) => s.playerId);
  const meta = useStore((s) => s.meta);

  useEffect(() => {
    void refreshRankings();
  }, [refreshRankings]);

  return (
    <Panel title="🏆 Rankings">
      {rankings.length === 0 && <p className="faint">The sea has not yet chosen its favorites.</p>}
      {rankings.map((p, i) => (
        <div
          className="card row-between"
          key={p.id}
          style={p.id === playerId ? { borderColor: 'rgba(224,182,79,0.5)' } : undefined}
        >
          <span className="row" style={{ gap: 10 }}>
            <b className={i < 3 ? 'gold' : 'muted'} style={{ width: 22, textAlign: 'right' }}>
              {i + 1}
            </b>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                background: playerColor(p.id),
                display: 'inline-block',
              }}
            />
            <span>
              <b>{p.username}</b>
              {p.reputation < 60 && <span className="tag tag-danger" style={{ marginLeft: 6 }}>oathbreaker</span>}
            </span>
          </span>
          <span className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
            ⭐ {p.score} · ⚖ {p.reputation} · 📚 {p.techs}
          </span>
        </div>
      ))}
      <p className="faint" style={{ textAlign: 'center' }}>
        Season {meta?.season ?? 1} · The sea keeps the final score.
      </p>
    </Panel>
  );
}
