// Walking in the building: a grid of the floor (shelves are walls), shortest paths along the aisles (Dijkstra,
// 8 directions), and the order to visit the items of a picking list (nearest first, then improved by 2-opt), from the
// preparation table and back.

import { obstacles, type Layout, type WarehouseConfig } from "./config";

export interface Pt { x: number; z: number }
const CELL = 0.2;          // m
const BODY = 0.15;         // a person keeps this far from the shelves

export interface Grid { cols: number; rows: number; blocked: Uint8Array; cell: number }

export function grid(c: WarehouseConfig, l: Layout): Grid {
  const cols = Math.max(1, Math.ceil(c.room.length / CELL)), rows = Math.max(1, Math.ceil(c.room.width / CELL));
  const blocked = new Uint8Array(cols * rows);
  for (const o of obstacles(c, l)) {
    const i0 = Math.max(0, Math.floor((o.x0 - BODY) / CELL)), i1 = Math.min(cols - 1, Math.floor((o.x1 + BODY - 1e-9) / CELL));
    const j0 = Math.max(0, Math.floor((o.z0 - BODY) / CELL)), j1 = Math.min(rows - 1, Math.floor((o.z1 + BODY - 1e-9) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) blocked[j * cols + i] = 1;
  }
  return { cols, rows, blocked, cell: CELL };
}

const cellOf = (g: Grid, p: Pt) => {
  const i = Math.min(g.cols - 1, Math.max(0, Math.floor(p.x / g.cell))), j = Math.min(g.rows - 1, Math.max(0, Math.floor(p.z / g.cell)));
  return j * g.cols + i;
};
const centre = (g: Grid, k: number): Pt => ({ x: ((k % g.cols) + 0.5) * g.cell, z: (Math.floor(k / g.cols) + 0.5) * g.cell });

/** The nearest walkable cell (a point drawn just inside a shelf is moved to the aisle) */
function walkable(g: Grid, k: number) {
  if (!g.blocked[k]) return k;
  const seen = new Set([k]); const q = [k];
  while (q.length) {
    const c = q.shift()!;
    for (const n of neighbours(g, c, false)) {
      if (seen.has(n[0])) continue;
      if (!g.blocked[n[0]]) return n[0];
      seen.add(n[0]); q.push(n[0]);
    }
  }
  return k;
}

function* neighbours(g: Grid, k: number, onlyFree = true): Generator<[number, number]> {
  const i = k % g.cols, j = Math.floor(k / g.cols);
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    if (!di && !dj) continue;
    const ni = i + di, nj = j + dj;
    if (ni < 0 || nj < 0 || ni >= g.cols || nj >= g.rows) continue;
    const nk = nj * g.cols + ni;
    if (onlyFree) {
      if (g.blocked[nk]) continue;
      // no corner cutting through a shelf
      if (di && dj && (g.blocked[j * g.cols + ni] || g.blocked[nj * g.cols + i])) continue;
    }
    yield [nk, di && dj ? Math.SQRT2 : 1];
  }
}

/** Distances (in cells) and the way back from one cell to every other one */
function dijkstra(g: Grid, from: number) {
  const dist = new Float64Array(g.cols * g.rows).fill(Infinity), prev = new Int32Array(g.cols * g.rows).fill(-1);
  const heap: [number, number][] = [[0, from]]; dist[from] = 0;
  const push = (e: [number, number]) => { heap.push(e); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const a = 2 * i + 1, b = a + 1; let m = i; if (a < heap.length && heap[a][0] < heap[m][0]) m = a; if (b < heap.length && heap[b][0] < heap[m][0]) m = b; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  while (heap.length) {
    const [d, k] = pop();
    if (d > dist[k]) continue;
    for (const [n, w] of neighbours(g, k)) if (d + w < dist[n]) { dist[n] = d + w; prev[n] = k; push([d + w, n]); }
  }
  return { dist, prev };
}

/** Removes the points in the middle of straight lines */
function simplify(pts: Pt[]) {
  return pts.filter((p, i) => {
    if (i === 0 || i === pts.length - 1) return true;
    const a = pts[i - 1], b = pts[i + 1];
    return Math.abs((p.x - a.x) * (b.z - p.z) - (p.z - a.z) * (b.x - p.x)) > 1e-9;
  });
}

export interface Route<T> { stops: T[]; length: number; path: Pt[]; unreachable: T[] }

/**
 * The order to collect `stops` (each with the point of the aisle where it is taken), starting from `start` and
 * coming back to it, and the path to walk. Stops that cannot be reached are listed apart.
 */
export function route<T extends { at: Pt }>(g: Grid, start: Pt, stops: T[]): Route<T> {
  const nodes = [walkable(g, cellOf(g, start)), ...stops.map((s) => walkable(g, cellOf(g, s.at)))];
  const runs = nodes.map((k) => dijkstra(g, k));
  const d = (a: number, b: number) => runs[a].dist[nodes[b]];
  const reach = stops.map((_, i) => Number.isFinite(d(0, i + 1)));
  let order = stops.map((_, i) => i + 1).filter((n) => reach[n - 1]);
  // nearest first
  const left = new Set(order); order = []; let at = 0;
  while (left.size) { let best = -1, bd = Infinity; for (const n of left) if (d(at, n) < bd) { bd = d(at, n); best = n; } order.push(best); left.delete(best); at = best; }
  // 2-opt on the round trip 0 → … → 0
  const tour = () => [0, ...order, 0];
  const len = (t: number[]) => t.slice(1).reduce((a, n, i) => a + d(t[i], n), 0);
  let improved = order.length > 2;
  while (improved) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) for (let j = i + 1; j < order.length; j++) {
      const t = tour(), cand = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
      if (len([0, ...cand, 0]) + 1e-9 < len(t)) { order = cand; improved = true; }
    }
  }
  // the path, cell by cell
  const cells: number[] = [];
  const t = tour();
  for (let s = 0; s < t.length - 1; s++) {
    const seg: number[] = []; let k = nodes[t[s + 1]];
    while (k !== -1 && k !== nodes[t[s]]) { seg.push(k); k = runs[t[s]].prev[k]; }
    seg.push(nodes[t[s]]); seg.reverse();
    cells.push(...(s ? seg.slice(1) : seg));
  }
  return {
    stops: order.map((n) => stops[n - 1]),
    length: len(t) * g.cell,
    path: simplify(cells.map((k) => centre(g, k))),
    unreachable: stops.filter((_, i) => !reach[i]),
  };
}

/** The way from one point to another along the aisles (one way), or null when it cannot be reached */
export function walk(g: Grid, from: Pt, to: Pt): { path: Pt[]; length: number } | null {
  const a = walkable(g, cellOf(g, from)), b = walkable(g, cellOf(g, to));
  const { dist, prev } = dijkstra(g, a);
  if (!Number.isFinite(dist[b])) return null;
  const cells: number[] = [];
  for (let k = b; k !== -1; k = k === a ? -1 : prev[k]) cells.push(k);
  return { path: simplify(cells.reverse().map((k) => centre(g, k))), length: dist[b] * g.cell };
}
