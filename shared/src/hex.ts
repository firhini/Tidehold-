/**
 * Axial hex-grid math (pointy-top). Pure functions only.
 * See https://www.redblobgames.com/grids/hexagons/ for the conventions used.
 */
import type { AxialCoord } from './types.js';

export const HEX_DIRECTIONS: AxialCoord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function hexKey(q: number, r: number): string {
  return `${q},${r}`;
}

export function hexEquals(a: AxialCoord, b: AxialCoord): boolean {
  return a.q === b.q && a.r === b.r;
}

export function hexAdd(a: AxialCoord, b: AxialCoord): AxialCoord {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function hexNeighbors(c: AxialCoord): AxialCoord[] {
  return HEX_DIRECTIONS.map((d) => hexAdd(c, d));
}

export function hexDistance(a: AxialCoord, b: AxialCoord): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** All coordinates within `radius` of the origin (a filled hexagon). */
export function hexSpiral(center: AxialCoord, radius: number): AxialCoord[] {
  const out: AxialCoord[] = [];
  for (let q = -radius; q <= radius; q++) {
    const rMin = Math.max(-radius, -q - radius);
    const rMax = Math.min(radius, -q + radius);
    for (let r = rMin; r <= rMax; r++) {
      out.push({ q: center.q + q, r: center.r + r });
    }
  }
  return out;
}

/** The ring of coordinates exactly `radius` away from center. */
export function hexRing(center: AxialCoord, radius: number): AxialCoord[] {
  if (radius === 0) return [{ ...center }];
  const out: AxialCoord[] = [];
  let cur = hexAdd(center, { q: HEX_DIRECTIONS[4].q * radius, r: HEX_DIRECTIONS[4].r * radius });
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      out.push(cur);
      cur = hexAdd(cur, HEX_DIRECTIONS[side]);
    }
  }
  return out;
}

/** Straight-line hex interpolation between two coords (inclusive of both ends). */
export function hexLine(a: AxialCoord, b: AxialCoord): AxialCoord[] {
  const n = hexDistance(a, b);
  if (n === 0) return [{ ...a }];
  const out: AxialCoord[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const q = a.q + (b.q - a.q) * t;
    const r = a.r + (b.r - a.r) * t;
    out.push(hexRound(q, r));
  }
  return out;
}

/** Round fractional axial coords to the nearest hex. */
export function hexRound(qf: number, rf: number): AxialCoord {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

/** Pixel position of a hex center (pointy-top), for rendering and worldgen noise. */
export function hexToPixel(c: AxialCoord, size: number): { x: number; y: number } {
  const x = size * (Math.sqrt(3) * c.q + (Math.sqrt(3) / 2) * c.r);
  const y = size * (3 / 2) * c.r;
  return { x, y };
}

export function pixelToHex(x: number, y: number, size: number): AxialCoord {
  const q = ((Math.sqrt(3) / 3) * x - (1 / 3) * y) / size;
  const r = ((2 / 3) * y) / size;
  return hexRound(q, r);
}

/**
 * A* pathfinding over hexes.
 * `cost(coord)` returns the tick-cost of entering a hex, or Infinity if impassable.
 * Returns the path excluding `start`, including `goal`; null if unreachable.
 */
export function hexPath(
  start: AxialCoord,
  goal: AxialCoord,
  cost: (c: AxialCoord) => number,
  maxExpansions = 4000,
): AxialCoord[] | null {
  const startKey = hexKey(start.q, start.r);
  const goalKey = hexKey(goal.q, goal.r);
  if (startKey === goalKey) return [];

  const open: { c: AxialCoord; f: number }[] = [{ c: start, f: 0 }];
  const gScore = new Map<string, number>([[startKey, 0]]);
  const cameFrom = new Map<string, AxialCoord>();
  const closed = new Set<string>();
  let expansions = 0;

  while (open.length > 0 && expansions < maxExpansions) {
    // Binary-heap-free priority pop; open sets stay small at our map sizes.
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bestIdx].f) bestIdx = i;
    const { c: current } = open.splice(bestIdx, 1)[0];
    const curKey = hexKey(current.q, current.r);
    if (curKey === goalKey) {
      const path: AxialCoord[] = [current];
      let k = curKey;
      while (cameFrom.has(k)) {
        const prev = cameFrom.get(k)!;
        const pk = hexKey(prev.q, prev.r);
        if (pk === startKey) break;
        path.push(prev);
        k = pk;
      }
      return path.reverse();
    }
    if (closed.has(curKey)) continue;
    closed.add(curKey);
    expansions++;

    for (const nb of hexNeighbors(current)) {
      const nbKey = hexKey(nb.q, nb.r);
      if (closed.has(nbKey)) continue;
      const stepCost = cost(nb);
      if (!Number.isFinite(stepCost)) continue;
      const tentative = (gScore.get(curKey) ?? Infinity) + stepCost;
      if (tentative < (gScore.get(nbKey) ?? Infinity)) {
        gScore.set(nbKey, tentative);
        cameFrom.set(nbKey, current);
        open.push({ c: nb, f: tentative + hexDistance(nb, goal) });
      }
    }
  }
  return null;
}
