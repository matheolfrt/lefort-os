// Commands typed in the ⌘K palette, in plain French:
//   « M-12 29 », « baisser M-12 à 29,90 € »      → new price
//   « ranger M-5 en A-01-02 », « M-5 → A-01-02 » → move to a location
//   « vendre M-12 »                               → open a sale with the item
//   « en ligne M-12 », « mettre en vente M-12 »   → put on sale
//   « étiquette M-12 »                            → print its label

export type Command =
  | { kind: "price"; sku: string; cents: number }
  | { kind: "move"; sku: string; location: string }
  | { kind: "sell"; sku: string }
  | { kind: "list"; sku: string }
  | { kind: "label"; sku: string };

const SKU = "([A-Za-z]{1,6}-?\\d{1,8})";
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const money = (s: string) => {
  const v = Number(s.replace(",", "."));
  return Number.isFinite(v) && v > 0 && v < 100000 ? Math.round(v * 100) : null;
};

export function parseCommand(input: string): Command | null {
  const q = norm(input);
  if (!q) return null;
  let m: RegExpMatchArray | null;

  if ((m = q.match(new RegExp(`^(?:vendre|vente|vendu)\\s+${SKU}$`)))) return { kind: "sell", sku: m[1].toUpperCase() };
  if ((m = q.match(new RegExp(`^(?:etiquette|etiquettes|imprimer)\\s+${SKU}$`)))) return { kind: "label", sku: m[1].toUpperCase() };
  if ((m = q.match(new RegExp(`^(?:en ligne|mettre en vente|mise en vente|publier)\\s+${SKU}$`)))) return { kind: "list", sku: m[1].toUpperCase() };

  // a location: an explicit verb or connector, then a code (A-01-02, EMP-PORTANT-HIVER)
  if ((m = q.match(new RegExp(`^(?:ranger|deplacer|mettre|bouger)?\\s*${SKU}\\s+(?:en|dans|vers|sur|->|→)\\s+(?:emp-)?([a-z0-9][a-z0-9-]*)$`)))) {
    const loc = m[2].toUpperCase();
    // « M-12 en 29 » is not a location
    if (!/^\d+([.,]\d+)?$/.test(m[2])) return { kind: "move", sku: m[1].toUpperCase(), location: `EMP-${loc}` };
  }

  // a price: « M-12 29 », « prix M-12 29 € », « baisser M-12 à 29,90 »
  if ((m = q.match(new RegExp(`^(?:prix|baisser|monter|passer|mettre)?\\s*${SKU}\\s+(?:a|à|=|->|→)?\\s*(\\d+(?:[.,]\\d{1,2})?)\\s*(?:€|eur|euros)?$`)))) {
    const cents = money(m[2]);
    if (cents != null) return { kind: "price", sku: m[1].toUpperCase(), cents };
  }
  return null;
}
