/**
 * First Orders — a live checklist that teaches the core loop in one minute.
 */
import React, { useEffect, useRef, useState } from 'react';
import { totalUnits } from '@tidehold/shared';
import { useStore } from '../store.js';

export function Onboarding() {
  const dismissed = useStore((s) => s.onboardingDismissed);
  const dismiss = useStore((s) => s.dismissOnboarding);
  const me = useStore((s) => s.me);
  const tiles = useStore((s) => s.tiles);
  const armies = useStore((s) => s.armies);
  const myExpeditions = useStore((s) => s.myExpeditions);
  const [autoHide, setAutoHide] = useState(false);
  const timer = useRef<number | null>(null);

  const myTiles = me ? tiles.filter((t) => t.ownerId === me.id) : [];
  const steps = [
    { label: 'Claim a tile near your Ark', done: myTiles.length > 0, hint: 'Tap land inside the golden dashed ring.' },
    {
      label: 'Build a Farm or Lumber Camp',
      done: myTiles.some((t) => t.building),
      hint: 'Select your tile, pick a building.',
    },
    {
      label: 'Raise an army',
      done: armies.some((a) => me && a.ownerId === me.id && totalUnits(a.units) > 0),
      hint: 'Armies panel → muster at the Ark.',
    },
    {
      label: 'Send an expedition into ruins',
      done: myExpeditions.length > 0 || (me?.techs.length ?? 0) > 0 || (me?.resources.relics ?? 0) > 0,
      hint: 'Find a 🏛 — drowned ruins are unguarded.',
    },
  ];
  const allDone = steps.every((s) => s.done);

  useEffect(() => {
    if (allDone && !dismissed && timer.current === null) {
      timer.current = window.setTimeout(() => dismiss(), 6000);
    }
    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [allDone, dismissed, dismiss]);

  if (dismissed || !me || autoHide) return null;

  return (
    <div className="onboarding">
      <div className="row-between">
        <b className="gold">First Orders</b>
        <button className="panel-close" onClick={() => setAutoHide(true)} title="Hide">
          –
        </button>
      </div>
      <p className="faint" style={{ margin: '4px 0 8px' }}>
        The sea is rising. Your people look to you.
      </p>
      {steps.map((s, i) => (
        <div key={i} className="row" style={{ padding: '3px 0', alignItems: 'flex-start' }}>
          <span className={s.done ? 'good' : 'faint'} style={{ width: 18 }}>
            {s.done ? '✓' : '○'}
          </span>
          <div>
            <span className={s.done ? 'muted' : ''} style={s.done ? { textDecoration: 'line-through' } : undefined}>
              {s.label}
            </span>
            {!s.done && <div className="faint">{s.hint}</div>}
          </div>
        </div>
      ))}
      {allDone ? (
        <p className="good" style={{ marginTop: 8 }}>
          Your people look to the horizon. Survive.
        </p>
      ) : (
        <button className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={dismiss}>
          I know the sea
        </button>
      )}
    </div>
  );
}
