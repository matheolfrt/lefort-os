// The collector of « Niches Vinted »: reads the searches to follow from Lefort OS, reads Vinted's public catalogue
// (newest listings first) and the page of listings already known (still for sale, reserved, sold or gone), and sends
// back exactly what Vinted answered. No dependency: the same code runs on GitHub Actions (Node), on the Vercel server
// and in a Cloudflare Worker. Requests are spaced out, anonymous (no Vinted account), and never retried around a
// refusal: when Vinted says no, the pass is recorded as failed with its answer, so the figures are never silently
// incomplete.

export interface MarketQuery {
  search_text?: string;
  catalog_ids?: number[]; brand_ids?: number[]; size_ids?: number[]; status_ids?: number[];
  color_ids?: number[]; material_ids?: number[];
  price_from?: number; price_to?: number;
}
export interface Job { id: string; name: string; domain: string; query: MarketQuery; known: number; recheck: (number | string)[] }
export interface Listing {
  id: number; title: string | null; brand: string | null; size: string | null; condition: string | null;
  price_cents: number | null; currency: string | null; photo_url: string | null; url: string | null;
  seller_id: number | null; seller_login: string | null; favourites: number | null; views: number | null; created_ts: number | null;
}
export type CheckState = "active" | "reserved" | "sold" | "gone" | "unavailable";
export interface Payload {
  ok: boolean; http_status: number | null; error: string | null; pages: number; duration_ms: number; sample_keys: string[];
  items: Listing[]; checks: { id: number; state: CheckState }[];
}
/** Where the jobs come from and where the results go (a collector key over HTTP, or a signed-in manager) */
export interface LefortLink {
  jobs(recheck: number, searchId?: string): Promise<Job[]>;
  ingest(searchId: string, payload: Payload): Promise<unknown>;
}
export interface CollectOptions {
  link: LefortLink;
  fetchImpl?: typeof fetch;
  maxPages?: number;        // catalogue pages (96 listings each) per search and pass
  maxChecks?: number;       // known listings looked at again per search and pass
  maxRequests?: number;     // to Vinted, for the whole pass (a Cloudflare Worker is limited)
  maxSearches?: number;
  delayMs?: number;         // between two requests to Vinted
  searchId?: string;
  log?: (line: string) => void;
}
export interface CollectSummary { searches: { id: string; name: string; ok: boolean; http: number | null; seen: number; checked: number; error: string | null }[]; requests: number }

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const LIST_KEYS = ["catalog_ids", "brand_ids", "size_ids", "status_ids", "color_ids", "material_ids"] as const;

// ── Searches ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** A Vinted search page (https://www.vinted.fr/catalog?search_text=…&catalog[]=…&brand_ids[]=…) → domain and filters */
export function parseVintedUrl(input: string): { domain: string; query: MarketQuery } | null {
  let u: URL;
  try { u = new URL(input.trim()); } catch { return null; }
  if (!/^www\.vinted\.[a-z]{2,3}(\.[a-z]{2})?$/.test(u.hostname)) return null;
  const q: MarketQuery = {};
  const text = u.searchParams.get("search_text")?.trim();
  if (text) q.search_text = text;
  const ids = (names: string[]) => [...new Set(names.flatMap((n) => u.searchParams.getAll(n)).flatMap((v) => v.split(",")).map(Number)
    .filter((n) => Number.isInteger(n) && n > 0))];
  for (const k of LIST_KEYS) {
    const base = k.replace(/_ids$/, "");
    const found = ids([`${k}[]`, k, `${base}[]`, base === "catalog" ? "catalog" : ""].filter(Boolean));
    if (found.length) q[k] = found.slice(0, 50);
  }
  for (const k of ["price_from", "price_to"] as const) {
    const v = Number(u.searchParams.get(k)?.replace(",", "."));
    if (Number.isFinite(v) && v > 0) q[k] = v;
  }
  // a catalogue page without any filter in its address: /catalog/2050-costumes
  const cat = u.pathname.match(/\/catalog\/(\d+)/)?.[1];
  if (cat && !q.catalog_ids) q.catalog_ids = [Number(cat)];
  if (!q.search_text && !LIST_KEYS.some((k) => q[k]?.length)) return null;
  return { domain: u.hostname, query: q };
}

export function catalogPath(query: MarketQuery, page: number, perPage = 96) {
  const p = new URLSearchParams({ page: String(page), per_page: String(perPage), order: "newest_first" });
  if (query.search_text) p.set("search_text", query.search_text);
  for (const k of LIST_KEYS) if (query[k]?.length) p.set(k, query[k]!.join(","));
  if (query.price_from) p.set("price_from", String(query.price_from));
  if (query.price_to) p.set("price_to", String(query.price_to));
  return `/api/v2/catalog/items?${p}`;
}

/** The address of the same search on Vinted, to open it there */
export function vintedSearchUrl(domain: string, query: MarketQuery) {
  const p = new URLSearchParams({ order: "newest_first" });
  if (query.search_text) p.set("search_text", query.search_text);
  for (const k of LIST_KEYS) for (const v of query[k] ?? []) p.append(`${k === "catalog_ids" ? "catalog" : k}[]`, String(v));
  if (query.price_from) p.set("price_from", String(query.price_from));
  if (query.price_to) p.set("price_to", String(query.price_to));
  return `https://${domain}/catalog?${p}`;
}

// ── What Vinted answers ──────────────────────────────────────────────────────────────────────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
const num = (v: any): number | null => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const str = (v: any): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

/** One listing of the catalogue → the fields Lefort OS keeps (unknown fields are left empty, never guessed) */
export function normalizeListing(raw: any, domain: string): Listing | null {
  const id = num(raw?.id);
  if (!id || !Number.isInteger(id)) return null;
  const amount = num(raw?.price?.amount ?? raw?.price);
  const ts = num(raw?.photo?.high_resolution?.timestamp ?? raw?.photos?.[0]?.high_resolution?.timestamp)
    ?? (typeof raw?.created_at_ts === "string" ? Math.floor(Date.parse(raw.created_at_ts) / 1000) : num(raw?.created_at_ts));
  return {
    id,
    title: str(raw?.title),
    brand: str(raw?.brand_title ?? raw?.brand?.title ?? raw?.brand),
    size: str(raw?.size_title ?? raw?.size?.title ?? raw?.size),
    condition: typeof raw?.status === "string" ? raw.status : str(raw?.status_title ?? raw?.status?.title),
    price_cents: amount == null ? null : Math.round(amount * 100),
    currency: str(raw?.price?.currency_code ?? raw?.currency),
    photo_url: str(raw?.photo?.url ?? raw?.photos?.[0]?.url),
    url: str(raw?.url) ?? `https://${domain}/items/${id}`,
    seller_id: num(raw?.user?.id),
    seller_login: str(raw?.user?.login),
    favourites: num(raw?.favourite_count ?? raw?.favorite_count),
    views: num(raw?.view_count),
    created_ts: ts && Number.isFinite(ts) ? Math.floor(ts) : null,
  };
}

/** What the page of a known listing says: sold, reserved, still for sale, or gone (deleted, or sold and hidden) */
export function listingState(http: number, body: any): CheckState {
  if (http === 404 || http === 410) return "gone";
  if (http !== 200 || !body) return "unavailable";
  const it = body.item ?? body;
  const action = String(it?.item_closing_action ?? it?.closing_action ?? "").toLowerCase();
  if (it?.is_sold === true || action === "sold") return "sold";
  if (it?.is_closed === true) return action ? "gone" : "sold";
  if (it?.is_reserved === true) return "reserved";
  if (it?.id == null) return "unavailable";
  return "active";
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── A Vinted visit: the anonymous session cookie the site gives to any visitor, then its public JSON ───────────────
function setCookies(h: Headers): string[] {
  const any = h as Headers & { getSetCookie?: () => string[] };
  if (typeof any.getSetCookie === "function") return any.getSetCookie();
  const one = h.get("set-cookie");
  return one ? one.split(/,(?=\s*[A-Za-z0-9_.-]+=)/) : [];
}

class Visit {
  cookies = new Map<string, string>();
  requests = 0;
  /** who answered a refusal (anti-bot service), read from the response headers: diagnosis only */
  guard: string | null = null;
  constructor(private domain: string, private fetchImpl: typeof fetch, private budget: { left: number }) {}
  private keep(h: Headers) {
    for (const c of setCookies(h)) { const [pair] = c.split(";"); const i = pair.indexOf("="); if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim()); }
  }
  private headers(json: boolean) {
    const h: Record<string, string> = { "User-Agent": UA, "Accept-Language": "fr-FR,fr;q=0.9", Accept: json ? "application/json, text/plain, */*" : "text/html" };
    if (this.cookies.size) h.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    return h;
  }
  async open() {
    if (this.budget.left-- <= 0) throw new Error("budget");
    this.requests++;
    const res = await this.fetchImpl(`https://${this.domain}/`, { headers: this.headers(false), redirect: "follow" });
    this.keep(res.headers);
    if (res.status >= 400) this.guard = guardOf(res.headers);
    await res.text().catch(() => "");
    return res.status;
  }
  async json(path: string): Promise<{ status: number; body: unknown }> {
    if (this.budget.left-- <= 0) throw new Error("budget");
    this.requests++;
    const res = await this.fetchImpl(`https://${this.domain}${path}`, { headers: this.headers(true) });
    this.keep(res.headers);
    if (res.status >= 400) this.guard = guardOf(res.headers);
    const text = await res.text().catch(() => "");
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    return { status: res.status, body };
  }
}

function guardOf(h: Headers): string | null {
  const cookies = setCookies(h).join(" ").toLowerCase();
  if (h.get("x-datadome") || h.get("x-dd-b") || cookies.includes("datadome")) return "DataDome";
  if (h.get("cf-mitigated") || (h.get("server") ?? "").toLowerCase().includes("cloudflare")) return "Cloudflare";
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const why = (status: number, step: "accueil" | "catalogue", guard: string | null = null) =>
  status === 403 ? `Vinted a refusé la requête (403${guard ? `, protection ${guard}` : ""}) dès ${step === "accueil" ? "la page d'accueil" : "le catalogue"} : l'adresse de ce collecteur est bloquée.` :
  status === 429 ? "Vinted demande de ralentir (429)." :
  status === 401 ? "Vinted n'a pas accepté la session anonyme (401)." :
  `Vinted a répondu ${status}.`;

/** One pass: every active search (or one), its newest listings, and the known listings looked at again */
export async function collect(o: CollectOptions): Promise<CollectSummary> {
  const fetchImpl = o.fetchImpl ?? fetch;
  const maxPages = Math.max(1, Math.min(o.maxPages ?? 3, 20));
  const maxChecks = Math.max(0, Math.min(o.maxChecks ?? 120, 1000));
  const delay = Math.max(0, o.delayMs ?? 1200);
  const budget = { left: o.maxRequests ?? 10_000 };
  const log = o.log ?? (() => {});
  const jobs = (await o.link.jobs(maxChecks, o.searchId)).slice(0, o.maxSearches ?? 1000);
  const visits = new Map<string, Visit>();
  const out: CollectSummary = { searches: [], requests: 0 };

  for (const job of jobs) {
    const t0 = Date.now();
    const pay: Payload = { ok: true, http_status: null, error: null, pages: 0, duration_ms: 0, sample_keys: [], items: [], checks: [] };
    try {
      let v = visits.get(job.domain);
      if (!v) {
        v = new Visit(job.domain, fetchImpl, budget);
        const s = await v.open();
        if (s >= 400) { pay.ok = false; pay.http_status = s; pay.error = why(s, "accueil", v.guard); }
        visits.set(job.domain, v);
        await sleep(delay);
      }
      // newest listings first, page by page, until a page has nothing new for this pass
      const seen = new Set<number>();
      for (let page = 1; pay.ok && page <= maxPages; page++) {
        const r = await v.json(catalogPath(job.query, page));
        pay.http_status = r.status;
        if (r.status !== 200) { pay.ok = false; pay.error = why(r.status, "catalogue", v.guard); break; }
        const list = (r.body as { items?: unknown[] })?.items;
        if (!Array.isArray(list)) { pay.ok = false; pay.error = "Réponse de Vinted inattendue (pas de liste d'annonces)."; break; }
        if (page === 1 && list[0] && typeof list[0] === "object") pay.sample_keys = Object.keys(list[0] as object).sort();
        pay.pages = page;
        let fresh = 0;
        for (const raw of list) { const l = normalizeListing(raw, job.domain); if (l && !seen.has(l.id)) { seen.add(l.id); pay.items.push(l); fresh++; } }
        const total = (r.body as { pagination?: { total_pages?: number } })?.pagination?.total_pages;
        if (!fresh || list.length < 96 || (total && page >= total)) break;
        await sleep(delay);
      }
      // known listings: still there, reserved, sold or gone? (a 404 counts as « gone » only if the same address
      // answered normally for another listing in this pass: otherwise the address itself may have changed)
      if (pay.ok && job.recheck.length) {
        const raw: { id: number; status: number; body: unknown }[] = [];
        let path: ((id: number) => string) | null = null;
        for (const idv of job.recheck.slice(0, maxChecks)) {
          const id = Number(idv);
          if (budget.left <= 1) break;
          await sleep(delay);
          const candidates: ((x: number) => string)[] = path ? [path] : [(x) => `/api/v2/items/${x}/details`, (x) => `/api/v2/items/${x}`];
          let last = { status: 0, body: null as unknown };
          for (const c of candidates) {
            last = await v.json(c(id));
            if (last.status === 200) { path = c; break; }
            if (last.status === 403 || last.status === 429) break;
          }
          raw.push({ id, ...last });
          if (last.status === 429) break; // asked to slow down: stop checking for this pass
        }
        const addressWorks = path != null;
        for (const r of raw) {
          let s = listingState(r.status, r.body);
          if (s === "gone" && !addressWorks) s = "unavailable";
          pay.checks.push({ id: r.id, state: s });
        }
      }
    } catch (e) {
      pay.ok = pay.ok && (e as Error).message === "budget";
      if ((e as Error).message !== "budget") pay.error = `Erreur réseau : ${(e as Error).message}`.slice(0, 300);
    }
    pay.duration_ms = Date.now() - t0;
    // large passes go in parts
    const parts = Math.max(1, Math.ceil(pay.items.length / 1000));
    for (let i = 0; i < parts; i++) {
      await o.link.ingest(job.id, { ...pay, items: pay.items.slice(i * 1000, (i + 1) * 1000), checks: i === parts - 1 ? pay.checks : [] });
    }
    const line = { id: job.id, name: job.name, ok: pay.ok, http: pay.http_status, seen: pay.items.length, checked: pay.checks.length, error: pay.error };
    out.searches.push(line);
    log(`${job.name} : ${pay.ok ? "ok" : "échec"} (HTTP ${pay.http_status ?? "—"}) · ${pay.items.length} annonces lues · ${pay.checks.length} revues${pay.error ? ` · ${pay.error}` : ""}`);
    if (budget.left <= 1) break;
  }
  out.requests = [...visits.values()].reduce((a, v) => a + v.requests, 0);
  return out;
}

/** Talks to Lefort OS with a collector key (GitHub Actions, Vercel cron, Cloudflare) */
export function keyLink(supabaseUrl: string, anonKey: string, key: string, collector: string, fetchImpl: typeof fetch = fetch): LefortLink {
  const rpc = async (name: string, args: unknown) => {
    const res = await fetchImpl(`${supabaseUrl.replace(/\/+$/, "")}/rest/v1/rpc/${name}`, {
      method: "POST", headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" }, body: JSON.stringify(args),
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(`Lefort OS : ${body?.message ?? res.status}`);
    return body;
  };
  return {
    jobs: async (recheck, searchId) => ((await rpc("market_jobs", { p_token: key, p_recheck: recheck, p_search_id: searchId ?? null })) as { searches: Job[] }).searches,
    ingest: (searchId, payload) => rpc("market_ingest", { p_token: key, p_search_id: searchId, p_collector: collector, p_payload: payload }),
  };
}
