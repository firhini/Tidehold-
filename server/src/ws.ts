/**
 * WebSocket hub. Clients connect at /ws?token=<session token> and receive:
 * - { type: 'tick', meta, market, armies, battles, dirtyTiles } each tick
 *   (armies personalized per viewer's scouting)
 * - { type: 'event', event } for public events and their own private ones
 * - { type: 'battle_report', report } when a battle involving them resolves
 * - { type: 'chat', ... } for global chat
 */
import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { BattleReport, GameEvent, Tile } from '@tidehold/shared';
import type { Db } from './db.js';
import { sessionPlayerId } from './auth.js';
import { onEvent, visibleArmies, type GameState } from './state.js';

interface Client {
  ws: WebSocket;
  playerId: string;
}

export class WsHub {
  private clients = new Set<Client>();

  constructor(server: Server, db: Db, private state: GameState) {
    const wss = new WebSocketServer({ server, path: '/ws' });
    wss.on('connection', (ws, req) => {
      const url = new URL(req.url ?? '/ws', 'http://localhost');
      const token = url.searchParams.get('token') ?? undefined;
      const playerId = sessionPlayerId(db, token);
      if (!playerId) {
        ws.close(4001, 'unauthorized');
        return;
      }
      const client: Client = { ws, playerId };
      this.clients.add(client);
      ws.on('close', () => this.clients.delete(client));
      ws.on('error', () => this.clients.delete(client));
    });

    onEvent((ev) => this.pushEvent(ev));
  }

  private send(client: Client, payload: unknown): void {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(payload));
    }
  }

  pushEvent(ev: GameEvent): void {
    for (const c of this.clients) {
      if (ev.isPublic || ev.actorId === c.playerId || ev.targetId === c.playerId) {
        this.send(c, { type: 'event', event: ev });
      }
    }
  }

  pushTick(dirtyTiles: Tile[]): void {
    for (const c of this.clients) {
      this.send(c, {
        type: 'tick',
        meta: this.state.meta,
        market: this.state.market,
        armies: visibleArmies(this.state, c.playerId),
        battles: [...this.state.battles.values()],
        dirtyTiles,
      });
    }
  }

  pushBattleReports(reports: BattleReport[]): void {
    for (const report of reports) {
      for (const c of this.clients) {
        if (report.attacker.playerId === c.playerId || report.defender.playerId === c.playerId) {
          this.send(c, { type: 'battle_report', report });
        }
      }
    }
  }

  pushChat(msg: { username: string; message: string; tick: number }): void {
    for (const c of this.clients) this.send(c, { type: 'chat', ...msg });
  }

  onlineCount(): number {
    return this.clients.size;
  }
}
