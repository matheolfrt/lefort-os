// The configuration of a building (stored in warehouses.config): nothing about the building is written in the code.
// Room, shelf size, levels, capacity per level, aisle width, racks and their shelves, work zones, status colours.
// readConfig() accepts anything and returns a valid configuration (defaults for what is missing or wrong), and
// layout() turns it into positions on the floor, so the 3D view, the paths and the tests share one geometry.

export type ZoneKind = "reception" | "photo" | "shipping" | "custom";
export interface PhotoFeatures { backdrop: boolean; table: boolean; lights: boolean; mannequin: boolean; measure: boolean }
export interface Zone {
  id: string; kind: ZoneKind; label: string;
  x: number; z: number; w: number; d: number;     // floor rectangle, m (x along the length, z along the width)
  locations: string[];                            // staging locations shown in this zone (EMP-RECEPTION…)
  features?: PhotoFeatures;
}
export interface Rack { code: string; shelves: number; x?: number; z?: number; rot?: 0 | 90 }
export interface StatusColors { available: string; reserved: string; sold: string; problem: string; progress: string; empty: string }
export interface WarehouseConfig {
  room: { length: number; width: number; height: number };
  shelf: { width: number; depth: number; height: number; levels: number; perLevel: number };
  aisle: number;                                  // free width between two rows of shelves, m
  racks: Rack[];
  zones: Zone[];
  colors: StatusColors;
}

export const rackCode = (i: number) => {
  // A … Z, then AA, AB …
  let s = "", n = i + 1;
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

export const DEFAULT_COLORS: StatusColors = {
  available: "#22a06b", reserved: "#e2b203", sold: "#3b82f6", problem: "#e5484d", progress: "#8e8cf5", empty: "#9aa1ab",
};

/** 200 m², 35 shelves of 120 × 60 × 200 cm with 5 levels of 24 blazers: 4 200 places */
export const DEFAULT_CONFIG: WarehouseConfig = {
  room: { length: 20, width: 10, height: 3.5 },
  shelf: { width: 1.2, depth: 0.6, height: 2.0, levels: 5, perLevel: 24 },
  aisle: 1.2,
  racks: Array.from({ length: 5 }, (_, i) => ({ code: rackCode(i), shelves: 7 })),
  zones: [
    { id: "reception", kind: "reception", label: "Réception / Tri", x: 11.5, z: 0.5, w: 4, d: 4,
      locations: ["EMP-RECEPTION", "EMP-RETOURS", "EMP-RETOUCHES", "EMP-ECARTS"] },
    { id: "photo", kind: "photo", label: "Photo studio", x: 16, z: 0.5, w: 3.5, d: 4.5,
      locations: ["EMP-ATTENTE-PHOTO", "EMP-ATTENTE-MESURES", "EMP-A-RANGER"],
      features: { backdrop: true, table: true, lights: true, mannequin: true, measure: true } },
    { id: "shipping", kind: "shipping", label: "Préparation / Expédition", x: 11.5, z: 5.5, w: 8, d: 4,
      locations: ["EMP-PREPARATION"] },
  ],
  colors: DEFAULT_COLORS,
};

const num = (v: unknown, min: number, max: number, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : d);
const hex = (v: unknown, d: string) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : d);

/** Any stored value → a valid configuration */
export function readConfig(raw: unknown): WarehouseConfig {
  const c = (raw ?? {}) as Partial<WarehouseConfig> & Record<string, unknown>;
  const D = DEFAULT_CONFIG;
  const room = { length: num(c.room?.length, 2, 300, D.room.length), width: num(c.room?.width, 2, 300, D.room.width), height: num(c.room?.height, 2, 20, D.room.height) };
  const shelf = {
    width: num(c.shelf?.width, 0.3, 5, D.shelf.width), depth: num(c.shelf?.depth, 0.2, 3, D.shelf.depth),
    height: num(c.shelf?.height, 0.5, 10, D.shelf.height), levels: Math.round(num(c.shelf?.levels, 1, 50, D.shelf.levels)),
    perLevel: Math.round(num(c.shelf?.perLevel, 1, 1000, D.shelf.perLevel)),
  };
  const seen = new Set<string>();
  const racks = (Array.isArray(c.racks) ? c.racks : D.racks).slice(0, 200).flatMap((r) => {
    const code = typeof r?.code === "string" ? r.code.toUpperCase() : "";
    if (!/^[A-Z]{1,3}$/.test(code) || seen.has(code)) return [];
    seen.add(code);
    const out: Rack = { code, shelves: Math.round(num(r.shelves, 1, 999, 1)) };
    if (typeof r.x === "number" && typeof r.z === "number") { out.x = r.x; out.z = r.z; out.rot = r.rot === 90 ? 90 : 0; }
    return [out];
  });
  const zones = (Array.isArray(c.zones) ? c.zones : D.zones).slice(0, 50).flatMap((z, i) => {
    if (!z || typeof z !== "object") return [];
    const kind: ZoneKind = ["reception", "photo", "shipping", "custom"].includes(z.kind) ? z.kind : "custom";
    return [{
      id: typeof z.id === "string" && z.id ? z.id : `zone-${i + 1}`, kind,
      label: typeof z.label === "string" && z.label.trim() ? z.label.trim().slice(0, 40) : "Zone",
      x: num(z.x, 0, 300, 0), z: num(z.z, 0, 300, 0), w: num(z.w, 0.5, 300, 3), d: num(z.d, 0.5, 300, 3),
      locations: Array.isArray(z.locations) ? z.locations.filter((s): s is string => typeof s === "string").slice(0, 30) : [],
      ...(kind === "photo" ? { features: { backdrop: z.features?.backdrop !== false, table: z.features?.table !== false, lights: z.features?.lights !== false,
        mannequin: z.features?.mannequin !== false, measure: z.features?.measure !== false } } : {}),
    } as Zone];
  });
  const col = (c.colors ?? {}) as Partial<StatusColors>;
  const colors = Object.fromEntries((Object.keys(DEFAULT_COLORS) as (keyof StatusColors)[]).map((k) => [k, hex(col[k], DEFAULT_COLORS[k])])) as unknown as StatusColors;
  return { room, shelf, aisle: num(c.aisle, 0.6, 10, D.aisle), racks, zones, colors };
}

/** What the building holds in theory */
export function capacity(c: WarehouseConfig) {
  const shelves = c.racks.reduce((a, r) => a + r.shelves, 0);
  return { racks: c.racks.length, shelves, levels: shelves * c.shelf.levels, perShelf: c.shelf.levels * c.shelf.perLevel, places: shelves * c.shelf.levels * c.shelf.perLevel };
}

/** `n` racks of `shelves` shelves each, named A, B, C… (keeps the positions of the racks that stay) */
export function withRacks(c: WarehouseConfig, n: number, shelves: number): WarehouseConfig {
  return { ...c, racks: Array.from({ length: Math.max(0, Math.min(200, n)) }, (_, i) => ({ ...(c.racks[i] ?? {}), code: rackCode(i), shelves })) };
}

// ── Geometry ────────────────────────────────────────────────────────────────────────────────────────────────────
export interface PlacedShelf { rack: string; no: number; id: string; x: number; z: number; rot: 0 | 90; aisleSide: 1 | -1 }
export interface PlacedRack { code: string; x: number; z: number; rot: 0 | 90; length: number; shelves: PlacedShelf[]; auto: boolean }
export interface Layout { racks: PlacedRack[]; shelves: Map<string, PlacedShelf>; warnings: string[] }

export const shelfId = (rack: string, no: number) => `${rack}-${String(no).padStart(2, "0")}`;
export const levelId = (rack: string, no: number, level: number) => `${shelfId(rack, no)}-L${level}`;

/**
 * Where everything stands. A rack is a row of shelves side by side. Racks without a position are placed
 * automatically: rows along the length, from the back wall, each followed by an aisle, in the part of the room the
 * zones leave free; a row too long for the room is reported, never silently cut.
 */
export function layout(c: WarehouseConfig): Layout {
  const { width: sw, depth: sd } = c.shelf;
  const warnings: string[] = [];
  // the free band: from the wall to the first zone along the length
  const zoneStart = c.zones.length ? Math.min(...c.zones.map((z) => z.x)) : c.room.length;
  const usable = Math.max(sw, Math.min(c.room.length, zoneStart) - 0.5);
  let row = 0;
  const racks: PlacedRack[] = c.racks.map((r) => {
    const length = r.shelves * sw;
    let x: number, z: number, rot: 0 | 90, auto = false;
    if (r.x != null && r.z != null) { x = r.x; z = r.z; rot = r.rot ?? 0; }
    else {
      auto = true; rot = 0;
      x = 0.5; z = 0.3 + row * (sd + c.aisle);
      row++;
      if (length > usable + 1e-6) warnings.push(`Rack ${r.code} : ${r.shelves} étagères (${(length).toFixed(1)} m) dépassent la place libre (${usable.toFixed(1)} m).`);
      if (z + sd > c.room.width + 1e-6) warnings.push(`Rack ${r.code} : plus de place dans la largeur du local (${c.room.width} m).`);
    }
    const shelves: PlacedShelf[] = Array.from({ length: r.shelves }, (_, i) => {
      const along = i * sw + sw / 2;
      const cx = rot === 0 ? x + along : x + sd / 2, cz = rot === 0 ? z + sd / 2 : z + along;
      return { rack: r.code, no: i + 1, id: shelfId(r.code, i + 1), x: cx, z: cz, rot, aisleSide: 1 };
    });
    return { code: r.code, x, z, rot, length, shelves, auto };
  });
  const shelves = new Map<string, PlacedShelf>();
  for (const r of racks) for (const s of r.shelves) shelves.set(s.id, s);
  return { racks, shelves, warnings };
}

/** Height of the board of a level (1 = the lowest) */
export const levelY = (c: WarehouseConfig, level: number) => 0.1 + ((level - 1) * (c.shelf.height - 0.15)) / Math.max(1, c.shelf.levels - 1);

/** Centre of a slot (1 … perLevel) on a level of a shelf, on top of its board */
export function slotPoint(c: WarehouseConfig, s: PlacedShelf, level: number, position: number) {
  const n = c.shelf.perLevel, step = (c.shelf.width - 0.06) / n;
  const along = -c.shelf.width / 2 + 0.03 + step * (Math.min(Math.max(position, 1), n) - 0.5);
  const y = levelY(c, level) + 0.02;
  return s.rot === 0 ? { x: s.x + along, y, z: s.z } : { x: s.x, y, z: s.z + along };
}

/** The point of the aisle in front of a shelf, where one stands to take an item */
export function frontPoint(c: WarehouseConfig, s: PlacedShelf) {
  const off = c.shelf.depth / 2 + Math.min(0.45, c.aisle / 2);
  return s.rot === 0 ? { x: s.x, z: s.z + off } : { x: s.x + off, z: s.z };
}

/** Rectangles of the floor that one cannot walk through (the shelves) */
export function obstacles(c: WarehouseConfig, l: Layout) {
  const out: { x0: number; x1: number; z0: number; z1: number }[] = [];
  for (const r of l.racks) {
    const len = r.length, sd = c.shelf.depth;
    out.push(r.rot === 0 ? { x0: r.x, x1: r.x + len, z0: r.z, z1: r.z + sd } : { x0: r.x, x1: r.x + sd, z0: r.z, z1: r.z + len });
  }
  return out;
}
