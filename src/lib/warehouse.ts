// « Mon futur local » : a room seen from above (x along its width, z along its length, in metres, origin at a corner)
// and the shelves placed in it. Pure functions shared by the 3D page and its tests: where a shelf stands, whether it
// fits, whether it touches another one, how wide the aisles are, and what the whole plan holds.

export interface Room { w: number; d: number; h: number }   // width, length (depth), ceiling height, m
export interface Shelf {
  id: string;
  x: number; z: number;     // centre on the floor, m
  rot: 0 | 90;              // 0: the 120 cm side along x
  w: number; d: number; h: number; levels: number;
}

/** The shelf of the brief: 5 levels, 60 deep × 120 wide × 200 high */
export const SHELF = { w: 1.2, d: 0.6, h: 2.0, levels: 5 } as const;
/** 200 m², a common shape for a small warehouse */
export const DEFAULT_ROOM: Room = { w: 20, d: 10, h: 3.5 };
/** Below this, a person with a box cannot pass between two shelves */
export const MIN_AISLE = 0.9;
/** The aisle left in front of a shelf placed automatically (a row added, « Ajouter une étagère ») */
export const AISLE = 1.0;
/** Positions snap to this step (5 cm) */
export const STEP = 0.05;

const EPS = 1e-6;
export const snap = (v: number) => Number((Math.round(v / STEP) * STEP).toFixed(2));

export interface Rect { x0: number; x1: number; z0: number; z1: number }
/** The floor a shelf takes */
export function rect(s: Pick<Shelf, "x" | "z" | "rot" | "w" | "d">): Rect {
  const sx = s.rot === 90 ? s.d : s.w, sz = s.rot === 90 ? s.w : s.d;
  return { x0: s.x - sx / 2, x1: s.x + sx / 2, z0: s.z - sz / 2, z1: s.z + sz / 2 };
}
const overlap = (a: Rect, b: Rect) => a.x0 < b.x1 - EPS && b.x0 < a.x1 - EPS && a.z0 < b.z1 - EPS && b.z0 < a.z1 - EPS;

export const inside = (room: Room, s: Shelf) => {
  const r = rect(s);
  return r.x0 >= -EPS && r.z0 >= -EPS && r.x1 <= room.w + EPS && r.z1 <= room.d + EPS && s.h <= room.h + EPS;
};
/** Shelves that `s` would run into (back to back is allowed: touching is not overlapping) */
export const collisions = (s: Shelf, all: Shelf[]) => all.filter((o) => o.id !== s.id && overlap(rect(s), rect(o)));
export const fits = (room: Room, s: Shelf, all: Shelf[]) => inside(room, s) && collisions(s, all).length === 0;

/** Keeps a shelf inside the room, on the 5 cm grid */
export function clampToRoom(room: Room, s: Shelf): Shelf {
  const r = rect(s);
  const hx = (r.x1 - r.x0) / 2, hz = (r.z1 - r.z0) / 2;
  return { ...s, x: snap(Math.min(Math.max(s.x, hx), room.w - hx)), z: snap(Math.min(Math.max(s.z, hz), room.d - hz)) };
}

let seq = 0;
export const newId = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * Whether a shelf placed automatically keeps an aisle with the others: side by side or back to back with a shelf of the
 * same row is fine, but in front of another one there must be at least AISLE of free floor.
 */
function keepsAisle(s: Shelf, all: Shelf[]) {
  const r = rect(s);
  const front = s.rot === 90 ? { ...r, x0: r.x0 - AISLE, x1: r.x1 + AISLE } : { ...r, z0: r.z0 - AISLE, z1: r.z1 + AISLE };
  return all.every((o) => {
    if (o.id === s.id) return true;
    const b = rect(o);
    if (!overlap(front, b)) return true;
    // the same row: in line with it (side by side), or back to back (touching on the depth side)
    if (o.rot !== s.rot || overlap(r, b)) return false;
    return s.rot === 90
      ? Math.abs(b.x0 - r.x1) < EPS || Math.abs(r.x0 - b.x1) < EPS || (Math.abs(b.x0 - r.x0) < EPS && Math.abs(b.x1 - r.x1) < EPS)
      : Math.abs(b.z0 - r.z1) < EPS || Math.abs(r.z0 - b.z1) < EPS || (Math.abs(b.z0 - r.z0) < EPS && Math.abs(b.z1 - r.z1) < EPS);
  });
}

/** A new shelf at the first free place, scanning from the back wall, next to the others or a full aisle away */
export function freeSpot(room: Room, all: Shelf[], rot: 0 | 90 = 0): Shelf | null {
  const base = { id: newId(), rot, ...SHELF } as Shelf;
  const r = rect({ ...base, x: 0, z: 0 });
  const sx = r.x1 - r.x0, sz = r.z1 - r.z0;
  for (let z = sz / 2; z <= room.d - sz / 2 + EPS; z += STEP) {
    for (let x = sx / 2; x <= room.w - sx / 2 + EPS; x += STEP) {
      const s = { ...base, x: snap(x), z: snap(z) };
      if (fits(room, s, all) && keepsAisle(s, all)) return s;
    }
  }
  return null;
}

/** A row of `n` shelves side by side (and, `double`, a second row back to back), starting at the first place it fits */
export function row(room: Room, all: Shelf[], n: number, double = false): Shelf[] {
  const depth = double ? SHELF.d * 2 : SHELF.d;
  const length = n * SHELF.w;
  for (let z = depth / 2; z <= room.d - depth / 2 + EPS; z += STEP) {
    for (let x = length / 2; x <= room.w - length / 2 + EPS; x += STEP) {
      const made: Shelf[] = [];
      for (let i = 0; i < n; i++) {
        const cx = snap(x - length / 2 + SHELF.w * (i + 0.5));
        if (double) {
          made.push({ id: newId(), rot: 0, ...SHELF, x: cx, z: snap(z - SHELF.d / 2) });
          made.push({ id: newId(), rot: 0, ...SHELF, x: cx, z: snap(z + SHELF.d / 2) });
        } else made.push({ id: newId(), rot: 0, ...SHELF, x: cx, z: snap(z) });
      }
      // the row fits, and leaves an aisle in front of (and behind) the other rows
      if (made.every((s) => inside(room, s) && collisions(s, all).length === 0 && keepsAisle(s, all))) return made;
    }
  }
  return [];
}

export interface Aisle { a: string; b: string; width: number }
/** Gaps narrower than MIN_AISLE between two shelves that face each other (and not back to back) */
export function narrowAisles(all: Shelf[]): Aisle[] {
  const out: Aisle[] = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = rect(all[i]), b = rect(all[j]);
      const sharesX = a.x0 < b.x1 - EPS && b.x0 < a.x1 - EPS;
      const sharesZ = a.z0 < b.z1 - EPS && b.z0 < a.z1 - EPS;
      const gap = sharesX ? Math.max(b.z0 - a.z1, a.z0 - b.z1) : sharesZ ? Math.max(b.x0 - a.x1, a.x0 - b.x1) : Infinity;
      // touching (back to back or side by side) is a choice, not an aisle
      if (gap > EPS && gap < MIN_AISLE - EPS) out.push({ a: all[i].id, b: all[j].id, width: gap });
    }
  }
  return out;
}

export interface PlanStats {
  shelves: number; levels: number;
  shelfMetres: number;   // length of all the levels put end to end, m
  floorUsed: number;     // m² under the shelves
  floorPct: number;      // of the room
  area: number;          // m² of the room
}
export function stats(room: Room, all: Shelf[]): PlanStats {
  const area = room.w * room.d;
  const floorUsed = all.reduce((a, s) => a + s.w * s.d, 0);
  return {
    shelves: all.length,
    levels: all.reduce((a, s) => a + s.levels, 0),
    shelfMetres: all.reduce((a, s) => a + s.w * s.levels, 0),
    floorUsed, floorPct: area > 0 ? (floorUsed * 100) / area : 0, area,
  };
}

/** A saved plan, checked: anything outside the expected shapes is dropped rather than drawn wrong */
export function readPlan(raw: unknown): { room: Room; shelves: Shelf[] } {
  const p = (raw ?? {}) as { room?: Partial<Room>; shelves?: Partial<Shelf>[] };
  const num = (v: unknown, min: number, max: number, dflt: number) => (typeof v === "number" && v >= min && v <= max ? v : dflt);
  const room: Room = { w: num(p.room?.w, 2, 200, DEFAULT_ROOM.w), d: num(p.room?.d, 2, 200, DEFAULT_ROOM.d), h: num(p.room?.h, 2, 20, DEFAULT_ROOM.h) };
  const shelves = (Array.isArray(p.shelves) ? p.shelves : []).slice(0, 2000).flatMap((s) => (
    typeof s?.x === "number" && typeof s?.z === "number"
      ? [{ id: typeof s.id === "string" ? s.id : newId(), x: s.x, z: s.z, rot: s.rot === 90 ? 90 : 0,
           w: num(s.w, 0.2, 5, SHELF.w), d: num(s.d, 0.2, 5, SHELF.d), h: num(s.h, 0.3, 10, SHELF.h), levels: Math.round(num(s.levels, 1, 20, SHELF.levels)) } as Shelf]
      : []));
  return { room, shelves };
}
