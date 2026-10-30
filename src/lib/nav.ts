import {
  BarChart3, Boxes, Calculator, Compass, Factory, Gauge, FlaskConical, Landmark, TrendingDown, LayoutDashboard, Lightbulb, MapPin, Package, ListTodo, NotebookPen, RefreshCw, Settings, ShoppingBag, Sprout, Target, Truck, Undo2, type LucideIcon,
} from "lucide-react";

export type NavGroup = "Aujourd'hui" | "Stock et lots" | "Argent" | "Réglages";
export const NAV_GROUPS: { group: NavGroup; hint: string }[] = [
  { group: "Aujourd'hui", hint: "ce que je fais" },
  { group: "Stock et lots", hint: "ce que j'ai" },
  { group: "Argent", hint: "ce que je gagne" },
  { group: "Réglages", hint: "" },
];
export interface NavItem {
  href: string; label: string; icon: LucideIcon; manager: boolean; keywords?: string; group: NavGroup;
  /** a tab of a hub page (`hub` = the href of its menu entry): searchable, shown in the hub's tab bar, not in the menu */
  hub?: string;
  /** shorter name in the tab bar */
  tabLabel?: string;
  /** other paths that light this entry up in the menu */
  match?: string[];
}

/** Every page of the app, in menu order; also the targets of the search palette */
export const NAV: NavItem[] = [
  // ── Aujourd'hui: ce que je fais
  { href: "/", label: "Tableau de bord", icon: LayoutDashboard, manager: false, keywords: "accueil dashboard ma journée", group: "Aujourd'hui" },
  { href: "/taches", label: "Tâches", icon: ListTodo, manager: false, keywords: "à faire todo liste rappel", group: "Aujourd'hui" },
  { href: "/postes", label: "Postes", icon: Factory, manager: false, keywords: "travail production kanban", group: "Aujourd'hui" },
  { href: "/notes", label: "Notes", icon: NotebookPen, manager: false, keywords: "note bloc-notes idée mémo écrire carnet", group: "Aujourd'hui" },
  { href: "/ventes", label: "Ventes", icon: ShoppingBag, manager: false, keywords: "commandes nouvelle vente", group: "Aujourd'hui" },
  { href: "/ventes", label: "Ventes", icon: ShoppingBag, manager: true, group: "Aujourd'hui", hub: "/ventes", keywords: "commandes nouvelle vente" },
  { href: "/ventes/retours", label: "Retours", icon: Undo2, manager: true, group: "Aujourd'hui", hub: "/ventes", keywords: "retour remboursement taux taille marque motif" },
  { href: "/ventes/vinted", label: "Synchro Vinted", icon: RefreshCw, manager: true, group: "Aujourd'hui", hub: "/ventes", keywords: "rapprochement ventes à vérifier extension" },

  // ── Stock et lots: ce que j'ai
  { href: "/stock", label: "Stock", icon: Package, manager: false, keywords: "articles inventaire", group: "Stock et lots" },
  { href: "/lots", label: "Lots", icon: Boxes, manager: false, keywords: "achats batch rotation remboursement", group: "Stock et lots" },
  { href: "/ecoulement", label: "Rotation", icon: Gauge, manager: true, group: "Stock et lots", match: ["/ecoulement", "/prix", "/niches"],
    keywords: "écoulement prix à baisser niches" },
  { href: "/ecoulement", label: "Écoulement", icon: Gauge, manager: true, keywords: "rotation 30 jours 80% vente rapide taux lot objectif", group: "Stock et lots", hub: "/ecoulement" },
  { href: "/prix", label: "Prix à baisser", icon: TrendingDown, manager: true, keywords: "baisser prix stock dormant démarque solde rotation suggestion", group: "Stock et lots", hub: "/ecoulement" },
  { href: "/niches", label: "Niches", icon: Compass, manager: true, keywords: "tester nouvelles niches marques idées essai lot de test", group: "Stock et lots", hub: "/ecoulement" },
  { href: "/fournisseurs", label: "Fournisseurs", icon: Truck, manager: true, group: "Stock et lots" },
  { href: "/emplacements", label: "Emplacements", icon: MapPin, manager: false, keywords: "rangement étagères", group: "Stock et lots" },

  // ── Argent: ce que je gagne
  { href: "/finance", label: "Mon argent", icon: Landmark, manager: true, group: "Argent",
    match: ["/finance", "/conseils", "/objectifs", "/statistiques", "/reinvestir", "/scenarios"], keywords: "finance pilotage" },
  { href: "/finance", label: "Où est mon argent ?", tabLabel: "Vue d'ensemble", icon: Landmark, manager: true, group: "Argent", hub: "/finance",
    keywords: "finance trésorerie cash capital budget d'achat prévision stock dormant immobilisé rotation rentabilité" },
  { href: "/conseils", label: "Conseils", icon: Lightbulb, manager: true, keywords: "priorités rentabilité recommandations à faire acheter pilotage", group: "Argent", hub: "/finance" },
  { href: "/objectifs", label: "Objectifs", icon: Target, manager: true, keywords: "objectif chiffre d'affaires ca ventes jour semaine mois année but", group: "Argent", hub: "/finance" },
  { href: "/statistiques", label: "Statistiques", icon: BarChart3, manager: true, keywords: "kpi graphiques marge chiffre", group: "Argent", hub: "/finance" },
  { href: "/reinvestir", label: "Réinvestir", icon: Sprout, manager: true, keywords: "réinvestir investir croissance projection ca 3 mois un an stock acheter plus", group: "Argent", hub: "/finance" },
  { href: "/scenarios", label: "Scénarios", icon: FlaskConical, manager: true, keywords: "simulation prévision business plan hypothèses", group: "Argent", hub: "/finance" },
  { href: "/compta", label: "Compta & URSSAF", icon: Calculator, manager: true, keywords: "livre recettes déclaration", group: "Argent" },

  { href: "/parametres", label: "Paramètres", icon: Settings, manager: true, keywords: "réglages équipe extension emballage", group: "Réglages" },
];

/** The menu: one entry per page or hub (the hubs' tabs are reached from their tab bar) */
export const menuItems = (isManager: boolean) => NAV.filter((n) => (isManager || !n.manager) && !n.hub);

/** The tab bar of the page at `path`: the tabs of its hub, or null when the page belongs to none */
export function hubTabs(path: string, isManager: boolean): NavItem[] | null {
  const under = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  const tabs = NAV.filter((n) => n.hub && (isManager || !n.manager));
  // the tab with the longest matching href (« /ventes/retours » rather than « /ventes »)
  const mine = tabs.filter((t) => under(t.href)).sort((a, b) => b.href.length - a.href.length)[0];
  if (!mine) return null;
  const siblings = tabs.filter((t) => t.hub === mine.hub);
  return siblings.length > 1 ? siblings : null;
}

/** The tab of `tabs` the page at `path` belongs to (the longest matching href) */
export function currentTab(tabs: NavItem[], path: string) {
  return tabs.filter((t) => path === t.href || path.startsWith(`${t.href}/`)).sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
}

/** Shortcuts to the stations and frequent screens */
export const SHORTCUTS: { href: string; label: string; manager: boolean }[] = [
  { href: "/postes/production", label: "Production (Kanban, prochaine tâche)", manager: false },
  { href: "/postes/reception", label: "Poste Réception & tri", manager: false },
  { href: "/postes/photo", label: "Poste Photo & mesures", manager: false },
  { href: "/postes/rangement", label: "Poste Rangement", manager: false },
  { href: "/postes/publication", label: "Poste Publication", manager: false },
  { href: "/postes/expedition", label: "Poste Expédition", manager: false },
  { href: "/lots/nouveau", label: "Nouveau lot", manager: false },
  { href: "/stock?deleted=1", label: "Corbeille du stock", manager: true },
  { href: "/ventes/vinted", label: "Synchro Vinted (ventes à vérifier, rapprochement)", manager: true },
  { href: "/ventes/import", label: "Importer des ventes (CSV)", manager: true },
  { href: "/stock/import", label: "Importer le stock (CSV)", manager: true },
  { href: "/parametres/mises-a-jour", label: "Mises à jour de la base", manager: true },
];

export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
