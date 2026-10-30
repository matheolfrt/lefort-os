// The building with its stock: the answer of warehouse_snapshot / warehouse_heat read into plain objects, the status
// groups (colour AND words), the figures of the header, and the « Performance » values shelf by shelf.

import type { ItemStatus } from "@/lib/types";
import { layout, readConfig, shelfId, type Layout, type StatusColors, type WarehouseConfig } from "./config";

export interface LevelLoc { id: string; rack: string; shelf: number; level: number; capacity: number; code: string }
export interface StagingLoc { id: string; code: string; label: string | null; autoFor: ItemStatus | null }
export interface WItem {
  id: string; sku: string; status: ItemStatus; loc: string | null; pos: number | null;
  receivedAt: string; listedAt: string | null; priceCents: number | null; costCents: number | null; brand: string | null; size: string | null;
}
export interface Snapshot {
  warehouse: { id: string; name: string; config: WarehouseConfig; updatedAt: string };
  manager: boolean; deadStockDays: number; rotationDays: number | null; toShip: number;
  levels: LevelLoc[]; staging: StagingLoc[]; items: WItem[];
  // indexes
  levelById: Map<string, LevelLoc>; levelBySlot: Map<string, LevelLoc>; levelByCode: Map<string, LevelLoc>; stagingById: Map<string, StagingLoc>;
  itemsByLoc: Map<string, WItem[]>; itemBySku: Map<string, WItem>; layout: Layout;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function readSnapshot(raw: any): Snapshot {
  const config = readConfig(raw?.warehouse?.config);
  const levels: LevelLoc[] = (raw?.levels ?? []).map((l: any[]) => ({ id: l[0], rack: l[1], shelf: l[2], level: l[3], capacity: l[4] ?? config.shelf.perLevel, code: l[5] ?? "" }));
  const staging: StagingLoc[] = (raw?.staging ?? []).map((s: any[]) => ({ id: s[0], code: s[1], label: s[2], autoFor: s[3] }));
  const items: WItem[] = (raw?.items ?? []).map((i: any[]) => ({
    id: i[0], sku: i[1], status: i[2], loc: i[3], pos: i[4], receivedAt: i[5], listedAt: i[6],
    priceCents: i[7] == null ? null : Number(i[7]), costCents: i[8] == null ? null : Number(i[8]), brand: i[9], size: i[10],
  }));
  const itemsByLoc = new Map<string, WItem[]>();
  for (const it of items) if (it.loc) (itemsByLoc.get(it.loc) ?? itemsByLoc.set(it.loc, []).get(it.loc)!).push(it);
  return {
    warehouse: { id: raw?.warehouse?.id, name: raw?.warehouse?.name ?? "Entrepôt", config, updatedAt: raw?.warehouse?.updated_at },
    manager: !!raw?.manager, deadStockDays: Number(raw?.dead_stock_days ?? 90),
    rotationDays: raw?.rotation_days == null ? null : Number(raw.rotation_days), toShip: Number(raw?.to_ship ?? 0),
    levels, staging, items,
    levelById: new Map(levels.map((l) => [l.id, l])),
    levelBySlot: new Map(levels.map((l) => [`${shelfId(l.rack, l.shelf)}-L${l.level}`, l])),
    levelByCode: new Map(levels.map((l) => [l.code, l])),
    stagingById: new Map(staging.map((s) => [s.id, s])),
    itemsByLoc, itemBySku: new Map(items.map((i) => [i.sku.toUpperCase(), i])),
    layout: layout(config),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Status groups: a colour, a word and a letter (the colour is never the only sign) ────────────────────────────
export type Group = keyof StatusColors;
export const GROUPS: { id: Group; label: string; letter: string; help: string }[] = [
  { id: "available", label: "Disponible", letter: "D", help: "Prêt à publier ou en ligne" },
  { id: "reserved", label: "Réservé / en préparation", letter: "R", help: "Réservé sur Vinted, ou vendu et déjà sur la table de préparation" },
  { id: "sold", label: "Vendu / à expédier", letter: "V", help: "Vendu, encore sur son étagère : à préparer" },
  { id: "problem", label: "Action requise", letter: "!", help: "En attente, retourné ou écarté" },
  { id: "progress", label: "En atelier", letter: "A", help: "Reçu, trié, photographié ou mesuré : pas encore rangé" },
  { id: "empty", label: "Emplacement vide", letter: "·", help: "Place libre sur un niveau" },
];
export function groupOf(it: Pick<WItem, "status" | "loc">, prepId: string | null): Group {
  switch (it.status) {
    case "listing_ready": case "listed": return "available";
    case "reserved": return "reserved";
    case "sold": return it.loc && it.loc === prepId ? "reserved" : "sold";
    case "on_hold": case "returned": case "rejected": return "problem";
    default: return "progress";
  }
}

// ── The figures of the header ────────────────────────────────────────────────────────────────────────────────
export function kpis(s: Snapshot, now = Date.now()) {
  const inStock = s.items.filter((i) => i.status !== "sold");
  const available = s.items.filter((i) => i.status === "listing_ready" || i.status === "listed");
  const dead = now - s.deadStockDays * 86_400_000;
  return {
    stock: inStock.length,
    value: s.manager ? inStock.reduce((a, i) => a + (i.costCents ?? 0), 0) : null,
    available: available.length,
    toShip: s.toShip,
    dormant: available.filter((i) => new Date(i.listedAt ?? i.receivedAt).getTime() < dead).length,
    rotationDays: s.rotationDays,
    places: s.levels.reduce((a, l) => a + l.capacity, 0),
    placed: s.items.filter((i) => i.loc && s.levelById.has(i.loc)).length,
    unplaced: inStock.filter((i) => i.status !== "received" && (!i.loc || (!s.levelById.has(i.loc) && !s.stagingById.has(i.loc)))).length,
  };
}

// ── Performance, shelf by shelf ──────────────────────────────────────────────────────────────────────────────
export type Metric = "value" | "revenue" | "margin" | "rotation" | "dormant";
export const METRICS: { id: Metric; label: string; money: boolean; legend: string }[] = [
  { id: "value", label: "Valeur du stock", money: true, legend: "plus foncé : plus de valeur immobilisée" },
  { id: "revenue", label: "CA", money: true, legend: "plus foncé : plus de CA vendu depuis cette étagère (12 mois)" },
  { id: "margin", label: "Marge", money: true, legend: "plus foncé : plus de marge (12 mois)" },
  { id: "rotation", label: "Rotation", money: false, legend: "plus foncé : se vend plus vite" },
  { id: "dormant", label: "Stock dormant", money: false, legend: "plus foncé : plus d'articles dormants" },
];
export interface HeatLevel { id: string; items: number; valueCents: number | null; avgAge: number | null; dormant: number; sold: number; revenueCents: number | null; marginCents: number | null; daysToSell: number | null }
/* eslint-disable @typescript-eslint/no-explicit-any */
export const readHeat = (raw: any): HeatLevel[] => (raw?.levels ?? []).map((l: any[]) => ({
  id: l[0], items: Number(l[1]), valueCents: l[2] == null ? null : Number(l[2]), avgAge: l[3] == null ? null : Number(l[3]), dormant: Number(l[4]),
  sold: Number(l[5]), revenueCents: l[6] == null ? null : Number(l[6]), marginCents: l[7] == null ? null : Number(l[7]), daysToSell: l[8] == null ? null : Number(l[8]),
}));
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface ShelfHeat { shelf: string; raw: number | null; t: number | null; detail: HeatLevel }
/** One value per shelf (its levels added up), and its place between the lowest and the highest (0 … 1) */
export function shelfHeat(s: Snapshot, heat: HeatLevel[], metric: Metric): Map<string, ShelfHeat> {
  const by = new Map<string, HeatLevel>();
  for (const h of heat) {
    const l = s.levelById.get(h.id); if (!l) continue;
    const k = shelfId(l.rack, l.shelf), a = by.get(k);
    if (!a) { by.set(k, { ...h, id: k, daysToSell: h.daysToSell != null && h.sold ? h.daysToSell * h.sold : null }); continue; }
    a.items += h.items; a.dormant += h.dormant; a.sold += h.sold;
    a.valueCents = a.valueCents == null || h.valueCents == null ? null : a.valueCents + h.valueCents;
    a.revenueCents = a.revenueCents == null || h.revenueCents == null ? null : a.revenueCents + h.revenueCents;
    a.marginCents = a.marginCents == null || h.marginCents == null ? null : a.marginCents + h.marginCents;
    if (h.daysToSell != null && h.sold) a.daysToSell = (a.daysToSell ?? 0) + h.daysToSell * h.sold;
  }
  const value = (h: HeatLevel): number | null => {
    switch (metric) {
      case "value": return h.valueCents;
      case "revenue": return h.revenueCents;
      case "margin": return h.marginCents;
      case "dormant": return h.dormant;
      case "rotation": return h.sold && h.daysToSell != null ? h.daysToSell / h.sold : null; // average days to sell
    }
  };
  const vals = [...by.values()].map(value).filter((v): v is number => v != null);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const out = new Map<string, ShelfHeat>();
  for (const [k, h] of by) {
    const v = value(h);
    const avg = metric === "rotation" && h.sold && h.daysToSell != null ? { ...h, daysToSell: h.daysToSell / h.sold } : h;
    let t = v == null || !vals.length ? null : hi === lo ? (v > 0 ? 1 : 0) : (v - lo) / (hi - lo);
    if (metric === "rotation" && t != null) t = 1 - t; // fewer days to sell = faster = darker
    out.set(k, { shelf: k, raw: v, t, detail: avg });
  }
  return out;
}

/** One hue, light to dark (sequential): readable in both themes, never a rainbow */
export function ramp(t: number | null): string {
  if (t == null) return "#c9ced6";
  const a = [224, 231, 255], b = [55, 48, 163]; // indigo 100 → indigo 800
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * Math.max(0, Math.min(1, t))));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export const WORKFLOW_IN: { status: ItemStatus; label: string }[] = [
  { status: "received", label: "Réception" }, { status: "sorted", label: "Tri" }, { status: "photographed", label: "Photos" },
  { status: "measured", label: "Mesures" }, { status: "listing_ready", label: "Listing" }, { status: "listed", label: "Stockage / en ligne" },
];
export const WORKFLOW_OUT: { status: ItemStatus; label: string }[] = [
  { status: "listed", label: "Stock" }, { status: "sold", label: "Préparation" }, { status: "shipped", label: "Expédition" }, { status: "completed", label: "Vendu" },
];
/** The next step an item can take from the 3D view without another screen (publishing needs the listing page) */
export const NEXT: Partial<Record<ItemStatus, { to: ItemStatus; label: string }>> = {
  received: { to: "sorted", label: "Trié" }, sorted: { to: "photographed", label: "Photographié" },
  photographed: { to: "measured", label: "Mesuré" }, measured: { to: "listing_ready", label: "Prêt à publier" },
  returned: { to: "listing_ready", label: "Remis en vente" },
};

export type { Layout };
