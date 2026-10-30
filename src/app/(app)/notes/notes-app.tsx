"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Pin, PinOff, Plus, Search, Trash2, Users, Lock } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { useToast } from "@/components/toast";
import { errorMessage } from "@/lib/errors";
import { fold } from "@/lib/nav";
import { input } from "@/components/ui";

export interface Note { id: string; title: string; body: string; pinned: boolean; shared: boolean; author_id: string; updated_at: string }
type Patch = Partial<Pick<Note, "title" | "body" | "pinned" | "shared">>;
type Status = "saved" | "saving" | "error";

const SAVE_MS = 600;
const when = (iso: string) => {
  const d = new Date(iso), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
};
/** The name of a note: its title, or its first line */
const heading = (n: Note) => n.title.trim() || n.body.trim().split("\n")[0].slice(0, 80) || "Nouvelle note";
const excerpt = (n: Note) => (n.title.trim() ? n.body : n.body.split("\n").slice(1).join(" ")).replace(/\s+/g, " ").trim().slice(0, 120);
const order = (a: Note, b: Note) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at);

export function NotesApp({ initial, me, names, open }: { initial: Note[]; me: string; names: Record<string, string>; open: string | null }) {
  const toast = useToast();
  const [notes, setNotes] = useState(initial);
  const [current, setCurrent] = useState<string | null>(open && initial.some((n) => n.id === open) ? open : null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status>("saved");
  const pending = useRef<Map<string, Patch>>(new Map());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const note = notes.find((n) => n.id === current) ?? null;
  const mine = note?.author_id === me;

  /** Sends what was typed (all notes with changes waiting) */
  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const batch = [...pending.current.entries()];
    pending.current.clear();
    if (!batch.length) return;
    setStatus("saving");
    try {
      for (const [id, patch] of batch) {
        const { error } = await supabaseBrowser().from("notes").update(patch).eq("id", id);
        if (error) throw error;
      }
      setStatus("saved");
    } catch (e) {
      // keep the changes to try again on the next keystroke
      for (const [id, patch] of batch) pending.current.set(id, { ...patch, ...pending.current.get(id) });
      setStatus("error");
      toast(`Note non enregistrée : ${errorMessage(e)}`, "error");
    }
  }, [toast]);

  const change = (patch: Patch, now = false) => {
    if (!note || !mine) return;
    setNotes((list) => list.map((n) => (n.id === note.id ? { ...n, ...patch, updated_at: new Date().toISOString() } : n)));
    pending.current.set(note.id, { ...pending.current.get(note.id), ...patch });
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    if (now) void flush();
    else timer.current = setTimeout(() => void flush(), SAVE_MS);
  };

  // nothing typed is lost: when leaving the page or the tab
  useEffect(() => {
    const save = () => { void flush(); };
    const warn = (e: BeforeUnloadEvent) => { if (pending.current.size) { save(); e.preventDefault(); } };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("visibilitychange", save);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("visibilitychange", save); save(); };
  }, [flush]);

  // the open note is in the address: a link to it, and back/forward work
  const select = (id: string | null) => {
    void flush();
    setCurrent(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("note", id); else url.searchParams.delete("note");
    window.history.replaceState(null, "", url);
  };

  async function create() {
    await flush();
    const { data, error } = await supabaseBrowser().from("notes").insert({ title: "", body: "" })
      .select("id, title, body, pinned, shared, author_id, updated_at").single();
    if (error || !data) return toast(`Impossible de créer la note : ${errorMessage(error)}`, "error");
    setNotes((list) => [data as Note, ...list].sort(order));
    setQ("");
    select(data.id);
    setTimeout(() => titleRef.current?.focus(), 50);
  }

  async function remove() {
    if (!note || !mine) return;
    const gone = note;
    pending.current.delete(gone.id);
    const { error } = await supabaseBrowser().from("notes").delete().eq("id", gone.id);
    if (error) return toast(`Note non supprimée : ${errorMessage(error)}`, "error");
    setNotes((list) => list.filter((n) => n.id !== gone.id));
    select(null);
    toast(`« ${heading(gone)} » supprimée`, "ok", {
      action: {
        label: "Annuler",
        run: async () => {
          const { data, error: e } = await supabaseBrowser().from("notes")
            .insert({ title: gone.title, body: gone.body, pinned: gone.pinned, shared: gone.shared })
            .select("id, title, body, pinned, shared, author_id, updated_at").single();
          if (e || !data) return toast(`Impossible de rétablir la note : ${errorMessage(e)}`, "error");
          setNotes((list) => [data as Note, ...list].sort(order));
          select(data.id);
        },
      },
    });
  }

  const shown = useMemo(() => {
    const words = fold(q).split(/\s+/).filter(Boolean);
    const list = [...notes].sort(order);
    return words.length ? list.filter((n) => words.every((w) => fold(`${n.title} ${n.body}`).includes(w))) : list;
  }, [notes, q]);

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]" data-testid="notes">
      {/* ── the list (on a phone: hidden while a note is open) */}
      <aside className={`space-y-3 ${note ? "hidden lg:block" : ""}`}>
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-2xl font-bold tracking-[-0.03em]">Notes</h1>
          <button onClick={create} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-fg" data-testid="new-note">
            <Plus size={18} /> Nouvelle note
          </button>
        </div>
        <label className="relative block">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input className={`${input} pl-9`} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher dans les notes" aria-label="Chercher dans les notes" />
        </label>
        {shown.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-muted">
            {q ? "Aucune note ne contient ces mots." : "Aucune note pour l'instant. « Nouvelle note » pour noter une idée, un contact, une procédure…"}
          </p>
        ) : (
          <ul className="space-y-1.5" aria-label="Mes notes">
            {shown.map((n) => (
              <li key={n.id}>
                <button onClick={() => select(n.id)} aria-current={n.id === current ? "true" : undefined} data-note={heading(n)}
                  className={`block w-full rounded-xl border px-3 py-2.5 text-left transition ${n.id === current ? "border-accent/40 bg-accent/10" : "border-line bg-panel/70 hover:border-fg/25"}`}>
                  <span className="flex items-center gap-1.5">
                    {n.pinned && <Pin size={13} className="shrink-0 text-highlight" aria-label="Épinglée" />}
                    <span className="min-w-0 flex-1 truncate font-medium">{heading(n)}</span>
                    {n.shared && <Users size={13} className="shrink-0 text-muted" aria-label="Partagée avec l'équipe" />}
                    <span className="shrink-0 text-xs text-muted">{when(n.updated_at)}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted">
                    {n.author_id !== me && <>{names[n.author_id] ?? "L'équipe"} · </>}{excerpt(n) || "Pas de texte"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* ── the open note */}
      <section className={`${note ? "" : "hidden lg:flex"} min-h-[60vh] flex-col rounded-2xl border border-line bg-panel/80 p-4 sm:p-5 lg:flex`} aria-label="Note">
        {!note ? (
          <div className="m-auto max-w-sm text-center text-sm text-muted">
            Choisissez une note à gauche, ou créez-en une. Tout est enregistré pendant que vous écrivez.
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <button onClick={() => select(null)} aria-label="Retour aux notes" className="-ml-2 flex size-11 items-center justify-center rounded-xl text-muted hover:text-fg lg:hidden"><ArrowLeft size={20} /></button>
              <span className="mr-auto text-xs text-muted" role="status" data-testid="save-status">
                {!mine ? `Note de ${names[note.author_id] ?? "l'équipe"}, partagée : lecture seule`
                  : status === "saving" ? "Enregistrement…" : status === "error" ? "Pas enregistré : nouvel essai à la prochaine frappe" : `Enregistré · ${when(note.updated_at)}`}
              </span>
              {mine && (
                <>
                  <button onClick={() => change({ pinned: !note.pinned }, true)} aria-pressed={note.pinned}
                    className={`inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm ring-1 ring-inset ${note.pinned ? "bg-highlight/10 text-highlight ring-highlight/30" : "text-muted ring-line hover:text-fg"}`}>
                    {note.pinned ? <PinOff size={16} /> : <Pin size={16} />} {note.pinned ? "Désépingler" : "Épingler"}
                  </button>
                  <button onClick={() => change({ shared: !note.shared }, true)} aria-pressed={note.shared} data-testid="share"
                    title={note.shared ? "Toute l'équipe peut la lire" : "Vous seul la voyez"}
                    className={`inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm ring-1 ring-inset ${note.shared ? "bg-accent/10 text-accent ring-accent/30" : "text-muted ring-line hover:text-fg"}`}>
                    {note.shared ? <Users size={16} /> : <Lock size={16} />} {note.shared ? "Partagée avec l'équipe" : "Privée"}
                  </button>
                  <button onClick={remove} aria-label="Supprimer la note" className="flex size-11 items-center justify-center rounded-xl text-muted hover:bg-red-500/10 hover:text-red-500"><Trash2 size={18} /></button>
                </>
              )}
            </div>
            <input ref={titleRef} value={note.title} onChange={(e) => change({ title: e.target.value })} readOnly={!mine} maxLength={200}
              placeholder="Titre" aria-label="Titre de la note" name="note-title"
              className="w-full bg-transparent text-xl font-semibold tracking-[-0.02em] outline-none placeholder:text-muted/60 sm:text-2xl" />
            <textarea value={note.body} onChange={(e) => change({ body: e.target.value })} readOnly={!mine} maxLength={100000}
              placeholder="Écrivez ici…" aria-label="Texte de la note" name="note-body"
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); void flush(); } }}
              className="mt-3 min-h-[50vh] w-full flex-1 resize-none bg-transparent text-[15px] leading-relaxed outline-none placeholder:text-muted/60" />
          </>
        )}
      </section>
    </div>
  );
}
