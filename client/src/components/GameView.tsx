/**
 * The in-game shell: full-screen map with floating HUD and side panels.
 * Layout only — each child owns its own logic.
 */
import React from 'react';
import { useStore } from '../store.js';
import { MapCanvas } from '../game/MapCanvas.js';
import { HUD } from './HUD.js';
import { TilePanel } from './TilePanel.js';
import { ArkPanel } from './ArkPanel.js';
import { ArmiesPanel } from './ArmiesPanel.js';
import { LedgerPanel } from './LedgerPanel.js';
import { MarketPanel } from './MarketPanel.js';
import { RankingsPanel } from './RankingsPanel.js';
import { ChroniclePanel } from './ChroniclePanel.js';
import { HelpPanel } from './HelpPanel.js';
import { Onboarding } from './Onboarding.js';
import { Toasts } from './Toasts.js';

export function GameView() {
  const panel = useStore((s) => s.panel);

  return (
    <div className="game-root">
      <MapCanvas />
      <HUD />
      {panel === 'tile' && <TilePanel />}
      {panel === 'ark' && <ArkPanel />}
      {panel === 'armies' && <ArmiesPanel />}
      {panel === 'ledger' && <LedgerPanel />}
      {panel === 'market' && <MarketPanel />}
      {panel === 'rankings' && <RankingsPanel />}
      {panel === 'chronicle' && <ChroniclePanel />}
      {panel === 'help' && <HelpPanel />}
      <Onboarding />
      <Toasts />
    </div>
  );
}
