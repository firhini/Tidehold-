/**
 * Typed API client. Every call returns the `data` payload or throws
 * ApiError with the server's player-readable message.
 */
import type {
  Army,
  Battle,
  BattleReport,
  Contract,
  ContractTerms,
  ContractType,
  Expedition,
  GameEvent,
  PlayerState,
  ResourceType,
  Tile,
  UnitCounts,
  WorldSnapshot,
} from '@tidehold/shared';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

let token: string | null = localStorage.getItem('tidehold_token');

export function getToken(): string | null {
  return token;
}

export function setToken(t: string | null): void {
  token = t;
  if (t) localStorage.setItem('tidehold_token', t);
  else localStorage.removeItem('tidehold_token');
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...init, headers });
  let body: { ok?: boolean; data?: T; error?: string };
  try {
    body = await res.json();
  } catch {
    throw new ApiError('The sea swallowed the reply. Check your connection.', res.status);
  }
  if (!res.ok || !body.ok) throw new ApiError(body.error ?? 'Something went wrong.', res.status);
  return body.data as T;
}

const get = <T>(path: string) => call<T>(path);
const post = <T>(path: string, body?: unknown) =>
  call<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });

export interface MeResponse {
  player: PlayerState;
  expeditions: Expedition[];
  contracts: Contract[];
  battleReports: BattleReport[];
}

export interface RankingEntry {
  id: string;
  username: string;
  score: number;
  reputation: number;
  techs: number;
}

export interface ChatMessage {
  tick: number;
  username: string;
  message: string;
}

export const api = {
  register: (username: string, password: string) =>
    post<{ token: string; playerId: string }>('/api/auth/register', { username, password }),
  login: (username: string, password: string) =>
    post<{ token: string; playerId: string }>('/api/auth/login', { username, password }),
  logout: () => post<Record<string, never>>('/api/auth/logout'),

  world: () => get<WorldSnapshot>('/api/world'),
  me: () => get<MeResponse>('/api/me'),
  events: (since = 0) => get<GameEvent[]>(`/api/events?since=${since}`),
  rankings: () => get<RankingEntry[]>('/api/rankings'),
  chatHistory: () => get<ChatMessage[]>('/api/chat'),

  claimTile: (q: number, r: number) => post<Tile>('/api/tile/claim', { q, r }),
  build: (q: number, r: number, type: string) => post<Tile>('/api/tile/build', { q, r, type }),
  upgradeBuilding: (q: number, r: number) => post<Tile>('/api/tile/upgrade', { q, r }),
  moveArk: (q: number, r: number) => post<PlayerState>('/api/ark/move', { q, r }),
  upgradeArk: () => post<PlayerState>('/api/ark/upgrade'),
  recruit: (units: Partial<UnitCounts>) => post<Army>('/api/army/recruit', { units }),
  moveArmy: (armyId: string, q: number, r: number) => post<Army>('/api/army/move', { armyId, q, r }),
  attack: (armyId: string, q: number, r: number) => post<Battle>('/api/army/attack', { armyId, q, r }),
  assignCommander: (armyId: string, commanderId: string | null) =>
    post<Army>('/api/army/commander', { armyId, commanderId }),
  disbandArmy: (armyId: string) => post<void>('/api/army/disband', { armyId }),
  expedition: (q: number, r: number) => post<Expedition>('/api/expedition', { q, r }),
  trade: (resource: ResourceType, amount: number, side: 'buy' | 'sell') =>
    post<{ shells: number }>('/api/market/trade', { resource, amount, side }),
  offerRelics: (q: number, r: number, amount: number) =>
    post<{ score: number }>('/api/shrine/offer', { q, r, amount }),
  proposeContract: (toId: string, type: ContractType, terms: Partial<ContractTerms>, durationTicks: number) =>
    post<Contract>('/api/ledger/propose', { toId, type, terms, durationTicks }),
  respondContract: (contractId: string, accept: boolean) =>
    post<Contract>('/api/ledger/respond', { contractId, accept }),
  cancelContract: (contractId: string) => post<Contract>('/api/ledger/cancel', { contractId }),
  sendChat: (message: string) => post<Record<string, never>>('/api/chat', { message }),
};
