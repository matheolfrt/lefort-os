import Link from "next/link";
import { ChevronRight, Lightbulb, Plus, Sparkles } from "lucide-react";
import { Card, PageHeader, btn } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/session";
import { eur, type Facts } from "@/lib/advisor";
import {
  LIBRARY, STATUS, criteria, eur2, judge, sizeLabel, suggestions,
  type Idea, type Niche, type NicheStats, type NicheStatus,
} from "@/lib/niches";
import { createFromIdea } from "./actions";

export const metadata = { title: "Niches" };

const ORDER: { status: NicheStatus; title: string; empty: string }[] = [
  { status: "testing", title: "En test", empty: "Aucun test en cours. Choisissez une idée ci-dessous et rattachez-lui un petit lot." },
  { status: "idea", title: "Idées à tester", empty: "Ajoutez une niche ou partez d'une suggestion." },
  { status: "validated", title: "Validées", empty: "Les niches rentables que vous gardez apparaîtront ici." },
  { status: "dropped", title: "Abandonnées", empty: "" },
];

export default async function Niches({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireManager();
  const { error } = await searchParams;
  const supabase = await createClient();
  const [{ data: rows, error: loadError }, { data: stats }, { data: facts }, { data: brands }, { data: categories }] = await Promise.all([
    supabase.from("niches").select("*").order("created_at", { ascending: false }),
    supabase.rpc("niche_stats"),
    supabase.rpc("advisor_facts"),
    supabase.from("brands").select("id, name"),
    supabase.from("categories").select("id, name"),
  ]);

  if (loadError) {
    return (
      <div>
        <PageHeader title="Niches" />
        <Card>{/niches|relation|schema cache/i.test(loadError.message)
          ? "La mise à jour « 20261102000014_niches.sql » n'a pas encore été exécutée dans Supabase (SQL Editor)."
          : loadError.message}</Card>
      </div>
    );
  }

  const niches = (rows ?? []) as Niche[];
  const s = stats as NicheStats | null;
  const ref = s?.reference ?? { sold: 0, profit_per_item_cents: null, avg_days: null };
  const brandName = new Map((brands ?? []).map((b) => [b.id as string, b.name as string]));
  const catName = new Map((categories ?? []).map((c) => [c.id as string, c.name as string]));
  const taken = {
    brands: new Set(niches.flatMap((n) => n.brand_ids.map((id) => brandName.get(id) ?? ""))),
    categories: new Set(niches.flatMap((n) => n.category_ids.map((id) => catName.get(id) ?? ""))),
    sizes: new Set(niches.flatMap((n) => n.sizes)),
  };
  const fromData = facts ? suggestions(facts as Facts, taken) : [];
  const names = new Set(niches.map((n) => n.name.toLowerCase()));
  const library = LIBRARY.filter((i) => !names.has(i.name.toLowerCase()));

  return (
    <div className="space-y-5">
      <PageHeader title="Niches"
        subtitle="Testez de nouvelles niches avec un petit lot, mesurez leurs vrais résultats, gardez celles qui rapportent."
        actions={<Link href="/niches/nouvelle" className={btn.primary}><Plus size={18} /> Nouvelle niche</Link>} />
      {error && <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}

      <p className="text-sm text-muted">
        Repère pour juger : votre marge moyenne est de <strong className="text-fg">{eur(ref.profit_per_item_cents)}</strong> par article,
        vendu en <strong className="text-fg">{ref.avg_days == null ? "—" : `${Math.round(ref.avg_days)} j`}</strong>
        {ref.profit_per_item_cents != null && ref.avg_days ? <> soit <strong className="text-fg">{eur2(ref.profit_per_item_cents / Math.max(ref.avg_days, 1))}</strong> par jour de stock</> : null}.
        Une niche est rentable si elle fait au moins aussi bien, avec au moins 40 % des articles vendus.
      </p>

      {ORDER.map(({ status, title, empty }) => {
        const list = niches.filter((n) => n.status === status);
        if (status === "dropped" && !list.length) return null;
        const body = list.length ? (
          <div className="grid gap-2 md:grid-cols-2">
            {list.map((n) => {
              const st = s?.niches.find((x) => x.id === n.id);
              const scope = n.status === "testing" && st?.test ? "test" : "all";
              const m = scope === "test" ? st?.test ?? null : st?.all ?? null;
              const v = judge(m, ref, n.test_items ?? undefined);
              const needed = n.test_items ?? 5;
              return (
                <Link prefetch={false} key={n.id} href={`/niches/${n.id}`} data-niche={n.name}
                  className="group block rounded-2xl border border-line bg-panel/80 p-4 transition hover:border-fg/30">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold">{n.name}</h3>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS[n.status].cls}`}>{STATUS[n.status].label}</span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted">{criteria(n, brandName, catName)}</p>
                    </div>
                    <ChevronRight size={18} className="mt-1 shrink-0 text-muted/60 group-hover:text-fg" />
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                    <Mini label="Ventes" value={m ? `${m.sold}/${m.items}` : "—"} />
                    <Mini label="Marge / art." value={eur(v.profitPerItem)} />
                    <Mini label="Délai" value={m?.days == null ? "—" : `${Math.round(m.days)} j`} />
                    <Mini label="Marge / jour" value={eur2(v.profitPerDay)} />
                  </div>
                  {n.status === "testing" && (
                    <div className="mt-3">
                      <div className="h-1.5 overflow-hidden rounded-full bg-line">
                        <div className="h-full rounded-full bg-sky-400" style={{ width: `${Math.min(100, ((m?.sold ?? 0) * 100) / needed)}%` }} />
                      </div>
                      <div className="mt-1 flex justify-between text-[11px] text-muted">
                        <span>{scope === "test" ? "Articles du test" : "Tous les articles correspondants"}</span>
                        {n.budget_cents ? <span>{eur(m?.cost ?? 0)} / {eur(n.budget_cents)} de budget</span> : null}
                      </div>
                    </div>
                  )}
                  <div className="mt-3 flex items-start gap-2 text-sm">
                    <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${v.cls}`}>{v.label}</span>
                    <span className="text-fg/80">{n.status === "dropped" || n.status === "validated" ? n.decision_note || v.text : v.text}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : <p className="rounded-2xl border border-dashed border-line p-4 text-sm text-muted">{empty}</p>;
        return (
          <section key={status} aria-labelledby={`h-${status}`}>
            <h2 id={`h-${status}`} className="eyebrow mb-2 text-highlight">{title}{list.length ? ` · ${list.length}` : ""}</h2>
            {status === "dropped"
              ? <details><summary className="mb-2 cursor-pointer text-sm text-muted">Voir les niches abandonnées</summary>{body}</details>
              : body}
          </section>
        );
      })}

      {fromData.length > 0 && (
        <section aria-labelledby="h-data">
          <h2 id="h-data" className="eyebrow mb-1 flex items-center gap-1.5 text-highlight"><Sparkles size={14} /> À essayer d&apos;après vos chiffres</h2>
          <p className="mb-2 text-sm text-muted">Ce qui marche déjà bien dans vos ventes, ou qui démarre fort sur peu de ventes.</p>
          <div className="grid gap-2 md:grid-cols-2">{fromData.map((i) => <IdeaCard key={i.key} idea={i} />)}</div>
        </section>
      )}

      {library.length > 0 && (
        <section aria-labelledby="h-lib">
          <h2 id="h-lib" className="eyebrow mb-1 flex items-center gap-1.5 text-highlight"><Lightbulb size={14} /> Idées de départ</h2>
          <p className="mb-2 text-sm text-muted">Des pistes courantes en vêtements homme d&apos;occasion. Ce sont des hypothèses, pas des chiffres : seul votre test dira si elles marchent pour vous.</p>
          <div className="grid gap-2 md:grid-cols-2">{library.map((i) => <IdeaCard key={i.key} idea={i} library />)}</div>
        </section>
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-bg/60 px-1 py-1.5">
      <div className="font-mono text-sm font-semibold">{value}</div>
      <div className="text-[10px] text-muted">{label}</div>
    </div>
  );
}

function IdeaCard({ idea, library }: { idea: Idea; library?: boolean }) {
  const crit = [
    idea.brands?.join(", "), idea.categories?.join(", "), idea.sizes?.map(sizeLabel).join(", "),
    idea.keywords?.map((k) => `« ${k} »`).join(", "),
    idea.price_max_cents ? `jusqu'à ${eur(idea.price_max_cents)}` : "",
  ].filter(Boolean).join(" · ");
  return (
    <form action={createFromIdea} className="flex items-start gap-3 rounded-2xl border border-line bg-panel/80 p-4" data-idea={idea.name}>
      <input type="hidden" name="idea" value={library ? idea.key : JSON.stringify(idea)} />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{idea.name}</div>
        <p className="text-sm text-fg/80">{idea.why ?? idea.hypothesis}</p>
        {crit && <p className="mt-1 text-xs text-muted">{crit}</p>}
      </div>
      <button className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-xl border border-line bg-panel-2 px-3 text-sm font-medium hover:border-fg/30">
        <Plus size={15} /> Ajouter
      </button>
    </form>
  );
}
