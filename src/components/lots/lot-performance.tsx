import { Help } from "@/components/ui";
import { STATUS, days, rotation, type LotRow, type LotStatus } from "@/lib/lot-rotation";
import { StartListing } from "./start-listing";

const dayMonth = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "Europe/Paris" }) : "—");
const longDay = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "Europe/Paris" });
const rate = (v: number | null) => (v == null ? "—" : `${v.toLocaleString("fr-FR", { maximumFractionDigits: v < 10 ? 1 : 0 })} article${v >= 2 ? "s" : ""}/jour`);

export function LotStatusChip({ status }: { status: LotStatus }) {
  const s = STATUS[status];
  return <span title={s.help} data-lot-status={status} className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${s.tone}`}>{s.label}</span>;
}

/**
 * « Performance du lot »: where it stands (counts), its official start, the three KPI side by side — never mixed —,
 * the estimates (always said to be estimates) and the timeline with the real dates.
 */
export function LotPerformance({ row, isManager, now = Date.now() }: { row: LotRow; isManager: boolean; now?: number }) {
  const r = rotation(row, now);
  const listedCount = r.sellable - r.toList;
  const soldCount = r.sellable - r.remaining;
  const step = r.timeline;

  return (
    <section aria-labelledby="perf-t" className="mb-6 space-y-4 rounded-2xl border border-line bg-panel/80 p-4 sm:p-5" data-testid="lot-performance">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="perf-t" className="section-title">Performance du lot</h2>
        <span className="flex items-center gap-1"><LotStatusChip status={r.status} /><Help text={STATUS[r.status].help} /></span>
      </div>

      {r.status === "recu" && !r.started && (
        <p className="text-sm text-muted">En attente de mise en ligne · Date de début de mise en ligne : <b className="text-fg">Non définie</b>. Cliquez dès que le premier article est publié : c&apos;est le point de départ des indicateurs.</p>
      )}
      <StartListing batchId={row.batch_id} startedAt={row.listing_started_at} editedAt={row.listing_started_edited_at ?? null}
        missing={r.startMissing} suggested={r.suggestedStart} isManager={isManager} />

      {/* where the lot stands */}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5" data-testid="lot-counts">
        <Fig k="Stock initial" v={String(row.total)} sub={row.rejected ? `dont ${row.rejected} écarté${row.rejected > 1 ? "s" : ""}` : undefined} />
        <div className="col-span-2 sm:col-span-1">
          <dt className="eyebrow-tight text-muted">Mis en ligne</dt>
          <dd className="font-mono text-xl font-semibold tabular-nums">{listedCount} / {r.sellable}</dd>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={Math.round(r.pctListed)} aria-valuemin={0} aria-valuemax={100} aria-label="Progression de la mise en ligne">
            <div className="h-full rounded-full bg-series-1 transition-[width]" style={{ width: `${r.pctListed}%` }} />
          </div>
          <span className="text-xs text-muted">{Math.round(r.pctListed)} %</span>
        </div>
        <Fig k="Vendus" v={`${soldCount} / ${r.sellable}`} />
        <Fig k="Stock restant" v={String(r.remaining)} />
        <Fig k="% vendu" v={`${Math.round(r.pctSold)} %`} />
      </dl>

      {/* the three KPI, side by side, each with what it measures */}
      <div className="grid gap-2 md:grid-cols-3" data-testid="lot-kpis">
        <Kpi id="listing" icon="🚀" title="Mise en ligne"
          help="Temps entre le premier article mis en ligne (le bouton 🚀) et le dernier article du lot mis en ligne."
          value={!r.started ? "—" : r.listing.done ? days(r.listing.days) : "En cours"}
          sub={r.listing.done ? "Temps nécessaire pour mettre 100 % du lot en ligne." : r.started ? `Depuis ${days(r.listing.elapsed)} · ${listedCount} / ${r.sellable} en ligne` : "Démarre au premier article mis en ligne."}>
          {r.started && (
            <p className="mt-1 text-xs">
              ⚡ Rythme de listing : <b>{rate(r.listing.rate)}</b>
              {!r.listing.done && r.listing.daysLeft != null && r.toList > 0 && <> · Estimation : {days(Math.ceil(r.listing.daysLeft))} restants (fin ≈ {longDay(r.listing.endAt!)})</>}
            </p>
          )}
        </Kpi>
        <Kpi id="sale" icon="📈" title="Vente moyenne"
          help="Délai moyen entre la mise en ligne d'un article et sa vente, calculé article par article à partir de sa propre date de mise en ligne (pas celle du lot)."
          value={r.avgDaysToSell != null ? days(r.avgDaysToSell, 1) : listedCount > 0 ? "En attente de ventes" : "—"}
          sub={r.avgDaysToSell != null ? `Temps moyen pour vendre un article après sa mise en ligne · ${row.timed} vente${row.timed > 1 ? "s" : ""}` : "Temps moyen pour vendre un article après sa mise en ligne."} />
        <Kpi id="liquidation" icon="💰" title="Liquidation"
          help="Temps entre le premier article mis en ligne et la vente du dernier article du lot : la vraie vitesse de transformation du lot en cash. Figée quand le lot est liquidé."
          value={!r.started ? "—" : r.liquidation.done ? days(r.liquidation.days) : "En cours"}
          sub={r.liquidation.done ? "Temps nécessaire pour vendre tout le lot à partir du premier listing." : r.started ? `Depuis ${days(r.liquidation.elapsed)} · ${r.remaining} restant${r.remaining > 1 ? "s" : ""}` : "Démarre au premier article mis en ligne."}>
          {r.started && !r.liquidation.done && (
            <p className="mt-1 text-xs" data-testid="projection">
              {r.projection
                ? <>Projection de liquidation : <b>≈ {days(Math.round(r.projection.days))}</b> <span className="text-amber-300">(estimation)</span>, vers le {longDay(r.projection.at)}</>
                : <span className="text-muted">Projection : pas encore assez de ventes pour estimer (5 ventes et une semaine minimum).</span>}
            </p>
          )}
        </Kpi>
      </div>

      {/* timeline with the real dates */}
      <div>
        <h3 className="eyebrow-tight mb-2 text-muted">Chronologie</h3>
        <ol className="relative grid gap-2 sm:grid-cols-5" data-testid="lot-timeline">
          {step.map((s, i) => (
            <li key={s.key} data-step={s.key} className={`flex items-start gap-2 sm:flex-col sm:gap-1 ${s.pending ? "opacity-50" : ""}`}>
              <span className="flex items-center gap-2 sm:w-full">
                <span aria-hidden className={`size-3 shrink-0 rounded-full ${s.pending ? "border border-line" : TONE[i]}`} />
                {i < step.length - 1 && <span aria-hidden className="hidden h-px flex-1 bg-line sm:block" />}
              </span>
              <span>
                <span className="block font-mono text-sm tabular-nums">{s.at ? dayMonth(s.at) : "—"}</span>
                <span className="block text-xs text-muted"> {s.label}{s.key === "fin_listing" && !s.at && r.started ? " (en cours)" : ""}</span>
              </span>
            </li>
          ))}
        </ol>
        {r.liquidation.done && <p className="mt-2 text-sm">Durée totale : <b>{days(r.liquidation.days)}</b> du premier article mis en ligne au dernier vendu.</p>}
      </div>
    </section>
  );
}

const TONE = ["bg-fg/40", "bg-emerald-500", "bg-sky-400", "bg-violet-400", "bg-accent"];

function Fig({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div>
      <dt className="eyebrow-tight text-muted">{k}</dt>
      <dd className="font-mono text-xl font-semibold tabular-nums">{v}</dd>
      {sub && <span className="text-xs text-muted">{sub}</span>}
    </div>
  );
}

function Kpi({ id, icon, title, help, value, sub, children }: {
  id: string; icon: string; title: string; help: string; value: string; sub: string; children?: React.ReactNode;
}) {
  return (
    <div data-kpi={id} className="rounded-2xl border border-line bg-bg/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold"><span aria-hidden className="mr-1">{icon}</span>{title}</span>
        <Help text={help} />
      </div>
      <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">{value}</div>
      <p className="text-xs text-muted">{sub}</p>
      {children}
    </div>
  );
}
