/**
 * The rules of a drowning world, tight enough to read once and be dangerous.
 */
import React from 'react';
import {
  ARK_MOVE_RANGE,
  BATTLE_PREP_TICKS,
  COUNTER_BONUS,
  EXPEDITION_RANGE,
  MARKET_FEE,
  MARKET_FEE_WITH_PORT,
  OATHBREAKER_THRESHOLD,
  REP_ATTACK_ALLY,
  REP_BREAK_CONTRACT,
  SEASON_END_TIDE,
  WATCHTOWER_DEFENSE_BONUS,
} from '@tidehold/shared';
import { Panel } from './Panel.js';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <b className="gold">{title}</b>
      <div className="muted" style={{ marginTop: 6, fontSize: 13, lineHeight: 1.55 }}>
        {children}
      </div>
    </div>
  );
}

export function HelpPanel() {
  return (
    <Panel title="❓ How to survive">
      <Section title="🌊 The Tide">
        The sea rises level by level until it reaches {SEASON_END_TIDE} and the season ends. A tile floods when the
        tide reaches its elevation — pulsing tiles die at the <i>next</i> rise. Flooded buildings are destroyed;
        what they leave behind becomes drowned ruins you can plunder. The richest land lies lowest. That is not an
        accident.
      </Section>
      <Section title="⛵ The Ark">
        Your capital is a ship. You can only claim land within its influence radius, so migration is a way of life:
        move it (up to {ARK_MOVE_RANGE} hexes per move, costs food), then rebuild upslope. If your Ark falls in
        battle it is plundered and damaged — but never destroyed. You always sail on.
      </Section>
      <Section title="🌾 Economy">
        Timber builds, ore arms, food feeds armies and Ark moves, relics are legacy. Bank relics at a Shrine to
        score — that is how seasons are won. The Exchange trades everything for shells; prices climb as the world
        drowns. Market fee {Math.round(MARKET_FEE * 100)}%, or {Math.round(MARKET_FEE_WITH_PORT * 100)}% with a
        port.
      </Section>
      <Section title="⚔️ Warfare">
        Bladesworn cut down Tidebows, Tidebows shred Shieldbearers, Shieldbearers blunt Bladesworn (×
        {COUNTER_BONUS} against the countered class). Defenders gain terrain bonuses (peaks are fortresses) and +
        {Math.round(WATCHTOWER_DEFENSE_BONUS * 100)}% per watchtower level. Declared attacks resolve after{' '}
        {BATTLE_PREP_TICKS} ticks — the defender can reinforce or evacuate. Commanders add their trait to the
        fight and can be captured; buy them home with a ransom. No click-speed. Only judgment.
      </Section>
      <Section title="📜 The Ledger">
        Contracts are public record: alliances, non-aggression, trades, tributes, ransoms. Breaking one costs{' '}
        {Math.abs(REP_BREAK_CONTRACT)} reputation ({Math.abs(REP_ATTACK_ALLY)} for attacking an ally). Below{' '}
        {OATHBREAKER_THRESHOLD} reputation you are an Oathbreaker: doubled market fees, and anyone may attack you
        without dishonor. Infamy is a strategy. It is rarely a good one.
      </Section>
      <Section title="🧭 Exploration">
        Ruins hold relics, salvage, and lost technologies. Surface ruins are guarded by remnant garrisons — clear
        them with an army first. Drowned ruins are open to divers. Expeditions launch from your Ark or a port
        (range {EXPEDITION_RANGE}); each visit exhausts the site by one tier.
      </Section>
      <Section title="⏳ The Season">
        Expansion → Conflict → Endgame. Land shrinks, players collide, and the last peaks decide everything. Score
        comes from banked relics, battles, kept oaths, surviving land, and discovery. When the sea wins — and it
        always wins — the Chronicle remembers who mattered.
      </Section>
    </Panel>
  );
}
