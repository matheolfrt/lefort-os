// Indicateurs — every figure of the page, computed from one row per item and one row per order. Pure functions on
// Paris days, shared by the page and its tests (scripts/kpi-test.ts). Nothing here is stored.
//
// Margins count the real purchase price when it was entered, and the assumed one otherwise (classify.ts: Harris,
// coats and suits 10 €, other pieces 4 €); the pages say how many sales use an assumed price.
// « % vendus » is measured on bought lots only, received more than 30 days ago: the imported Vinted wardrobe holds
// almost only what sold (the unsold pieces deleted before were never imported), its share would be flattering.

import { addDays, parisDay } from "@/lib/trend";
import type { ItemStatus } from "@/lib/types";
import {
  costUsed, designerOf, familyOf, FAMILY_LABEL, MAX_BUY_SHARE, sizeOf, SIZES, UNKNOWN_COST_MAX, type Family, type Size,
} from "./classify";

export interface KpiItem {
  id: string; sku: string; status: ItemStatus;
  title: string | null; brand: string | null; category: string | null; sizeLabel: string | null;
  listPrice: number | null;
  receivedAt: string | null; listedAt: string | null; soldAt: string | null;
  isSold: boolean; revenue: number; profit: number; cost: number;
  batchId: string; batchCode: string | null; batchKind: string; supplier: string | null; purchasedAt: string | null;
}
export interface KpiOrder { id: string; soldAt: string; buyer: string | null; gross: number; items: number }

export interface Enriched extends KpiItem {
  family: Family; designer: string | null; size: Size | null;
  costCents: number; costEstimated: boolean;
  /** what the sale left once the purchase price is paid (assumed price when unknown); null when not sold */
  margin: number | null;
  /** days from listing to sale, when both are known */
  delay: number | null;
}

/** Physically in stock: bought, not sold, not discarded */
export const IN_STOCK: ItemStatus[] = ["received", "sorted", "photographed", "measured", "listing_ready", "listed", "reserved", "on_hold", "returned"];
const BEFORE_ONLINE: ItemStatus[] = ["received", "sorted", "photographed", "measured", "listing_ready", "on_hold", "returned"];
const DAY = 86_400_000;
const daysBetween = (a: string, b: string | number) => ((typeof b === "number" ? b : Date.parse(b)) - Date.parse(a)) / DAY;

export function enrich(items: KpiItem[]): Enriched[] {
  return items.map((i) => {
    const family = familyOf(i);
    const c = costUsed(i.cost, family, i.title);
    const sold = i.isSold && i.soldAt != null;
    const d = sold && i.listedAt ? daysBetween(i.listedAt, i.soldAt!) : null;
    return {
      ...i, family, designer: designerOf(i), size: sizeOf(i.title, i.sizeLabel),
      costCents: c.cents, costEstimated: c.estimated,
      margin: sold ? i.profit + (i.cost > UNKNOWN_COST_MAX ? 0 : i.cost) - (c.estimated ? c.cents : 0) : null,
      delay: d != null && d >= 0 ? d : null,
    };
  });
}

const median = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (v: number[], q: number) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
const avgOf = (rows: Enriched[]) => ({ n: rows.length, avg: mean(rows.map((r) => r.revenue)) });
const monthOf = (iso: string) => parisDay(iso).slice(0, 7);

// ─────────────────────────────────────────── by type and by brand

export const FEW_SALES = 5;
export const FAST_DAYS = 2;
export const MATURE_DAYS = 30;

export interface Advice { tone: "up" | "down" | "ok" | "few"; text: string }
export interface GroupStats {
  key: string; label: string;
  sold: number; revenue: number;
  avgPrice: number | null; medianPrice: number | null; minPrice: number | null; maxPrice: number | null;
  /** share of the pieces sold: bought lots received 30+ days ago (`approx` = all pieces, too few bought ones) */
  sellThrough: { pct: number | null; base: number; approx: boolean };
  medianDays: number | null; timed: number;
  /** share of the timed sales that left within 2 days of listing */
  fastShare: number | null;
  marginPerPiece: number | null; estimatedCosts: number;
  /** a quarter of the average sale price */
  maxBuy: number | null;
  /** whole history: October → March against April → September */
  cold: { n: number; avg: number | null }; warm: { n: number; avg: number | null };
  /** last 90 days against the 90 before */
  recent: { n: number; avg: number | null }; before: { n: number; avg: number | null };
  /** average sale price of each of the last 12 months, oldest first */
  months: { month: string; n: number; avg: number | null }[];
  inStock: number; stockAvgPrice: number | null;
  advice: Advice;
}

const eur = (c: number) => `${Math.round(c / 100)} €`;

export function adviceFor(g: Omit<GroupStats, "advice">): Advice {
  if (g.sold === 0) return { tone: "few", text: "Pas encore vendu sur la période." };
  if (g.sold < FEW_SALES) return { tone: "few", text: `${g.sold} vente${g.sold > 1 ? "s" : ""} seulement : à confirmer avant d'en acheter beaucoup.` };
  if (g.fastShare != null && g.timed >= FEW_SALES && g.fastShare >= 0.5)
    return { tone: "up", text: `${Math.round(g.fastShare * 100)} % partent en moins de ${FAST_DAYS} jours : monte le prix de 10 à 15 %.` };
  if (g.sellThrough.pct != null && !g.sellThrough.approx && g.sellThrough.base >= 10 && g.sellThrough.pct < 60)
    return { tone: "down", text: `${Math.round(g.sellThrough.pct)} % vendus seulement : achète-en moins, ou moins cher.` };
  if (g.recent.avg != null && g.before.avg != null && g.recent.n >= FEW_SALES && g.before.n >= FEW_SALES && g.recent.avg < g.before.avg * 0.85)
    return { tone: "down", text: `Prix en baisse de ${Math.round((1 - g.recent.avg / g.before.avg) * 100)} % ces 90 derniers jours.` };
  if (g.cold.avg != null && g.warm.avg != null && g.cold.n >= FEW_SALES && g.warm.n >= FEW_SALES) {
    if (g.cold.avg >= g.warm.avg * 1.25)
      return { tone: "ok", text: `${Math.round((g.cold.avg / g.warm.avg - 1) * 100)} % plus cher d'octobre à mars : garde-les pour l'automne-hiver.` };
    if (g.warm.avg >= g.cold.avg * 1.25)
      return { tone: "ok", text: `${Math.round((g.warm.avg / g.cold.avg - 1) * 100)} % plus cher d'avril à septembre : mets-les en ligne au printemps.` };
  }
  return { tone: "ok", text: g.marginPerPiece != null ? `Rentable : ${eur(g.marginPerPiece)} de marge par pièce.` : "Rentable." };
}

export interface GroupOptions { now: number; /** sales of the last N days; null = whole history */ periodDays: number | null }

export function groupStats(items: Enriched[], keyOf: (i: Enriched) => string | null, labelOf: (key: string) => string, opts: GroupOptions): GroupStats[] {
  const today = parisDay(new Date(opts.now));
  const since = opts.periodDays == null ? null : addDays(today, -opts.periodDays);
  const by = new Map<string, Enriched[]>();
  for (const i of items) {
    const k = keyOf(i);
    if (k == null) continue;
    let list = by.get(k);
    if (!list) by.set(k, (list = []));
    list.push(i);
  }
  const monthKeys = Array.from({ length: 12 }, (_, n) => {
    const [y, m] = today.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 - (11 - n), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  const d90 = addDays(today, -90), d180 = addDays(today, -180), matured = addDays(today, -MATURE_DAYS);

  const out: GroupStats[] = [];
  for (const [key, list] of by) {
    const allSold = list.filter((i) => i.isSold && i.soldAt);
    const sold = since ? allSold.filter((i) => parisDay(i.soldAt!) >= since) : allSold;
    const prices = sold.map((i) => i.revenue);
    const timed = sold.filter((i) => i.delay != null);
    const counted = list.filter((i) => i.status !== "rejected" && i.receivedAt && parisDay(i.receivedAt) <= matured
      && (!since || parisDay(i.receivedAt) >= since));
    const bought = counted.filter((i) => i.batchKind === "purchase");
    const base = bought.length >= FEW_SALES ? bought : counted;
    const sellThrough = {
      pct: base.length >= FEW_SALES ? (base.filter((i) => i.isSold).length / base.length) * 100 : null,
      base: base.length, approx: base !== bought,
    };
    const margins = sold.map((i) => i.margin!).filter((m) => m != null);
    const avgPrice = mean(prices);
    const cold = allSold.filter((i) => { const m = Number(parisDay(i.soldAt!).slice(5, 7)); return m >= 10 || m <= 3; });
    const warm = allSold.filter((i) => { const m = Number(parisDay(i.soldAt!).slice(5, 7)); return m >= 4 && m <= 9; });
    const stock = list.filter((i) => IN_STOCK.includes(i.status));
    const stockPrices = stock.map((i) => i.listPrice).filter((p): p is number => p != null && p > 0);
    const g: Omit<GroupStats, "advice"> = {
      key, label: labelOf(key),
      sold: sold.length, revenue: prices.reduce((a, b) => a + b, 0),
      avgPrice, medianPrice: median(prices),
      minPrice: prices.length ? Math.min(...prices) : null, maxPrice: prices.length ? Math.max(...prices) : null,
      sellThrough,
      medianDays: median(timed.map((i) => i.delay!)), timed: timed.length,
      fastShare: timed.length ? timed.filter((i) => i.delay! <= FAST_DAYS).length / timed.length : null,
      marginPerPiece: mean(margins), estimatedCosts: sold.filter((i) => i.costEstimated).length,
      maxBuy: avgPrice == null ? null : Math.floor((avgPrice * MAX_BUY_SHARE) / 50) * 50,
      cold: avgOf(cold), warm: avgOf(warm),
      recent: avgOf(allSold.filter((i) => parisDay(i.soldAt!) > d90)),
      before: avgOf(allSold.filter((i) => { const d = parisDay(i.soldAt!); return d > d180 && d <= d90; })),
      months: monthKeys.map((mk) => {
        const rows = allSold.filter((i) => monthOf(i.soldAt!) === mk);
        return { month: mk, n: rows.length, avg: mean(rows.map((r) => r.revenue)) };
      }),
      inStock: stock.length, stockAvgPrice: mean(stockPrices),
    };
    if (g.sold === 0 && g.inStock === 0) continue;
    out.push({ ...g, advice: adviceFor(g) });
  }
  return out.sort((a, b) => b.revenue - a.revenue || b.inStock - a.inStock);
}

export const byFamily = (items: Enriched[], opts: GroupOptions) =>
  groupStats(items, (i) => i.family, (k) => FAMILY_LABEL[k as Family], opts);
export const byDesigner = (items: Enriched[], opts: GroupOptions) =>
  groupStats(items, (i) => i.designer, (k) => k, opts);
/** Pieces naming no designer brand, by type (« Blazer croisé sans marque ») */
export const unbrandedByFamily = (items: Enriched[], opts: GroupOptions) =>
  groupStats(items.filter((i) => !i.designer), (i) => i.family, (k) => `${FAMILY_LABEL[k as Family]} sans marque`, opts);

// ─────────────────────────────────────────── judge a lot before buying it

export interface LotLine { avgPrice: number | null; qty: number }
export type LotVerdict = "bon" | "correct" | "cher" | "vide";
export interface LotJudgement {
  pieces: number; revenue: number; cost: number; ratio: number | null; maxPrice: number; profit: number; verdict: LotVerdict;
}
/** `price` = what the lot costs delivered (cents); `extraPct` = customs and taxes on top, in % */
export function judgeLot(lines: LotLine[], price: number, extraPct = 0): LotJudgement {
  const pieces = lines.reduce((s, l) => s + Math.max(0, Math.floor(l.qty)), 0);
  const revenue = Math.round(lines.reduce((s, l) => s + Math.max(0, Math.floor(l.qty)) * (l.avgPrice ?? 0), 0));
  const k = 1 + Math.max(0, extraPct) / 100;
  const cost = Math.round(Math.max(0, price) * k);
  const ratio = revenue > 0 ? cost / revenue : null;
  const maxPrice = Math.floor((revenue * MAX_BUY_SHARE) / k / 100) * 100;
  const verdict: LotVerdict = !pieces || !revenue ? "vide" : ratio! <= MAX_BUY_SHARE ? "bon" : ratio! <= 0.4 ? "correct" : "cher";
  return { pieces, revenue, cost, ratio, maxPrice, profit: revenue - cost, verdict };
}

// ─────────────────────────────────────────── stock by age

export interface AgingBucket {
  key: "0-30" | "30-60" | "60-90" | "90+"; label: string; count: number; value: number; cost: number;
  advice: string; href: string; families: { label: string; n: number }[];
}
export interface Aging {
  online: AgingBucket[];
  /** in stock, not online yet */
  waiting: { count: number; old: number; value: number };
  undated: number;
}
const BUCKETS: { key: AgingBucket["key"]; from: number; to: number; label: string; advice: string; href: string }[] = [
  { key: "0-30", from: 0, to: 30, label: "Moins de 30 jours", advice: "Laisse-les : c'est leur période normale de vente.", href: "/stock?status=listed" },
  { key: "30-60", from: 30, to: 60, label: "30 à 60 jours", advice: "Baisse de 10 à 20 %.", href: "/prix" },
  { key: "60-90", from: 60, to: 90, label: "60 à 90 jours", advice: "Baisse de 30 %, ou mets-les dans un lot groupé.", href: "/prix" },
  { key: "90+", from: 90, to: Infinity, label: "Plus de 90 jours", advice: "Déstocke : lots groupés de 3 ou 4, ou dernière baisse.", href: "/prix" },
];

export function aging(items: Enriched[], now: number): Aging {
  const online = items.filter((i) => i.status === "listed");
  const buckets = BUCKETS.map((b) => {
    const rows = online.filter((i) => {
      const from = i.listedAt ?? i.receivedAt;
      const age = from ? daysBetween(from, now) : 0;
      return age >= b.from && age < b.to;
    });
    const fam = new Map<Family, number>();
    for (const r of rows) fam.set(r.family, (fam.get(r.family) ?? 0) + 1);
    return {
      key: b.key, label: b.label, advice: b.advice, href: b.href, count: rows.length,
      value: rows.reduce((s, r) => s + (r.listPrice ?? 0), 0), cost: rows.reduce((s, r) => s + r.costCents, 0),
      families: [...fam.entries()].sort((a, c) => c[1] - a[1]).slice(0, 3).map(([f, n]) => ({ label: FAMILY_LABEL[f], n })),
    };
  });
  const waiting = items.filter((i) => BEFORE_ONLINE.includes(i.status));
  return {
    online: buckets,
    waiting: {
      count: waiting.length,
      old: waiting.filter((i) => i.receivedAt && daysBetween(i.receivedAt, now) > 14).length,
      value: waiting.reduce((s, r) => s + (r.listPrice ?? 0), 0),
    },
    undated: online.filter((i) => !i.listedAt).length,
  };
}

// ─────────────────────────────────────────── pace, stock cover, cash cycle, margin per hour

export interface Pace {
  weeks: { start: string; listed: number; sold: number }[];
  listed7: number; listedPerDay30: number; soldPerDay30: number;
  /** months of sales the stock holds at the pace of the last 90 days */
  cover: { stock: number; online: number; perMonth: number; months: number | null; onlineMonths: number | null };
  /** last 90 days, for the margin per hour of work */
  hour: { sold: number; margin: number };
}

const mondayOf = (day: string) => addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));

export function pace(items: Enriched[], now: number, weeks = 12): Pace {
  const today = parisDay(new Date(now));
  const first = addDays(mondayOf(today), -7 * (weeks - 1));
  const rows = Array.from({ length: weeks }, (_, n) => ({ start: addDays(first, 7 * n), listed: 0, sold: 0 }));
  const idx = (iso: string) => {
    const d = parisDay(iso);
    if (d < first || d > today) return -1;
    return Math.floor(daysBetween(`${first}T12:00:00Z`, `${d}T12:00:00Z`) / 7 + 1e-9);
  };
  for (const i of items) {
    if (i.listedAt) { const k = idx(i.listedAt); if (k >= 0) rows[k].listed++; }
    if (i.isSold && i.soldAt) { const k = idx(i.soldAt); if (k >= 0) rows[k].sold++; }
  }
  const after = (iso: string | null, days: number) => iso != null && parisDay(iso) > addDays(today, -days);
  const sold90 = items.filter((i) => i.isSold && after(i.soldAt, 90));
  const perMonth = (sold90.length / 90) * 30;
  const stock = items.filter((i) => IN_STOCK.includes(i.status)).length;
  const online = items.filter((i) => i.status === "listed").length;
  return {
    weeks: rows,
    listed7: items.filter((i) => after(i.listedAt, 7)).length,
    listedPerDay30: items.filter((i) => after(i.listedAt, 30)).length / 30,
    soldPerDay30: items.filter((i) => i.isSold && after(i.soldAt, 30)).length / 30,
    cover: {
      stock, online, perMonth,
      months: perMonth > 0 ? stock / perMonth : null,
      onlineMonths: perMonth > 0 ? online / perMonth : null,
    },
    hour: { sold: sold90.length, margin: sold90.reduce((s, i) => s + (i.margin ?? 0), 0) },
  };
}

/** Margin per hour of work, for `minutes` of work per piece (sorting, photo, measures, listing, parcel) */
export const perHour = (marginPerPiece: number | null, minutes: number) =>
  marginPerPiece == null || minutes <= 0 ? null : (marginPerPiece * 60) / minutes;

export interface CashCycle { n: number; median: number | null; p75: number | null }
/** Days from paying a lot to selling its pieces: bought lots, sales of the last 12 months */
export function cashCycle(items: Enriched[], now: number): CashCycle {
  const since = addDays(parisDay(new Date(now)), -365);
  const d = items
    .filter((i) => i.batchKind === "purchase" && i.isSold && i.soldAt && i.purchasedAt && parisDay(i.soldAt) >= since)
    .map((i) => daysBetween(`${i.purchasedAt!.slice(0, 10)}T00:00:00Z`, i.soldAt!))
    .filter((x) => x >= 0);
  return { n: d.length, median: median(d), p75: quantile(d, 0.75) };
}

export interface SupplierKpi {
  name: string; lots: number; pieces: number; sold: number; pct: number | null;
  costPerPiece: number | null; revenue: number; marginPerPiece: number | null; cycle: number | null;
}
/** Bought lots only, whole history: what each supplier's pieces cost (fees included) and gave back */
export function suppliers(items: Enriched[]): SupplierKpi[] {
  const by = new Map<string, Enriched[]>();
  for (const i of items) {
    if (i.batchKind !== "purchase" || i.status === "rejected") continue;
    const k = i.supplier ?? "Sans fournisseur";
    let list = by.get(k);
    if (!list) by.set(k, (list = []));
    list.push(i);
  }
  return [...by.entries()].map(([name, list]) => {
    const sold = list.filter((i) => i.isSold && i.soldAt);
    const known = list.filter((i) => !i.costEstimated);
    const cycles = sold.filter((i) => i.purchasedAt).map((i) => daysBetween(`${i.purchasedAt!.slice(0, 10)}T00:00:00Z`, i.soldAt!)).filter((x) => x >= 0);
    return {
      name, lots: new Set(list.map((i) => i.batchId)).size, pieces: list.length, sold: sold.length,
      pct: list.length ? (sold.length / list.length) * 100 : null,
      costPerPiece: mean(known.map((i) => i.costCents)),
      revenue: sold.reduce((s, i) => s + i.revenue, 0),
      marginPerPiece: mean(sold.map((i) => i.margin!).filter((m) => m != null)),
      cycle: median(cycles),
    };
  }).sort((a, b) => b.pieces - a.pieces);
}

// ─────────────────────────────────────────── sizes

export interface SizeRow {
  size: Size | null; sold: number; soldShare: number | null; stock: number; stockShare: number | null;
  /** months of stock at the pace of the last 12 months */
  cover: number | null; medianDays: number | null; avgPrice: number | null;
  verdict: "manque" | "trop" | "ok" | "few";
}
export function sizes(items: Enriched[], now: number, keep: (i: Enriched) => boolean = () => true): SizeRow[] {
  const since = addDays(parisDay(new Date(now)), -365);
  const rows = items.filter(keep);
  const sold = rows.filter((i) => i.isSold && i.soldAt && parisDay(i.soldAt) >= since);
  const stock = rows.filter((i) => IN_STOCK.includes(i.status));
  const soldKnown = sold.filter((i) => i.size).length, stockKnown = stock.filter((i) => i.size).length;
  return [...SIZES, null].map((size) => {
    const s = sold.filter((i) => i.size === size), st = stock.filter((i) => i.size === size);
    const soldShare = size && soldKnown ? s.length / soldKnown : null;
    const stockShare = size && stockKnown ? st.length / stockKnown : null;
    let verdict: SizeRow["verdict"] = "ok";
    if (!size || s.length + st.length < FEW_SALES) verdict = "few";
    else if (soldShare != null && stockShare != null && soldShare >= 0.05 && stockShare < soldShare * 0.6) verdict = "manque";
    else if (soldShare != null && stockShare != null && st.length >= FEW_SALES && stockShare > soldShare * 1.6) verdict = "trop";
    return {
      size, sold: s.length, soldShare, stock: st.length, stockShare,
      cover: s.length ? st.length / (s.length / 12) : null,
      medianDays: median(s.map((i) => i.delay).filter((d): d is number => d != null)),
      avgPrice: mean(s.map((i) => i.revenue)),
      verdict,
    };
  }).filter((r) => r.sold || r.stock);
}

// ─────────────────────────────────────────── buyers

export interface BuyerStats {
  orders: number; buyers: number; repeat: number; repeatRevenueShare: number | null;
  avgBasket: number | null; itemsPerOrder: number | null; multiShare: number | null;
  top: { handle: string; orders: number; items: number; spent: number; last: string }[];
}
/** Orders of the last 12 months */
export function buyers(orders: KpiOrder[], now: number): BuyerStats {
  const since = addDays(parisDay(new Date(now)), -365);
  const list = orders.filter((o) => parisDay(o.soldAt) >= since);
  const by = new Map<string, { orders: number; items: number; spent: number; last: string }>();
  for (const o of list) {
    const h = o.buyer?.trim();
    if (!h) continue;
    const b = by.get(h) ?? { orders: 0, items: 0, spent: 0, last: o.soldAt };
    b.orders++; b.items += o.items; b.spent += o.gross;
    if (o.soldAt > b.last) b.last = o.soldAt;
    by.set(h, b);
  }
  const all = [...by.entries()].map(([handle, b]) => ({ handle, ...b }));
  const repeat = all.filter((b) => b.orders > 1);
  const spent = all.reduce((s, b) => s + b.spent, 0);
  return {
    orders: list.length, buyers: all.length, repeat: repeat.length,
    repeatRevenueShare: spent > 0 ? repeat.reduce((s, b) => s + b.spent, 0) / spent : null,
    avgBasket: mean(list.map((o) => o.gross)),
    itemsPerOrder: mean(list.map((o) => o.items)),
    multiShare: list.length ? list.filter((o) => o.items > 1).length / list.length : null,
    top: all.sort((a, b) => b.spent - a.spent || b.orders - a.orders).slice(0, 10),
  };
}

// ─────────────────────────────────────────── what to record

export interface LotFees { id: string; code: string; kind: string; purchasedAt: string | null; lineKinds: string[] }
export interface DataQuality {
  soldNoCost: number; soldTotal: number; stockNoCost: number; stockTotal: number;
  onlineNoDate: number; online: number;
  expenses90: { n: number; cents: number };
  /** bought lots of the last 12 months whose cost has no transport, customs or fees line */
  lotsNoFees: { id: string; code: string; purchasedAt: string | null }[];
}
export function dataQuality(items: Enriched[], expenses: { spentOn: string; cents: number }[], lots: LotFees[], now: number): DataQuality {
  const today = parisDay(new Date(now));
  const since = addDays(today, -365), since90 = addDays(today, -90);
  const sold = items.filter((i) => i.isSold && i.soldAt && parisDay(i.soldAt) >= since);
  const stock = items.filter((i) => IN_STOCK.includes(i.status));
  const online = items.filter((i) => i.status === "listed");
  const exp = expenses.filter((e) => e.spentOn >= since90 && e.spentOn <= today);
  return {
    soldNoCost: sold.filter((i) => i.costEstimated).length, soldTotal: sold.length,
    stockNoCost: stock.filter((i) => i.costEstimated).length, stockTotal: stock.length,
    onlineNoDate: online.filter((i) => !i.listedAt).length, online: online.length,
    expenses90: { n: exp.length, cents: exp.reduce((s, e) => s + e.cents, 0) },
    lotsNoFees: lots
      .filter((l) => l.kind === "purchase" && (!l.purchasedAt || l.purchasedAt >= since)
        && !l.lineKinds.some((k) => k === "transport" || k === "customs" || k === "fees"))
      .map(({ id, code, purchasedAt }) => ({ id, code, purchasedAt })),
  };
}
