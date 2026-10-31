import Link from "next/link";
import { ChevronRight, Radar } from "lucide-react";
import { getContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Field, PageHeader, btn, input } from "@/components/ui";
import { collectorStates } from "@/lib/market/status";
import type { MarketQuery } from "@/lib/market/collect";
import { filters } from "@/lib/market/format";
import { createSearch } from "./actions";
import { Collectors, type KeyRow } from "./collectors";

export const metadata = { title: "Niches Vinted" };

interface Row { id: string; name: string; domain: string; query: MarketQuery; active: boolean; created_at: string; last_run_at: string | null;
  last_ok_at: string | null; items: number; active_items: number; sold: number; gone: number; sold_7: number; photo_url: string | null; last_error: string | null }

const when = (d: string | null) => (d ? new Date(d).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "jamais");

/** « Niches Vinted » : the searches followed on Vinted, with what was really collected for each */
export default async function NichesVinted({ searchParams }: { searchParams: Promise<{ error?: string; supprimee?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const supabase = await createClient();
  const list = await supabase.rpc("market_list");
  if (list.error) {
    return (
      <>
        <PageHeader title="Niches Vinted" />
        <Empty action={ctx.isManager ? { href: "/parametres/mises-a-jour", label: "Mettre à jour la base" } : undefined}>
          Les niches Vinted ont besoin d&apos;une mise à jour de la base de données{ctx.isManager ? "." : " : demandez-la à un responsable."}
        </Empty>
      </>
    );
  }
  const rows = (list.data ?? []) as Row[];
  const [collectors, keys] = await Promise.all([
    collectorStates(supabase),
    ctx.isManager ? supabase.from("market_keys").select("id, label, created_at, last_used_at, revoked_at").order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
  ]);

  return (
    <div className="space-y-5">
      <PageHeader title="Niches Vinted" subtitle="Les annonces publiées sur Vinted pour vos recherches, collectées pour de vrai : nouveautés, ventes détectées, ce qui se vend vite." />
      {sp.error && <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm">{sp.error}</p>}
      {sp.supprimee && <p role="status" className="rounded-xl border border-line bg-panel/80 p-3 text-sm">Recherche supprimée.</p>}

      {ctx.isManager && (
        <Card title="Nouvelle recherche">
          <form action={createSearch} className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_7rem_7rem_auto] sm:items-end" data-testid="new-search">
            <Field label="Ce que vous cherchez" hint="Des mots (« costume laine ») ou l'adresse d'une recherche Vinted avec ses filtres.">
              <input name="search" required className={input} placeholder="costume laine, ou https://www.vinted.fr/catalog?…" />
            </Field>
            <Field label="Nom (facultatif)"><input name="name" className={input} placeholder="Costumes laine" /></Field>
            <Field label="Prix min (€)"><input name="price_from" inputMode="decimal" className={input} /></Field>
            <Field label="Prix max (€)"><input name="price_to" inputMode="decimal" className={input} /></Field>
            <button className={`${btn.primary} sm:mb-[1.35rem]`}><Radar size={17} /> Suivre</button>
          </form>
        </Card>
      )}

      {rows.length === 0 ? (
        <Empty>Aucune recherche suivie. {ctx.isManager ? "Ajoutez-en une ci-dessus : les collecteurs commenceront à lire Vinted à leur prochain passage." : "Un responsable peut en ajouter."}</Empty>
      ) : (
        <section aria-label="Mes recherches" className="space-y-2" data-testid="searches">
          {rows.map((r) => (
            <Link key={r.id} href={`/niches-vinted/${r.id}`} data-search={r.name}
              className="flex items-center gap-3 rounded-2xl border border-line bg-panel/80 p-3 transition hover:border-fg/25">
              <div className="size-12 shrink-0 overflow-hidden rounded-xl bg-fg/5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {r.photo_url ? <img src={r.photo_url} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" /> : <Radar size={20} className="m-3.5 text-muted" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><b className="truncate">{r.name}</b>
                  {!r.active && <span className="rounded-full bg-fg/10 px-2 py-0.5 text-xs text-muted">en pause</span>}</div>
                <div className="truncate text-xs text-muted">{filters(r.query)} · {r.domain.replace("www.", "")} · dernier passage {when(r.last_run_at)}</div>
                {r.last_error && <div className="truncate text-xs text-red-700 dark:text-red-300">{r.last_error}</div>}
              </div>
              <dl className="hidden shrink-0 grid-cols-3 gap-4 text-right sm:grid">
                <div><dt className="text-xs text-muted">Annonces</dt><dd className="figure font-semibold">{r.items.toLocaleString("fr-FR")}</dd></div>
                <div><dt className="text-xs text-muted">Ventes vues</dt><dd className="figure font-semibold">{r.sold.toLocaleString("fr-FR")}</dd></div>
                <div><dt className="text-xs text-muted">7 derniers j</dt><dd className="figure font-semibold">{r.sold_7.toLocaleString("fr-FR")}</dd></div>
              </dl>
              <ChevronRight size={18} className="shrink-0 text-muted" />
            </Link>
          ))}
        </section>
      )}

      <Collectors collectors={collectors} keys={(keys.data ?? []) as KeyRow[]} manager={ctx.isManager}
        supabaseUrl={process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""} anonKey={process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""} />

      <p className="text-xs text-muted">
        Comment c&apos;est calculé : chaque passage lit les annonces les plus récentes de la recherche, puis revoit les annonces déjà connues.
        Une annonce que Vinted marque comme vendue compte comme vente ; une annonce qui disparaît sans dire pourquoi (supprimée ou vendue)
        est comptée à part comme « disparue ». La date de vente est celle du passage qui l&apos;a vue vendue.
      </p>
    </div>
  );
}
