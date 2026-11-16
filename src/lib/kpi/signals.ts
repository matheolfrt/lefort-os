// Buying and pricing signals for the Conseils page, read from the indicators: stock running low or piling up,
// listing slower than selling, types that leave too fast or too slowly, sizes missing, lots to group, costs unknown.
// Each one says the figures it comes from. Pure function, tested in scripts/kpi-test.ts.

import type { Advice } from "@/lib/advisor";
import type { Aging, DataQuality, GroupStats, Pace, SizeRow } from "./compute";

export interface SignalInput {
  families: GroupStats[]; pace: Pace; aging: Aging; sizes: SizeRow[]; quality: DataQuality;
  bundles: { count: number; pieces: number; revenue: number };
}

const one = (n: number) => (Math.round(n * 10) / 10).toLocaleString("fr-FR");
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} et ${xs[xs.length - 1]}`);
const pct = (x: number) => `${Math.round(x * 100)} %`;

export function kpiSignals({ families, pace, aging, sizes, quality, bundles }: SignalInput): Advice[] {
  const out: Advice[] = [];
  const c = pace.cover;

  if (c.months != null && c.perMonth >= 5 && c.months < 1) {
    out.push({
      id: "kpi-cover-low", tone: c.months < 0.5 ? "urgent" : "high", score: 90 - c.months * 20,
      title: `Rachetez du stock : il vous reste ${one(c.months)} mois de ventes`,
      detail: `${c.stock} pièces en stock pour ${Math.round(c.perMonth)} vendues par mois (rythme des 90 derniers jours). Sans achat, vos ventes vont ralentir d'ici quelques semaines.`,
      href: "/indicateurs#lot", hrefLabel: "Juger un lot",
    });
  } else if (c.months != null && c.months > 4 && c.stock >= 20) {
    out.push({
      id: "kpi-cover-high", tone: "normal", score: 45,
      title: `Écoulez avant de racheter : ${one(c.months)} mois de stock`,
      detail: `${c.stock} pièces en stock pour ${Math.round(c.perMonth)} vendues par mois. Mettez en ligne et baissez ce qui dort avant d'acheter un nouveau lot.`,
      href: "/prix", hrefLabel: "Prix à baisser",
    });
  }

  if (pace.soldPerDay30 >= 0.5 && pace.listedPerDay30 < pace.soldPerDay30 * 0.8 && aging.waiting.count > 0) {
    out.push({
      id: "kpi-pace", tone: "high", score: 75,
      title: `Mettez plus en ligne : vous vendez ${one(pace.soldPerDay30)} pièces par jour, vous en mettez ${one(pace.listedPerDay30)}`,
      detail: `${aging.waiting.count} pièce${aging.waiting.count > 1 ? "s" : ""} en stock ne ${aging.waiting.count > 1 ? "sont" : "est"} pas encore en ligne${aging.waiting.old ? `, dont ${aging.waiting.old} reçue${aging.waiting.old > 1 ? "s" : ""} il y a plus de 14 jours` : ""}. Votre stock en ligne fond : c'est lui qui fait vos ventes.`,
      href: "/postes/production", hrefLabel: "Voir la production",
    });
  }

  const up = families.filter((g) => g.advice.tone === "up" && g.avgPrice != null);
  if (up.length) {
    const gain = up.reduce((s, g) => s + g.avgPrice! * 0.1 * (g.sold / 12), 0);
    out.push({
      id: "kpi-price-up", tone: "normal", score: 60,
      title: `Montez le prix : ${list(up.map((g) => g.label))}`,
      detail: up.map((g) => `${g.label} : ${g.fastShare == null ? "" : `${pct(g.fastShare)} vendus en moins de 2 jours, `}prix moyen ${Math.round(g.avgPrice! / 100)} €.`).join(" ")
        + " Quand la moitié part en 2 jours, le prix est trop bas : essayez 10 à 15 % de plus.",
      impactCents: Math.round(gain), impactLabel: "par mois avec +10 %",
      href: "/indicateurs#types", hrefLabel: "Voir par type",
    });
  }

  const down = families.filter((g) => g.advice.tone === "down");
  if (down.length) {
    out.push({
      id: "kpi-buy-less", tone: "normal", score: 50,
      title: `Achetez moins, ou moins cher : ${list(down.map((g) => g.label))}`,
      detail: down.map((g) => `${g.label} : ${g.advice.text}${g.maxBuy != null ? ` Pas plus de ${(g.maxBuy / 100).toLocaleString("fr-FR")} € la pièce.` : ""}`).join(" "),
      href: "/indicateurs#types", hrefLabel: "Voir par type",
    });
  }

  const missing = sizes.filter((s) => s.size && s.verdict === "manque");
  if (missing.length) {
    out.push({
      id: "kpi-sizes-missing", tone: "normal", score: 55,
      title: `Taille${missing.length > 1 ? "s" : ""} à racheter : ${list(missing.map((s) => s.size!))}`,
      detail: missing.map((s) => `${s.size} : ${pct(s.soldShare ?? 0)} de vos ventes de blazers, ${pct(s.stockShare ?? 0)} de votre stock.`).join(" ")
        + " Demandez ces tailles en priorité à votre fournisseur.",
      href: "/indicateurs#tailles", hrefLabel: "Voir les tailles",
    });
  }
  const tooMuch = sizes.filter((s) => s.size && s.verdict === "trop");
  if (tooMuch.length) {
    out.push({
      id: "kpi-sizes-too-much", tone: "info", score: 30,
      title: `Trop de stock en ${list(tooMuch.map((s) => s.size!))}`,
      detail: tooMuch.map((s) => `${s.size} : ${s.stock} en stock${s.cover != null ? `, soit ${one(s.cover)} mois de ventes` : ""}.`).join(" ") + " N'en rachetez pas pour l'instant.",
      href: "/indicateurs#tailles", hrefLabel: "Voir les tailles",
    });
  }

  if (bundles.count > 0) {
    out.push({
      id: "kpi-bundles", tone: "normal", score: 52,
      title: `${bundles.count} lot${bundles.count > 1 ? "s" : ""} groupé${bundles.count > 1 ? "s" : ""} à créer avec les pièces qui dorment`,
      detail: `${bundles.pieces} annonces en ligne depuis plus de 60 jours peuvent partir en lots de 3 ou 4, même type et même taille. Titre, description et prix sont prêts à copier.`,
      impactCents: bundles.revenue, impactLabel: "si tous les lots se vendent",
      href: "/lots-groupes", hrefLabel: "Voir les lots proposés",
    });
  }

  if (quality.soldTotal >= 10 && quality.soldNoCost / quality.soldTotal > 0.3) {
    out.push({
      id: "kpi-costs", tone: "info", score: 25,
      title: `Vos marges sont estimées : ${quality.soldNoCost} ventes sur ${quality.soldTotal} sans prix d'achat`,
      detail: "Sans prix d'achat réel, Lefort OS compte 10 € par Harris, manteau ou costume et 4 € par autre pièce. Saisissez les vrais prix en masse depuis le Stock.",
      href: "/stock?cout=inconnu", hrefLabel: "Pièces sans prix d'achat",
    });
  }
  // same scale as the other advice of the page: the tone first, then the signal's own weight
  const BASE = { urgent: 4000, high: 3000, normal: 2000, info: 1000 } as const;
  return out.map((a) => ({ ...a, score: BASE[a.tone] + a.score * 5 })).sort((a, b) => b.score - a.score);
}
