import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, PageHeader, btn, input } from "@/components/ui";
import { STATUS_LABEL } from "@/i18n/fr";
import type { ItemStatus } from "@/lib/types";
import { StockTable, type StockRow } from "./stock-table";

const PAGE_SIZES = [50, 100, 250];

export default async function Stock({ searchParams }: {
  searchParams: Promise<{ q?: string; status?: string; category?: string; page?: string; size?: string }>;
}) {
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
  const [{ data: items, count }, { data: categories }] = await Promise.all([
    query.order("received_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1),
    supabase.from("categories").select("id, name").order("name"),
  ]);
  const pages = Math.ceil((count ?? 0) / PAGE);
  const link = (p: number) => `/stock?${new URLSearchParams({ ...sp, page: String(p) } as Record<string, string>)}`;

  return (
    <>
      <PageHeader title="Stock" subtitle={`${count ?? 0} article${(count ?? 0) > 1 ? "s" : ""}`} />
      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_180px_180px_130px_auto]">
        <input className={input} name="q" defaultValue={sp.q} placeholder="SKU, titre, taille…" />
        <select className={input} name="status" defaultValue={sp.status ?? ""}>
          <option value="">Tous statuts</option>
          {(Object.keys(STATUS_LABEL) as ItemStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select className={input} name="category" defaultValue={sp.category ?? ""}>
          <option value="">Toutes catégories</option>
          {(categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className={input} name="size" defaultValue={String(PAGE)} aria-label="Articles par page">
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} / page</option>)}
        </select>
        <button className={btn.primary}>Filtrer</button>
      </form>
      {!items?.length ? (
        <Empty>Aucun article.</Empty>
      ) : (
        <Card>
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
            <div className="mt-3 flex items-center justify-center gap-3 text-sm">
              {page > 1 && <Link href={link(page - 1)} className="underline">← Précédent</Link>}
              <span>Page {page} / {pages}</span>
              {page < pages && <Link href={link(page + 1)} className="underline">Suivant →</Link>}
            </div>
          )}
        </Card>
      )}
    </>
  );
}
