import { fileURLToPath } from 'node:url';
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

/**
 * Resolve a path relative to this file. Uses fileURLToPath (not URL.pathname)
 * so Windows file URLs like file:///C:/… become C:\… instead of /C:/…, which
 * would otherwise produce a broken doubled drive letter (C:\C:\…).
 */
function fromHere(relative: string): string {
  return fileURLToPath(new URL(relative, import.meta.url));
}

export const config = {
  port: envInt('PORT', 8080),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath: process.env.DB_PATH ?? fromHere('../../data/tidehold.db'),
  /** Real seconds per game tick. Lower = faster world (demo mode). */
  tickSeconds: envInt('TICK_SECONDS', DEFAULT_TICK_SECONDS),
  /** Ticks between tide rises. */
  tideIntervalTicks: envInt('TIDE_INTERVAL_TICKS', DEFAULT_TIDE_INTERVAL_TICKS),
  worldRadius: envInt('WORLD_RADIUS', DEFAULT_WORLD_RADIUS),
  worldSeed: envInt('WORLD_SEED', DEFAULT_WORLD_SEED),
  /** Serve the built client from client/dist when present. */
  clientDist: process.env.CLIENT_DIST ?? fromHere('../../client/dist'),
  isProd: process.env.NODE_ENV === 'production',
};
