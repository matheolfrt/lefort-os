"use client";

import { useState, useTransition } from "react";
import { Check, Copy, KeyRound, Play, Trash2 } from "lucide-react";
import { btn, input } from "@/components/ui";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm";
import type { CollectSummary } from "@/lib/market/collect";
import { createKey, revokeKey, runNow } from "./actions";

export interface CollectorState { id: string; label: string; last: { at: string; ok: boolean; http: number | null; error: string | null; seen: number } | null; ok7: number; runs7: number }
export interface KeyRow { id: string; label: string; created_at: string; last_used_at: string | null; revoked_at: string | null }

const when = (d: string) => new Date(d).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Each collector: when it last came, what Vinted answered; the test from this server; the keys */
export function Collectors({ collectors, keys, manager, supabaseUrl, anonKey, searchId }: {
  collectors: CollectorState[]; keys: KeyRow[]; manager: boolean; supabaseUrl: string; anonKey: string; searchId?: string;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<CollectSummary | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [label, setLabel] = useState("GitHub");

  const test = () => start(async () => {
    setResult(null);
    const r = await runNow(searchId ?? null);
    if (r.error) toast(r.error, "error");
    else { setResult(r.summary!); toast(r.summary!.searches.some((s) => s.ok) ? "Vinted a répondu : annonces enregistrées" : "Vinted n'a pas répondu normalement", r.summary!.searches.some((s) => s.ok) ? "ok" : "error"); }
  });
  const newKey = () => start(async () => {
    const r = await createKey(label);
    if (r.error) toast(r.error, "error"); else setFresh(r.key!);
  });
  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => toast("Copié", "ok")).catch(() => {});

  return (
    <section className="rounded-2xl border border-line bg-panel/80 p-4" data-testid="collectors">
      <h2 className="section-title">Collecteurs</h2>
      <p className="mt-1 text-sm text-muted">Ils lisent Vinted pour vos recherches et envoient ce qu&apos;ils ont vu. Si l&apos;un est refusé par Vinted, les autres continuent ; un refus est affiché ici, jamais caché.</p>
      <ul className="mt-3 divide-y divide-line">
        {collectors.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm" data-collector={c.id}>
            <span className={`size-2.5 shrink-0 rounded-full ${!c.last ? "bg-zinc-400" : c.last.ok ? "bg-emerald-500" : "bg-red-500"}`} aria-hidden />
            <b className="w-36 shrink-0">{c.label}</b>
            <span className="min-w-0 flex-1 text-muted">
              {!c.last ? "Pas encore passé." : c.last.ok
                ? <>Dernier passage {when(c.last.at)} · <span className="text-fg">{c.last.seen} annonces lues</span> · Vinted a répondu {c.last.http ?? "—"}</>
                : <>Dernier passage {when(c.last.at)} · <span className="text-red-700 dark:text-red-300">{c.last.error ?? `échec (HTTP ${c.last.http ?? "—"})`}</span></>}
            </span>
            {c.runs7 > 0 && <span className="text-xs text-muted">{c.ok7}/{c.runs7} réussis sur 7 j</span>}
          </li>
        ))}
      </ul>

      {manager && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={test} disabled={pending} className={btn.primary} data-testid="run-now"><Play size={16} /> {pending ? "Interrogation de Vinted…" : searchId ? "Lancer un passage maintenant" : "Tester la connexion à Vinted"}</button>
            <span className="text-xs text-muted">Depuis le serveur Lefort OS : une page d&apos;annonces, enregistrée comme un passage normal.</span>
          </div>
          {result && (
            <ul className="mt-2 space-y-1 rounded-xl bg-fg/5 p-3 text-sm" data-testid="run-result">
              {result.searches.length === 0 && <li>Aucune recherche active à collecter.</li>}
              {result.searches.map((s) => (
                <li key={s.id}>{s.ok ? "✓" : "✗"} <b>{s.name}</b> : {s.ok ? `${s.seen} annonces lues, ${s.checked} revues (Vinted a répondu ${s.http})` : s.error ?? `échec (HTTP ${s.http ?? "—"})`}</li>
              ))}
              {result.searches.some((s) => s.http === 403) && (
                <li className="pt-1 text-muted" data-testid="blocked-hint">Ce test part des serveurs de Vercel, que Vinted refuse. Ça ne dit rien des autres collecteurs : installez GitHub Actions (page Niches Vinted → « Installer les collecteurs automatiques ») et lancez-le une fois pour voir si Vinted l&apos;accepte.</li>
              )}
            </ul>
          )}

          {!searchId && (
            <details className="mt-4" data-testid="setup">
              <summary className="min-h-10 cursor-pointer text-sm font-semibold">Installer les collecteurs automatiques (gratuits)</summary>
              <div className="mt-2 space-y-3 text-sm">
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-sm"><span className="mb-1 block text-xs text-muted">Nom de la clé</span>
                    <input className={`${input} !min-h-10 w-48`} value={label} onChange={(e) => setLabel(e.target.value)} /></label>
                  <button onClick={newKey} disabled={pending} className={btn.ghost} data-testid="new-key"><KeyRound size={15} /> Créer une clé de collecteur</button>
                </div>
                {fresh && (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3" data-testid="fresh-key">
                    <p className="font-medium">Votre clé (affichée une seule fois) :</p>
                    <div className="mt-1 flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded bg-bg px-2 py-1 font-mono text-xs">{fresh}</code>
                      <button onClick={() => copy(fresh)} className={btn.icon} aria-label="Copier la clé"><Copy size={15} /></button></div>
                  </div>
                )}
                <ol className="list-decimal space-y-2 pl-5">
                  <li><b>GitHub Actions</b> (toutes les heures) : sur GitHub, dépôt lefort-os → Settings → Secrets and variables → Actions → New repository secret, ajoutez :
                    <Secret name="LEFORT_SUPABASE_URL" value={supabaseUrl} copy={copy} />
                    <Secret name="LEFORT_SUPABASE_ANON_KEY" value={anonKey} copy={copy} />
                    <Secret name="LEFORT_MARKET_KEY" value={fresh ?? "la clé créée ci-dessus"} copy={fresh ? copy : undefined} />
                    puis onglet Actions → « Niches Vinted » → Run workflow pour un premier essai.</li>
                  <li><b>Vercel</b> (une fois par jour, en secours) : Vercel → projet → Settings → Environment Variables : <code className="font-mono text-xs">MARKET_COLLECTOR_KEY</code> (une autre clé) et <code className="font-mono text-xs">CRON_SECRET</code> (un mot de passe au choix), puis redéployez.</li>
                  <li><b>Cloudflare</b> (toutes les 20 minutes, une recherche à la fois) : voir le dossier <code className="font-mono text-xs">collector/cloudflare</code> du projet.</li>
                </ol>
                {keys.length > 0 && (
                  <ul className="divide-y divide-line rounded-xl border border-line" data-testid="keys">
                    {keys.map((k) => (
                      <li key={k.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                        <KeyRound size={14} className="text-muted" /><span className="flex-1">{k.label}<span className="ml-2 text-xs text-muted">
                          {k.revoked_at ? "retirée" : k.last_used_at ? `utilisée ${when(k.last_used_at)}` : "jamais utilisée"}</span></span>
                        {!k.revoked_at && <button className={btn.icon} aria-label={`Retirer la clé ${k.label}`} onClick={async () => {
                          if (await confirm({ title: "Retirer cette clé ?", message: "Le collecteur qui l'utilise ne pourra plus rien envoyer.", confirmLabel: "Retirer", danger: true }))
                            start(async () => { await revokeKey(k.id); toast("Clé retirée", "ok"); });
                        }}><Trash2 size={15} /></button>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
          )}
        </>
      )}
    </section>
  );
}

function Secret({ name, value, copy }: { name: string; value: string; copy?: (t: string) => void }) {
  const [done, setDone] = useState(false);
  return (
    <span className="mt-1 flex items-center gap-2">
      <code className="shrink-0 font-mono text-xs font-semibold">{name}</code>
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted">{value}</code>
      {copy && <button type="button" className={btn.icon} aria-label={`Copier ${name}`} onClick={() => { copy(value); setDone(true); }}>{done ? <Check size={15} /> : <Copy size={15} />}</button>}
    </span>
  );
}
