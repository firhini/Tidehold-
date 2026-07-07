/**
 * The Chronicle — the world's public record — and the tavern (global chat).
 */
import React, { useEffect, useRef, useState } from 'react';
import type { GameEventType } from '@tidehold/shared';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { playerColor } from '../ui/util.js';
import { Panel } from './Panel.js';

const EVENT_ICONS: Record<GameEventType, string> = {
  tide: '🌊',
  battle: '⚔️',
  build: '🏗',
  expedition: '🧭',
  contract: '📜',
  market: '⚖️',
  ark: '⛵',
  season: '⏳',
  player: '👤',
};

function nameHue(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 60%, 68%)`;
}

export function ChroniclePanel() {
  const [tab, setTab] = useState<'chronicle' | 'chat'>('chronicle');
  const events = useStore((s) => s.events);
  const chat = useStore((s) => s.chat);
  const toast = useStore((s) => s.toast);
  const [message, setMessage] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [events, chat, tab]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = message.trim();
    if (!text) return;
    setMessage('');
    try {
      await api.sendChat(text);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'The tavern did not hear you.');
    }
  };

  return (
    <Panel title="📯 Chronicle">
      <div className="landing-auth-tabs" style={{ margin: 0, flexShrink: 0 }}>
        <button className={tab === 'chronicle' ? 'active' : ''} onClick={() => setTab('chronicle')}>
          Chronicle
        </button>
        <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>
          The Tavern
        </button>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, minHeight: 120 }}
      >
        {tab === 'chronicle' ? (
          events.length === 0 ? (
            <p className="faint">History has not happened yet. Give it time — and armies.</p>
          ) : (
            events.map((ev) => (
              <div
                key={ev.id}
                className={ev.type === 'tide' || ev.type === 'season' ? 'gold' : 'muted'}
                style={{ fontSize: 13, lineHeight: 1.45 }}
              >
                <span className="faint" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  t{ev.tick}
                </span>{' '}
                {EVENT_ICONS[ev.type] ?? '•'} {ev.message}
              </div>
            ))
          )
        ) : chat.length === 0 ? (
          <p className="faint">The tavern is quiet. Someone should buy a round.</p>
        ) : (
          chat.map((m, i) => (
            <div key={i} style={{ fontSize: 13, lineHeight: 1.45 }}>
              <b style={{ color: nameHue(m.username) }}>{m.username}</b>{' '}
              <span className="muted">{m.message}</span>
            </div>
          ))
        )}
      </div>

      {tab === 'chat' && (
        <form onSubmit={send} className="row" style={{ flexShrink: 0 }}>
          <input
            className="input grow"
            value={message}
            maxLength={240}
            placeholder="Say something to the drowning world…"
            onChange={(e) => setMessage(e.target.value)}
          />
          <button className="btn" type="submit" disabled={!message.trim()}>
            ➤
          </button>
        </form>
      )}
    </Panel>
  );
}
