// Indicateurs — what an item is, read from its title, its brand and its category: its type (Harris Tweed blazer, other
// tweed blazer, double-breasted blazer, coat, suit…), the designer brand its title names (Burberry, Polo Ralph Lauren…),
// its size on one scale (XS → 3XL+), and the purchase price assumed when the real one was never recorded.
// Pure functions, shared by the Indicateurs page and its tests (scripts/kpi-test.ts).

export type Family =
  | "harris" | "tweed" | "croise" | "blazer" | "manteau" | "costume" | "lot" | "gilet" | "pantalon" | "chemise" | "accessoire" | "autre";

export const FAMILY_LABEL: Record<Family, string> = {
  harris: "Blazer Harris Tweed",
  tweed: "Blazer tweed (hors Harris)",
  croise: "Blazer croisé",
  blazer: "Blazer classique",
  manteau: "Manteau",
  costume: "Costume",
  lot: "Lot groupé",
  gilet: "Gilet",
  pantalon: "Pantalon",
  chemise: "Chemise",
  accessoire: "Accessoire",
  autre: "Autre",
};
export const FAMILIES = Object.keys(FAMILY_LABEL) as Family[];
export const BLAZER_FAMILIES: Family[] = ["harris", "tweed", "croise", "blazer"];

export interface Described { title: string | null; brand: string | null; category: string | null }

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** The item's type. The order matters: a Harris Tweed coat is a coat, a double-breasted Harris is a Harris. */
export function familyOf({ title, brand, category }: Described): Family {
  const t = fold(title ?? "");
  const b = fold(brand ?? "");
  const c = fold(category ?? "");
  if (/\b(manteau|pardessus|caban|trench|duffle|loden|parka|impermeable|crombie)/.test(t) || c.startsWith("manteau") || b.startsWith("manteau")) return "manteau";
  if (/^\s*lot\s+(de\s+)?\d+\s+(articles?|pieces?|vestes?|blazers?)/.test(t)) return "lot";
  const jacketOnly = /veste de costume|^\s*blazer/.test(t);
  if ((/\b(costume|complet\b|smoking)/.test(t) || c.startsWith("costume")) && !jacketOnly) return "costume";
  if (/\bgilet\b/.test(t)) return "gilet";
  if (/\b(pantalon|chino|jean)\b/.test(t)) return "pantalon";
  if (/\bchemise/.test(t)) return "chemise";
  if (/\b(cravate|noeud|pochette|bretelle)/.test(t)) return "accessoire";
  if (t.includes("harris") || b.includes("harris")) return "harris";
  if (/crois/.test(t) || b.includes("crois")) return "croise";
  if (t.includes("tweed") || b.includes("tweed")) return "tweed";
  if (/\b(blazer|veste|jacket|sport coat)/.test(t) || c.startsWith("blazer") || c.startsWith("veste")) return "blazer";
  return "autre";
}

/** Designer brands the titles name. The more precise lines first (« Polo Ralph Lauren » before « Ralph Lauren »). */
export const DESIGNER_BRANDS: { name: string; re: RegExp }[] = [
  { name: "Burberry", re: /burberr/ },
  { name: "Yves Saint Laurent", re: /yves\s*saint|saint\s*laurent|\bysl\b/ },
  { name: "Christian Dior", re: /\bdior\b/ },
  { name: "Double RL", re: /double\s*rl\b|\brrl\b/ },
  { name: "Polo Ralph Lauren", re: /polo\s*(by\s*)?ralph/ },
  { name: "Lauren Ralph Lauren", re: /lauren\s+ralph\s+lauren/ },
  { name: "Chaps Ralph Lauren", re: /\bchap['’]?s\b/ },
  { name: "Ralph Lauren", re: /ralph\s*lauren/ },
  { name: "Loro Piana", re: /loro\s*piana/ },
  { name: "Ermenegildo Zegna", re: /zegna/ },
  { name: "Giorgio Armani", re: /giorgio\s*armani/ },
  { name: "Armani Collezioni", re: /armani\s*collezioni/ },
  { name: "Emporio Armani", re: /empor?io\s*armani/ },
  { name: "Armani", re: /armani/ },
  { name: "Canali", re: /\bcanali\b/ },
  { name: "Corneliani", re: /corneliani/ },
  { name: "Suitsupply", re: /suit\s*supply/ },
  { name: "Boggi", re: /\bboggi\b/ },
  { name: "Lanvin", re: /lanvin/ },
  { name: "Givenchy", re: /givenchy/ },
  { name: "Aquascutum", re: /aquascutum/ },
  { name: "Daks", re: /\bdaks\b/ },
  { name: "Brooks Brothers", re: /brooks\s*brothers/ },
  { name: "Hackett", re: /hackett/ },
  { name: "Hugo Boss", re: /hugo\s*boss|\bboss\b/ },
  { name: "Barbour", re: /barbour/ },
  { name: "Carhartt", re: /carhartt/ },
  { name: "Paul Smith", re: /paul\s*smith/ },
  { name: "Hermès", re: /\bhermes\b/ },
  { name: "Gucci", re: /gucci/ },
  { name: "Prada", re: /\bprada\b/ },
  { name: "Valentino", re: /valentino/ },
  { name: "Versace", re: /versace/ },
  { name: "Kenzo", re: /kenzo/ },
  { name: "Cerruti", re: /cerruti/ },
  { name: "Façonnable", re: /faconnable/ },
  { name: "Old England", re: /old\s*england/ },
  { name: "Smalto", re: /smalto/ },
  { name: "Tommy Hilfiger", re: /tommy\s*hilfiger/ },
  { name: "Pierre Cardin", re: /pierre\s*cardin/ },
  { name: "Ted Lapidus", re: /lapidus/ },
  { name: "Guy Laroche", re: /guy\s*laroche/ },
  { name: "Daniel Hechter", re: /hechter/ },
  { name: "Dormeuil", re: /dormeuil/ },
];

/** The designer brand of the item (title, then its brand field), or null when it names none */
export function designerOf({ title, brand }: Pick<Described, "title" | "brand">): string | null {
  const t = fold(`${title ?? ""} ${brand ?? ""}`);
  for (const b of DESIGNER_BRANDS) if (b.re.test(t)) return b.name;
  return null;
}

export const SIZES = ["XS", "S", "M", "L", "XL", "XXL", "3XL+"] as const;
export type Size = (typeof SIZES)[number];

const letter = (s: string): Size | null => {
  const u = s.toUpperCase();
  if (/^(XXXL|[3-6]XL)$/.test(u)) return "3XL+";
  return (SIZES as readonly string[]).includes(u) ? (u as Size) : null;
};
/** EU jacket sizes as the listings write them (« Taille EU 52 (L) », « 54 (XL) », « 56 (XXL) ») */
const EU: Record<number, Size> = { 42: "XS", 44: "XS", 46: "S", 48: "M", 50: "L", 52: "L", 54: "XL", 56: "XXL", 58: "XXL" };

/** The size on one scale: the size field first, then a letter size in the title, then an EU size in the title */
export function sizeOf(title: string | null, sizeLabel: string | null): Size | null {
  const first = (sizeLabel ?? "").split("/")[0].trim();
  const fromLabel = letter(first);
  if (fromLabel) return fromLabel;
  const t = title ?? "";
  const m = t.match(/(?<![\w'’])(XXXL|[3-6]XL|XXL|XL|XS|S|M|L)(?![\w'’])/);
  if (m) return letter(m[1]);
  const eu = t.match(/(?:EU|taille|T\.?)\s*(4[2-9]|5\d|6[0-4])\b/i) ?? t.match(/\b(4[4-9]|5\d|6[0-2])\s*(?:EU|\()/);
  if (eu) {
    const n = Number(eu[1]);
    return n >= 60 ? "3XL+" : EU[n] ?? null;
  }
  const n = Number(first);
  if (first && Number.isFinite(n)) return n >= 60 ? "3XL+" : EU[n] ?? null;
  return null;
}

/** A purchase price this low was never really entered (an import puts 0 or 1 €) */
export const UNKNOWN_COST_MAX = 100;
/** The price assumed when it is unknown: Harris, coats and suits 10 €, other pieces 4 €, a bundle 4 € a piece */
export const ESTIMATED_COST: Partial<Record<Family, number>> = { harris: 1000, manteau: 1000, costume: 1000 };
export const DEFAULT_ESTIMATED_COST = 400;

export function estimatedCost(family: Family, title: string | null): number {
  if (family === "lot") {
    const m = fold(title ?? "").match(/^\s*lot\s+(?:de\s+)?(\d+)/);
    return DEFAULT_ESTIMATED_COST * Math.min(Math.max(Number(m?.[1] ?? 2), 1), 20);
  }
  return ESTIMATED_COST[family] ?? DEFAULT_ESTIMATED_COST;
}

/** The cost to count: the recorded one, or the assumed one when it was never entered */
export function costUsed(recorded: number, family: Family, title: string | null): { cents: number; estimated: boolean } {
  return recorded > UNKNOWN_COST_MAX ? { cents: recorded, estimated: false } : { cents: estimatedCost(family, title), estimated: true };
}

/** Share of the resale price worth paying at most (the rule of the Harris: 10 € for 40 €) */
export const MAX_BUY_SHARE = 0.25;
