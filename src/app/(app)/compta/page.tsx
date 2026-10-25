import Link from "next/link";
import { requireManager } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Card, PageHeader, Stat, btn } from "@/components/ui";
import { date, money } from "@/lib/format";
import { MICRO_TURNOVER_CEILING_CENTS, VAT_FRANCHISE_THRESHOLD_CENTS } from "@/lib/compliance";

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

export default async function Accounting({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const ctx = await requireManager();
  const year = Number((await searchParams).year) || new Date().getFullYear();
  const from = `${year}-01-01`, to = `${year}-12-31`;
  const supabase = await createClient();
  const [{ data: months }, { data: receipts }, { data: purchases }, { data: rates }] = await Promise.all([
    supabase.from("v_monthly_turnover").select("*").gte("month", from).lte("month", to).order("month"),
    supabase.from("v_livre_recettes").select("*").gte("date_encaissement", from).lte("date_encaissement", to).order("date_encaissement"),
    supabase.from("v_registre_achats").select("*").gte("date_achat", from).lte("date_achat", to).order("date_achat"),
    supabase.from("tax_rates").select("*").order("valid_from", { ascending: false }),
  ]);
  const byMonth = new Map((months ?? []).map((m) => [Number(m.month.slice(5, 7)) - 1, m]));
  const total = (months ?? []).reduce((s, m) => s + Number(m.turnover_cents), 0);
  const contrib = (months ?? []).reduce((s, m) => s + Number(m.contributions_cents), 0);
  const quarterly = ctx.org.declaration_frequency === "quarterly";
  const periods = quarterly
    ? [0, 1, 2, 3].map((q) => ({ label: `T${q + 1}`, idx: [q * 3, q * 3 + 1, q * 3 + 2] }))
    : MONTHS.map((m, i) => ({ label: m, idx: [i] }));

  return (
    <>
      <PageHeader
        title={`Compta & URSSAF ${year}`}
        subtitle="Chiffre d'affaires = ventes encaissées (date de mise à disposition de l'argent), remboursements déduits."
        actions={
          <>
            <Link className={btn.secondary} href={`/compta?year=${year - 1}`}>← {year - 1}</Link>
            <Link className={btn.secondary} href={`/compta?year=${year + 1}`}>{year + 1} →</Link>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="CA encaissé" value={money(total)} />
        <Stat label="Cotisations estimées" value={money(contrib)} hint={ctx.org.versement_liberatoire ? "versement libératoire inclus" : undefined} />
        <Stat label="Franchise TVA" value={`${Math.round((total / VAT_FRANCHISE_THRESHOLD_CENTS) * 100)} %`} hint={money(VAT_FRANCHISE_THRESHOLD_CENTS)} />
        <Stat label="Plafond micro" value={`${Math.round((total / MICRO_TURNOVER_CEILING_CENTS) * 100)} %`} hint={money(MICRO_TURNOVER_CEILING_CENTS)} />
      </div>

      <Card title={`Déclarations ${quarterly ? "trimestrielles" : "mensuelles"}`} className="mb-4">
        <div className="overflow-x-auto">
          <table className="data">
            <thead><tr><th>Période</th><th className="num">CA à déclarer</th><th className="num">Cotisations estimées</th></tr></thead>
            <tbody>
              {periods.map((p) => {
                const ca = p.idx.reduce((s, i) => s + Number(byMonth.get(i)?.turnover_cents ?? 0), 0);
                const c = p.idx.reduce((s, i) => s + Number(byMonth.get(i)?.contributions_cents ?? 0), 0);
                return <tr key={p.label}><td>{p.label}</td><td className="num font-semibold">{money(ca)}</td><td className="num">{money(c)}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">
          Taux utilisés : {(rates ?? []).map((r) => `${r.kind} ${String(r.rate_pct).replace(".", ",")} % (depuis ${date(r.valid_from)})`).join(" · ")}.
          Vérifiez les taux en vigueur sur urssaf.fr — ils se modifient dans Paramètres.
        </p>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title={`Livre des recettes (${receipts?.length ?? 0})`}>
          <a className={`${btn.secondary} mb-3`} href={`/compta-export?type=recettes&year=${year}`}>Exporter CSV</a>
          <div className="max-h-[480px] overflow-auto">
            <table className="data">
              <thead><tr><th>Date</th><th>Réf.</th><th>Client</th><th>Nature</th><th className="num">Montant</th><th>Règlement</th></tr></thead>
              <tbody>
                {(receipts ?? []).map((r, i) => (
                  <tr key={i}><td>{date(r.date_encaissement)}</td><td className="font-mono">{r.reference}</td><td>{r.client}</td><td className="text-xs">{r.nature}</td><td className="num">{money(r.montant_cents)}</td><td className="text-xs">{r.mode_reglement}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title={`Registre des achats (${purchases?.length ?? 0})`}>
          <a className={`${btn.secondary} mb-3`} href={`/compta-export?type=achats&year=${year}`}>Exporter CSV</a>
          <div className="max-h-[480px] overflow-auto">
            <table className="data">
              <thead><tr><th>Date</th><th>Fournisseur</th><th>Facture</th><th>Nature</th><th className="num">Montant</th><th>Règlement</th></tr></thead>
              <tbody>
                {(purchases ?? []).map((r, i) => (
                  <tr key={i}><td>{date(r.date_achat)}</td><td>{r.fournisseur}</td><td>{r.reference_facture}</td><td className="text-xs">{r.nature}</td><td className="num">{money(r.montant_cents)}</td><td className="text-xs">{r.mode_reglement}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
