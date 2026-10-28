// Suppliers judged on what matters to buy again from them. A lot still being sold is not counted as a loss: margin
// is measured on the items sold, and "paid back" says how much of what was paid has already come back.
// Same thresholds as the Conseils page, so the two never disagree.

export interface SupplierRow {
  id: string; name: string; country: string | null; contact: string | null; notes: string | null; active: boolean;
  opening_only: boolean; batches: number; first_purchase: string | null; last_purchase: string | null;
  paid_cents: number; items: number; sold: number; rejected: number; in_stock: number;
  stock_cost_cents: number; stock_price_cents: number; revenue_cents: number; variable_cents: number;
  profit_cents: number; sold_cost_cents: number; avg_days: number | null; timed: number; matured: number; in_time: number;
}

export type SupplierVerdict = "buy" | "ok" | "slow" | "avoid" | "few" | "stock";
export const VERDICT: Record<SupplierVerdict, { label: string; tone: string; order: number }> = {
  buy: { label: "À racheter", tone: "bg-accent/15 text-accent ring-accent/30", order: 0 },
  ok: { label: "Correct", tone: "bg-sky-400/10 text-sky-300 ring-sky-400/25", order: 1 },
  slow: { label: "Rentable mais lent", tone: "bg-amber-400/10 text-amber-300 ring-amber-400/25", order: 2 },
  avoid: { label: "À éviter", tone: "bg-red-500/15 text-red-300 ring-red-400/30", order: 3 },
  few: { label: "Trop tôt pour juger", tone: "bg-fg/5 text-muted ring-line", order: 4 },
  stock: { label: "Hors classement", tone: "bg-fg/5 text-muted ring-line", order: 5 },
};

export const MIN_SOLD = 5;      // sales needed before a supplier is judged
const BUY_FACTOR = 1.2;         // ≥ 20 % more margin per item than the average supplier
const AVOID_FACTOR = 0.4;       // ≤ 40 % of the average margin per item
const MAX_REJECT = 0.3;         // more than 30 % of a lot unsellable

export interface Judged extends SupplierRow {
  costPerItem: number | null;   // what one item cost (lot price shared over its items)
  avgSale: number | null;       // average resale price
  multiple: number | null;      // resale price / cost
  marginPerSold: number | null; // after fees and cost, per item sold
  paybackPct: number | null;    // share of what was paid that has come back (sales after fees)
  sellThroughPct: number | null; // sold within the target window, on items old enough to tell
  rejectPct: number | null;
  verdict: SupplierVerdict;
  reasons: string[];
}

const eur = (cents: number) => `${Math.round(cents / 100).toLocaleString("fr-FR")} €`;
const pct = (v: number) => `${Math.round(v)} %`;

export function judge(rows: SupplierRow[], targetPct: number): { list: Judged[]; ref: { marginPerSold: number | null; avgDays: number | null } } {
  const bought = rows.filter((r) => !r.opening_only);
  const sold = bought.reduce((a, r) => a + r.sold, 0);
  const timed = bought.reduce((a, r) => a + r.timed, 0);
  const ref = {
    marginPerSold: sold ? bought.reduce((a, r) => a + r.profit_cents, 0) / sold : null,
    avgDays: timed ? bought.reduce((a, r) => a + (r.avg_days ?? 0) * r.timed, 0) / timed : null,
  };

  const list = rows.map((r): Judged => {
    const costPerItem = r.items ? r.paid_cents / r.items : null;
    const avgSale = r.sold ? r.revenue_cents / r.sold : null;
    const marginPerSold = r.sold ? r.profit_cents / r.sold : null;
    const sellThroughPct = r.matured >= 5 ? (r.in_time * 100) / r.matured : null;
    const rejectPct = r.items ? (r.rejected * 100) / r.items : null;
    const j: Judged = {
      ...r, costPerItem, avgSale, marginPerSold, sellThroughPct, rejectPct,
      multiple: costPerItem && avgSale ? avgSale / costPerItem : null,
      paybackPct: r.paid_cents > 0 ? ((r.revenue_cents - r.variable_cents) * 100) / r.paid_cents : null,
      verdict: "ok", reasons: [],
    };
    if (r.opening_only) {
      j.verdict = "stock";
      j.reasons.push("Votre stock d'avant Lefort OS : coûts estimés, il ne se compare pas à un vrai fournisseur.");
      return j;
    }
    if (r.sold < MIN_SOLD) {
      j.verdict = "few";
      j.reasons.push(r.items ? `${r.sold} vente${r.sold > 1 ? "s" : ""} sur ${r.items} articles : il en faut ${MIN_SOLD} pour juger.` : "Aucun lot acheté pour l'instant.");
      return j;
    }
    const fast = ref.avgDays == null || r.avg_days == null || r.avg_days <= ref.avgDays * 1.1;
    const goodMargin = marginPerSold != null && ref.marginPerSold != null && marginPerSold >= ref.marginPerSold * BUY_FACTOR;
    // losing money, thin margin or too many unsellable items: avoid whatever the speed
    if (marginPerSold != null && marginPerSold <= 0) j.reasons.push(`Chaque article vendu fait perdre ${eur(-marginPerSold)} une fois le coût et les frais payés.`);
    else if (marginPerSold != null && ref.marginPerSold != null && marginPerSold <= ref.marginPerSold * AVOID_FACTOR)
      j.reasons.push(`${eur(marginPerSold)} de marge par article, contre ${eur(ref.marginPerSold)} en moyenne.`);
    if (rejectPct != null && rejectPct / 100 > MAX_REJECT) j.reasons.push(`${pct(rejectPct)} des articles écartés (abîmés ou invendables).`);
    // too slow for the 30-day target: avoid if the margin does not make up for it, otherwise "profitable but slow"
    const tooSlow = sellThroughPct != null && r.matured >= 10 && sellThroughPct < targetPct / 2;
    const atLeastAverage = marginPerSold != null && ref.marginPerSold != null && marginPerSold >= ref.marginPerSold;
    const slowLine = `seulement ${pct(sellThroughPct ?? 0)} vendus en 30 jours (objectif ${targetPct} %)`;

    if (j.reasons.length) j.verdict = "avoid";
    else if (tooSlow && !atLeastAverage) { j.verdict = "avoid"; j.reasons.push(`${slowLine[0].toUpperCase()}${slowLine.slice(1)}, sans marge supérieure pour compenser.`); }
    else if (tooSlow || (goodMargin && !fast)) {
      j.verdict = "slow";
      j.reasons.push(`Bonne marge (${eur(marginPerSold!)} par article, moyenne ${eur(ref.marginPerSold!)}) mais ${tooSlow ? slowLine : `vendu en ${Math.round(r.avg_days ?? 0)} j contre ${Math.round(ref.avgDays ?? 0)} j en moyenne`} : achetez moins cher ou baissez les prix plus tôt.`);
    } else if (goodMargin) {
      j.verdict = "buy";
      j.reasons.push(`${eur(marginPerSold!)} de marge par article (moyenne ${eur(ref.marginPerSold!)})${r.avg_days != null ? `, vendu en ${Math.round(r.avg_days)} j` : ""}.`);
    } else {
      j.reasons.push(`${eur(marginPerSold ?? 0)} de marge par article, proche de la moyenne${r.avg_days != null ? `, vendu en ${Math.round(r.avg_days)} j` : ""}.`);
    }
    return j;
  });

  // best first: by verdict, then margin per day of stock, then volume
  const perDay = (j: Judged) => (j.marginPerSold != null && j.avg_days ? j.marginPerSold / Math.max(j.avg_days, 1) : -1e9);
  list.sort((a, b) => VERDICT[a.verdict].order - VERDICT[b.verdict].order || perDay(b) - perDay(a) || b.sold - a.sold || a.name.localeCompare(b.name, "fr"));
  return { list, ref };
}
