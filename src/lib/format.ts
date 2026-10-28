const eur = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeZone: "Europe/Paris" });
const dateTimeFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Paris" });

/** Today in Paris as YYYY-MM-DD (the server runs in UTC: between midnight and 2 a.m. its date is still yesterday) */
export const parisToday = (now = new Date()) =>
  new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

export const money = (cents: number | null | undefined) => (cents == null ? "—" : eur.format(cents / 100));
export const date = (iso: string | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : "—");
export const dateTime = (iso: string | null | undefined) => (iso ? dateTimeFmt.format(new Date(iso)) : "—");
export const pct = (v: number | null | undefined) => (v == null ? "—" : `${String(v).replace(".", ",")} %`);
export const cm = (mm: number | null | undefined) => (mm == null ? "—" : `${(mm / 10).toLocaleString("fr-FR")} cm`);

/** "45,50" / "45.5" / "45" → 4550 */
export function parseEuros(input: string): number | null {
  const n = Number(input.replace(/\s|€/g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

export const eurosInput = (cents: number | null | undefined) =>
  cents == null ? "" : (cents / 100).toFixed(2).replace(".", ",").replace(/,00$/, "");

/** Days elapsed since an ISO date */
export const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
