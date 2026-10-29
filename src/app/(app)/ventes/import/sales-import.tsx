"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, FileUp } from "lucide-react";
import { useToast } from "@/components/toast";
import { Card, btn, input } from "@/components/ui";
import { downloadCsv, mapRows, parseCsv, parseCsvEuros } from "@/lib/csv";
import { SALES_ALIASES, conditionCode } from "@/lib/csv-fields";
import { rpc } from "@/lib/client-data";
import { supabaseBrowser } from "@/lib/supabase/client";
import { money } from "@/lib/format";
import { STATUS_LABEL } from "@/i18n/fr";
import type { ItemStatus } from "@/lib/types";

const SELLABLE: ItemStatus[] = ["listing_ready", "listed", "reserved"];
const CHUNK = 200;
const TEMPLATE = [
  ["SKU", "Titre", "Marque", "Taille", "Prix de vente", "Coût", "Date de vente", "Date d'encaissement", "Acheteur", "Réf commande",
    "Frais de port", "Emballage", "Frais plateforme", "Lien Vinted"],
  ["LSH00042", "", "", "", "45", "", "25/10/2026 14:30", "", "pseudo_acheteur", "", "", "0,80", "", ""],
  ["", "Blazer Hugo Boss bleu marine", "Hugo Boss", "50", "39", "12", "02/03/2025", "05/03/2025", "autre_acheteur", "", "", "", "",
    "https://www.vinted.fr/items/1234567890"],
];

type State = "completed" | "shipped" | "pending";
const STATES: { value: State; label: string; hint: string }[] = [
  { value: "completed", label: "Terminées", hint: "expédiées et encaissées" },
  { value: "shipped", label: "Expédiées", hint: "en attente de confirmation de l'acheteur" },
  { value: "pending", label: "À expédier", hint: "apparaissent au poste Expédition" },
];

const vintedId = (url: string | undefined) => url?.match(/vinted\.[a-z.]+\/items\/(\d+)/)?.[1] ?? null;

/** "25/10/2026", "25/10/2026 14:30", "2026-10-25" → ISO; empty → null */
function parseDate(v: string | undefined): string | null | "invalid" {
  if (!v?.trim()) return null;
  const fr = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2})[:h](\d{2}))?$/);
  const d = fr ? new Date(Number(fr[3]), Number(fr[2]) - 1, Number(fr[1]), Number(fr[4] ?? 12), Number(fr[5] ?? 0)) : new Date(v.trim());
  return Number.isNaN(d.getTime()) ? "invalid" : d.toISOString();
}

interface Line {
  sku: string; title: string; brand: string; size: string; category: string; condition: string | null;
  price_cents: number; cost_cents: number | null; vinted_url: string; isNew: boolean;
}
interface Sale {
  key: string; rows: number[]; lines: Line[]; grossCents: number; soldAt: string | null; paidAt: string | null;
  buyer: string; ref: string; shipping: number;
  packaging: number | null; // null: no amount in the file, the database takes the one of Paramètres
  platform: number | null; problems: string[];
}

export function SalesImport() {
  const toast = useToast();
  const [file, setFile] = useState<string | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [historical, setHistorical] = useState<boolean | null>(null);
  const [state, setState] = useState<State>("completed");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ ok: number; created: number; errors: { key: string; error: string }[] } | null>(null);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setDone(null);
    setFile(f.name);
    const { records } = mapRows(parseCsv(await f.text()), SALES_ALIASES);
    const skus = [...new Set(records.map((r) => r.sku?.toUpperCase()).filter(Boolean))];
    type Known = { sku: string; status: ItemStatus; deleted: boolean };
    const found = new Map<string, Known>();
    for (let i = 0; i < skus.length; i += 200) {
      const { data } = await supabaseBrowser().from("items").select("sku, status, deleted_at").in("sku", skus.slice(i, i + 200));
      (data ?? []).forEach((it: { sku: string; status: ItemStatus; deleted_at: string | null }) =>
        found.set(it.sku, { sku: it.sku, status: it.status, deleted: !!it.deleted_at }));
    }
    // without a SKU, the Vinted link identifies an item already known
    const exts = [...new Set(records.filter((r) => !r.sku).map((r) => vintedId(r.vinted_url)).filter(Boolean))] as string[];
    const byExt = new Map<string, Known>();
    for (let i = 0; i < exts.length; i += 200) {
      const { data } = await supabaseBrowser().from("listings").select("external_id, items(sku, status, deleted_at)")
        .eq("channel", "vinted").in("external_id", exts.slice(i, i + 200));
      (data ?? []).forEach((l: { external_id: string; items: unknown }) => {
        const it = l.items as unknown as { sku: string; status: ItemStatus; deleted_at: string | null } | null;
        if (it) byExt.set(l.external_id, { sku: it.sku, status: it.status, deleted: !!it.deleted_at });
      });
    }

    // rows sharing an order reference (or order number) are one bundle sale
    const byKey = new Map<string, Sale>();
    records.forEach((r, i) => {
      if (!Object.values(r).some(Boolean)) return;
      const row = i + 2;
      const ref = r.order_ref || r.order_number || "";
      const key = ref ? `ref:${ref}` : `row:${row}`;
      const s = byKey.get(key) ?? { key, rows: [], lines: [], grossCents: 0, soldAt: null, paidAt: null, buyer: r.buyer ?? "",
        ref: r.order_ref ?? "", shipping: 0, packaging: null, platform: null, problems: [] };
      const sku = (r.sku ?? "").toUpperCase();
      const it = sku ? found.get(sku) : byExt.get(vintedId(r.vinted_url) ?? "");
      const at = (msg: string) => `${msg} (ligne ${row})`;
      const price = parseCsvEuros(r.price);
      const cost = parseCsvEuros(r.cost);
      const cond = conditionCode(r.condition);
      const sold = parseDate(r.sold_at);
      const paid = parseDate(r.paid_at);
      const fee = (v: string | undefined) => { const c = parseCsvEuros(v); return Number.isNaN(c) ? null : c ?? 0; };
      s.rows.push(row);
      if (it?.deleted) s.problems.push(at(`${it.sku} est dans la corbeille`));
      else if (it && !SELLABLE.includes(it.status)) s.problems.push(at(`${it.sku} est « ${STATUS_LABEL[it.status]} », déjà vendu ?`));
      else if (!it && sku && !/^[A-Z0-9-]{3,30}$/.test(sku)) s.problems.push(at("SKU invalide"));
      if (!it && !sku && !r.title) s.problems.push(at("ni SKU ni titre"));
      if (price == null || Number.isNaN(price)) s.problems.push(at("prix invalide"));
      if (Number.isNaN(cost)) s.problems.push(at("coût invalide"));
      if (cond === "invalid") s.problems.push(at(`état « ${r.condition} » inconnu`));
      if (sold === "invalid") s.problems.push(at(`date invalide (« ${r.sold_at} »)`));
      else if (sold && !s.soldAt) s.soldAt = sold;
      if (paid === "invalid") s.problems.push(at("date d'encaissement invalide"));
      else if (paid && !s.paidAt) s.paidAt = paid;
      s.lines.push({
        sku: sku || it?.sku || "", title: r.title ?? "", brand: r.brand ?? "", size: r.size ?? "", category: r.category ?? "",
        condition: cond === "invalid" ? null : cond, price_cents: Number.isNaN(price) ? 0 : price ?? 0,
        cost_cents: Number.isNaN(cost) ? null : cost, vinted_url: r.vinted_url ?? "", isNew: !it,
      });
      s.grossCents += Number.isNaN(price) ? 0 : price ?? 0;
      s.shipping += fee(r.shipping) ?? 0;
      if (r.packaging) s.packaging = (s.packaging ?? 0) + (fee(r.packaging) ?? 0);
      if (r.platform_fee) s.platform = (s.platform ?? 0) + (fee(r.platform_fee) ?? 0);
      byKey.set(key, s);
    });
    setSales([...byKey.values()]);
  }

  const ready = sales.filter((s) => !s.problems.length);
  const blocked = sales.filter((s) => s.problems.length);
  const toCreate = ready.reduce((n, s) => n + s.lines.filter((l) => l.isNew).length, 0);
  const label = (s: Sale) => s.lines.map((l) => l.sku || l.title).join(" + ");

  async function run() {
    if (historical == null) return;
    setBusy(true);
    let ok = 0, created = 0;
    const errors: { key: string; error: string }[] = [];
    for (let i = 0; i < ready.length; i += CHUNK) {
      const chunk = ready.slice(i, i + CHUNK);
      try {
        const r = await rpc<{ orders: number; items_created: number; errors: { sale: number; error: string }[] }>("import_sales", {
          p_sales: chunk.map((s) => ({
            sold_at: s.soldAt, paid_at: s.paidAt, buyer: s.buyer || null, order_ref: s.ref || null,
            shipping_cents: s.shipping, packaging_cents: s.packaging, platform_fee_cents: s.platform,
            lines: s.lines.map((l) => ({ ...l, isNew: undefined })),
          })),
          p_historical: historical, p_state: state,
        });
        ok += r.orders;
        created += r.items_created;
        r.errors.forEach((e) => errors.push({ key: label(chunk[e.sale - 1]), error: e.error }));
      } catch (e) {
        chunk.forEach((s) => errors.push({ key: label(s), error: (e as Error).message }));
      }
    }
    setDone({ ok, created, errors });
    setBusy(false);
    toast(`${ok} vente(s) importée(s)${errors.length ? `, ${errors.length} refusée(s)` : ""}`, errors.length ? "error" : "ok");
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        <Card title="1. Fichier">
          <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line bg-bg p-4 text-center hover:border-fg/30">
            <FileUp size={26} className="text-muted" />
            <span className="font-semibold">{file ?? "Choisir un fichier CSV"}</span>
            <span className="text-xs text-muted">Une ligne par article vendu · même « Réf commande » = vendus ensemble</span>
            <input type="file" accept=".csv,text/csv" className="sr-only" aria-label="Fichier CSV" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          {sales.length > 0 && (
            <p className="mt-3 text-sm">
              <b>{sales.length}</b> vente{sales.length > 1 ? "s" : ""} · <b className="text-emerald-700 dark:text-emerald-400">{ready.length} prêtes</b>
              {toCreate > 0 && <> · {toCreate} article{toCreate > 1 ? "s" : ""} à créer</>}
              {blocked.length > 0 && <> · <b className="text-red-600 dark:text-red-400">{blocked.length} bloquées</b></>}
            </p>
          )}
          {blocked.length > 0 && (
            <ul className="mt-2 max-h-40 overflow-auto rounded-lg bg-red-50 p-2 text-sm text-red-900 dark:bg-red-500/10 dark:text-red-200">
              {blocked.map((s) => <li key={s.key}>{s.problems.join(" · ")}</li>)}
            </ul>
          )}
        </Card>

        {ready.length > 0 && (
          <Card title={`2. Ventes à importer (${ready.length})`}>
            <div className="-mx-4 -mb-4 overflow-x-auto">
              <table className="data">
                <thead><tr><th>Article(s)</th><th>Date</th><th>Acheteur</th><th className="num">Prix</th><th className="num">Coût</th></tr></thead>
                <tbody>
                  {ready.slice(0, 100).map((s) => (
                    <tr key={s.key}>
                      <td>
                        {s.lines.map((l, i) => (
                          <div key={i} className="flex items-center gap-2">
                            {l.sku && <span className="font-mono">{l.sku}</span>}
                            {l.isNew && <span className="truncate text-muted">{l.title}</span>}
                            {l.isNew && <span className="shrink-0 rounded bg-sky-100 px-1.5 text-[10px] font-semibold uppercase text-sky-900 dark:bg-sky-500/20 dark:text-sky-200">nouveau</span>}
                          </div>
                        ))}
                      </td>
                      <td className="whitespace-nowrap">{s.soldAt ? new Date(s.soldAt).toLocaleDateString("fr-FR") : "maintenant"}</td>
                      <td>{s.buyer}</td>
                      <td className="num">{money(s.grossCents)}</td>
                      <td className="num">{s.lines.some((l) => l.isNew)
                        ? (s.lines.some((l) => l.cost_cents != null) ? money(s.lines.reduce((a, l) => a + (l.cost_cents ?? 0), 0)) : "—")
                        : "stock"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ready.length > 100 && <p className="p-3 text-center text-xs text-muted">… et {ready.length - 100} autres</p>}
            </div>
          </Card>
        )}

        {done && (
          <Card title="Résultat">
            <p><b>{done.ok}</b> vente(s) importée(s){done.created > 0 && <>, <b>{done.created}</b> article(s) créé(s)</>}.</p>
            {done.errors.length > 0 && (
              <ul className="mt-2 max-h-60 overflow-auto rounded-lg bg-red-50 p-2 text-sm text-red-900 dark:bg-red-500/10 dark:text-red-200">
                {done.errors.map((e, i) => <li key={i}>{e.key} : {e.error}</li>)}
              </ul>
            )}
            <div className="mt-3 flex gap-2">
              <Link className={btn.secondary} href="/ventes">Voir les ventes</Link>
              {state === "pending" && <Link className={btn.secondary} href="/postes/expedition">Expédition</Link>}
            </div>
          </Card>
        )}
      </div>

      <div className="space-y-4">
        <Card title="3. Comptabilité">
          <fieldset className="space-y-2">
            <legend className="sr-only">Ces ventes sont-elles déjà déclarées ?</legend>
            {[
              { v: true, t: "Historique", d: "Déjà déclarées ailleurs. Comptent dans les statistiques, pas dans le livre des recettes ni le CA URSSAF." },
              { v: false, t: "À comptabiliser", d: "Ajoutées au livre des recettes et au CA URSSAF à leur date d'encaissement." },
            ].map((o) => (
              <label key={o.t} className={`flex min-h-11 cursor-pointer gap-3 rounded-lg border p-3 ${historical === o.v ? "border-ink bg-bg" : "border-line"}`}>
                <input type="radio" name="historical" className="mt-1 size-4 accent-current" checked={historical === o.v} onChange={() => setHistorical(o.v)} />
                <span><span className="block font-semibold">{o.t}</span><span className="block text-xs text-muted">{o.d}</span></span>
              </label>
            ))}
          </fieldset>
          <label className="mt-3 block text-sm font-medium">
            État des ventes
            <select className={`${input} mt-1`} value={state} onChange={(e) => setState(e.target.value as State)}>
              {STATES.map((s) => <option key={s.value} value={s.value}>{s.label} — {s.hint}</option>)}
            </select>
          </label>
          <button className={`${btn.huge} mt-4`} disabled={busy || ready.length === 0 || historical == null || !!done} onClick={run}>
            {busy ? "Import…" : ready.length ? `Importer ${ready.length} vente${ready.length > 1 ? "s" : ""}` : "Choisissez d'abord un fichier"}
          </button>
          {ready.length > 0 && historical == null && <p className="mt-2 text-center text-xs text-muted">Choisissez Historique ou À comptabiliser.</p>}
        </Card>
        <Card title="Modèle">
          <p className="mb-3 text-sm text-muted">
            Obligatoire : Prix de vente, et SKU ou Titre. Un SKU absent du stock crée l&apos;article (titre, marque, taille, coût, lien Vinted)
            dans un lot « historique ». Sans date d&apos;encaissement, la date de vente est utilisée.
          </p>
          <button className={`${btn.secondary} w-full`} onClick={() => downloadCsv("modele-ventes.csv", TEMPLATE)}>
            <Download size={16} /> Télécharger le modèle
          </button>
        </Card>
      </div>
    </div>
  );
}
