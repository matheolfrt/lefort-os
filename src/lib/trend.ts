// Sales day by day for the dashboard: this month against last month, this week against last week (Paris calendar).
// Built from the items sold (sale date and revenue), the same figures as the rest of the dashboard.

export interface DayPoint {
  day: string;       // YYYY-MM-DD
  revenue: number;   // cents sold that day
  sales: number;     // items sold that day
  future: boolean;   // after today: not drawn for the current period
}
export interface TrendPeriod {
  kind: "month" | "week";
  label: string;       // « Octobre », « Semaine du 26 oct. »
  prevLabel: string;   // « Septembre », « Semaine précédente »
  days: DayPoint[];
  prev: DayPoint[];
  todayIndex: number;  // position of today in days
  goalPerDay: number | null; // revenue objective spread over each day (cents), for the pace line
}

const parisDayFmt = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
export const parisDay = (d: Date | string) => parisDayFmt.format(typeof d === "string" ? new Date(d) : d);

const at = (day: string) => new Date(`${day}T12:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
export function addDays(day: string, n: number) { const d = at(day); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
const weekday = (day: string) => (at(day).getUTCDay() + 6) % 7; // 0 = Monday
const daysInMonth = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

const MONTHS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const shortDate = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });

function series(from: string, n: number, byDay: Map<string, { revenue: number; sales: number }>, today: string): DayPoint[] {
  return Array.from({ length: n }, (_, i) => {
    const day = addDays(from, i);
    const v = byDay.get(day);
    return { day, revenue: v?.revenue ?? 0, sales: v?.sales ?? 0, future: day > today };
  });
}

/** Revenue objectives as set in Objectifs, turned into a daily pace (same rule as the goals page: month first) */
export function revenuePerDay(goals: { period: string; metric: string; target: number }[], today: string): number | null {
  const own = new Map(goals.filter((g) => g.metric === "revenue").map((g) => [g.period, Number(g.target)]));
  const t = at(today);
  const len: Record<string, number> = {
    month: daysInMonth(t.getUTCFullYear(), t.getUTCMonth()), week: 7, day: 1,
    year: (Date.UTC(t.getUTCFullYear() + 1, 0, 1) - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86_400_000,
  };
  const anchor = ["month", "week", "year", "day"].find((p) => own.has(p));
  return anchor ? own.get(anchor)! / len[anchor] : null;
}

export function buildTrend(
  sold: { sold_at: string | null; revenue_cents: number | string }[],
  now: Date,
  goals: { period: string; metric: string; target: number }[] = [],
): { month: TrendPeriod; week: TrendPeriod } {
  const today = parisDay(now);
  const t = at(today);
  const y = t.getUTCFullYear(), m0 = t.getUTCMonth();
  const monthStart = iso(new Date(Date.UTC(y, m0, 1)));
  const prevMonthStart = iso(new Date(Date.UTC(y, m0 - 1, 1)));
  const weekStart = addDays(today, -weekday(today));
  const prevWeekStart = addDays(weekStart, -7);
  const from = prevMonthStart < prevWeekStart ? prevMonthStart : prevWeekStart;

  const byDay = new Map<string, { revenue: number; sales: number }>();
  for (const s of sold) {
    if (!s.sold_at) continue;
    const day = parisDay(s.sold_at);
    if (day < from || day > today) continue;
    const v = byDay.get(day) ?? { revenue: 0, sales: 0 };
    v.revenue += Number(s.revenue_cents) || 0;
    v.sales += 1;
    byDay.set(day, v);
  }
  const perDay = revenuePerDay(goals, today);
  const prevM = new Date(Date.UTC(y, m0 - 1, 1));
  return {
    month: {
      kind: "month",
      label: MONTHS[m0],
      prevLabel: MONTHS[prevM.getUTCMonth()],
      days: series(monthStart, daysInMonth(y, m0), byDay, today),
      prev: series(prevMonthStart, daysInMonth(prevM.getUTCFullYear(), prevM.getUTCMonth()), byDay, today),
      todayIndex: t.getUTCDate() - 1,
      goalPerDay: perDay,
    },
    week: {
      kind: "week",
      label: `Semaine du ${shortDate.format(at(weekStart))}`,
      prevLabel: "Semaine précédente",
      days: series(weekStart, 7, byDay, today),
      prev: series(prevWeekStart, 7, byDay, today),
      todayIndex: weekday(today),
      goalPerDay: perDay,
    },
  };
}

/** Running total of a measure; days after today stay null so the current line stops at today */
export function cumulative(points: DayPoint[], key: "revenue" | "sales", stopAt?: number): (number | null)[] {
  let sum = 0;
  return points.map((p, i) => {
    if (stopAt != null && i > stopAt) return null;
    sum += p[key];
    return sum;
  });
}

/** Totals so far, and the previous period over the same number of days (a fair comparison) */
export function toDate(p: TrendPeriod) {
  const n = p.todayIndex + 1;
  const sum = (pts: DayPoint[], k: "revenue" | "sales") => pts.slice(0, n).reduce((a, d) => a + d[k], 0);
  const cur = { revenue: sum(p.days, "revenue"), sales: sum(p.days, "sales") };
  const prev = { revenue: sum(p.prev, "revenue"), sales: sum(p.prev, "sales") };
  const elapsed = n / p.days.length;
  return {
    cur, prev,
    // too early in the period, a projection says nothing
    projection: elapsed >= 0.2 && elapsed < 1 ? Math.round(cur.revenue / elapsed) : null,
    goal: p.goalPerDay != null ? Math.round(p.goalPerDay * p.days.length) : null,
  };
}
