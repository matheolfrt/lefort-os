// « Attractivité des annonces »: references from the shop's own listings, one verdict per listing online, funnel and
// segments. Run: npm run test:attractivite
import assert from "node:assert/strict";
import { analyse, median, type ListingIn, type StatPoint } from "../src/lib/listing-performance";

const now = new Date("2026-11-03T12:00:00Z");
const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
let n = 0;
const L = (o: Partial<ListingIn>): ListingIn => ({
  ext: `x${++n}`, state: "active", title: `Annonce ${n}`, url: null, photo: null, price: 3000,
  views: 100, favourites: 5, offers: 0, since: ago(20), brand: "Ralph Lauren", category: "Pull", ...o,
});

assert.equal(median([]), null);
assert.equal(median([3, 1, 2]), 2);
assert.equal(median([4, 1, 3, 2]), 2.5);
console.log("ok  médiane");

// Ten settled listings at 5 views a day and 5 % favourites: the shop's normal
const normal = Array.from({ length: 10 }, () => L({ views: 100, favourites: 5, since: ago(20) }));
const sold = Array.from({ length: 6 }, () => L({ state: "sold", views: 120, favourites: 8, since: ago(30) }));
const offer = L({ offers: 1, views: 40, favourites: 1 });
const liked = L({ views: 150, favourites: 9 });
const unseen = L({ views: 20, favourites: 1 });                  // 1 view a day for a shop at 5
const unliked = L({ views: 200, favourites: 1 });                // well seen, 0.5 % favourites for a shop at 6.7 %
const young = L({ views: 2, favourites: 0, since: ago(3) });     // too early to judge
const unread = L({ views: null, favourites: null });             // the sync has not read its counters
const hidden = L({ state: "hidden", views: 5, favourites: 0 });
const reserved = L({ state: "reserved", offers: 1 });             // already has its buyer
const almost = L({ views: 150, favourites: 7 });                  // above most listings, below what sold ones had (8)

const p = analyse([...normal, ...sold, offer, liked, unseen, unliked, young, unread, hidden, reserved, almost], [], now);
assert.equal(p.refs.viewsPerDay, 5);
assert.equal(Math.round((p.refs.favRate ?? 0) * 10) / 10, 6.7, "the rate of sold listings wins when there are 5 or more");
assert.equal(p.refs.likedFrom, 6, "top quarter and above the median of settled favourites, at least 3");
assert.equal(p.refs.soldViews, 120);
assert.equal(p.refs.soldFavourites, 8);
assert.equal(p.refs.soldCount, 6);
console.log("ok  repères : vues par jour, taux de favoris des ventes, seuil « aimée »");

const verdict = (l: ListingIn) => p.rows.find((r) => r.ext === l.ext)?.verdict;
assert.equal(verdict(offer), "offer");
assert.equal(verdict(liked), "liked");
assert.equal(verdict(unseen), "unseen");
assert.equal(verdict(unliked), "unliked");
assert.equal(verdict(young), "new");
assert.equal(verdict(unread), "new");
assert.equal(verdict(normal[0]), "fine", "as many favourites as most listings: nothing special");
assert.equal(verdict(almost), "fine", "« liked » needs as many favourites as the listings that sold");
assert.equal(verdict(hidden), undefined, "hidden and sold listings are not to act on");
assert.equal(verdict(reserved), undefined, "a reserved listing has its buyer");
assert.equal(p.rows.length, 17);
assert.deepEqual(p.rows.slice(0, 2).map((r) => r.verdict), ["offer", "liked"], "most urgent first");
assert.equal(p.withStats, 24, "every listing with a view counter, hidden and sold included");
console.log("ok  verdicts : offre, aimée, peu vue, pas aimée, trop récente, compteurs absents");

// A favourite rate needs 30 views: below, a listing is never called « not liked »
const few = analyse([...normal, L({ views: 25, favourites: 0, since: ago(5 + 2) })], [], now);
assert.notEqual(few.rows.at(-1)?.verdict, "unliked");
console.log("ok  pas de verdict sur le taux de favoris sous 30 vues");

// Fewer than 5 sold listings with a rate: the listings online set the favourite rate
const online = analyse([...normal, ...sold.slice(0, 2)], [], now);
assert.equal(online.refs.favRate, 5);
console.log("ok  repère de favoris pris sur les annonces en ligne quand il y a trop peu de ventes");

// History: views of the last 7 days, and an offer only counts when it is new
const a = L({ ext: "h1", views: 300, favourites: 2, offers: 1 });
const b = L({ ext: "h2", views: 300, favourites: 2, offers: 2 });
const stats: StatPoint[] = [
  { ext: "h1", day: "2026-10-20", views: 200, favourites: 1, offers: 1 },
  { ext: "h1", day: "2026-10-27", views: 280, favourites: 2, offers: 1 },   // exactly 7 days ago: the reference
  { ext: "h1", day: "2026-10-30", views: 290, favourites: 2, offers: 1 },   // too recent
  { ext: "h2", day: "2026-10-25", views: 250, favourites: 2, offers: 1 },
];
const h = analyse([...normal, a, b], stats, now);
const row = (ext: string) => h.rows.find((r) => r.ext === ext)!;
assert.equal(row("h1").views7, 20);
assert.notEqual(row("h1").verdict, "offer", "an offer already there a week ago has been seen");
assert.equal(row("h2").views7, 50);
assert.equal(row("h2").verdict, "offer", "a second offer this week");
assert.equal(row(normal[0].ext).views7, null, "no history, no weekly figure");
console.log("ok  historique : vues sur 7 jours, seule une nouvelle offre compte");

// Funnel and segments
assert.equal(p.funnel.sold, 6);
assert.equal(p.funnel.favourites, 10 * 5 + 6 * 8 + 1 + 9 + 1 + 1 + 0 + 0 + 5 + 7);
assert.equal(p.funnel.views, 10 * 100 + 6 * 120 + 40 + 150 + 20 + 200 + 2 + 5 + 100 + 150);
const seg = analyse([
  L({ brand: "Barbour", category: "Veste", views: 300, favourites: 30 }),
  L({ brand: "Barbour", category: "Veste", views: 100, favourites: 10 }),
  L({ brand: "Barbour", category: "Veste", state: "sold", views: 60, favourites: 6 }),
  L({ brand: "Levi's", category: "Jean", views: 50, favourites: 1 }),
  L({ brand: " ", category: null, views: 10, favourites: 0 }),
], [], now);
assert.deepEqual(seg.brands.map((s) => s.name), ["Barbour"], "a segment needs 3 listings");
const barbour = seg.brands[0];
assert.equal(barbour.online, 2);
assert.equal(barbour.sold, 1);
assert.equal(barbour.viewsPerDay, 10);
assert.equal(barbour.favRate, 10);
assert.equal(barbour.viewsPerSale, 60);
assert.deepEqual(seg.categories.map((s) => s.name), ["Veste"]);
console.log("ok  entonnoir vues → favoris → vente, segments par marque et catégorie");

// Nothing read yet
const empty = analyse([L({ views: null, favourites: null }), L({ state: "sold", views: null, favourites: null })], [], now);
assert.equal(empty.withStats, 0);
assert.equal(empty.refs.viewsPerDay, null);
assert.equal(empty.refs.soldViews, null);
assert.equal(empty.rows[0].verdict, "new");
console.log("ok  sans compteurs : rien n'est jugé");
