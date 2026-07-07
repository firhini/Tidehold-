/**
 * Solo-mode types: the persistent meta save, the daily leaderboard, and the
 * run-end summary. Live run state reuses the shared game model (Tile, Army,
 * PlayerState, etc.) inside the engine.
 */
import type { Resources } from '@tidehold/shared';

export type SoloScreen = 'loading' | 'run' | 'gameover' | 'meta' | 'daily';
export type SoloMode = 'daily' | 'endless';

/** Persistent progression, saved to localStorage. */
export interface MetaState {
  version: 1;
  salvage: number;
  /** Purchased permanent upgrade ids. */
  upgrades: string[];
  /** Unlocked + selected commander/skin ids. */
  commanders: string[];
  skins: string[];
  selectedCommander: string;
  selectedSkin: string;
  /** All-time best endless score and best tide reached. */
  bestScore: number;
  bestTide: number;
  runsPlayed: number;
  /** Interstitial pacing counter. */
  runsSinceInterstitial: number;
  /** Runs where the daily was completed, keyed by yyyymmdd. */
  dailyDone: Record<string, number>;
}

export interface DailyEntry {
  score: number;
  tide: number;
  survivedTicks: number;
  placement: number;
  at: number; // timestamp
}

/** Local daily leaderboard: your own attempts, keyed by day. */
export interface DailyStore {
  version: 1;
  days: Record<string, DailyEntry[]>;
}

/** Summary shown on the game-over screen. */
export interface RunResult {
  mode: SoloMode;
  dayKey: string | null;
  seed: number;
  score: number;
  tideReached: number;
  survivedTicks: number;
  placement: number; // 1..fieldSize
  fieldSize: number;
  relicsBanked: number;
  battlesWon: number;
  ruinsCleared: number;
  expeditions: number;
  salvageEarned: number;
  outcome: 'drowned' | 'breached' | 'outlasted';
  /** True once the rewarded "double salvage" has been claimed. */
  doubled: boolean;
}

/** Live run stats surfaced to the HUD (derived each tick). */
export interface RunStats {
  tick: number;
  tideLevel: number;
  nextTideInTicks: number;
  phase: string;
  score: number;
  placement: number;
  fieldSize: number;
  ownedTiles: number;
  aliveArks: number;
  /** True when the next rise is imminent — drives the "hold the tide" prompt. */
  tideImminent: boolean;
}

export type OutcomeReason = 'drowned' | 'breached' | 'outlasted';

/** Simple resource bag helper type. */
export type ResourceBag = Partial<Resources>;
