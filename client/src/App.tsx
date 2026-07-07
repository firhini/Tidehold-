import React, { useEffect } from 'react';
import { useStore } from './store.js';
import { Landing } from './components/Landing.js';
import { GameView } from './components/GameView.js';

export function App() {
  const booting = useStore((s) => s.booting);
  const authed = useStore((s) => s.authed);
  const boot = useStore((s) => s.boot);

  useEffect(() => {
    void boot();
  }, [boot]);

  if (booting) {
    return (
      <div className="splash">
        <div className="splash-title">TIDEHOLD</div>
        <div className="splash-sub">raising the drowned world…</div>
      </div>
    );
  }

  return authed ? <GameView /> : <Landing />;
}
