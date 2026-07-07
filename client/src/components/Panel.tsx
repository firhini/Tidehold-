import React from 'react';
import { useStore } from '../store.js';

export function Panel({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  const setPanel = useStore((s) => s.setPanel);
  return (
    <div className="panel">
      <div className="panel-head">
        <div className="panel-title">{title}</div>
        <button className="panel-close" onClick={() => setPanel('none')} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="panel-body">{children}</div>
    </div>
  );
}

/** Inline resource-cost row: "🪵 40 · 🌾 20". */
export function CostRow({ cost }: { cost: Partial<Record<string, number>> }) {
  const entries = Object.entries(cost).filter(([, v]) => (v ?? 0) > 0);
  if (entries.length === 0) return <span className="faint">free</span>;
  const icons: Record<string, string> = { timber: '🪵', ore: '⛏️', food: '🌾', relics: '🏺' };
  return (
    <span className="muted" style={{ whiteSpace: 'nowrap' }}>
      {entries.map(([k, v], i) => (
        <span key={k}>
          {i > 0 && ' · '}
          {icons[k] ?? k} {v}
        </span>
      ))}
    </span>
  );
}
