// « Prix conseillé » : what to list a piece at, from what the same kind of piece really sold for here.
// The most precise group with enough sales wins: brand + type, brand, type without brand, type. In its season
// (October → March, April → September) when that season has enough sales. Pure functions, tested in scripts/kpi-test.ts.

import { parisDay } from "@/lib/trend";
import { designerOf, familyOf, FAMILY_LABEL, type Described, type Family } from "./classify";

export interface SoldRow extends Described { revenue: number; soldAt: string }
export interface GuideGroup { label: string; n: number; median: number; cold: { n: number; median: number | null }; warm: { n: number; median: number | null } }
export type PriceGuide = Record<string, GuideGroup>;

/** Sales needed before a group is trusted (a brand needs fewer: its pieces are rarer and closer to each other) */
export const GUIDE_MIN = 5;
export const GUIDE_MIN_BRAND = 3;
/** Listed a little above what it sells for: room for an offer */
export const LISTING_MARGIN = 1.08;

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const isCold = (day: string) => { const m = Number(day.slice(5, 7)); return m >= 10 || m <= 3; };

export function buildGuide(rows: SoldRow[]): PriceGuide {
  const by = new Map<string, { label: string; cold: number[]; warm: number[] }>();
  const add = (key: string, label: string, r: SoldRow) => {
    let g = by.get(key);
    if (!g) by.set(key, (g = { label, cold: [], warm: [] }));
    (isCold(parisDay(r.soldAt)) ? g.cold : g.warm).push(r.revenue);
  };
  for (const r of rows) {
    if (!(r.revenue > 0)) continue;
    const f = familyOf(r), d = designerOf(r);
    add(`f:${f}`, FAMILY_LABEL[f], r);
    if (d) { add(`d:${d}`, d, r); add(`d:${d}|${f}`, `${FAMILY_LABEL[f]} ${d}`, r); }
    else add(`u:${f}`, `${FAMILY_LABEL[f]} sans marque`, r);
  }
  const out: PriceGuide = {};
  for (const [key, g] of by) {
    const all = [...g.cold, ...g.warm];
    out[key] = {
      label: g.label, n: all.length, median: median(all),
      cold: { n: g.cold.length, median: g.cold.length ? median(g.cold) : null },
      warm: { n: g.warm.length, median: g.warm.length ? median(g.warm) : null },
    };
  }
  return out;
}

export interface PriceAdvice {
  /** the price to list at (cents, a whole number of euros) */
  price: number;
  /** what such a piece sells for (median, cents) */
  sells: number;
  n: number; label: string; season: "cold" | "warm" | null;
  /** the brand is named but has too few sales: the figure is the type's */
  brandFallback: string | null;
  text: string;
}

const eur = (c: number) => `${Math.round(c / 100)} €`;

export function advisePrice(guide: PriceGuide, item: Described, now: number): PriceAdvice | null {
  if (!(item.title ?? "").trim() && !item.category && !item.brand) return null;
  const f: Family = familyOf(item), d = designerOf(item);
  const tries: [string, number][] = d
    ? [[`d:${d}|${f}`, GUIDE_MIN], [`d:${d}`, GUIDE_MIN_BRAND], [`f:${f}`, GUIDE_MIN]]
    : [[`u:${f}`, GUIDE_MIN], [`f:${f}`, GUIDE_MIN]];
  const hit = tries.map(([k, min]) => ({ k, g: guide[k], min })).find((t) => t.g && t.g.n >= t.min);
  if (!hit || (f === "autre" && !hit.k.startsWith("d:"))) return null;
  const g = hit.g;
  const cold = isCold(parisDay(new Date(now)));
  const s = cold ? g.cold : g.warm;
  const seasonal = s.n >= GUIDE_MIN && s.median != null;
  const sells = seasonal ? s.median! : g.median;
  const n = seasonal ? s.n : g.n;
  const price = Math.max(100, Math.round((sells * LISTING_MARGIN) / 100) * 100);
  const brandFallback = d && !hit.k.startsWith("d:") ? d : null;
  const when = seasonal ? (cold ? "d'octobre à mars" : "d'avril à septembre") : "sur 12 mois";
  return {
    price, sells, n, label: g.label, season: seasonal ? (cold ? "cold" : "warm") : null, brandFallback,
    text: `${g.label} : vendu ${eur(sells)} en médiane ${when} (${n} vente${n > 1 ? "s" : ""}). Affiché un peu au-dessus pour laisser la place à une offre.`
      + (brandFallback ? ` Trop peu de ventes ${brandFallback} pour un prix de marque : une belle pièce peut valoir plus.` : ""),
  };
}
