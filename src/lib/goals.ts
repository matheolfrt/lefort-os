// Objectives: a target per period for sales revenue, items sold and items put on sale, and where each one stands.
// A period without its own target borrows the pace of the others: 6 000 € for the month is 200 € a day in a 30-day
// month, 1 400 € for the week… so one objective is enough to follow every period.

export type GoalPeriod = "day" | "week" | "month" | "year";
export type GoalMetric = "revenue" | "sales" | "listed";

export interface PeriodFigures {
  starts: string; ends: string;
  sales: number; listed: number; revenue_cents: number | null;
  prev: { sales: number; listed: number; revenue_cents: number | null };
}
export interface GoalProgress {
  now: string;
  manager: boolean;
  periods: Record<GoalPeriod, PeriodFigures>;
  days: { day: string; sales: number; listed: number; revenue_cents: number | null }[];
  goals: { period: GoalPeriod; metric: GoalMetric; target: number }[];
}

export const PERIODS: GoalPeriod[] = ["day", "week", "month", "year"];
export const METRICS: GoalMetric[] = ["revenue", "sales", "listed"];

export const PERIOD_LABEL: Record<GoalPeriod, string> = { day: "Aujourd'hui", week: "Cette semaine", month: "Ce mois", year: "Cette année" };
export const PERIOD_NAME: Record<GoalPeriod, string> = { day: "jour", week: "semaine", month: "mois", year: "année" };
export const PERIOD_PREV: Record<GoalPeriod, string> = { day: "hier", week: "la semaine dernière", month: "le mois dernier", year: "l'an dernier" };
export const METRIC_LABEL: Record<GoalMetric, string> = { revenue: "Chiffre d'affaires", sales: "Articles vendus", listed: "Articles mis en ligne" };
export const METRIC_SHORT: Record<GoalMetric, string> = { revenue: "CA", sales: "Ventes", listed: "Mis en ligne" };

const DAY_MS = 86_400_000;
const euro = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

/** A value of a metric, as people read it: « 1 250 € », « 12 articles » */
export function formatValue(metric: GoalMetric, v: number | null | undefined, short = false): string {
  if (v == null) return "—";
  if (metric === "revenue") return euro.format(Math.round(v / 100));
  return short ? String(Math.round(v)) : `${Math.round(v)} article${Math.round(v) > 1 ? "s" : ""}`;
}

export function actual(f: PeriodFigures, metric: GoalMetric): number | null {
  return metric === "revenue" ? f.revenue_cents : f[metric];
}
export function previous(f: PeriodFigures, metric: GoalMetric): number | null {
  return metric === "revenue" ? f.prev.revenue_cents : f.prev[metric];
}

/** Length of the current period in days (a month has 28 to 31, a day with a clock change still counts as one) */
export function periodDays(f: PeriodFigures, period: GoalPeriod): number {
  if (period === "day") return 1;
  if (period === "week") return 7;
  return Math.round((new Date(f.ends).getTime() - new Date(f.starts).getTime()) / DAY_MS);
}

export interface Target { value: number; own: boolean; from?: GoalPeriod }

/**
 * Target of every period for one metric: its own when set, otherwise derived from the daily pace of the set one
 * (month first, then week, year, day). Counts are rounded up: half an article is still an article to sell.
 */
export function targets(p: GoalProgress, metric: GoalMetric): Partial<Record<GoalPeriod, Target>> {
  const own = new Map(p.goals.filter((g) => g.metric === metric).map((g) => [g.period, Number(g.target)]));
  const out: Partial<Record<GoalPeriod, Target>> = {};
  const anchor = (["month", "week", "year", "day"] as GoalPeriod[]).find((x) => own.has(x));
  const perDay = anchor ? own.get(anchor)! / periodDays(p.periods[anchor], anchor) : null;
  for (const period of PERIODS) {
    if (own.has(period)) out[period] = { value: own.get(period)!, own: true };
    else if (perDay != null) {
      const raw = perDay * periodDays(p.periods[period], period);
      // round amounts the way people state them: to the euro for a day, 10 € for a week, 100 € beyond
      const unit = period === "day" ? 100 : period === "week" ? 1000 : 10000;
      const value = metric === "revenue" ? Math.max(unit, Math.round(raw / unit) * unit) : Math.max(1, Math.ceil(raw - 1e-9));
      out[period] = { value, own: false, from: anchor };
    }
  }
  return out;
}

export type Pace = "done" | "ahead" | "on_track" | "behind" | "late";
export const PACE_LABEL: Record<Pace, string> = {
  done: "Objectif atteint", ahead: "En avance", on_track: "Dans les temps", behind: "Un peu en retard", late: "En retard",
};

export interface Standing {
  period: GoalPeriod; metric: GoalMetric;
  target: Target; actual: number;
  pct: number;          // of the target
  elapsedPct: number;   // of the period
  expected: number;     // what should be done by now at an even pace
  remaining: number;    // still to do
  daysLeft: number;     // including today
  perDayNeeded: number | null; // to do each remaining day (null for the day itself)
  projection: number | null;   // where the current pace leads at the end of the period
  pace: Pace;
}

export function standing(p: GoalProgress, period: GoalPeriod, metric: GoalMetric, target: Target, now = new Date(p.now)): Standing | null {
  const f = p.periods[period];
  const value = actual(f, metric);
  if (value == null) return null;
  const start = new Date(f.starts).getTime(), end = new Date(f.ends).getTime();
  const elapsed = Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));
  const expected = target.value * elapsed;
  const remaining = Math.max(0, target.value - value);
  const daysLeft = Math.max(1, Math.ceil((end - now.getTime()) / DAY_MS));
  const ratio = expected > 0 ? value / expected : 1;
  const pace: Pace = value >= target.value ? "done" : ratio >= 1.1 ? "ahead" : ratio >= 0.95 ? "on_track" : ratio >= 0.75 ? "behind" : "late";
  return {
    period, metric, target, actual: value,
    pct: Math.round((value / target.value) * 100),
    elapsedPct: Math.round(elapsed * 100),
    expected, remaining, daysLeft,
    perDayNeeded: period === "day" ? null : remaining / daysLeft,
    // too early in the period, a projection says nothing
    projection: period !== "day" && elapsed >= 0.15 ? value / elapsed : null,
    pace,
  };
}

/** The sentence under a bar: what it means for today */
export function advice(s: Standing): string {
  const v = (x: number) => formatValue(s.metric, s.metric === "revenue" ? x : Math.ceil(x - 1e-9));
  if (s.pace === "done") {
    const over = s.actual - s.target.value;
    return over > 0 ? `Dépassé de ${v(over)}.` : "Atteint, bravo.";
  }
  if (s.period === "day") return `Encore ${v(s.remaining)} aujourd'hui.`;
  const per = `${v(s.perDayNeeded!)} par jour`;
  const proj = s.projection != null ? ` À ce rythme : ${v(s.projection)}.` : "";
  return `Encore ${v(s.remaining)} en ${s.daysLeft} j, soit ${per}.${proj}`;
}

/** Ideas of a target, from what was really done: last period, the last 30 days at the same pace, a bit more */
export function suggestions(p: GoalProgress, period: GoalPeriod, metric: GoalMetric): { label: string; value: number }[] {
  const f = p.periods[period];
  const prev = previous(f, metric);
  const last30 = p.days.reduce((s, d) => s + ((metric === "revenue" ? d.revenue_cents : d[metric]) ?? 0), 0);
  const days = periodDays(f, period);
  const round = (x: number) => (metric === "revenue" ? Math.round(x / 1000) * 1000 : Math.ceil(x));
  const out: { label: string; value: number }[] = [];
  if (prev) out.push({ label: `comme ${PERIOD_PREV[period]}`, value: round(prev) });
  if (last30) {
    out.push({ label: "rythme des 30 derniers jours", value: round((last30 / 30) * days) });
    out.push({ label: "ce rythme + 20 %", value: round((last30 / 30) * days * 1.2) });
  }
  const seen = new Set<number>();
  return out.filter((s) => s.value > 0 && !seen.has(s.value) && seen.add(s.value));
}
