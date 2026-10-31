// Annonces en préparation: the measurements pasted for many SKUs split into one block per SKU, and the shop's model
// filled with what is known of an article. No dependency: used by the page, the server actions and the tests.

export const DEFAULT_TITLE = "{categorie} {marque} {couleur} {taille}";
export const DEFAULT_DESCRIPTION = `{categorie} {marque}

Taille : {taille}
État : {etat}
Couleur : {couleur}
Matière : {matiere}
Défauts : {defauts}

Mesures à plat :
{mesures}

Réf. {sku}`;

/** the words a model may contain, with what they become */
export const PLACEHOLDERS: { key: string; label: string }[] = [
  { key: "sku", label: "SKU" },
  { key: "categorie", label: "catégorie" },
  { key: "marque", label: "marque" },
  { key: "taille", label: "taille" },
  { key: "etat", label: "état" },
  { key: "couleur", label: "couleur" },
  { key: "motif", label: "motif" },
  { key: "matiere", label: "matière" },
  { key: "defauts", label: "défauts" },
  { key: "mesures", label: "vos mesures" },
  { key: "prix", label: "prix" },
];

const norm = (s: string) => s.trim().toUpperCase();
const SEP = /[\s:;,|()[\]{}«»"'=]+/;

export interface MeasureSplit {
  /** SKU (as written in the drafts) → its lines */
  blocks: Map<string, string>;
  /** text before the first SKU: belongs to no article */
  orphan: string[];
}

/**
 * Pasted text with every SKU's measurements: a line naming a known SKU starts that SKU's block, the lines after it
 * belong to it until the next SKU. What follows the SKU on its own line (« A-12 : épaules 45 ») is kept.
 */
export function splitMeasures(text: string, skus: string[]): MeasureSplit {
  const known = new Map(skus.map((s) => [norm(s), s]));
  const blocks = new Map<string, string[]>();
  const orphan: string[] = [];
  let current: string | null = null;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const tokens = line.split(SEP).filter(Boolean);
    const hit = tokens.find((t) => known.has(norm(t)));
    if (hit) {
      current = known.get(norm(hit))!;
      if (!blocks.has(current)) blocks.set(current, []);
      const esc = hit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rest = line.replace(new RegExp(`[\\[({«"']*${esc}[\\])}»"']*`), "").replace(/^[\s:;,|\-–—=]+/, "").trim();
      if (rest) blocks.get(current)!.push(rest);
      continue;
    }
    if (current) blocks.get(current)!.push(line);
    else if (line.trim()) orphan.push(line.trim());
  }
  const out = new Map<string, string>();
  for (const [sku, lines] of blocks) out.set(sku, tidy(lines.join("\n")));
  return { blocks: out, orphan };
}

/** no blank lines at the ends, never more than one in a row */
export function tidy(s: string): string {
  return s.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}

export type Fields = Partial<Record<string, string | null | undefined>>;

/**
 * The model with its {words} replaced. A line whose words are all unknown disappears (« Défauts : {defauts} » for an
 * article without defects), so the model can list everything the shop may know.
 */
export function fillTemplate(template: string, fields: Fields): string {
  const value = (k: string) => {
    const v = fields[k.toLowerCase()];
    return v == null ? "" : String(v).trim();
  };
  const lines = template.replace(/\r\n?/g, "\n").split("\n").flatMap((line) => {
    const keys = [...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    if (keys.length && keys.every((k) => !value(k))) return [];
    return [line.replace(/\{(\w+)\}/g, (_, k: string) => value(k)).replace(/ {2,}/g, " ").replace(/ +([,.])(?=\s|$)/g, "$1")];
  });
  return tidy(lines.join("\n"));
}

/** a title on one line, without spaces left by missing words */
export function fillTitle(template: string, fields: Fields): string {
  return fillTemplate(template.replace(/\n/g, " "), fields).replace(/\s+/g, " ").replace(/^[\s\-–—·,]+|[\s\-–—·,]+$/g, "").trim();
}

const CONDITION: Record<string, string> = {
  new_with_tags: "Neuf avec étiquette", new_without_tags: "Neuf sans étiquette", very_good: "Très bon état", good: "Bon état", satisfactory: "Satisfaisant",
};

export interface DraftContext {
  sku: string;
  item: null | {
    categorie: string | null; marque: string | null; taille: string | null; taille_pantalon: string | null; etat: string | null;
    couleur: string | null; motif: string | null; matiere: string | null; defauts: string | null; prix_cents: number | null;
    mesures: { label: string; mm: number }[];
  };
}

const cmText = (mm: number) => `${(mm / 10).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} cm`;

/** the words of the model for one article: the stock's data, and the measurements pasted (else the stock's) */
export function fieldsOf(ctx: DraftContext, measures: string, priceCents: number | null): Fields {
  const i = ctx.item;
  const stockMeasures = i?.mesures.length ? i.mesures.map((m) => `• ${m.label} : ${cmText(m.mm)}`).join("\n") : "";
  const size = i?.taille ? (i.taille_pantalon ? `${i.taille} (pantalon ${i.taille_pantalon})` : i.taille) : null;
  const price = priceCents ?? i?.prix_cents ?? null;
  return {
    sku: ctx.sku,
    categorie: i?.categorie, marque: i?.marque,
    taille: size ? (/^\d/.test(size) ? `T${size}` : size) : null,
    etat: i?.etat ? CONDITION[i.etat] ?? i.etat : null,
    couleur: i?.couleur?.toLowerCase(), motif: i?.motif?.toLowerCase(), matiere: i?.matiere?.toLowerCase(), defauts: i?.defauts,
    mesures: measures.trim() || stockMeasures,
    prix: price ? `${(price / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} €` : null,
  };
}

/** in the title the size reads « T50 », in the description « 50 » */
export function descriptionFields(f: Fields): Fields {
  return { ...f, taille: f.taille?.replace(/^T(?=\d)/, "") ?? null };
}

export const TITLE_MAX = 100;
