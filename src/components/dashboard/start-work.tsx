"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, PackageCheck, PackageOpen, Play, Ruler, ScanLine, Send, Warehouse, X, type LucideIcon } from "lucide-react";
import { useScanApi } from "@/components/scan-provider";

export interface StartCounts { receive: number; photo: number; measure: number; publish: number; store: number; ship: number }

interface Task { key: keyof StartCounts | "scan"; label: string; hint: string; icon: LucideIcon; href?: string; photoMode?: string }

const TASKS: Task[] = [
  { key: "receive", label: "Réceptionner", hint: "Étiqueter et trier", icon: PackageOpen, href: "/postes/reception" },
  { key: "photo", label: "Photographier", hint: "Photos de l'article", icon: Camera, href: "/postes/photo", photoMode: "photo" },
  { key: "measure", label: "Mesurer", hint: "Mesures à plat", icon: Ruler, href: "/postes/photo", photoMode: "measure" },
  { key: "publish", label: "Publier", hint: "Texte, prix, Vinted", icon: Send, href: "/postes/publication" },
  { key: "store", label: "Ranger", hint: "Article → emplacement", icon: Warehouse, href: "/postes/rangement" },
  { key: "ship", label: "Expédier", hint: "Prélever et envoyer", icon: PackageCheck, href: "/postes/expedition" },
  { key: "scan", label: "Scanner un SKU", hint: "Ouvrir un article", icon: ScanLine },
];

/** Primary action of the dashboard: pick a task, land directly in the right station. */
export function StartWork({ counts }: { counts: StartCounts }) {
  const router = useRouter();
  const { openQuick } = useScanApi();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function go(task: Task) {
    setOpen(false);
    if (task.key === "scan") return openQuick();
    // the photo station remembers its mode: preselect it for the chosen task
    if (task.photoMode) {
      try { localStorage.setItem("photoMode", task.photoMode); } catch {}
    }
    router.push(task.href!);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="act-primary inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 sm:w-auto text-base font-bold text-accent-fg shadow-[0_0_28px_-6px_var(--accent)] transition hover:brightness-110 active:scale-[0.98]"
      >
        <Play size={18} fill="currentColor" /> Commencer le travail
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-label="Commencer le travail"
            className="w-full max-w-2xl rounded-t-2xl border border-line bg-panel p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-2xl sm:p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold">Que voulez-vous faire ?</h2>
              <button onClick={() => setOpen(false)} className="rounded-full p-2 text-muted hover:bg-line/50" aria-label="Fermer"><X size={20} /></button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {TASKS.map((t) => {
                const n = t.key === "scan" ? null : counts[t.key];
                const Icon = t.icon;
                return (
                  <button
                    key={t.label}
                    onClick={() => go(t)}
                    className={`group flex min-h-24 flex-col justify-between rounded-xl border p-3 text-left transition hover:border-accent active:scale-[0.98] ${
                      t.key === "scan" ? "col-span-2 border-dashed border-line sm:col-span-1" : "border-line"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <Icon size={22} className="text-fg/70 group-hover:text-accent" />
                      {n != null && (
                        <span className={`text-2xl figure font-semibold tabular-nums leading-none ${n ? "" : "text-muted/50"}`}>{n}</span>
                      )}
                    </div>
                    <div>
                      <div className="font-bold">{t.label}</div>
                      <div className="text-xs text-muted">{n === 0 ? "Rien en attente" : t.hint}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
