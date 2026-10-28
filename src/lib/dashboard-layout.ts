// The cards of the dashboard, in their default reading order: what matters today (objectives), the money, then the
// rest. Urgent alerts are not cards: they always come first and cannot be hidden.

export interface DashCard { id: string; label: string; hint: string; manager?: boolean }

export const DASH_CARDS: DashCard[] = [
  { id: "goals", label: "Objectifs", hint: "CA et ventes du jour et du mois" },
  { id: "money", label: "Où est mon argent ?", hint: "trésorerie, capital, budget d'achat", manager: true },
  { id: "todo", label: "À faire maintenant", hint: "articles à trier, photographier, publier…" },
  { id: "tasks", label: "Mes tâches du jour", hint: "votre liste de choses à faire" },
  { id: "advice", label: "Conseils", hint: "les priorités calculées", manager: true },
  { id: "month", label: "Ce mois-ci", hint: "CA, bénéfice, ventes, stock" },
  { id: "trend", label: "Évolution des ventes", hint: "le mois et la semaine, jour par jour", manager: true },
  { id: "pipeline", label: "Chaîne de production", hint: "articles à chaque étape" },
  { id: "health", label: "Santé de l'activité", hint: "CA sur 12 mois, âge du stock, seuils micro" },
];

/**
 * The cards this person can see, in their order, with those hidden. A saved order keeps working when cards are added
 * later: unknown ids are dropped, new cards take their default place.
 */
export function resolveLayout(saved: { order: string[]; hidden: string[] } | null, isManager: boolean) {
  const available = DASH_CARDS.filter((c) => isManager || !c.manager);
  const byId = new Map(available.map((c) => [c.id, c]));
  const order: DashCard[] = [];
  for (const id of saved?.order ?? []) { const c = byId.get(id); if (c && !order.includes(c)) order.push(c); }
  available.forEach((c, i) => {
    if (order.includes(c)) return;
    // after the card that comes before it by default, or first
    const prev = available.slice(0, i).reverse().find((p) => order.includes(p));
    order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, c);
  });
  const hidden = new Set((saved?.hidden ?? []).filter((id) => byId.has(id)));
  return { order, hidden };
}
