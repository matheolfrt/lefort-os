// « Lots groupés » : listings that have been online too long, put together by kind and size in lots of 3 or 4, with a
// price and a ready-to-paste listing. Designer pieces stay alone (they are worth more one by one), and a Harris Tweed
// only joins a lot after 90 days. Nothing is stored: the page proposes, the seller creates the listing on Vinted.

import { FAMILY_LABEL, type Family, type Size } from "./classify";
import type { Enriched } from "./compute";

export type BundleKind = "blazers" | "manteaux" | "costumes";
export interface BundlePiece { id: string; sku: string; title: string; listPrice: number; cost: number; costEstimated: boolean; age: number; family: Family }
export interface Bundle {
  key: string; kind: BundleKind; size: Size; pieces: BundlePiece[];
  sumList: number;
  /** the lot's price (cents), a multiple of 5 € */
  price: number; perPiece: number; cost: number; margin: number;
  /** the oldest piece, in days online */
  oldest: number;
  title: string; description: string;
}
export interface BundleProposal { bundles: Bundle[]; candidates: number; left: number }

export const BUNDLE_MIN_AGE = 60;
export const HARRIS_MIN_AGE = 90;
/** A lot sells at about two thirds of its pieces' prices, never under their cost + 5 € a piece */
export const BUNDLE_SHARE = 0.65;
export const BUNDLE_FLOOR_PER_PIECE = 500;

const DAY = 86_400_000;
const KIND: Partial<Record<Family, BundleKind>> = { harris: "blazers", tweed: "blazers", croise: "blazers", blazer: "blazers", manteau: "manteaux", costume: "costumes" };
const NOUN: Record<BundleKind, string> = { blazers: "blazers", manteaux: "manteaux", costumes: "costumes" };

function nounOf(kind: BundleKind, pieces: BundlePiece[]) {
  if (kind !== "blazers") return NOUN[kind];
  const fam = new Set(pieces.map((p) => p.family));
  if (fam.size === 1 && fam.has("harris")) return "blazers Harris Tweed";
  if ([...fam].every((f) => f === "harris" || f === "tweed")) return "blazers en tweed";
  if (fam.size === 1 && fam.has("croise")) return "blazers croisés";
  return "blazers";
}

export function bundlePrice(pieces: { listPrice: number; cost: number }[]): number {
  const raw = pieces.reduce((s, p) => s + p.listPrice, 0) * BUNDLE_SHARE;
  const floor = pieces.reduce((s, p) => s + p.cost + BUNDLE_FLOOR_PER_PIECE, 0);
  return Math.max(Math.round(raw / 500) * 500, Math.ceil(floor / 500 - 1e-9) * 500);
}

export function proposeBundles(items: Enriched[], now: number, minAge = BUNDLE_MIN_AGE): BundleProposal {
  const pool = new Map<string, BundlePiece[]>();
  let candidates = 0;
  for (const i of items) {
    const kind = KIND[i.family];
    const from = i.listedAt ?? i.receivedAt;
    if (i.status !== "listed" || !kind || i.designer || !i.size || !i.listPrice || !from) continue;
    const age = Math.floor((now - Date.parse(from)) / DAY);
    if (age < (i.family === "harris" ? Math.max(minAge, HARRIS_MIN_AGE) : minAge)) continue;
    candidates++;
    const key = `${kind}|${i.size}`;
    let list = pool.get(key);
    if (!list) pool.set(key, (list = []));
    list.push({ id: i.id, sku: i.sku, title: (i.title ?? "").trim() || FAMILY_LABEL[i.family], listPrice: i.listPrice, cost: i.costCents, costEstimated: i.costEstimated, age, family: i.family });
  }
  const bundles: Bundle[] = [];
  let left = 0;
  for (const [key, list] of pool) {
    const [kind, size] = key.split("|") as [BundleKind, Size];
    list.sort((a, b) => b.age - a.age || a.sku.localeCompare(b.sku));
    // lots of 3; one piece left over joins the last lot (4), two wait for a third
    const n = Math.floor(list.length / 3), rest = list.length % 3;
    if (n === 0) { left += list.length; continue; }
    for (let k = 0; k < n; k++) {
      const pieces = list.slice(k * 3, k * 3 + 3);
      if (k === n - 1 && rest === 1) pieces.push(list[list.length - 1]);
      const sumList = pieces.reduce((s, p) => s + p.listPrice, 0), cost = pieces.reduce((s, p) => s + p.cost, 0);
      const price = bundlePrice(pieces);
      const noun = nounOf(kind, pieces);
      const title = `Lot de ${pieces.length} ${noun} vintage – Taille ${size}`;
      const description = [
        `Lot de ${pieces.length} ${noun} vintage, taille ${size} :`,
        ...pieces.map((p) => `• ${p.title}`),
        "",
        `Vendus ensemble : ${Math.round(price / 100)} € le lot, soit ${Math.round(price / pieces.length / 100)} € la pièce.`,
        `Réf. ${pieces.map((p) => p.sku).join(" · ")}`,
      ].join("\n");
      bundles.push({ key: `${key}|${k}`, kind, size, pieces, sumList, price, perPiece: Math.round(price / pieces.length), cost, margin: price - cost, oldest: pieces[0].age, title, description });
    }
    if (rest === 2) left += 2;
  }
  bundles.sort((a, b) => b.oldest - a.oldest || a.key.localeCompare(b.key));
  return { bundles, candidates, left };
}
