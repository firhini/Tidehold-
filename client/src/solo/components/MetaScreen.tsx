/**
 * The Reliquary — spend Salvage (earned every run) on permanent upgrades,
 * commanders to lead with, and cosmetic Ark skins.
 */
import React, { useState } from 'react';
import { useSolo } from '../store.js';
import { COMMANDERS, SKINS, UPGRADES } from '../config.js';

type Tab = 'upgrades' | 'commanders' | 'skins';

function back(): void {
  const s = useSolo.getState();
  useSolo.setState({ screen: s.result ? 'gameover' : 'run' });
}

export function MetaScreen() {
  const meta = useSolo((s) => s.metaState);
  const buyUpgrade = useSolo((s) => s.buyUpgrade);
  const buyCommander = useSolo((s) => s.buyCommander);
  const buySkin = useSolo((s) => s.buySkin);
  const selectCommander = useSolo((s) => s.selectCommander);
  const selectSkin = useSolo((s) => s.selectSkin);
  const [tab, setTab] = useState<Tab>('upgrades');

  return (
    <div className="overlay">
      <div className="sheet" style={{ width: 'min(640px, 100%)' }}>
        <div className="row-between" style={{ marginBottom: 6 }}>
          <button className="btn btn-ghost" onClick={back}>← Back to the sea</button>
          <span className="salvage-badge">🐚 {meta.salvage} salvage</span>
        </div>
        <h2 style={{ marginBottom: 2 }}>The Reliquary</h2>
        <div className="sub">Salvage is earned every run. Upgrades are permanent — each run starts stronger.</div>

        <div className="tabs">
          <button className={tab === 'upgrades' ? 'active' : ''} onClick={() => setTab('upgrades')}>Upgrades</button>
          <button className={tab === 'commanders' ? 'active' : ''} onClick={() => setTab('commanders')}>Commanders</button>
          <button className={tab === 'skins' ? 'active' : ''} onClick={() => setTab('skins')}>Skins</button>
        </div>

        {tab === 'upgrades' && (
          <div className="shop-grid">
            {UPGRADES.map((u) => {
              const owned = meta.upgrades.includes(u.id);
              return (
                <div key={u.id} className={`shop-item${owned ? ' owned' : ''}`}>
                  <div className="row-between"><span className="name">{u.name}</span><span className="shop-price">🐚 {u.cost}</span></div>
                  <div className="desc">{u.description}</div>
                  {owned ? (
                    <span className="tag" style={{ color: 'var(--success)' }}>✓ Owned</span>
                  ) : (
                    <button className="btn" disabled={meta.salvage < u.cost} onClick={() => buyUpgrade(u.id)}>Unlock</button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {tab === 'commanders' && (
          <div className="shop-grid">
            {COMMANDERS.map((c) => {
              const owned = meta.commanders.includes(c.id);
              const selected = meta.selectedCommander === c.id;
              return (
                <div key={c.id} className={`shop-item${owned ? ' owned' : ''}${selected ? ' selected' : ''}`}>
                  <div className="row-between"><span className="name">{c.name}</span>{!owned && <span className="shop-price">🐚 {c.cost}</span>}</div>
                  <div className="desc">{c.description}</div>
                  {!owned ? (
                    <button className="btn" disabled={meta.salvage < c.cost} onClick={() => buyCommander(c.id)}>Recruit</button>
                  ) : selected ? (
                    <span className="tag tag-gold">✓ Leading</span>
                  ) : (
                    <button className="btn btn-ghost" onClick={() => selectCommander(c.id)}>Lead this run</button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {tab === 'skins' && (
          <div className="shop-grid">
            {SKINS.map((s) => {
              const owned = meta.skins.includes(s.id);
              const selected = meta.selectedSkin === s.id;
              return (
                <div key={s.id} className={`shop-item${owned ? ' owned' : ''}${selected ? ' selected' : ''}`}>
                  <div className="row-between">
                    <span className="name"><span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 6, background: s.ark, marginRight: 8, verticalAlign: 'middle' }} />{s.name}</span>
                    {!owned && <span className="shop-price">🐚 {s.cost}</span>}
                  </div>
                  {!owned ? (
                    <button className="btn" disabled={meta.salvage < s.cost} onClick={() => buySkin(s.id)}>Acquire</button>
                  ) : selected ? (
                    <span className="tag tag-gold">✓ Equipped</span>
                  ) : (
                    <button className="btn btn-ghost" onClick={() => selectSkin(s.id)}>Equip</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
