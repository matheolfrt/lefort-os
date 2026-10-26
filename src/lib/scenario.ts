// Business scenario engine: a monthly, steady-state model of the resale business at a given stock level,
// plus a 12-month projection when the stock grows. Pure functions, shared by the page and its tests.

import { MICRO_TURNOVER_CEILING_CENTS, VAT_FRANCHISE_THRESHOLD_CENTS } from "@/lib/compliance";

export interface ScenarioInputs {
  stock: number;            // items in stock (on sale or being prepared)
  cost: number;             // average purchase cost per item, €
  price: number;            // average selling price, €
  sellThrough: number;      // % of the stock sold each month
  feePct: number;           // platform commission, % of the price
  feeFixed: number;         // platform fixed fee per sale, €
  perSale: number;          // packaging + shipping paid by you, per sale, €
  urssafPct: number;        // micro-entreprise contributions, % of turnover
  employees: number;        // employees besides you
  employeeCost: number;     // employer cost per employee per month, €
  rent: number;             // workshop / storage rent per month, €
  otherFixed: number;       // energy, insurance, software, misc per month, €
  growth: number;           // monthly stock growth, %
  capacity: number;         // items one person can process per month (receive → list → ship)
}

export const FIELDS: { key: keyof ScenarioInputs; label: string; unit: string; step?: number; group: string; hint?: string }[] = [
  { key: "stock", label: "Stock géré", unit: "articles", group: "Stock et prix" },
  { key: "cost", label: "Coût d'achat moyen", unit: "€ / article", step: 0.5, group: "Stock et prix" },
  { key: "price", label: "Prix de vente moyen", unit: "€", step: 0.5, group: "Stock et prix" },
  { key: "sellThrough", label: "Écoulement mensuel", unit: "% du stock", step: 1, group: "Stock et prix", hint: "Part du stock vendue chaque mois" },
  { key: "feePct", label: "Commission plateforme", unit: "%", step: 0.1, group: "Frais par vente" },
  { key: "feeFixed", label: "Frais fixes plateforme", unit: "€ / vente", step: 0.05, group: "Frais par vente" },
  { key: "perSale", label: "Emballage + port à charge", unit: "€ / vente", step: 0.1, group: "Frais par vente" },
  { key: "urssafPct", label: "Cotisations URSSAF", unit: "% du CA", step: 0.1, group: "Frais par vente" },
  { key: "employees", label: "Salariés (hors vous)", unit: "personnes", step: 1, group: "Équipe et charges" },
  { key: "employeeCost", label: "Coût employeur", unit: "€ / mois / salarié", step: 50, group: "Équipe et charges" },
  { key: "capacity", label: "Capacité par personne", unit: "articles / mois", step: 10, group: "Équipe et charges", hint: "Articles traités de la réception à l'expédition" },
  { key: "rent", label: "Local / entrepôt", unit: "€ / mois", step: 50, group: "Équipe et charges" },
  { key: "otherFixed", label: "Autres charges fixes", unit: "€ / mois", step: 10, group: "Équipe et charges", hint: "Énergie, assurance, logiciels, divers" },
  { key: "growth", label: "Croissance du stock", unit: "% / mois", step: 1, group: "Croissance" },
];

export const DEFAULTS: ScenarioInputs = {
  stock: 250, cost: 15, price: 45, sellThrough: 25, feePct: 5, feeFixed: 0.7, perSale: 1, urssafPct: 12.4,
  employees: 0, employeeCost: 2200, rent: 0, otherFixed: 50, growth: 0, capacity: 150,
};

export interface ScenarioResult {
  sales: number; revenue: number; cogs: number; fees: number; perSaleCosts: number; urssaf: number;
  payroll: number; fixed: number; gross: number; net: number; marginPct: number | null;
  capital: number; daysToSell: number | null; contribution: number; breakevenSales: number | null; breakevenStock: number | null;
  annualRevenue: number; annualNet: number; roiPct: number | null; team: number; peopleNeeded: number;
  warnings: { tone: "bad" | "watch"; text: string }[];
}

const n = (v: number) => (Number.isFinite(v) ? v : 0);

export function compute(s: ScenarioInputs): ScenarioResult {
  const sales = Math.max(0, s.stock) * Math.max(0, s.sellThrough) / 100;
  const revenue = sales * s.price;
  const cogs = sales * s.cost;
  const fees = revenue * s.feePct / 100 + sales * s.feeFixed;
  const perSaleCosts = sales * s.perSale;
  const urssaf = revenue * s.urssafPct / 100;
  const payroll = s.employees * s.employeeCost;
  const fixed = payroll + s.rent + s.otherFixed;
  const gross = revenue - cogs - fees - perSaleCosts;
  const net = gross - urssaf - fixed;
  // what one more sale brings once its own costs and contributions are paid
  const contribution = s.price - s.cost - s.price * s.feePct / 100 - s.feeFixed - s.perSale - s.price * s.urssafPct / 100;
  const breakevenSales = contribution > 0 ? fixed / contribution : null;
  const capital = Math.max(0, s.stock) * s.cost;
  const team = 1 + Math.max(0, s.employees);
  const peopleNeeded = s.capacity > 0 ? Math.ceil(sales / s.capacity) : team;
  const annualRevenue = revenue * 12;

  const warnings: ScenarioResult["warnings"] = [];
  if (contribution <= 0) warnings.push({ tone: "bad", text: "Chaque vente perd de l'argent : le prix ne couvre pas l'achat, les frais et les cotisations." });
  else if (net < 0) warnings.push({ tone: "bad", text: `Déficitaire : il faut ${Math.ceil(breakevenSales!)} ventes par mois pour couvrir les charges fixes.` });
  if (annualRevenue * 100 > MICRO_TURNOVER_CEILING_CENTS) warnings.push({ tone: "bad", text: "CA annuel au-dessus du plafond micro-entreprise : passage en société à prévoir." });
  else if (annualRevenue * 100 > VAT_FRANCHISE_THRESHOLD_CENTS) warnings.push({ tone: "watch", text: "CA annuel au-dessus de la franchise de TVA : la TVA sur marge s'appliquerait (non modélisée ici)." });
  if (peopleNeeded > team) warnings.push({ tone: "watch", text: `Charge de travail : ${peopleNeeded} personnes nécessaires pour ${Math.round(sales)} ventes / mois, l'équipe en compte ${team}.` });
  if (s.sellThrough > 60) warnings.push({ tone: "watch", text: "Écoulement très élevé : vérifiez-le avec vos statistiques réelles." });

  return {
    sales, revenue, cogs, fees, perSaleCosts, urssaf, payroll, fixed, gross, net,
    marginPct: revenue > 0 ? (net / revenue) * 100 : null,
    capital, daysToSell: s.sellThrough > 0 ? 30 / (s.sellThrough / 100) : null,
    contribution, breakevenSales, breakevenStock: breakevenSales != null && s.sellThrough > 0 ? breakevenSales / (s.sellThrough / 100) : null,
    annualRevenue, annualNet: net * 12, roiPct: capital > 0 ? n((net * 12) / capital * 100) : null,
    team, peopleNeeded, warnings,
  };
}

export interface ProjectionMonth { month: string; stock: number; revenue: number; net: number; buying: number; cash: number }

/** 12 months ahead: the stock grows by `growth` % a month; growing it is bought out of the month's profit */
export function project(s: ScenarioInputs, from = new Date()): ProjectionMonth[] {
  const out: ProjectionMonth[] = [];
  let stock = s.stock;
  let cash = 0;
  for (let i = 1; i <= 12; i++) {
    const d = new Date(Date.UTC(from.getFullYear(), from.getMonth() + i, 1));
    const r = compute({ ...s, stock });
    const next = stock * (1 + s.growth / 100);
    const buying = r.cogs + (next - stock) * s.cost; // replace what sold + grow the stock
    cash += r.net - (next - stock) * s.cost;
    out.push({ month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, stock, revenue: r.revenue, net: r.net, buying, cash });
    stock = next;
  }
  return out;
}

/** Stock levels for the capacity table, around the scenario's own level */
export function capacityLevels(stock: number): number[] {
  const base = [100, 250, 500, 1000, 2500, 5000, 10000];
  return [...new Set([...base, Math.round(stock)])].filter((v) => v > 0).sort((a, b) => a - b);
}
