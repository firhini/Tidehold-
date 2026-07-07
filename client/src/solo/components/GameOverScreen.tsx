/**
 * The run-end summary. Framed by outcome — a rare victory over the sea, an Ark
 * broken open, or a world simply drowned — then a scorecard and the choices
 * that carry a player onward. The rewarded hooks are dressed as optional
 * bonuses so the core loop never feels gated behind an ad.
 */
import React from 'react';
import { startNextRun, useSolo } from '../store.js';
import { fmt } from '../ui.js';
import { SOLO_SEASON_END_TIDE } from '../config.js';

const OUTCOME: Record<
  'outlasted' | 'breached' | 'drowned',
  { title: string; emblem: string; sub: string; gold: boolean }
> = {
  outlasted: {
    title: 'You Outlasted the Sea',
    emblem: '🏆',
    sub: 'The peaks held above the flood. Few Arks ever see this.',
    gold: true,
  },
  breached: {
    title: 'Your Ark Was Broken',
    emblem: '🛡️',
    sub: 'The hull gave way and the deep poured in — but the story goes on.',
    gold: false,
  },
  drowned: {
    title: 'The Sea Took Everything',
    emblem: '🌊',
    sub: 'As it always does. The only question is how long you lasted.',
    gold: false,
  },
};

export function GameOverScreen() {
  const result = useSolo((s) => s.result);
  const mode = useSolo((s) => s.mode);
  const continueAfterDefeat = useSolo((s) => s.continueAfterDefeat);
  const doubleReward = useSolo((s) => s.doubleReward);
  const shareResult = useSolo((s) => s.shareResult);
  const openMeta = useSolo((s) => s.openMeta);
  const openDaily = useSolo((s) => s.openDaily);

  if (!result) return null;

  const flavor = OUTCOME[result.outcome] ?? OUTCOME.drowned;

  const cells: { k: string; v: string; gold?: boolean }[] = [
    { k: 'Score', v: fmt(result.score), gold: true },
    { k: 'Tide reached', v: `${result.tideReached}/${SOLO_SEASON_END_TIDE}` },
    { k: 'Relics banked', v: fmt(result.relicsBanked) },
    { k: 'Battles won', v: fmt(result.battlesWon) },
    { k: 'Ruins cleared', v: fmt(result.ruinsCleared) },
    { k: 'Salvage earned', v: `🐚 ${fmt(result.salvageEarned)}`, gold: true },
  ];

  return (
    <div className="overlay">
      <div className="sheet">
        <div style={{ fontSize: 46, textAlign: 'center', lineHeight: 1 }}>{flavor.emblem}</div>
        <h2
          style={{
            marginTop: 6,
            color: flavor.gold ? undefined : 'var(--ink)',
            textShadow: flavor.gold ? '0 0 34px rgba(224,182,79,.45)' : undefined,
          }}
        >
          {flavor.title}
        </h2>
        <div className="sub">
          {flavor.sub}
          <br />
          <span className="gold" style={{ fontWeight: 700 }}>
            You placed #{result.placement}
          </span>{' '}
          of {result.fieldSize} Arks
        </div>

        <div className="result-grid">
          {cells.map((c) => (
            <div className="result-cell" key={c.k}>
              <div className="k">{c.k}</div>
              <div className={c.gold ? 'v gold' : 'v'}>{c.v}</div>
            </div>
          ))}
        </div>

        <div
          className="faint"
          style={{ textAlign: 'center', letterSpacing: '.14em', textTransform: 'uppercase', marginTop: 4 }}
        >
          Optional bonus · watch a short clip
        </div>
        <div className="btn-row" style={{ marginTop: 6 }}>
          {result.outcome !== 'outlasted' && (
            <button type="button" className="btn btn-reward" onClick={() => void continueAfterDefeat()}>
              ↻ Rise again (watch ad)
            </button>
          )}
          <button
            type="button"
            className="btn btn-reward"
            disabled={result.doubled}
            onClick={() => void doubleReward()}
          >
            {result.doubled ? '🐚 Salvage doubled ✓' : '🐚 Double salvage'}
          </button>
        </div>

        <div className="btn-row">
          <button type="button" className="btn btn-block" onClick={() => void startNextRun(mode)}>
            ▶ Play again
          </button>
        </div>

        <div className="btn-row">
          <button type="button" className="btn btn-ghost" onClick={() => void shareResult()}>
            Share ↗
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => openMeta()}>
            Upgrades 🛠️
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => openDaily()}>
            Daily 🏆
          </button>
        </div>
      </div>
    </div>
  );
}
