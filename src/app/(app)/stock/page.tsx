import Link from "next/link";
import { Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Empty, input } from "@/components/ui";
import { STATUS_LABEL, STATUS_TONE } from "@/i18n/fr";
import type { ItemStatus } from "@/lib/types";
import { StockTable, type StockRow } from "./stock-table";

const PAGE_SIZES = [50, 100, 250];
// Chip order follows the production line, then the exits
const CHIP_ORDER: ItemStatus[] = [
  "received", "sorted", "photographed", "measured", "listing_ready", "listed", "reserved",
  "on_hold", "returned", "sold", "shipped", "completed", "rejected",
];

type Params = { q?: string; status?: string; category?: string; page?: string; size?: string };

export default async function Stock({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const page = Math.max(Number(sp.page) || 1, 1);
  const PAGE = PAGE_SIZES.includes(Number(sp.size)) ? Number(sp.size) : 50;
  const supabase = await createClient();

  let query = supabase
    .from("items")
    .select("id, sku, status, title, size_label, list_price_cents, status_changed_at, received_at, status_before_hold, categories(name), brands(name), locations(code)", { count: "exact" })
    .is("deleted_at", null);
  if (sp.status) query = query.eq("status", sp.status);
  if (sp.category) query = query.eq("category_id", sp.category);
  if (sp.q) {
    const q = sp.q.replace(/[%,()]/g, " ").trim();
    query = query.or(`sku.ilike.%${q}%,title.ilike.%${q}%,size_label.eq.${q}`);
  }
  const [{ data: items, count }, { data: categories }, { data: pipeline }] = await Promise.all([
    query.order("received_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1),
    supabase.from("categories").select("id, name").order("name"),
    supabase.from("v_pipeline").select("status, items"),
  ]);
  const byStatus = new Map((pipeline ?? []).map((p) => [p.status as ItemStatus, Number(p.items)]));
  const total = [...byStatus.values()].reduce((a, b) => a + b, 0);
  const pages = Math.ceil((count ?? 0) / PAGE);
  const href = (patch: Partial<Params>) => {
    const next = { ...sp, ...patch } as Record<string, string | undefined>;
    const qs = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]);
    return `/stock${qs.size ? `?${qs}` : ""}`;
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-[22px] font-bold leading-tight tracking-tight">Stock</h1>
          <p className="text-sm text-muted">
            {count ?? 0} article{(count ?? 0) > 1 ? "s" : ""}
            {sp.status && ` · ${STATUS_LABEL[sp.status as ItemStatus]}`}
            {sp.q && ` · « ${sp.q} »`}
          </p>
        </div>
      </header>

      {/* Status chips with live counts */}
      <nav aria-label="Filtrer par statut" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <ul className="flex min-w-max gap-1.5 md:min-w-0 md:flex-wrap">
          <Chip href={href({ status: undefined, page: undefined })} active={!sp.status} label="Tous" count={total} />
          {CHIP_ORDER.filter((s) => byStatus.get(s)).map((s) => (
            <Chip key={s} href={href({ status: s, page: undefined })} active={sp.status === s} label={STATUS_LABEL[s]}
              count={byStatus.get(s) ?? 0} dot={STATUS_TONE[s].split(" ")[0]} />
          ))}
        </ul>
      </nav>

      <form className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_190px_130px_auto]" action="/stock">
        {sp.status && <input type="hidden" name="status" value={sp.status} />}
        <label className="relative col-span-2 sm:col-span-1">
          <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className={`${input} pl-10`} name="q" defaultValue={sp.q} placeholder="SKU, titre, taille…" aria-label="Rechercher" />
        </label>
        <select className={input} name="category" defaultValue={sp.category ?? ""} aria-label="Catégorie">
          <option value="">Toutes catégories</option>
          {(categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className={`${input} hidden sm:block`} name="size" defaultValue={String(PAGE)} aria-label="Articles par page">
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} / page</option>)}
        </select>
        <button className="min-h-11 rounded-md bg-ink px-4 font-semibold text-ink-fg hover:opacity-90">Filtrer</button>
      </form>

      {!items?.length ? (
        <Empty>Aucun article ne correspond.</Empty>
      ) : (
        <>
          <StockTable
            rows={items.map((i): StockRow => ({
              id: i.id,
              sku: i.sku,
              status: i.status as ItemStatus,
              onHold: Boolean(i.status_before_hold),
              label: i.title ?? [(i.categories as unknown as { name: string } | null)?.name, (i.brands as unknown as { name: string } | null)?.name].filter(Boolean).join(" · "),
              size: i.size_label,
              location: (i.locations as unknown as { code: string } | null)?.code ?? null,
              priceCents: i.list_price_cents,
              receivedAt: i.received_at,
            }))}
            categories={categories ?? []}
          />
          {pages > 1 && (
            <nav className="flex items-center justify-center gap-2 text-sm" aria-label="Pagination">
              {page > 1 && <Link href={href({ page: String(page - 1) })} className="inline-flex min-h-11 items-center rounded-md border border-line bg-panel px-4 font-medium">← Précédent</Link>}
              <span className="px-2 tabular-nums text-muted">Page {page} / {pages}</span>
              {page < pages && <Link href={href({ page: String(page + 1) })} className="inline-flex min-h-11 items-center rounded-md border border-line bg-panel px-4 font-medium">Suivant →</Link>}
            </nav>
          )}
        </>
      )}
    </div>
  );
}

function Chip({ href, active, label, count, dot }: { href: string; active: boolean; label: string; count: number; dot?: string }) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "true" : undefined}
        className={`inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm font-medium transition ${
          active ? "border-ink bg-ink text-ink-fg" : "border-line bg-panel hover:border-fg/30"
        }`}
      >
        {dot && <span className={`size-2 rounded-full ${dot}`} />}
        {label}
        <span className={`tabular-nums ${active ? "opacity-70" : "text-muted"}`}>{count}</span>
      </Link>
    </li>
  );
}
