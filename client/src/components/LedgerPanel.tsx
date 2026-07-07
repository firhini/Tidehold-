/**
 * The Ledger — public contracts, reputation, and the price of betrayal.
 */
import React, { useMemo, useState } from 'react';
import {
  OATHBREAKER_THRESHOLD,
  RESOURCE_LIST,
  type Contract,
  type ContractType,
  type ResourceType,
} from '@tidehold/shared';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { fmtTicks, RESOURCE_META, runAction } from '../ui/util.js';
import { Panel } from './Panel.js';

const TYPE_INFO: Record<ContractType, { label: string; blurb: string }> = {
  alliance: { label: 'Alliance', blurb: 'Sworn brotherhood. Attacking an ally is the deepest betrayal (−40 rep).' },
  non_aggression: { label: 'Non-aggression', blurb: 'No attacks between you for the duration (−30 rep to break).' },
  trade: { label: 'Trade', blurb: 'Exchange resources — once, or on a recurring interval.' },
  tribute: { label: 'Tribute', blurb: 'One-way recurring payment. Protection, extortion — The Ledger does not judge.' },
  ransom: { label: 'Ransom', blurb: 'Buy a captured commander home.' },
};

function bagText(bag: Partial<Record<ResourceType, number>> | undefined): string {
  const entries = Object.entries(bag ?? {}).filter(([, v]) => (v ?? 0) > 0);
  if (entries.length === 0) return 'nothing';
  return entries.map(([k, v]) => `${v} ${RESOURCE_META[k as ResourceType].icon}`).join(' + ');
}

function termsText(c: Contract): string {
  if (c.type === 'alliance') return 'Mutual defense, sworn in public.';
  if (c.type === 'non_aggression') return 'Peace between the parties.';
  const base = `gives ${bagText(c.terms.give)} / receives ${bagText(c.terms.receive)}`;
  return c.terms.intervalTicks ? `${base} every ${c.terms.intervalTicks} ticks` : base;
}

export function LedgerPanel() {
  const me = useStore((s) => s.me);
  const meta = useStore((s) => s.meta);
  const players = useStore((s) => s.players);
  const myContracts = useStore((s) => s.myContracts);

  if (!me || !meta) return null;
  const nameOf = (id: string) => players.find((p) => p.id === id)?.username ?? 'a lost soul';

  const proposalsToMe = myContracts.filter((c) => c.status === 'proposed' && c.toId === me.id);
  const proposalsFromMe = myContracts.filter((c) => c.status === 'proposed' && c.fromId === me.id);
  const active = myContracts.filter((c) => c.status === 'active');
  const history = myContracts
    .filter((c) => ['completed', 'broken', 'declined', 'expired'].includes(c.status))
    .slice(-8)
    .reverse();

  return (
    <Panel title="📜 The Ledger">
      <div className="card">
        <div className="row-between">
          <span className="muted">Your reputation</span>
          <b className={me.reputation < OATHBREAKER_THRESHOLD ? 'bad' : 'gold'}>{Math.round(me.reputation)} / 200</b>
        </div>
        <p className="faint" style={{ marginTop: 4 }}>
          {me.reputation < OATHBREAKER_THRESHOLD
            ? 'OATHBREAKER — your market fees are doubled and anyone may attack you without dishonor.'
            : `Below ${OATHBREAKER_THRESHOLD}, you become an Oathbreaker: doubled fees, fair game for all.`}
        </p>
      </div>

      {proposalsToMe.length > 0 && <div className="panel-section-title">Awaiting your seal</div>}
      {proposalsToMe.map((c) => (
        <div className="card" key={c.id}>
          <div className="row-between">
            <b>{TYPE_INFO[c.type].label}</b>
            <span className="muted">from {nameOf(c.fromId)}</span>
          </div>
          <p className="muted" style={{ margin: '4px 0' }}>
            {termsText(c)}
          </p>
          {c.terms.note && <p className="faint">“{c.terms.note}”</p>}
          <div className="row" style={{ marginTop: 6 }}>
            <button
              className="btn grow"
              onClick={() => void runAction(() => api.respondContract(c.id, true), 'Sealed in The Ledger.')}
            >
              ✒ Accept
            </button>
            <button
              className="btn btn-ghost grow"
              onClick={() => void runAction(() => api.respondContract(c.id, false))}
            >
              Decline
            </button>
          </div>
        </div>
      ))}

      <div className="panel-section-title">Active oaths</div>
      {active.length === 0 && <p className="faint">The Ledger holds no open pages for you.</p>}
      {active.map((c) => (
        <div className="card" key={c.id}>
          <div className="row-between">
            <b>{TYPE_INFO[c.type].label}</b>
            <span className="muted">with {nameOf(c.fromId === me.id ? c.toId : c.fromId)}</span>
          </div>
          <p className="muted" style={{ margin: '4px 0' }}>
            {termsText(c)}
          </p>
          <p className="faint">
            Lapses in {fmtTicks(Math.max(0, c.expiresTick - meta.tick), meta)}
            {c.nextDueTick !== undefined && ` · next exchange in ${fmtTicks(Math.max(0, c.nextDueTick - meta.tick), meta)}`}
          </p>
          <button
            className="btn btn-danger btn-block"
            style={{ marginTop: 6 }}
            onClick={() => {
              if (
                window.confirm(
                  'Tear this page from The Ledger? Breaking an oath costs 30 reputation, and the world will know.',
                )
              ) {
                void runAction(() => api.cancelContract(c.id), 'The oath is broken. The Ledger remembers.');
              }
            }}
          >
            Break oath
          </button>
        </div>
      ))}

      {proposalsFromMe.length > 0 && <div className="panel-section-title">Your open proposals</div>}
      {proposalsFromMe.map((c) => (
        <div className="card" key={c.id}>
          <div className="row-between">
            <span>
              <b>{TYPE_INFO[c.type].label}</b> → {nameOf(c.toId)}
            </span>
            <button className="btn btn-ghost" onClick={() => void runAction(() => api.cancelContract(c.id))}>
              Withdraw
            </button>
          </div>
          <p className="faint" style={{ marginTop: 4 }}>
            {termsText(c)}
          </p>
        </div>
      ))}

      <NewContractForm />

      {history.length > 0 && <div className="panel-section-title">History</div>}
      {history.map((c) => (
        <div className="row-between faint" key={c.id} style={{ padding: '2px 4px' }}>
          <span>
            {TYPE_INFO[c.type].label} with {nameOf(c.fromId === me.id ? c.toId : c.fromId)}
          </span>
          <span className={c.status === 'broken' ? 'bad' : ''}>{c.status}</span>
        </div>
      ))}
    </Panel>
  );
}

function NewContractForm() {
  const me = useStore((s) => s.me);
  const players = useStore((s) => s.players);
  const [toId, setToId] = useState('');
  const [type, setType] = useState<ContractType>('trade');
  const [give, setGive] = useState<{ res: ResourceType; amt: number }>({ res: 'timber', amt: 0 });
  const [receive, setReceive] = useState<{ res: ResourceType; amt: number }>({ res: 'ore', amt: 0 });
  const [interval, setInterval_] = useState(0);
  const [duration, setDuration] = useState(600);
  const [commanderId, setCommanderId] = useState('');
  const [note, setNote] = useState('');

  const others = useMemo(() => players.filter((p) => p.id !== me?.id && !p.defeated), [players, me]);
  const counterparty = others.find((p) => p.id === toId);

  if (!me) return null;

  // Ransomable commanders: mine captured by them, or theirs captured by me.
  const ransomable =
    type === 'ransom' && counterparty
      ? me.commanders.filter((c) => c.status === 'captured' && c.capturedById === counterparty.id)
      : [];

  const needsExchange = type === 'trade' || type === 'tribute' || type === 'ransom';

  const submit = () => {
    const terms: Record<string, unknown> = {};
    if (needsExchange) {
      terms.give = give.amt > 0 ? { [give.res]: give.amt } : {};
      terms.receive = receive.amt > 0 ? { [receive.res]: receive.amt } : {};
      if (interval > 0 && type !== 'ransom') terms.intervalTicks = interval;
    }
    if (type === 'ransom') terms.commanderId = commanderId;
    if (note.trim()) terms.note = note.trim();
    void runAction(
      () => api.proposeContract(toId, type, terms, duration),
      'The proposal is inscribed in The Ledger.',
    );
  };

  return (
    <div className="card">
      <div className="panel-section-title">Inscribe a new contract</div>
      {others.length === 0 ? (
        <p className="faint" style={{ marginTop: 6 }}>
          No other powers sail these waters yet. The Ledger waits.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          <select className="input" value={toId} onChange={(e) => setToId(e.target.value)}>
            <option value="">Choose a counterparty…</option>
            {others.map((p) => (
              <option key={p.id} value={p.id}>
                {p.username} (⭐{p.score} · ⚖{p.reputation}
                {p.isOathbreaker ? ' OATHBREAKER' : ''})
              </option>
            ))}
          </select>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as ContractType)}>
            {(Object.keys(TYPE_INFO) as ContractType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_INFO[t].label}
              </option>
            ))}
          </select>
          <p className="faint">{TYPE_INFO[type].blurb}</p>

          {needsExchange && (
            <>
              <div className="row">
                <span className="faint" style={{ width: 62 }}>
                  I give
                </span>
                <select
                  className="input"
                  value={give.res}
                  onChange={(e) => setGive({ ...give, res: e.target.value as ResourceType })}
                >
                  {RESOURCE_LIST.map((r) => (
                    <option key={r} value={r}>
                      {RESOURCE_META[r].label}
                    </option>
                  ))}
                </select>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={give.amt}
                  onChange={(e) => setGive({ ...give, amt: Math.max(0, Number.parseInt(e.target.value, 10) || 0) })}
                  style={{ width: 84 }}
                />
              </div>
              <div className="row">
                <span className="faint" style={{ width: 62 }}>
                  I get
                </span>
                <select
                  className="input"
                  value={receive.res}
                  onChange={(e) => setReceive({ ...receive, res: e.target.value as ResourceType })}
                >
                  {RESOURCE_LIST.map((r) => (
                    <option key={r} value={r}>
                      {RESOURCE_META[r].label}
                    </option>
                  ))}
                </select>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={receive.amt}
                  onChange={(e) =>
                    setReceive({ ...receive, amt: Math.max(0, Number.parseInt(e.target.value, 10) || 0) })
                  }
                  style={{ width: 84 }}
                />
              </div>
              {type !== 'ransom' && (
                <div className="row">
                  <span className="faint" style={{ width: 62 }}>
                    Repeat
                  </span>
                  <input
                    className="input grow"
                    type="number"
                    min={0}
                    placeholder="interval in ticks (0 = once)"
                    value={interval || ''}
                    onChange={(e) => setInterval_(Math.max(0, Number.parseInt(e.target.value, 10) || 0))}
                  />
                </div>
              )}
            </>
          )}

          {type === 'ransom' && (
            <select className="input" value={commanderId} onChange={(e) => setCommanderId(e.target.value)}>
              <option value="">Choose the captive…</option>
              {ransomable.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} (your commander, held by {counterparty?.username})
                </option>
              ))}
            </select>
          )}

          <div className="row">
            <span className="faint" style={{ width: 62 }}>
              Duration
            </span>
            <input
              className="input grow"
              type="number"
              min={60}
              max={4000}
              value={duration}
              onChange={(e) => setDuration(Number.parseInt(e.target.value, 10) || 600)}
            />
            <span className="faint">ticks</span>
          </div>
          <input
            className="input"
            placeholder="A note for the record (optional)"
            value={note}
            maxLength={280}
            onChange={(e) => setNote(e.target.value)}
          />
          <button className="btn btn-block" disabled={!toId || (type === 'ransom' && !commanderId)} onClick={submit}>
            ✒ Propose
          </button>
        </div>
      )}
    </div>
  );
}
