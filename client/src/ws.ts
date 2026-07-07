/**
 * Live connection. Reconnects with backoff; merges pushes into the store.
 */
import { getToken } from './api.js';
import { useStore } from './store.js';

let socket: WebSocket | null = null;
let reconnectDelay = 1000;
let closedByUser = false;

export function connectWs(): void {
  const token = getToken();
  if (!token || socket) return;
  closedByUser = false;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);

  socket.onopen = () => {
    reconnectDelay = 1000;
  };

  socket.onmessage = (raw) => {
    let msg: { type: string } & Record<string, unknown>;
    try {
      msg = JSON.parse(raw.data as string);
    } catch {
      return;
    }
    const store = useStore.getState();
    switch (msg.type) {
      case 'tick':
        store.applyTick(msg as never);
        break;
      case 'event':
        store.applyEvent((msg as never as { event: never }).event);
        break;
      case 'battle_report':
        store.applyBattleReport((msg as never as { report: never }).report);
        break;
      case 'chat':
        store.applyChat(msg as never);
        break;
    }
  };

  const scheduleReconnect = () => {
    socket = null;
    if (closedByUser) return;
    setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, 15000);
      connectWs();
    }, reconnectDelay);
  };
  socket.onclose = scheduleReconnect;
  socket.onerror = () => socket?.close();
}

export function disconnectWs(): void {
  closedByUser = true;
  socket?.close();
  socket = null;
}
