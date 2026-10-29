"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Check, Rocket } from "lucide-react";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm";
import { btn, input } from "@/components/ui";
import { startListing } from "@/app/(app)/lots/[id]/actions";

const when = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).replace(" ", " à ");
/** value of a datetime-local input, in the browser's time */
const local = (iso: string) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

/**
 * The official start of the lot's listing. Not started: one big button (records now) — or, when items are already
 * online, a date to choose (never guessed; the first listing known to Lefort OS is only offered). Started: the date,
 * frozen; a manager can change it, with a confirmation.
 */
export function StartListing({ batchId, startedAt, editedAt, missing, suggested, isManager }: {
  batchId: string; startedAt: string | null; editedAt: string | null; missing: boolean; suggested: string | null; isManager: boolean;
}) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(() => local(startedAt ?? suggested ?? new Date().toISOString()));
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const run = (at: string | null, edit: boolean) => start(async () => {
    const r = await startListing(batchId, at, edit);
    if (r.error) toast(r.error, "error");
    else { toast(edit ? "Date de début modifiée" : "Mise en ligne commencée", "ok"); setEditing(false); router.refresh(); }
  });
  const save = async (edit: boolean) => {
    const at = new Date(value);
    if (Number.isNaN(at.getTime())) return toast("Date invalide", "error");
    if (edit && !(await confirm({ title: "Modifier la date de début de mise en ligne ?", confirmLabel: "Modifier",
      message: "Les trois indicateurs du lot (mise en ligne, liquidation, projection) seront recalculés à partir de cette date." }))) return;
    run(at.toISOString(), edit);
  };
  const picker = (edit: boolean) => (
    <div className="flex flex-wrap items-end gap-2">
      <label className="block">
        <span className="eyebrow-tight mb-1 block text-muted">Premier article mis en ligne le</span>
        <input type="datetime-local" value={value} max={local(new Date().toISOString())} onChange={(e) => setValue(e.target.value)}
          className={`${input} w-auto`} data-testid="start-date" />
      </label>
      <button type="button" className={btn.primary} disabled={pending} onClick={() => save(edit)}>Enregistrer</button>
      {edit && <button type="button" className={btn.secondary} onClick={() => setEditing(false)}>Annuler</button>}
    </div>
  );

  if (startedAt) {
    return (
      <div className="space-y-2" data-testid="listing-started">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent/15 px-4 font-semibold text-accent ring-1 ring-inset ring-accent/30">
            <Check size={18} /> Mise en ligne commencée
          </span>
          <span className="text-sm">Premier article mis en ligne le <b>{when(startedAt)}</b>{editedAt && <span className="text-muted"> · date modifiée le {when(editedAt)}</span>}</span>
          {isManager && !editing && (
            <button type="button" className="inline-flex min-h-11 items-center gap-1 text-sm text-muted underline-offset-2 hover:text-fg hover:underline" onClick={() => setEditing(true)}>
              <CalendarClock size={15} /> Modifier la date de début
            </button>
          )}
        </div>
        {editing && picker(true)}
      </div>
    );
  }
  if (missing) {
    return (
      <div className="space-y-3 rounded-2xl border border-amber-400/40 bg-amber-400/[0.07] p-4" data-testid="start-missing">
        <p className="font-semibold">⚠️ Date de début de mise en ligne non définie</p>
        <p className="text-sm text-muted">Des articles de ce lot sont déjà en ligne. Indiquez quand le premier a été publié : les indicateurs en dépendent. Aucune date n&apos;est inventée.</p>
        {!editing
          ? <button type="button" className={btn.primary} onClick={() => setEditing(true)}><CalendarClock size={18} /> Définir le premier article mis en ligne</button>
          : (
            <>
              {suggested && (
                <button type="button" className="text-sm text-accent underline-offset-2 hover:underline" onClick={() => setValue(local(suggested))}>
                  Utiliser la première publication connue dans Lefort OS : {when(suggested)}
                </button>
              )}
              {picker(false)}
            </>
          )}
      </div>
    );
  }
  return (
    <button type="button" disabled={pending} onClick={() => run(null, false)} data-testid="start-listing"
      className="inline-flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl bg-accent px-6 text-lg font-bold text-accent-fg shadow-[0_0_32px_-8px_var(--accent)] transition hover:brightness-110 active:scale-[0.99] disabled:opacity-60 sm:w-auto">
      <Rocket size={22} /> 🚀 Premier article mis en ligne
    </button>
  );
}
