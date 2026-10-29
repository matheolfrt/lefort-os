import {
  BarChart3, Boxes, Calculator, Compass, Factory, Gauge, FlaskConical, Landmark, TrendingDown, LayoutDashboard, Lightbulb, MapPin, Package, ListTodo, Radar, Settings, ShoppingBag, Target, Truck, type LucideIcon,
} from "lucide-react";

export type NavGroup = "Pilotage" | "Opérations" | "Gestion";
export interface NavItem {
  href: string; label: string; icon: LucideIcon; manager: boolean; keywords?: string; group: NavGroup;
  /** a tab of the Pilotage page: searchable, but not its own menu entry */
  tab?: boolean;
  /** other paths that light this entry up in the menu */
  match?: string[];
}

/** Every page of the app, in menu order; also the targets of the search palette */
export const NAV: NavItem[] = [
  { href: "/", label: "Tableau de bord", icon: LayoutDashboard, manager: false, keywords: "accueil dashboard", group: "Pilotage" },
  { href: "/conseils", label: "Pilotage", icon: Radar, manager: true, keywords: "pilotage analyse", group: "Pilotage",
    match: ["/conseils", "/objectifs", "/prix", "/ecoulement", "/niches", "/statistiques", "/scenarios"] },
  { href: "/finance", label: "Finance", icon: Landmark, manager: true, group: "Pilotage", match: ["/finance"],
    keywords: "où est mon argent trésorerie cash capital budget d'achat prévision stock dormant immobilisé rotation rentabilité" },
  { href: "/conseils", label: "Conseils", icon: Lightbulb, manager: true, keywords: "priorités rentabilité recommandations à faire acheter", group: "Pilotage" , tab: true },
  { href: "/objectifs", label: "Objectifs", icon: Target, manager: true, keywords: "objectif chiffre d'affaires ca ventes jour semaine mois année but", group: "Pilotage", tab: true },
  { href: "/prix", label: "Prix", icon: TrendingDown, manager: true, keywords: "baisser prix stock dormant démarque solde rotation suggestion", group: "Pilotage", tab: true },
  { href: "/ecoulement", label: "Écoulement", icon: Gauge, manager: true, keywords: "rotation 30 jours 80% vente rapide taux lot objectif", group: "Pilotage" , tab: true },
  { href: "/niches", label: "Niches", icon: Compass, manager: true, keywords: "tester nouvelles niches marques idées essai lot de test", group: "Pilotage" , tab: true },
  { href: "/statistiques", label: "Statistiques", icon: BarChart3, manager: true, keywords: "kpi graphiques marge chiffre", group: "Pilotage" , tab: true },
  { href: "/scenarios", label: "Scénarios", icon: FlaskConical, manager: true, keywords: "simulation prévision business plan hypothèses", group: "Pilotage" , tab: true },
  { href: "/taches", label: "Tâches", icon: ListTodo, manager: false, keywords: "à faire todo liste rappel", group: "Opérations" },
  { href: "/postes", label: "Postes", icon: Factory, manager: false, keywords: "travail production kanban", group: "Opérations" },
  { href: "/stock", label: "Stock", icon: Package, manager: false, keywords: "articles inventaire", group: "Opérations" },
  { href: "/lots", label: "Lots", icon: Boxes, manager: false, keywords: "achats batch", group: "Opérations" },
  { href: "/ventes", label: "Ventes", icon: ShoppingBag, manager: false, keywords: "commandes nouvelle vente", group: "Opérations" },
  { href: "/emplacements", label: "Emplacements", icon: MapPin, manager: false, keywords: "rangement étagères", group: "Opérations" },
  { href: "/fournisseurs", label: "Fournisseurs", icon: Truck, manager: true, group: "Gestion" },
  { href: "/compta", label: "Compta & URSSAF", icon: Calculator, manager: true, keywords: "livre recettes déclaration", group: "Gestion" },
  { href: "/parametres", label: "Paramètres", icon: Settings, manager: true, keywords: "réglages équipe extension", group: "Gestion" },
];

/** Tabs of the Pilotage page (one menu entry, several screens) */
export const PILOTAGE_TABS = NAV.filter((n) => n.tab);

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
