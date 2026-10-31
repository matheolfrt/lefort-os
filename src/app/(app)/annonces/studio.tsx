"use client";
/* eslint-disable @next/next/no-img-element -- signed storage URLs and local previews, already compressed */

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check, CheckCheck, ClipboardCopy, ImagePlus, Loader2, Plus, Ruler, Sparkles, Star, Trash2, Undo2, Upload, Wand2, X,
} from "lucide-react";
import { btn, chip, input, seg } from "@/components/ui";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm";
import { supabaseBrowser } from "@/lib/supabase/client";
import { compressImage } from "@/lib/image";
import { PLACEHOLDERS, TITLE_MAX } from "@/lib/drafts/text";
import {
  addPhotos, applyMeasures, createDraft, deleteDraft, deletePhotos, generate, makeCover, saveTemplate, unassignPhoto, updateDraft,
} from "./actions";

export interface Draft {
  id: string; sku: string; item_id: string | null; measures: string; title: string; description: string; price_cents: number | null;
  status: "a_faire" | "genere" | "pret" | "envoye"; generated_by: "modele" | "ia" | null; generated_at: string | null; to_check: string[]; created_at: string;
}
export interface PhotoRow { id: string; draft_id: string | null; file_name: string | null; position: number; url: string | null }
interface Template { title_template: string; description_template: string; instructions: string }
interface Local { key: string; id?: string; url: string; name: string; state: "uploading" | "ready" | "error" }

const STATUS: Record<Draft["status"], { label: string; tone: string }> = {
  a_faire: { label: "À rédiger", tone: "bg-zinc-400/10 text-muted ring-zinc-400/25" },
  genere: { label: "À relire", tone: "bg-amber-400/10 text-amber-700 ring-amber-400/30 dark:text-amber-300" },
  pret: { label: "Prête", tone: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300" },
  envoye: { label: "Sur Vinted", tone: "bg-blue-500/10 text-blue-700 ring-blue-500/30 dark:text-blue-300" },
};
const FILTERS = [["tous", "Tous"], ["a_faire", "À rédiger"], ["genere", "À relire"], ["pret", "Prêtes"]] as const;
// positions of a batch of photos added now: after everything added before, in the order of the files
const batchBase = () => Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 60000) * 1000;

export function Studio({ orgId, drafts, photos, ai, template }: { orgId: string; drafts: Draft[]; photos: PhotoRow[]; ai: boolean; template: Template }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [local, setLocal] = useState<Local[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const lastPick = useRef<string | null>(null);
  const [sku, setSku] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("tous");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const serverIds = useMemo(() => new Set(photos.map((p) => p.id)), [photos]);
  const pile = photos.filter((p) => !p.draft_id);
  const pending_ = local.filter((l) => !l.id || !serverIds.has(l.id));
  const byDraft = useMemo(() => {
    const m = new Map<string, PhotoRow[]>();
    for (const p of photos) if (p.draft_id) m.set(p.draft_id, [...(m.get(p.draft_id) ?? []), p]);
    return m;
  }, [photos]);
  const uploading = local.filter((l) => l.state === "uploading").length;

  // ── adding photos ──
  async function addFiles(files: FileList | File[] | null) {
    const list = Array.from(files ?? []).filter((f) => f.type.startsWith("image/") || /\.(jpe?g|png|heic|webp)$/i.test(f.name));
    if (!list.length) return;
    list.sort((a, b) => a.lastModified - b.lastModified || a.name.localeCompare(b.name, "fr", { numeric: true }));
    const base = batchBase();
    const added: Local[] = list.map((f) => ({ key: crypto.randomUUID(), url: URL.createObjectURL(f), name: f.name, state: "uploading" }));
    setLocal((l) => [...l, ...added]);
    const sb = supabaseBrowser();
    let next = 0, failed = 0;
    const worker = async () => {
      while (next < list.length) {
        const i = next++;
        const f = list[i], l = added[i];
        try {
          const { blob, width, height } = await compressImage(f);
          const path = `${orgId}/brouillons/${crypto.randomUUID()}.jpg`;
          const up = await sb.storage.from("item-photos").upload(path, blob, { contentType: "image/jpeg" });
          if (up.error) throw up.error;
          const { data, error } = await sb.from("draft_photos").insert({
            org_id: orgId, storage_path: path, file_name: f.name.slice(0, 300), position: base + i, width, height, bytes: blob.size,
          }).select("id").single();
          if (error) throw error;
          setLocal((all) => all.map((x) => (x.key === l.key ? { ...x, id: data.id, state: "ready" } : x)));
        } catch {
          failed++;
          setLocal((all) => all.map((x) => (x.key === l.key ? { ...x, state: "error" } : x)));
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    toast(failed ? `${list.length - failed} photos ajoutées, ${failed} en échec` : `${list.length} photo${list.length > 1 ? "s" : ""} ajoutée${list.length > 1 ? "s" : ""}`, failed ? "error" : "ok");
    router.refresh();
  }

  // ── choosing photos of the pile (a click picks one, Maj+clic a run, as on a computer) ──
  function pick(id: string, range: boolean) {
    setPicked((cur) => {
      if (range && lastPick.current) {
        const ids = pile.map((p) => p.id);
        const a = ids.indexOf(lastPick.current), b = ids.indexOf(id);
        if (a >= 0 && b >= 0) {
          const run = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
          return [...cur.filter((x) => !run.includes(x)), ...run];
        }
      }
      lastPick.current = id;
      return cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    });
  }
  const pickedInOrder = pile.map((p) => p.id).filter((id) => picked.includes(id));

  const run = (fn: () => Promise<{ error: string | null }>, ok?: string, after?: () => void) => start(async () => {
    const r = await fn();
    if (r.error) toast(r.error, "error");
    else { if (ok) toast(ok, "ok"); after?.(); router.refresh(); }
  });

  const create = () => {
    if (!sku.trim()) return toast("Tapez le SKU de l'article", "error");
    const ids = pickedInOrder;
    run(async () => {
      const r = await createDraft(sku, ids);
      if (r.error === null) toast(`${sku.trim()} créé avec ${ids.length} photo${ids.length > 1 ? "s" : ""}${r.inStock ? " · trouvé dans le stock" : " · pas dans le stock"}`, "ok");
      return r;
    }, undefined, () => { setPicked([]); setSku(""); lastPick.current = null; });
  };

  const removePicked = async () => {
    if (!(await confirm({ title: `Supprimer ${pickedInOrder.length} photo${pickedInOrder.length > 1 ? "s" : ""} ?`, message: "Elles sont effacées pour de bon.", confirmLabel: "Supprimer", danger: true }))) return;
    run(() => deletePhotos(pickedInOrder), "Photos supprimées", () => setPicked([]));
  };

  // ── writing ──
  const generateAll = () => start(async () => {
    const todo = drafts.filter((d) => d.status === "a_faire");
    if (!todo.length) return toast("Aucun article à rédiger", "error");
    setProgress({ done: 0, total: todo.length });
    let failed = 0;
    for (let i = 0; i < todo.length; i++) {
      const r = await generate(todo[i].id, ai ? "ia" : "modele");
      if (r.error) { failed++; toast(r.error, "error"); }
      setProgress({ done: i + 1, total: todo.length });
    }
    setProgress(null);
    toast(failed ? `${todo.length - failed} rédigés, ${failed} en échec` : `${todo.length} annonce${todo.length > 1 ? "s" : ""} rédigée${todo.length > 1 ? "s" : ""} : relisez-les`, failed ? "error" : "ok");
    router.refresh();
  });

  const shown = drafts.filter((d) => filter === "tous" || d.status === filter);
  const counts = { a_faire: 0, genere: 0, pret: 0, envoye: 0 } as Record<Draft["status"], number>;
  for (const d of drafts) counts[d.status]++;

  return (
    <div className="space-y-4">
      <p className={`rounded-xl px-3 py-2 text-sm ${ai ? "bg-violet-500/10 text-violet-800 dark:text-violet-200" : "bg-fg/5 text-muted"}`} data-testid="ai-mode">
        {ai
          ? <><Sparkles size={14} className="mr-1 inline" /> IA activée : elle lit les photos (jusqu&apos;à 8 par article), vos mesures et votre modèle. Elle n&apos;invente rien et liste ce qu&apos;elle n&apos;a pas pu lire. Environ 5 à 10 centimes par article.</>
          : <>Sans IA pour l&apos;instant : votre modèle est rempli avec les données du stock et vos mesures. Pour que l&apos;IA lise aussi les photos (marque, couleur, matière…), ajoutez la variable <code className="font-mono text-xs">ANTHROPIC_API_KEY</code> dans Vercel puis redéployez.</>}
      </p>

      {/* ── 1. the pile ── */}
      <section className="rounded-2xl border border-line bg-panel/80 p-4" data-testid="pile"
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-title">1. Photos à trier <span className="figure text-muted">{pile.length + pending_.length}</span></h2>
          <div className="flex items-center gap-2">
            {uploading > 0 && <span className="text-sm text-muted"><Loader2 size={14} className="mr-1 inline animate-spin" />Envoi de {uploading}…</span>}
            <button type="button" onClick={() => fileRef.current?.click()} className={btn.sm} data-testid="add-photos"><ImagePlus size={16} /> Ajouter des photos</button>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} data-testid="file-input" />
          </div>
        </div>
        {pile.length + pending_.length === 0 ? (
          <button type="button" onClick={() => fileRef.current?.click()}
            className={`mt-3 flex min-h-36 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed text-sm text-muted transition ${drag ? "border-accent bg-accent/5" : "border-line hover:border-fg/30"}`}>
            <Upload size={22} /> Glissez toutes vos photos ici, ou touchez pour les choisir.
            <span className="text-xs">Elles restent dans l&apos;ordre où vous les avez prises.</span>
          </button>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted">Touchez les photos d&apos;un même article (Maj + clic pour une suite), tapez son SKU, puis « Créer l&apos;article ».</p>
            <div className={`mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8 ${drag ? "rounded-xl ring-2 ring-accent" : ""}`}>
              {pile.map((p) => {
                const n = pickedInOrder.indexOf(p.id);
                return (
                  <button key={p.id} type="button" onClick={(e) => pick(p.id, e.shiftKey)} data-photo={p.id} aria-pressed={n >= 0}
                    title={p.file_name ?? undefined}
                    className={`relative aspect-[3/4] overflow-hidden rounded-lg bg-fg/5 ring-inset transition ${n >= 0 ? "ring-4 ring-accent" : "ring-1 ring-line hover:ring-fg/30"}`}>
                    {p.url && <img src={p.url} alt="" loading="lazy" className="size-full object-cover" />}
                    {n >= 0 && <span className="absolute left-1 top-1 flex size-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-fg">{n + 1}</span>}
                  </button>
                );
              })}
              {pending_.map((l) => (
                <div key={l.key} className="relative aspect-[3/4] overflow-hidden rounded-lg bg-fg/5 ring-1 ring-inset ring-line">
                  <img src={l.url} alt="" className="size-full object-cover opacity-60" />
                  <span className={`absolute inset-x-1 bottom-1 rounded px-1 text-center text-[11px] font-medium ${l.state === "error" ? "bg-red-600 text-white" : "bg-bg/80"}`}>
                    {l.state === "error" ? "Échec" : "Envoi…"}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
        {pickedInOrder.length > 0 && (
          <div className="sticky bottom-20 z-10 mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel-2 p-2 shadow-lg md:bottom-3" data-testid="pick-bar">
            <b className="px-1 text-sm">{pickedInOrder.length} photo{pickedInOrder.length > 1 ? "s" : ""}</b>
            <form className="flex min-w-0 flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); create(); }}>
              <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU (ex. LSH-0123)" autoFocus aria-label="SKU de l'article"
                className={`${input} !min-h-10 min-w-0 flex-1 font-mono`} data-testid="sku-input" />
              <button className={btn.sm} disabled={pending}><Plus size={16} /> Créer l&apos;article</button>
            </form>
            {drafts.length > 0 && (
              <select className={`${input} !min-h-10 w-auto`} value="" aria-label="Ajouter à un article existant" data-testid="add-to"
                onChange={(e) => { const id = e.target.value; if (id) run(() => addPhotos(id, pickedInOrder), "Photos ajoutées", () => setPicked([])); }}>
                <option value="">Ajouter à…</option>
                {drafts.map((d) => <option key={d.id} value={d.id}>{d.sku}</option>)}
              </select>
            )}
            <button type="button" onClick={() => setPicked([])} className={btn.icon} aria-label="Tout désélectionner"><X size={16} /></button>
            <button type="button" onClick={removePicked} className={btn.icon} aria-label="Supprimer les photos choisies"><Trash2 size={16} /></button>
          </div>
        )}
      </section>

      {/* ── 2. measurements and model ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <MeasuresPanel disabled={!drafts.length} onDone={() => router.refresh()} />
        <TemplatePanel template={template} ai={ai} />
      </div>

      {/* ── 3. the articles ── */}
      <section className="space-y-3" data-testid="drafts">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-title">3. Articles <span className="figure text-muted">{drafts.length}</span></h2>
          {drafts.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <div role="tablist" className={seg.wrap}>
                {FILTERS.map(([k, l]) => (
                  <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className={seg.item(filter === k)}>
                    {l}{k !== "tous" && <span className="figure opacity-70">{counts[k]}</span>}
                  </button>
                ))}
              </div>
              <button type="button" onClick={generateAll} disabled={pending || !counts.a_faire} className={btn.sm} data-testid="generate-all">
                {progress ? <><Loader2 size={16} className="animate-spin" /> {progress.done}/{progress.total}</> : <><Wand2 size={16} /> Tout rédiger ({counts.a_faire})</>}
              </button>
            </div>
          )}
        </div>
        {!drafts.length && <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-muted">Pas encore d&apos;article : choisissez des photos ci-dessus et donnez-leur un SKU.</p>}
        {shown.map((d) => (
          <DraftCard key={d.id} d={d} photos={byDraft.get(d.id) ?? []} ai={ai} picked={pickedInOrder}
            onAddPicked={() => run(() => addPhotos(d.id, pickedInOrder), "Photos ajoutées", () => setPicked([]))} />
        ))}
        {drafts.length > 0 && <p className="text-xs text-muted">Bientôt : l&apos;extension Lefort OS mettra les annonces « prêtes » en brouillon sur Vinted, avec leurs photos.</p>}
      </section>
    </div>
  );
}

function MeasuresPanel({ disabled, onDone }: { disabled: boolean; onDone: () => void }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ applied: string[]; missing: string[]; orphan: number } | null>(null);
  return (
    <section className="rounded-2xl border border-line bg-panel/80 p-4" data-testid="measures">
      <h2 className="section-title"><Ruler size={16} className="mr-1 inline" />2. Mesures</h2>
      <p className="mt-1 text-sm text-muted">Collez le texte de toutes vos mesures : chaque ligne avec un SKU commence le bloc de cet article.</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} className={`${input} mt-2 py-2 font-mono text-sm`}
        placeholder={"LSH-0123\nÉpaules : 45 cm\nLongueur : 72 cm\n\nLSH-0124\n…"} aria-label="Mesures de tous les articles" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" disabled={disabled || pending || !text.trim()} className={btn.sm} data-testid="apply-measures"
          onClick={() => start(async () => {
            const r = await applyMeasures(text);
            if (r.error !== null) return toast(r.error, "error");
            setResult(r);
            toast(r.applied.length ? `Mesures réparties sur ${r.applied.length} article${r.applied.length > 1 ? "s" : ""}` : "Aucun SKU reconnu dans le texte", r.applied.length ? "ok" : "error");
            onDone();
          })}>
          <CheckCheck size={16} /> Répartir par SKU
        </button>
        {disabled && <span className="text-xs text-muted">Créez d&apos;abord les articles.</span>}
      </div>
      {result && (
        <p className="mt-2 text-sm" data-testid="measures-result">
          {result.applied.length > 0 && <span className="text-emerald-700 dark:text-emerald-300">✓ {result.applied.join(", ")}</span>}
          {result.missing.length > 0 && <span className="block text-muted">Sans mesures dans ce texte : {result.missing.join(", ")}</span>}
          {result.orphan > 0 && <span className="block text-muted">{result.orphan} ligne{result.orphan > 1 ? "s" : ""} avant le premier SKU ignorée{result.orphan > 1 ? "s" : ""}.</span>}
        </p>
      )}
    </section>
  );
}

function TemplatePanel({ template, ai }: { template: Template; ai: boolean }) {
  const toast = useToast();
  const [t, setT] = useState(template);
  const [pending, start] = useTransition();
  const descRef = useRef<HTMLTextAreaElement>(null);
  const insert = (key: string) => {
    const el = descRef.current, word = `{${key}}`;
    if (!el) return setT((x) => ({ ...x, description_template: x.description_template + word }));
    const a = el.selectionStart ?? t.description_template.length, b = el.selectionEnd ?? a;
    setT((x) => ({ ...x, description_template: x.description_template.slice(0, a) + word + x.description_template.slice(b) }));
  };
  const changed = JSON.stringify(t) !== JSON.stringify(template);
  return (
    <section className="rounded-2xl border border-line bg-panel/80 p-4" data-testid="template">
      <h2 className="section-title">Modèle d&apos;annonce</h2>
      <p className="mt-1 text-sm text-muted">Les mots entre accolades sont remplacés pour chaque article. Une ligne dont les mots sont inconnus disparaît.</p>
      <label className="mt-2 block text-sm"><span className="mb-1 block text-xs text-muted">Titre type</span>
        <input value={t.title_template} onChange={(e) => setT({ ...t, title_template: e.target.value })} className={`${input} !min-h-10`} data-testid="title-template" /></label>
      <label className="mt-2 block text-sm"><span className="mb-1 block text-xs text-muted">Description type</span>
        <textarea ref={descRef} value={t.description_template} onChange={(e) => setT({ ...t, description_template: e.target.value })} rows={8}
          className={`${input} py-2 text-sm`} data-testid="description-template" /></label>
      <div className="mt-1 flex flex-wrap gap-1">
        {PLACEHOLDERS.map((p) => (
          <button key={p.key} type="button" onClick={() => insert(p.key)} className={`${chip} bg-fg/5 text-muted ring-line hover:text-fg`} title={`Insérer ${p.label}`}>{`{${p.key}}`}</button>
        ))}
      </div>
      {ai && (
        <label className="mt-2 block text-sm"><span className="mb-1 block text-xs text-muted">Consignes pour l&apos;IA (ton, mots à éviter, phrase de fin…)</span>
          <textarea value={t.instructions} onChange={(e) => setT({ ...t, instructions: e.target.value })} rows={3} className={`${input} py-2 text-sm`}
            placeholder="Ex. : ton simple et direct, toujours finir par « Envoi rapide et soigné »" /></label>
      )}
      <button type="button" disabled={!changed || pending} className={`${btn.sm} mt-2`} data-testid="save-template"
        onClick={() => start(async () => { const r = await saveTemplate(t); toast(r.error ?? "Modèle enregistré", r.error ? "error" : "ok"); })}>
        <Check size={16} /> Enregistrer le modèle
      </button>
    </section>
  );
}

function DraftCard({ d, photos, ai, picked, onAddPicked }: { d: Draft; photos: PhotoRow[]; ai: boolean; picked: string[]; onAddPicked: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(d.title);
  const [desc, setDesc] = useState(d.description);
  const [measures, setMeasures] = useState(d.measures);
  const [price, setPrice] = useState(d.price_cents ? String(d.price_cents / 100).replace(".", ",") : "");
  const [editSku, setEditSku] = useState<string | null>(null);
  // the server's copy changed (generation, measures pasted): show it
  const now = `${d.title}\u0000${d.description}\u0000${d.measures}`;
  const [seen, setSeen] = useState(now);
  if (seen !== now) { setSeen(now); setTitle(d.title); setDesc(d.description); setMeasures(d.measures); }

  const save = (patch: Parameters<typeof updateDraft>[1], ok?: string) => start(async () => {
    const r = await updateDraft(d.id, patch);
    if (r.error) toast(r.error, "error"); else { if (ok) toast(ok, "ok"); router.refresh(); }
  });
  const gen = (mode: "ia" | "modele") => start(async () => {
    const r = await generate(d.id, mode);
    if (r.error !== null) toast(r.error, "error");
    else { toast(r.by === "ia" ? `${d.sku} rédigé par l'IA : relisez-le` : `${d.sku} rédigé avec le modèle`, "ok"); router.refresh(); }
  });
  const copy = (text: string, what: string) => navigator.clipboard?.writeText(text).then(() => toast(`${what} copié`, "ok")).catch(() => {});
  const locked = d.status === "pret" || d.status === "envoye";
  const st = STATUS[d.status];

  return (
    <article className="rounded-2xl border border-line bg-panel/80 p-4" data-draft={d.sku}>
      <header className="flex flex-wrap items-center gap-2">
        {editSku === null ? (
          <button type="button" onClick={() => setEditSku(d.sku)} className="font-mono text-base font-bold hover:underline" title="Changer le SKU">{d.sku}</button>
        ) : (
          <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); if (editSku.trim() && editSku !== d.sku) save({ sku: editSku }, "SKU changé"); setEditSku(null); }}>
            <input value={editSku} onChange={(e) => setEditSku(e.target.value)} autoFocus className={`${input} !min-h-9 w-40 font-mono`} aria-label="Nouveau SKU" />
            <button className={btn.icon} aria-label="Valider le SKU"><Check size={15} /></button>
          </form>
        )}
        <span className={`${chip} ${d.item_id ? "bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300" : "bg-fg/5 text-muted ring-line"}`} data-stock={d.item_id ? "oui" : "non"}>
          {d.item_id ? "Dans le stock" : "Pas dans le stock"}
        </span>
        <span className={`${chip} ${st.tone}`} data-status={d.status}>{st.label}</span>
        {d.generated_by && <span className="text-xs text-muted">{d.generated_by === "ia" ? "par l'IA" : "avec le modèle"}</span>}
        <button type="button" className={`${btn.icon} ml-auto`} aria-label={`Supprimer l'article ${d.sku}`} onClick={async () => {
          if (await confirm({ title: `Supprimer l'article ${d.sku} ?`, message: "Ses photos retournent dans les photos à trier.", confirmLabel: "Supprimer", danger: true }))
            start(async () => { const r = await deleteDraft(d.id); toast(r.error ?? "Article supprimé", r.error ? "error" : "ok"); router.refresh(); });
        }}><Trash2 size={15} /></button>
      </header>

      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {photos.map((p, i) => (
          <figure key={p.id} className="group relative aspect-[3/4] w-20 shrink-0 overflow-hidden rounded-lg bg-fg/5 ring-1 ring-inset ring-line sm:w-24">
            {p.url && <img src={p.url} alt="" loading="lazy" className="size-full object-cover" />}
            {i === 0 && <span className="absolute left-1 top-1 rounded bg-bg/85 px-1 text-[10px] font-semibold">Couverture</span>}
            <div className="absolute inset-x-0 bottom-0 flex justify-center gap-1 bg-bg/80 p-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
              {i > 0 && <button type="button" onClick={() => start(async () => { const r = await makeCover(p.id); if (r.error) toast(r.error, "error"); router.refresh(); })}
                className="rounded p-1 hover:bg-fg/10" aria-label="Mettre en couverture"><Star size={14} /></button>}
              <button type="button" onClick={() => start(async () => { const r = await unassignPhoto(p.id); if (r.error) toast(r.error, "error"); router.refresh(); })}
                className="rounded p-1 hover:bg-fg/10" aria-label="Remettre dans les photos à trier"><Undo2 size={14} /></button>
            </div>
          </figure>
        ))}
        {picked.length > 0 && (
          <button type="button" onClick={onAddPicked} className="flex aspect-[3/4] w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-accent text-xs text-accent sm:w-24">
            <Plus size={16} /> Ajouter {picked.length}
          </button>
        )}
        {!photos.length && !picked.length && <p className="text-sm text-muted">Aucune photo : choisissez-en dans les photos à trier.</p>}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <label className="block text-sm"><span className="mb-1 block text-xs text-muted">Mesures</span>
          <textarea value={measures} onChange={(e) => setMeasures(e.target.value)} rows={6} disabled={locked}
            onBlur={() => measures !== d.measures && save({ measures })} className={`${input} py-2 font-mono text-sm`} aria-label={`Mesures de ${d.sku}`}
            placeholder="Collez-les dans « Mesures », ou tapez-les ici" /></label>
        <div className="space-y-2">
          <label className="block text-sm">
            <span className="mb-1 flex justify-between text-xs text-muted"><span>Titre</span>
              <span className={title.length > TITLE_MAX ? "text-red-600" : ""}>{title.length} car.</span></span>
            <div className="flex gap-1">
              <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={locked} onBlur={() => title !== d.title && save({ title })}
                className={`${input} !min-h-10`} aria-label={`Titre de ${d.sku}`} placeholder="À écrire" />
              {title && <button type="button" onClick={() => copy(title, "Titre")} className={btn.icon} aria-label="Copier le titre"><ClipboardCopy size={15} /></button>}
            </div>
          </label>
          <label className="block text-sm"><span className="mb-1 block text-xs text-muted">Description</span>
            <div className="flex items-start gap-1">
              <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={8} disabled={locked} onBlur={() => desc !== d.description && save({ description: desc })}
                className={`${input} py-2 text-sm`} aria-label={`Description de ${d.sku}`} />
              {desc && <button type="button" onClick={() => copy(desc, "Description")} className={btn.icon} aria-label="Copier la description"><ClipboardCopy size={15} /></button>}
            </div>
          </label>
        </div>
      </div>

      {d.to_check.length > 0 && (
        <ul className="mt-2 space-y-0.5 rounded-xl bg-amber-500/10 p-2 text-sm text-amber-800 dark:text-amber-200" data-testid="to-check">
          {d.to_check.map((c, i) => <li key={i}>⚠ {c}</li>)}
        </ul>
      )}

      <footer className="mt-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-sm"><span className="text-xs text-muted">Prix</span>
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" disabled={locked} placeholder="—" aria-label={`Prix de ${d.sku}`}
            onBlur={() => { const v = Math.round(Number(price.replace(",", ".")) * 100); const next = Number.isFinite(v) && v > 0 ? v : null; if (next !== d.price_cents) save({ price_cents: next }); }}
            className={`${input} !min-h-10 !w-24 text-right figure`} /> €</label>
        <span className="flex-1" />
        {!locked && (
          <>
            {ai && <button type="button" onClick={() => gen("ia")} disabled={pending || !photos.length} className={btn.sm} data-action="generate-ai">
              {pending ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} {d.title ? "Réécrire avec l'IA" : "Rédiger avec l'IA"}</button>}
            <button type="button" onClick={() => gen("modele")} disabled={pending} className={ai ? btn.ghost : btn.sm} data-action="generate">
              <Wand2 size={16} /> {ai ? "Avec le modèle" : d.title ? "Refaire avec le modèle" : "Rédiger avec le modèle"}</button>
          </>
        )}
        {d.status === "genere" && <button type="button" onClick={() => save({ status: "pret" }, `${d.sku} prête`)} disabled={pending || !title.trim()} className={btn.ghost} data-action="ready"><Check size={16} /> Marquer prête</button>}
        {d.status === "pret" && <button type="button" onClick={() => save({ status: "genere" })} disabled={pending} className={btn.ghost} data-action="unready"><Undo2 size={16} /> À revoir</button>}
      </footer>
    </article>
  );
}

