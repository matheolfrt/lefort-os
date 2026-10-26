"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, FileUp, Printer } from "lucide-react";
import { useToast } from "@/components/toast";
import { Card, btn, input } from "@/components/ui";
import { downloadCsv, mapRows, parseCsv, parseCsvEuros } from "@/lib/csv";
import { INVENTORY_ALIASES, conditionCode, importStatusCode } from "@/lib/csv-fields";
import { rpc } from "@/lib/client-data";
import { STATUS_LABEL } from "@/i18n/fr";
import type { ItemStatus } from "@/lib/types";

interface Payload {
  sku?: string; category?: string; brand?: string; size?: string; condition?: string | null; color?: string;
  material?: string; pattern?: string; title?: string; description?: string; price_cents?: number | null;
  min_price_cents?: number | null; status?: string | null; location?: string; vinted_url?: string; cost_cents?: number | null;
}
interface Parsed { line: number; payload: Payload; problems: string[] }
interface Result { batch_id: string | null; created: number; updated: number; rows: { row: number; sku: string; action: string }[]; errors: { row: number; sku: string | null; error: string }[] }

const TEMPLATE = [
  ["SKU", "Catégorie", "Marque", "Taille", "État", "Couleur", "Matière", "Motif", "Titre", "Description", "Prix", "Prix minimum", "Statut", "Emplacement", "Lien Vinted", "Coût"],
  ["", "Blazer", "Hugo Boss", "50", "Très bon état", "Bleu marine", "Laine", "Uni", "Blazer Hugo Boss laine bleu marine T50", "", "45", "38", "Reçu", "", "", "12,50"],
];
const CHUNK = 300;

export function InventoryImport({ batches }: { batches: { id: string; code: string }[] }) {
  const toast = useToast();
  const [file, setFile] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Parsed[]>([]);
  const [unknown, setUnknown] = useState<string[]>([]);
  const [batchId, setBatchId] = useState("");
  const [update, setUpdate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Result | null>(null);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setResult(null);
    const { records, unknown } = mapRows(parseCsv(await f.text()), INVENTORY_ALIASES);
    setFile(f.name);
    setUnknown(unknown);
    setParsed(records.map((r, i) => {
      const problems: string[] = [];
      const money = (v: string | undefined, label: string) => {
        const c = parseCsvEuros(v);
        if (Number.isNaN(c)) { problems.push(`${label} invalide (« ${v} »)`); return null; }
        return c;
      };
      const condition = conditionCode(r.condition);
      if (condition === "invalid") problems.push(`État inconnu (« ${r.condition} »)`);
      // other labels ("Trié", "Vendu"…) are ignored for existing SKUs and refused by the server for new ones
      const status = importStatusCode(r.status);
      const payload: Payload = {
        sku: r.sku || undefined, category: r.category, brand: r.brand, size: r.size, color: r.color, material: r.material,
        pattern: r.pattern, title: r.title, description: r.description, location: r.location, vinted_url: r.vinted_url,
        condition: condition === "invalid" ? null : condition, status: status === "invalid" ? r.status : status,
        price_cents: money(r.price, "Prix"), min_price_cents: money(r.min_price, "Prix minimum"), cost_cents: money(r.cost, "Coût"),
      };
      if (!Object.values(payload).some((v) => v != null && v !== "")) problems.push("Ligne vide");
      return { line: i + 2, payload, problems };
    }));
  }

  const valid = parsed.filter((p) => !p.problems.length);
  const invalid = parsed.filter((p) => p.problems.length);

  async function run() {
    setBusy(true);
    setProgress(0);
    const total: Result = { batch_id: batchId || null, created: 0, updated: 0, rows: [], errors: [] };
    try {
      for (let i = 0; i < valid.length; i += CHUNK) {
        const chunk = valid.slice(i, i + CHUNK);
        const r = await rpc<Result>("import_items", {
          p_rows: chunk.map((p) => p.payload), p_batch_id: total.batch_id, p_update_existing: update,
        });
        // later chunks go into the batch the first one created
        total.batch_id = r.batch_id ?? total.batch_id;
        total.created += r.created;
        total.updated += r.updated;
        total.rows.push(...r.rows.map((x) => ({ ...x, row: chunk[x.row - 1].line })));
        total.errors.push(...r.errors.map((x) => ({ ...x, row: chunk[x.row - 1].line })));
        setProgress(Math.min(i + CHUNK, valid.length));
      }
      setResult(total);
      toast(`${total.created} créé(s), ${total.updated} mis à jour${total.errors.length ? `, ${total.errors.length} refusé(s)` : ""}`,
        total.errors.length ? "error" : "ok");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const created = result?.rows.filter((r) => r.action === "created").map((r) => r.sku) ?? [];
  const skipped = result?.rows.filter((r) => r.action === "skipped").length ?? 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <Card title="1. Fichier">
          <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line bg-bg p-4 text-center hover:border-fg/30">
            <FileUp size={26} className="text-muted" />
            <span className="font-semibold">{file ?? "Choisir un fichier CSV"}</span>
            <span className="text-xs text-muted">Séparateur « ; » ou « , » · une ligne par article · titres de colonnes en première ligne</span>
            <input type="file" accept=".csv,text/csv" className="sr-only" aria-label="Fichier CSV" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          {parsed.length > 0 && (
            <div className="mt-3 space-y-2 text-sm">
              <p><b>{parsed.length}</b> ligne{parsed.length > 1 ? "s" : ""} lue{parsed.length > 1 ? "s" : ""} · <b className="text-emerald-700 dark:text-emerald-400">{valid.length} prêtes</b>
                {invalid.length > 0 && <> · <b className="text-red-600 dark:text-red-400">{invalid.length} à corriger</b> (non importées)</>}</p>
              {unknown.length > 0 && <p className="text-muted">Colonnes ignorées : {unknown.join(", ")}</p>}
              {invalid.length > 0 && (
                <ul className="max-h-40 overflow-auto rounded-lg bg-red-50 p-2 text-red-900 dark:bg-red-500/10 dark:text-red-200">
                  {invalid.map((p) => <li key={p.line}>Ligne {p.line} : {p.problems.join(" · ")}</li>)}
                </ul>
              )}
            </div>
          )}
        </Card>

        {valid.length > 0 && (
          <Card title={`2. Aperçu (${Math.min(valid.length, 8)} premières lignes)`}>
            <div className="-mx-4 -mb-4 overflow-x-auto">
              <table className="data">
                <thead><tr><th>Ligne</th><th>SKU</th><th>Catégorie</th><th>Marque</th><th>Taille</th><th>Titre</th><th className="num">Prix</th><th>Statut</th></tr></thead>
                <tbody>
                  {valid.slice(0, 8).map((p) => (
                    <tr key={p.line}>
                      <td className="text-muted">{p.line}</td>
                      <td className="font-mono">{p.payload.sku || <span className="text-muted">auto</span>}</td>
                      <td>{p.payload.category}</td><td>{p.payload.brand}</td><td>{p.payload.size}</td>
                      <td className="max-w-64 truncate">{p.payload.title}</td>
                      <td className="num">{p.payload.price_cents != null ? (p.payload.price_cents / 100).toFixed(2).replace(".", ",") : ""}</td>
                      <td>{p.payload.status && p.payload.status in STATUS_LABEL ? STATUS_LABEL[p.payload.status as ItemStatus] : p.payload.status || <span className="text-muted">Reçu</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {result && (
          <Card title="Résultat">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-bg p-3"><div className="text-2xl font-black tabular-nums">{result.created}</div><div className="text-xs text-muted">créés</div></div>
              <div className="rounded-lg bg-bg p-3"><div className="text-2xl font-black tabular-nums">{result.updated}</div><div className="text-xs text-muted">mis à jour</div></div>
              <div className="rounded-lg bg-bg p-3"><div className={`text-2xl font-black tabular-nums ${result.errors.length ? "text-red-600 dark:text-red-400" : ""}`}>{result.errors.length}</div><div className="text-xs text-muted">refusés</div></div>
            </div>
            {skipped > 0 && <p className="mt-2 text-sm text-muted">{skipped} SKU déjà existant(s) laissé(s) tel(s) quel(s).</p>}
            {result.errors.length > 0 && (
              <>
                <ul className="mt-3 max-h-48 overflow-auto rounded-lg bg-red-50 p-2 text-sm text-red-900 dark:bg-red-500/10 dark:text-red-200">
                  {result.errors.map((e) => <li key={e.row}>Ligne {e.row}{e.sku ? ` (${e.sku})` : ""} : {e.error}</li>)}
                </ul>
                <button className={`${btn.secondary} mt-2`} onClick={() => downloadCsv("erreurs-import.csv", [["Ligne", "SKU", "Erreur"], ...result.errors.map((e) => [e.row, e.sku, e.error])])}>
                  <Download size={16} /> Rapport d&apos;erreurs
                </button>
              </>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {created.length > 0 && created.length <= 300 && (
                <a className={btn.primary} href={`/etiquettes/articles?skus=${created.join(",")}`} target="_blank"><Printer size={16} /> Étiquettes des {created.length} articles créés</a>
              )}
              <Link className={btn.secondary} href="/stock">Voir le stock</Link>
            </div>
          </Card>
        )}
      </div>

      <div className="space-y-4">
        <Card title="Modèle">
          <p className="mb-3 text-sm text-muted">
            Colonnes reconnues : SKU, Catégorie, Marque, Taille, État, Couleur, Matière, Motif, Titre, Description, Prix,
            Prix minimum, Statut, Emplacement, Lien Vinted, Coût. Toutes sont facultatives.
          </p>
          <button className={`${btn.secondary} w-full`} onClick={() => downloadCsv("modele-inventaire.csv", TEMPLATE)}>
            <Download size={16} /> Télécharger le modèle
          </button>
          <p className="mt-3 text-xs text-muted">
            Astuce : exportez votre stock, modifiez-le dans Excel, puis réimportez-le pour corriger beaucoup d&apos;articles d&apos;un coup.
          </p>
        </Card>
        <Card title="3. Options">
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-muted">Lot des nouveaux articles</span>
            <select className={input} value={batchId} onChange={(e) => setBatchId(e.target.value)}>
              <option value="">Nouveau lot « stock existant »</option>
              {batches.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
            </select>
          </label>
          <label className="mt-3 flex min-h-11 items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1 size-4 accent-[var(--accent)]" checked={update} onChange={(e) => setUpdate(e.target.checked)} />
            <span>Mettre à jour les articles existants (même SKU). Les cellules vides ne modifient rien ; le statut n&apos;est jamais changé par import.</span>
          </label>
          <button className={`${btn.huge} mt-3`} disabled={busy || valid.length === 0} onClick={run}>
            {busy ? `Import… ${progress}/${valid.length}` : `Importer ${valid.length} ligne${valid.length > 1 ? "s" : ""}`}
          </button>
        </Card>
      </div>
    </div>
  );
}
