import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, PageHeader, SkuLink, StatusChip, btn, input } from "@/components/ui";
import { STATUS_LABEL } from "@/i18n/fr";
import { daysSince, money } from "@/lib/format";
import type { ItemStatus } from "@/lib/types";

const PAGE = 50;

export default async function Stock({ searchParams }: {
  searchParams: Promise<{ q?: string; status?: string; category?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(Number(sp.page) || 1, 1);
  const supabase = await createClient();

  let query = supabase
    .from("items")
    .select("id, sku, status, title, size_label, list_price_cents, status_changed_at, received_at, categories(name), brands(name), locations(code)", { count: "exact" })
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
      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_180px_180px_auto]">
        <input className={input} name="q" defaultValue={sp.q} placeholder="SKU, titre, taille…" />
        <select className={input} name="status" defaultValue={sp.status ?? ""}>
          <option value="">Tous statuts</option>
          {(Object.keys(STATUS_LABEL) as ItemStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select className={input} name="category" defaultValue={sp.category ?? ""}>
          <option value="">Toutes catégories</option>
          {(categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className={btn.primary}>Filtrer</button>
      </form>
      {!items?.length ? (
        <Empty>Aucun article.</Empty>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr><th>SKU</th><th>Statut</th><th>Article</th><th>Taille</th><th>Emplacement</th><th className="num">Prix</th><th className="num">Âge</th></tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}>
                    <td><SkuLink sku={i.sku} /></td>
                    <td><StatusChip status={i.status as ItemStatus} /></td>
                    <td className="max-w-80 truncate">
                      {i.title ?? [(i.categories as unknown as { name: string } | null)?.name, (i.brands as unknown as { name: string } | null)?.name].filter(Boolean).join(" · ")}
                    </td>
                    <td>{i.size_label ?? "—"}</td>
                    <td className="font-mono text-xs">{(i.locations as unknown as { code: string } | null)?.code.replace("EMP-", "") ?? "—"}</td>
                    <td className="num">{money(i.list_price_cents)}</td>
                    <td className="num">{daysSince(i.received_at)} j</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
