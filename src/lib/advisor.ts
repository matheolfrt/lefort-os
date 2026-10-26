// "Conseils": rule-based advice from the business figures (public.advisor_facts). No AI: every rule is written
// out here with its thresholds, and every piece of advice shows the numbers it comes from.

export interface Facts {
  dead_days: number;
  fee_pct: number;
  fee_fixed_cents: number;
  ship_avg_cents: number;
  queues: Partial<Record<"received" | "sorted" | "photographed" | "measured" | "returned" | "listing_ready" | "on_hold" | "reserved", { n: number; oldest_days: number }>>;
  blocked: { n: number; oldest_days: number | null };
  to_ship: { orders: number; oldest_hours: number | null };
  /** the 50 oldest, and how many there are */
  reserved_long: { id: string; sku: string; brand: string | null; days: number }[];
  reserved_long_n: number;
  ready_no_price: number;
  ready: { n: number; value_cents: number };
  /** the 50 items ready to publish with the best expected profit */
  ready_best: { id: string; sku: string; brand: string | null; title: string | null; priority: number; price_cents: number | null; cost_cents: number; expected_profit_cents: number | null }[];
  to_label: number;
  batches_incomplete: { id: string; code: string; expected: number; received: number }[];
  last_vinted_sync: string | null;
  stock: { n: number; cost_cents: number; value_cents: number; offline_n: number; offline_cost_cents: number };
  aging: { bucket: number; n: number; cost_cents: number }[];
  dormant: { n: number; cost_cents: number };
  dormant_items: { id: string; sku: string; brand: string | null; title: string | null; size: string | null; price_cents: number | null; cost_cents: number; days: number }[];
  below_cost: { n: number; loss_cents: number; items: { id: string; sku: string; brand: string | null; price_cents: number; cost_cents: number; net_cents: number }[] };
  underpriced: { n: number; gain_cents: number; items: { id: string; sku: string; brand: string | null; price_cents: number; brand_avg_cents: number; brand_sales: number }[] };
  brands: Group[];
  categories: Group[];
  sizes: { name: string; sold: number; profit_cents: number; avg_days: number | null; stock: number }[];
  suppliers: { id: string; name: string; items: number; sold: number; cost_cents: number; revenue_cents: number; profit_cents: number; roi_pct: number | null; sell_through_pct: number | null }[];
  batches: { id: string; code: string; supplier: string; items: number; sold: number; cost_cents: number; profit_cents: number; roi_pct: number | null; sell_through_pct: number | null; purchased_at: string }[];
  price_bands: { band: number; sold: number; profit_cents: number; revenue_cents: number; avg_days: number | null }[];
  weekdays: { dow: number; n: number }[];
  discount: { n: number; avg_pct: number | null };
  fees_90d: { orders: number; revenue_cents: number; platform_cents: number; shipping_cents: number; packaging_cents: number };
  trend: { last_n: number; prev_n: number; last_profit_cents: number; prev_profit_cents: number; last_revenue_cents: number; prev_revenue_cents: number };
  totals: { sold: number; profit_cents: number; revenue_cents: number; avg_days: number | null; sold_90d: number };
  turnover: { month: string; turnover_cents: number; contributions_cents: number }[];
}

export interface Group {
  id: string | null; name: string; sold: number; revenue_cents: number; profit_cents: number;
  avg_days: number | null; avg_cost_cents: number | null; stock: number; stock_cost_cents: number;
}

export type Tone = "urgent" | "high" | "normal" | "info";
export interface AdviceItem { id: string; sku: string; label: string; extra?: string }
export interface Advice {
  id: string;
  tone: Tone;
  title: string;
  detail: string;
  /** money at stake, to rank advice and show what it is worth */
  impactCents?: number;
  impactLabel?: string;
  href?: string;
  hrefLabel?: string;
  /** items concerned: shown in a list, and can be raised to high priority on the production board */
  items?: AdviceItem[];
  prioritize?: boolean;
  score: number;
}

export type Verdict = "buy" | "avoid" | "slow" | "ok" | "few";
export interface Ranked {
  name: string; sold: number; profitPerItemCents: number | null; profitPerDayCents: number | null; avgDays: number | null;
  stock: number; stockCostCents: number; sellThroughPct: number | null; verdict: Verdict; profitCents: number;
}

export interface AdviceResult {
  tasks: Advice[];
  advice: Advice[];
  insights: Advice[];
  brands: Ranked[];
  categories: Ranked[];
  sizes: Ranked[];
  bands: (Ranked & { band: number })[];
  suppliers: Facts["suppliers"];
  reference: { profitPerItemCents: number | null; avgDays: number | null; sold: number };
}

// ── thresholds (also explained on the page)
export const MIN_SAMPLE = 3; // a brand / size / band needs 3 sales before it is judged
const BUY_FACTOR = 1.2; // ≥ 20 % more profit per item than average
const AVOID_FACTOR = 0.4; // ≤ 40 % of the average profit per item
const SHIP_LATE_HOURS = 24;
const RESERVED_DAYS = 3;
const QUEUE_LATE_DAYS = 7;
const SYNC_STALE_DAYS = 7;

const euro0 = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
export const eur = (cents: number | null | undefined) => (cents == null ? "—" : euro0.format(Math.round(cents / 100)));
const days = (d: number | null | undefined) => (d == null ? "—" : `${d < 10 ? (Math.round(d * 10) / 10).toLocaleString("fr-FR") : Math.round(d)} j`);
/** euros with cents, for small amounts such as a margin per day */
export const eur2 = (cents: number | null | undefined) => (cents == null ? "—" : `${(cents / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
const pctFr = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v)} %`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;
const score = (tone: Tone, impactCents = 0) => ({ urgent: 4000, high: 3000, normal: 2000, info: 1000 }[tone]) + Math.min(999, Math.max(0, impactCents / 100));
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const DOW = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
export const BAND_LABEL = ["moins de 20 €", "20 à 40 €", "40 à 60 €", "60 à 100 €", "100 € et plus"];

/** Suggested price for an item that does not sell: 15 % off, but never under cost + fees + 1 € */
export function suggestedPrice(f: Facts, price: number | null, cost: number): number | null {
  if (price == null) return null;
  const floor = Math.ceil((cost + f.fee_fixed_cents + f.ship_avg_cents + 100) / (1 - f.fee_pct / 100) / 100) * 100;
  const target = Math.round((price * 0.85) / 100) * 100;
  return Math.min(price, Math.max(target, floor));
}

function rank(g: { sold: number; profit_cents: number; avg_days: number | null; stock: number; stock_cost_cents?: number }, name: string,
  ref: { ppi: number | null; days: number | null }): Ranked {
  const ppi = g.sold > 0 ? g.profit_cents / g.sold : null;
  const ppd = ppi != null && g.avg_days ? ppi / Math.max(g.avg_days, 1) : null;
  const st = g.sold + g.stock > 0 ? Math.round((g.sold * 100) / (g.sold + g.stock)) : null;
  let verdict: Verdict = "ok";
  if (g.sold < MIN_SAMPLE) verdict = "few";
  else if (ppi != null && ref.ppi != null) {
    const fast = ref.days == null || g.avg_days == null || g.avg_days <= ref.days * 1.1;
    if (ppi <= 0 || ppi <= ref.ppi * AVOID_FACTOR || (g.stock >= 5 && st != null && st < 25)) verdict = "avoid";
    else if (ppi >= ref.ppi * BUY_FACTOR) verdict = fast ? "buy" : "slow";
  }
  return { name, sold: g.sold, profitPerItemCents: ppi, profitPerDayCents: ppd, avgDays: g.avg_days, stock: g.stock,
    stockCostCents: g.stock_cost_cents ?? 0, sellThroughPct: st, verdict, profitCents: g.profit_cents };
}

const byValue = (a: Ranked, b: Ranked) =>
  (b.verdict === "few" ? -1 : 0) - (a.verdict === "few" ? -1 : 0) || (b.profitPerDayCents ?? -1e9) - (a.profitPerDayCents ?? -1e9) || b.sold - a.sold;

/** Declaration period that is due this month, if any (micro-entreprise: by the end of the following month / quarter month) */
function declarationDue(f: Facts, now: Date, quarterly: boolean) {
  const y = now.getFullYear(), m = now.getMonth();
  if (quarterly && m % 3 !== 0) return null;
  const months = quarterly ? [m - 3, m - 2, m - 1] : [m - 1];
  const keys = months.map((k) => { const d = new Date(y, k, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
  const rows = f.turnover.filter((t) => keys.includes(t.month.slice(0, 7)));
  const due = new Date(y, m + 1, 0);
  const label = quarterly ? `du ${Math.floor(((m + 11) % 12) / 3) + 1}e trimestre` : `de ${MONTHS[(m + 11) % 12]}`;
  return {
    label, due,
    daysLeft: Math.ceil((due.getTime() - now.getTime()) / 86_400_000),
    turnover: rows.reduce((s, r) => s + Number(r.turnover_cents), 0),
    contributions: rows.reduce((s, r) => s + Number(r.contributions_cents), 0),
  };
}

export function buildAdvice(f: Facts, now = new Date(), quarterly = false): AdviceResult {
  const tasks: Advice[] = [];
  const advice: Advice[] = [];
  const insights: Advice[] = [];
  const q = (k: keyof Facts["queues"]) => f.queues[k] ?? { n: 0, oldest_days: 0 };
  const ref = {
    ppi: f.totals.sold > 0 ? f.totals.profit_cents / f.totals.sold : null,
    days: f.totals.avg_days,
  };

  // ───────────────────────── Tasks: what to do now ─────────────────────────
  if (f.to_ship.orders > 0) {
    const late = (f.to_ship.oldest_hours ?? 0) >= SHIP_LATE_HOURS;
    tasks.push({
      id: "ship", tone: late ? "urgent" : "high",
      title: `Expédier ${plural(f.to_ship.orders, "commande")}`,
      detail: late
        ? `La plus ancienne attend depuis ${days((f.to_ship.oldest_hours ?? 0) / 24)}. Vinted annule une commande non expédiée sous 5 jours ouvrés et un envoi rapide fait les bonnes évaluations.`
        : "Des acheteurs attendent leur colis : un envoi dans la journée fait les bonnes évaluations.",
      href: "/postes/expedition", hrefLabel: "Ouvrir l'expédition", score: score(late ? "urgent" : "high"),
    });
  }

  const decl = declarationDue(f, now, quarterly);
  if (decl && decl.daysLeft >= 0 && decl.daysLeft <= 15 && decl.turnover > 0) {
    const tone: Tone = decl.daysLeft <= 5 ? "urgent" : "high";
    tasks.push({
      id: "urssaf", tone,
      title: `Déclarer le chiffre d'affaires ${decl.label} à l'URSSAF`,
      detail: `${eur(decl.turnover)} encaissés, environ ${eur(decl.contributions)} de cotisations. À faire avant le ${decl.due.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })} (dans ${plural(decl.daysLeft, "jour")}), si ce n'est pas déjà fait.`,
      href: "/compta", hrefLabel: "Voir la compta", score: score(tone),
    });
  }

  if (f.reserved_long_n > 0) {
    tasks.push({
      id: "reserved", tone: "high",
      title: `Relancer ${plural(f.reserved_long_n, "réservation")} de plus de ${RESERVED_DAYS} jours`,
      detail: "Un article réservé sans paiement est bloqué pour les autres acheteurs. Relancez l'acheteur sur Vinted ou remettez l'article en vente.",
      items: f.reserved_long.map((r) => ({ id: r.id, sku: r.sku, label: r.brand ?? "", extra: `réservé depuis ${days(r.days)}` })),
      href: "/stock?status=reserved", hrefLabel: "Voir les réservés", score: score("high"),
    });
  }

  if (f.ready.n > 0) {
    const value = f.ready.value_cents;
    const best = f.ready_best.filter((r) => (r.expected_profit_cents ?? 0) > 0).slice(0, 20);
    tasks.push({
      id: "publish", tone: q("listing_ready").oldest_days > QUEUE_LATE_DAYS ? "high" : "normal",
      title: `Publier ${plural(f.ready.n, "article prêt", "articles prêts")}`,
      detail: `Un article qui n'est pas en ligne ne se vend pas${value ? ` : ${eur(value)} de prix affichés attendent` : ""}.${best.length ? " Commencez par les plus rentables (marge attendue ci-dessous) : un clic les passe en priorité haute dans Production." : ""}${f.ready_no_price ? ` ${plural(f.ready_no_price, "article n'a", "articles n'ont")} pas encore de prix.` : ""}`,
      items: best.map((r) => ({ id: r.id, sku: r.sku, label: [r.brand, r.title].filter(Boolean).join(" · "), extra: `≈ ${eur(r.expected_profit_cents)} de marge` })),
      prioritize: best.length > 0,
      impactCents: value,
      href: "/postes/publication", hrefLabel: "Ouvrir la publication",
      score: score(q("listing_ready").oldest_days > QUEUE_LATE_DAYS ? "high" : "normal", value),
    });
  }

  if (f.blocked.n > 0) {
    tasks.push({
      id: "blocked", tone: (f.blocked.oldest_days ?? 0) > 2 ? "high" : "normal",
      title: `Débloquer ${plural(f.blocked.n, "article bloqué", "articles bloqués")}`,
      detail: `Le plus ancien est bloqué depuis ${days(f.blocked.oldest_days)}. Un article bloqué ne progresse plus dans la chaîne.`,
      href: "/postes/production?bloques=1", hrefLabel: "Voir dans Production", score: score((f.blocked.oldest_days ?? 0) > 2 ? "high" : "normal"),
    });
  }

  // production backlog: the step whose oldest item waits the longest
  const steps: [keyof Facts["queues"], string, string][] = [
    ["received", "trier", "/postes/production"], ["sorted", "photographier", "/postes/photo"],
    ["photographed", "mesurer", "/postes/photo"], ["measured", "ranger", "/postes/rangement"],
  ];
  const late = steps.map(([k, verb, href]) => ({ k, verb, href, ...q(k) })).filter((s) => s.n > 0 && s.oldest_days > QUEUE_LATE_DAYS)
    .sort((a, b) => b.oldest_days - a.oldest_days)[0];
  if (late) {
    tasks.push({
      id: `queue-${late.k}`, tone: "normal",
      title: `${plural(late.n, "article")} à ${late.verb}, le plus ancien depuis ${days(late.oldest_days)}`,
      detail: "C'est l'étape de production la plus en retard : chaque jour d'attente retarde la mise en vente.",
      href: late.href, hrefLabel: "Ouvrir le poste", score: score("normal"),
    });
  }

  if (f.to_label > 0) {
    tasks.push({
      id: "label", tone: "normal", title: `Étiqueter ${plural(f.to_label, "article importé", "articles importés")} de Vinted`,
      detail: "Sans étiquette ni emplacement, ces articles sont longs à retrouver au moment de l'expédition.",
      href: "/emplacements/EMP-A-ETIQUETER", hrefLabel: "Voir les articles", score: score("normal"),
    });
  }

  for (const b of f.batches_incomplete.slice(0, 3)) {
    tasks.push({
      id: `batch-${b.id}`, tone: "normal", title: `Finir la réception du lot ${b.code}`,
      detail: `${b.received} articles traités sur ${b.expected} attendus. Les articles non réceptionnés ne sont ni comptés ni vendables.`,
      href: `/lots/${b.id}`, hrefLabel: "Ouvrir le lot", score: score("normal"),
    });
  }

  const syncAge = f.last_vinted_sync ? (now.getTime() - new Date(f.last_vinted_sync).getTime()) / 86_400_000 : null;
  if (syncAge != null && syncAge > SYNC_STALE_DAYS) {
    tasks.push({
      id: "sync", tone: "normal", title: "Synchroniser Vinted",
      detail: `Dernière synchronisation il y a ${days(syncAge)} : les ventes et réservations faites sur Vinted ne sont peut-être pas à jour ici.`,
      href: "/parametres", hrefLabel: "Extension Vinted", score: score("normal"),
    });
  }

  // ───────────────────────── Advice: money ─────────────────────────
  if (f.dormant.n > 0) {
    const cost = f.dormant.cost_cents;
    advice.push({
      id: "dormant", tone: "high",
      title: `Relancer ${plural(f.dormant.n, "article", "articles")} en ligne depuis plus de ${f.dead_days} jours`,
      detail: `${eur(cost)} d'achat immobilisés. Baissez le prix d'environ 15 % (prix conseillé ci-dessous, jamais sous votre coût + frais) ou supprimez puis republiez l'annonce pour la faire remonter.`,
      impactCents: cost, impactLabel: "argent immobilisé",
      items: f.dormant_items.map((d) => {
        const s = suggestedPrice(f, d.price_cents, d.cost_cents);
        return { id: d.id, sku: d.sku, label: [d.brand, d.size && `T${d.size}`].filter(Boolean).join(" · "),
          extra: `${days(d.days)} en ligne · ${eur(d.price_cents)}${s != null && s < (d.price_cents ?? 0) ? ` → ${eur(s)}` : ""}` };
      }),
      href: "/stock?status=listed", hrefLabel: "Voir le stock en ligne", score: score("high", cost),
    });
  }

  if (f.below_cost.n > 0) {
    const loss = f.below_cost.loss_cents;
    advice.push({
      id: "below-cost", tone: "high",
      title: `${plural(f.below_cost.n, "article affiché", "articles affichés")} à un prix qui fait perdre de l'argent`,
      detail: `Une fois les frais Vinted et l'envoi moyen (${eur(f.ship_avg_cents)}) payés, la vente ne couvre pas le prix d'achat. Remontez le prix ou acceptez la perte en connaissance de cause.`,
      impactCents: loss, impactLabel: "perte si vendus à ce prix",
      items: f.below_cost.items.map((b) => ({ id: b.id, sku: b.sku, label: b.brand ?? "", extra: `${eur(b.price_cents)} affiché · net ${eur(b.net_cents)} · coût ${eur(b.cost_cents)}` })),
      score: score("high", loss),
    });
  }

  if (f.underpriced.n > 0) {
    const gain = f.underpriced.gain_cents;
    advice.push({
      id: "underpriced", tone: "normal",
      title: `${plural(f.underpriced.n, "article probablement trop bon marché", "articles probablement trop bon marché")}`,
      detail: "Leur prix est 30 % sous le prix moyen auquel la même marque s'est vendue chez vous (au moins 3 ventes). Un prix plus proche de ce repère rapporterait davantage.",
      impactCents: Math.round(gain), impactLabel: "marge supplémentaire possible",
      items: f.underpriced.items.map((u) => ({ id: u.id, sku: u.sku, label: u.brand ?? "", extra: `${eur(u.price_cents)} · la marque se vend ${eur(u.brand_avg_cents)} (${u.brand_sales} ventes)` })),
      score: score("normal", gain),
    });
  }

  const brands = f.brands.map((b) => rank(b, b.name, ref)).sort(byValue);
  const categories = f.categories.map((c) => rank(c, c.name, ref)).sort(byValue);
  const sizes = f.sizes.map((s) => rank(s, s.name, ref)).sort(byValue);
  const bands = f.price_bands.map((b) => ({ ...rank({ ...b, stock: 0 }, BAND_LABEL[b.band], ref), band: b.band })).sort((a, b) => a.band - b.band);
  const monthly = (sold: number) => (f.totals.sold_90d > 0 ? sold / Math.max(1, f.totals.sold) * (f.totals.sold_90d / 3) : 0);

  const named = new Set(f.brands.filter((b) => b.id && !/^sans marque$/i.test(b.name.trim())).map((b) => b.name));
  const buy = brands.filter((b) => b.verdict === "buy" && named.has(b.name)).slice(0, 3);
  if (buy.length && ref.ppi != null) {
    const extra = buy.reduce((s, b) => s + ((b.profitPerItemCents ?? 0) - (ref.ppi ?? 0)) * Math.max(1, monthly(b.sold)), 0);
    advice.push({
      id: "buy-brands", tone: "normal",
      title: `Achetez davantage : ${buy.map((b) => b.name).join(", ")}`,
      detail: buy.map((b) => `${b.name} : ${eur(b.profitPerItemCents)} de marge par article, vendu en ${days(b.avgDays)} (${b.sold} ventes, ${b.stock} en stock)`).join(" · ")
        + `. Votre moyenne : ${eur(ref.ppi)} par article en ${days(ref.days)}.`,
      impactCents: Math.round(extra), impactLabel: "marge en plus par mois à volume égal", href: "#marques", hrefLabel: "Voir le classement",
      score: score("normal", extra),
    });
  }
  const avoid = brands.filter((b) => b.verdict === "avoid" && named.has(b.name)).slice(0, 3);
  if (avoid.length) {
    const tied = avoid.reduce((s, b) => s + b.stockCostCents, 0);
    advice.push({
      id: "avoid-brands", tone: "normal",
      title: `Achetez moins (ou moins cher) : ${avoid.map((b) => b.name).join(", ")}`,
      detail: avoid.map((b) => `${b.name} : ${eur(b.profitPerItemCents)} par article, ${pctFr(b.sellThroughPct)} écoulé, ${b.stock} en stock`).join(" · ")
        + ". Ces marques rapportent peu ou s'écoulent mal : à ne prendre qu'à petit prix.",
      impactCents: tied, impactLabel: "encore en stock (prix d'achat)", href: "#marques", hrefLabel: "Voir le classement",
      score: score("normal", tied),
    });
  }

  const cat = categories.filter((c) => c.verdict !== "few" && c.profitPerDayCents != null);
  if (cat.length >= 2) {
    const [top, last] = [cat[0], cat[cat.length - 1]];
    insights.push({
      id: "categories", tone: "info",
      title: `${top.name} est votre catégorie la plus rentable`,
      detail: `${eur(top.profitPerItemCents)} de marge par article en ${days(top.avgDays)}, soit ${eur2(top.profitPerDayCents)} par jour de stock, contre ${eur2(last.profitPerDayCents)} pour ${last.name}.`,
      href: "#categories", hrefLabel: "Voir le détail", score: score("info"),
    });
  }

  const sup = f.suppliers.filter((s) => s.items >= 10 && s.roi_pct != null).sort((a, b) => (b.roi_pct ?? 0) - (a.roi_pct ?? 0));
  if (sup.length >= 2) {
    const [best, worst] = [sup[0], sup[sup.length - 1]];
    // a lot still being sold is not yet paid back: a supplier is only judged once most of its items are sold
    const losing = (worst.roi_pct ?? 0) < 0 && (worst.sell_through_pct ?? 0) >= 70;
    const line = (s: Facts["suppliers"][number]) => `${s.name} : ${pctFr(s.roi_pct)} de retour sur ce que vous avez payé, ${pctFr(s.sell_through_pct)} des articles vendus`;
    advice.push({
      id: "suppliers", tone: losing ? "normal" : "info",
      title: (best.roi_pct ?? 0) > 0 ? `Fournisseur le plus rentable : ${best.name}` : "Aucun fournisseur n'est encore remboursé",
      detail: `${line(best)}. ${line(worst)}.${losing ? ` ${worst.name} fait perdre de l'argent alors que la plupart de ses articles sont vendus : à renégocier ou à remplacer.` : " Le retour compte tout ce qui a été payé, invendus compris : il monte à mesure que les lots se vendent."}`,
      href: "/fournisseurs", hrefLabel: "Voir les fournisseurs", score: score(losing ? "normal" : "info"),
    });
  }

  const bestBand = bands.filter((b) => b.verdict !== "few" && b.profitPerDayCents != null).sort((a, b) => (b.profitPerDayCents ?? 0) - (a.profitPerDayCents ?? 0))[0];
  if (bestBand) {
    insights.push({
      id: "band", tone: "info",
      title: `Les articles revendus ${bestBand.name} rapportent le plus par jour`,
      detail: `${eur(bestBand.profitPerItemCents)} de marge par article en ${days(bestBand.avgDays)} (${bestBand.sold} ventes). Visez ce niveau de prix à l'achat.`,
      href: "#prix", hrefLabel: "Voir les tranches", score: score("info"),
    });
  }

  // sizes: much more of it in stock than it sells
  const totalSold = f.sizes.reduce((s, x) => s + x.sold, 0), totalStock = f.sizes.reduce((s, x) => s + x.stock, 0);
  const over = f.sizes.filter((s) => s.stock >= 5 && totalSold > 0 && totalStock > 0 && s.stock / totalStock > 2 * Math.max(s.sold / totalSold, 0.02))
    .sort((a, b) => b.stock - a.stock)[0];
  if (over) {
    advice.push({
      id: "size-over", tone: "normal",
      title: `Trop de taille ${over.name} en stock`,
      detail: `${Math.round((over.stock * 100) / totalStock)} % de votre stock mais ${Math.round((over.sold * 100) / totalSold)} % de vos ventes. Achetez moins cette taille tant que le stock n'a pas baissé.`,
      href: "#tailles", hrefLabel: "Voir les tailles", score: score("normal"),
    });
  }
  const fastSize = sizes.filter((s) => s.verdict !== "few" && s.avgDays != null && ref.days != null && s.avgDays < ref.days * 0.8 && s.stock <= 2)[0];
  if (fastSize) {
    insights.push({
      id: "size-fast", tone: "info",
      title: `La taille ${fastSize.name} part vite et il en reste peu`,
      detail: `Vendue en ${days(fastSize.avgDays)} en moyenne (vous : ${days(ref.days)}), ${fastSize.stock} en stock : à rechercher dans vos prochains achats.`,
      href: "#tailles", hrefLabel: "Voir les tailles", score: score("info"),
    });
  }

  // fees
  if (f.fees_90d.revenue_cents > 0) {
    const ship = f.fees_90d.shipping_cents + f.fees_90d.packaging_cents;
    const pct = (ship * 100) / f.fees_90d.revenue_cents;
    if (pct >= 10) {
      advice.push({
        id: "shipping", tone: "normal",
        title: `L'envoi et l'emballage coûtent ${Math.round(pct)} % de vos ventes`,
        detail: `${eur(ship)} sur 90 jours pour ${plural(f.fees_90d.orders, "commande")}. Faites payer le port à l'acheteur (option Vinted) et réutilisez les emballages : c'est de la marge directe.`,
        impactCents: Math.round(ship / 3), impactLabel: "par mois", score: score("normal", ship / 3),
      });
    }
  }

  if (f.discount.n >= 5 && (f.discount.avg_pct ?? 0) >= 10) {
    insights.push({
      id: "discount", tone: "info",
      title: `Vous acceptez en moyenne ${Math.round(f.discount.avg_pct ?? 0)} % de rabais`,
      detail: `Sur ${f.discount.n} ventes récentes, le prix payé est en moyenne ${Math.round(f.discount.avg_pct ?? 0)} % sous le prix affiché. Affichez un peu plus haut pour garder de la marge après les offres.`,
      score: score("info"),
    });
  }

  const t = f.trend;
  if (t.prev_n >= 3 && t.prev_profit_cents > 0) {
    const change = ((t.last_profit_cents - t.prev_profit_cents) * 100) / t.prev_profit_cents;
    if (Math.abs(change) >= 20) {
      (change < 0 ? advice : insights).push({
        id: "trend", tone: change < 0 ? "high" : "info",
        title: change < 0 ? `Marge en baisse de ${Math.round(-change)} % sur 30 jours` : `Marge en hausse de ${Math.round(change)} % sur 30 jours`,
        detail: `${eur(t.last_profit_cents)} sur les 30 derniers jours (${plural(t.last_n, "vente")}) contre ${eur(t.prev_profit_cents)} les 30 jours d'avant (${plural(t.prev_n, "vente")}).${change < 0 ? " Vérifiez le nombre d'articles en ligne et les prix : c'est souvent le stock publié qui manque." : ""}`,
        score: score(change < 0 ? "high" : "info"),
      });
    }
  }

  if (f.stock.offline_n > 0 && f.stock.offline_cost_cents > 0) {
    insights.push({
      id: "offline", tone: "info",
      title: `${eur(f.stock.offline_cost_cents)} de stock pas encore en ligne`,
      detail: `${plural(f.stock.offline_n, "article")} payés mais pas encore publiés (en production ou prêts). Plus la chaîne va vite, plus l'argent revient vite.`,
      href: "/postes/production", hrefLabel: "Ouvrir Production", score: score("info", f.stock.offline_cost_cents),
    });
  }

  const totalWd = f.weekdays.reduce((s, w) => s + w.n, 0);
  const topWd = [...f.weekdays].sort((a, b) => b.n - a.n)[0];
  if (topWd && totalWd >= 10 && topWd.n / totalWd >= 0.2) {
    insights.push({
      id: "weekday", tone: "info",
      title: `Vous vendez le plus le ${DOW[topWd.dow - 1]}`,
      detail: `${Math.round((topWd.n * 100) / totalWd)} % de vos ventes des 6 derniers mois. Publiez vos meilleurs articles la veille ou le matin même.`,
      score: score("info"),
    });
  }

  const sort = (a: Advice, b: Advice) => b.score - a.score;
  return {
    tasks: tasks.sort(sort), advice: advice.sort(sort), insights: insights.sort(sort),
    brands, categories, sizes, bands, suppliers: f.suppliers,
    reference: { profitPerItemCents: ref.ppi, avgDays: ref.days, sold: f.totals.sold },
  };
}
