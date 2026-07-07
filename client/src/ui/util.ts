/**
 * Shared UI helpers: number/time formatting, resource metadata,
 * terrain palette (also used by the canvas renderer), action wrapper.
 */
import type { ResourceType, TerrainType, WorldMeta } from '@tidehold/shared';
import { useStore } from '../store.js';

export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.floor(n)}`;
}

export function fmtShells(n: number): string {
  return n.toFixed(0);
}

/** Human duration for a tick count, using server tick seconds. */
export function fmtTicks(ticks: number, meta: WorldMeta | null): string {
  if (!Number.isFinite(ticks)) return 'beyond the season';
  if (ticks <= 0) return 'now';
  const secs = ticks * (meta?.tickSeconds ?? 20);
  if (secs < 90) return `${Math.round(secs)}s`;
  if (secs < 5400) return `${Math.round(secs / 60)}m`;
  if (secs < 172800) return `${(secs / 3600).toFixed(1)}h`;
  return `${(secs / 86400).toFixed(1)}d`;
}

export const RESOURCE_META: Record<ResourceType, { label: string; icon: string; color: string }> = {
  timber: { label: 'Timber', icon: '🪵', color: '#c98f4e' },
  ore: { label: 'Ore', icon: '⛏️', color: '#9fb4c7' },
  food: { label: 'Food', icon: '🌾', color: '#a9c25d' },
  relics: { label: 'Relics', icon: '🏺', color: '#e0b64f' },
};

export const TERRAIN_META: Record<TerrainType, { label: string; color: string; edge: string }> = {
  ocean: { label: 'Open Sea', color: '#0b2e4f', edge: '#0a2843' },
  drowned: { label: 'Drowned Ruins', color: '#164a66', edge: '#123e56' },
  coast: { label: 'Coast', color: '#c9b98a', edge: '#b3a276' },
  plains: { label: 'Plains', color: '#7d9c52', edge: '#6c8a45' },
  forest: { label: 'Forest', color: '#3f6d3f', edge: '#345d34' },
  hills: { label: 'Hills', color: '#8b7f5c', edge: '#79704f' },
  mountains: { label: 'Mountains', color: '#7a7268', edge: '#6a635a' },
  peak: { label: 'Peak', color: '#cfd4d9', edge: '#b9bfc6' },
  ruins: { label: 'Ancient Ruins', color: '#6e5a7a', edge: '#5d4c68' },
};

export const BUILDING_ICONS: Record<string, string> = {
  lumber_camp: '🪓',
  mine: '⛏️',
  farm: '🌾',
  port: '⚓',
  watchtower: '🗼',
  shrine: '🔱',
};

export const UNIT_META = {
  shields: { label: 'Shieldbearers', icon: '🛡️', blurb: 'Anvil of the line. Strong vs Bladesworn.' },
  blades: { label: 'Bladesworn', icon: '⚔️', blurb: 'Shock troops. Strong vs Tidebows.' },
  bows: { label: 'Tidebows', icon: '🏹', blurb: 'Ranged volleys. Strong vs Shieldbearers.' },
} as const;

/** Stable, readable banner color for a player id (owner borders, labels). */
export function playerColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 62%, 62%)`;
}

/**
 * Run a server action: on failure toast the server's message; on success
 * optionally toast and refresh own state. Returns true when it succeeded.
 */
export async function runAction(
  fn: () => Promise<unknown>,
  successMessage?: string,
): Promise<boolean> {
  const store = useStore.getState();
  try {
    await fn();
    if (successMessage) store.toast('success', successMessage);
    await Promise.all([store.refreshMe(), store.refreshWorld()]);
    return true;
  } catch (err) {
    store.toast('error', err instanceof Error ? err.message : 'Something went wrong.');
    return false;
  }
}
