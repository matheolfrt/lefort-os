"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, Link2, Undo2 } from "lucide-react";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm";
import { btn, input } from "@/components/ui";
import { ISSUE_TEXT, STATE_LABEL, eur, type IssueRow } from "@/lib/vinted-sync";
import { ackOrder, assignBySku, linkItem, resolve, resolveMany, setSyncFrom, undo, type Result } from "./actions";

const small = `${btn.secondary} min-h-10 px-3 text-sm`;
const smallPrimary = `${btn.primary} min-h-10 px-3 text-sm`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Paris" }) : "—");

/** Runs a server action, shows its answer, refreshes the page */
function useRun() {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const run = (fn: () => Promise<Result>, after?: () => void) => start(async () => {
    const r = await fn();
    toast(r.message, r.ok ? "ok" : "error");
    if (r.ok) { after?.(); router.refresh(); }
  });
  return { pending, run };
}

export function SyncFromForm({ current }: { current: string | null }) {
  const { pending, run } = useRun();
  const [date, setDate] = useState(current ?? new Date().toISOString().slice(0, 10));
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => setSyncFrom(date)); }}>
      <label className="block">
        <span className="eyebrow-tight mb-1 block text-muted">Enregistrer les ventes Vinted à partir du</span>
        <input type="date" required value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} className={`${input} w-auto`} data-testid="sync-from" />
      </label>
      <button className={btn.primary} disabled={pending}>{current ? "Modifier" : "Valider"}</button>
    </form>
  );
}

/** One Vinted sale waiting for a decision, with the possible answers */
export function DecisionCard({ row }: { row: IssueRow }) {
  const { pending, run } = useRun();
  const confirm = useConfirm();
  const c = row.candidates ?? {};
  const unknown = c.items ?? [];
  const [picked, setPicked] = useState<Record<string, string>>(
    () => Object.fromEntries(unknown.map((u) => [u.external_id, u.candidates[0]?.item_id ?? ""])));
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [other, setOther] = useState(row.issue === "unknown_items");
  const ignore = async () => {
    if (await confirm({ title: "Ignorer cette vente Vinted ?", message: "Elle ne sera plus proposée ni enregistrée. Vous pourrez la rétablir.", confirmLabel: "Ignorer" })) {
      run(() => resolve(row.id, "ignore", { note: "Ignorée depuis la synchro" }));
    }
  };

  return (
    <li data-issue={row.issue} data-tid={row.transaction_id} className="rounded-2xl border border-line bg-panel/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="font-semibold">{row.title || `Vente Vinted ${row.transaction_id}`}</p>
          <p className="text-sm text-muted">
            {day(row.sold_at)} · <span className="font-mono">{eur(row.price_cents)}</span>{row.buyer && ` · ${row.buyer}`} · {STATE_LABEL[row.state] ?? row.state}
            <span className="ml-1 font-mono text-xs">n° {row.transaction_id}</span>
          </p>
        </div>
        {row.order && (
          <Link prefetch={false} href={`/ventes?q=${row.order.number}`} className="text-sm text-accent hover:underline">V-{row.order.number}</Link>
        )}
      </div>
      {row.items.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {row.items.map((it) => (
            <li key={it.external_id} className="flex items-center gap-2 rounded-xl border border-line bg-bg/40 px-2 py-1 text-xs">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {it.photo && <img src={it.photo} alt="" className="size-8 rounded object-cover" />}
              <span className="max-w-[14rem] truncate">{it.title || `Annonce ${it.external_id}`}</span>
              {it.sku ? <Link prefetch={false} href={`/stock/${it.sku}`} className="font-mono font-semibold hover:text-accent">{it.sku}</Link>
                : <span className="text-amber-300">non reconnu</span>}
              <a href={`https://www.vinted.fr/items/${it.external_id}`} target="_blank" rel="noreferrer" aria-label="Voir sur Vinted" className="text-muted hover:text-fg"><ExternalLink size={12} /></a>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-sm">{ISSUE_TEXT[row.issue]}</p>

      <div className="mt-3 space-y-3">
        {row.issue === "possible_match" && (
          <div className="space-y-2">
            {(c.orders ?? []).map((o) => (
              <button key={o.order_id} type="button" disabled={pending} onClick={() => run(() => resolve(row.id, "link_order", { order_id: o.order_id }))}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-accent/40 bg-accent/5 px-3 py-2 text-left text-sm transition hover:bg-accent/10">
                <Check size={16} className="text-accent" />
                <span className="font-semibold">C&apos;est la vente V-{o.number}</span>
                <span className="text-muted">{day(o.sold_at)} · {eur(o.gross_cents)}{o.buyer && ` · ${o.buyer}`}{o.skus && ` · ${o.skus}`}</span>
              </button>
            ))}
            {!other && <button type="button" className="text-sm text-muted underline" onClick={() => setOther(true)}>Non, c&apos;est une autre vente</button>}
          </div>
        )}

        {(row.issue === "unknown_items" || (row.issue === "possible_match" && other)) && !c.no_detail && unknown.length > 0 && (
          <div className="space-y-3 rounded-xl border border-line p-3">
            <p className="text-sm font-medium">Quel article de Lefort OS est-ce ?</p>
            {unknown.map((u) => (
              <fieldset key={u.external_id} className="space-y-1.5">
                <legend className="text-xs text-muted">
                  Annonce « {u.title || u.external_id} »{u.brand && ` · ${u.brand}`}{u.size && ` · T${u.size}`}{u.price_cents != null && ` · ${eur(u.price_cents)}`}
                </legend>
                {u.candidates.map((it) => (
                  <label key={it.item_id} className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
                    <input type="radio" name={`${row.id}-${u.external_id}`} checked={picked[u.external_id] === it.item_id && !typed[u.external_id]}
                      onChange={() => { setPicked((p) => ({ ...p, [u.external_id]: it.item_id })); setTyped((t) => ({ ...t, [u.external_id]: "" })); }} />
                    <span className="font-mono font-semibold">{it.sku}</span>
                    <span className="truncate text-muted">{[it.title, it.brand, it.size && `T${it.size}`, eur(it.price_cents)].filter(Boolean).join(" · ")}</span>
                  </label>
                ))}
                <input className={`${input} max-w-60`} placeholder={u.candidates.length ? "ou un autre SKU" : "SKU de l'article (ex. LSH00123)"}
                  value={typed[u.external_id] ?? ""} onChange={(e) => setTyped((t) => ({ ...t, [u.external_id]: e.target.value }))} aria-label="SKU" />
              </fieldset>
            ))}
            <button type="button" className={smallPrimary} disabled={pending}
              onClick={() => run(() => assignBySku(row.id, unknown.map((u) => typed[u.external_id]?.trim()
                ? { external_id: u.external_id, sku: typed[u.external_id] } : { external_id: u.external_id, item_id: picked[u.external_id] || undefined })))}>
              Valider ces articles
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {(row.issue === "unknown_items" || (row.issue === "possible_match" && other)) && (
            <button type="button" className={small} disabled={pending}
              onClick={async () => {
                if (await confirm({ title: "Créer l'article et enregistrer la vente ?", confirmLabel: "Créer",
                  message: "Pour un article vendu sans être passé par le stock de Lefort OS. Son coût d'achat sera à compléter." })) {
                  // after « Non, c'est une autre vente », the look-alike sale typed by hand is not this one
                  run(() => resolve(row.id, "create_items", { historical: false, force: row.issue === "possible_match" }));
                }
              }}>Article jamais entré en stock : le créer</button>
          )}
          {row.issue === "cancelled_on_vinted" && (
            <button type="button" className={smallPrimary} disabled={pending} onClick={() => run(() => resolve(row.id, "cancel_in_lefort"))}>
              Annuler V-{c.number} dans Lefort OS
            </button>
          )}
          {row.issue === "voided_in_lefort" && (
            <button type="button" className={smallPrimary} disabled={pending} onClick={() => run(() => resolve(row.id, "reimport"))}>
              La réenregistrer
            </button>
          )}
          {row.issue === "price_diff" && (
            <>
              <button type="button" className={smallPrimary} disabled={pending} onClick={() => run(() => resolve(row.id, "use_vinted_price"))}>
                Prendre le prix Vinted ({eur(c.vinted_cents)})
              </button>
              <button type="button" className={small} disabled={pending} onClick={() => run(() => resolve(row.id, "accept_price"))}>
                Garder {eur(c.lefort_cents)}
              </button>
            </>
          )}
          {row.issue === "missing_price" && (
            <Link prefetch={false} href="/ventes?nouvelle=1" className={small}>Saisir la vente à la main</Link>
          )}
          {row.issue === "item_conflict" && (c as { items?: { sku: string; orders: { number: number; ref: string | null }[] }[] }).items?.map((it) => (
            <span key={it.sku} className="text-sm text-muted">
              <Link prefetch={false} href={`/stock/${it.sku}`} className="font-mono font-semibold text-fg hover:text-accent">{it.sku}</Link>
              {it.orders.length ? ` vendu dans ${it.orders.map((o) => `V-${o.number}${o.ref ? ` (réf. ${o.ref})` : ""}`).join(", ")}` : " n'est pas en vente"}
            </span>
          ))}
          <button type="button" className={`${small} text-muted`} disabled={pending} onClick={ignore}>Ignorer</button>
        </div>
      </div>
    </li>
  );
}

/** A sale sold before the start date */
export function BeforeStartActions({ id, allKnown, orders }: { id: string; allKnown: boolean; orders: { order_id: string; number: number }[] }) {
  const { pending, run } = useRun();
  return (
    <span className="flex flex-wrap gap-1.5">
      {/* already typed by hand: link it, never record it a second time */}
      {orders.map((o) => (
        <button key={o.order_id} type="button" className={smallPrimary} disabled={pending}
          onClick={() => run(() => resolve(id, "link_order", { order_id: o.order_id }))}>
          Déjà saisie : V-{o.number}
        </button>
      ))}
      {!orders.length && (
        <button type="button" className={small} disabled={pending}
          onClick={() => run(() => resolve(id, allKnown ? "import" : "create_items", { historical: true }))}>
          Enregistrer (historique)
        </button>
      )}
      <button type="button" className={`${small} text-muted`} disabled={pending} onClick={() => run(() => resolve(id, "ignore", { note: "Avant la date de début" }))}>
        Ignorer
      </button>
    </span>
  );
}

export function BulkIgnore({ ids }: { ids: string[] }) {
  const { pending, run } = useRun();
  const confirm = useConfirm();
  return (
    <button type="button" className={small} disabled={pending || !ids.length}
      onClick={async () => {
        if (await confirm({ title: `Ignorer ces ${ids.length} ventes anciennes ?`, confirmLabel: "Ignorer",
          message: "Elles sont déjà comptées ailleurs (avant Lefort OS). Vous pourrez les rétablir une par une." })) {
          run(() => resolveMany(ids, "ignore", { note: "Avant la date de début" }));
        }
      }}>Tout ignorer ({ids.length})</button>
  );
}

export function UndoButton({ id, label = "Annuler" }: { id: string; label?: string }) {
  const { pending, run } = useRun();
  const confirm = useConfirm();
  return (
    <button type="button" className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs text-muted hover:bg-fg/5 hover:text-fg" disabled={pending}
      onClick={async () => { if (await confirm({ title: "Annuler cette action ?", confirmLabel: "Annuler l'action", danger: true })) run(() => undo(id)); }}>
      <Undo2 size={13} /> {label}
    </button>
  );
}

export function UnignoreButton({ id }: { id: string }) {
  const { pending, run } = useRun();
  return <button type="button" className={small} disabled={pending} onClick={() => run(() => resolve(id, "unignore"))}>Rétablir</button>;
}

export function AckButton({ orderId }: { orderId: string }) {
  const { pending, run } = useRun();
  return <button type="button" className={small} disabled={pending} onClick={() => run(() => ackOrder(orderId))}>Normal : vendue hors Vinted</button>;
}

/** Links an item for sale to its Vinted listing: a suggestion in one click, or a pasted link */
export function LinkItem({ itemId, suggestions }: { itemId: string; suggestions: { external_id: string; title: string | null; url: string | null; photo: string | null; price_cents: number | null }[] }) {
  const { pending, run } = useRun();
  const [ref, setRef] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2">
      {suggestions.map((s) => (
        <button key={s.external_id} type="button" disabled={pending} onClick={() => run(() => linkItem(itemId, s.external_id))}
          className="flex items-center gap-2 rounded-xl border border-line px-2 py-1 text-left text-xs hover:border-accent/50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {s.photo && <img src={s.photo} alt="" className="size-8 rounded object-cover" />}
          <span className="max-w-[12rem] truncate">{s.title ?? s.external_id}</span>
          <span className="font-mono">{eur(s.price_cents)}</span>
          <Link2 size={13} className="text-accent" />
        </button>
      ))}
      <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (ref.trim()) run(() => linkItem(itemId, ref), () => setRef("")); }}>
        <input className={`${input} min-h-10 w-56 text-sm`} placeholder="Coller le lien Vinted" value={ref} onChange={(e) => setRef(e.target.value)} aria-label="Lien de l'annonce Vinted" />
        <button className={small} disabled={pending || !ref.trim()}>Lier</button>
      </form>
    </div>
  );
}
