"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Plus, Repeat as RepeatIcon, Star, Trash2, User } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/errors";
import { rpc } from "@/lib/client-data";
import { useToast } from "@/components/toast";
import { InlineEdit } from "@/components/inline-edit";
import { input as inputCls, btn } from "@/components/ui";
import {
  BUCKETS, BUCKET_LABEL, REPEAT_LABEL, TODO_COLUMNS, addDays, bucket, dueLabel, nextDue, parseQuick, sortTodos,
  type Repeat, type Todo,
} from "@/lib/todos";

interface Member { id: string; name: string }
const NONE: Todo[] = []; // a stable default: the list resets only when the server sends a new one
type Scope = "mine" | "all";

/**
 * The to-do list: the full page (/taches) or the short version of the dashboard (late and today, mine or nobody's).
 * Every change is saved at once; ticking, deleting and moving offer « Annuler ».
 */
export function TodoList({ initial, done = NONE, members, me, isManager, today, variant = "page" }: {
  initial: Todo[]; done?: Todo[]; members: Member[]; me: string; isManager: boolean; today: string; variant?: "page" | "dashboard";
}) {
  const router = useRouter();
  const toast = useToast();
  const [items, setItems] = useState(initial);
  const [doneItems, setDoneItems] = useState(done);
  useEffect(() => setItems(initial), [initial]);
  useEffect(() => setDoneItems(done), [done]);
  const [scope, setScope] = useState<Scope>(isManager && variant === "page" ? "all" : "mine");
  const names = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);
  const db = supabaseBrowser();

  const mine = (t: Todo) => !t.assigned_to || t.assigned_to === me;
  const visible = sortTodos(items.filter((t) => scope === "all" || mine(t)));
  const shown = variant === "dashboard" ? visible.filter((t) => ["late", "today"].includes(bucket(t, today))) : visible;

  const fail = (e: unknown) => toast(e instanceof Error ? e.message : errorMessage(e as never), "error");

  async function complete(t: Todo) {
    setItems((l) => l.filter((x) => x.id !== t.id));
    try {
      const next = await rpc<string | null>("complete_todo", { p_id: t.id });
      const again = next ? nextDue(t, today) : null;
      toast(again ? `« ${t.title} » faite · à refaire ${dueLabel(again, today).toLowerCase()}` : `« ${t.title} » faite`, "ok", {
        action: { label: "Annuler", run: async () => { try { await rpc("reopen_todo", { p_id: t.id }); } catch (e) { fail(e); } router.refresh(); } },
      });
    } catch (e) { fail(e); }
    router.refresh();
  }

  async function reopen(t: Todo) {
    setDoneItems((l) => l.filter((x) => x.id !== t.id));
    try { await rpc("reopen_todo", { p_id: t.id }); } catch (e) { fail(e); }
    router.refresh();
  }

  async function update(t: Todo, patch: Partial<Todo>, label?: string) {
    setItems((l) => l.map((x) => (x.id === t.id ? { ...x, ...patch } : x)));
    const { error } = await db.from("todos").update(patch).eq("id", t.id);
    if (error) { fail(error); setItems((l) => l.map((x) => (x.id === t.id ? t : x))); return; }
    if (label) {
      const before = Object.fromEntries(Object.keys(patch).map((k) => [k, t[k as keyof Todo]]));
      toast(label, "ok", { action: { label: "Annuler", run: async () => {
        const { error: e } = await db.from("todos").update(before).eq("id", t.id);
        if (e) fail(e);
        router.refresh();
      } } });
    }
    router.refresh();
  }

  async function remove(t: Todo) {
    setItems((l) => l.filter((x) => x.id !== t.id));
    const { error } = await db.from("todos").delete().eq("id", t.id);
    if (error) { fail(error); router.refresh(); return; }
    toast(`« ${t.title} » supprimée`, "info", { action: { label: "Annuler", run: async () => {
      const { error: e } = await db.from("todos").insert({
        id: t.id, title: t.title, notes: t.notes, due_on: t.due_on, important: t.important, assigned_to: t.assigned_to, repeat: t.repeat,
      });
      if (e) fail(e);
      router.refresh();
    } } });
    router.refresh();
  }

  async function add(row: { title: string; due_on: string | null; important: boolean; repeat: Repeat; assigned_to: string | null }) {
    const { data, error } = await db.from("todos").insert(row).select(TODO_COLUMNS).single();
    if (error) return fail(error), false;
    setItems((l) => [...l, data as Todo]);
    router.refresh();
    return true;
  }

  const groups = BUCKETS.map((b) => ({ b, list: shown.filter((t) => bucket(t, today) === b) })).filter((g) => g.list.length);

  return (
    <div className="space-y-4" data-todos={variant}>
      <AddTodo variant={variant} today={today} me={me} members={members} isManager={isManager} onAdd={add} />

      {variant === "page" && (
        <div role="radiogroup" aria-label="Afficher" className="inline-flex rounded-xl border border-line bg-panel/70 p-1 text-sm">
          {(["mine", "all"] as Scope[]).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={scope === s} onClick={() => setScope(s)}
              className={`min-h-9 rounded-lg px-3 font-medium ${scope === s ? "bg-accent/15 text-accent" : "text-muted hover:text-fg"}`}>
              {s === "mine" ? "Les miennes" : "Toute l'équipe"}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line bg-panel/40 p-6 text-center text-sm text-muted">
          {variant === "dashboard" ? "Rien de prévu aujourd'hui." : "Aucune tâche. Ajoutez la première ci-dessus : « Appeler le fournisseur demain »."}
        </p>
      ) : (
        groups.map(({ b, list }) => (
          <section key={b} aria-label={BUCKET_LABEL[b]}>
            {(variant === "page" || groups.length > 1) && (
              <h3 className={`eyebrow-tight mb-1.5 ${b === "late" ? "text-red-300" : "text-muted"}`}>{BUCKET_LABEL[b]} · {list.length}</h3>
            )}
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel/80">
              {list.map((t) => (
                <li key={t.id} data-todo={t.title} className="flex items-start gap-1 py-1 pl-1 pr-2">
                  <button type="button" onClick={() => complete(t)} aria-label={`Marquer « ${t.title} » comme faite`}
                    className="group flex size-11 shrink-0 items-center justify-center">
                    <span className="flex size-5 items-center justify-center rounded-full border-2 border-fg/30 transition group-hover:border-accent group-hover:bg-accent/15">
                      <Check size={12} strokeWidth={3} className="text-accent opacity-0 group-hover:opacity-100" />
                    </span>
                  </button>
                  <div className="min-w-0 flex-1 py-2">
                    {variant === "page"
                      ? <InlineEdit value={t.title} display={t.title} label={`Titre de « ${t.title} »`} onSave={(v) => v && update(t, { title: v })} />
                      : <span className="break-words">{t.title}</span>}
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                      {t.due_on && <span className={bucket(t, today) === "late" ? "font-semibold text-red-300" : ""}>{dueLabel(t.due_on, today)}</span>}
                      {t.repeat !== "none" && <span className="inline-flex items-center gap-1"><RepeatIcon size={12} /> {REPEAT_LABEL[t.repeat]}</span>}
                      {t.assigned_to && t.assigned_to !== me && <span className="inline-flex items-center gap-1"><User size={12} /> {names.get(t.assigned_to) ?? "?"}</span>}
                      {t.notes && <span className="truncate">{t.notes}</span>}
                    </div>
                  </div>
                  <button type="button" onClick={() => update(t, { important: !t.important })} aria-pressed={t.important}
                    aria-label={t.important ? "Retirer « important »" : "Marquer important"}
                    className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${t.important ? "text-highlight" : "text-muted/50 hover:text-fg"}`}>
                    <Star size={18} fill={t.important ? "currentColor" : "none"} />
                  </button>
                  {variant === "page" && (
                    <>
                      <input type="date" aria-label={`Date de « ${t.title} »`} value={t.due_on ?? ""}
                        onChange={(e) => update(t, { due_on: e.target.value || null }, `« ${t.title} » : ${e.target.value ? dueLabel(e.target.value, today).toLowerCase() : "sans date"}`)}
                        className="mt-1.5 hidden h-9 w-36 rounded-lg border border-line bg-bg/60 px-2 text-sm text-muted sm:block" />
                      {isManager && (
                        <select aria-label={`Pour qui : « ${t.title} »`} value={t.assigned_to ?? ""}
                          onChange={(e) => update(t, { assigned_to: e.target.value || null })}
                          className="mt-1.5 hidden h-9 max-w-36 rounded-lg border border-line bg-bg/60 px-2 text-sm text-muted md:block">
                          <option value="">Toute l&apos;équipe</option>
                          {members.map((m) => <option key={m.id} value={m.id}>{m.id === me ? "Moi" : m.name}</option>)}
                        </select>
                      )}
                      {(isManager || t.created_by === me) && (
                        <button type="button" onClick={() => remove(t)} aria-label={`Supprimer « ${t.title} »`}
                          className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted/60 hover:bg-red-500/15 hover:text-red-300">
                          <Trash2 size={17} />
                        </button>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {variant === "dashboard" && visible.length > shown.length && (
        <Link href="/taches" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-series-1 hover:underline">
          {visible.length - shown.length} autre{visible.length - shown.length > 1 ? "s" : ""} à venir <ChevronRight size={16} />
        </Link>
      )}

      {variant === "page" && doneItems.length > 0 && (
        <details className="rounded-2xl border border-line bg-panel/50 p-3">
          <summary className="cursor-pointer text-sm font-medium text-muted">Faites ces 7 derniers jours · {doneItems.length}</summary>
          <ul className="mt-2 space-y-1">
            {doneItems.map((t) => (
              <li key={t.id} data-done={t.title} className="flex items-center gap-2 text-sm">
                <Check size={16} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1 truncate text-muted line-through">{t.title}</span>
                <span className="hidden text-xs text-muted sm:inline">{t.done_by ? names.get(t.done_by) : ""}</span>
                <button type="button" onClick={() => reopen(t)} className="min-h-9 rounded-lg px-2 text-xs font-semibold text-muted hover:bg-fg/5 hover:text-fg">Reprendre</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const DATE_CHOICES = [
  { key: "none", label: "Sans date" },
  { key: "today", label: "Aujourd'hui" },
  { key: "tomorrow", label: "Demain" },
] as const;

function AddTodo({ variant, today, me, members, isManager, onAdd }: {
  variant: "page" | "dashboard"; today: string; me: string; members: Member[]; isManager: boolean;
  onAdd: (row: { title: string; due_on: string | null; important: boolean; repeat: Repeat; assigned_to: string | null }) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [when, setWhen] = useState<string>(variant === "dashboard" ? "today" : "none");
  const [repeat, setRepeat] = useState<Repeat>("none");
  const [who, setWho] = useState<string>(variant === "dashboard" ? me : "");
  const [busy, setBusy] = useState(false);
  const parsed = parseQuick(text, today);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!parsed.title || busy) return;
    const chosen = when === "today" ? today : when === "tomorrow" ? addDays(today, 1) : when === "none" ? null : when;
    setBusy(true);
    const ok = await onAdd({
      title: parsed.title,
      due_on: parsed.due_on ?? chosen ?? (repeat !== "none" ? today : null),
      important: parsed.important,
      repeat: parsed.repeat !== "none" ? parsed.repeat : repeat,
      assigned_to: who || null,
    });
    setBusy(false);
    if (ok) { setText(""); setRepeat("none"); }
  }

  const hint = text && (parsed.due_on || parsed.repeat !== "none" || parsed.important)
    ? [parsed.due_on && dueLabel(parsed.due_on, today), parsed.repeat !== "none" && REPEAT_LABEL[parsed.repeat].toLowerCase(), parsed.important && "important"].filter(Boolean).join(" · ")
    : null;

  return (
    <form onSubmit={submit} className={variant === "page" ? "space-y-2 rounded-2xl border border-line bg-panel/80 p-3" : ""}>
      <div className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} className={inputCls} maxLength={200} aria-label="Nouvelle tâche"
          placeholder={variant === "dashboard" ? "Ajouter une tâche pour aujourd'hui…" : "Nouvelle tâche… (ex. « Appeler Fripes & Co demain ! »)"} />
        <button className={`${btn.primary} shrink-0 px-3`} disabled={!parsed.title || busy} aria-label="Ajouter la tâche"><Plus size={18} /><span className="hidden sm:inline">Ajouter</span></button>
      </div>
      {hint && <p className="px-1 text-xs text-accent">→ {hint}</p>}
      {variant === "page" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {DATE_CHOICES.map((c) => (
            <button key={c.key} type="button" aria-pressed={when === c.key} onClick={() => setWhen(c.key)}
              className={`min-h-9 rounded-lg border px-3 ${when === c.key ? "border-accent/50 bg-accent/12 text-accent" : "border-line text-muted hover:text-fg"}`}>{c.label}</button>
          ))}
          <input type="date" aria-label="Autre date" value={/^\d{4}/.test(when) ? when : ""} onChange={(e) => setWhen(e.target.value || "none")}
            className="h-9 rounded-lg border border-line bg-bg/60 px-2 text-muted" />
          <select aria-label="Répéter" value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)} className="h-9 rounded-lg border border-line bg-bg/60 px-2 text-muted">
            {(Object.keys(REPEAT_LABEL) as Repeat[]).map((r) => <option key={r} value={r}>{REPEAT_LABEL[r]}</option>)}
          </select>
          <select aria-label="Pour qui" value={who} onChange={(e) => setWho(e.target.value)} className="h-9 rounded-lg border border-line bg-bg/60 px-2 text-muted">
            <option value="">Toute l&apos;équipe</option>
            <option value={me}>Moi</option>
            {isManager && members.filter((m) => m.id !== me).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
      )}
    </form>
  );
}
