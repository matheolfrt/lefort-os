import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getContext, requireManager } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Card, Field, PageHeader, btn, input } from "@/components/ui";
import { ROLE_LABEL } from "@/i18n/fr";
import { date } from "@/lib/format";
import type { AppRole } from "@/lib/types";

const fail = (msg: string) => redirect(`/parametres?error=${encodeURIComponent(msg)}`);

async function saveOrg(formData: FormData) {
  "use server";
  const ctx = await getContext();
  const supabase = await createClient();
  const s = (k: string) => String(formData.get(k) ?? "").trim();
  const { error } = await supabase.from("organizations").update({
    trade_name: s("trade_name"), legal_name: s("legal_name") || null, siret: s("siret").replace(/\s/g, "") || null,
    address: s("address") || null, declaration_frequency: s("declaration_frequency"),
    versement_liberatoire: formData.get("versement_liberatoire") === "on", vat_regime: s("vat_regime"),
    min_photos: Number(s("min_photos")), dead_stock_days: Number(s("dead_stock_days")),
    vinted_fee_pct: Number(s("vinted_fee_pct").replace(",", ".")) || 0,
    vinted_fee_fixed_cents: Math.round(Number(s("vinted_fee_fixed").replace(",", ".")) * 100) || 0,
    listing_signature: s("listing_signature"),
  }).eq("id", ctx.org.id);
  if (error) fail(error.message);
  revalidatePath("/", "layout");
}

async function addMember(formData: FormData) {
  "use server";
  await getContext();
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_member", {
    p_email: String(formData.get("email")), p_role: String(formData.get("role")), p_full_name: String(formData.get("full_name") || ""),
  });
  if (error) fail(error.message);
  revalidatePath("/parametres");
}

async function setMember(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_member", {
    p_user_id: String(formData.get("user_id")), p_role: String(formData.get("role")), p_active: formData.get("active") === "on",
  });
  if (error) fail(error.message);
  revalidatePath("/parametres");
}

async function addRate(formData: FormData) {
  "use server";
  const ctx = await getContext();
  const supabase = await createClient();
  const { error } = await supabase.from("tax_rates").insert({
    org_id: ctx.org.id, kind: String(formData.get("kind")),
    rate_pct: Number(String(formData.get("rate")).replace(",", ".")), valid_from: String(formData.get("valid_from")),
  });
  if (error) fail(error.message);
  revalidatePath("/parametres");
}

export default async function Settings({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const ctx = await requireManager();
  const { error } = await searchParams;
  const supabase = await createClient();
  const [{ data: members }, { data: profiles }, { data: rates }] = await Promise.all([
    supabase.from("memberships").select("user_id, role, active").order("created_at"),
    supabase.from("profiles").select("id, full_name"),
    supabase.from("tax_rates").select("*").order("kind").order("valid_from", { ascending: false }),
  ]);
  const name = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const o = ctx.org;
  const admin = ctx.role === "admin";

  return (
    <>
      <PageHeader title="Paramètres" />
      {error && <p className="mb-4 rounded bg-red-100 p-3 text-red-800">{error}</p>}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Entreprise">
          <form action={saveOrg} className="space-y-3">
            <fieldset disabled={!admin} className="grid gap-3 sm:grid-cols-2">
              <Field label="Nom commercial"><input className={input} name="trade_name" defaultValue={o.trade_name} required /></Field>
              <Field label="Raison sociale / nom"><input className={input} name="legal_name" defaultValue={o.legal_name ?? ""} /></Field>
              <Field label="SIRET"><input className={input} name="siret" defaultValue={o.siret ?? ""} inputMode="numeric" /></Field>
              <Field label="Adresse"><input className={input} name="address" defaultValue={o.address ?? ""} /></Field>
              <Field label="Déclaration URSSAF">
                <select className={input} name="declaration_frequency" defaultValue={o.declaration_frequency}>
                  <option value="monthly">Mensuelle</option><option value="quarterly">Trimestrielle</option>
                </select>
              </Field>
              <Field label="Régime TVA">
                <select className={input} name="vat_regime" defaultValue={o.vat_regime}>
                  <option value="franchise">Franchise en base (pas de TVA)</option>
                  <option value="margin_scheme">TVA sur la marge (biens d&apos;occasion)</option>
                </select>
              </Field>
              <label className="flex items-center gap-2 sm:col-span-2">
                <input type="checkbox" name="versement_liberatoire" defaultChecked={o.versement_liberatoire} /> Versement libératoire de l&apos;impôt sur le revenu
              </label>
              <Field label="Frais Vinted Pro (% du prix)"><input className={input} name="vinted_fee_pct" defaultValue={String(o.vinted_fee_pct).replace(".", ",")} inputMode="decimal" /></Field>
              <Field label="Frais Vinted Pro fixes (€ / vente)"><input className={input} name="vinted_fee_fixed" defaultValue={(o.vinted_fee_fixed_cents / 100).toFixed(2).replace(".", ",")} inputMode="decimal" /></Field>
              <Field label="Photos minimum par article"><input className={input} name="min_photos" type="number" min={0} defaultValue={o.min_photos} /></Field>
              <Field label="Stock dormant après (jours)"><input className={input} name="dead_stock_days" type="number" min={1} defaultValue={o.dead_stock_days} /></Field>
              <div className="sm:col-span-2">
                <Field label="Signature des annonces"><textarea className={`${input} min-h-16 py-2`} name="listing_signature" defaultValue={o.listing_signature} /></Field>
              </div>
            </fieldset>
            {admin && <button className={btn.primary}>Enregistrer</button>}
          </form>
        </Card>

        <div className="space-y-4">
          <Card title="Équipe">
            <table className="data mb-4">
              <tbody>
                {(members ?? []).map((m) => (
                  <tr key={m.user_id}>
                    <td>{name.get(m.user_id) || m.user_id.slice(0, 8)}</td>
                    <td colSpan={2}>
                      {admin ? (
                        <form action={setMember} className="flex items-center gap-2">
                          <input type="hidden" name="user_id" value={m.user_id} />
                          <select name="role" defaultValue={m.role} className={`${input} w-auto`}>
                            {(Object.keys(ROLE_LABEL) as AppRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                          </select>
                          <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="active" defaultChecked={m.active} /> actif</label>
                          <button className="text-sm underline">OK</button>
                        </form>
                      ) : `${ROLE_LABEL[m.role as AppRole]}${m.active ? "" : " (inactif)"}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {admin && (
              <form action={addMember} className="grid gap-2 sm:grid-cols-2">
                <input className={input} name="email" type="email" placeholder="E-mail du compte" required />
                <input className={input} name="full_name" placeholder="Nom" />
                <select className={input} name="role" defaultValue="operator">
                  {(Object.keys(ROLE_LABEL) as AppRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
                <button className={btn.primary}>Ajouter</button>
                <p className="text-xs text-muted sm:col-span-2">La personne crée d&apos;abord son compte sur la page de connexion, puis vous l&apos;ajoutez ici. Un opérateur ne voit ni les coûts ni les marges.</p>
              </form>
            )}
          </Card>

          <Card title="Extension Chrome Vinted">
            <p className="mb-3 text-sm">
              Importe votre dressing Vinted et le resynchronise : nouvelles annonces, ventes faites sur Vinted, prix et réservations.
              Elle lit uniquement vos annonces, quand vous cliquez, et ne modifie rien sur Vinted.
            </p>
            <a className={`${btn.primary} mb-3`} href="/lefort-os-vinted.zip" download>Télécharger l&apos;extension</a>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
              <li>Décompressez le fichier téléchargé (double-clic).</li>
              <li>Dans Chrome, ouvrez <span className="font-mono">chrome://extensions</span> et activez le « Mode développeur » (en haut à droite).</li>
              <li>Cliquez sur « Charger l&apos;extension non empaquetée » et choisissez le dossier décompressé.</li>
              <li>Épinglez l&apos;icône Lefort OS (pièce de puzzle), ouvrez votre profil Vinted, puis cliquez sur l&apos;icône.</li>
            </ol>
          </Card>

          <Card title="Taux URSSAF (historisés)">
            <table className="data mb-3">
              <tbody>
                {(rates ?? []).map((r) => <tr key={r.id}><td>{r.kind}</td><td className="num">{String(r.rate_pct).replace(".", ",")} %</td><td>depuis le {date(r.valid_from)}</td></tr>)}
              </tbody>
            </table>
            {admin && (
              <form action={addRate} className="grid grid-cols-[1fr_80px_1fr_auto] gap-2">
                <select className={input} name="kind">
                  <option value="urssaf_bic_vente">urssaf_bic_vente</option><option value="cfp">cfp</option><option value="versement_liberatoire">versement_liberatoire</option>
                </select>
                <input className={input} name="rate" placeholder="%" inputMode="decimal" required />
                <input className={input} name="valid_from" type="date" required />
                <button className={btn.secondary}>+</button>
              </form>
            )}
            <p className="mt-2 text-xs text-muted">Un nouveau taux s&apos;applique à partir de sa date ; les mois passés gardent l&apos;ancien taux.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
