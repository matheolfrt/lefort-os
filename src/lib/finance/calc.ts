// Financial Command Center: every figure of the page, computed in one place from finance_overview().
// Pure functions (no database, no clock: "today" is passed in), so that they can be tested and every figure comes
// with the lines that explain it ("Comment est calculé ce chiffre ?").
//
// Conventions
//  - Amounts in cents. Dates as YYYY-MM-DD in the Paris calendar.
//  - Cash = last declared balance + what was recorded since (cash in − cash out). Without a declared balance the cash is
//    unknown and is never guessed: totals that need it say so.
//  - Charges: a recurring charge is counted on each of its dates. When a category has a recurring charge, the one-off
//    expenses of that category are taken as its payments and are not counted a second time.

import type { Cents, Line, Overview, Recurring } from "./types";

export const euro = (c: Cents | null | undefined) =>
  c == null ? "—" : `${(Math.round(c / 100)).toLocaleString("fr-FR")} €`;
export const pct = (v: number | null | undefined, digits = 1) =>
  v == null || !Number.isFinite(v) ? "—" : `${v.toLocaleString("fr-FR", { maximumFractionDigits: digits })} %`;

const DAY = 86_400_000;
const at = (d: string) => new Date(`${d}T12:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => iso(new Date(at(d).getTime() + n * DAY));
export const daysBetween = (a: string, b: string) => Math.round((at(b).getTime() - at(a).getTime()) / DAY);
const parisDay = (ts: string) =>
  new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
const lastDayOfMonth = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

// ───────────────────────── Recurring charges ─────────────────────────

/** Dates of a recurring charge strictly after `from` and up to `to` (inclusive) */
export function occurrences(r: Recurring, from: string, to: string): string[] {
  const out: string[] = [];
  const start = r.starts_on, end = r.ends_on && r.ends_on < to ? r.ends_on : to;
  if (end <= from || start > end) return out;
  if (r.frequency === "weekly") {
    let d = start;
    while (d <= from) d = addDays(d, 7);
    for (; d <= end; d = addDays(d, 7)) if (d >= start) out.push(d);
    return out;
  }
  const step = r.frequency === "monthly" ? 1 : r.frequency === "quarterly" ? 3 : 12;
  const s = at(start);
  for (let k = 0; k < 2400; k += step) {
    const y = s.getUTCFullYear() + Math.floor((s.getUTCMonth() + k) / 12), m0 = (s.getUTCMonth() + k) % 12;
    const d = iso(new Date(Date.UTC(y, m0, Math.min(r.day_of_month, lastDayOfMonth(y, m0)), 12)));
    if (d > end) break;
    if (d > from && d >= start) out.push(d);
  }
  return out;
}

/** Charges between two dates (from excluded, to included), by category, applying the no-double-count rule */
export function charges(recurring: Recurring[], oneOff: Record<string, Cents>, from: string, to: string) {
  const covered = new Set(recurring.map((r) => r.category));
  const byCategory: Record<string, Cents> = {};
  for (const r of recurring) {
    const n = occurrences(r, from, to).length;
    if (n) byCategory[r.category] = (byCategory[r.category] ?? 0) + n * r.amount_cents;
  }
  for (const [cat, amount] of Object.entries(oneOff)) if (!covered.has(cat)) byCategory[cat] = (byCategory[cat] ?? 0) + Number(amount);
  return { byCategory, total: Object.values(byCategory).reduce((a, b) => a + b, 0) };
}

export const CATEGORY_LABEL: Record<string, string> = {
  rent: "Loyer", salary: "Salaires", packaging: "Emballages", software: "Logiciels", equipment: "Matériel",
  transport: "Transport", taxes: "Cotisations et impôts", other: "Autres charges",
};

// ───────────────────────── Cash ─────────────────────────

export interface Cash { known: boolean; cents: Cents | null; asOf: string | null; staleDays: number | null; lines: Line[] }

export function cashPosition(o: Overview, today: string): Cash {
  if (!o.balance || !o.ledger) {
    return { known: false, cents: null, asOf: null, staleDays: null, lines: [{ label: "Aucun solde de trésorerie déclaré", value: "—" }] };
  }
  const l = o.ledger, anchorDay = parisDay(o.balance.as_of);
  const ch = charges(o.recurring, l.expenses_by_category, anchorDay, today);
  const cents = o.balance.amount_cents + l.receipts_cents - l.refunds_cents - l.shipping_cents - l.purchases_cents - ch.total;
  const lines: Line[] = [
    { label: `Solde déclaré le ${frDate(anchorDay)}`, value: euro(o.balance.amount_cents) },
    { label: "Ventes encaissées depuis (frais Vinted déduits)", value: euro(l.receipts_cents), op: "+" },
    { label: "Remboursements à des acheteurs", value: euro(l.refunds_cents), op: "−" },
    { label: "Port et emballage à votre charge", value: euro(l.shipping_cents), op: "−" },
    { label: "Lots achetés depuis", value: euro(l.purchases_cents), op: "−" },
    ...Object.entries(ch.byCategory).map(([k, v]) => ({ label: CATEGORY_LABEL[k] ?? k, value: euro(v), op: "−" as const })),
    { label: "Trésorerie estimée aujourd'hui", value: euro(cents), op: "=" },
  ];
  return { known: true, cents, asOf: anchorDay, staleDays: daysBetween(anchorDay, today), lines };
}

// ───────────────────────── Capital ─────────────────────────

export interface Capital {
  total: Cents; cashKnown: boolean; cash: Cents; stockActive: Cents; dormant: Cents; receivable: Cents; stock: Cents;
  parts: { key: "cash" | "stock" | "dormant" | "receivable"; label: string; cents: Cents; share: number; href: string }[];
  lines: Line[];
}

export function capital(o: Overview, cash: Cash): Capital {
  const stock = o.stock.cost_cents, dormant = o.stock.dormant_cost_cents, receivable = o.receivable.amount_cents;
  const cashCents = cash.known ? Math.max(0, cash.cents ?? 0) : 0;
  const total = cashCents + stock + receivable;
  const share = (v: Cents) => (total > 0 ? (v * 100) / total : 0);
  const parts: Capital["parts"] = [
    { key: "cash", label: "Cash", cents: cashCents, share: share(cashCents), href: "/finance/parametres#tresorerie" },
    { key: "stock", label: "Stock", cents: stock - dormant, share: share(stock - dormant), href: "/finance/articles?vue=active" },
    { key: "dormant", label: "Stock dormant", cents: dormant, share: share(dormant), href: "/finance/articles?vue=dormant" },
    { key: "receivable", label: "À recevoir", cents: receivable, share: share(receivable), href: "/finance/a-recevoir" },
  ];
  const lines: Line[] = [
    { label: cash.known ? "Trésorerie" : "Trésorerie (non déclarée : comptée 0)", value: euro(cashCents), muted: !cash.known },
    { label: `Stock au coût (${o.stock.count} articles)`, value: euro(stock), op: "+" },
    { label: `Ventes pas encore versées (${o.receivable.count})`, value: euro(receivable), op: "+" },
    { label: "Capital total", value: euro(total), op: "=" },
  ];
  if (cash.known && (cash.cents ?? 0) < 0) lines.splice(1, 0, { label: "La trésorerie estimée est négative : comptée 0 dans le capital", value: euro(cash.cents), muted: true });
  if (o.rejected.count) lines.push({ label: `Non compté : ${o.rejected.count} article(s) écarté(s), coût perdu`, value: euro(o.rejected.cost_cents), muted: true });
  return { total, cashKnown: cash.known, cash: cashCents, stockActive: stock - dormant, dormant, receivable, stock, parts, lines };
}

/** Evolution against the capital recorded about `days` ago (closest earlier snapshot), or null without history */
export function evolution(o: Overview, current: Cents, today: string, days = 30) {
  const target = addDays(today, -days);
  const past = [...o.snapshots].filter((s) => s.day <= addDays(today, -7)).sort((a, b) => b.day.localeCompare(a.day));
  const ref = past.find((s) => s.day <= target) ?? past[past.length - 1];
  if (!ref) return null;
  const was = (ref.cash_cents ?? 0) + ref.stock_cost_cents + ref.receivable_cents;
  return { since: ref.day, was, delta: current - was, pct: was > 0 ? ((current - was) * 100) / was : null, cashMissing: ref.cash_cents == null };
}

// ───────────────────────── Stock ─────────────────────────

/** The liquidation model: what the stock would bring if sold quickly. One place to change it. */
export function liquidationValue(priceCents: Cents, unpricedCostCents: Cents, factorPct: number) {
  // priced items: their asking price, discounted by the factor; items without a price: their cost (no better estimate)
  return Math.round((priceCents * factorPct) / 100) + unpricedCostCents;
}

export type Level = "faible" | "normal" | "élevé" | "critique";
export function immobilization(stock: Cents, total: Cents, levels: Overview["settings"]["immob_levels"]) {
  const share = total > 0 ? (stock * 100) / total : null;
  const level: Level | null = share == null ? null : share >= levels.critical ? "critique" : share >= levels.high ? "élevé" : share >= levels.normal ? "normal" : "faible";
  return { share, level };
}

// ───────────────────────── Performance ─────────────────────────

export interface Performance {
  days: number; revenue: Cents; cogs: Cents; variable: Cents; gross: Cents; contributions: Cents; charges: Cents; net: Cents;
  grossPct: number | null; netPct: number | null; prevRevenue: Cents; prevGross: Cents; items: number;
  chargeLines: Line[]; lines: Line[];
}

export function performance(o: Overview, today: string): Performance {
  const p = o.periods, c = p.current, days = p.days;
  const contributions = Math.round((p.cashed_cents * o.settings.contribution_rate_pct) / 100);
  const ch = charges(o.recurring, p.expenses_by_category, addDays(today, -days), today);
  const variable = c.variable_cents ?? 0;
  const net = c.gross_profit_cents - contributions - ch.total;
  const chargeLines: Line[] = Object.entries(ch.byCategory).map(([k, v]) => ({ label: CATEGORY_LABEL[k] ?? k, value: euro(v), op: "−" }));
  return {
    days, revenue: c.revenue_cents, cogs: c.cogs_cents, variable, gross: c.gross_profit_cents, contributions, charges: ch.total, net,
    grossPct: c.revenue_cents ? (c.gross_profit_cents * 100) / c.revenue_cents : null,
    netPct: c.revenue_cents ? (net * 100) / c.revenue_cents : null,
    prevRevenue: p.previous.revenue_cents, prevGross: p.previous.gross_profit_cents, items: c.items,
    chargeLines,
    lines: [
      { label: `Chiffre d'affaires des ${c.items} ventes (${days} j, remboursements déduits)`, value: euro(c.revenue_cents) },
      { label: "Coût d'achat des articles vendus", value: euro(c.cogs_cents), op: "−" },
      { label: "Frais Vinted, port et emballage", value: euro(variable), op: "−" },
      { label: "Marge brute", value: euro(c.gross_profit_cents), op: "=" },
      { label: `Cotisations estimées (${pct(o.settings.contribution_rate_pct)} de ${euro(p.cashed_cents)} encaissés)`, value: euro(contributions), op: "−" },
      ...chargeLines,
      { label: "Bénéfice", value: euro(net), op: "=" },
    ],
  };
}

// ───────────────────────── Rotation and return on capital ─────────────────────────

export interface Turnover {
  avgStock: Cents; avgFromSnapshots: boolean; cogs: Cents; days: number; monthly: number | null; yearly: number | null;
  yearlyMeasured: boolean; daysOfStock: number | null; velocity: number | null; roc: number | null; avgCapital: Cents;
  lines: Line[]; velocityLines: Line[]; rocLines: Line[];
}

export function turnover(o: Overview, perf: Performance, cap: Capital, today: string): Turnover {
  const days = o.periods.days;
  const recent = o.snapshots.filter((s) => s.day > addDays(today, -days));
  const avgFromSnapshots = recent.length >= 2;
  const avgStock = avgFromSnapshots ? recent.reduce((a, s) => a + s.stock_cost_cents, 0) / recent.length : o.stock.cost_cents;
  const avgCapital = avgFromSnapshots && cap.cashKnown && recent.every((s) => s.cash_cents != null)
    ? recent.reduce((a, s) => a + (s.cash_cents ?? 0) + s.stock_cost_cents + s.receivable_cents, 0) / recent.length : cap.total;
  const cogs = o.periods.current.cogs_cents;
  const perDay = cogs / days;
  const monthly = avgStock > 0 ? (perDay * 30) / avgStock : null;
  const yearHistory = !!o.periods.first_sale_at && daysBetween(parisDay(o.periods.first_sale_at), today) >= 365;
  const yearly = avgStock > 0 ? (yearHistory ? o.periods.year.cogs_cents / avgStock : (perDay * 365) / avgStock) : null;
  const daysOfStock = perDay > 0 ? avgStock / perDay : null;
  const grossYear = (perf.gross * 365) / days, netYear = (perf.net * 365) / days;
  const velocity = avgStock > 0 ? grossYear / avgStock : null;
  const roc = avgCapital > 0 ? (netYear * 100) / avgCapital : null;
  const stockLabel = avgFromSnapshots ? `Stock moyen au coût (${recent.length} relevés sur ${days} j)` : "Stock actuel au coût (pas encore d'historique)";
  return {
    avgStock, avgFromSnapshots, cogs, days, monthly, yearly, yearlyMeasured: yearHistory, daysOfStock, velocity, roc, avgCapital,
    lines: [
      { label: `Coût des articles vendus sur ${days} j`, value: euro(cogs) },
      { label: "Ramené à 30 jours", value: euro(perDay * 30), op: "=" },
      { label: stockLabel, value: euro(avgStock), op: "÷" },
      { label: "Rotation mensuelle", value: monthly == null ? "—" : `${monthly.toFixed(2).replace(".", ",")}×`, op: "=" },
      { label: daysOfStock == null ? "Durée d'immobilisation : pas de vente sur la période" : `Durée moyenne d'immobilisation : stock ÷ coût vendu par jour`, value: daysOfStock == null ? "—" : `${Math.round(daysOfStock)} j` },
    ],
    velocityLines: [
      { label: `Marge brute sur ${days} j`, value: euro(perf.gross) },
      { label: `Sur un an (× 365 / ${days})`, value: euro(grossYear), op: "=" },
      { label: stockLabel, value: euro(avgStock), op: "÷" },
      { label: "Marge produite par an par euro de stock", value: velocity == null ? "—" : `${velocity.toFixed(2).replace(".", ",")} €`, op: "=" },
    ],
    rocLines: [
      { label: `Bénéfice sur ${days} j`, value: euro(perf.net) },
      { label: `Sur un an (× 365 / ${days})`, value: euro(netYear), op: "=" },
      { label: avgCapital === cap.total ? "Capital total actuel" : "Capital moyen sur la période", value: euro(avgCapital), op: "÷" },
      { label: "Retour annuel sur le capital", value: pct(roc), op: "=" },
    ],
  };
}

// ───────────────────────── Forecast ─────────────────────────

export interface ForecastPoint { day: string; base: Cents; low: Cents; high: Cents; inflow: Cents; outflow: Cents }
export interface Forecast {
  start: Cents; startKnown: boolean; points: ForecastPoint[]; marks: { days: number; base: Cents; low: Cents; high: Cents }[];
  belowReserve: { base: string | null; low: string | null }; stockOutDay: string | null;
  assumptions: string[]; enoughHistory: boolean; dailyNet: Cents; itemsPerDay: number;
  outflows: { label: string; cents: Cents }[];
}

/** Contributions still to pay for months already cashed, and for the months of the forecast */
function contributionDue(month: string, frequency: "monthly" | "quarterly") {
  const [y, m] = month.split("-").map(Number);
  const m0 = m - 1;
  const endM0 = frequency === "monthly" ? m0 + 1 : Math.floor(m0 / 3) * 3 + 3; // month after the month / the quarter
  const yy = y + Math.floor(endM0 / 12), mm = endM0 % 12;
  return iso(new Date(Date.UTC(yy, mm, lastDayOfMonth(yy, mm), 12)));
}

export function forecast(o: Overview, cash: Cash, today: string): Forecast {
  const f = o.settings.forecast;
  const W = Math.max(1, o.daily.length), H = Math.min(365, Math.max(7, f.horizon_days));
  const sum = (k: "net_cents" | "gross_cents" | "items" | "cogs_cents") => o.daily.reduce((a, d) => a + Number(d[k] ?? 0), 0);
  const dailyNet = sum("net_cents") / W, dailyGross = sum("gross_cents") / W, itemsPerDay = sum("items") / W;
  const enoughHistory = sum("items") >= 10;
  const assumptions: string[] = [];
  assumptions.push(`Ventes : rythme moyen des ${W} derniers jours (${itemsPerDay.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} articles et ${euro(dailyNet)} nets par jour, après frais et port).`);
  if (!enoughHistory) assumptions.push("Moins de 10 ventes sur la période : la projection des ventes est très incertaine.");
  if (f.growth_pct) assumptions.push(`Croissance des ventes : ${pct(f.growth_pct)} par mois.`);

  // seasonality: only with more than a year of monthly history
  const months = o.monthly.filter((m) => m.orders > 0);
  const seasonal = months.length >= 13 && months.reduce((a, m) => a + m.orders, 0) >= 100;
  const index = new Map<string, number>();
  if (seasonal) {
    const last12 = o.monthly.slice(-13, -1);
    const avg = last12.reduce((a, m) => a + Number(m.net_cents), 0) / Math.max(1, last12.length);
    for (const m of last12) index.set(m.month.slice(5), avg > 0 ? Math.min(2, Math.max(0.5, Number(m.net_cents) / avg)) : 1);
    assumptions.push("Saisonnalité : chaque mois suit le niveau du même mois l'an dernier.");
  } else assumptions.push("Saisonnalité non appliquée : il faut plus d'un an d'historique de ventes.");
  const nowIndex = index.get(today.slice(5, 7)) ?? 1;

  assumptions.push(`Paiement Vinted ${f.payout_days} j après la vente ; ventes déjà faites encaissées à cette date.`);
  assumptions.push(`Aucun nouvel achat de stock en dehors des achats prévus : le stock actuel (${o.stock.count} articles) limite les ventes.`);
  if (f.variable_cost_pct) assumptions.push(`Coûts variables supplémentaires : ${pct(f.variable_cost_pct)} des encaissements.`);
  const taxesPlanned = o.recurring.some((r) => r.category === "taxes");
  assumptions.push(taxesPlanned ? "Cotisations : vos charges récurrentes « Cotisations et impôts »."
    : `Cotisations : ${pct(o.settings.contribution_rate_pct)} du chiffre encaissé, payées à l'échéance de la déclaration ${o.settings.declaration_frequency === "monthly" ? "mensuelle" : "trimestrielle"}.`);

  const inflowAt = new Map<string, number>(), outflowAt = new Map<string, number>();
  const add = (m: Map<string, number>, d: string, v: number) => m.set(d, (m.get(d) ?? 0) + v);
  const outflows = new Map<string, number>();
  const end = addDays(today, H);

  // money already owed by Vinted
  for (const u of o.unpaid_orders) {
    let d = addDays(parisDay(u.sold_at), f.payout_days);
    if (d <= today) d = addDays(today, 1);
    if (d <= end) add(inflowAt, d, u.amount_cents);
  }
  // future sales, limited by the stock that is there
  let stockLeft = o.stock.count, stockOutDay: string | null = null;
  const saleShare = new Map<string, number>(); // share of a full day of sales still possible
  for (let t = 1; t <= H; t++) {
    const day = addDays(today, t);
    const season = (index.get(day.slice(5, 7)) ?? 1) / nowIndex;
    const growth = (1 + f.growth_pct / 100) ** (t / 30);
    const want = itemsPerDay * season * growth;
    const share = want > 0 ? Math.min(1, stockLeft / want) : 0;
    stockLeft = Math.max(0, stockLeft - want * share);
    if (want > 0 && share < 1 && !stockOutDay) stockOutDay = day;
    saleShare.set(day, share * season * growth);
  }
  // cash from those sales arrives payout_days later; gross kept for the contributions
  const grossByMonth = new Map<string, number>();
  for (const [day, k] of saleShare) {
    const pay = addDays(day, f.payout_days);
    if (pay <= end) add(inflowAt, pay, dailyNet * k);
    grossByMonth.set(pay.slice(0, 7), (grossByMonth.get(pay.slice(0, 7)) ?? 0) + dailyGross * k);
  }
  // recurring charges and planned purchases
  for (const r of o.recurring) for (const d of occurrences(r, today, end)) {
    add(outflowAt, d, r.amount_cents);
    outflows.set(CATEGORY_LABEL[r.category] ?? r.category, (outflows.get(CATEGORY_LABEL[r.category] ?? r.category) ?? 0) + r.amount_cents);
  }
  for (const p of o.planned) {
    const d = p.due_on <= today ? addDays(today, 1) : p.due_on;
    if (d <= end) { add(outflowAt, d, p.amount_cents); outflows.set("Achats prévus", (outflows.get("Achats prévus") ?? 0) + p.amount_cents); }
  }
  // contributions: months already cashed whose deadline is still ahead, then the forecast months
  if (!taxesPlanned) {
    const rate = o.settings.contribution_rate_pct / 100;
    const base = new Map<string, number>();
    for (const m of o.cashed_months) base.set(m.month, Number(m.cents));
    for (const [m, g] of grossByMonth) base.set(m, (base.get(m) ?? 0) + g);
    for (const [m, g] of base) {
      const due = contributionDue(m, o.settings.declaration_frequency);
      if (due > today && due <= end && g > 0) {
        add(outflowAt, due, g * rate);
        outflows.set("Cotisations URSSAF", (outflows.get("Cotisations URSSAF") ?? 0) + g * rate);
      }
    }
  }

  const start = cash.known ? cash.cents ?? 0 : 0;
  if (!cash.known) assumptions.unshift("Trésorerie de départ inconnue : la courbe montre la variation à partir de 0 €. Déclarez votre solde pour une vraie projection.");
  const points: ForecastPoint[] = [{ day: today, base: start, low: start, high: start, inflow: 0, outflow: 0 }];
  let base = start, low = start, high = start;
  const reserve = o.settings.cash_reserve_cents;
  const belowReserve = { base: null as string | null, low: null as string | null };
  const fixedIn = new Map<string, number>();
  for (const u of o.unpaid_orders) {
    let d = addDays(parisDay(u.sold_at), f.payout_days);
    if (d <= today) d = addDays(today, 1);
    add(fixedIn, d, u.amount_cents);
  }
  for (let t = 1; t <= H; t++) {
    const day = addDays(today, t);
    const certain = fixedIn.get(day) ?? 0;
    const salesIn = (inflowAt.get(day) ?? 0) - certain;
    const out = (outflowAt.get(day) ?? 0) + (salesIn + certain) * (f.variable_cost_pct / 100);
    base += certain + salesIn - out;
    low += certain + salesIn * 0.75 - out;
    high += certain + salesIn * 1.25 - out;
    if (cash.known && !belowReserve.base && base < reserve) belowReserve.base = day;
    if (cash.known && !belowReserve.low && low < reserve) belowReserve.low = day;
    points.push({ day, base: Math.round(base), low: Math.round(low), high: Math.round(high), inflow: Math.round(certain + salesIn), outflow: Math.round(out) });
  }
  assumptions.push("Fourchette : ventes 25 % plus faibles (bas) ou plus fortes (haut) que ce rythme.");
  const marks = [7, 30, 60, 90, 180, 365].filter((d) => d <= H).map((d) => ({ days: d, base: points[d].base, low: points[d].low, high: points[d].high }));
  return {
    start, startKnown: cash.known, points, marks, belowReserve, stockOutDay, assumptions, enoughHistory, dailyNet, itemsPerDay,
    outflows: [...outflows].map(([label, cents]) => ({ label, cents: Math.round(cents) })).sort((a, b) => b.cents - a.cents),
  };
}

// ───────────────────────── Purchase budget ─────────────────────────

export interface Budget {
  known: boolean; max: Cents; recommended: Cents; committed: Cents; safeFromForecast: Cents | null; need: Cents | null;
  coverDays: number | null; available: Cents; due30: Cents; lines: Line[]; reason: string;
}

export function purchaseBudget(o: Overview, cash: Cash, fc: Forecast, today: string): Budget {
  const reserve = o.settings.cash_reserve_cents, f = o.settings.forecast;
  const committed = o.planned.reduce((a, p) => a + p.amount_cents, 0);
  const in30 = addDays(today, 30);
  const due30 = fc.points.filter((p) => p.day > today && p.day <= in30).reduce((a, p) => a + p.outflow, 0)
    - o.planned.filter((p) => (p.due_on <= today ? addDays(today, 1) : p.due_on) <= in30).reduce((a, p) => a + p.amount_cents, 0);
  const receivable = o.receivable.amount_cents;
  const cashC = cash.known ? cash.cents ?? 0 : 0;
  const available = cashC + receivable - Math.max(0, due30) - committed - reserve;
  const max = Math.max(0, available);
  // the lowest cash level ahead, without any new purchase, above the reserve
  const lowest = fc.points.slice(1).reduce((m, p) => Math.min(m, p.base), Number.POSITIVE_INFINITY);
  const safeFromForecast = cash.known && Number.isFinite(lowest) ? Math.max(0, Math.min(lowest, fc.points[0].base) - reserve) : null;
  // stock needed: what will sell over 30 days plus the cover you want, minus the stock you have (at cost)
  const cogsPerDay = o.daily.reduce((a, d) => a + Number(d.cogs_cents), 0) / Math.max(1, o.daily.length);
  const need = cogsPerDay > 0 ? Math.max(0, Math.round(cogsPerDay * (30 + f.stock_target_days) - o.stock.cost_cents)) : null;
  const coverDays = cogsPerDay > 0 ? o.stock.cost_cents / cogsPerDay : null;

  let recommended = max, reason = "";
  if (!cash.known) { recommended = 0; reason = "Déclarez votre trésorerie pour obtenir un budget d'achat."; }
  else {
    if (safeFromForecast != null && safeFromForecast < recommended) { recommended = safeFromForecast; reason = "limité pour que la trésorerie prévue ne passe pas sous la réserve"; }
    if (need != null && need < recommended) { recommended = need; reason = need === 0 ? `votre stock couvre déjà ${Math.round(coverDays ?? 0)} jours de ventes (objectif ${30 + f.stock_target_days} j)` : "limité au stock nécessaire pour vos ventes"; }
    if (!reason) reason = "toute la trésorerie disponible au-dessus de la réserve";
  }
  const lines: Line[] = [
    { label: cash.known ? "Trésorerie actuelle" : "Trésorerie (non déclarée)", value: euro(cashC) },
    { label: "Ventes pas encore versées par Vinted", value: euro(receivable), op: "+" },
    { label: "Dépenses prévues sur 30 jours (charges, cotisations)", value: euro(Math.max(0, due30)), op: "−" },
    { label: "Achats déjà engagés", value: euro(committed), op: "−" },
    { label: "Réserve de sécurité", value: euro(reserve), op: "−" },
    { label: "Budget maximum", value: euro(max), op: "=" },
    { label: "Plus bas niveau de trésorerie prévu, au-dessus de la réserve", value: safeFromForecast == null ? "—" : euro(safeFromForecast), muted: true },
    { label: `Stock nécessaire : ${euro(cogsPerDay)} vendus par jour × (30 + ${f.stock_target_days} j) − stock actuel ${euro(o.stock.cost_cents)}`, value: need == null ? "pas de ventes récentes" : euro(need), muted: true },
    { label: "Budget recommandé (le plus petit des trois)", value: euro(recommended), op: "=" },
  ];
  return { known: cash.known, max, recommended, committed, safeFromForecast, need, coverDays, available, due30: Math.max(0, due30), lines, reason };
}

export const frDate = (d: string) => at(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" });
export const frShort = (d: string) => at(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
