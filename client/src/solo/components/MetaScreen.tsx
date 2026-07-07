/**
 * The Reliquary — the Salvage shop, TIDEHOLD's permanent progression. Spend the
 * meta currency you earn every run on run-start upgrades, commanders to lead a
 * run with, and cosmetic Ark hull skins. Every purchase and selection flows
 * through the store (which persists to localStorage and toasts its own results).
 */
import React from 'react';
import { useSolo } from '../store.js';
import { COMMANDERS, SKINS, UPGRADES } from '../config.js';

type Tab = 'upgrades' | 'commanders' | 'skins';

const TABS: { id: Tab; label: string }[] = [
  { id: 'upgrades', label: 'Upgrades' },
  { id: 'commanders', label: 'Commanders' },
  { id: 'skins', label: 'Skins' },
];

/** Leave the shop back to wherever the player came from — a live run, else game-over. */
function back(): void {
  const s = useSolo.getState();
  if (s.me && !s.result) useSolo.setState({ screen: 'run' });
  else useSolo.setState({ screen: 'gameover' });
}

const ACTION_BTN: React.CSSProperties = { minHeight: 44, marginTop: 4 };
const NAV_BTN: React.CSSProperties = { minHeight: 40 };

export function MetaScreen() {
  const [tab, setTab] = React.useState<Tab>('upgrades');
  const meta = useSolo((s) => s.metaState);
  const buyUpgrade = useSolo((s) => s.buyUpgrade);
  const buyCommander = useSolo((s) => s.buyCommander);
  const buySkin = useSolo((s) => s.buySkin);
  const selectCommander = useSolo((s) => s.selectCommander);
  const selectSkin = useSolo((s) => s.selectSkin);

  return (
    <div className="overlay" role="dialog" aria-label="The Reliquary">
      <div className="sheet" style={{ width: 'min(640px, 100%)' }}>
        <div className="row-between" style={{ marginBottom: 14 }}>
          <button className="btn btn-ghost" style={NAV_BTN} onClick={back}>
            ← Back to the sea
          </button>
          <span className="salvage-badge">🐚 {meta.salvage} salvage</span>
        </div>

        <h2>The Reliquary</h2>
        <p className="sub">Salvage is earned every run. Upgrades are permanent.</p>

        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? 'active' : ''}
              style={NAV_BTN}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'upgrades' && (
          <div className="shop-grid">
            {UPGRADES.map((u) => {
              const owned = meta.upgrades.includes(u.id);
              const affordable = meta.salvage >= u.cost;
              return (
                <div key={u.id} className={`shop-item${owned ? ' owned' : ''}`}>
                  <div className="row-between">
                    <span className="name">{u.name}</span>
                    <span className="shop-price">🐚 {u.cost}</span>
                  </div>
                  <div className="desc">{u.description}</div>
                  <button
                    className="btn"
                    style={ACTION_BTN}
                    disabled={owned || !affordable}
                    onClick={() => buyUpgrade(u.id)}
                  >
                    {owned ? '✓ Owned' : affordable ? 'Buy' : 'Not enough salvage'}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'commanders' && (
          <div className="shop-grid">
            {COMMANDERS.map((c) => {
              const unlocked = meta.commanders.includes(c.id);
              const selected = meta.selectedCommander === c.id;
              const affordable = meta.salvage >= c.cost;
              return (
                <div key={c.id} className={`shop-item${unlocked ? ' owned' : ''}${selected ? ' selected' : ''}`}>
                  <div className="row-between">
                    <span className="name">{c.name}</span>
                    {!unlocked && <span className="shop-price">🐚 {c.cost}</span>}
                  </div>
                  <div className="desc">{c.description}</div>
                  {selected ? (
                    <button className="btn" style={ACTION_BTN} disabled>
                      ✓ Leading
                    </button>
                  ) : unlocked ? (
                    <button className="btn btn-ghost" style={ACTION_BTN} onClick={() => selectCommander(c.id)}>
                      Lead this run
                    </button>
                  ) : (
                    <button className="btn" style={ACTION_BTN} disabled={!affordable} onClick={() => buyCommander(c.id)}>
                      {affordable ? 'Buy' : 'Not enough salvage'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {tab === 'skins' && (
          <div className="shop-grid">
            {SKINS.map((skin) => {
              const owned = meta.skins.includes(skin.id);
              const selected = meta.selectedSkin === skin.id;
              const affordable = meta.salvage >= skin.cost;
              return (
                <div key={skin.id} className={`shop-item${owned ? ' owned' : ''}${selected ? ' selected' : ''}`}>
                  <div className="row-between">
                    <span className="name" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span
                        aria-hidden="true"
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: 5,
                          background: skin.ark,
                          boxShadow: `0 0 8px ${skin.ark}, inset 0 0 0 1px rgba(255,255,255,0.18)`,
                          flexShrink: 0,
                        }}
                      />
                      {skin.name}
                    </span>
                    {!owned && <span className="shop-price">🐚 {skin.cost}</span>}
                  </div>
                  <div className="desc">
                    {skin.worldTint
                      ? 'Recolors your hull and tints the whole drowning sea.'
                      : 'A fresh accent for your Ark against the dark water.'}
                  </div>
                  {selected ? (
                    <button className="btn" style={ACTION_BTN} disabled>
                      ✓ Equipped
                    </button>
                  ) : owned ? (
                    <button className="btn btn-ghost" style={ACTION_BTN} onClick={() => selectSkin(skin.id)}>
                      Equip
                    </button>
                  ) : (
                    <button className="btn" style={ACTION_BTN} disabled={!affordable} onClick={() => buySkin(skin.id)}>
                      {affordable ? 'Buy' : 'Not enough salvage'}
                    </button>
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
