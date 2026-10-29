import Link from "next/link";
import { ChevronRight, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ago, staleHours } from "@/lib/vinted-sync";

/** Urgent lines about the Vinted synchronisation: sales to check, no synchronisation for 2 days, no start date */
export async function VintedAlert() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("vinted_sync_status");
  if (error || !data) return null;
  const s = data as { ever: boolean; sync_from: string | null; last_ok_at: string | null; open_issues: number };
  if (!s.ever) return null;
  const lines: { key: string; text: string; strong: string; href: string }[] = [];
  if (s.open_issues > 0) {
    lines.push({ key: "issues", strong: `${s.open_issues} vente${s.open_issues > 1 ? "s" : ""} Vinted à vérifier`,
      text: "la synchronisation attend votre décision", href: "/ventes/vinted" });
  }
  const stale = staleHours(s.last_ok_at);
  if (stale == null || stale > 48) {
    lines.push({ key: "stale", strong: "Synchro Vinted arrêtée", text: `dernière réussite ${ago(s.last_ok_at)} : ouvrez Chrome avec l'extension`, href: "/ventes/vinted" });
  }
  if (!s.sync_from) {
    lines.push({ key: "start", strong: "Synchro Vinted en attente", text: "choisissez à partir de quand enregistrer les ventes", href: "/ventes/vinted#debut" });
  }
  return (
    <>
      {lines.map((l) => (
        <Link key={l.key} href={l.href} data-vinted-alert={l.key}
          className="flex min-h-12 items-center gap-3 rounded-2xl bg-amber-400/10 px-4 py-2.5 text-sm ring-1 ring-inset ring-amber-400/35 transition hover:bg-amber-400/15">
          <RefreshCw size={18} className="shrink-0 text-amber-300" />
          <span className="flex-1"><strong className="font-semibold">{l.strong}</strong> <span className="text-muted">{l.text}</span></span>
          <ChevronRight size={18} className="text-muted" />
        </Link>
      ))}
    </>
  );
}
