"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BACKUP_COOKIE, BACKUP_TABLES, buildBackup, type Row, type TableResult } from "@/lib/backup";
import { supabaseBrowser } from "@/lib/supabase/client";
import { btn } from "@/components/ui";
import { useToast } from "@/components/toast";

const PAGE = 1000;
/** Without these the file would not be a real backup: nothing is downloaded and the date is not recorded */
const ESSENTIAL = ["organizations", "batches", "items", "orders"];

async function readTable(table: string, order: string[]): Promise<TableResult> {
  const supabase = supabaseBrowser();
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select("*");
    for (const c of order) q = q.order(c, { ascending: true });
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) return { rows: [], error: error.message };
    rows.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < PAGE) return { rows };
  }
}

/** Downloads the whole shop as one ZIP, built in the browser, and remembers the date on this device */
export function BackupButton({ org }: { org: string }) {
  const [step, setStep] = useState<string | null>(null);
  const toast = useToast();
  const router = useRouter();

  async function run() {
    const tables = Object.entries(BACKUP_TABLES);
    const results: Record<string, TableResult> = {};
    try {
      // a few tables at a time: quick without hammering the database
      for (let i = 0; i < tables.length; i += 4) {
        setStep(`Lecture des données… ${Math.round((i / tables.length) * 100)} %`);
        const part = tables.slice(i, i + 4);
        const read = await Promise.all(part.map(([t, order]) => readTable(t, order)));
        part.forEach(([t], j) => { results[t] = read[j]; });
      }
      const missing = ESSENTIAL.filter((t) => results[t]?.error);
      if (missing.length) {
        toast(`Sauvegarde annulée : ${missing.join(", ")} illisible (${results[missing[0]].error}). Vérifiez la connexion et réessayez.`, "error");
        return;
      }
      setStep("Compression…");
      const at = new Date();
      const { zip, info } = buildBackup(results, org, at);
      const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: "application/zip" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: `sauvegarde-lefort-os-${at.toISOString().slice(0, 10)}.zip` });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      document.cookie = `${BACKUP_COOKIE}=${encodeURIComponent(at.toISOString())}; path=/; max-age=${60 * 60 * 24 * 400}; samesite=lax`;
      const skipped = Object.keys(info.errors).length;
      toast(`Sauvegarde téléchargée : ${info.total.toLocaleString("fr-FR")} lignes${skipped ? `, ${skipped} table${skipped > 1 ? "s" : ""} non lue${skipped > 1 ? "s" : ""} (voir LISEZMOI)` : ""}`, skipped ? "info" : "ok");
      router.refresh();
    } catch (e) {
      toast(`Sauvegarde impossible : ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setStep(null);
    }
  }

  return (
    <button type="button" onClick={run} disabled={step != null} className={btn.primary} aria-live="polite">
      {step ?? "Télécharger la sauvegarde"}
    </button>
  );
}
