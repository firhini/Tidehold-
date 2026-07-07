/**
 * TIDEHOLD server — boot, tick scheduling, graceful shutdown.
 */
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import { config } from './config.js';
import { openDb } from './db.js';
import { loadOrCreateState, persistAll } from './state.js';
import { registerApi } from './api.js';
import { runTick } from './tick.js';
import { WsHub } from './ws.js';

async function main() {
  const db = openDb(config.dbPath);
  const state = loadOrCreateState(db);

  const app = Fastify({ logger: { level: config.isProd ? 'warn' : 'info' } });

  let hub: WsHub | null = null;
  registerApi(app, db, state, () => hub);

  // Serve the built client when it exists (production single-service deploy).
  if (fs.existsSync(config.clientDist)) {
    await app.register(fastifyStatic, { root: config.clientDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith('/api') || req.raw.url?.startsWith('/ws')) {
        reply.code(404).send({ error: 'No such shore.' });
      } else {
        reply.sendFile('index.html');
      }
    });
  }

  await app.listen({ port: config.port, host: config.host });
  hub = new WsHub(app.server, db, state);

  const tickMs = config.tickSeconds * 1000;
  const timer = setInterval(() => {
    try {
      const result = runTick(db, state);
      hub?.pushTick(result.dirtyTiles);
      hub?.pushBattleReports(result.battleReports);
    } catch (err) {
      app.log.error({ err }, 'tick failed');
    }
  }, tickMs);

  const shutdown = () => {
    clearInterval(timer);
    try {
      persistAll(db, state);
      db.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(
    `TIDEHOLD is live on :${config.port} — tick every ${config.tickSeconds}s, tide every ${config.tideIntervalTicks} ticks, world radius ${config.worldRadius} (season ${state.meta.season}, tick ${state.meta.tick}, tide ${state.meta.tideLevel})`,
  );
}

main().catch((err) => {
  console.error('Failed to raise the world:', err);
  process.exit(1);
});
