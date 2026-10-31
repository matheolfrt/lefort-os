// Unit tests of the « Niches Vinted » collector (src/lib/market/collect.ts), against a fake Vinted answering like the
// real one (shapes only: the figures here are test data, never shown in the app). Run: npm run test:market
import assert from "node:assert/strict";
import { catalogPath, collect, listingState, normalizeListing, parseVintedUrl, vintedSearchUrl, type Job, type Payload } from "../src/lib/market/collect";

let passed = 0;
const tests: [string, () => Promise<void> | void][] = [];
const test = (name: string, fn: () => Promise<void> | void) => tests.push([name, fn]);

test("adresse Vinted → filtres", () => {
  const a = parseVintedUrl("https://www.vinted.fr/catalog?search_text=costume%20laine&catalog[]=2050&brand_ids[]=53&brand_ids[]=88&size_ids[]=208&price_from=10&price_to=60&order=newest_first");
  assert.deepEqual(a, { domain: "www.vinted.fr", query: { search_text: "costume laine", catalog_ids: [2050], brand_ids: [53, 88], size_ids: [208], price_from: 10, price_to: 60 } });
  assert.deepEqual(parseVintedUrl("https://www.vinted.fr/catalog/2050-costumes")?.query, { catalog_ids: [2050] });
  assert.equal(parseVintedUrl("https://www.leboncoin.fr/recherche?text=costume"), null, "seulement Vinted");
  assert.equal(parseVintedUrl("https://www.vinted.fr/catalog"), null, "une recherche sans filtre ne veut rien dire");
  assert.equal(parseVintedUrl("pas une adresse"), null);
});

test("requête au catalogue : les plus récentes d'abord", () => {
  const p = catalogPath({ search_text: "blazer", catalog_ids: [1, 2], price_to: 30 }, 2);
  assert.match(p, /^\/api\/v2\/catalog\/items\?/);
  const q = new URLSearchParams(p.split("?")[1]);
  assert.equal(q.get("order"), "newest_first"); assert.equal(q.get("page"), "2"); assert.equal(q.get("catalog_ids"), "1,2"); assert.equal(q.get("price_to"), "30");
  assert.match(vintedSearchUrl("www.vinted.fr", { search_text: "blazer", catalog_ids: [1] }), /catalog\?order=newest_first&search_text=blazer&catalog%5B%5D=1/);
});

test("annonce : prix (objet ou texte), marque, date de publication ; rien d'inventé", () => {
  const a = normalizeListing({ id: 42, title: "Blazer", price: { amount: "12.5", currency_code: "EUR" }, brand_title: "Zara", size_title: "M", status: "Très bon état",
    photo: { url: "https://images1.vinted.net/x.jpg", high_resolution: { timestamp: 1761800000 } }, user: { id: 9, login: "lea" }, favourite_count: 3, url: "https://www.vinted.fr/items/42-blazer" }, "www.vinted.fr")!;
  assert.equal(a.price_cents, 1250); assert.equal(a.currency, "EUR"); assert.equal(a.brand, "Zara"); assert.equal(a.created_ts, 1761800000);
  assert.equal(a.seller_login, "lea"); assert.equal(a.favourites, 3); assert.equal(a.views, null, "absent : laissé vide");
  const b = normalizeListing({ id: "43", price: "9,90", currency: "EUR" }, "www.vinted.fr")!;
  assert.equal(b.price_cents, 990); assert.equal(b.url, "https://www.vinted.fr/items/43"); assert.equal(b.created_ts, null); assert.equal(b.brand, null);
  assert.equal(normalizeListing({ title: "sans id" }, "www.vinted.fr"), null);
});

test("état d'une annonce revue", () => {
  assert.equal(listingState(200, { item: { id: 1, is_closed: true, item_closing_action: "sold" } }), "sold");
  assert.equal(listingState(200, { item: { id: 1, is_closed: true } }), "sold");
  assert.equal(listingState(200, { item: { id: 1, is_closed: true, item_closing_action: "deleted" } }), "gone");
  assert.equal(listingState(200, { item: { id: 1, is_reserved: true } }), "reserved");
  assert.equal(listingState(200, { item: { id: 1 } }), "active");
  assert.equal(listingState(404, null), "gone");
  assert.equal(listingState(403, null), "unavailable", "un refus n'est jamais une vente");
  assert.equal(listingState(200, { error: "x" }), "unavailable");
});

// ── a fake Vinted ──────────────────────────────────────────────────────────────────────────────────────────────
interface FakeOpts { block?: boolean; items?: number; detailsPath?: "details" | "plain" | "none"; sold?: number[]; deleted?: number[]; slowDownAfter?: number }
function fakeVinted(o: FakeOpts) {
  const calls: string[] = []; let n = 0;
  const all = Array.from({ length: o.items ?? 150 }, (_, i) => ({ id: 1000 + i, title: `Annonce ${i}`, price: { amount: "20.0", currency_code: "EUR" }, brand_title: i % 2 ? "Zara" : "Boggi", user: { id: 1, login: "x" } }));
  const json = (status: number, body: unknown, cookie?: string) => new Response(JSON.stringify(body), { status, headers: cookie ? { "set-cookie": cookie } : {} });
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)); calls.push(url.pathname + url.search); n++;
    const cookie = new Headers(init?.headers).get("Cookie") ?? "";
    if (o.block) return new Response("blocked", { status: 403 });
    if (url.pathname === "/") return new Response("<html>", { status: 200, headers: { "set-cookie": "access_token_web=abc; Path=/; HttpOnly" } });
    if (!cookie.includes("access_token_web=abc")) return json(401, { error: "no session" });
    if (o.slowDownAfter && n > o.slowDownAfter) return json(429, {});
    if (url.pathname === "/api/v2/catalog/items") {
      const page = Number(url.searchParams.get("page")), per = Number(url.searchParams.get("per_page"));
      return json(200, { items: all.slice((page - 1) * per, page * per), pagination: { total_pages: Math.ceil(all.length / per) } });
    }
    const m = url.pathname.match(/^\/api\/v2\/items\/(\d+)(\/details)?$/);
    if (m) {
      const kind = m[2] ? "details" : "plain";
      if ((o.detailsPath ?? "details") !== kind) return json(404, {});
      const id = Number(m[1]);
      if (o.deleted?.includes(id)) return json(404, {});
      return json(200, { item: { id, is_closed: o.sold?.includes(id) ?? false, item_closing_action: o.sold?.includes(id) ? "sold" : null } });
    }
    return json(404, {});
  }) as typeof fetch;
  return { f, calls };
}
const link = (recheck: number[] = []) => {
  const sent: { id: string; p: Payload }[] = [];
  const jobs: Job[] = [{ id: "s1", name: "Costume laine", domain: "www.vinted.fr", query: { search_text: "costume laine" }, known: 0, recheck }];
  return { sent, l: { jobs: async () => jobs, ingest: async (id: string, p: Payload) => { sent.push({ id, p }); return {}; } } };
};

test("passage : session anonyme, toutes les pages nouvelles, puis arrêt", async () => {
  const v = fakeVinted({ items: 150 }), { sent, l } = link();
  const s = await collect({ link: l, fetchImpl: v.f, delayMs: 0, maxPages: 5 });
  assert.equal(sent.length, 1); assert.equal(sent[0].p.ok, true); assert.equal(sent[0].p.items.length, 150);
  assert.equal(sent[0].p.pages, 2, "2 pages de 96 suffisent pour 150 annonces");
  assert.ok(sent[0].p.sample_keys.includes("brand_title"), "les noms des champs sont gardés pour diagnostic");
  assert.equal(v.calls[0], "/"); assert.ok(s.searches[0].ok);
});

test("Vinted refuse : passage enregistré en échec avec sa réponse, aucune annonce inventée", async () => {
  const v = fakeVinted({ block: true }), { sent, l } = link([5, 6]);
  const s = await collect({ link: l, fetchImpl: v.f, delayMs: 0 });
  assert.equal(sent[0].p.ok, false); assert.equal(sent[0].p.http_status, 403); assert.match(sent[0].p.error!, /bloqué/);
  assert.equal(sent[0].p.items.length, 0); assert.equal(sent[0].p.checks.length, 0); assert.equal(s.searches[0].ok, false);
});

test("annonces revues : vendue, disparue, toujours en vente (adresse détectée)", async () => {
  const v = fakeVinted({ items: 10, detailsPath: "plain", sold: [1001], deleted: [1002] }), { sent, l } = link([1001, 1002, 1003]);
  await collect({ link: l, fetchImpl: v.f, delayMs: 0 });
  assert.deepEqual(sent[0].p.checks, [{ id: 1001, state: "sold" }, { id: 1002, state: "gone" }, { id: 1003, state: "active" }]);
});

test("si aucune adresse de fiche ne répond, un 404 n'est pas compté comme disparition", async () => {
  const v = fakeVinted({ items: 10, detailsPath: "none" }), { sent, l } = link([1001, 1002]);
  await collect({ link: l, fetchImpl: v.f, delayMs: 0 });
  assert.deepEqual(sent[0].p.checks.map((c) => c.state), ["unavailable", "unavailable"]);
});

test("Vinted demande de ralentir : les vérifications s'arrêtent", async () => {
  const v = fakeVinted({ items: 10, slowDownAfter: 4 }), { sent, l } = link([1001, 1002, 1003, 1004, 1005]);
  await collect({ link: l, fetchImpl: v.f, delayMs: 0 });
  assert.ok(sent[0].p.checks.length < 5, "arrêt après le 429");
  assert.equal(sent[0].p.checks.at(-1)?.state, "unavailable");
});

test("limite de requêtes (Cloudflare) respectée", async () => {
  const v = fakeVinted({ items: 400 }), { l } = link(Array.from({ length: 50 }, (_, i) => 1000 + i));
  const s = await collect({ link: l, fetchImpl: v.f, delayMs: 0, maxRequests: 10, maxPages: 5 });
  assert.ok(v.calls.length <= 10, `${v.calls.length} requêtes`); assert.ok(s.requests <= 10);
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed++; console.log(`ok  ${name}`); }
    catch (e) { console.error(`FAIL ${name}\n    ${(e as Error).message}`); process.exitCode = 1; }
  }
  console.log(`\n${passed} tests réussis${process.exitCode ? ", des échecs" : ""}`);
})();
