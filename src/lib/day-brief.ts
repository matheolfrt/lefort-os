// « Ma journée »: the dashboard said in one sentence, written from the figures. Yesterday against the usual day, then
// what today asks for: orders to ship, items ready to publish, prices to lower, the pace the month's objective needs.
// Operators get the same sentence without money.

import { METRICS, standing, targets, type GoalMetric, type GoalProgress } from "@/lib/goals";

export interface BriefPart { text: string; note?: string; href?: string; tone?: "good" | "bad" | "same" }
export interface Brief { yesterday: BriefPart[]; today: BriefPart[] }

const euro = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eur = (cents: number) => euro.format(Math.round(cents / 100));
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("fr-FR")} ${n > 1 ? many : one}`;
/** Below this relative gap, yesterday was an ordinary day */
const SAME = 0.1;

export interface BriefInput {
  progress: GoalProgress | null;
  ship: number;     // orders to ship
  publish: number;  // items ready to publish
  prices: number;   // prices the rules suggest lowering today
  manager: boolean;
}

export function dayBrief({ progress: p, ship, publish, prices, manager }: BriefInput): Brief {
  const yesterday: BriefPart[] = [];
  const today: BriefPart[] = [];
  const days = p?.days ?? [];
  const money = manager && days.every((d) => d.revenue_cents != null);

  if (days.length >= 2) {
    const y = days.at(-2)!;
    // the usual day: the days before yesterday, from the first one with a sale (a new shop has no « zero » past)
    const before = days.slice(0, -2);
    const start = before.findIndex((d) => d.sales > 0);
    const usual = start < 0 ? [] : before.slice(start);
    const key = money ? "revenue_cents" : "sales";
    const avg = usual.length >= 3 ? usual.reduce((s, d) => s + Number(d[key] ?? 0), 0) / usual.length : null;
    const value = Number(y[key] ?? 0);

    if (y.sales === 0) yesterday.push({ text: "aucune vente" });
    else yesterday.push({ text: money ? `${plural(y.sales, "vente")}, ${eur(value)}` : plural(y.sales, "vente") });
    if (avg != null && avg > 0) {
      const pct = (value - avg) / avg;
      const usualText = money ? `${eur(avg)} par jour` : `${avg.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} vente${avg >= 2 ? "s" : ""} par jour`;
      // a day without a sale is not « 100 % below »: just say what a usual day brings
      if (y.sales === 0) yesterday.push({ text: "", note: `d'habitude ${usualText}`, tone: "same" });
      else if (Math.abs(pct) < SAME) yesterday.push({ text: "dans votre moyenne", note: `(${usualText})`, tone: "same" });
      else {
        const pctText = `${Math.round(Math.abs(pct) * 100)} %`;
        yesterday.push(pct > 0
          ? { text: `↑ ${pctText} au-dessus`, note: `de votre moyenne (${usualText})`, tone: "good" }
          : { text: `↓ ${pctText} en dessous`, note: `de votre moyenne (${usualText})`, tone: "bad" });
      }
    }
    const t = days.at(-1)!;
    if (t.sales > 0) today.push({ text: `déjà ${plural(t.sales, "vente")}${money ? ` (${eur(Number(t.revenue_cents))})` : ""}` });
  }

  if (ship > 0) today.push({ text: `${plural(ship, "commande")} à expédier`, href: "/postes/expedition" });
  if (publish > 0) today.push({ text: `${plural(publish, "article prêt", "articles prêts")} à publier`, href: "/stock?status=listing_ready" });
  if (manager && prices > 0) today.push({ text: `${plural(prices, "prix", "prix")} à baisser`, href: "/prix" });

  // the month's objectives: what each remaining day has to bring (or that it is done)
  if (p) {
    const goals: BriefPart[] = [];
    for (const metric of METRICS) {
      if (metric === "revenue" && !money) continue;
      const target = targets(p, metric).month;
      const s = target ? standing(p, "month", metric, target) : null;
      if (!s) continue;
      if (s.pace === "done") { goals.push({ text: `objectif du mois atteint (${GOAL_NAME[metric]})`, href: "/objectifs", tone: "good" }); continue; }
      const per = s.perDayNeeded ?? 0;
      goals.push({ text: `${PER_DAY[metric](per)} par jour pour tenir l'objectif du mois`, href: "/objectifs" });
    }
    today.push(...goals.slice(0, 2));
  }
  return { yesterday, today };
}

const GOAL_NAME: Record<GoalMetric, string> = { revenue: "chiffre d'affaires", sales: "ventes", listed: "mises en ligne" };
const PER_DAY: Record<GoalMetric, (v: number) => string> = {
  revenue: (v) => `${eur(Math.ceil(v / 100) * 100)} de ventes`,
  sales: (v) => plural(Math.max(1, Math.ceil(v - 1e-9)), "vente"),
  listed: (v) => `${plural(Math.max(1, Math.ceil(v - 1e-9)), "article")} à mettre en ligne`,
};

/** « a, b et c » */
export function joinFr(xs: string[]) {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} et ${xs.at(-1)}`;
}
