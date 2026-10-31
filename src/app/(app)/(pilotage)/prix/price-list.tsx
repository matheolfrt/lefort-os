"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Check, ExternalLink, Clock } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/errors";
import { restorePrice, setPrice } from "@/lib/item-edits";
import { parisToday } from "@/lib/format";
import { addDays } from "@/lib/todos";
import { useToast } from "@/components/toast";
import { btn } from "@/components/ui";
import { reason, type Suggestion } from "@/lib/pricing";

const eur = (c: number) => `${Math.round(c / 100).toLocaleString("fr-FR")} €`;
const SKIP_DAYS = 7;

/**
 * Today's suggestions. Nothing changes until « Appliquer »: the price is then lowered in Lefort OS (with « Annuler »),
 * and it is up to you to change it on Vinted too. « Pas maintenant » puts a suggestion aside for a week.
 */
export function PriceList({ items }: { items: Suggestion[] }) {
  const router = useRouter();
  const toast = useToast();
  const [list, setList] = useState(items);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => { setList(items); setSelected(new Set()); }, [items]);
  const db = supabaseBrowser();

  const chosen = list.filter((s) => selected.has(s.id));
  const toggle = (id: string) => setSelected((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function apply(rows: Suggestion[]) {
    if (!rows.length) return;
    setBusy(true);
    const done: Suggestion[] = [];
    try {
      for (const s of rows) { await setPrice(s.id, s.suggested, s.min_price); done.push(s); }
      setList((l) => l.filter((x) => !done.some((d) => d.id === x.id)));
      toast(rows.length === 1
        ? `${rows[0].sku} : ${eur(rows[0].price)} → ${eur(rows[0].suggested)}. Changez-le aussi sur Vinted.`
        : `${done.length} prix baissés dans Lefort OS. Changez-les aussi sur Vinted (liste « Baissés cette semaine »).`, "ok", {
        action: { label: "Annuler", run: async () => {
          try { for (const s of done) await restorePrice(s.id, s.price, s.min_price); toast("Prix remis comme avant", "info"); }
          catch (e) { toast(`Impossible d'annuler : ${(e as Error).message}`, "error"); }
          router.refresh();
        } },
      });
    } catch (e) {
      toast(`${done.length ? `${done.length} appliqué(s), puis : ` : ""}${(e as Error).message}`, "error");
    }
    setSelected(new Set());
    setBusy(false);
    router.refresh();
  }

  async function skip(rows: Suggestion[]) {
    if (!rows.length) return;
    setBusy(true);
    const until = addDays(parisToday(), SKIP_DAYS);
    const { error } = await db.from("price_skips").upsert(rows.map((s) => ({ item_id: s.id, until })));
    setBusy(false);
    if (error) return toast(errorMessage(error), "error");
    setList((l) => l.filter((x) => !rows.some((r) => r.id === x.id)));
    setSelected(new Set());
    toast(`${rows.length > 1 ? `${rows.length} suggestions mises` : "Mise"} de côté pour ${SKIP_DAYS} jours`, "info", {
      action: { label: "Annuler", run: async () => {
        const { error: e } = await db.from("price_skips").delete().in("item_id", rows.map((r) => r.id));
        if (e) toast(errorMessage(e), "error");
        router.refresh();
      } },
    });
    router.refresh();
  }

  if (!list.length) {
    return <p className="rounded-2xl border border-dashed border-line bg-panel/40 p-6 text-center text-sm text-muted">Rien à baisser aujourd&apos;hui : vos prix suivent les règles.</p>;
  }
  const all = list.length > 0 && list.every((s) => selected.has(s.id));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-panel/80 px-3 py-2">
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="size-5 accent-[var(--accent)]" checked={all}
            onChange={() => setSelected(all ? new Set() : new Set(list.map((s) => s.id)))} />
          Tout sélectionner ({list.length})
        </label>
        <span className="ml-auto flex flex-wrap gap-2">
          <button type="button" className={btn.secondary} disabled={busy || !chosen.length} onClick={() => skip(chosen)}>
            <Clock size={16} /> Pas maintenant{chosen.length ? ` (${chosen.length})` : ""}
          </button>
          <button type="button" className={btn.primary} disabled={busy || !chosen.length} onClick={() => apply(chosen)}>
            <Check size={16} /> Appliquer{chosen.length ? ` (${chosen.length})` : ""}
          </button>
        </span>
      </div>
      <ul className="space-y-2">
        {list.map((s) => (
          <li key={s.id} data-price={s.sku}
            className={`flex gap-3 rounded-2xl border bg-panel/80 p-3 transition ${selected.has(s.id) ? "border-accent/50" : "border-line"}`}>
            <input type="checkbox" className="mt-1 size-5 shrink-0 accent-[var(--accent)]" checked={selected.has(s.id)} onChange={() => toggle(s.id)}
              aria-label={`Sélectionner ${s.sku}`} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <div className="min-w-0">
                  <Link prefetch={false} href={`/stock/${encodeURIComponent(s.sku)}`} className="font-mono font-semibold hover:text-accent">{s.sku}</Link>
                  <span className="ml-2 text-sm text-fg/85">{s.title ?? [s.category, s.brand].filter(Boolean).join(" · ")}{s.size ? ` · T${s.size}` : ""}</span>
                </div>
                <div className="figure tabular-nums">
                  <span className="text-muted line-through">{eur(s.price)}</span>
                  <span className="mx-1.5 text-muted">→</span>
                  <strong className="text-lg text-fg">{eur(s.suggested)}</strong>
                  <span className="ml-1.5 text-xs text-accent">−{Math.round(((s.price - s.suggested) / s.price) * 100)} %</span>
                </div>
              </div>
              <p className="mt-1 text-xs text-muted">{reason(s)}</p>
              <p className={`text-xs ${s.margin < 0 ? "text-red-300" : "text-muted"}`}>
                Marge si vendu à ce prix : <span className="figure font-semibold text-fg/90">{eur(s.margin)}</span> (coût {eur(s.cost)}, frais et envoi déduits)
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={`${btn.primary} min-h-10 px-3 text-sm`} disabled={busy} onClick={() => apply([s])}>Appliquer</button>
                <button type="button" className={`${btn.secondary} min-h-10 px-3 text-sm`} disabled={busy} onClick={() => skip([s])}>Pas maintenant</button>
                {s.url && <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-1 px-2 text-sm text-series-1 hover:underline">Annonce Vinted <ExternalLink size={14} /></a>}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
