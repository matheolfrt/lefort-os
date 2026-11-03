// A listing's measurement text (« Épaules : 45 cm ») turned into the stock's measurements: each line is matched to
// one of the article's measurement names, and kept only within that measurement's limits. No dependency.

export interface Definition { id: string; key: string; label: string; min_mm: number; max_mm: number }
export interface MeasureLine { label: string; mm: number }

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** « • Épaules : 45,5 cm », « Longueur dos 72cm », « Tour de taille - 420 mm » → label and millimetres */
export function parseMeasureLines(text: string): MeasureLine[] {
  const out: MeasureLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    // the name and the number are apart (« Épaules 45 », « Épaules : 45 », « Épaules - 45 »), not glued like a code
    // (« LSH1 », « CSV-0001 »)
    const m = raw.match(/^[\s•\-*·]*([^\d:：=]*[^\d\s:：=])(?:\s*[:：=]\s*|\s+[-–]\s+|\s+)(\d+(?:[.,]\d+)?)\s*(cm|mm)?\s*\.?\s*$/i);
    if (!m) continue;
    const label = m[1].replace(/[\s:：=\-–]+$/, "").trim();
    const n = Number(m[2].replace(",", "."));
    if (!label || !Number.isFinite(n) || n <= 0) continue;
    out.push({ label, mm: Math.round((m[3]?.toLowerCase() === "mm" ? n : n * 10)) });
  }
  return out;
}

/** The measurements a label may name: same name (or key), else those whose name holds the label (or the reverse) */
function candidates(label: string, defs: Definition[]): Definition[] {
  const l = fold(label);
  const same = defs.filter((d) => fold(d.label) === l || fold(d.key) === l);
  if (same.length) return same;
  return defs.filter((d) => { const f = fold(d.label); return f.length >= 4 && l.length >= 4 && (l.includes(f) || f.includes(l)); });
}

/** The one measurement a label names, or null (none, or several) */
export function findDefinition(label: string, defs: Definition[]): Definition | null {
  const c = candidates(label, defs);
  return c.length === 1 ? c[0] : null;
}

export interface Matched { saved: { definition_id: string; label: string; mm: number }[]; skipped: { label: string; reason: string }[] }

export function matchMeasures(text: string, defs: Definition[]): Matched {
  const res: Matched = { saved: [], skipped: [] };
  const seen = new Set<string>();
  for (const line of parseMeasureLines(text)) {
    const c = candidates(line.label, defs);
    if (c.length !== 1) {
      res.skipped.push({ label: line.label, reason: c.length ? `plusieurs mesures possibles : ${c.map((x) => x.label).join(", ")}` : "mesure inconnue pour cette catégorie" });
      continue;
    }
    const d = c[0];
    if (seen.has(d.id)) continue; // the first value of a measurement wins
    if (line.mm < d.min_mm || line.mm > d.max_mm) {
      res.skipped.push({ label: line.label, reason: `hors limites (${d.min_mm / 10}–${d.max_mm / 10} cm)` });
      continue;
    }
    seen.add(d.id);
    res.saved.push({ definition_id: d.id, label: d.label, mm: line.mm });
  }
  return res;
}
