// Niches to try: verdicts from the real results, suggestions from the business figures, a few starting ideas.
// Same principle as Conseils: explicit rules, every verdict shows its numbers.

import { buildAdvice, eur, type Facts, type Ranked } from "@/lib/advisor";

export type NicheStatus = "idea" | "testing" | "validated" | "dropped";
export const STATUS: Record<NicheStatus, { label: string; cls: string }> = {
  idea: { label: "Idée", cls: "bg-line/70 text-fg/80" },
  testing: { label: "En test", cls: "bg-sky-400/15 text-sky-200 ring-1 ring-inset ring-sky-400/30" },
  validated: { label: "Validée", cls: "bg-accent/15 text-accent ring-1 ring-inset ring-accent/30" },
  dropped: { label: "Abandonnée", cls: "bg-red-500/10 text-red-200/80" },
};

export interface Niche {
  id: string;
  name: string;
  hypothesis: string | null;
  status: NicheStatus;
  brand_ids: string[];
  category_ids: string[];
  sizes: string[];
  keywords: string[];
  price_min_cents: number | null;
  price_max_cents: number | null;
  target_buy_cents: number | null;
  target_sell_cents: number | null;
  budget_cents: number | null;
  test_items: number | null;
  started_at: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
}

/** Results of a niche over a set of items (from niche_stats) */
export interface Metrics {
  items: number; sold: number; in_stock: number; cost: number; revenue: number; profit: number; net: number;
  days: number | null; avg_cost: number | null; avg_price: number | null;
}
export interface Reference { sold: number; profit_per_item_cents: number | null; avg_days: number | null }
export interface NicheStats { reference: Reference; niches: { id: string; all: Metrics | null; test: Metrics | null }[] }

export const MIN_SALES = 5; // sales needed before judging a niche (unless the test sets its own number)

export type VerdictKey = "empty" | "early" | "good" | "mixed" | "bad";
export interface Verdict {
  key: VerdictKey;
  label: string;
  cls: string;
  text: string;
  profitPerItem: number | null;
  profitPerDay: number | null;
  sellThrough: number | null;
  roi: number | null;
  /** highest purchase price per item that still gives the usual margin */
  maxBuyCents: number | null;
}

const perDay = (ppi: number | null, days: number | null) => (ppi != null && days ? ppi / Math.max(days, 1) : null);
export const eur2 = (cents: number | null | undefined) =>
  cents == null ? "—" : `${(cents / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** "T52" for numeric sizes, "XXL" as is */
export const sizeLabel = (s: string) => (/^\d/.test(s) ? `T${s}` : s);

export function judge(m: Metrics | null, ref: Reference, needed = MIN_SALES): Verdict {
  const refPpd = perDay(ref.profit_per_item_cents, ref.avg_days);
  if (!m || m.items === 0) {
    return { key: "empty", label: "Pas encore d'article", cls: "text-muted", profitPerItem: null, profitPerDay: null, sellThrough: null, roi: null, maxBuyCents: null,
      text: "Aucun article ne correspond encore. Achetez un petit lot de test et rattachez-le à cette niche (à la création du lot)." };
  }
  const ppi = m.sold ? m.profit / m.sold : null;
  const ppd = perDay(ppi, m.days);
  const st = Math.round((m.sold * 100) / m.items);
  const roi = m.cost > 0 ? Math.round(((m.net - m.cost) * 100) / m.cost) : null;
  // what an item may cost to leave the usual margin: net received per sale − usual profit per item
  const maxBuy = m.sold >= 3 && ref.profit_per_item_cents != null ? Math.max(0, Math.round(m.net / m.sold - ref.profit_per_item_cents)) : null;
  const base = { profitPerItem: ppi, profitPerDay: ppd, sellThrough: st, roi, maxBuyCents: maxBuy };
  if (m.sold < needed) {
    return { ...base, key: "early", label: `À confirmer · ${m.sold}/${needed} ventes`, cls: "bg-sky-400/15 text-sky-200",
      text: `Encore ${needed - m.sold} vente${needed - m.sold > 1 ? "s" : ""} avant de juger.${ppi != null ? ` Pour l'instant : ${eur(ppi)} de marge par vente.` : ""}` };
  }
  const vs = refPpd ? ` (votre moyenne : ${eur2(refPpd)})` : "";
  if (ppd != null && refPpd != null && ppd >= refPpd && st >= 40) {
    return { ...base, key: "good", label: "Rentable", cls: "bg-accent/15 text-accent",
      text: `${eur2(ppd)} de marge par jour de stock${vs}, ${st} % écoulé. À développer : achetez-en davantage${maxBuy != null ? `, jusqu'à ${eur(maxBuy)} l'article` : ""}.` };
  }
  if (ppd != null && refPpd != null && ppd >= refPpd * 0.6) {
    return { ...base, key: "mixed", label: "Correct", cls: "bg-amber-400/15 text-amber-200",
      text: `${eur2(ppd)} par jour de stock${vs}, ${st} % écoulé. À garder si l'approvisionnement est facile${maxBuy != null ? ` ; ne payez pas plus de ${eur(maxBuy)} l'article` : ""}.` };
  }
  return { ...base, key: "bad", label: "Pas rentable", cls: "bg-red-500/15 text-red-200",
    text: `${ppd == null ? "Marge" : `${eur2(ppd)} par jour de stock`}${vs}, ${st} % écoulé. Moins bien que votre moyenne : abandonnez${maxBuy != null ? `, ou n'achetez plus qu'à ${eur(maxBuy)} maximum l'article` : " ou achetez moins cher"}.` };
}

/** Criteria of a niche in one line: "Canali, Zegna · Costume · T56, T58 · « tweed » · 40–100 €" */
export function criteria(n: Pick<Niche, "brand_ids" | "category_ids" | "sizes" | "keywords" | "price_min_cents" | "price_max_cents">,
  brands: Map<string, string>, categories: Map<string, string>): string {
  const parts = [
    n.brand_ids.map((id) => brands.get(id) ?? "?").join(", "),
    n.category_ids.map((id) => categories.get(id) ?? "?").join(", "),
    n.sizes.length ? n.sizes.map(sizeLabel).join(", ") : "",
    n.keywords.length ? n.keywords.map((k) => `« ${k} »`).join(", ") : "",
    n.price_min_cents != null || n.price_max_cents != null
      ? `${n.price_min_cents != null ? eur(n.price_min_cents) : "0 €"} – ${n.price_max_cents != null ? eur(n.price_max_cents) : "∞"}` : "",
  ].filter(Boolean);
  return parts.join(" · ") || "Aucun critère : rattachez un lot de test";
}

// ───────────────────────── Ideas ─────────────────────────
export interface Idea {
  key: string;
  name: string;
  hypothesis: string;
  brands?: string[];
  categories?: string[];
  sizes?: string[];
  keywords?: string[];
  price_min_cents?: number;
  price_max_cents?: number;
  /** why it is suggested (data suggestions) */
  why?: string;
}

/** Starting ideas for a men's second-hand tailoring business. Hypotheses to test, not market data. */
export const LIBRARY: Idea[] = [
  { key: "italian-suits", name: "Costumes italiens haut de gamme", hypothesis: "Des marques connues des amateurs de tailoring, qui se revendent cher même d'occasion.",
    brands: ["Canali", "Ermenegildo Zegna", "Corneliani", "Boglioli", "Lardini", "Brioni", "Kiton"], categories: ["Costume"] },
  { key: "tweed", name: "Vestes en tweed", hypothesis: "Pièce de caractère recherchée à l'automne et en hiver ; le tweed s'use peu.", keywords: ["tweed", "harris"] },
  { key: "waxed", name: "Vestes cirées et Barbour", hypothesis: "Très demandées et durables ; un réenduisage peut remonter la valeur.", brands: ["Barbour"], keywords: ["ciré", "barbour", "wax"] },
  { key: "big-sizes", name: "Grandes tailles (56 et plus)", hypothesis: "Peu d'offre sur Vinted pour les grandes tailles : moins de concurrence.", sizes: ["56", "58", "60", "62", "XXL", "3XL"] },
  { key: "coats", name: "Manteaux laine et cachemire", hypothesis: "Panier élevé en saison froide ; la matière se voit en photo.", keywords: ["cachemire", "cashmere", "pardessus", "laine"], categories: ["Manteau"] },
  { key: "workwear", name: "Vestes de travail vintage", hypothesis: "Bleu de travail, moleskine, chore jacket : une niche de collectionneurs.", keywords: ["travail", "workwear", "moleskine", "chore", "carhartt"], brands: ["Carhartt"] },
  { key: "ceremony", name: "Smokings et tenues de cérémonie", hypothesis: "Achats ponctuels mais pressés (mariages, galas) : les acheteurs négocient peu.", keywords: ["smoking", "tuxedo", "cérémonie", "jaquette"] },
  { key: "british", name: "Marques anglaises", hypothesis: "Image classique et solide, bonne cote sur Vinted.", brands: ["Hackett", "Paul Smith", "Burberry", "Aquascutum", "Gieves & Hawkes"] },
  { key: "waistcoats", name: "Gilets de costume", hypothesis: "Petits articles légers, peu chers à l'achat et à l'envoi.", categories: ["Gilet"] },
  { key: "knit", name: "Pulls cachemire et mérinos", hypothesis: "Se vendent toute l'année, s'envoient pour pas cher.", keywords: ["cachemire", "mérinos", "merino", "shetland"] },
  { key: "trousers", name: "Pantalons de costume seuls", hypothesis: "Souvent séparés des vestes dans les lots : à écouler à petit prix.", categories: ["Pantalon"], price_max_cents: 4000 },
];

/** Niches suggested by the figures: already profitable (develop) or promising on few sales (test) */
export function suggestions(f: Facts, taken: { brands: Set<string>; categories: Set<string>; sizes: Set<string> }): Idea[] {
  const r = buildAdvice(f);
  const ref = r.reference.profitPerItemCents != null && r.reference.avgDays ? r.reference.profitPerItemCents / Math.max(r.reference.avgDays, 1) : null;
  const out: Idea[] = [];
  const consider = (rows: Ranked[], kind: "brand" | "category" | "size") => {
    for (const x of rows) {
      if (out.length >= 8) return;
      if (/^sans (marque|catégorie)$/i.test(x.name)) continue;
      if ((kind === "brand" && taken.brands.has(x.name)) || (kind === "category" && taken.categories.has(x.name)) || (kind === "size" && taken.sizes.has(x.name))) continue;
      const what = kind === "size" ? `Taille ${x.name}` : x.name;
      const base = {
        key: `${kind}-${x.name}`, name: what,
        ...(kind === "brand" ? { brands: [x.name] } : kind === "category" ? { categories: [x.name] } : { sizes: [x.name] }),
      };
      const nums = `${eur(x.profitPerItemCents)} de marge par article en ${x.avgDays == null ? "—" : `${Math.round(x.avgDays)} j`} (${x.sold} vente${x.sold > 1 ? "s" : ""})`;
      if (x.verdict === "buy") {
        out.push({ ...base, why: `Déjà rentable : ${nums}. À développer.`, hypothesis: `Déjà rentable chez vous (${nums}) : en acheter davantage.` });
      } else if (x.verdict === "few" && x.sold >= 1 && ref != null && x.profitPerDayCents != null && x.profitPerDayCents >= ref * 1.5) {
        out.push({ ...base, why: `Prometteur mais peu de ventes : ${nums}. À confirmer avec un petit lot.`, hypothesis: `Bons premiers résultats (${nums}) : à confirmer sur ${MIN_SALES} ventes.` });
      }
    }
  };
  consider(r.brands, "brand");
  consider(r.categories, "category");
  consider(r.sizes, "size");
  return out;
}
