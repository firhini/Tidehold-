/**
 * REST API. Thin, boring, and strict: parse → authenticate → delegate to
 * actions.ts → serialize. All game rules live in actions/tick, not here.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  EVENT_LOG_LIMIT,
  PASSWORD_MIN,
  USERNAME_MAX,
  USERNAME_MIN,
  type PlayerState,
} from '@tidehold/shared';
import type { Db } from './db.js';
import {
  createSession,
  destroySession,
  hashPassword,
  makeRateLimiter,
  sessionPlayerId,
  verifyPassword,
} from './auth.js';
import * as actions from './actions.js';
import { ActionError } from './actions.js';
import { addEvent, createPlayer, worldSnapshot, type GameState } from './state.js';
import type { WsHub } from './ws.js';

const USERNAME_RE = /^[a-zA-Z0-9_\- ]+$/;

export function registerApi(app: FastifyInstance, db: Db, state: GameState, hub: () => WsHub | null): void {
  const authLimiter = makeRateLimiter(10, 60_000);
  const chatLimiter = makeRateLimiter(8, 10_000);
  const actionLimiter = makeRateLimiter(60, 10_000);

  const bearer = (req: FastifyRequest): string | undefined => {
    const h = req.headers.authorization;
    if (h?.startsWith('Bearer ')) return h.slice(7);
    return undefined;
  };

  const requirePlayer = (req: FastifyRequest, reply: FastifyReply): PlayerState | null => {
    const playerId = sessionPlayerId(db, bearer(req));
    const player = playerId ? state.players.get(playerId) : undefined;
    if (!player) {
      reply.code(401).send({ error: 'Sign in to command your Ark.' });
      return null;
    }
    if (!actionLimiter(player.id)) {
      reply.code(429).send({ error: 'Ease off — the world moves at the speed of the tide.' });
      return null;
    }
    player.lastSeenTick = state.meta.tick;
    return player;
  };

  const run = <T>(reply: FastifyReply, fn: () => T): void => {
    try {
      reply.send({ ok: true, data: fn() });
    } catch (err) {
      if (err instanceof ActionError) {
        reply.code(400).send({ error: err.message });
      } else {
        reply.log.error(err);
        reply.code(500).send({ error: 'The world shuddered. Try again.' });
      }
    }
  };

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  app.post('/api/auth/register', (req, reply) => {
    if (!authLimiter(req.ip)) return reply.code(429).send({ error: 'Too many attempts. Wait a minute.' });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (username.length < USERNAME_MIN || username.length > USERNAME_MAX || !USERNAME_RE.test(username)) {
      return reply.code(400).send({
        error: `Names are ${USERNAME_MIN}-${USERNAME_MAX} characters: letters, numbers, spaces, - or _.`,
      });
    }
    if (password.length < PASSWORD_MIN || password.length > 200) {
      return reply.code(400).send({ error: `Passwords need at least ${PASSWORD_MIN} characters.` });
    }
    const existing = db.prepare('SELECT id FROM players WHERE username = ?').get(username);
    if (existing) return reply.code(409).send({ error: 'That name is already carved into The Ledger.' });

    const player = createPlayer(db, state, username, hashPassword(password));
    if (!player) return reply.code(503).send({ error: 'The world is full. A new season must begin.' });
    const token = createSession(db, player.id);
    addEvent(db, state, {
      type: 'player',
      message: `${username}'s Ark appeared on the horizon. The drowning world takes note.`,
      actorId: player.id,
    });
    reply.send({ ok: true, data: { token, playerId: player.id } });
  });

  app.post('/api/auth/login', (req, reply) => {
    if (!authLimiter(req.ip)) return reply.code(429).send({ error: 'Too many attempts. Wait a minute.' });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const row = db.prepare('SELECT id, passhash FROM players WHERE username = ?').get(username) as
      | { id: string; passhash: string }
      | undefined;
    if (!row || !verifyPassword(password, row.passhash)) {
      return reply.code(401).send({ error: 'Wrong name or password.' });
    }
    const token = createSession(db, row.id);
    reply.send({ ok: true, data: { token, playerId: row.id } });
  });

  app.post('/api/auth/logout', (req, reply) => {
    const token = bearer(req);
    if (token) destroySession(db, token);
    reply.send({ ok: true, data: {} });
  });

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  app.get('/api/world', (req, reply) => {
    const playerId = sessionPlayerId(db, bearer(req));
    reply.send({ ok: true, data: worldSnapshot(state, playerId) });
  });

  app.get('/api/me', (req, reply) => {
    const player = requirePlayer(req, reply);
    if (!player) return;
    const myExpeditions = [...state.expeditions.values()].filter((e) => e.ownerId === player.id);
    const myContracts = [...state.contracts.values()].filter(
      (c) => c.fromId === player.id || c.toId === player.id,
    );
    const reports = (
      db
        .prepare('SELECT v FROM battle_reports ORDER BY tick DESC LIMIT 30')
        .all() as { v: string }[]
    )
      .map((r) => JSON.parse(r.v))
      .filter((r) => r.attacker.playerId === player.id || r.defender.playerId === player.id)
      .slice(0, 12);
    reply.send({
      ok: true,
      data: { player, expeditions: myExpeditions, contracts: myContracts, battleReports: reports },
    });
  });

  app.get('/api/events', (req, reply) => {
    const playerId = sessionPlayerId(db, bearer(req));
    const q = req.query as Record<string, string | undefined>;
    const since = Number.parseInt(q.since ?? '0', 10) || 0;
    const rows = db
      .prepare(
        `SELECT id, tick, type, message, actor_id, target_id, q, r, is_public
         FROM events WHERE id > ? AND (is_public = 1 OR actor_id = ? OR target_id = ?)
         ORDER BY id DESC LIMIT ?`,
      )
      .all(since, playerId ?? '', playerId ?? '', EVENT_LOG_LIMIT) as Record<string, unknown>[];
    reply.send({
      ok: true,
      data: rows.reverse().map((r) => ({
        id: r.id,
        tick: r.tick,
        type: r.type,
        message: r.message,
        actorId: r.actor_id ?? undefined,
        targetId: r.target_id ?? undefined,
        q: r.q ?? undefined,
        r: r.r ?? undefined,
        isPublic: r.is_public === 1,
      })),
    });
  });

  app.get('/api/rankings', (_req, reply) => {
    const players = [...state.players.values()]
      .filter((p) => !p.defeated)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map((p) => ({
        id: p.id,
        username: p.username,
        score: Math.round(p.score),
        reputation: Math.round(p.reputation),
        techs: p.techs.length,
      }));
    reply.send({ ok: true, data: players });
  });

  app.get('/api/chat', (_req, reply) => {
    const rows = db
      .prepare('SELECT tick, username, message FROM chat ORDER BY id DESC LIMIT 50')
      .all() as { tick: number; username: string; message: string }[];
    reply.send({ ok: true, data: rows.reverse() });
  });

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  type Body = Record<string, unknown>;
  const act =
    (fn: (player: PlayerState, body: Body) => unknown) => (req: FastifyRequest, reply: FastifyReply) => {
      const player = requirePlayer(req, reply);
      if (!player) return;
      run(reply, () => fn(player, (req.body ?? {}) as Body));
    };

  app.post('/api/tile/claim', act((p, b) => actions.claimTile(db, state, p, b.q, b.r)));
  app.post('/api/tile/build', act((p, b) => actions.build(db, state, p, b.q, b.r, b.type)));
  app.post('/api/tile/upgrade', act((p, b) => actions.upgradeBuilding(db, state, p, b.q, b.r)));
  app.post('/api/ark/move', act((p, b) => actions.moveArk(db, state, p, b.q, b.r)));
  app.post('/api/ark/upgrade', act((p) => actions.upgradeArk(db, state, p)));
  app.post('/api/army/recruit', act((p, b) => actions.recruit(db, state, p, b.units)));
  app.post('/api/army/move', act((p, b) => actions.moveArmy(db, state, p, b.armyId, b.q, b.r)));
  app.post('/api/army/attack', act((p, b) => actions.attack(db, state, p, b.armyId, b.q, b.r)));
  app.post('/api/army/commander', act((p, b) => actions.assignCommander(db, state, p, b.armyId, b.commanderId)));
  app.post('/api/army/disband', act((p, b) => actions.disbandArmy(db, state, p, b.armyId)));
  app.post('/api/expedition', act((p, b) => actions.launchExpedition(db, state, p, b.q, b.r)));
  app.post('/api/market/trade', act((p, b) => actions.trade(db, state, p, b.resource, b.amount, b.side)));
  app.post('/api/shrine/offer', act((p, b) => actions.offerRelics(db, state, p, b.q, b.r, b.amount)));
  app.post('/api/ledger/propose', act((p, b) => actions.proposeContract(db, state, p, b.toId, b.type, b.terms, b.durationTicks)));
  app.post('/api/ledger/respond', act((p, b) => actions.respondContract(db, state, p, b.contractId, b.accept)));
  app.post('/api/ledger/cancel', act((p, b) => actions.cancelContract(db, state, p, b.contractId)));

  app.post('/api/chat', (req, reply) => {
    const player = requirePlayer(req, reply);
    if (!player) return;
    if (!chatLimiter(player.id)) return reply.code(429).send({ error: 'The tavern asks for a breath between toasts.' });
    const body = (req.body ?? {}) as Body;
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (message.length < 1 || message.length > 240) {
      return reply.code(400).send({ error: 'Messages are 1-240 characters.' });
    }
    db.prepare('INSERT INTO chat (tick, player_id, username, message) VALUES (?, ?, ?, ?)').run(
      state.meta.tick,
      player.id,
      player.username,
      message,
    );
    hub()?.pushChat({ username: player.username, message, tick: state.meta.tick });
    reply.send({ ok: true, data: {} });
  });
}
