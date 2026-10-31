import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ExternalLink, Plus } from "lucide-react";
import { requireManager } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, PageHeader, btn, input } from "@/components/ui";
import { BAND_LABEL, parseSteps, type PriceData } from "@/lib/pricing";
import { PriceList } from "./price-list";

export const metadata = { title: "Prix à baisser" };

async function saveRules(fd: FormData) {
  "use server";
  const ctx = await requireManager();
  const steps = parseSteps(fd.getAll("days").map(String), fd.getAll("pct").map(String));
  if (typeof steps === "string") redirect(`/prix?erreur=${encodeURIComponent(steps)}#regles`);
  const wait = Math.min(60, Math.max(0, Math.round(Number(fd.get("wait")) || 0)));
  const supabase = await createClient();
  const { error } = await supabase.from("organizations").update({ price_steps: steps, price_wait_days: wait }).eq("id", ctx.org.id);
  if (error) redirect(`/prix?erreur=${encodeURIComponent(error.message)}#regles`);
  revalidatePath("/prix");
  redirect("/prix?regles=1#regles");
}

const eur = (c: number) => `${Math.round(c / 100).toLocaleString("fr-FR")} €`;
const day = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Paris" });

export default async function Prices({ searchParams }: { searchParams: Promise<{ erreur?: string; regles?: string; paliers?: string }> }) {
  await requireManager();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("price_suggestions");
  if (error || !data) {
    return (
      <>
        <PageHeader title="Prix à baisser" />
        <Empty action={{ href: "/parametres/mises-a-jour", label: "Mettre à jour la base" }}>Cette page a besoin d&apos;une mise à jour de la base de données.</Empty>
      </>
    );
  }
  const p = data as PriceData;
  const steps = [...p.steps];
  const rows = Math.min(5, Math.max(steps.length + (sp.paliers ? 1 : 0), 1));
  const gain = p.items.reduce((a, s) => a + s.suggested, 0);

  return (
    <div className="space-y-5">
      <PageHeader title="Prix à baisser"
        subtitle="Des suggestions selon le temps passé en ligne : rien ne change tant que vous n'appliquez pas, et le prix sur Vinted se change à la main." />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tile k="À baisser aujourd'hui" v={String(p.items.length)} hint={p.items.length ? `${eur(gain)} au total aux prix suggérés` : `sur ${p.listed} en ligne`} />
        <Tile k="Bientôt" v={String(p.soon)} hint="atteignent un palier dans les 7 jours" />
        <Tile k="Au prix plancher" v={String(p.at_floor)} hint="ne peuvent pas baisser plus sans perte ou sous le minimum" />
        <Tile k="En attente" v={String(p.waiting + p.skipped)} hint={`baissés il y a moins de ${p.wait_days} j, ou mis de côté`} />
      </div>

      <section aria-labelledby="todo" className="space-y-2">
        <h2 id="todo" className="section-title">Suggestions du jour</h2>
        <PriceList items={p.items} />
      </section>

      {p.recent.length > 0 && (
        <Card title={`Baissés cette semaine · ${p.recent.length}`}>
          <p className="mb-2 text-xs text-muted">Pour ne pas oublier de reporter le nouveau prix sur Vinted.</p>
          <ul className="divide-y divide-line">
            {p.recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <Link prefetch={false} href={`/stock/${encodeURIComponent(r.sku)}`} className="font-mono font-semibold hover:text-accent">{r.sku}</Link>
                <span className="min-w-0 flex-1 truncate text-muted">{r.title}</span>
                <span className="figure tabular-nums"><span className="text-muted line-through">{eur(r.old)}</span> → {eur(r.new)}</span>
                <span className="text-xs text-muted">{day(r.at)}</span>
                {r.url && <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 text-series-1 hover:underline">Vinted <ExternalLink size={14} /></a>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Les baisses font-elles vendre ?">
          {!p.effect?.length ? (
            <p className="text-sm text-muted">Pas encore assez de recul : il faut des baisses d&apos;au moins 14 jours pour savoir si elles ont fait vendre.</p>
          ) : (
            <>
              <ul className="space-y-3">
                {p.effect.map((e) => {
                  const pct = e.n ? Math.round((e.sold * 100) / e.n) : 0;
                  return (
                    <li key={e.band}>
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span>Après une {BAND_LABEL[e.band]}</span>
                        <span className="figure font-semibold tabular-nums">{pct} %</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-fg/10"><div className="h-full rounded-full bg-series-1" style={{ width: `${pct}%` }} /></div>
                      <div className="mt-0.5 text-xs text-muted">{e.sold} vendus dans les 14 jours sur {e.n} baisse{e.n > 1 ? "s" : ""}</div>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-xs text-muted">Sur les 6 derniers mois. Si une petite baisse fait vendre autant qu&apos;une grosse, gardez les petites.</p>
            </>
          )}
        </Card>

        <Card title="Vos règles">
          <form id="regles" action={saveRules} className="scroll-mt-24 space-y-3">
            {sp.erreur && <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-2.5 text-sm">{sp.erreur}</p>}
            {sp.regles && <p role="status" className="rounded-xl bg-accent/10 p-2.5 text-sm text-accent">Règles enregistrées : les suggestions sont recalculées.</p>}
            <p className="text-sm text-muted">La baisse se calcule sur le prix de mise en ligne. Jamais sous le prix minimum de l&apos;article, ni sous coût + frais Vinted + envoi + 1 €.</p>
            <div className="space-y-2">
              {Array.from({ length: rows }, (_, i) => steps[i] ?? { days: "", pct: "" }).map((s, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="hidden w-20 text-muted sm:inline">Palier {i + 1}</span>
                  <span>après</span>
                  <input className={`${input} !w-20 text-right font-mono`} name="days" inputMode="numeric" defaultValue={String(s.days)} aria-label={`Palier ${i + 1} : jours en ligne`} />
                  <span>j :</span>
                  <span className="text-muted">−</span>
                  <input className={`${input} !w-20 text-right font-mono`} name="pct" inputMode="decimal" defaultValue={String(s.pct)} aria-label={`Palier ${i + 1} : baisse en %`} />
                  <span>%</span>
                </div>
              ))}
            </div>
            {rows < 5 && <Link href="/prix?paliers=1#regles" className="inline-flex min-h-11 items-center gap-1 text-sm text-series-1 hover:underline"><Plus size={15} /> Ajouter un palier</Link>}
            <label className="flex flex-wrap items-center gap-2 text-sm">
              Attendre
              <input className={`${input} !w-20 text-right font-mono`} name="wait" inputMode="numeric" defaultValue={String(p.wait_days)} aria-label="Jours entre deux baisses" />
              jours entre deux baisses d&apos;un même article
            </label>
            <p className="text-xs text-muted">Videz un palier pour le retirer.</p>
            <button className={btn.primary}>Enregistrer les règles</button>
          </form>
        </Card>
      </div>
    </div>
  );
}

function Tile({ k, v, hint }: { k: string; v: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel/80 px-4 py-3">
      <div className="eyebrow-tight text-muted">{k}</div>
      <div className="mt-1 figure text-[26px] font-medium leading-tight tabular-nums">{v}</div>
      <div className="text-xs leading-snug text-muted">{hint}</div>
    </div>
  );
}
