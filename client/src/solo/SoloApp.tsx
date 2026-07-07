/**
 * The single-player app shell. One run at a time, screens over a live map.
 * Start immediately in-game (boot() launches today's Daily Tide).
 */
import React, { useEffect } from 'react';
import { useSolo } from './store.js';
import { SoloMapCanvas } from './SoloMapCanvas.js';
import { SoloHUD } from './components/SoloHUD.js';
import { ColdOpenHint } from './components/ColdOpenHint.js';
import { ActionDock } from './components/ActionDock.js';
import { TileSheet } from './components/TileSheet.js';
import { RecruitSheet } from './components/RecruitSheet.js';
import { ArmiesSheet } from './components/ArmiesSheet.js';
import { HoldTidePrompt } from './components/HoldTidePrompt.js';
import { SoloToasts } from './components/SoloToasts.js';
import { GameOverScreen } from './components/GameOverScreen.js';
import { MetaScreen } from './components/MetaScreen.js';
import { DailyScreen } from './components/DailyScreen.js';
import { PauseSheet } from './components/PauseSheet.js';
import { AdModal } from './components/AdModal.js';
import './theme-solo.css';

export function SoloApp() {
  const screen = useSolo((s) => s.screen);
  const paused = useSolo((s) => s.paused);
  const boot = useSolo((s) => s.boot);

  useEffect(() => {
    boot();
  }, [boot]);

  if (screen === 'loading') {
    return (
      <div className="splash">
        <div className="splash-title">TIDEHOLD</div>
        <div className="splash-sub">the sea is rising…</div>
      </div>
    );
  }

  return (
    <div className="game-root">
      <SoloMapCanvas />
      {screen === 'run' && (
        <>
          <SoloHUD />
          <ColdOpenHint />
          <HoldTidePrompt />
          <ActionDock />
          <TileSheet />
          <RecruitSheet />
          <ArmiesSheet />
          {paused && <PauseSheet />}
        </>
      )}
      {screen === 'gameover' && <GameOverScreen />}
      {screen === 'meta' && <MetaScreen />}
      {screen === 'daily' && <DailyScreen />}
      <SoloToasts />
      <AdModal />
    </div>
  );
}
