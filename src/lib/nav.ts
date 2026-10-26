import {
  BarChart3, Boxes, Calculator, Factory, FlaskConical, LayoutDashboard, MapPin, Package, Settings, ShoppingBag, Truck, type LucideIcon,
} from "lucide-react";

export interface NavItem { href: string; label: string; icon: LucideIcon; manager: boolean; keywords?: string }

/** Every page of the app, in menu order; also the targets of the search palette */
export const NAV: NavItem[] = [
  { href: "/", label: "Tableau de bord", icon: LayoutDashboard, manager: false, keywords: "accueil dashboard" },
  { href: "/statistiques", label: "Statistiques", icon: BarChart3, manager: true, keywords: "kpi graphiques marge chiffre" },
  { href: "/scenarios", label: "Scénarios", icon: FlaskConical, manager: true, keywords: "simulation prévision business plan hypothèses" },
  { href: "/postes", label: "Postes", icon: Factory, manager: false, keywords: "travail production" },
  { href: "/stock", label: "Stock", icon: Package, manager: false, keywords: "articles inventaire" },
  { href: "/lots", label: "Lots", icon: Boxes, manager: false, keywords: "achats batch" },
  { href: "/ventes", label: "Ventes", icon: ShoppingBag, manager: false, keywords: "commandes nouvelle vente" },
  { href: "/emplacements", label: "Emplacements", icon: MapPin, manager: false, keywords: "rangement étagères" },
  { href: "/fournisseurs", label: "Fournisseurs", icon: Truck, manager: true },
  { href: "/compta", label: "Compta & URSSAF", icon: Calculator, manager: true, keywords: "livre recettes déclaration" },
  { href: "/parametres", label: "Paramètres", icon: Settings, manager: true, keywords: "réglages équipe extension" },
];

/** Shortcuts to the stations and frequent screens */
export const SHORTCUTS: { href: string; label: string; manager: boolean }[] = [
  { href: "/postes/reception", label: "Poste Réception & tri", manager: false },
  { href: "/postes/photo", label: "Poste Photo & mesures", manager: false },
  { href: "/postes/rangement", label: "Poste Rangement", manager: false },
  { href: "/postes/publication", label: "Poste Publication", manager: false },
  { href: "/postes/expedition", label: "Poste Expédition", manager: false },
  { href: "/lots/nouveau", label: "Nouveau lot", manager: false },
  { href: "/stock?deleted=1", label: "Corbeille du stock", manager: true },
  { href: "/ventes/import", label: "Importer des ventes (CSV)", manager: true },
  { href: "/stock/import", label: "Importer le stock (CSV)", manager: true },
];

export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
