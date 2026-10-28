"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireManager } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { parseEuros, parisToday } from "@/lib/format";
import { errorMessage } from "@/lib/errors";

// Every financial setting lives in the database: these actions are the only way they change. Each one validates,
// writes, refreshes the command center and comes back to its section with a message.

const CATEGORIES = ["rent", "salary", "packaging", "software", "equipment", "transport", "taxes", "other"];
const FREQUENCIES = ["weekly", "monthly", "quarterly", "yearly"];
const PAGE = "/finance/parametres";

function back(anchor: string, err?: string): never {
  revalidatePath("/finance", "layout");
  revalidatePath("/");
  redirect(err ? `${PAGE}?erreur=${encodeURIComponent(err)}&s=${anchor}#${anchor}` : `${PAGE}?ok=${anchor}#${anchor}`);
}
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const int = (fd: FormData, k: string, min: number, max: number) => {
  const n = Number(str(fd, k).replace(",", "."));
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null;
};
const num = (fd: FormData, k: string, min: number, max: number) => {
  const n = Number(str(fd, k).replace(",", "."));
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 10) / 10 : null;
};
/** Signed amount for a bank balance: "-120,50" is allowed */
const signedEuros = (s: string) => {
  const neg = /^\s*[-−]/.test(s);
  const v = parseEuros(s.replace(/^\s*[-−]/, ""));
  return v == null ? null : neg ? -v : v;
};
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T12:00:00Z`).getTime());

export async function declareBalance(fd: FormData) {
  await requireManager();
  const amount = signedEuros(str(fd, "amount"));
  const day = str(fd, "as_of") || parisToday();
  if (amount == null) back("tresorerie", "Montant invalide.");
  if (!isDate(day) || day > parisToday()) back("tresorerie", "La date du solde ne peut pas être dans le futur.");
  // a balance declared for today is as of now; for a past day, as of the end of that day (Paris)
  const asOf = day === parisToday() ? new Date().toISOString() : new Date(`${day}T23:59:00+01:00`).toISOString();
  const supabase = await createClient();
  const { error } = await supabase.from("cash_balances").insert({ amount_cents: amount, as_of: asOf, note: str(fd, "note").slice(0, 300) || null });
  if (error) back("tresorerie", errorMessage(error));
  back("tresorerie");
}

export async function deleteBalance(id: string) {
  await requireManager();
  const supabase = await createClient();
  const { error } = await supabase.from("cash_balances").delete().eq("id", id);
  if (error) back("tresorerie", errorMessage(error));
  back("tresorerie");
}

async function updateOrg(anchor: string, patch: Record<string, unknown>) {
  const ctx = await requireManager();
  const supabase = await createClient();
  const { data, error } = await supabase.from("organizations").update(patch).eq("id", ctx.org.id).select("id");
  if (error) back(anchor, errorMessage(error));
  if (!data?.length) back(anchor, "Seul un administrateur peut modifier ces réglages.");
  back(anchor);
}

export async function saveThresholds(fd: FormData) {
  const reserve = parseEuros(str(fd, "reserve") || "0");
  const liquidation = int(fd, "liquidation", 0, 100);
  const normal = int(fd, "normal", 0, 100), high = int(fd, "high", 0, 100), critical = int(fd, "critical", 0, 100);
  const dead = int(fd, "dead", 1, 730), b1 = int(fd, "b1", 1, 730), b2 = int(fd, "b2", 1, 730);
  const basis = str(fd, "basis");
  if (reserve == null) back("seuils", "Réserve de sécurité invalide.");
  if (liquidation == null) back("seuils", "Le facteur de liquidation va de 0 à 100 %.");
  if (normal == null || high == null || critical == null || !(normal < high && high < critical))
    back("seuils", "Les seuils d'immobilisation doivent aller en croissant (normal < élevé < critique), entre 0 et 100 %.");
  if (dead == null || b1 == null || b2 == null || !(b1 < b2 && b2 < dead))
    back("seuils", "Les tranches d'âge doivent aller en croissant et rester sous le seuil du stock dormant.");
  if (basis !== "listed" && basis !== "received") back("seuils", "Base de l'âge inconnue.");
  await updateOrg("seuils", {
    cash_reserve_cents: reserve, liquidation_pct: liquidation, immob_levels: { normal, high, critical },
    dead_stock_days: dead, aging_bounds: [b1, b2], aging_basis: basis,
  });
}

export async function saveForecast(fd: FormData) {
  const f = {
    window_days: int(fd, "window_days", 7, 365), horizon_days: int(fd, "horizon_days", 7, 365), growth_pct: num(fd, "growth_pct", -50, 100),
    payout_days: int(fd, "payout_days", 0, 60), stock_target_days: int(fd, "stock_target_days", 0, 365),
    variable_cost_pct: num(fd, "variable_cost_pct", 0, 100), analysis_days: int(fd, "analysis_days", 7, 365),
  };
  const bad = Object.entries(f).find(([, v]) => v == null);
  if (bad) back("prevision", "Une hypothèse est hors des limites : vérifiez les valeurs.");
  await updateOrg("prevision", { forecast: f });
}

export async function addRecurring(fd: FormData) {
  await requireManager();
  const label = str(fd, "label"), category = str(fd, "category"), frequency = str(fd, "frequency");
  const amount = parseEuros(str(fd, "amount"));
  const day = int(fd, "day", 1, 28) ?? 1;
  const starts = str(fd, "starts_on") || parisToday(), ends = str(fd, "ends_on") || null;
  if (!label) back("charges", "Donnez un nom à la charge.");
  if (!amount) back("charges", "Montant invalide.");
  if (!CATEGORIES.includes(category) || !FREQUENCIES.includes(frequency)) back("charges", "Catégorie ou fréquence inconnue.");
  if (!isDate(starts) || (ends && (!isDate(ends) || ends < starts))) back("charges", "Dates invalides.");
  const supabase = await createClient();
  const { error } = await supabase.from("recurring_expenses").insert({ label: label.slice(0, 120), category, frequency, amount_cents: amount, day_of_month: day, starts_on: starts, ends_on: ends });
  if (error) back("charges", errorMessage(error));
  back("charges");
}

/** Stopping a charge keeps its past: it ends today rather than disappearing from the months it was paid */
export async function stopRecurring(id: string) {
  await requireManager();
  const supabase = await createClient();
  const { data } = await supabase.from("recurring_expenses").select("starts_on").eq("id", id).single();
  const { error } = data && data.starts_on > parisToday()
    ? await supabase.from("recurring_expenses").delete().eq("id", id)
    : await supabase.from("recurring_expenses").update({ ends_on: parisToday() }).eq("id", id);
  if (error) back("charges", errorMessage(error));
  back("charges");
}

export async function addExpense(fd: FormData) {
  const ctx = await requireManager();
  const category = str(fd, "category"), day = str(fd, "spent_on") || parisToday();
  const amount = parseEuros(str(fd, "amount"));
  if (!amount) back("depenses", "Montant invalide.");
  if (!CATEGORIES.includes(category)) back("depenses", "Catégorie inconnue.");
  if (!isDate(day)) back("depenses", "Date invalide.");
  const supabase = await createClient();
  const { error } = await supabase.from("expenses").insert({
    org_id: ctx.org.id, category, amount_cents: amount, spent_on: day, supplier: str(fd, "supplier") || null, notes: str(fd, "notes") || null,
  });
  if (error) back("depenses", errorMessage(error));
  back("depenses");
}

export async function deleteExpense(id: string) {
  await requireManager();
  const supabase = await createClient();
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) back("depenses", errorMessage(error));
  back("depenses");
}

export async function addPlanned(fd: FormData) {
  await requireManager();
  const label = str(fd, "label"), due = str(fd, "due_on"), supplier = str(fd, "supplier_id") || null;
  const amount = parseEuros(str(fd, "amount"));
  if (!label) back("achats", "Donnez un nom à l'achat.");
  if (!amount) back("achats", "Montant invalide.");
  if (!isDate(due)) back("achats", "Date invalide.");
  const supabase = await createClient();
  const { error } = await supabase.from("planned_purchases").insert({ label: label.slice(0, 120), amount_cents: amount, due_on: due, supplier_id: supplier });
  if (error) back("achats", errorMessage(error));
  back("achats");
}

/** done: the lot was bought (its cost now comes from the lot itself); cancelled: it will not happen */
export async function closePlanned(id: string, status: "done" | "cancelled") {
  await requireManager();
  const supabase = await createClient();
  const { error } = await supabase.from("planned_purchases").update({ status }).eq("id", id);
  if (error) back("achats", errorMessage(error));
  back("achats");
}
