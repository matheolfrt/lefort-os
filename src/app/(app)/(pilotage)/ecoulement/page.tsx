import Link from "next/link";
import { Card, PageHeader, Stat } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/session";
import { eur } from "@/lib/advisor";
import { date } from "@/lib/format";
import { PACE, tone, view, type BatchView, type Group, type SellThroughStats } from "@/lib/sellthrough";

export const metadata = { title: "Écoulement" };

const TONE_BAR = { ok: "bg-accent", close: "bg-amber-400", low: "bg-red-400", none: "bg-line" };
const TONE_TEXT = { ok: "text-accent", close: "text-amber-200", low: "text-red-300", none: "text-muted" };
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

export default async function Ecoulement() {
  await requireManager();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sellthrough_stats");

  if (error || !data) {
    return (
      <div>
        <PageHeader title="Écoulement" />
        <Card>{/sellthrough|function|schema cache/i.test(error?.message ?? "")
          ? "La mise à jour « 20261103000015_sellthrough.sql » n'a pas encore été exécutée dans Supabase (SQL Editor)."
          : error?.message ?? "Données indisponibles."}</Card>
      </div>
    );
  }

  const s = data as SellThroughStats;
  const views = s.batches.map((b) => view(b, s.days, s.target_pct));
  const running = views.filter((v) => !v.matured).sort((a, b) => a.daysLeft - b.daysLeft);
  const finished = views.filter((v) => v.matured);
  const risk = running.filter((v) => v.pace === "late" || v.pace === "watch");
  const toSell = risk.reduce((sum, v) => sum + v.remaining, 0);
  const o = s.overall;
  const ot = tone(o.pct, s.target_pct);

  return (
    <div className="space-y-5">
      <PageHeader title="Écoulement"
        subtitle={`Part des articles vendus dans les ${s.days} jours après leur réception. Objectif : ${s.target_pct} %.`} />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label={`Écoulement à ${s.days} j`} value={<span className={TONE_TEXT[ot]}>{o.pct == null ? "—" : `${Math.round(o.pct)} %`}</span>}
          hint={o.items ? `${o.sold} vendus sur ${o.items} articles (6 derniers mois)` : "pas encore de lot terminé"} help={`Part des articles vendus dans les ${s.days} jours suivant leur réception, sur les lots reçus ces 6 derniers mois. Les lots encore dans leur période ne sont pas comptés.`} />
        <Stat label="Objectif" value={`${s.target_pct} %`} hint={`dans les ${s.days} jours`} help="Réglable dans Paramètres. Le modèle « petits prix, rotation rapide » vise 80 % vendus en 30 jours." />
        <Stat label="Lots en cours" value={running.length} hint={risk.length ? `${risk.length} en retard ou à surveiller` : "tous dans les temps"} help={`Lots reçus il y a moins de ${s.days} jours. « À surveiller » ou « en retard » : leur rythme de vente ne permet pas d'atteindre l'objectif à temps.`} />
        <Stat label="À vendre pour tenir l'objectif" value={toSell} hint={toSell ? "articles des lots à risque" : "rien à rattraper"} help="Nombre d'articles à vendre en plus, dans les lots à risque, pour qu'ils atteignent l'objectif avant la fin de leur période." />
      </div>

      <section aria-labelledby="running">
        <h2 id="running" className="eyebrow mb-2 text-highlight">Lots en cours</h2>
        {running.length === 0 ? (
          <Card>Aucun lot dans sa fenêtre de {s.days} jours. Les nouveaux lots réceptionnés apparaîtront ici.</Card>
        ) : (
          <div className="space-y-2">
            {running.map((v) => <RunningRow key={v.id} v={v} target={s.target_pct} days={s.days} />)}
          </div>
        )}
      </section>

      <section aria-labelledby="finished">
        <h2 id="finished" className="eyebrow mb-2 text-highlight">Lots terminés</h2>
        {finished.length === 0 ? (
          <Card>Les lots apparaissent ici {s.days} jours après leur réception, avec leur résultat final.</Card>
        ) : (
          <Card>
            <div className="-mx-4 -mb-4 overflow-x-auto">
              <table className="data">
                <thead><tr><th>Lot</th><th>Fournisseur</th><th>Reçu le</th><th className="num">Articles</th><th className="num">Vendus à {s.days} j</th><th>Écoulement</th><th className="num">Payé</th><th className="num">Marge réalisée</th><th>Résultat</th></tr></thead>
                <tbody>
                  {finished.slice(0, 30).map((v) => {
                    const t = tone(v.pct, s.target_pct);
                    return (
                      <tr key={v.id}>
                        <td><Link prefetch={false} href={`/lots/${v.id}`} className="font-mono font-semibold hover:text-accent">{v.code}</Link></td>
                        <td>{v.supplier}</td>
                        <td className="whitespace-nowrap">{date(v.first_received)}</td>
                        <td className="num">{v.items}</td>
                        <td className="num">{v.sold_in_time}</td>
                        <td className="min-w-32"><Bar pct={v.pct} target={s.target_pct} tone={t} /></td>
                        <td className="num">{eur(v.cost_cents)}</td>
                        <td className={`num ${v.profit_cents < 0 ? "text-red-300" : ""}`}>{eur(v.profit_cents)}</td>
                        <td><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${PACE[v.pace].cls}`}>{PACE[v.pace].label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>

      <section aria-labelledby="detail" className="space-y-3">
        <h2 id="detail" className="eyebrow text-highlight">Ce qui s&apos;écoule vite, ce qui traîne</h2>
        <p className="text-sm text-muted">Sur les articles dont les {s.days} jours sont écoulés. Un groupe doit compter au moins 3 articles pour apparaître.</p>
        <div className="grid gap-3 lg:grid-cols-2">
          <GroupCard title="Fournisseurs" rows={s.suppliers} target={s.target_pct} />
          <GroupCard title="Marques" rows={s.brands} target={s.target_pct} />
          <GroupCard title="Catégories" rows={s.categories} target={s.target_pct} />
          <Card title="Mois de réception">
            {s.months.length === 0 ? <p className="text-sm text-muted">Pas encore de mois terminé.</p> : (
              <ul className="space-y-2">
                {s.months.map((m) => {
                  const d = new Date(m.month);
                  return (
                    <li key={m.month} className="flex items-center gap-3 text-sm">
                      <span className="w-20 shrink-0 text-muted">{MONTHS[d.getMonth()]} {d.getFullYear()}</span>
                      <div className="min-w-0 flex-1"><Bar pct={m.pct} target={s.target_pct} tone={tone(m.pct, s.target_pct)} /></div>
                      <span className="w-14 shrink-0 text-right font-mono text-xs text-muted">{m.sold}/{m.items}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </section>

      <details className="rounded-2xl border border-line bg-panel/60 p-4 text-sm text-muted">
        <summary className="cursor-pointer font-medium text-fg">Comment c&apos;est calculé</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Le compteur de chaque article démarre à sa <strong className="text-fg">réception</strong> (pas à sa mise en ligne) : un article qui attend ses photos compte contre vous, c&apos;est voulu.</li>
          <li>Un article est « vendu à temps » s&apos;il est vendu dans les {s.days} jours après sa réception. Seuls les lots réellement achetés comptent : le stock existant avant Lefort OS et les ventes importées sont exclus.</li>
          <li>Lot en cours : « il reste X à vendre » = {s.target_pct} % des articles moins les ventes déjà faites. Le rythme requis est ce reste divisé par les jours restants, comparé au rythme de vente depuis la réception (au-delà de 30 % de plus : en avance ; sous 60 % du rythme requis : en retard).</li>
          <li>Résultat final : objectif atteint à {s.target_pct} % ou plus, proche à moins de 20 points, sous l&apos;objectif en dessous. L&apos;objectif et la durée se règlent dans Paramètres.</li>
        </ul>
      </details>
    </div>
  );
}

function Bar({ pct, target, tone: t }: { pct: number; target: number; tone: keyof typeof TONE_BAR }) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2 min-w-16 flex-1 rounded-full bg-line">
        <div className={`h-full rounded-full ${TONE_BAR[t]}`} style={{ width: `${Math.min(100, pct)}%` }} />
        <span aria-hidden className="absolute -top-0.5 h-3 w-px bg-fg/70" style={{ left: `${target}%` }} title={`Objectif ${target} %`} />
      </div>
      <span className={`w-10 shrink-0 text-right font-mono text-xs font-semibold ${TONE_TEXT[t]}`}>{Math.round(pct)} %</span>
    </div>
  );
}

function RunningRow({ v, target, days }: { v: BatchView; target: number; days: number }) {
  const t = v.pace === "late" ? "low" : v.pace === "watch" ? "close" : "ok";
  return (
    <article className="rounded-2xl border border-line bg-panel/80 p-4" data-batch={v.code}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link prefetch={false} href={`/lots/${v.id}`} className="-my-2 inline-block py-2 font-mono text-base font-semibold hover:text-accent">{v.code}</Link>
        <span className="text-sm text-muted">{v.supplier}</span>
        <span className="font-mono text-xs text-muted">J+{Math.round(v.age_days)} / {days}</span>
        <span className={`ml-auto whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${PACE[v.pace].cls}`}>{PACE[v.pace].label}</span>
      </div>
      <div className="mt-3"><Bar pct={v.pct} target={target} tone={t} /></div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <span><strong className="font-mono">{v.sold_in_time}</strong> <span className="text-muted">vendus sur {v.items}</span></span>
        {v.remaining > 0
          ? <span><strong className="font-mono">{v.remaining}</strong> <span className="text-muted">à vendre en {v.daysLeft} j ({(v.requiredPerDay ?? 0).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}/j requis, {v.pacePerDay.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}/j actuel)</span></span>
          : <span className="text-accent">objectif atteint</span>}
        {v.not_online > 0 && <span className="text-amber-200">{v.not_online} pas encore en ligne</span>}
        <span className="ml-auto text-muted">{eur(v.cost_cents)} payés</span>
      </div>
    </article>
  );
}

function GroupCard({ title, rows, target }: { title: string; rows: Group[]; target: number }) {
  return (
    <Card title={title}>
      {rows.length === 0 ? <p className="text-sm text-muted">Pas assez d&apos;articles terminés.</p> : (
        <ul className="space-y-2">
          {rows.slice(0, 8).map((r) => (
            <li key={r.name} className="flex items-center gap-3 text-sm">
              <span className="w-28 shrink-0 truncate font-medium sm:w-36">{r.name}</span>
              <div className="min-w-0 flex-1"><Bar pct={r.pct} target={target} tone={tone(r.pct, target)} /></div>
              <span className="w-14 shrink-0 text-right font-mono text-xs text-muted">{r.sold}/{r.items}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
