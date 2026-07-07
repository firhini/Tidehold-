/**
 * localStorage persistence — the only "backend" the solo game has.
 * Everything is versioned and defensively parsed so a corrupt or old save
 * never bricks the game (it resets to a fresh, valid state instead).
 */
import { COMMANDERS, LS_DAILY, LS_META, SKINS } from './config.js';
import type { DailyEntry, DailyStore, MetaState } from './types.js';

function freshMeta(): MetaState {
  return {
    version: 1,
    salvage: 0,
    upgrades: [],
    commanders: COMMANDERS.filter((c) => c.cost === 0).map((c) => c.id),
    skins: SKINS.filter((s) => s.cost === 0).map((s) => s.id),
    selectedCommander: COMMANDERS[0].id,
    selectedSkin: SKINS[0].id,
    bestScore: 0,
    bestTide: 0,
    runsPlayed: 0,
    runsSinceInterstitial: 0,
    dailyDone: {},
  };
}

export function loadMeta(): MetaState {
  try {
    const raw = localStorage.getItem(LS_META);
    if (!raw) return freshMeta();
    const parsed = JSON.parse(raw) as Partial<MetaState>;
    if (parsed.version !== 1) return freshMeta();
    // Merge onto a fresh base so new fields always exist.
    const base = freshMeta();
    return {
      ...base,
      ...parsed,
      // Guarantee default unlocks are always present.
      commanders: Array.from(new Set([...base.commanders, ...(parsed.commanders ?? [])])),
      skins: Array.from(new Set([...base.skins, ...(parsed.skins ?? [])])),
      upgrades: parsed.upgrades ?? [],
      dailyDone: parsed.dailyDone ?? {},
    };
  } catch {
    return freshMeta();
  }
}

export function saveMeta(meta: MetaState): void {
  try {
    localStorage.setItem(LS_META, JSON.stringify(meta));
  } catch {
    /* storage full or blocked — the game still plays, just doesn't persist */
  }
}

export function loadDaily(): DailyStore {
  try {
    const raw = localStorage.getItem(LS_DAILY);
    if (!raw) return { version: 1, days: {} };
    const parsed = JSON.parse(raw) as Partial<DailyStore>;
    if (parsed.version !== 1 || typeof parsed.days !== 'object') return { version: 1, days: {} };
    return { version: 1, days: parsed.days ?? {} };
  } catch {
    return { version: 1, days: {} };
  }
}

export function saveDaily(store: DailyStore): void {
  try {
    localStorage.setItem(LS_DAILY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}

/** Record a daily attempt and return the updated store (best-first, capped). */
export function recordDaily(store: DailyStore, dayKey: string, entry: DailyEntry): DailyStore {
  const days = { ...store.days };
  const list = [...(days[dayKey] ?? []), entry].sort((a, b) => b.score - a.score).slice(0, 20);
  days[dayKey] = list;
  return { version: 1, days };
}
