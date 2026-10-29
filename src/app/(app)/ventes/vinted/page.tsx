import Link from "next/link";
import { AlertTriangle, CheckCircle2, Download, ExternalLink, RefreshCw } from "lucide-react";
import { requireManager } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Card, Empty, PageHeader, btn } from "@/components/ui";
import { EVENT_LABEL, STATE_LABEL, UNDOABLE, ago, eur, staleHours, type EventRow, type Reconciliation } from "@/lib/vinted-sync";
import { AckButton, BeforeStartActions, BulkIgnore, DecisionCard, LinkItem, SyncFromForm, UndoButton, UnignoreButton } from "./controls";

export const metadata = { title: "Synchro Vinted" };

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" }) : "—");
const dateLong = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const RUN_STATUS = { ok: "réussie", partial: "terminée avec des erreurs", error: "en échec", running: "en cours" } as const;

function eventText(e: EventRow) {
  const d = e.detail as Record<string, string | number | boolean | string[] | null>;
  const n = d.number ? `V-${d.number}` : "";
  switch (e.action) {
    case "order_imported": return `${n} ${Array.isArray(d.items) ? d.items.join(", ") : ""} · ${eur(Number(d.price_cents ?? 0))}${d.historical ? " · historique" : ""}`;
    case "order_linked": return `${n} ← vente Vinted ${e.transaction_id}${d.match === "confirmed" ? " (confirmée par vous)" : ""}`;
    case "order_advanced": return `${n} : ${STATE_LABEL[String(d.from)] ?? d.from} → ${STATE_LABEL[String(d.to)] ?? d.to}`;
    case "order_cancelled": return `${n} annulée (annulée sur Vinted)`;
    case "listing_linked": return `${e.sku ?? ""} ↔ annonce ${e.external_id}${d.via === "sku" ? " (réf. dans la description)" : ""}`;
    case "price_replaced": return `V-${d.old_number} ${eur(Number(d.old_cents))} → ${eur(Number(d.new_cents))}`;
    case "undone": return EVENT_LABEL[String(d.action)] ?? "";
    default: return e.transaction_id ? `Vente Vinted ${e.transaction_id}` : "";
  }
}

export default async function VintedSync() {
  await requireManager();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("vinted_reconciliation", { p_days: 90 });
  if (error || !data) {
    return (
      <>
        <PageHeader title="Synchro Vinted" back="/ventes" />
        <Empty action={{ href: "/parametres/mises-a-jour", label: "Mettre à jour la base" }}>Cette page a besoin d&apos;une mise à jour de la base de données.</Empty>
      </>
    );
  }
  const r = data as Reconciliation;
  const stale = staleHours(r.last_ok_at);
  const vintedOnly = r.issues.length + r.before_start.count + r.sold_listings.length;

  return (
    <div className="space-y-6">
      <PageHeader title="Synchro Vinted" back="/ventes"
        subtitle="L'extension lit vos ventes Vinted ; ce qui est sûr est enregistré, ce qui ne l'est pas vous attend ici. Une vente n'est jamais enregistrée deux fois."
        actions={<a href="/lefort-os-vinted.zip" className={btn.secondary}><Download size={16} /> Extension</a>} />

      {/* ── State of the synchronisation */}
      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" data-testid="sync-state">
        <div className={`rounded-2xl border p-4 ${!r.ever || (stale != null && stale > 48) || r.last_run?.status === "error" ? "border-amber-400/40 bg-amber-400/[0.06]" : "border-line bg-panel/80"}`}>
          <div className="flex items-center gap-2 text-sm font-semibold">
            {r.last_run?.status === "error" || !r.ever || (stale != null && stale > 48) ? <AlertTriangle size={16} className="text-amber-300" /> : <CheckCircle2 size={16} className="text-accent" />}
            {r.ever ? `Dernière synchronisation réussie ${ago(r.last_ok_at)}` : "Pas encore de synchronisation"}
          </div>
          {r.last_run && (
            <p className="mt-1 text-sm text-muted">
              Dernier passage {r.last_run.source === "auto" ? "automatique" : "manuel"} {ago(r.last_run.started_at)} : {RUN_STATUS[r.last_run.status]}
              {r.last_run.error && <span className="block text-xs text-amber-300">{r.last_run.error.split("\n")[0]}</span>}
            </p>
          )}
          {(!r.ever || (stale != null && stale > 48)) && (
            <p className="mt-2 text-sm">
              {r.ever ? "Plus de 2 jours sans synchronisation : ouvrez Chrome, l'extension se relance seule (ou cliquez « Synchroniser maintenant » dans l'extension)."
                : "Installez l'extension Chrome (bouton « Extension »), connectez-la à Lefort OS : elle synchronise ensuite toute seule, toutes les heures."}
            </p>
          )}
        </div>
        <div className={`rounded-2xl border p-4 ${r.sync_from ? "border-line bg-panel/80" : "border-amber-400/40 bg-amber-400/[0.06]"}`} id="debut">
          {r.sync_from
            ? <p className="mb-2 text-sm">Les ventes vendues depuis le <b>{dateLong(r.sync_from)}</b> sont enregistrées toutes seules quand l&apos;article est reconnu. Les plus anciennes attendent votre accord.</p>
            : <p className="mb-2 text-sm"><b>Choisissez à partir de quand enregistrer les ventes Vinted.</b> Avant cette date, elles sont considérées comme déjà comptées (avant Lefort OS) : rien n&apos;est enregistré tant que la date n&apos;est pas choisie.</p>}
          <SyncFromForm current={r.sync_from} />
        </div>
      </div>

      {/* ── What waits for a decision */}
      <section aria-labelledby="todo-t" className="space-y-2">
        <h2 id="todo-t" className="section-title">À décider · {r.issues.length}</h2>
        {r.issues.length
          ? <ul className="space-y-2" data-testid="decisions">{r.issues.map((row) => <DecisionCard key={row.id} row={row} />)}</ul>
          : <p className="rounded-2xl border border-dashed border-line p-4 text-sm text-muted">Rien à décider : tout ce que Vinted a vendu est reconnu dans Lefort OS.</p>}
      </section>

      {/* ── Reconciliation over 90 days */}
      <section aria-labelledby="rec-t" className="space-y-3">
        <h2 id="rec-t" className="section-title">Rapprochement · 90 derniers jours</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" data-testid="reconciliation">
          <Count n={r.matched.count} label="ventes identiques des deux côtés" tone="good" />
          <Count n={vintedOnly} label="sur Vinted, pas (encore) dans Lefort OS" tone={vintedOnly ? "warn" : "good"} />
          <Count n={r.lefort_only?.length ?? null} label={r.lefort_only ? "dans Lefort OS, introuvables sur Vinted" : "dans Lefort OS seul : après une lecture complète"} tone={r.lefort_only?.length ? "warn" : "good"} />
        </div>

        {r.sold_listings.length > 0 && (
          <Card title={`Vendues sur Vinted, encore en vente dans Lefort OS · ${r.sold_listings.length}`}>
            <p className="mb-2 text-sm text-muted">L&apos;annonce est marquée vendue mais la vente n&apos;a pas encore été lue : elle le sera à la prochaine synchronisation. Si cela dure, vérifiez sur Vinted.</p>
            <ul className="divide-y divide-line text-sm">
              {r.sold_listings.map((s) => (
                <li key={s.external_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <Link prefetch={false} href={`/stock/${s.sku}`} className="font-mono font-semibold hover:text-accent">{s.sku}</Link>
                  <span className="min-w-0 flex-1 truncate text-muted">{s.title}</span>
                  <span className="font-mono">{eur(s.price_cents)}</span>
                  {s.url && <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-series-1 hover:underline">Vinted <ExternalLink size={12} /></a>}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {r.lefort_only && r.lefort_only.length > 0 && (
          <details open={r.lefort_only.length <= 8} className="rounded-2xl border border-line bg-panel/80 p-4">
            <summary className="flex min-h-11 cursor-pointer list-none items-center font-semibold [&::-webkit-details-marker]:hidden">Dans Lefort OS, introuvables sur Vinted · {r.lefort_only.length}</summary>
            <p className="mb-2 mt-1 text-sm text-muted">Ventes du canal Vinted que la dernière lecture complète n&apos;a pas trouvées sur Vinted (depuis le {day(r.covered_from)}). Vendue ailleurs ? Saisie en double ? Vérifiez, ou notez qu&apos;elle est normale.</p>
            <ul className="divide-y divide-line text-sm" data-testid="lefort-only">
              {r.lefort_only.map((o) => (
                <li key={o.order_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <Link prefetch={false} href={`/ventes?q=${o.number}`} className="font-mono font-semibold hover:text-accent">V-{o.number}</Link>
                  <span className="text-muted">{day(o.sold_at)} · {eur(o.gross_cents)}{o.buyer && ` · ${o.buyer}`} · {o.skus}</span>
                  {o.ref && <span className="font-mono text-xs text-muted">réf. {o.ref}</span>}
                  <span className="ml-auto"><AckButton orderId={o.order_id} /></span>
                </li>
              ))}
            </ul>
          </details>
        )}

        {r.before_start.count > 0 && (
          <details className="rounded-2xl border border-line bg-panel/80 p-4" data-testid="before-start">
            <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
              <span className="font-semibold">Ventes avant la date de début · {r.before_start.count}</span>
              {r.before_start.in_stock > 0 && <span className="text-sm text-amber-300">{r.before_start.in_stock} concernent des articles encore en stock dans Lefort OS</span>}
            </summary>
            <p className="mt-2 text-sm text-muted">Déjà comptées avant Lefort OS : ignorez-les. Si l&apos;article est encore en stock dans Lefort OS, enregistrez la vente comme historique (hors livre des recettes) pour le retirer du stock.</p>
            <div className="mt-2"><BulkIgnore ids={r.before_start.rows.filter((x) => !x.in_stock?.length && !x.orders?.length).map((x) => x.id)} /></div>
            <ul className="mt-2 divide-y divide-line text-sm">
              {r.before_start.rows.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="text-muted">{day(x.sold_at)}</span>
                  <span className="min-w-0 flex-1 truncate">{x.title || `Vente ${x.transaction_id}`}</span>
                  <span className="font-mono">{eur(x.price_cents)}</span>
                  {x.in_stock?.length ? <span className="text-xs text-amber-300">en stock : {x.in_stock.join(", ")}</span> : null}
                  <BeforeStartActions id={x.id} allKnown={x.items.length > 0 && x.items.every((i) => i.item_id)} orders={x.orders ?? []} />
                </li>
              ))}
            </ul>
          </details>
        )}

        {r.matched.count > 0 && (
          <details className="rounded-2xl border border-line bg-panel/80 p-4">
            <summary className="flex min-h-11 cursor-pointer list-none items-center font-semibold [&::-webkit-details-marker]:hidden">Ventes identiques · {r.matched.count}</summary>
            <ul className="mt-2 divide-y divide-line text-sm">
              {r.matched.rows.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                  <span className="text-muted">{day(m.sold_at)}</span>
                  <Link prefetch={false} href={`/ventes?q=${m.number}`} className="font-mono font-semibold hover:text-accent">V-{m.number}</Link>
                  <span className="min-w-0 flex-1 truncate text-muted">{m.title}</span>
                  <span className="font-mono">{eur(m.price_cents)}</span>
                  <span className="text-xs text-muted">Vinted : {STATE_LABEL[m.state]}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* ── Items on sale with no Vinted listing linked */}
      <section aria-labelledby="unl-t" className="space-y-2">
        <h2 id="unl-t" className="section-title">Articles en ligne sans lien Vinted · {r.unlinked_count}</h2>
        {r.unlinked_count ? (
          <>
            <p className="text-sm text-muted">
              Sans lien, une vente de ces articles ne peut pas être reconnue toute seule. Liez-les à leur annonce (suggestions de même marque et taille),
              ou ajoutez « Réf. SKU » à la fin de la description Vinted : la synchronisation fera le lien.
              {r.vinted_unlinked > 0 && ` ${r.vinted_unlinked} annonce(s) Vinted ne sont liées à aucun article.`}
            </p>
            <ul className="divide-y divide-line rounded-2xl border border-line bg-panel/80 px-4" data-testid="unlinked">
              {r.unlinked.map((u) => (
                <li key={u.item_id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center gap-x-3 text-sm">
                    <Link prefetch={false} href={`/stock/${u.sku}`} className="font-mono font-semibold hover:text-accent">{u.sku}</Link>
                    <span className="text-muted">{[u.title, u.brand, u.size && `T${u.size}`, eur(u.price_cents)].filter(Boolean).join(" · ")}</span>
                  </div>
                  <LinkItem itemId={u.item_id} suggestions={u.suggestions} />
                </li>
              ))}
            </ul>
            {r.unlinked_count > r.unlinked.length && <p className="text-xs text-muted">… et {r.unlinked_count - r.unlinked.length} autres.</p>}
          </>
        ) : <p className="text-sm text-muted">Tous les articles en ligne sont liés à leur annonce Vinted.</p>}
      </section>

      {/* ── Journal */}
      <section aria-labelledby="log-t" className="space-y-2">
        <h2 id="log-t" className="section-title">Journal</h2>
        {r.events.length ? (
          <ul className="divide-y divide-line rounded-2xl border border-line bg-panel/80 px-4" data-testid="journal">
            {r.events.map((e) => (
              <li key={e.id} data-event={e.action} className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm ${e.undone_at ? "opacity-50" : ""}`}>
                <span className="w-28 shrink-0 text-xs text-muted">{ago(e.at)}{e.auto ? " · auto" : ""}</span>
                <span className="font-medium">{EVENT_LABEL[e.action] ?? e.action}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{eventText(e)}</span>
                {e.undone_at ? <span className="text-xs text-muted">annulée</span>
                  : UNDOABLE.has(e.action) && <UndoButton id={e.id} />}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">Rien pour l&apos;instant.</p>}
      </section>

      {r.ignored.length > 0 && (
        <details className="rounded-2xl border border-line bg-panel/80 p-4">
          <summary className="flex min-h-11 cursor-pointer list-none items-center font-semibold [&::-webkit-details-marker]:hidden">Ventes ignorées · {r.ignored.length}</summary>
          <ul className="mt-2 divide-y divide-line text-sm">
            {r.ignored.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="text-muted">{day(x.sold_at)}</span>
                <span className="min-w-0 flex-1 truncate">{x.title || `Vente ${x.transaction_id}`}{x.note && <span className="text-muted"> · {x.note}</span>}</span>
                <span className="font-mono">{eur(x.price_cents)}</span>
                <UnignoreButton id={x.id} />
              </li>
            ))}
          </ul>
        </details>
      )}

      {r.runs.length > 0 && (
        <details className="rounded-2xl border border-line bg-panel/80 p-4 text-sm">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold [&::-webkit-details-marker]:hidden"><RefreshCw size={14} /> Dernières synchronisations</summary>
          <ul className="mt-2 divide-y divide-line">
            {r.runs.map((x) => (
              <li key={x.id} className="flex flex-wrap gap-x-3 py-1.5">
                <span className="w-28 text-muted">{ago(x.started_at)}</span>
                <span>{x.source === "auto" ? "Automatique" : "Manuelle"}{x.kind !== "orders" ? " + dressing" : ""}</span>
                <span className={x.status === "error" ? "text-red-300" : x.status === "partial" ? "text-amber-300" : "text-muted"}>{RUN_STATUS[x.status]}</span>
                <span className="text-muted">{Object.entries(x.summary ?? {}).filter(([k, v]) => v && EVENT_LABEL[k]).map(([k, v]) => `${v} ${EVENT_LABEL[k].toLowerCase()}`).join(" · ")}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Count({ n, label, tone }: { n: number | null; label: string; tone: "good" | "warn" }) {
  return (
    <div className={`rounded-2xl border p-3 ${tone === "warn" ? "border-amber-400/35 bg-amber-400/[0.05]" : "border-line bg-panel/80"}`}>
      <div className="font-mono text-2xl font-semibold tabular-nums">{n ?? "—"}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}
