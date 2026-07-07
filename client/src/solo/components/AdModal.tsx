/**
 * The mock ad. Stands in for the real CrazyGames / GameDistribution rewarded &
 * interstitial units on the portals — so the whole solo loop, including its
 * rewarded hooks, stays playable anywhere with no SDK present. A progress bar
 * fills over a couple of seconds, then the reward is granted automatically.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useSolo } from '../store.js';

const DURATION_MS = 2200;
/** Interstitials become skippable once the clip is mostly through. */
const INTERSTITIAL_SKIP_AT = 0.7;

export function AdModal() {
  const mockAd = useSolo((s) => s.mockAd);
  const [width, setWidth] = useState(0);
  const settled = useRef(false);

  useEffect(() => {
    if (!mockAd) return;
    settled.current = false;
    setWidth(0);
    const started = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - started) / DURATION_MS);
      setWidth(p * 100);
      if (p >= 1) {
        if (!settled.current) {
          settled.current = true;
          mockAd.resolve(true);
        }
        return;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [mockAd]);

  if (!mockAd) return null;

  const rewarded = mockAd.kind === 'rewarded';
  const canSkipInterstitial = width >= INTERSTITIAL_SKIP_AT * 100;

  const finish = (ok: boolean) => {
    if (settled.current) return;
    settled.current = true;
    mockAd.resolve(ok);
  };

  return (
    <div className="ad-modal" role="dialog" aria-label="Advertisement">
      <div className="ad-box">
        <b className="gold">{rewarded ? 'Your reward is loading…' : 'A short break…'}</b>
        <div className="ad-fake">Ad · your game keeps the lights on</div>
        <div className="ad-progress">
          <div style={{ width: `${Math.round(width)}%` }} />
        </div>
        {rewarded ? (
          <button type="button" className="btn btn-ghost btn-block" onClick={() => finish(false)}>
            Skip (no reward)
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-ghost btn-block"
            disabled={!canSkipInterstitial}
            onClick={() => finish(true)}
          >
            {canSkipInterstitial ? 'Skip' : 'Please wait…'}
          </button>
        )}
      </div>
    </div>
  );
}
