import { Fragment } from "react";
import { Help } from "@/components/ui";
import { perHour, type GroupStats } from "@/lib/kpi/compute";

// One line per type (or brand): what it sells for, how much of it sells and how fast, what it leaves, the most to pay
// for one, and the advice that follows. Server-rendered; the 12 small bars are the average price of each month.

const euro0 = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
export const eur = (cents: number | null | undefined) => (cents == null ? "—" : euro0.format(Math.round(cents / 100)));
export const eurPrecise = (cents: number | null | undefined) =>
  cents == null ? "—" : `${(cents / 100).toLocaleString("fr-FR", { maximumFractionDigits: cents % 100 ? 2 : 0, minimumFractionDigits: cents % 100 ? 2 : 0 })} €`;
const days = (d: number | null) => (d == null ? "—" : d < 1 ? "< 1 j" : `${d < 10 ? (Math.round(d * 10) / 10).toLocaleString("fr-FR") : Math.round(d)} j`);
const MONTH = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const monthName = (key: string) => `${MONTH[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

export const TONE = {
  up: "text-accent",
  down: "text-red-300",
  ok: "text-fg",
  few: "text-muted",
} as const;

function Spark({ months }: { months: GroupStats["months"] }) {
  const max = Math.max(...months.map((m) => m.avg ?? 0));
  if (!max) return <span className="text-muted">—</span>;
  const label = months.filter((m) => m.n).map((m) => `${monthName(m.month)} : ${eur(m.avg)} (${m.n})`).join(" · ");
  return (
    <span role="img" aria-label={`Prix moyen par mois : ${label}`} title={label} className="inline-flex h-7 items-end gap-[2px]">
      {months.map((m) => (
        <span key={m.month} className="w-[5px] rounded-sm"
          style={{ height: m.avg ? `${Math.max(12, (m.avg / max) * 100)}%` : "2px", background: m.avg ? "var(--series-1)" : "var(--line)" }} />
      ))}
    </span>
  );
}

export function GroupTable({ rows, minutes, first = "Type", empty }: { rows: GroupStats[]; minutes: number; first?: string; empty: string }) {
  if (!rows.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <div className="-mx-4 -mb-4 overflow-x-auto sm:-mx-5 sm:-mb-5">
      <table className="data">
        <thead>
          <tr>
            <th>{first}</th>
            <th className="num">Vendus</th>
            <th className="num">Prix moyen</th>
            <th className="num"><span className="inline-flex items-center gap-1">% vendus<Help text="Part des pièces vendues, sur les lots achetés reçus il y a plus de 30 jours. « ≈ » : trop peu de lots achetés, calculé sur toutes les pièces (le dressing importé ne contient presque que des pièces vendues : le chiffre est flatteur)." /></span></th>
            <th className="num"><span className="inline-flex items-center gap-1">Délai<Help text="Délai médian entre la mise en ligne et la vente, sur les pièces dont la date de mise en ligne est connue. Entre parenthèses : la part vendue en moins de 2 jours." /></span></th>
            <th className="num"><span className="inline-flex items-center gap-1">Marge / pièce<Help text="Prix de vente moins frais et prix d'achat. Quand le prix d'achat n'a jamais été saisi (0 ou 1 €), on compte 10 € pour un Harris, un manteau ou un costume, 4 € sinon." /></span></th>
            <th className="num"><span className="inline-flex items-center gap-1">€ / heure<Help text={`Marge par pièce pour ${minutes} minutes de travail par pièce (tri, photo, mesures, annonce, colis). Change ce temps au-dessus du tableau.`} /></span></th>
            <th className="num"><span className="inline-flex items-center gap-1">Achat max<Help text="Le plus à payer pour une pièce : ¼ du prix moyen de vente (la règle du Harris : 10 € pour 40 €)." /></span></th>
            <th className="num">En stock</th>
            <th>12 mois</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <Fragment key={g.key}>
            <tr className="[&>td]:border-b-0 [&>td]:pb-1">
              <td className="min-w-36 font-medium">{g.label}</td>
              <td className="num">{g.sold}</td>
              <td className="num">
                <span className="font-semibold">{eur(g.avgPrice)}</span>
                {g.medianPrice != null && g.sold > 1 && <span className="block text-xs text-muted">médiane {eur(g.medianPrice)}</span>}
              </td>
              <td className="num">{g.sellThrough.pct == null ? "—" : `${g.sellThrough.approx ? "≈ " : ""}${Math.round(g.sellThrough.pct)} %`}
                {g.sellThrough.base > 0 && <span className="block text-xs text-muted">sur {g.sellThrough.base}</span>}
              </td>
              <td className="num">{days(g.medianDays)}
                {g.fastShare != null && <span className="block text-xs text-muted">{Math.round(g.fastShare * 100)} % en 2 j</span>}
              </td>
              <td className="num">{eur(g.marginPerPiece)}
                {g.estimatedCosts > 0 && <span className="block text-xs text-muted">{g.estimatedCosts} coût{g.estimatedCosts > 1 ? "s" : ""} supposé{g.estimatedCosts > 1 ? "s" : ""}</span>}
              </td>
              <td className="num">{eur(perHour(g.marginPerPiece, minutes))}</td>
              <td className="num font-semibold text-accent">{eurPrecise(g.maxBuy)}</td>
              <td className="num">{g.inStock || "—"}
                {g.stockAvgPrice != null && <span className="block text-xs text-muted">affiché {eur(g.stockAvgPrice)}</span>}
              </td>
              <td><Spark months={g.months} /></td>
            </tr>
            <tr className="[&>td]:pt-0">
              <td colSpan={10} className={`text-sm ${TONE[g.advice.tone]}`}>
                {/* stays in view when the table scrolls sideways on a phone */}
                <span className="sticky left-2.5 block max-w-[calc(100vw-4rem)]">{g.advice.text}</span>
              </td>
            </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
