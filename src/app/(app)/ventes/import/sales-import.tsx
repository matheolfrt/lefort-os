"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, FileUp } from "lucide-react";
import { useToast } from "@/components/toast";
import { Card, btn } from "@/components/ui";
import { downloadCsv, mapRows, parseCsv, parseCsvEuros } from "@/lib/csv";
import { SALES_ALIASES } from "@/lib/csv-fields";
import { rpc } from "@/lib/client-data";
import { supabaseBrowser } from "@/lib/supabase/client";
import { money } from "@/lib/format";
import { STATUS_LABEL } from "@/i18n/fr";
import type { ItemStatus } from "@/lib/types";

const SELLABLE: ItemStatus[] = ["listing_ready", "listed", "reserved"];
const TEMPLATE = [
  ["SKU", "Prix de vente", "Date de vente", "Acheteur", "Réf commande", "Frais de port", "Emballage", "Frais plateforme"],
  ["LSH00042", "45", "25/10/2026 14:30", "pseudo_acheteur", "", "", "0,80", ""],
];

/** "25/10/2026", "25/10/2026 14:30", "2026-10-25" → ISO; empty → now */
function parseDate(v: string | undefined): string | null | "invalid" {
  if (!v?.trim()) return null;
  const fr = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2})[:h](\d{2}))?$/);
  const d = fr ? new Date(Number(fr[3]), Number(fr[2]) - 1, Number(fr[1]), Number(fr[4] ?? 12), Number(fr[5] ?? 0)) : new Date(v.trim());
  return Number.isNaN(d.getTime()) ? "invalid" : d.toISOString();
}

interface Order {
  key: string; lines: number[]; skus: string[]; itemIds: string[]; grossCents: number; soldAt: string | null;
  buyer: string; ref: string; shipping: number; packaging: number; platform: number | null; problems: string[];
}

export function SalesImport() {
  const toast = useToast();
  const [file, setFile] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ ok: number; errors: { key: string; error: string }[] } | null>(null);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setDone(null);
    setFile(f.name);
    const { records } = mapRows(parseCsv(await f.text()), SALES_ALIASES);
    const skus = [...new Set(records.map((r) => r.sku?.toUpperCase()).filter(Boolean))];
    const found = new Map<string, { id: string; status: ItemStatus }>();
    for (let i = 0; i < skus.length; i += 200) {
      const { data } = await supabaseBrowser().from("items").select("id, sku, status").in("sku", skus.slice(i, i + 200)).is("deleted_at", null);
      (data ?? []).forEach((it: { id: string; sku: string; status: ItemStatus }) => found.set(it.sku, it));
    }

    // rows sharing an order reference are one bundle sale
    const byKey = new Map<string, Order>();
    records.forEach((r, i) => {
      const line = i + 2;
      const key = r.order_ref ? `ref:${r.order_ref}` : `line:${line}`;
      const o = byKey.get(key) ?? { key, lines: [], skus: [], itemIds: [], grossCents: 0, soldAt: null, buyer: r.buyer ?? "", ref: r.order_ref ?? "",
        shipping: 0, packaging: 0, platform: null, problems: [] };
      const sku = (r.sku ?? "").toUpperCase();
      const it = found.get(sku);
      const price = parseCsvEuros(r.price);
      const date = parseDate(r.sold_at);
      const fee = (v: string | undefined) => { const c = parseCsvEuros(v); return Number.isNaN(c) ? null : c ?? 0; };
      o.lines.push(line);
      o.skus.push(sku || "—");
      if (!sku) o.problems.push(`ligne ${line} : SKU manquant`);
      else if (!it) o.problems.push(`${sku} introuvable`);
      else if (!SELLABLE.includes(it.status)) o.problems.push(`${sku} est « ${STATUS_LABEL[it.status]} », pas en vente`);
      else o.itemIds.push(it.id);
      if (price == null || Number.isNaN(price)) o.problems.push(`ligne ${line} : prix invalide`);
      else o.grossCents += price;
      if (date === "invalid") o.problems.push(`ligne ${line} : date invalide (« ${r.sold_at} »)`);
      else if (date && !o.soldAt) o.soldAt = date;
      o.shipping += fee(r.shipping) ?? 0;
      o.packaging += fee(r.packaging) ?? 0;
      if (r.platform_fee) o.platform = (o.platform ?? 0) + (fee(r.platform_fee) ?? 0);
      byKey.set(key, o);
    });
    setOrders([...byKey.values()]);
  }

  const ready = orders.filter((o) => !o.problems.length);
  const blocked = orders.filter((o) => o.problems.length);

  async function run() {
    setBusy(true);
    let ok = 0;
    const errors: { key: string; error: string }[] = [];
    for (const o of ready) {
      try {
        await rpc("record_sale", {
          p_item_ids: o.itemIds, p_gross_cents: o.grossCents, p_sold_at: o.soldAt ?? new Date().toISOString(), p_channel: "vinted",
          p_external_order_id: o.ref || null, p_buyer: o.buyer || null, p_platform_fee_cents: o.platform,
          p_shipping_cost_cents: o.shipping, p_packaging_cost_cents: o.packaging,
        });
        ok++;
      } catch (e) {
        errors.push({ key: o.skus.join(" + "), error: (e as Error).message });
      }
    }
    setDone({ ok, errors });
    setBusy(false);
    toast(`${ok} vente(s) enregistrée(s)${errors.length ? `, ${errors.length} refusée(s)` : ""}`, errors.length ? "error" : "ok");
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <Card title="1. Fichier">
          <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line bg-bg p-4 text-center hover:border-fg/30">
            <FileUp size={26} className="text-muted" />
            <span className="font-semibold">{file ?? "Choisir un fichier CSV"}</span>
            <span className="text-xs text-muted">Une ligne par article vendu · même « Réf commande » = vendus ensemble</span>
            <input type="file" accept=".csv,text/csv" className="sr-only" aria-label="Fichier CSV" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          {orders.length > 0 && (
            <p className="mt-3 text-sm">
              <b>{orders.length}</b> vente{orders.length > 1 ? "s" : ""} · <b className="text-emerald-700 dark:text-emerald-400">{ready.length} prêtes</b>
              {blocked.length > 0 && <> · <b className="text-red-600 dark:text-red-400">{blocked.length} bloquées</b></>}
            </p>
          )}
          {blocked.length > 0 && (
            <ul className="mt-2 max-h-40 overflow-auto rounded-lg bg-red-50 p-2 text-sm text-red-900 dark:bg-red-500/10 dark:text-red-200">
              {blocked.map((o) => <li key={o.key}>Ligne {o.lines.join(", ")} : {o.problems.join(" · ")}</li>)}
            </ul>
          )}
        </Card>

        {ready.length > 0 && (
          <Card title={`2. Ventes à enregistrer (${ready.length})`}>
            <div className="-mx-4 -mb-4 overflow-x-auto">
              <table className="data">
                <thead><tr><th>Article(s)</th><th>Date</th><th>Acheteur</th><th className="num">Prix</th><th className="num">Port + emballage</th></tr></thead>
                <tbody>
                  {ready.slice(0, 50).map((o) => (
                    <tr key={o.key}>
                      <td className="font-mono">{o.skus.join(" + ")}</td>
                      <td>{o.soldAt ? new Date(o.soldAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "maintenant"}</td>
                      <td>{o.buyer}</td>
                      <td className="num">{money(o.grossCents)}</td>
                      <td className="num">{money(o.shipping + o.packaging)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {done && (
          <Card title="Résultat">
            <p><b>{done.ok}</b> vente(s) enregistrée(s), à expédier depuis le poste Expédition.</p>
            {done.errors.length > 0 && (
              <ul className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-900 dark:bg-red-500/10 dark:text-red-200">
                {done.errors.map((e) => <li key={e.key}>{e.key} : {e.error}</li>)}
              </ul>
            )}
            <div className="mt-3 flex gap-2">
              <Link className={btn.secondary} href="/ventes">Voir les ventes</Link>
              <Link className={btn.secondary} href="/postes/expedition">Expédition</Link>
            </div>
          </Card>
        )}
      </div>

      <div className="space-y-4">
        <Card title="Modèle">
          <p className="mb-3 text-sm text-muted">
            Colonnes : SKU et Prix de vente (obligatoires), Date de vente, Acheteur, Réf commande, Frais de port, Emballage,
            Frais plateforme (sinon calculés selon Paramètres).
          </p>
          <button className={`${btn.secondary} w-full`} onClick={() => downloadCsv("modele-ventes.csv", TEMPLATE)}>
            <Download size={16} /> Télécharger le modèle
          </button>
        </Card>
        <Card title="3. Enregistrer">
          <p className="mb-3 text-sm text-muted">Les articles doivent être en ligne, réservés ou prêts à publier. Les ventes passent ensuite « à expédier ».</p>
          <button className={btn.huge} disabled={busy || ready.length === 0 || !!done} onClick={run}>
            {busy ? "Enregistrement…" : `Enregistrer ${ready.length} vente${ready.length > 1 ? "s" : ""}`}
          </button>
        </Card>
      </div>
    </div>
  );
}
