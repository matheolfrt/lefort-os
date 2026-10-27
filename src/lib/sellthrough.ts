// Sell-through ("écoulement"): the share of a batch sold within N days of reception (default 80 % in 30 days).
// Figures come from public.sellthrough_stats(); the status of each batch and the advice are explicit rules written here.

import type { Advice } from "@/lib/advisor";

export interface BatchRow {
  id: string; code: string; supplier: string; purchased_at: string; items: number;
  sold_total: number; sold_in_time: number; not_online: number;
  first_received: string; last_received: string; age_days: number; matured: boolean;
  cost_cents: number; revenue_cents: number; profit_cents: number;
}
export interface Group { name: string; items: number; sold: number; pct: number }
export interface SellThroughStats {
  days: number; target_pct: number;
  overall: { items: number; sold: number; pct: number | null };
  batches: BatchRow[];
  suppliers: Group[]; brands: Group[]; categories: Group[];
  months: { month: string; items: number; sold: number; pct: number }[];
}

export type Pace = "reached" | "ahead" | "on_track" | "watch" | "late" | "done_ok" | "done_close" | "done_low" | "empty";
export interface BatchView extends BatchRow {
  pct: number;
  /** items that must be sold to reach the target */
  needed: number;
  /** still to sell, and days left in the window of the oldest items */
  remaining: number;
  daysLeft: number;
  /** sales per day needed from now on, and the pace so far */
  requiredPerDay: number | null;
  pacePerDay: number;
  pace: Pace;
}

export const PACE: Record<Pace, { label: string; cls: string }> = {
  reached: { label: "Objectif atteint", cls: "bg-accent/15 text-accent" },
  ahead: { label: "En avance", cls: "bg-accent/15 text-accent" },
  on_track: { label: "Dans les temps", cls: "bg-sky-400/15 text-sky-200" },
  watch: { label: "À surveiller", cls: "bg-amber-400/15 text-amber-200" },
  late: { label: "En retard", cls: "bg-red-500/15 text-red-200" },
  done_ok: { label: "Objectif atteint", cls: "bg-accent/15 text-accent" },
  done_close: { label: "Proche", cls: "bg-amber-400/15 text-amber-200" },
  done_low: { label: "Sous l'objectif", cls: "bg-red-500/15 text-red-200" },
  empty: { label: "—", cls: "text-muted" },
};

/** Share of a group sold in time, against the target: used for colours */
export const tone = (pct: number | null | undefined, target: number): "ok" | "close" | "low" | "none" =>
  pct == null ? "none" : pct >= target ? "ok" : pct >= target - 20 ? "close" : "low";

export function view(b: BatchRow, days: number, target: number): BatchView {
  const pct = b.items ? Math.round((b.sold_in_time * 100) / b.items) : 0;
  const needed = Math.ceil((b.items * target) / 100);
  const remaining = Math.max(0, needed - b.sold_in_time);
  const daysLeft = Math.max(0, Math.round(days - b.age_days));
  const pacePerDay = b.age_days > 0.5 ? b.sold_in_time / b.age_days : 0;
  const requiredPerDay = daysLeft > 0 ? remaining / daysLeft : null;
  let pace: Pace;
  if (b.items === 0) pace = "empty";
  else if (b.matured) pace = pct >= target ? "done_ok" : pct >= target - 20 ? "done_close" : "done_low";
  else if (remaining === 0) pace = "reached";
  else if (b.age_days < 3) pace = "on_track"; // too early to tell
  else if (requiredPerDay == null) pace = "late";
  else if (pacePerDay >= requiredPerDay * 1.3) pace = "ahead";
  else if (pacePerDay >= requiredPerDay) pace = "on_track";
  else if (pacePerDay >= requiredPerDay * 0.6) pace = "watch";
  else pace = "late";
  return { ...b, pct, needed, remaining, daysLeft, requiredPerDay, pacePerDay, pace };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;
const euro0 = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eur = (c: number) => euro0.format(Math.round(c / 100));
const rate = (v: number) => (Math.round(v * 10) / 10).toLocaleString("fr-FR");

/** Advice from the sell-through: batches at risk now, finished batches under target, the overall trend */
export function sellThroughAdvice(s: SellThroughStats): Advice[] {
  const out: Advice[] = [];
  const views = s.batches.map((b) => view(b, s.days, s.target_pct));

  const atRisk = views.filter((v) => !v.matured && (v.pace === "late" || v.pace === "watch") && v.age_days >= 7)
    .sort((a, b) => a.daysLeft - b.daysLeft);
  for (const v of atRisk.slice(0, 3)) {
    const late = v.pace === "late";
    const offline = v.not_online > 0 ? ` ${plural(v.not_online, "article n'est", "articles ne sont")} pas encore en ligne : publiez-les d'abord.` : "";
    out.push({
      id: `st-risk-${v.id}`, tone: late && v.daysLeft <= 10 ? "high" : "normal",
      title: `Lot ${v.code} : il reste ${plural(v.daysLeft, "jour")} pour vendre ${plural(v.remaining, "article")} de plus`,
      detail: `${v.pct} % vendus à J+${Math.round(v.age_days)} pour un objectif de ${s.target_pct} % à J+${s.days}. Il faut vendre ${rate(v.requiredPerDay ?? 0)} article${(v.requiredPerDay ?? 0) >= 2 ? "s" : ""} par jour, contre ${rate(v.pacePerDay)} jusqu'ici.${offline} Sinon, baissez de 10 à 15 % les invendus.`,
      impactCents: undefined, href: `/lots/${v.id}`, hrefLabel: "Ouvrir le lot", score: late ? 3300 - v.daysLeft : 2300 - v.daysLeft,
    });
  }

  const missed = views.filter((v) => v.matured && v.pace === "done_low" && v.items >= 5 && v.age_days <= 120).slice(0, 2);
  for (const v of missed) {
    out.push({
      id: `st-low-${v.id}`, tone: "normal",
      title: `Lot ${v.code} : ${v.pct} % vendus en ${s.days} jours (objectif ${s.target_pct} %)`,
      detail: `${v.sold_in_time} article${v.sold_in_time > 1 ? "s" : ""} sur ${v.items} vendus à temps, ${eur(v.cost_cents)} payés. Trop cher à l'achat, mal publié ou trop lent à traiter : vérifiez avant de racheter chez ${v.supplier}.`,
      href: `/ecoulement`, hrefLabel: "Voir l'écoulement", score: 2100,
    });
  }

  const o = s.overall;
  if (o.pct != null && o.items >= 20) {
    const gap = s.target_pct - o.pct;
    if (gap >= 10) {
      out.push({
        id: "st-overall", tone: gap >= 30 ? "high" : "normal",
        title: `Écoulement à ${s.days} jours : ${Math.round(o.pct)} % (objectif ${s.target_pct} %)`,
        detail: `Sur ${o.items} articles reçus ces 6 derniers mois, ${o.sold} ont été vendus dans les ${s.days} jours. Pour rattraper l'objectif : baisser les prix de départ, publier plus vite, ou acheter moins cher.`,
        href: "/ecoulement", hrefLabel: "Voir le détail", score: gap >= 30 ? 3100 : 2200,
      });
    } else if (gap <= 0) {
      out.push({
        id: "st-overall", tone: "info",
        title: `Écoulement à ${s.days} jours : ${Math.round(o.pct)} %, objectif atteint`,
        detail: `Votre rotation tient l'objectif de ${s.target_pct} %. C'est le signal pour acheter davantage, ou pour tester des prix de départ un peu plus hauts sur ce qui part vite.`,
        href: "/ecoulement", hrefLabel: "Voir le détail", score: 1100,
      });
    }
  }
  return out;
}
