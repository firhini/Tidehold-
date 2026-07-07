/**
 * The Exchange. As the world drowns, everything grows dearer.
 */
import React, { useState } from 'react';
import {
  MARKET_BASE_PRICES,
  MARKET_FEE,
  MARKET_FEE_OATHBREAKER_MULT,
  MARKET_FEE_WITH_PORT,
  OATHBREAKER_THRESHOLD,
  RESOURCE_LIST,
  tradeQuote,
  type ResourceType,
} from '@tidehold/shared';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { fmtShells, RESOURCE_META, runAction } from '../ui/util.js';
import { Panel } from './Panel.js';

export function MarketPanel() {
  const me = useStore((s) => s.me);
  const market = useStore((s) => s.market);
  const tiles = useStore((s) => s.tiles);
  const [resource, setResource] = useState<ResourceType>('timber');
  const [amount, setAmount] = useState(10);
  const [side, setSide] = useState<'buy' | 'sell'>('buy');

  if (!me || !market) return null;

  const hasPort = tiles.some((t) => t.building?.type === 'port' && t.building.ownerId === me.id);
  const isOathbreaker = me.reputation < OATHBREAKER_THRESHOLD;
  let feeRate = hasPort ? MARKET_FEE_WITH_PORT : MARKET_FEE;
  if (isOathbreaker) feeRate *= MARKET_FEE_OATHBREAKER_MULT;

  let quote: { shells: number; fee: number; pricePerUnit: number } | null = null;
  try {
    quote = amount > 0 ? tradeQuote(market, resource, amount, side, feeRate) : null;
  } catch {
    quote = null;
  }

  const canExecute =
    quote !== null &&
    (side === 'buy' ? me.shells >= quote.shells : me.resources[resource] >= amount);

  return (
    <Panel title="⚖️ The Exchange">
      <div className="card row-between">
        <span className="muted">Your shells</span>
        <b className="gold">🐚 {fmtShells(me.shells)}</b>
      </div>

      <div className="panel-section-title">Prices</div>
      <div className="card">
        {RESOURCE_LIST.map((r) => {
          const price = market.prices[r];
          const base = MARKET_BASE_PRICES[r];
          const deltaPct = Math.round(((price - base) / base) * 100);
          return (
            <div className="row-between" key={r} style={{ padding: '4px 0' }}>
              <span>
                {RESOURCE_META[r].icon} {RESOURCE_META[r].label}
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {price.toFixed(2)} 🐚{' '}
                <span className={deltaPct > 0 ? 'bad' : deltaPct < 0 ? 'good' : 'faint'} style={{ fontSize: 12 }}>
                  {deltaPct > 0 ? '▲' : deltaPct < 0 ? '▼' : '·'} {Math.abs(deltaPct)}%
                </span>
              </span>
            </div>
          );
        })}
        <p className="faint" style={{ marginTop: 6 }}>
          As the world drowns, everything grows dearer.
        </p>
      </div>

      <div className="panel-section-title">Trade</div>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="landing-auth-tabs" style={{ margin: 0 }}>
          <button className={side === 'buy' ? 'active' : ''} onClick={() => setSide('buy')}>
            Buy
          </button>
          <button className={side === 'sell' ? 'active' : ''} onClick={() => setSide('sell')}>
            Sell
          </button>
        </div>
        <div className="row">
          <select className="input grow" value={resource} onChange={(e) => setResource(e.target.value as ResourceType)}>
            {RESOURCE_LIST.map((r) => (
              <option key={r} value={r}>
                {RESOURCE_META[r].label}
              </option>
            ))}
          </select>
          <input
            className="input"
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(Math.max(1, Number.parseInt(e.target.value, 10) || 1))}
            style={{ width: 90 }}
          />
        </div>
        {quote && (
          <div className="row-between muted">
            <span>
              {side === 'buy' ? 'You pay' : 'You receive'} <b className="gold">{quote.shells.toFixed(2)} 🐚</b>
            </span>
            <span className="faint">
              fee {(feeRate * 100).toFixed(0)}%{hasPort && ' (port)'}
              {isOathbreaker && ' — oathbreaker'}
            </span>
          </div>
        )}
        <button
          className="btn btn-block"
          disabled={!canExecute}
          onClick={() => void runAction(() => api.trade(resource, amount, side), 'The deal is struck.')}
        >
          {side === 'buy' ? `Buy ${amount} ${RESOURCE_META[resource].label}` : `Sell ${amount} ${RESOURCE_META[resource].label}`}
        </button>
        {isOathbreaker && (
          <p className="bad" style={{ fontSize: 12 }}>
            The merchants trust an Oathbreaker only at double the fee.
          </p>
        )}
      </div>
    </Panel>
  );
}
