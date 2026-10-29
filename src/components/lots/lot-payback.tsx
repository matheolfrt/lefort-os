import { Help } from "@/components/ui";
import { money } from "@/lib/format";
import { days } from "@/lib/lot-rotation";
import { PAYBACK_LABEL, PAYBACK_MIN_DAYS, PAYBACK_MIN_SALES, type Payback } from "@/lib/payback";

const longDay = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "Europe/Paris" });

const TONE: Record<Payback["status"], string> = {
  rembourse: "bg-accent/15 text-accent ring-accent/30",
  en_cours: "bg-sky-400/10 text-sky-700 ring-sky-400/25 dark:text-sky-300",
  pas_commence: "bg-fg/10 text-fg/80 ring-fg/20",
  sans_cout: "bg-fg/10 text-fg/80 ring-fg/20",
  perte: "bg-red-500/10 text-red-700 ring-red-400/30 dark:text-red-300",
};

export function PaybackChip({ p }: { p: Payback }) {
  // no cost entered: nothing to measure (the lot page says how to fix it)
  if (p.status === "sans_cout") return <span data-payback={p.status} title={PAYBACK_LABEL.sans_cout} className="text-muted">—</span>;
  const text = p.status === "rembourse" && p.daysFromPurchase != null ? `✓ ${days(p.daysFromPurchase)}`
    : p.status === "en_cours" ? `${Math.floor(p.pct)} %` : PAYBACK_LABEL[p.status];
  return <span data-payback={p.status} className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONE[p.status]}`}>{text}</span>;
}

/**
 * « Remboursement du lot »: when the money that came in for the lot reached what it cost. The money counted is what
 * really came in (paid sales, net of fees, refunds deducted); a sale not paid yet is shown apart, as on its way.
 */
export function LotPayback({ p }: { p: Payback }) {
  const bar = Math.min(100, Math.max(0, p.pct));
  return (
    <section aria-labelledby="payback-t" className="mb-6 space-y-3 rounded-2xl border border-line bg-panel/80 p-4 sm:p-5" data-testid="lot-payback">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="payback-t" className="section-title">Remboursement du lot</h2>
        <span className="flex items-center gap-1">
          <PaybackChip p={p} />
          <Help text="L'argent réellement encaissé pour les articles du lot (ventes payées, frais Vinted, port, emballage et TVA déduits, remboursements retirés), comparé à ce que le lot a coûté. Le lot est remboursé le jour où cet argent atteint son coût." />
        </span>
      </div>

      {p.status === "sans_cout" ? (
        <p className="text-sm text-muted">Saisissez le coût du lot (lignes de coût ci-dessous) pour suivre son remboursement.</p>
      ) : (
        <>
          <div>
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span><b className="font-mono tabular-nums">{money(p.recovered)}</b> encaissés sur <b className="font-mono tabular-nums">{money(p.cost)}</b></span>
              <span className="font-mono tabular-nums text-muted">{Math.floor(p.pct)} %</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={Math.floor(bar)} aria-valuemin={0} aria-valuemax={100} aria-label="Part du coût du lot déjà encaissée">
              <div className={`h-full rounded-full ${p.status === "perte" ? "bg-red-500" : "bg-accent"}`} style={{ width: `${bar}%` }} />
            </div>
          </div>

          <p className="text-sm" data-testid="payback-text">
            {p.status === "rembourse" && (
              <>Remboursé le <b>{longDay(p.at!)}</b>
                {p.daysFromPurchase != null && <>, <b>{days(p.daysFromPurchase)}</b> après l&apos;achat</>}
                {p.daysFromStart != null && <> ({days(p.daysFromStart)} après la première mise en ligne)</>}.
                {p.recovered > p.cost && <> Depuis : <b>{money(p.recovered - p.cost)}</b> de bénéfice encaissé.</>}</>
            )}
            {p.status === "en_cours" && (
              <>Reste <b>{money(p.remaining)}</b> à encaisser pour rembourser le lot.
                {p.projection
                  ? <> À ce rythme ({money(Math.round(p.projection.perDay))} par jour) : remboursé vers le <b>{longDay(p.projection.at)}</b>, dans ≈ {days(Math.round(p.projection.days))} <span className="text-amber-700 dark:text-amber-300">(estimation)</span>.</>
                  : <span className="text-muted"> Estimation : pas encore assez de ventes payées ({PAYBACK_MIN_SALES} ventes et {PAYBACK_MIN_DAYS} jours minimum).</span>}</>
            )}
            {p.status === "pas_commence" && <span className="text-muted">Aucune vente encaissée pour l&apos;instant.</span>}
            {p.status === "perte" && <>Tout le lot est vendu et encaissé : il manque <b className="text-red-700 dark:text-red-300">{money(p.remaining)}</b> pour couvrir son coût.</>}
          </p>
          {p.pending > 0 && (
            <p className="text-xs text-muted" data-testid="payback-pending">Plus {money(p.pending)} vendus, pas encore payés (en route, non comptés).</p>
          )}
        </>
      )}
    </section>
  );
}
