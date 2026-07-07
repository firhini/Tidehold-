/**
 * Solo store (zustand). Owns the run lifecycle, drives the tick loop, exposes
 * a render-ready view of the world, and mediates every player intent, meta
 * progression action, daily leaderboard, and ad hook. This is the single
 * contract the UI builds against.
 */
import { create } from 'zustand';
import { hexKey, type Army, type Battle, type Expedition, type PlayerState, type Tile, type WorldMeta } from '@tidehold/shared';
import {
  createRun,
  human as humanOf,
  runStats,
  salvageFor,
  tick as engineTick,
  ownedTileCount,
  ActionError,
  holdBackTide as engHoldTide,
  reviveArk as engReviveArk,
  claimTile as engClaim,
  build as engBuild,
  upgradeBuilding as engUpgradeBuilding,
  moveArk as engMoveArk,
  upgradeArk as engUpgradeArk,
  recruit as engRecruit,
  moveArmy as engMoveArmy,
  attack as engAttack,
  assignCommander as engAssignCommander,
  launchExpedition as engExpedition,
  offerRelics as engOfferRelics,
  type EngineState,
  type EngineEvent,
} from './engine.js';
import { loadMeta, saveMeta, loadDaily, saveDaily, recordDaily } from './save.js';
import { COMMANDERS, INTERSTITIAL_EVERY_N_RUNS, SKINS, SOLO_TICK_MS, UPGRADES } from './config.js';
import { dayKeyFor, prettyDay, randomSeed, seedForDayKey, seedFromUrl, shareText, todayKey, copyToClipboard } from './daily.js';
import { gameplayStart, gameplayStop, registerMockAdRunner, showInterstitial, showRewarded } from './ads.js';
import type { DailyEntry, DailyStore, MetaState, RunResult, RunStats, SoloMode, SoloScreen } from './types.js';

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  message: string;
}

export interface Targeting {
  kind: 'army_move' | 'army_attack' | 'ark_move' | 'expedition';
  armyId?: string;
  hint: string;
}

export interface MockAd {
  kind: 'rewarded' | 'interstitial';
  resolve: (ok: boolean) => void;
}

interface SoloStore {
  screen: SoloScreen;
  mode: SoloMode;
  paused: boolean;

  // --- render-ready world view (mirrors engine each tick) ---
  meta: WorldMeta | null;
  tiles: Tile[];
  tileMap: Map<string, Tile>;
  me: PlayerState | null;
  players: PlayerState[];
  armies: Army[];
  battles: Battle[];
  myExpeditions: Expedition[];
  events: EngineEvent[];
  stats: RunStats | null;
  /** The glowing tile for the cold-open "settle here" prompt. */
  startTile: { q: number; r: number } | null;

  // --- ui state ---
  selected: { q: number; r: number } | null;
  targeting: Targeting | null;
  toasts: Toast[];
  coldOpenStep: number; // 0 = claim glow, 1 = build, 2 = done
  showColdOpenHint: boolean;
  mockAd: MockAd | null;

  // --- persistent ---
  metaState: MetaState;
  daily: DailyStore;
  result: RunResult | null;

  // --- internal bookkeeping ---
  _shownEvent: number;
  _dayKey: string | null;

  // lifecycle
  boot(): void;
  startRun(mode: SoloMode, seedOverride?: number): void;
  togglePause(): void;
  quitToMenu(): void; // ends current run early → gameover summary

  // intents
  selectTile(q: number, r: number): void;
  clearSelection(): void;
  setTargeting(t: Targeting | null): void;
  claim(q: number, r: number): void;
  build(q: number, r: number, type: string): void;
  upgradeBuilding(q: number, r: number): void;
  moveArk(q: number, r: number): void;
  upgradeArk(): void;
  recruit(units: { shields: number; blades: number; bows: number }): void;
  moveArmy(armyId: string, q: number, r: number): void;
  attack(armyId: string, q: number, r: number): void;
  assignCommander(armyId: string, commanderId: string | null): void;
  expedition(q: number, r: number): void;
  offerRelics(q: number, r: number, amount: number): void;

  // rewarded hooks
  holdBackTide(): Promise<void>;
  continueAfterDefeat(): Promise<void>;
  doubleReward(): Promise<void>;

  // meta / daily
  openMeta(): void;
  openDaily(): void;
  buyUpgrade(id: string): void;
  buyCommander(id: string): void;
  buySkin(id: string): void;
  selectCommander(id: string): void;
  selectSkin(id: string): void;
  shareResult(): Promise<void>;

  toast(kind: Toast['kind'], message: string): void;
  dismissToast(id: number): void;
}

let engine: EngineState | null = null;
let loop: ReturnType<typeof setInterval> | null = null;
let toastId = 1;

export const useSolo = create<SoloStore>((set, get) => {
  // Mock-ad renderer: resolves the promise the UI's AdModal completes.
  registerMockAdRunner(
    (kind) =>
      new Promise<boolean>((resolve) => {
        set({ mockAd: { kind, resolve: (ok) => { set({ mockAd: null }); resolve(ok); } } });
      }),
  );

  const syncView = () => {
    if (!engine) return;
    const me = humanOf(engine);
    set({
      meta: { ...engine.meta },
      tiles: engine.tiles,
      tileMap: engine.tileMap,
      me: { ...me },
      players: [...engine.players.values()].map((p) => ({ ...p })),
      armies: [...engine.armies.values()].map((a) => ({ ...a })),
      battles: [...engine.battles.values()],
      myExpeditions: [...engine.expeditions.values()].filter((e) => e.ownerId === engine!.humanId),
      events: [...engine.events],
      stats: runStats(engine),
      startTile: engine.startTile,
    });
  };

  const drainToasts = () => {
    if (!engine) return;
    // Surface toast-flagged engine events not yet shown.
    const state = get();
    const shown = state._shownEvent ?? 0;
    for (const ev of engine.events) {
      if (ev.id > shown && ev.toast) get().toast(ev.toast, ev.message);
    }
    set({ _shownEvent: engine.events.length ? engine.events[engine.events.length - 1].id : shown });
  };

  const stopLoop = () => {
    if (loop) {
      clearInterval(loop);
      loop = null;
    }
  };

  const startLoop = () => {
    stopLoop();
    loop = setInterval(() => {
      const s = get();
      if (!engine || s.paused || s.screen !== 'run' || s.mockAd) return;
      engineTick(engine, s.metaState);
      syncView();
      drainToasts();
      if (engine.ended) finishRun();
    }, SOLO_TICK_MS);
  };

  const finishRun = () => {
    if (!engine) return;
    stopLoop();
    gameplayStop();
    const eng = engine;
    const me = humanOf(eng);
    const stats = runStats(eng);
    const score = Math.round(me.score);
    const salvage = salvageFor(score, eng.meta.tideLevel);
    const dayKey = get().mode === 'daily' ? get()._dayKey ?? null : null;

    const result: RunResult = {
      mode: get().mode,
      dayKey,
      seed: eng.meta.seed,
      score,
      tideReached: eng.meta.tideLevel,
      survivedTicks: eng.survivedTicks,
      placement: stats.placement,
      fieldSize: stats.fieldSize,
      relicsBanked: eng.relicsBanked,
      battlesWon: eng.battlesWon,
      ruinsCleared: eng.ruinsCleared,
      expeditions: eng.expeditionsDone,
      salvageEarned: salvage,
      outcome: eng.outcome ?? 'drowned',
      doubled: false,
    };

    // Persist meta + daily.
    const meta = { ...get().metaState };
    meta.salvage += salvage;
    meta.runsPlayed += 1;
    meta.bestScore = Math.max(meta.bestScore, score);
    meta.bestTide = Math.max(meta.bestTide, eng.meta.tideLevel);
    let daily = get().daily;
    if (dayKey) {
      const entry: DailyEntry = { score, tide: eng.meta.tideLevel, survivedTicks: eng.survivedTicks, placement: stats.placement, at: nowSafe() };
      daily = recordDaily(daily, dayKey, entry);
      meta.dailyDone[dayKey] = Math.max(meta.dailyDone[dayKey] ?? 0, score);
      saveDaily(daily);
    }
    saveMeta(meta);
    set({ metaState: meta, daily, result, screen: 'gameover' });
  };

  return {
    screen: 'loading',
    mode: 'daily',
    paused: false,
    meta: null,
    tiles: [],
    tileMap: new Map(),
    me: null,
    players: [],
    armies: [],
    battles: [],
    myExpeditions: [],
    events: [],
    stats: null,
    startTile: null,
    selected: null,
    targeting: null,
    toasts: [],
    coldOpenStep: 0,
    showColdOpenHint: true,
    mockAd: null,
    metaState: loadMeta(),
    daily: loadDaily(),
    result: null,
    // private-ish scratch (typed loosely below via casts)
    _shownEvent: 0,
    _dayKey: null,

    boot() {
      set({ metaState: loadMeta(), daily: loadDaily() });
      // A shared seed link jumps straight into that exact world.
      const fromUrl = seedFromUrl();
      if (fromUrl) {
        get().startRun(fromUrl.dayKey ? 'daily' : 'endless', fromUrl.seed);
        if (fromUrl.dayKey) set({ _dayKey: fromUrl.dayKey });
        return;
      }
      // Otherwise: start immediately in-game on today's Daily Tide.
      get().startRun('daily');
    },

    startRun(mode, seedOverride) {
      stopLoop();
      const meta = get().metaState;
      const dayKey = mode === 'daily' ? todayKey() : null;
      const seed = seedOverride ?? (mode === 'daily' ? seedForDayKey(dayKey!) : randomSeed());
      engine = createRun(seed, meta);
      gameplayStart();
      set({
        screen: 'run',
        mode,
        paused: false,
        result: null,
        selected: null,
        targeting: null,
        coldOpenStep: 0,
        showColdOpenHint: true,
        _shownEvent: 0,
        _dayKey: dayKey,
      });
      syncView();
      startLoop();
    },

    togglePause() {
      set((s) => ({ paused: !s.paused }));
    },

    quitToMenu() {
      if (engine && !engine.ended) {
        engine.ended = true;
        engine.outcome = engine.outcome ?? 'drowned';
        finishRun();
      } else {
        set({ screen: 'gameover' });
      }
    },

    // --- intents ---
    selectTile(q, r) {
      set({ selected: { q, r } });
    },
    clearSelection() {
      set({ selected: null });
    },
    setTargeting(t) {
      set({ targeting: t });
    },

    claim(q, r) { intent(() => engClaim(engine!, humanOf(engine!), q, r), 'Claimed.'); advanceColdOpen(0); },
    build(q, r, type) { intent(() => engBuild(engine!, humanOf(engine!), q, r, type)); advanceColdOpen(1); },
    upgradeBuilding(q, r) { intent(() => engUpgradeBuilding(engine!, humanOf(engine!), q, r)); },
    moveArk(q, r) { intent(() => engMoveArk(engine!, humanOf(engine!), q, r, get().metaState), 'The Ark moves.'); },
    upgradeArk() { intent(() => engUpgradeArk(engine!, humanOf(engine!)), 'The Ark is refit.'); },
    recruit(units) { intent(() => engRecruit(engine!, humanOf(engine!), units), 'Troops mustered.'); },
    moveArmy(armyId, q, r) { intent(() => engMoveArmy(engine!, humanOf(engine!), armyId, q, r), 'The column marches.'); },
    attack(armyId, q, r) { intent(() => engAttack(engine!, humanOf(engine!), armyId, q, r)); },
    assignCommander(armyId, commanderId) { intent(() => engAssignCommander(engine!, humanOf(engine!), armyId, commanderId)); },
    expedition(q, r) { intent(() => engExpedition(engine!, humanOf(engine!), q, r), 'The expedition sets out.'); },
    offerRelics(q, r, amount) { intent(() => engOfferRelics(engine!, humanOf(engine!), q, r, amount)); },

    // --- rewarded hooks ---
    async holdBackTide() {
      const ok = await showRewarded();
      if (ok && engine) {
        engHoldTide(engine);
        syncView();
        drainToasts();
      } else {
        get().toast('info', 'The tide did not wait.');
      }
    },
    async continueAfterDefeat() {
      const ok = await showRewarded();
      if (ok && engine) {
        engReviveArk(engine);
        set({ screen: 'run', result: null });
        syncView();
        drainToasts();
        startLoop();
      } else {
        get().toast('info', 'No reprieve this time.');
      }
    },
    async doubleReward() {
      const res = get().result;
      if (!res || res.doubled) return;
      const ok = await showRewarded();
      if (!ok) return;
      const meta = { ...get().metaState };
      meta.salvage += res.salvageEarned; // grant the same amount again
      saveMeta(meta);
      set({ metaState: meta, result: { ...res, salvageEarned: res.salvageEarned * 2, doubled: true } });
      get().toast('success', 'Salvage doubled.');
    },

    // --- meta / daily ---
    openMeta() { set({ screen: 'meta' }); },
    openDaily() { set({ screen: 'daily' }); },

    buyUpgrade(id) {
      const spec = UPGRADES.find((u) => u.id === id);
      const meta = { ...get().metaState };
      if (!spec || meta.upgrades.includes(id) || meta.salvage < spec.cost) return;
      meta.salvage -= spec.cost;
      meta.upgrades = [...meta.upgrades, id];
      saveMeta(meta);
      set({ metaState: meta });
      get().toast('success', `${spec.name} unlocked.`);
    },
    buyCommander(id) {
      const spec = COMMANDERS.find((c) => c.id === id);
      const meta = { ...get().metaState };
      if (!spec || meta.commanders.includes(id) || meta.salvage < spec.cost) return;
      meta.salvage -= spec.cost;
      meta.commanders = [...meta.commanders, id];
      saveMeta(meta);
      set({ metaState: meta });
      get().toast('success', `${spec.name} joins your cause.`);
    },
    buySkin(id) {
      const spec = SKINS.find((s) => s.id === id);
      const meta = { ...get().metaState };
      if (!spec || meta.skins.includes(id) || meta.salvage < spec.cost) return;
      meta.salvage -= spec.cost;
      meta.skins = [...meta.skins, id];
      saveMeta(meta);
      set({ metaState: meta });
      get().toast('success', `${spec.name} acquired.`);
    },
    selectCommander(id) {
      const meta = { ...get().metaState };
      if (!meta.commanders.includes(id)) return;
      meta.selectedCommander = id;
      saveMeta(meta);
      set({ metaState: meta });
    },
    selectSkin(id) {
      const meta = { ...get().metaState };
      if (!meta.skins.includes(id)) return;
      meta.selectedSkin = id;
      saveMeta(meta);
      set({ metaState: meta });
    },

    async shareResult() {
      const res = get().result;
      if (!res) return;
      const text = shareText({ mode: res.mode, dayKey: res.dayKey, seed: res.seed, score: res.score, tide: res.tideReached });
      const ok = await copyToClipboard(text);
      get().toast(ok ? 'success' : 'info', ok ? 'Copied — go challenge someone.' : 'Copy failed; select and copy manually.');
    },

    toast(kind, message) {
      const id = toastId++;
      set((s) => ({ toasts: [...s.toasts.slice(-4), { id, kind, message }] }));
      setTimeout(() => get().dismissToast(id), 4600);
    },
    dismissToast(id) {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },
  };

  // --- helpers closed over set/get/engine ---
  function intent(fn: () => void, success?: string) {
    if (!engine || engine.ended) return;
    try {
      fn();
      if (success) get().toast('success', success);
      syncView();
      drainToasts();
    } catch (err) {
      get().toast('error', err instanceof ActionError ? err.message : 'That cannot be done.');
    }
  }

  function advanceColdOpen(afterStep: number) {
    const s = get();
    if (s.coldOpenStep === afterStep) {
      set({ coldOpenStep: afterStep + 1, showColdOpenHint: afterStep + 1 < 2 });
    }
  }
});

/** new Date() is unavailable in some tooling contexts; guard it. */
function nowSafe(): number {
  try {
    return Date.now();
  } catch {
    return 0;
  }
}

/** Interstitial-paced new run from the game-over screen. */
export async function startNextRun(mode: SoloMode): Promise<void> {
  const store = useSolo.getState();
  const meta = { ...store.metaState };
  meta.runsSinceInterstitial += 1;
  if (meta.runsSinceInterstitial >= INTERSTITIAL_EVERY_N_RUNS) {
    meta.runsSinceInterstitial = 0;
    saveMeta(meta);
    useSolo.setState({ metaState: meta });
    await showInterstitial();
  } else {
    saveMeta(meta);
    useSolo.setState({ metaState: meta });
  }
  useSolo.getState().startRun(mode);
}

export { prettyDay, dayKeyFor, ownedTileCount };
