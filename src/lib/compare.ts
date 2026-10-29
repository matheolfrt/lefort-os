// « Est-ce bien ou pas ? » — every figure of the month against the same days of last month and against the average of
// the three months before (same days too: the 1st to the 29th against the 1st to the 29th, never a whole month).
// The average time to sell is a rolling 90 days: it is compared with itself one, two, three months earlier.
// Pure functions on Paris days (YYYY-MM-DD), shared by the dashboard and its tests.

import { addDays } from "@/lib/trend";

export type MetricId = "cashed" | "profit" | "sales" | "basket" | "delay";

export interface SoldRow { day: string; revenue: number; costs: number; delay: number | null }
export interface OrderRow { day: string; gross: number }
export interface CashRow { day: string; cents: number }

export interface Ref { value: number; n: number; label: string; detail: string }
export interface Comparison {
  id: MetricId;
  cur: number | null; n: number;
  prev: Ref | null;      // same days of last month
  avg: Ref | null;       // average of the months before (2 or 3 of them, never 1)
  spark: (number | null)[]; // the last 30 days, oldest first
  better: "up" | "down"; // the direction that is good news
  sample: boolean;       // an average over a sample: below LOW_SAMPLE observations it is only indicative
}

const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const pad = (n: number) => String(n).padStart(2, "0");
const daysInMonth = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
const first = (d: number) => (d === 1 ? "1er" : String(d));

/** The same day `k` months earlier, the last day of that month when it is shorter (31 → 30, 28…) */
export function monthsBack(day: string, k: number) {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 - k, 1));
  const yy = t.getUTCFullYear(), mm = t.getUTCMonth();
  return `${yy}-${pad(mm + 1)}-${pad(Math.min(d, daysInMonth(yy, mm)))}`;
}

interface Window { from: string; to: string; label: string; detail: string; month: number }

/** The 1st of the month up to the same day, `k` months back (k = 0: this month so far) */
function monthWindow(today: string, k: number): Window {
  const to = monthsBack(today, k);
  const [y, m, d] = to.split("-").map(Number);
  return { from: `${y}-${pad(m)}-01`, to, month: m - 1,
    label: `${SHORT[m - 1]}`, detail: d === 1 ? `le 1er ${MONTHS[m - 1]}` : `du 1er au ${d} ${MONTHS[m - 1]}` };
}
/** The 90 days that ended on the same day, `k` months back */
function rollingWindow(today: string, k: number): Window {
  const to = monthsBack(today, k);
  const [, m, d] = to.split("-").map(Number);
  return { from: addDays(to, -89), to, month: m - 1,
    label: k === 1 ? "mois dernier" : `il y a ${k} mois`, detail: `les 90 jours au ${first(d)} ${MONTHS[m - 1]}` };
}

const inW = (day: string, w: { from: string; to: string }) => day >= w.from && day <= w.to;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export interface CompareInput {
  today: string;
  sold: SoldRow[];
  orders: OrderRow[];
  cash: CashRow[];
  ratePct: number;   // contributions on the revenue, to get the profit after them
  since?: string | null; // first day of activity: months before it are not « zero », they did not exist
}

export function compareAll(input: CompareInput): Record<MetricId, Comparison> {
  const { today, sold, orders, cash, ratePct } = input;
  const since = input.since ?? null;
  const profit = (rows: SoldRow[]) => {
    const revenue = rows.reduce((s, r) => s + r.revenue, 0);
    return revenue - rows.reduce((s, r) => s + r.costs, 0) - Math.round((revenue * ratePct) / 100);
  };
  type Val = { value: number | null; n: number };
  const measure: Record<MetricId, (w: { from: string; to: string }) => Val> = {
    cashed: (w) => { const r = cash.filter((c) => inW(c.day, w)); return { value: r.reduce((s, c) => s + c.cents, 0), n: r.length }; },
    profit: (w) => { const r = sold.filter((s) => inW(s.day, w)); return { value: profit(r), n: r.length }; },
    sales: (w) => { const n = sold.filter((s) => inW(s.day, w)).length; return { value: n, n }; },
    basket: (w) => { const g = orders.filter((o) => inW(o.day, w)).map((o) => o.gross); return { value: mean(g), n: g.length }; },
    delay: (w) => {
      const d = sold.filter((s) => inW(s.day, w) && s.delay != null && s.delay >= 0).map((s) => s.delay!);
      return { value: mean(d), n: d.length };
    },
  };

  // the last 30 days, day by day (basket and delay smoothed, a day alone says nothing)
  const last30 = Array.from({ length: 30 }, (_, i) => addDays(today, i - 29));
  const spark: Record<MetricId, (number | null)[]> = {
    cashed: last30.map((d) => measure.cashed({ from: d, to: d }).value),
    profit: last30.map((d) => measure.profit({ from: d, to: d }).value),
    sales: last30.map((d) => measure.sales({ from: d, to: d }).value),
    basket: last30.map((d) => measure.basket({ from: addDays(d, -6), to: d }).value),
    delay: last30.map((d) => measure.delay({ from: addDays(d, -29), to: d }).value),
  };

  const out = {} as Record<MetricId, Comparison>;
  for (const id of Object.keys(measure) as MetricId[]) {
    const rolling = id === "delay";
    const win = (k: number) => (rolling ? rollingWindow(today, k) : monthWindow(today, k));
    const averaged = id === "basket" || id === "delay";
    // a window that ended before the activity started is not a « zero » month
    const exists = (w: Window) => !since || w.to >= since;
    const cur = measure[id](win(0));

    const w1 = win(1);
    const v1 = exists(w1) ? measure[id](w1) : null;
    const prev: Ref | null = v1 && v1.value != null ? { value: v1.value, n: v1.n, label: w1.label, detail: w1.detail } : null;

    const olds = [1, 2, 3].map(win).filter(exists);
    let avg: Ref | null = null;
    if (olds.length >= 2) {
      const vals = olds.map((w) => measure[id](w));
      const n = vals.reduce((s, v) => s + v.n, 0);
      // averages are pooled (every sale weighs the same), totals are averaged month by month
      const value = averaged
        ? (n ? olds.reduce((s, w) => s + sumOf(id, w), 0) / n : null)
        : vals.reduce((s, v) => s + (v.value ?? 0), 0) / vals.length;
      const lo = olds.at(-1)!, hi = olds[0];
      if (value != null) {
        avg = { value, n, label: `moy. ${olds.length} mois`,
          detail: rolling ? `la moyenne des ${olds.length} mois précédents, sur 90 jours glissants`
            : `la moyenne de ${MONTHS[lo.month]} à ${MONTHS[hi.month]}, ${monthWindow(today, 0).detail.replace(/ \S+$/, "")} de chaque mois` };
      }
    }
    out[id] = { id, cur: cur.value, n: cur.n, prev, avg, spark: spark[id], better: id === "delay" ? "down" : "up", sample: averaged };
  }
  return out;

  function sumOf(id: MetricId, w: { from: string; to: string }) {
    if (id === "basket") return orders.filter((o) => inW(o.day, w)).reduce((s, o) => s + o.gross, 0);
    return sold.filter((s) => inW(s.day, w) && s.delay != null && s.delay >= 0).reduce((s, r) => s + r.delay!, 0);
  }
}

export type Verdict = "above" | "below" | "same";
export interface Gap {
  verdict: Verdict;
  good: boolean | null;  // null: neither good nor bad (same level, or too few data to say)
  pct: number | null;    // relative gap, null when the reference is zero
  diff: number;          // absolute gap, in the unit of the figure
}

/** Below this relative gap, two figures are « au même niveau » */
export const SAME_LEVEL = 0.03;

export function gap(cur: number | null, ref: Ref | null, better: "up" | "down", reliable = true): Gap | null {
  if (cur == null || !ref) return null;
  const diff = cur - ref.value;
  const pct = ref.value !== 0 ? diff / Math.abs(ref.value) : null;
  const same = pct != null ? Math.abs(pct) < SAME_LEVEL : diff === 0;
  const verdict: Verdict = same ? "same" : diff > 0 ? "above" : "below";
  const good = same || !reliable ? null : (verdict === "above") === (better === "up");
  return { verdict, good, pct, diff };
}
