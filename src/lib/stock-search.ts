// The Stock search: every word must match somewhere (SKU, title, size or brand), and a word written with a minus
// (« -harris ») must match nowhere. « blazer tweed -harris » = tweed blazers that are not Harris Tweed.
// Words can be grouped with quotes: « -"harris tweed" ».

export interface SearchTerms { include: string[]; exclude: string[] }

const clean = (w: string) => w.replace(/[%,()*"\\]/g, " ").replace(/\s+/g, " ").trim();

export function parseSearch(q: string | null | undefined): SearchTerms {
  const include: string[] = [], exclude: string[] = [];
  for (const m of (q ?? "").matchAll(/(-?)"([^"]*)"|(\S+)/g)) {
    let neg = m[1] === "-", word = m[2] ?? m[3] ?? "";
    if (m[3] && word.startsWith("-") && word.length > 1) { neg = true; word = word.slice(1); }
    word = clean(word);
    if (!word || word === "-") continue;
    (neg ? exclude : include).push(word);
  }
  return { include: include.slice(0, 6), exclude: exclude.slice(0, 6) };
}

const fold = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

interface Filterable<Q> { or(filters: string): Q; not(column: string, operator: string, value: unknown): Q }
interface BrandReader {
  from(table: "brands"): { select(cols: string): { or(filters: string): PromiseLike<{ data: { id: string; name: string }[] | null }> } };
}

/**
 * Reads the brands the words name, then gives the function that adds the search to an items query (kept
 * synchronous: a query builder is a promise, an async function would run it).
 */
export async function stockSearch(supabase: BrandReader, q: string | null | undefined): Promise<<Q extends Filterable<Q>>(query: Q) => Q> {
  const { include, exclude } = parseSearch(q);
  const all = [...include, ...exclude];
  if (!all.length) return (query) => query;
  const { data: brands } = await supabase.from("brands").select("id, name").or(all.map((w) => `name.ilike.%${w}%`).join(","));
  const brandIds = (w: string) => (brands ?? []).filter((b) => fold(b.name).includes(fold(w))).map((b) => b.id);
  return (query) => {
    for (const w of include) {
      const ids = brandIds(w);
      query = query.or(`sku.ilike.%${w}%,title.ilike.%${w}%,size_label.ilike.${w}${ids.length ? `,brand_id.in.(${ids.join(",")})` : ""}`);
    }
    for (const w of exclude) {
      const ids = brandIds(w);
      query = query.not("sku", "ilike", `%${w}%`);
      // an empty title, size or brand cannot contain the word: those items stay
      query = query.or(`title.is.null,title.not.ilike.%${w}%`);
      query = query.or(`size_label.is.null,size_label.not.ilike.${w}`);
      if (ids.length) query = query.or(`brand_id.is.null,brand_id.not.in.(${ids.join(",")})`);
    }
    return query;
  };
}
