/**
 * Heads-up display: resources on top, the Tide's countdown at center stage,
 * navigation below. The HUD keeps the one number that matters — when the
 * water rises next — impossible to miss.
 */
import React from 'react';
import { OATHBREAKER_THRESHOLD, RESOURCE_LIST, SEASON_END_TIDE } from '@tidehold/shared';
import { useStore, type PanelId } from '../store.js';
import { fmt, fmtShells, fmtTicks, RESOURCE_META } from '../ui/util.js';

const NAV: { id: PanelId; icon: string; label: string }[] = [
  { id: 'ark', icon: '⛵', label: 'Ark' },
  { id: 'armies', icon: '⚔️', label: 'Armies' },
  { id: 'ledger', icon: '📜', label: 'Ledger' },
  { id: 'market', icon: '⚖️', label: 'Market' },
  { id: 'rankings', icon: '🏆', label: 'Ranks' },
  { id: 'chronicle', icon: '📯', label: 'Chronicle' },
  { id: 'help', icon: '❓', label: 'Help' },
];

const PHASE_LABEL: Record<string, { text: string; className: string }> = {
  expansion: { text: 'EXPANSION', className: 'phase-expansion' },
  conflict: { text: 'CONFLICT', className: 'phase-conflict' },
  endgame: { text: 'ENDGAME', className: 'phase-endgame' },
  ended: { text: 'SEASON ENDED', className: 'phase-endgame' },
};

export function HUD() {
  const me = useStore((s) => s.me);
  const meta = useStore((s) => s.meta);
  const panel = useStore((s) => s.panel);
  const setPanel = useStore((s) => s.setPanel);
  const signOut = useStore((s) => s.signOut);
  const myContracts = useStore((s) => s.myContracts);
  const battles = useStore((s) => s.battles);
  const playerId = useStore((s) => s.playerId);

  if (!me || !meta) return null;

  const ticksToTide = meta.nextTideTick - meta.tick;
  const urgent = ticksToTide <= 30 && meta.phase !== 'ended';
  const tidePct = Math.min(100, (meta.tideLevel / SEASON_END_TIDE) * 100);
  const phase = PHASE_LABEL[meta.phase] ?? PHASE_LABEL.expansion;
  const isOathbreaker = me.reputation < OATHBREAKER_THRESHOLD;

  const proposalsForMe = myContracts.filter((c) => c.status === 'proposed' && c.toId === playerId).length;
  const battlesOnMe = battles.filter((b) => b.defenderId === playerId).length;

  const toggle = (id: PanelId) => setPanel(panel === id ? 'none' : id);

  return (
    <>
      <div className="hud-top">
        <div className="hud-resources">
          {RESOURCE_LIST.map((res) => (
            <span key={res} className="hud-chip" title={RESOURCE_META[res].label}>
              <span className="hud-chip-icon">{RESOURCE_META[res].icon}</span>
              {fmt(me.resources[res])}
            </span>
          ))}
          <span className="hud-chip" title="Shells (market currency)">
            <span className="hud-chip-icon">🐚</span>
            {fmtShells(me.shells)}
          </span>
          <span className="hud-chip hud-chip-gold" title="Legacy score">
            <span className="hud-chip-icon">⭐</span>
            {fmt(me.score)}
          </span>
        </div>

        <div className={`hud-tide ${urgent ? 'hud-tide-urgent' : ''}`}>
          <div className="hud-tide-text">
            <span className="hud-tide-label">
              🌊 TIDE {meta.tideLevel}/{SEASON_END_TIDE}
            </span>
            <span className="hud-tide-when">
              {meta.phase === 'ended' ? 'the sea has won' : `rises in ${fmtTicks(ticksToTide, meta)}`}
            </span>
            <span className={`hud-phase ${phase.className}`}>{phase.text}</span>
          </div>
          <div className="hud-tide-bar">
            <div className="hud-tide-fill" style={{ width: `${tidePct}%` }} />
          </div>
        </div>

        <div className="hud-identity">
          <span className={`hud-rep ${isOathbreaker ? 'bad' : ''}`} title="Reputation">
            {isOathbreaker ? '⚖️ OATHBREAKER' : `⚖️ ${Math.round(me.reputation)}`}
          </span>
          <span className="hud-name">{me.username}</span>
          <button className="hud-signout" onClick={signOut} title="Sign out">
            ⏻
          </button>
        </div>
      </div>

      <nav className="hud-bottom">
        {NAV.map((n) => {
          const badge = n.id === 'ledger' ? proposalsForMe : n.id === 'armies' ? battlesOnMe : 0;
          return (
            <button
              key={n.id}
              className={`hud-nav-btn ${panel === n.id ? 'active' : ''}`}
              onClick={() => toggle(n.id)}
            >
              <span className="hud-nav-icon">{n.icon}</span>
              <span className="hud-nav-label">{n.label}</span>
              {badge > 0 && <span className="hud-badge">{badge}</span>}
            </button>
          );
        })}
      </nav>
    </>
  );
}
