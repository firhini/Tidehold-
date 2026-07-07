/**
 * Global client state (zustand). One store, three concerns:
 * - session (token/player identity)
 * - world data (snapshot + live tick merges)
 * - UI state (selection, open panel, toasts)
 */
import { create } from 'zustand';
import {
  hexKey,
  type Army,
  type Battle,
  type BattleReport,
  type Contract,
  type Expedition,
  type GameEvent,
  type MarketState,
  type PlayerState,
  type PublicPlayerInfo,
  type Tile,
  type WorldMeta,
} from '@tidehold/shared';
import { api, getToken, setToken, type ChatMessage, type MeResponse, type RankingEntry } from './api.js';
import { connectWs, disconnectWs } from './ws.js';

export type PanelId =
  | 'none'
  | 'tile'
  | 'ark'
  | 'armies'
  | 'ledger'
  | 'market'
  | 'rankings'
  | 'chronicle'
  | 'help';

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  message: string;
}

/**
 * Map targeting mode: a panel arms it ("move this army"), the next map click
 * consumes it. MapCanvas is responsible for calling the API and clearing it.
 */
export interface Targeting {
  kind: 'army_move' | 'army_attack' | 'ark_move' | 'expedition';
  armyId?: string;
  hint: string;
}

interface GameStore {
  // session
  authed: boolean;
  playerId: string | null;
  booting: boolean;

  // world
  meta: WorldMeta | null;
  tiles: Tile[];
  tileMap: Map<string, Tile>;
  players: PublicPlayerInfo[];
  armies: Army[];
  battles: Battle[];
  market: MarketState | null;
  me: PlayerState | null;
  myExpeditions: Expedition[];
  myContracts: Contract[];
  battleReports: BattleReport[];
  events: GameEvent[];
  chat: ChatMessage[];
  rankings: RankingEntry[];

  // ui
  panel: PanelId;
  selected: { q: number; r: number } | null;
  selectedArmyId: string | null;
  targeting: Targeting | null;
  toasts: Toast[];
  onboardingDismissed: boolean;

  // actions
  boot(): Promise<void>;
  signIn(token: string, playerId: string): Promise<void>;
  signOut(): void;
  refreshWorld(): Promise<void>;
  refreshMe(): Promise<void>;
  refreshRankings(): Promise<void>;
  selectTile(q: number, r: number): void;
  clearSelection(): void;
  setPanel(panel: PanelId): void;
  selectArmy(id: string | null): void;
  setTargeting(t: Targeting | null): void;
  toast(kind: Toast['kind'], message: string): void;
  dismissToast(id: number): void;
  dismissOnboarding(): void;

  // ws merge handlers
  applyTick(payload: {
    meta: WorldMeta;
    market: MarketState;
    armies: Army[];
    battles: Battle[];
    dirtyTiles: Tile[];
  }): void;
  applyEvent(event: GameEvent): void;
  applyBattleReport(report: BattleReport): void;
  applyChat(msg: ChatMessage): void;
}

let toastCounter = 1;

export const useStore = create<GameStore>((set, get) => ({
  authed: false,
  playerId: null,
  booting: true,

  meta: null,
  tiles: [],
  tileMap: new Map(),
  players: [],
  armies: [],
  battles: [],
  market: null,
  me: null,
  myExpeditions: [],
  myContracts: [],
  battleReports: [],
  events: [],
  chat: [],
  rankings: [],

  panel: 'none',
  selected: null,
  selectedArmyId: null,
  targeting: null,
  toasts: [],
  onboardingDismissed: localStorage.getItem('tidehold_onboarded') === '1',

  async boot() {
    if (!getToken()) {
      set({ booting: false });
      return;
    }
    try {
      const me = await api.me();
      set({ authed: true, playerId: me.player.id });
      applyMe(set, me);
      await get().refreshWorld();
      const [events, chat] = await Promise.all([api.events(), api.chatHistory()]);
      set({ events, chat });
      connectWs();
      set({ booting: false });
    } catch {
      setToken(null);
      set({ authed: false, booting: false });
    }
  },

  async signIn(token, playerId) {
    setToken(token);
    set({ authed: true, playerId });
    const me = await api.me();
    applyMe(set, me);
    await get().refreshWorld();
    const [events, chat] = await Promise.all([api.events(), api.chatHistory()]);
    set({ events, chat });
    connectWs();
  },

  signOut() {
    void api.logout().catch(() => undefined);
    setToken(null);
    disconnectWs();
    set({
      authed: false,
      playerId: null,
      me: null,
      panel: 'none',
      selected: null,
      selectedArmyId: null,
    });
  },

  async refreshWorld() {
    const snap = await api.world();
    set({
      meta: snap.meta,
      tiles: snap.tiles,
      tileMap: new Map(snap.tiles.map((t) => [hexKey(t.q, t.r), t])),
      players: snap.players,
      armies: snap.armies,
      battles: snap.battles,
      market: snap.market,
    });
  },

  async refreshMe() {
    const me = await api.me();
    applyMe(set, me);
  },

  async refreshRankings() {
    const rankings = await api.rankings();
    set({ rankings });
  },

  selectTile(q, r) {
    set({ selected: { q, r }, panel: 'tile' });
  },

  clearSelection() {
    set({ selected: null, panel: get().panel === 'tile' ? 'none' : get().panel });
  },

  setPanel(panel) {
    set({ panel });
  },

  selectArmy(id) {
    set({ selectedArmyId: id });
  },

  setTargeting(t) {
    set({ targeting: t });
  },

  toast(kind, message) {
    const id = toastCounter++;
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, kind, message }] }));
    setTimeout(() => get().dismissToast(id), 5000);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  dismissOnboarding() {
    localStorage.setItem('tidehold_onboarded', '1');
    set({ onboardingDismissed: true });
  },

  applyTick(payload) {
    const { tileMap, tiles } = get();
    if (payload.dirtyTiles.length > 0) {
      for (const t of payload.dirtyTiles) {
        const key = hexKey(t.q, t.r);
        const existing = tileMap.get(key);
        if (existing) Object.assign(existing, t, { building: t.building, ownerId: t.ownerId });
      }
      // Dirty tiles may delete fields (building/ownerId); rebuild references.
      for (const t of payload.dirtyTiles) {
        const existing = tileMap.get(hexKey(t.q, t.r));
        if (existing) {
          if (!('building' in t) || t.building === undefined) delete existing.building;
          if (!('ownerId' in t) || t.ownerId === undefined) delete existing.ownerId;
        }
      }
      set({ tiles: [...tiles] });
    }
    set({ meta: payload.meta, market: payload.market, armies: payload.armies, battles: payload.battles });
    // Resources/score change every tick; refresh own state cheaply.
    void get().refreshMe().catch(() => undefined);
  },

  applyEvent(event) {
    set((s) => ({ events: [...s.events.slice(-199), event] }));
    if (event.type === 'tide' || event.type === 'season') {
      get().toast('info', event.message);
      void get().refreshWorld().catch(() => undefined);
    }
  },

  applyBattleReport(report) {
    set((s) => ({ battleReports: [report, ...s.battleReports].slice(0, 20) }));
    const mine = report.attacker.playerId === get().playerId;
    const won =
      (report.winner === 'attacker' && mine) ||
      (report.winner === 'defender' && report.defender.playerId === get().playerId);
    get().toast(won ? 'success' : 'error', report.narrative);
    void get().refreshWorld().catch(() => undefined);
  },

  applyChat(msg) {
    set((s) => ({ chat: [...s.chat.slice(-99), msg] }));
  },
}));

function applyMe(
  set: (partial: Partial<GameStore>) => void,
  me: MeResponse,
): void {
  set({
    me: me.player,
    myExpeditions: me.expeditions,
    myContracts: me.contracts,
    battleReports: me.battleReports,
  });
}
