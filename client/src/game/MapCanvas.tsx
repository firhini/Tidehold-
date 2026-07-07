/**
 * The world map — a full-screen canvas hex renderer.
 * Pan (drag/touch), zoom (wheel/pinch), tap to select, targeting mode for
 * army/ark/expedition orders. Animated: water shimmer, doom pulses, battle
 * rings. The map's job is to say one thing clearly: this world is dying.
 */
import React, { useEffect, useRef } from 'react';
import {
  ARK_INFLUENCE_RADIUS,
  hexToPixel,
  pixelToHex,
  hexKey,
  totalUnits,
  type Tile,
} from '@tidehold/shared';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { TERRAIN_META, BUILDING_ICONS, playerColor, runAction } from '../ui/util.js';

const HEX = 26; // world-unit hex size

// --------------------------------------------------------------------------
// Color helpers (cached per terrain/elevation combination)
// --------------------------------------------------------------------------

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, (n >> 16) + amt));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + amt));
  const b = Math.min(255, Math.max(0, (n & 0xff) + amt));
  return `rgb(${r},${g},${b})`;
}

interface TileVisual {
  fill: string;
  edge: string;
}

const visualCache = new Map<string, TileVisual>();

function tileVisual(tile: Tile): TileVisual {
  const key = `${tile.terrain}:${tile.elevation}`;
  let v = visualCache.get(key);
  if (!v) {
    const meta = TERRAIN_META[tile.terrain];
    const lift = (tile.elevation - 4) * 5;
    v = { fill: shade(meta.color, lift), edge: meta.edge };
    visualCache.set(key, v);
  }
  return v;
}

// --------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------

export function MapCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const targeting = useStore((s) => s.targeting);
  const setTargeting = useStore((s) => s.setTargeting);

  // Camera + interaction state live in refs — the rAF loop reads them.
  const cam = useRef({ x: 0, y: 0, scale: 1 });
  const centered = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragState = useRef({ moved: 0, lastX: 0, lastY: 0, pinchDist: 0 });
  const hovered = useRef<{ q: number; r: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let disposed = false;

    const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const rect = canvas.parentElement!.getBoundingClientRect();
      canvas.width = Math.round(rect.width * dpr());
      canvas.height = Math.round(rect.height * dpr());
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement!);

    const hexCorner = (i: number) => {
      const angle = (Math.PI / 180) * (60 * i - 30);
      return { x: HEX * Math.cos(angle), y: HEX * Math.sin(angle) };
    };
    const hexPathAt = (px: number, py: number, scale: number, inset = 0) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const c = hexCorner(i);
        const k = (HEX - inset) / HEX;
        const x = px + c.x * k * scale;
        const y = py + c.y * k * scale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };

    const draw = (now: number) => {
      if (disposed) return;
      const s = useStore.getState();
      const { tiles, meta, me, armies, battles, myExpeditions, players, selected } = s;
      const d = dpr();
      const W = canvas.width;
      const Hpx = canvas.height;

      // Center on my Ark once data exists.
      if (!centered.current && me) {
        const p = hexToPixel(me.ark, HEX);
        cam.current.x = p.x;
        cam.current.y = p.y;
        centered.current = true;
      }

      const { x: cx, y: cy, scale } = cam.current;
      const toScreen = (wx: number, wy: number) => ({
        x: (wx - cx) * scale * d + W / 2,
        y: (wy - cy) * scale * d + Hpx / 2,
      });

      // -- Background: deep water gradient + slow shimmer bands.
      const grad = ctx.createRadialGradient(W / 2, Hpx * 0.9, 0, W / 2, Hpx * 0.9, Math.max(W, Hpx));
      grad.addColorStop(0, '#0a2843');
      grad.addColorStop(1, '#04121f');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, Hpx);
      ctx.save();
      ctx.globalAlpha = 0.05;
      for (let i = 0; i < 3; i++) {
        const y = ((now * 0.008 + i * 260) % (Hpx + 400)) - 200;
        const g2 = ctx.createLinearGradient(0, y - 60, 0, y + 60);
        g2.addColorStop(0, 'transparent');
        g2.addColorStop(0.5, '#9db4c0');
        g2.addColorStop(1, 'transparent');
        ctx.fillStyle = g2;
        ctx.fillRect(0, y - 60, W, 120);
      }
      ctx.restore();

      if (!meta || tiles.length === 0) {
        raf = requestAnimationFrame(draw);
        return;
      }

      const sc = scale * d;
      const margin = HEX * 2 * sc;
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.004);
      const tideLevel = meta.tideLevel;

      // -- Tiles.
      ctx.lineJoin = 'round';
      const visible: { tile: Tile; x: number; y: number }[] = [];
      for (const tile of tiles) {
        const wp = hexToPixel(tile, HEX);
        const sp = toScreen(wp.x, wp.y);
        if (sp.x < -margin || sp.x > W + margin || sp.y < -margin || sp.y > Hpx + margin) continue;
        visible.push({ tile, x: sp.x, y: sp.y });
      }

      for (const { tile, x, y } of visible) {
        const v = tileVisual(tile);
        hexPathAt(x, y, sc);
        ctx.fillStyle = v.fill;
        ctx.fill();
        if (sc > 0.5) {
          ctx.strokeStyle = v.edge;
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        if (!tile.flooded) {
          // Doom telegraphs: next rise = pulsing waterline; the one after = faint tint.
          if (tile.elevation <= tideLevel + 1) {
            hexPathAt(x, y, sc);
            ctx.fillStyle = `rgba(120, 220, 255, ${0.16 + 0.22 * pulse})`;
            ctx.fill();
          } else if (tile.elevation === tideLevel + 2) {
            hexPathAt(x, y, sc);
            ctx.fillStyle = 'rgba(120, 200, 255, 0.10)';
            ctx.fill();
          }
        } else if (tile.terrain === 'drowned') {
          // Ripples over drowned ruins.
          ctx.save();
          ctx.globalAlpha = 0.25 + 0.15 * Math.sin(now * 0.002 + tile.q * 1.7 + tile.r * 2.3);
          ctx.strokeStyle = '#9adbe8';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, HEX * 0.45 * sc, 0.2, Math.PI - 0.2);
          ctx.stroke();
          ctx.restore();
        }

        // Ownership border.
        if (tile.ownerId) {
          hexPathAt(x, y, sc, 2.5);
          ctx.strokeStyle = playerColor(tile.ownerId);
          ctx.lineWidth = me && tile.ownerId === me.id ? 2.5 : 1.8;
          ctx.globalAlpha = 0.95;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      // -- Icons (buildings, ruins) — separate pass so text batches nicely.
      if (sc > 0.45) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const { tile, x, y } of visible) {
          const iconSize = Math.round(HEX * 0.85 * sc);
          if (tile.building) {
            const disabled = (tile.building.disabledUntilTick ?? 0) > meta.tick;
            ctx.globalAlpha = disabled ? 0.4 : 1;
            ctx.font = `${iconSize}px serif`;
            ctx.fillText(BUILDING_ICONS[tile.building.type] ?? '?', x, y - 2 * sc);
            // Level pips.
            ctx.globalAlpha = 0.9;
            ctx.fillStyle = '#e0b64f';
            const pipW = 3 * sc;
            for (let i = 0; i < tile.building.level; i++) {
              ctx.fillRect(
                x - (tile.building.level * pipW) / 2 + i * pipW + 0.5,
                y + HEX * 0.42 * sc,
                pipW - 1,
                2.5 * sc,
              );
            }
            ctx.globalAlpha = 1;
          } else if ((tile.terrain === 'ruins' || tile.terrain === 'drowned') && (tile.ruinTier ?? 0) > 0) {
            ctx.globalAlpha = tile.terrain === 'drowned' ? 0.55 : 0.95;
            ctx.font = `${iconSize}px serif`;
            ctx.fillText('🏛', x, y);
            ctx.globalAlpha = 1;
            // Only surface ruins keep their garrisons — the sea drowned the rest.
            if (tile.terrain === 'ruins' && (tile.garrison ?? 0) > 0 && sc > 0.7) {
              ctx.font = `bold ${Math.round(9 * sc)}px sans-serif`;
              ctx.fillStyle = '#ff8d7e';
              ctx.fillText(`⚔${tile.garrison}`, x, y + HEX * 0.55 * sc);
            }
          }
        }
      }

      // -- Arks.
      for (const p of players) {
        if (p.defeated) continue;
        const wp = hexToPixel(p.ark, HEX);
        const sp = toScreen(wp.x, wp.y);
        if (sp.x < -margin || sp.x > W + margin || sp.y < -margin || sp.y > Hpx + margin) continue;
        const mine = me && p.id === me.id;
        if (mine) {
          // Influence ring.
          const radius = ARK_INFLUENCE_RADIUS[(me!.ark.level ?? 1) - 1] ?? 4;
          ctx.save();
          ctx.strokeStyle = 'rgba(224, 182, 79, 0.35)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 6]);
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, (radius + 0.5) * HEX * Math.sqrt(3) * sc, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
          // Halo.
          ctx.save();
          ctx.fillStyle = `rgba(224, 182, 79, ${0.12 + 0.08 * pulse})`;
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, HEX * 1.1 * sc, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, HEX * 0.62 * sc, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(4, 18, 31, 0.85)';
        ctx.fill();
        ctx.strokeStyle = playerColor(p.id);
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.font = `${Math.round(HEX * 0.75 * sc)}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⛵', sp.x, sp.y);
        if (sc > 0.55) {
          ctx.font = `600 ${Math.round(10 * sc)}px sans-serif`;
          ctx.fillStyle = playerColor(p.id);
          ctx.fillText(p.username, sp.x, sp.y + HEX * 1.05 * sc);
        }
      }

      // -- Armies.
      for (const army of armies) {
        const wp = hexToPixel(army, HEX);
        const sp = toScreen(wp.x, wp.y);
        if (sp.x < -margin || sp.x > W + margin || sp.y < -margin || sp.y > Hpx + margin) continue;
        const mine = me && army.ownerId === me.id;
        // Path line for my moving armies.
        if (mine && army.path.length > 0) {
          ctx.save();
          ctx.strokeStyle = 'rgba(232, 241, 245, 0.5)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 5]);
          ctx.beginPath();
          ctx.moveTo(sp.x, sp.y);
          for (const step of army.path) {
            const swp = hexToPixel(step, HEX);
            const ssp = toScreen(swp.x, swp.y);
            ctx.lineTo(ssp.x, ssp.y);
          }
          ctx.stroke();
          ctx.restore();
        }
        const r0 = HEX * 0.42 * sc;
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y - r0);
        ctx.lineTo(sp.x + r0 * 0.9, sp.y - r0 * 0.3);
        ctx.lineTo(sp.x + r0 * 0.7, sp.y + r0 * 0.7);
        ctx.lineTo(sp.x, sp.y + r0);
        ctx.lineTo(sp.x - r0 * 0.7, sp.y + r0 * 0.7);
        ctx.lineTo(sp.x - r0 * 0.9, sp.y - r0 * 0.3);
        ctx.closePath();
        ctx.fillStyle = 'rgba(4, 18, 31, 0.9)';
        ctx.fill();
        ctx.strokeStyle = playerColor(army.ownerId);
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#e8f1f5';
        ctx.font = `bold ${Math.round(9.5 * sc)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(totalUnits(army.units)), sp.x, sp.y);
        if (army.battleId) {
          ctx.font = `${Math.round(11 * sc)}px serif`;
          ctx.fillText('⚔️', sp.x + r0 * 1.3, sp.y - r0);
        }
      }

      // -- Battles: pulsing red ring + countdown.
      for (const battle of battles) {
        const wp = hexToPixel(battle.target, HEX);
        const sp = toScreen(wp.x, wp.y);
        ctx.save();
        ctx.strokeStyle = `rgba(224, 96, 79, ${0.5 + 0.5 * pulse})`;
        ctx.lineWidth = 2.5;
        hexPathAt(sp.x, sp.y, sc, -2);
        ctx.stroke();
        const left = battle.resolveTick - meta.tick;
        ctx.fillStyle = '#ff9d8e';
        ctx.font = `bold ${Math.round(10 * sc)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(left > 0 ? `⚔ ${left}` : '⚔', sp.x, sp.y - HEX * 1.15 * sc);
        ctx.restore();
      }

      // -- My expedition targets: teal pulsing diamond.
      for (const exp of myExpeditions) {
        const wp = hexToPixel(exp.target, HEX);
        const sp = toScreen(wp.x, wp.y);
        const rr = HEX * 0.35 * sc * (0.85 + 0.3 * pulse);
        ctx.save();
        ctx.strokeStyle = 'rgba(100, 220, 220, 0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y - rr);
        ctx.lineTo(sp.x + rr, sp.y);
        ctx.lineTo(sp.x, sp.y + rr);
        ctx.lineTo(sp.x - rr, sp.y);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
      }

      // -- Selection + hover.
      if (selected) {
        const wp = hexToPixel(selected, HEX);
        const sp = toScreen(wp.x, wp.y);
        hexPathAt(sp.x, sp.y, sc, -1.5);
        ctx.strokeStyle = '#e0b64f';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
      if (hovered.current && !('ontouchstart' in window)) {
        const wp = hexToPixel(hovered.current, HEX);
        const sp = toScreen(wp.x, wp.y);
        hexPathAt(sp.x, sp.y, sc, -1);
        ctx.strokeStyle = 'rgba(232, 241, 245, 0.45)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    // ----------------------------------------------------------------------
    // Interaction
    // ----------------------------------------------------------------------

    const screenToHex = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const d = dpr();
      const sx = (clientX - rect.left) * d;
      const sy = (clientY - rect.top) * d;
      const wx = (sx - canvas.width / 2) / (cam.current.scale * d) + cam.current.x;
      const wy = (sy - canvas.height / 2) / (cam.current.scale * d) + cam.current.y;
      return pixelToHex(wx, wy, HEX);
    };

    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      dragState.current.moved = 0;
      dragState.current.lastX = e.clientX;
      dragState.current.lastY = e.clientY;
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        dragState.current.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) {
        // Plain hover.
        hovered.current = screenToHex(e.clientX, e.clientY);
        return;
      }
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 1) {
        const dx = e.clientX - dragState.current.lastX;
        const dy = e.clientY - dragState.current.lastY;
        dragState.current.moved += Math.abs(dx) + Math.abs(dy);
        dragState.current.lastX = e.clientX;
        dragState.current.lastY = e.clientY;
        cam.current.x -= dx / cam.current.scale;
        cam.current.y -= dy / cam.current.scale;
      } else if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (dragState.current.pinchDist > 0) {
          const factor = dist / dragState.current.pinchDist;
          cam.current.scale = Math.min(3, Math.max(0.35, cam.current.scale * factor));
        }
        dragState.current.pinchDist = dist;
        dragState.current.moved += 10;
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const wasClick = pointers.current.size === 1 && dragState.current.moved < 6;
      pointers.current.delete(e.pointerId);
      dragState.current.pinchDist = 0;
      if (!wasClick) return;
      const hexCoord = screenToHex(e.clientX, e.clientY);
      const s = useStore.getState();
      const tile = s.tileMap.get(hexKey(hexCoord.q, hexCoord.r));
      if (!tile) return;
      const t = s.targeting;
      if (t) {
        s.setTargeting(null);
        const { q, r } = tile;
        if (t.kind === 'army_move' && t.armyId)
          void runAction(() => api.moveArmy(t.armyId!, q, r), 'The column marches.');
        else if (t.kind === 'army_attack' && t.armyId)
          void runAction(() => api.attack(t.armyId!, q, r), 'The horns sound. Battle joins soon.');
        else if (t.kind === 'ark_move') void runAction(() => api.moveArk(q, r), 'The Ark weighs anchor.');
        else if (t.kind === 'expedition') void runAction(() => api.expedition(q, r), 'The expedition sets out.');
      } else {
        s.selectTile(tile.q, tile.r);
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const d = dpr();
      const sx = (e.clientX - rect.left) * d;
      const sy = (e.clientY - rect.top) * d;
      const before = {
        x: (sx - canvas.width / 2) / (cam.current.scale * d) + cam.current.x,
        y: (sy - canvas.height / 2) / (cam.current.scale * d) + cam.current.y,
      };
      const factor = Math.exp(-e.deltaY * 0.0012);
      cam.current.scale = Math.min(3, Math.max(0.35, cam.current.scale * factor));
      const after = {
        x: (sx - canvas.width / 2) / (cam.current.scale * d) + cam.current.x,
        y: (sy - canvas.height / 2) / (cam.current.scale * d) + cam.current.y,
      };
      cam.current.x += before.x - after.x;
      cam.current.y += before.y - after.y;
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useStore.getState().setTargeting(null);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} style={{ cursor: targeting ? 'crosshair' : 'grab' }} />
      {targeting && (
        <div className="targeting-bar">
          <span>{targeting.hint}</span>
          <button className="btn btn-ghost" onClick={() => setTargeting(null)}>
            Cancel
          </button>
        </div>
      )}
    </>
  );
}
