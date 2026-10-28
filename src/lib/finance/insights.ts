// Business Intelligence of the Financial Command Center: sentences built only from the figures, each with the numbers it
// rests on. Below the minimum sample, a recommendation is replaced by « Pas assez de données ».

import type { Budget, Capital, Forecast, Performance, Turnover } from "./calc";
import { euro, frDate, pct } from "./calc";
import type { Overview, Segment } from "./types";

export type Tone = "alert" | "warn" | "good" | "info";
export interface Insight { id: string; tone: Tone; icon: string; text: string; href?: string; basis: string }

export const MIN_SEGMENT_SALES = 5; // sales of a segment before comparing it
const ratio = (v: number) => `${v.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}×`;

/** Margin per euro invested, over the period: margin of the sales / cost of the items sold */
const perEuro = (s: Segment) => (s.sold_cost_cents > 0 ? s.margin_cents / s.sold_cost_cents : null);

export function insights(input: {
  o: Overview; cap: Capital; perf: Performance; turn: Turnover; fc: Forecast; budget: Budget; today: string;
  brands: Segment[]; categories: Segment[]; sizes: Segment[];
}): { list: Insight[]; missing: string[] } {
  const { o, cap, perf, turn, fc, budget, brands, categories, sizes } = input;
  const list: Insight[] = [];
  const missing: string[] = [];

  if (!cap.cashKnown) {
    list.push({ id: "cash", tone: "warn", icon: "🏦", text: "Votre trésorerie n'est pas déclarée : le capital total, le budget d'achat et les prévisions de trésorerie restent incomplets.",
      href: "/finance/parametres#tresorerie", basis: "Aucun solde enregistré" });
  } else if (fc.belowReserve.base) {
    const days = Math.round((new Date(`${fc.belowReserve.base}T12:00:00Z`).getTime() - new Date(`${input.today}T12:00:00Z`).getTime()) / 86_400_000);
    list.push({ id: "reserve", tone: "alert", icon: "🚨", text: `La trésorerie risque de passer sous la réserve de sécurité (${euro(o.settings.cash_reserve_cents)}) dans ${days} jours, le ${frDate(fc.belowReserve.base)}.`,
      href: "#prevision", basis: "Prévision de trésorerie, hypothèse centrale" });
  } else if (fc.belowReserve.low) {
    list.push({ id: "reserve-low", tone: "warn", icon: "⚠️", text: `Si les ventes ralentissent de 25 %, la trésorerie passerait sous la réserve le ${frDate(fc.belowReserve.low)}.`,
      href: "#prevision", basis: "Prévision de trésorerie, hypothèse basse" });
  }

  if (cap.total > 0 && cap.dormant > 0) {
    const share = (cap.dormant * 100) / cap.total;
    list.push({ id: "dormant", tone: share >= 15 ? "alert" : "warn", icon: "⚠️",
      text: `${pct(share, 0)} du capital (${euro(cap.dormant)}) est immobilisé dans ${o.stock.dormant_count} article${o.stock.dormant_count > 1 ? "s" : ""} de plus de ${o.settings.dead_stock_days} jours.`,
      href: "/finance/articles?vue=dormant", basis: `Stock dormant au coût / capital total ${euro(cap.total)}` });
  }

  if (o.stock.unpriced_count > 0) {
    list.push({ id: "unpriced", tone: "info", icon: "🏷️", text: `${o.stock.unpriced_count} article${o.stock.unpriced_count > 1 ? "s" : ""} sans prix (${euro(o.stock.unpriced_cost_cents)} au coût) : ils ne peuvent pas encore se vendre.`,
      href: "/finance/articles?vue=unpriced", basis: "Articles en stock sans prix affiché" });
  }

  // segments: margin per euro invested, against the average of the segments with enough sales
  const compare = (rows: Segment[], label: (n: string) => string, id: string) => {
    const ok = rows.filter((s) => s.sold >= MIN_SEGMENT_SALES && perEuro(s) != null && !/^(Sans|Non renseign)/.test(s.name));
    if (ok.length < 2) { missing.push(`${label("…")} : pas assez de données (il faut ${MIN_SEGMENT_SALES} ventes par segment, sur au moins 2 segments).`); return; }
    const all = ok.reduce((a, s) => ({ m: a.m + s.margin_cents, c: a.c + s.sold_cost_cents }), { m: 0, c: 0 });
    const avg = all.c > 0 ? all.m / all.c : null;
    const best = [...ok].sort((a, b) => (perEuro(b) ?? 0) - (perEuro(a) ?? 0))[0];
    if (avg && avg > 0 && (perEuro(best) ?? 0) >= avg * 1.3) {
      list.push({ id: `${id}-best`, tone: "good", icon: "📈",
        text: `${label(best.name)} génère ${ratio((perEuro(best) ?? 0) / avg)} plus de marge par euro investi que la moyenne (${euro(best.margin_cents)} de marge pour ${euro(best.sold_cost_cents)} investis, ${best.sold} ventes).`,
        href: "#segments", basis: `Marge / coût des articles vendus, segments d'au moins ${MIN_SEGMENT_SALES} ventes` });
    }
  };
  compare(brands, (n) => `La marque ${n}`, "brand");
  compare(categories, (n) => `La catégorie ${n}`, "category");

  // sizes: the slowest against the fastest, on real time-to-sell
  const timed = sizes.filter((s) => s.timed >= MIN_SEGMENT_SALES && s.avg_days != null && s.name !== "Sans taille");
  if (timed.length >= 2) {
    const sorted = [...timed].sort((a, b) => (a.avg_days ?? 0) - (b.avg_days ?? 0));
    const fast = sorted[0], slow = sorted[sorted.length - 1];
    const slower = ((slow.avg_days! - fast.avg_days!) * 100) / fast.avg_days!;
    if (slower >= 20) list.push({ id: "sizes", tone: "info", icon: "📉",
      text: `La taille ${slow.name} se vend ${pct(slower, 0)} plus lentement que la taille ${fast.name} (${Math.round(slow.avg_days!)} j contre ${Math.round(fast.avg_days!)} j).`,
      href: "#segments", basis: `Délai réception → vente, au moins ${MIN_SEGMENT_SALES} ventes par taille` });
  } else missing.push(`Tailles : pas assez de données pour comparer les délais de vente (il faut ${MIN_SEGMENT_SALES} ventes mesurées par taille).`);

  if (budget.known) {
    list.push({ id: "budget", tone: budget.recommended > 0 ? "good" : "warn", icon: "💰",
      text: budget.recommended > 0 ? `Budget d'achat recommandé : ${euro(budget.recommended)} (${budget.reason}).` : `Pas de budget d'achat recommandé pour l'instant : ${budget.reason}.`,
      href: "#budget", basis: "Trésorerie, dépenses prévues, réserve et stock nécessaire" });
  }

  if (turn.daysOfStock != null) {
    const target = 30 + o.settings.forecast.stock_target_days;
    if (turn.daysOfStock > target * 1.5) list.push({ id: "slow", tone: "warn", icon: "🐢",
      text: `Au rythme actuel, votre stock représente ${Math.round(turn.daysOfStock)} jours de ventes (objectif ${target} j) : achetez moins ou baissez les prix des articles anciens.`,
      href: "#rotation", basis: "Stock moyen au coût / coût des articles vendus par jour" });
  } else missing.push("Rotation du stock : aucune vente sur la période d'analyse.");

  if (fc.stockOutDay && fc.enoughHistory) {
    list.push({ id: "stockout", tone: "info", icon: "📦", text: `Sans nouvel achat, le stock actuel serait épuisé vers le ${frDate(fc.stockOutDay)} au rythme des ventes.`,
      href: "#prevision", basis: `${fc.itemsPerDay.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} articles vendus par jour, ${o.stock.count} en stock` });
  }

  const oldUnpaid = o.unpaid_orders.filter((u) => Date.now() - new Date(u.sold_at).getTime() > 21 * 86_400_000);
  if (oldUnpaid.length) list.push({ id: "unpaid", tone: "warn", icon: "⏳",
    text: `${oldUnpaid.length} vente${oldUnpaid.length > 1 ? "s" : ""} de plus de 21 jours pas encore versée${oldUnpaid.length > 1 ? "s" : ""} (${euro(oldUnpaid.reduce((a, u) => a + u.amount_cents, 0))}) : vérifiez qu'elles sont bien terminées sur Vinted.`,
    href: "/finance/a-recevoir", basis: "Commandes sans date d'encaissement" });

  if (perf.revenue === 0) missing.push(`Marge et bénéfice : aucune vente sur les ${perf.days} derniers jours.`);
  const order: Record<Tone, number> = { alert: 0, warn: 1, good: 2, info: 3 };
  list.sort((a, b) => order[a.tone] - order[b.tone]);
  return { list, missing };
}
