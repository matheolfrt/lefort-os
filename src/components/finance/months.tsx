import { euro, pnlSummary, type MonthPnl } from "@/lib/finance";
import { Explain } from "./explain";

const MONTH = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const name = (key: string) => `${MONTH[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
const short = (key: string) => `${SHORT[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

/** Profit month by month, the most recent first: what was sold, what it cost, what is left */
export function Months({ months, ratePct }: { months: MonthPnl[]; ratePct: number }) {
  const sum = pnlSummary(months);
  const active = months.filter((m) => m.items > 0 || m.charges > 0);
  if (!active.length) return <p className="text-sm text-muted">Aucune vente sur les 12 derniers mois.</p>;
  const max = Math.max(...months.map((m) => Math.abs(m.net)), 1);
  const estimated = months.reduce((s, m) => s + m.estimated, 0);
  return (
    <>
      {sum && (
        <p className="text-sm text-muted" data-testid="months-summary">
          Meilleur mois : <strong className="font-semibold text-fg">{name(sum.best.month)}</strong> ({euro(sum.best.net)})
          {sum.count > 1 && <> · le plus faible : {name(sum.worst.month)} ({euro(sum.worst.net)})</>}
          {" "}· en moyenne <strong className="font-semibold text-fg">{euro(sum.avgNet)}</strong> par mois complet · {euro(sum.totalNet)} de bénéfice sur 12 mois
        </p>
      )}
      <div className="overflow-x-auto rounded-2xl border border-line bg-panel/80">
        <table className="data min-w-[700px]" data-testid="months">
          <thead>
            <tr>
              {/* the profit right after the month: it stays in view on a phone, the detail scrolls */}
              <th>Mois</th><th className="num">Bénéfice</th><th className="num">Ventes</th><th className="num">Pièces</th><th className="num">Achats</th>
              <th className="num">Frais</th><th className="num">Cotisations</th><th className="num">Charges</th><th className="num">Par pièce</th>
            </tr>
          </thead>
          <tbody>
            {[...months].reverse().map((m) => {
              const empty = m.items === 0 && m.charges === 0;
              return (
                <tr key={m.month} data-month={m.month} className={empty ? "text-muted" : ""}>
                  <td className="whitespace-nowrap font-medium"><span title={name(m.month)}>{short(m.month)}</span>{m.partial && <span className="ml-1.5 text-xs font-normal text-muted">en cours</span>}</td>
                  <td className={`num font-semibold ${m.net < 0 ? "text-red-300" : ""}`}>
                    {empty ? "—" : euro(m.net)}
                    {!empty && (
                      <span aria-hidden className="mt-1 block h-1 overflow-hidden rounded-full bg-line/50">
                        <span className="ml-auto block h-full rounded-full" style={{ width: `${Math.max(3, (Math.abs(m.net) / max) * 100)}%`, background: m.net < 0 ? "#f87171" : "var(--series-1)" }} />
                      </span>
                    )}
                  </td>
                  <td className="num">{m.items ? euro(m.revenue) : "—"}</td>
                  <td className="num">{m.items || "—"}</td>
                  <td className="num">{m.items ? `${m.estimated ? "≈ " : ""}${euro(m.cogs)}` : "—"}</td>
                  <td className="num">{m.items ? euro(m.variable) : "—"}</td>
                  <td className="num">{m.items ? euro(m.contributions) : "—"}</td>
                  <td className="num">{m.charges ? euro(m.charges) : "—"}</td>
                  <td className="num">{m.items ? euro(m.net / m.items) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Explain label="Comment est calculé le bénéfice d'un mois ?" lines={[
        { label: "Ventes du mois (prix des pièces, remboursements déduits)", value: "" },
        { label: "Achats : prix d'achat des pièces vendues ce mois-là", value: "", op: "−" },
        { label: "Frais : frais Vinted, port et emballage à votre charge", value: "", op: "−" },
        { label: `Cotisations : ${ratePct.toLocaleString("fr-FR")} % des ventes du mois (estimation)`, value: "", op: "−" },
        { label: "Charges : charges récurrentes à leur date et dépenses enregistrées", value: "", op: "−" },
        { label: "Bénéfice du mois", value: "", op: "=" },
      ]} note={estimated ? `« ≈ » : le mois contient des ventes sans prix d'achat réel (${estimated} sur 12 mois), comptées 10 € pour un Harris, un manteau ou un costume et 4 € sinon.` : undefined} />
    </>
  );
}
