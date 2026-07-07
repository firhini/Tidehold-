/**
 * Solo map renderer — the drowning world, drawn for one player.
 * Pan/zoom/pinch, tap-to-select, targeting orders, doom telegraphs, and a
 * cold-open glow on the first settlement tile. Keeps the game's identity:
 * deep water, brass light, a map that visibly dies.
 */
import React, { useEffect, useRef } from 'react';
import { ARK_INFLUENCE_RADIUS, hexKey, hexToPixel, pixelToHex, totalUnits, type Tile } from '@tidehold/shared';
import { SKINS } from './config.js';
import { useSolo } from './store.js';

const HEX = 28;

const TERRAIN: Record<string, { color: string; edge: string }> = {
  ocean: { color: '#0b2e4f', edge: '#0a2843' },
  drowned: { color: '#164a66', edge: '#123e56' },
  coast: { color: '#c9b98a', edge: '#b3a276' },
  plains: { color: '#7d9c52', edge: '#6c8a45' },
  forest: { color: '#3f6d3f', edge: '#345d34' },
  hills: { color: '#8b7f5c', edge: '#79704f' },
  mountains: { color: '#7a7268', edge: '#6a635a' },
  peak: { color: '#cfd4d9', edge: '#b9bfc6' },
  ruins: { color: '#6e5a7a', edge: '#5d4c68' },
};
const BUILDING_ICON: Record<string, string> = {
  lumber_camp: '🪓', mine: '⛏️', farm: '🌾', port: '⚓', watchtower: '🗼', shrine: '🔱',
};

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, (n >> 16) + amt));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + amt));
  const b = Math.min(255, Math.max(0, (n & 0xff) + amt));
  return `rgb(${r},${g},${b})`;
}
function playerColor(id: string): string {
  if (id === 'you') return '#e0b64f';
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 62%, 62%)`;
}

export function SoloMapCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const targeting = useSolo((s) => s.targeting);
  const setTargeting = useSolo((s) => s.setTargeting);

  const cam = useRef({ x: 0, y: 0, scale: 1 });
  const centered = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef({ moved: 0, lastX: 0, lastY: 0, pinch: 0 });

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

    const corner = (i: number) => {
      const a = (Math.PI / 180) * (60 * i - 30);
      return { x: HEX * Math.cos(a), y: HEX * Math.sin(a) };
    };
    const hexPathAt = (px: number, py: number, s: number, inset = 0) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const c = corner(i);
        const k = (HEX - inset) / HEX;
        const x = px + c.x * k * s;
        const y = py + c.y * k * s;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
    };

    const draw = (now: number) => {
      if (disposed) return;
      const st = useSolo.getState();
      const { tiles, meta, me, players, armies, battles, myExpeditions, selected, startTile, coldOpenStep } = st;
      const d = dpr();
      const W = canvas.width;
      const Hpx = canvas.height;

      if (!centered.current && me) {
        const p = hexToPixel(me.ark, HEX);
        cam.current.x = p.x;
        cam.current.y = p.y;
        centered.current = true;
      }
      const { x: cx, y: cy, scale } = cam.current;
      const toScreen = (wx: number, wy: number) => ({ x: (wx - cx) * scale * d + W / 2, y: (wy - cy) * scale * d + Hpx / 2 });

      const grad = ctx.createRadialGradient(W / 2, Hpx * 0.9, 0, W / 2, Hpx * 0.9, Math.max(W, Hpx));
      grad.addColorStop(0, '#0a2843');
      grad.addColorStop(1, '#04121f');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, Hpx);

      if (!meta || tiles.length === 0) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const sc = scale * d;
      const margin = HEX * 2 * sc;
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.004);
      const skin = SKINS.find((s) => s.id === st.metaState.selectedSkin);

      const vis: { tile: Tile; x: number; y: number }[] = [];
      for (const tile of tiles) {
        const wp = hexToPixel(tile, HEX);
        const sp = toScreen(wp.x, wp.y);
        if (sp.x < -margin || sp.x > W + margin || sp.y < -margin || sp.y > Hpx + margin) continue;
        vis.push({ tile, x: sp.x, y: sp.y });
      }

      ctx.lineJoin = 'round';
      for (const { tile, x, y } of vis) {
        const t = TERRAIN[tile.terrain] ?? TERRAIN.plains;
        hexPathAt(x, y, sc);
        ctx.fillStyle = shade(t.color, (tile.elevation - 4) * 5);
        ctx.fill();
        if (sc > 0.5) {
          ctx.strokeStyle = t.edge;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        if (!tile.flooded && tile.elevation <= meta.tideLevel + 1) {
          hexPathAt(x, y, sc);
          ctx.fillStyle = `rgba(120,220,255,${0.16 + 0.22 * pulse})`;
          ctx.fill();
        } else if (!tile.flooded && tile.elevation === meta.tideLevel + 2) {
          hexPathAt(x, y, sc);
          ctx.fillStyle = 'rgba(120,200,255,0.10)';
          ctx.fill();
        }
        if (skin?.worldTint && !tile.flooded) {
          hexPathAt(x, y, sc);
          ctx.fillStyle = skin.worldTint;
          ctx.fill();
        }
        if (tile.ownerId) {
          hexPathAt(x, y, sc, 2.5);
          ctx.strokeStyle = playerColor(tile.ownerId);
          ctx.lineWidth = tile.ownerId === 'you' ? 2.6 : 1.8;
          ctx.stroke();
        }
      }

      // Cold-open glow on the start tile.
      if (startTile && coldOpenStep === 0 && me && me.resources) {
        const glowTile = tiles.find((t) => t.q === startTile.q && t.r === startTile.r);
        if (glowTile && !glowTile.ownerId) {
          const sp = toScreen(...pixelTuple(glowTile));
          hexPathAt(sp.x, sp.y, sc, -1);
          ctx.strokeStyle = `rgba(224,182,79,${0.55 + 0.45 * pulse})`;
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.fillStyle = `rgba(224,182,79,${0.12 + 0.12 * pulse})`;
          hexPathAt(sp.x, sp.y, sc);
          ctx.fill();
          if (sc > 0.5) {
            ctx.fillStyle = '#f3e6c0';
            ctx.font = `600 ${Math.round(11 * sc)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText('Settle here', sp.x, sp.y - HEX * 0.9 * sc);
          }
        }
      }

      // Buildings + ruins.
      if (sc > 0.45) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const { tile, x, y } of vis) {
          const size = Math.round(HEX * 0.82 * sc);
          if (tile.building) {
            ctx.font = `${size}px serif`;
            ctx.fillText(BUILDING_ICON[tile.building.type] ?? '?', x, y - 2 * sc);
            ctx.fillStyle = '#e0b64f';
            const pw = 3 * sc;
            for (let i = 0; i < tile.building.level; i++) ctx.fillRect(x - (tile.building.level * pw) / 2 + i * pw + 0.5, y + HEX * 0.42 * sc, pw - 1, 2.5 * sc);
          } else if ((tile.terrain === 'ruins' || tile.terrain === 'drowned') && (tile.ruinTier ?? 0) > 0) {
            ctx.globalAlpha = tile.terrain === 'drowned' ? 0.55 : 0.95;
            ctx.font = `${size}px serif`;
            ctx.fillText('🏛', x, y);
            ctx.globalAlpha = 1;
            if (tile.terrain === 'ruins' && (tile.garrison ?? 0) > 0 && sc > 0.7) {
              ctx.font = `bold ${Math.round(9 * sc)}px sans-serif`;
              ctx.fillStyle = '#ff8d7e';
              ctx.fillText(`⚔${tile.garrison}`, x, y + HEX * 0.55 * sc);
            }
          }
        }
      }

      // Arks.
      for (const p of players) {
        if (p.defeated) continue;
        const sp = toScreen(...pixelTuple(p.ark));
        if (sp.x < -margin || sp.x > W + margin || sp.y < -margin || sp.y > Hpx + margin) continue;
        const mine = p.id === 'you';
        const color = mine && skin ? skin.ark : playerColor(p.id);
        if (mine) {
          const radius = ARK_INFLUENCE_RADIUS[(me?.ark.level ?? 1) - 1] ?? 4;
          ctx.save();
          ctx.strokeStyle = 'rgba(224,182,79,0.32)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 6]);
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, (radius + 0.5) * HEX * Math.sqrt(3) * sc, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, HEX * 0.6 * sc, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(4,18,31,0.85)';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.font = `${Math.round(HEX * 0.72 * sc)}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⛵', sp.x, sp.y);
        if (sc > 0.55) {
          ctx.font = `600 ${Math.round(9.5 * sc)}px sans-serif`;
          ctx.fillStyle = color;
          ctx.fillText(mine ? 'You' : p.username, sp.x, sp.y + HEX * 1.02 * sc);
        }
      }

      // Armies.
      for (const army of armies) {
        const sp = toScreen(...pixelTuple(army));
        if (sp.x < -margin || sp.x > W + margin || sp.y < -margin || sp.y > Hpx + margin) continue;
        if (army.ownerId === 'you' && army.path.length > 0) {
          ctx.save();
          ctx.strokeStyle = 'rgba(232,241,245,0.5)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 5]);
          ctx.beginPath();
          ctx.moveTo(sp.x, sp.y);
          for (const step of army.path) {
            const ssp = toScreen(...pixelTuple(step));
            ctx.lineTo(ssp.x, ssp.y);
          }
          ctx.stroke();
          ctx.restore();
        }
        const r0 = HEX * 0.4 * sc;
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y - r0);
        ctx.lineTo(sp.x + r0 * 0.9, sp.y - r0 * 0.3);
        ctx.lineTo(sp.x + r0 * 0.7, sp.y + r0 * 0.7);
        ctx.lineTo(sp.x, sp.y + r0);
        ctx.lineTo(sp.x - r0 * 0.7, sp.y + r0 * 0.7);
        ctx.lineTo(sp.x - r0 * 0.9, sp.y - r0 * 0.3);
        ctx.closePath();
        ctx.fillStyle = 'rgba(4,18,31,0.9)';
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

      // Battles.
      for (const b of battles) {
        const sp = toScreen(...pixelTuple(b.target));
        ctx.save();
        ctx.strokeStyle = `rgba(224,96,79,${0.5 + 0.5 * pulse})`;
        ctx.lineWidth = 2.5;
        hexPathAt(sp.x, sp.y, sc, -2);
        ctx.stroke();
        const left = b.resolveTick - meta.tick;
        ctx.fillStyle = '#ff9d8e';
        ctx.font = `bold ${Math.round(10 * sc)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(left > 0 ? `⚔ ${left}` : '⚔', sp.x, sp.y - HEX * 1.1 * sc);
        ctx.restore();
      }

      // Expedition targets.
      for (const exp of myExpeditions) {
        const sp = toScreen(...pixelTuple(exp.target));
        const rr = HEX * 0.34 * sc * (0.85 + 0.3 * pulse);
        ctx.save();
        ctx.strokeStyle = 'rgba(100,220,220,0.9)';
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

      if (selected) {
        const sp = toScreen(...pixelTuple(selected));
        hexPathAt(sp.x, sp.y, sc, -1.5);
        ctx.strokeStyle = '#e0b64f';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    // --- interaction ---
    const toHex = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const d = dpr();
      const sx = (clientX - rect.left) * d;
      const sy = (clientY - rect.top) * d;
      const wx = (sx - canvas.width / 2) / (cam.current.scale * d) + cam.current.x;
      const wy = (sy - canvas.height / 2) / (cam.current.scale * d) + cam.current.y;
      return pixelToHex(wx, wy, HEX);
    };

    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      drag.current.moved = 0;
      drag.current.lastX = e.clientX;
      drag.current.lastY = e.clientY;
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        drag.current.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const move = (e: PointerEvent) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size === 1) {
        const dx = e.clientX - drag.current.lastX;
        const dy = e.clientY - drag.current.lastY;
        drag.current.moved += Math.abs(dx) + Math.abs(dy);
        drag.current.lastX = e.clientX;
        drag.current.lastY = e.clientY;
        cam.current.x -= dx / cam.current.scale;
        cam.current.y -= dy / cam.current.scale;
      } else if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (drag.current.pinch > 0) cam.current.scale = clamp(cam.current.scale * (dist / drag.current.pinch), 0.35, 3);
        drag.current.pinch = dist;
        drag.current.moved += 10;
      }
    };
    const up = (e: PointerEvent) => {
      const click = pointers.current.size === 1 && drag.current.moved < 6;
      pointers.current.delete(e.pointerId);
      drag.current.pinch = 0;
      if (!click) return;
      const hex = toHex(e.clientX, e.clientY);
      const s = useSolo.getState();
      const tile = s.tileMap.get(hexKey(hex.q, hex.r));
      if (!tile) return;
      const t = s.targeting;
      if (t) {
        s.setTargeting(null);
        if (t.kind === 'army_move' && t.armyId) s.moveArmy(t.armyId, tile.q, tile.r);
        else if (t.kind === 'army_attack' && t.armyId) s.attack(t.armyId, tile.q, tile.r);
        else if (t.kind === 'ark_move') s.moveArk(tile.q, tile.r);
        else if (t.kind === 'expedition') s.expedition(tile.q, tile.r);
      } else {
        s.selectTile(tile.q, tile.r);
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const d = dpr();
      const sx = (e.clientX - rect.left) * d;
      const sy = (e.clientY - rect.top) * d;
      const before = { x: (sx - canvas.width / 2) / (cam.current.scale * d) + cam.current.x, y: (sy - canvas.height / 2) / (cam.current.scale * d) + cam.current.y };
      cam.current.scale = clamp(cam.current.scale * Math.exp(-e.deltaY * 0.0012), 0.35, 3);
      const after = { x: (sx - canvas.width / 2) / (cam.current.scale * d) + cam.current.x, y: (sy - canvas.height / 2) / (cam.current.scale * d) + cam.current.y };
      cam.current.x += before.x - after.x;
      cam.current.y += before.y - after.y;
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useSolo.getState().setTargeting(null);
      const pan = 60 / cam.current.scale;
      if (e.key === 'ArrowLeft' || e.key === 'a') cam.current.x -= pan;
      if (e.key === 'ArrowRight' || e.key === 'd') cam.current.x += pan;
      if (e.key === 'ArrowUp' || e.key === 'w') cam.current.y -= pan;
      if (e.key === 'ArrowDown' || e.key === 's') cam.current.y += pan;
      if (e.key === '+' || e.key === '=') cam.current.scale = clamp(cam.current.scale * 1.15, 0.35, 3);
      if (e.key === '-' || e.key === '_') cam.current.scale = clamp(cam.current.scale / 1.15, 0.35, 3);
    };

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('keydown', key);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', key);
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} style={{ cursor: targeting ? 'crosshair' : 'grab' }} />
      {targeting && (
        <div className="targeting-bar">
          <span>{targeting.hint}</span>
          <button className="btn btn-ghost" onClick={() => setTargeting(null)}>Cancel</button>
        </div>
      )}
    </>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
function pixelTuple(c: { q: number; r: number }): [number, number] {
  const p = hexToPixel(c, HEX);
  return [p.x, p.y];
}
