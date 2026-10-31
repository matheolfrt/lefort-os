import { CheckCircle2 } from "lucide-react";
import { requireManager } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, Field, PageHeader, btn, input } from "@/components/ui";
import { CATEGORY_LABEL, euro, frDate, type Overview } from "@/lib/finance";
import { eurosInput, parisToday } from "@/lib/format";
import {
  addExpense, addPlanned, addRecurring, closePlanned, declareBalance, deleteBalance, deleteExpense, saveForecast, saveThresholds, stopRecurring,
} from "./actions";

export const metadata = { title: "Paramètres financiers" };

const FREQ: Record<string, string> = { weekly: "chaque semaine", monthly: "chaque mois", quarterly: "chaque trimestre", yearly: "chaque année" };
const small = `${btn.secondary} min-h-9 px-3 text-sm`;

export default async function FinanceSettings({ searchParams }: { searchParams: Promise<{ erreur?: string; ok?: string; s?: string }> }) {
  await requireManager();
  const sp = await searchParams;
  const supabase = await createClient();
  const [ov, balances, recurring, expenses, planned, suppliers] = await Promise.all([
    supabase.rpc("finance_overview"),
    supabase.from("cash_balances").select("id, as_of, amount_cents, note").order("as_of", { ascending: false }).limit(10),
    supabase.from("recurring_expenses").select("id, label, category, amount_cents, frequency, day_of_month, starts_on, ends_on").order("created_at"),
    supabase.from("expenses").select("id, category, amount_cents, spent_on, supplier, notes").order("spent_on", { ascending: false }).limit(15),
    supabase.from("planned_purchases").select("id, label, amount_cents, due_on, status, suppliers(name)").eq("status", "planned").order("due_on"),
    supabase.from("suppliers").select("id, name").order("name"),
  ]);
  if (ov.error || !ov.data || balances.error) {
    return (
      <>
        <PageHeader title="Paramètres financiers" back="/finance" />
        <Empty action={{ href: "/parametres/mises-a-jour", label: "Mettre à jour la base" }}>Cette page a besoin d&apos;une mise à jour de la base de données.</Empty>
      </>
    );
  }
  const s = (ov.data as Overview).settings, f = s.forecast;
  const today = parisToday();
  const active = (recurring.data ?? []).filter((r) => !r.ends_on || r.ends_on >= today);
  const ended = (recurring.data ?? []).filter((r) => r.ends_on && r.ends_on < today);
  const monthly = active.reduce((a, r) => a + (r.frequency === "weekly" ? (r.amount_cents * 52) / 12 : r.frequency === "quarterly" ? r.amount_cents / 3 : r.frequency === "yearly" ? r.amount_cents / 12 : r.amount_cents), 0);
  const Msg = ({ id }: { id: string }) => sp.ok === id
    ? <p role="status" className="saved mb-3 flex w-fit items-center gap-1.5 px-1 text-sm text-accent"><CheckCircle2 size={16} /> Enregistré.</p>
    : sp.erreur && sp.s === id ? <p role="alert" className="mb-3 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{sp.erreur}</p> : null;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader title="Paramètres financiers" back="/finance"
        subtitle="Tout ce que le tableau « Où est mon argent ? » utilise : rien n'est figé dans le code, chaque valeur se règle ici." />
      <nav aria-label="Sections" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 text-sm [scrollbar-width:none]">
        {[["tresorerie", "Trésorerie"], ["seuils", "Réserve et seuils"], ["prevision", "Hypothèses"], ["charges", "Charges récurrentes"], ["depenses", "Dépenses"], ["achats", "Achats prévus"]].map(([id, l]) => (
          <a key={id} href={`#${id}`} className="inline-flex min-h-10 shrink-0 items-center rounded-full border border-line bg-panel/60 px-3 text-muted hover:text-fg">{l}</a>
        ))}
      </nav>

      <section id="tresorerie" className="scroll-mt-20">
        <Card title="Trésorerie">
          <Msg id="tresorerie" />
          <p className="mb-3 text-sm text-muted">
            Le solde de votre compte professionnel à une date. Ensuite, Lefort OS ajoute les ventes encaissées et retire remboursements, frais d&apos;envoi,
            lots achetés et charges. Les dépenses datées du jour du solde sont considérées comme déjà incluses. Redéclarez-le de temps en temps (par exemple chaque mois) pour corriger les écarts.
          </p>
          <form action={declareBalance} className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end">
            <Field label="Solde (€)"><input name="amount" required inputMode="decimal" placeholder="2 450,00" className={input} /></Field>
            <Field label="Au"><input name="as_of" type="date" defaultValue={today} max={today} className={input} /></Field>
            <Field label="Note"><input name="note" maxLength={300} placeholder="Relevé bancaire, Qonto…" className={input} /></Field>
            <button className={btn.primary}>Déclarer</button>
          </form>
          {balances.data!.length > 0 && (
            <ul className="mt-4 divide-y divide-line border-t border-line text-sm" data-testid="balances">
              {balances.data!.map((b, i) => (
                <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="figure font-semibold tabular-nums">{euro(b.amount_cents)}</span>
                  <span className="text-muted">au {frDate(b.as_of.slice(0, 10))}{i === 0 && " · solde de référence"}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">{b.note}</span>
                  <form action={deleteBalance.bind(null, b.id)}><button className={small} aria-label={`Supprimer le solde du ${frDate(b.as_of.slice(0, 10))}`}>Supprimer</button></form>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section id="seuils" className="scroll-mt-20">
        <Card title="Réserve de sécurité et seuils">
          <Msg id="seuils" />
          <form action={saveThresholds} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Réserve de sécurité (€)" hint="Jamais comptée dans le budget d'achat.">
                <input name="reserve" inputMode="decimal" defaultValue={eurosInput(s.cash_reserve_cents)} className={input} />
              </Field>
              <Field label="Facteur de liquidation (%)" hint="Part du prix affiché récupérée en vendant vite.">
                <input name="liquidation" type="number" min={0} max={100} defaultValue={s.liquidation_pct} className={input} />
              </Field>
            </div>
            <fieldset>
              <legend className="eyebrow-tight mb-1.5 text-muted">Capital immobilisé : part du capital en stock (%)</legend>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Normal dès"><input name="normal" type="number" min={0} max={100} defaultValue={s.immob_levels.normal} className={input} /></Field>
                <Field label="Élevé dès"><input name="high" type="number" min={0} max={100} defaultValue={s.immob_levels.high} className={input} /></Field>
                <Field label="Critique dès"><input name="critical" type="number" min={0} max={100} defaultValue={s.immob_levels.critical} className={input} /></Field>
              </div>
            </fieldset>
            <fieldset>
              <legend className="eyebrow-tight mb-1.5 text-muted">Âge du stock (jours)</legend>
              <div className="grid grid-cols-3 gap-3">
                <Field label="1re tranche jusqu'à"><input name="b1" type="number" min={1} max={730} defaultValue={s.aging_bounds[0]} className={input} /></Field>
                <Field label="2e tranche jusqu'à"><input name="b2" type="number" min={1} max={730} defaultValue={s.aging_bounds[1]} className={input} /></Field>
                <Field label="Dormant au-delà de"><input name="dead" type="number" min={1} max={730} defaultValue={s.dead_stock_days} className={input} /></Field>
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-sm">
                <label className="inline-flex min-h-11 items-center gap-2"><input type="radio" name="basis" value="listed" defaultChecked={s.aging_basis === "listed"} className="accent-[var(--accent)]" /> Âge depuis la mise en ligne</label>
                <label className="inline-flex min-h-11 items-center gap-2"><input type="radio" name="basis" value="received" defaultChecked={s.aging_basis === "received"} className="accent-[var(--accent)]" /> Âge depuis la réception</label>
              </div>
            </fieldset>
            <button className={btn.primary}>Enregistrer</button>
          </form>
        </Card>
      </section>

      <section id="prevision" className="scroll-mt-20">
        <Card title="Hypothèses de prévision et d'analyse">
          <Msg id="prevision" />
          <form action={saveForecast} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Rythme des ventes : derniers (jours)" hint="Période qui sert de base à la prévision."><input name="window_days" type="number" min={7} max={365} defaultValue={f.window_days} className={input} /></Field>
              <Field label="Horizon de prévision (jours)"><input name="horizon_days" type="number" min={7} max={365} defaultValue={f.horizon_days} className={input} /></Field>
              <Field label="Croissance des ventes (% par mois)"><input name="growth_pct" type="number" step="0.5" min={-50} max={100} defaultValue={f.growth_pct} className={input} /></Field>
              <Field label="Délai de paiement Vinted (jours)"><input name="payout_days" type="number" min={0} max={60} defaultValue={f.payout_days} className={input} /></Field>
              <Field label="Stock de sécurité visé (jours)" hint="En plus des 30 jours de ventes, pour le budget d'achat."><input name="stock_target_days" type="number" min={0} max={365} defaultValue={f.stock_target_days} className={input} /></Field>
              <Field label="Coûts variables en plus (%)" hint="Des encaissements, si non saisis ailleurs."><input name="variable_cost_pct" type="number" step="0.5" min={0} max={100} defaultValue={f.variable_cost_pct} className={input} /></Field>
              <Field label="Période d'analyse (jours)" hint="Performance, rotation, rendement."><input name="analysis_days" type="number" min={7} max={365} defaultValue={f.analysis_days} className={input} /></Field>
            </div>
            <button className={btn.primary}>Enregistrer</button>
          </form>
        </Card>
      </section>

      <section id="charges" className="scroll-mt-20">
        <Card title={`Charges récurrentes · ${euro(Math.round(monthly))} par mois`}>
          <Msg id="charges" />
          <p className="mb-3 text-sm text-muted">
            Loyer, salaires, logiciels… saisis une fois, comptés à chaque échéance dans le bénéfice, la trésorerie et la prévision.
            Si une catégorie a une charge récurrente, les dépenses ponctuelles de la même catégorie sont considérées comme ses paiements (pas de double comptage).
          </p>
          {active.length > 0 && (
            <ul className="mb-4 divide-y divide-line border-y border-line text-sm" data-testid="recurring">
              {active.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="font-medium">{r.label}</span>
                  <span className="text-muted">{CATEGORY_LABEL[r.category]} · {FREQ[r.frequency]}{r.frequency !== "weekly" && `, le ${r.day_of_month}`}{r.ends_on && ` · jusqu'au ${frDate(r.ends_on)}`}</span>
                  <span className="ml-auto figure tabular-nums">{euro(r.amount_cents)}</span>
                  <form action={stopRecurring.bind(null, r.id)}><button className={small}>Arrêter</button></form>
                </li>
              ))}
            </ul>
          )}
          <form action={addRecurring} className="grid gap-3 sm:grid-cols-6 sm:items-end">
            <div className="sm:col-span-2"><Field label="Nom"><input name="label" required maxLength={120} placeholder="Loyer du local" className={input} /></Field></div>
            <Field label="Montant (€)"><input name="amount" required inputMode="decimal" className={input} /></Field>
            <Field label="Catégorie"><Select name="category" options={CATEGORY_LABEL} /></Field>
            <Field label="Fréquence"><Select name="frequency" options={{ monthly: "Mensuelle", weekly: "Hebdomadaire", quarterly: "Trimestrielle", yearly: "Annuelle" }} /></Field>
            <Field label="Jour"><input name="day" type="number" min={1} max={28} defaultValue={1} className={input} /></Field>
            <div className="sm:col-span-2"><Field label="À partir du"><input name="starts_on" type="date" defaultValue={today} className={input} /></Field></div>
            <div className="sm:col-span-2"><Field label="Jusqu'au (facultatif)"><input name="ends_on" type="date" className={input} /></Field></div>
            <button className={`${btn.primary} sm:col-span-2`}>Ajouter la charge</button>
          </form>
          {ended.length > 0 && <p className="mt-3 text-xs text-muted">{ended.length} charge{ended.length > 1 ? "s" : ""} arrêtée{ended.length > 1 ? "s" : ""}, toujours comptée{ended.length > 1 ? "s" : ""} sur leur période passée.</p>}
        </Card>
      </section>

      <section id="depenses" className="scroll-mt-20">
        <Card title="Dépenses ponctuelles">
          <Msg id="depenses" />
          <p className="mb-3 text-sm text-muted">Achat de matériel, emballages, frais imprévus. Les achats de lots se saisissent dans Lots, pas ici.</p>
          <form action={addExpense} className="grid gap-3 sm:grid-cols-5 sm:items-end">
            <Field label="Montant (€)"><input name="amount" required inputMode="decimal" className={input} /></Field>
            <Field label="Catégorie"><Select name="category" options={CATEGORY_LABEL} defaultValue="other" /></Field>
            <Field label="Date"><input name="spent_on" type="date" defaultValue={today} className={input} /></Field>
            <Field label="Fournisseur"><input name="supplier" maxLength={120} className={input} /></Field>
            <button className={btn.primary}>Ajouter</button>
          </form>
          {(expenses.data ?? []).length > 0 && (
            <ul className="mt-4 divide-y divide-line border-t border-line text-sm" data-testid="expenses">
              {expenses.data!.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="text-muted">{frDate(e.spent_on)}</span>
                  <span>{CATEGORY_LABEL[e.category] ?? e.category}{e.supplier && <span className="text-muted"> · {e.supplier}</span>}</span>
                  <span className="ml-auto figure tabular-nums">{euro(e.amount_cents)}</span>
                  <form action={deleteExpense.bind(null, e.id)}><button className={small}>Supprimer</button></form>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section id="achats" className="scroll-mt-20">
        <Card title="Achats prévus">
          <Msg id="achats" />
          <p className="mb-3 text-sm text-muted">Les lots que vous comptez acheter : ils réduisent le budget d&apos;achat et apparaissent dans la prévision. Marquez-les « Acheté » une fois le lot saisi.</p>
          {(planned.data ?? []).length > 0 && (
            <ul className="mb-4 divide-y divide-line border-y border-line text-sm" data-testid="planned">
              {planned.data!.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="font-medium">{p.label}</span>
                  <span className="text-muted">{(p.suppliers as unknown as { name: string } | null)?.name ?? ""} le {frDate(p.due_on)}{p.due_on < today && " (dépassé)"}</span>
                  <span className="ml-auto figure tabular-nums">{euro(p.amount_cents)}</span>
                  <form action={closePlanned.bind(null, p.id, "done")}><button className={small}>Acheté</button></form>
                  <form action={closePlanned.bind(null, p.id, "cancelled")}><button className={small}>Annuler</button></form>
                </li>
              ))}
            </ul>
          )}
          <form action={addPlanned} className="grid gap-3 sm:grid-cols-5 sm:items-end">
            <div className="sm:col-span-2"><Field label="Nom"><input name="label" required maxLength={120} placeholder="Lot blazers laine" className={input} /></Field></div>
            <Field label="Montant (€)"><input name="amount" required inputMode="decimal" className={input} /></Field>
            <Field label="Date prévue"><input name="due_on" type="date" required defaultValue={today} className={input} /></Field>
            <Field label="Fournisseur">
              <select name="supplier_id" className={input} defaultValue="">
                <option value="">—</option>
                {(suppliers.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </Field>
            <button className={`${btn.primary} sm:col-span-5 sm:w-fit`}>Ajouter l&apos;achat prévu</button>
          </form>
        </Card>
      </section>
    </div>
  );
}

function Select({ name, options, defaultValue }: { name: string; options: Record<string, string>; defaultValue?: string }) {
  return (
    <select name={name} defaultValue={defaultValue} className={input}>
      {Object.entries(options).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </select>
  );
}
