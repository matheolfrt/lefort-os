// « Attractivité des annonces »: why a listing does not sell, read from what Vinted counts (views, favourites, offers,
// collected by the extension's sync). Each listing online is compared with the shop's own references: what its sold
// listings had gathered when they sold, and how fast the other listings online are seen. No AI, no guess about Vinted.

export interface ListingIn {
  ext: string;
  state: "active" | "reserved" | "sold" | "hidden";
  title: string | null;
  url: string | null;
  photo: string | null;
  price: number | null;      // cents
  views: number | null;      // counters since the listing was published
  favourites: number | null;
  offers: number | null;
  since: string;             // when it went online (item listed_at, else first seen by the sync)
  sku?: string | null;
  brand?: string | null;
  category?: string | null;
}
/** Counters as the sync read them on a given day (cumulative) */
export interface StatPoint { ext: string; day: string; views: number | null; favourites: number | null; offers?: number | null }

export type Verdict = "offer" | "liked" | "unseen" | "unliked" | "fine" | "new";

export const VERDICT: Record<Verdict, { name: string; action: string; tone: string }> = {
  offer: { name: "Offre reçue", action: "Répondre à l'offre sur Vinted : quelqu'un est prêt à acheter.", tone: "emerald" },
  liked: { name: "Aimée mais pas achetée", action: "Des gens l'ont mise de côté : une petite baisse (−5 à −10 %) ou une offre aux intéressés suffit souvent à conclure.", tone: "emerald" },
  unseen: { name: "Peu vue", action: "Revoir la première photo et le titre (marque, taille, mot qu'on tape), puis remonter ou republier l'annonce.", tone: "amber" },
  unliked: { name: "Vue mais pas aimée", action: "Les gens la voient et passent : prix trop haut ou photos peu engageantes.", tone: "red" },
  fine: { name: "Dans la normale", action: "Rien à faire pour l'instant.", tone: "zinc" },
  new: { name: "Trop récente", action: "Moins de 7 jours en ligne : on attend pour juger.", tone: "zinc" },
};
/** Most urgent first: an offer can sell today, favourites are buyers to convert, then visibility, then appeal */
export const VERDICT_ORDER: Verdict[] = ["offer", "liked", "unseen", "unliked", "fine", "new"];

/** Below this many views, a favourite rate says nothing */
const MIN_VIEWS_FOR_RATE = 30;
const MIN_AGE_DAYS = 7;

export interface Refs {
  /** median views per day of the listings online for 7 days or more */
  viewsPerDay: number | null;
  /** favourites per 100 views: sold listings when there are enough, else listings online */
  favRate: number | null;
  /** favourites from which a listing counts as « liked »: top quarter and above the median, never below 3 */
  likedFrom: number;
  /** what a sold listing had gathered: medians */
  soldViews: number | null;
  soldFavourites: number | null;
  soldCount: number;
}

export interface Row extends ListingIn {
  verdict: Verdict;
  age: number;                 // days online
  viewsPerDay: number | null;
  views7: number | null;       // views over the last 7 days, when the history allows it
  favRate: number | null;      // favourites per 100 views
}

export interface Segment { name: string; online: number; viewsPerDay: number | null; favRate: number | null; sold: number; viewsPerSale: number | null }

export interface Performance {
  refs: Refs;
  rows: Row[];                  // active listings (a reserved one has its buyer), most urgent first
  counts: Record<Verdict, number>;
  funnel: { views: number; favourites: number; sold: number };
  brands: Segment[];
  categories: Segment[];
  withStats: number;            // listings with a view counter: 0 means the sync has not read them yet
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
}
const days = (from: string, now: Date) => Math.max(0, (now.getTime() - new Date(from).getTime()) / 86_400_000);
const rate = (fav: number | null, views: number | null) =>
  views != null && fav != null && views >= MIN_VIEWS_FOR_RATE ? (fav * 100) / views : null;

/** The last counters read at least 7 days ago: what the listing had a week ago */
function weekAgo(ext: string, history: Map<string, StatPoint[]>, now: Date): StatPoint | undefined {
  const cut = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  return (history.get(ext) ?? []).filter((p) => p.day <= cut).sort((a, b) => (a.day < b.day ? 1 : -1))[0];
}

export function analyse(listings: ListingIn[], stats: StatPoint[] = [], now = new Date()): Performance {
  const history = new Map<string, StatPoint[]>();
  for (const p of stats) history.set(p.ext, [...(history.get(p.ext) ?? []), p]);

  const online = listings.filter((l) => l.state === "active" || l.state === "reserved");
  const sold = listings.filter((l) => l.state === "sold");
  const counted = (l: ListingIn) => l.views != null;

  // references from the shop's own listings
  const settled = online.filter((l) => counted(l) && days(l.since, now) >= MIN_AGE_DAYS);
  const vpd = median(settled.map((l) => (l.views as number) / Math.max(1, days(l.since, now))));
  const soldCounted = sold.filter(counted);
  const soldRates = soldCounted.map((l) => rate(l.favourites, l.views)).filter((x): x is number => x != null);
  const onlineRates = settled.map((l) => rate(l.favourites, l.views)).filter((x): x is number => x != null);
  const favRate = soldRates.length >= 5 ? median(soldRates) : median(onlineRates);
  // well above the usual: in the top quarter, and more than the typical listing (never below 3)
  const favs = settled.map((l) => l.favourites ?? 0);
  const likedFrom = Math.max(3, Math.ceil(quantile(favs, 0.75) ?? 3), Math.floor(median(favs) ?? 0) + 1);
  const refs: Refs = {
    viewsPerDay: vpd, favRate, likedFrom,
    soldViews: median(soldCounted.map((l) => l.views as number)),
    soldFavourites: median(soldCounted.filter((l) => l.favourites != null).map((l) => l.favourites as number)),
    soldCount: sold.length,
  };

  // a reserved listing already has its buyer: it counts in the references, not in the list to act on
  const rows: Row[] = online.filter((l) => l.state === "active").map((l) => {
    const age = days(l.since, now);
    const perDay = l.views != null ? l.views / Math.max(1, age) : null;
    const r = rate(l.favourites, l.views);
    const old = weekAgo(l.ext, history, now);
    // Vinted counts offers since the start: only a new one (this week) still waits for an answer
    const freshOffer = (l.offers ?? 0) > (old ? old.offers ?? 0 : 0);
    let verdict: Verdict = "fine";
    if (freshOffer) verdict = "offer";
    else if (age < MIN_AGE_DAYS || l.views == null) verdict = "new";
    // as many favourites as the listings that sold (and more than most listings online), still not bought
    else if ((l.favourites ?? 0) >= Math.max(likedFrom, refs.soldFavourites ?? 0)) verdict = "liked";
    else if (vpd != null && perDay != null && perDay < vpd * 0.5) verdict = "unseen";
    else if (favRate != null && r != null && r < favRate * 0.5) verdict = "unliked";
    return { ...l, verdict, age: Math.floor(age), viewsPerDay: perDay, views7: l.views != null && old?.views != null ? Math.max(0, l.views - old.views) : null, favRate: r };
  });
  rows.sort((a, b) => VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict) || b.age - a.age);

  const counts = Object.fromEntries(VERDICT_ORDER.map((v) => [v, rows.filter((r) => r.verdict === v).length])) as Record<Verdict, number>;
  const sum = (xs: (number | null)[]) => xs.reduce<number>((a, x) => a + (x ?? 0), 0);
  const funnel = {
    views: sum(listings.map((l) => l.views)),
    favourites: sum(listings.map((l) => l.favourites)),
    sold: sold.length,
  };

  const segment = (key: (l: ListingIn) => string | null | undefined): Segment[] => {
    const groups = new Map<string, ListingIn[]>();
    for (const l of listings) {
      const k = key(l)?.trim();
      if (k) groups.set(k, [...(groups.get(k) ?? []), l]);
    }
    return [...groups].map(([name, ls]) => {
      const on = ls.filter((l) => (l.state === "active" || l.state === "reserved") && counted(l) && days(l.since, now) >= MIN_AGE_DAYS);
      const so = ls.filter((l) => l.state === "sold" && counted(l));
      const views = sum(ls.filter(counted).map((l) => l.views)), favs = sum(ls.filter(counted).map((l) => l.favourites));
      return {
        name,
        online: ls.filter((l) => l.state === "active" || l.state === "reserved").length,
        viewsPerDay: median(on.map((l) => (l.views as number) / Math.max(1, days(l.since, now)))),
        favRate: views >= MIN_VIEWS_FOR_RATE ? (favs * 100) / views : null,
        sold: ls.filter((l) => l.state === "sold").length,
        viewsPerSale: so.length ? sum(so.map((l) => l.views)) / so.length : null,
      };
    }).filter((s) => s.online + s.sold >= 3).sort((a, b) => b.online + b.sold - (a.online + a.sold));
  };

  return {
    refs, rows, counts, funnel,
    brands: segment((l) => l.brand), categories: segment((l) => l.category),
    withStats: listings.filter(counted).length,
  };
}
