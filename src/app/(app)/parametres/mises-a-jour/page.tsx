import { redirect } from "next/navigation";
import { revalidateTag } from "next/cache";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { Card, PageHeader, btn } from "@/components/ui";
import { requireManager } from "@/lib/session";
import { applyMigrations, autoApplyAvailable, checkPendingMigrations, migrationSql, supabaseProject } from "@/lib/migrations";
import { CopySql } from "./copy-sql";
import { RefreshOnce } from "@/components/db-updates-banner";

export const metadata = { title: "Mises à jour de la base" };
export const dynamic = "force-dynamic";

async function recheck() {
  "use server";
  await requireManager();
  revalidateTag("migrations");
  redirect("/parametres/mises-a-jour?verifie=1");
}

async function applyAll() {
  "use server";
  const ctx = await requireManager();
  if (ctx.role !== "admin") redirect("/parametres/mises-a-jour?erreur=" + encodeURIComponent("Réservé à l'administrateur."));
  const pending = await checkPendingMigrations();
  const r = await applyMigrations(pending);
  revalidateTag("migrations");
  const qs = new URLSearchParams({ appliquees: String(r.applied.length), ...(r.error ? { erreur: r.error } : {}) });
  redirect(`/parametres/mises-a-jour?${qs}`);
}

export default async function Updates({ searchParams }: { searchParams: Promise<{ verifie?: string; appliquees?: string; erreur?: string }> }) {
  const ctx = await requireManager();
  const sp = await searchParams;
  const pending = await checkPendingMigrations();
  const files = await Promise.all(pending.map(async (f) => ({ file: f, sql: await migrationSql(f) })));
  const { sqlEditor } = supabaseProject();
  const auto = autoApplyAvailable() && ctx.role === "admin";

  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader back="/parametres" title="Mises à jour de la base"
        subtitle="Les nouvelles fonctions de Lefort OS ont parfois besoin d'une mise à jour de la base de données Supabase." />

      {(sp.appliquees || sp.verifie) && <RefreshOnce />}
      {sp.erreur && <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-100">{sp.erreur}</p>}
      {sp.appliquees && !sp.erreur && <p className="rounded-xl bg-accent/10 p-3 text-sm text-accent">{sp.appliquees === "1" ? "1 mise à jour appliquée." : `${sp.appliquees} mises à jour appliquées.`}</p>}

      {pending.length === 0 ? (
        <Card>
          <div className="flex items-center gap-3">
            <CheckCircle2 className="text-accent" />
            <div>
              <div className="font-semibold">La base est à jour.</div>
              <p className="text-sm text-muted">Toutes les fonctions de Lefort OS sont disponibles.{sp.verifie ? " (vérifié à l'instant)" : ""}</p>
            </div>
          </div>
        </Card>
      ) : (
        <>
          <Card>
            <p className="text-[15px]">
              <strong>{pending.length} mise{pending.length > 1 ? "s" : ""} à jour</strong> en attente. Tant qu&apos;elles ne sont pas faites,
              certaines pages affichent un message d&apos;erreur.
            </p>
            {auto ? (
              <form action={applyAll} className="mt-3">
                <button className={btn.primary}>{pending.length > 1 ? `Appliquer les ${pending.length} mises à jour maintenant` : "Appliquer la mise à jour maintenant"}</button>
                <p className="mt-1 text-xs text-muted">Exécutées une par une, dans l&apos;ordre. Chacune passe entièrement ou pas du tout ; à la première erreur, les suivantes ne sont pas lancées.</p>
              </form>
            ) : (
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
                <li>Copiez la première mise à jour ci-dessous (bouton « Copier le SQL »).</li>
                <li>Ouvrez l&apos;éditeur SQL de Supabase{sqlEditor ? "" : " (Supabase → SQL Editor → New query)"}, collez et cliquez sur « Run ».</li>
                <li>Recommencez avec la suivante, dans l&apos;ordre, puis cliquez sur « Vérifier ».</li>
              </ol>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {sqlEditor && <a href={sqlEditor} target="_blank" rel="noreferrer" className={btn.secondary}>Ouvrir l&apos;éditeur SQL <ExternalLink size={15} /></a>}
              <form action={recheck}><button className={btn.secondary}>Vérifier</button></form>
            </div>
          </Card>

          <ol className="space-y-2">
            {files.map((f, i) => (
              <li key={f.file} className="rounded-2xl border border-line bg-panel/80 p-4" data-migration={f.file}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex size-7 items-center justify-center rounded-full bg-panel-2 font-mono text-sm font-semibold">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-sm">{f.file}.sql</span>
                  <CopySql sql={f.sql} />
                </div>
                <p className="mt-1 pl-10 text-xs text-muted">{f.sql.split("\n").find((l) => l.startsWith("-- "))?.replace(/^-- (Lefort OS — )?/, "")}</p>
              </li>
            ))}
          </ol>

          {!auto && ctx.role === "admin" && (
            <details className="rounded-2xl border border-line bg-panel/80 p-4 text-sm text-muted">
              <summary className="cursor-pointer font-medium text-fg">Faire les mises à jour automatiquement à l&apos;avenir</summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>Sur supabase.com : Account → Access Tokens → « Generate new token ». Ce jeton donne accès à vos projets : gardez-le pour vous.</li>
                <li>Sur vercel.com, dans le projet lefort-os : Settings → Environment Variables → ajoutez <code className="text-fg">SUPABASE_ACCESS_TOKEN</code> avec ce jeton, puis redéployez.</li>
                <li>Revenez ici : un bouton « Appliquer » fera les mises à jour en un clic.</li>
              </ol>
            </details>
          )}
        </>
      )}
    </div>
  );
}
