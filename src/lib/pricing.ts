// Markdown suggestions: what the rules say, in words. The rules and the numbers come from price_suggestions().

export interface Step { days: number; pct: number }
export interface Suggestion {
  id: string; sku: string; title: string | null; brand: string | null; category: string | null; size: string | null; url: string | null;
  price: number; start_price: number; suggested: number; min_price: number | null; cost: number;
  days_online: number; step_days: number; step_pct: number; held_by: "min_price" | "cost" | null; margin: number;
}
export interface PriceData {
  steps: Step[]; wait_days: number; items: Suggestion[];
  at_floor: number; waiting: number; skipped: number; soon: number; listed: number;
  recent: { id: string; sku: string; title: string | null; old: number; new: number; at: string; url: string | null }[];
  effect: { band: 1 | 2 | 3; n: number; sold: number }[] | null;
}

export const DEFAULT_STEPS: Step[] = [{ days: 14, pct: 10 }, { days: 30, pct: 20 }, { days: 45, pct: 30 }];
export const BAND_LABEL = { 1: "baisse de 10 % ou moins", 2: "baisse de 10 à 20 %", 3: "baisse de plus de 20 %" } as const;

const eur = (c: number) => `${Math.round(c / 100).toLocaleString("fr-FR")} €`;

/** Why this price: the rule reached, and what holds it up if it is not the rule's own target */
export function reason(s: Suggestion): string {
  const rule = `En ligne depuis ${s.days_online} j : palier ${s.step_days} j, −${s.step_pct} % du prix de départ (${eur(s.start_price)})`;
  if (s.held_by === "min_price") return `${rule}, arrêté à votre prix minimum.`;
  if (s.held_by === "cost") return `${rule}, arrêté au plus bas sans vendre à perte.`;
  return `${rule}.`;
}

/** Steps from the settings form: days and percentages both increasing, at most 5 */
export function parseSteps(days: string[], pcts: string[]): Step[] | string {
  const steps = days.map((d, i) => ({ days: Number(d), pct: Number(String(pcts[i] ?? "").replace(",", ".")) }))
    .filter((s) => String(s.days) !== "0" && Number.isFinite(s.days) && Number.isFinite(s.pct) && s.days > 0 && s.pct > 0);
  if (!steps.length) return "Gardez au moins un palier.";
  if (steps.length > 5) return "5 paliers au maximum.";
  steps.sort((a, b) => a.days - b.days);
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].pct >= 80) return "Une baisse doit rester sous 80 %.";
    if (i && steps[i].days === steps[i - 1].days) return "Deux paliers ont le même nombre de jours.";
    if (i && steps[i].pct <= steps[i - 1].pct) return "Chaque palier doit baisser davantage que le précédent.";
  }
  return steps.map((s) => ({ days: Math.round(s.days), pct: Math.round(s.pct * 10) / 10 }));
}
