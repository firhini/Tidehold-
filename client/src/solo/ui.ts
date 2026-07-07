/**
 * Pure UI helpers for solo screens — formatting + metadata, no store coupling.
 */
import type { ResourceType } from '@tidehold/shared';
import { SOLO_TICK_MS } from './config.js';

export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.floor(n)}`;
}

/** A tick-count as a human duration, using the solo tick rate. */
export function fmtTicks(ticks: number): string {
  if (!Number.isFinite(ticks)) return '—';
  if (ticks <= 0) return 'now';
  const secs = ticks * (SOLO_TICK_MS / 1000);
  if (secs < 60) return `${Math.round(secs)}s`;
  return `${(secs / 60).toFixed(1)}m`;
}

export const RESOURCE_META: Record<ResourceType, { label: string; icon: string }> = {
  timber: { label: 'Timber', icon: '🪵' },
  ore: { label: 'Ore', icon: '⛏️' },
  food: { label: 'Food', icon: '🌾' },
  relics: { label: 'Relics', icon: '🏺' },
};

export const BUILDING_ICON: Record<string, string> = {
  lumber_camp: '🪓', mine: '⛏️', farm: '🌾', port: '⚓', watchtower: '🗼', shrine: '🔱',
};

export const UNIT_META = {
  shields: { label: 'Shieldbearers', icon: '🛡️', blurb: 'Anvil of the line. Beats Bladesworn.' },
  blades: { label: 'Bladesworn', icon: '⚔️', blurb: 'Shock troops. Beats Tidebows.' },
  bows: { label: 'Tidebows', icon: '🏹', blurb: 'Volleys. Beats Shieldbearers.' },
} as const;

export const PHASE_LABEL: Record<string, { text: string; cls: string }> = {
  expansion: { text: 'EXPANSION', cls: 'phase-expansion' },
  conflict: { text: 'CONFLICT', cls: 'phase-conflict' },
  endgame: { text: 'ENDGAME', cls: 'phase-endgame' },
  ended: { text: 'THE END', cls: 'phase-endgame' },
};

export function resourceCost(cost: Partial<Record<string, number>>): string {
  const icons: Record<string, string> = { timber: '🪵', ore: '⛏️', food: '🌾', relics: '🏺' };
  const parts = Object.entries(cost).filter(([, v]) => (v ?? 0) > 0).map(([k, v]) => `${icons[k] ?? k} ${v}`);
  return parts.length ? parts.join(' · ') : 'free';
}

/** Fullscreen toggle helper. */
export async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    /* not permitted — ignore */
  }
}
