import {
  DEFAULT_TICK_SECONDS,
  DEFAULT_TIDE_INTERVAL_TICKS,
  DEFAULT_WORLD_RADIUS,
  DEFAULT_WORLD_SEED,
} from '@tidehold/shared';

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const config = {
  port: envInt('PORT', 8080),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath: process.env.DB_PATH ?? new URL('../../data/tidehold.db', import.meta.url).pathname,
  /** Real seconds per game tick. Lower = faster world (demo mode). */
  tickSeconds: envInt('TICK_SECONDS', DEFAULT_TICK_SECONDS),
  /** Ticks between tide rises. */
  tideIntervalTicks: envInt('TIDE_INTERVAL_TICKS', DEFAULT_TIDE_INTERVAL_TICKS),
  worldRadius: envInt('WORLD_RADIUS', DEFAULT_WORLD_RADIUS),
  worldSeed: envInt('WORLD_SEED', DEFAULT_WORLD_SEED),
  /** Serve the built client from client/dist when present. */
  clientDist: process.env.CLIENT_DIST ?? new URL('../../client/dist', import.meta.url).pathname,
  isProd: process.env.NODE_ENV === 'production',
};
