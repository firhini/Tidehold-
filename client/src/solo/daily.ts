/**
 * The Daily Tide — one shared world per calendar day, derived deterministically
 * so every player faces the same drowning map and can compare scores. Uses the
 * shared hash so the seed is stable and reproducible.
 */
import { hash2 } from '@tidehold/shared';

/** yyyymmdd key for a date (UTC, so the daily flips at the same instant worldwide). */
export function dayKeyFor(date: Date): string {
  const y = date.getUTCFullYear();
  const m = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const d = `${date.getUTCDate()}`.padStart(2, '0');
  return `${y}${m}${d}`;
}

export function todayKey(): string {
  return dayKeyFor(new Date());
}

/** Deterministic world seed for a given day key. */
export function seedForDayKey(dayKey: string): number {
  const n = Number.parseInt(dayKey, 10) || 0;
  return hash2(n, 0x71de, 0x7a1e) >>> 0;
}

/** A random endless seed (uses Math.random ONLY here — the map itself is still deterministic from the seed). */
export function randomSeed(): number {
  return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
}

/** Parse a ?seed= or ?day= param so shared links reproduce a world exactly. */
export function seedFromUrl(): { seed: number; dayKey: string | null } | null {
  try {
    const params = new URLSearchParams(location.search);
    const daily = params.get('day');
    if (daily && /^\d{8}$/.test(daily)) return { seed: seedForDayKey(daily), dayKey: daily };
    const seed = params.get('seed');
    if (seed) {
      const n = Number.parseInt(seed, 10);
      if (Number.isFinite(n) && n > 0) return { seed: n >>> 0, dayKey: null };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Human label for a day key, e.g. "2026-07-07". */
export function prettyDay(dayKey: string): string {
  if (!/^\d{8}$/.test(dayKey)) return dayKey;
  return `${dayKey.slice(0, 4)}-${dayKey.slice(4, 6)}-${dayKey.slice(6, 8)}`;
}

/** Build a shareable line + link for a finished run. */
export function shareText(opts: {
  mode: 'daily' | 'endless';
  dayKey: string | null;
  seed: number;
  score: number;
  tide: number;
}): string {
  const url = new URL(location.href);
  url.search = opts.dayKey ? `?day=${opts.dayKey}` : `?seed=${opts.seed}`;
  const where = opts.dayKey ? `the Daily Tide (${prettyDay(opts.dayKey)})` : `seed ${opts.seed}`;
  return (
    `🌊 TIDEHOLD — I survived to Tide ${opts.tide}/8 with ${opts.score.toLocaleString()} legacy on ${where}.\n` +
    `The sea always wins. How long can you last?\n${url.toString()}`
  );
}

/** Copy text to clipboard, resolving to whether it worked. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
