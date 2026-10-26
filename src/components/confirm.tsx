"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { btn, input } from "./ui";

// In-app confirmation sheet, replacing window.confirm / window.prompt (awkward on iPhone, unstyled, easy to mis-tap).

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  /** asks for a short text (reason); required unless `optional` */
  reason?: { label: string; placeholder?: string; optional?: boolean; initial?: string };
  /** an extra choice, e.g. "also delete the sale" */
  checkbox?: { label: ReactNode; hint?: ReactNode; required?: boolean };
}
export interface ConfirmResult { reason: string; checked: boolean }

type Ask = (o: ConfirmOptions) => Promise<ConfirmResult | null>;
const ConfirmContext = createContext<Ask>(async () => null);
export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<{ o: ConfirmOptions; resolve: (r: ConfirmResult | null) => void } | null>(null);
  const ask = useCallback<Ask>((o) => new Promise((resolve) => setOpen({ o, resolve })), []);
  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {open && <Sheet key={open.o.title} o={open.o} done={(r) => { open.resolve(r); setOpen(null); }} />}
    </ConfirmContext.Provider>
  );
}

function Sheet({ o, done }: { o: ConfirmOptions; done: (r: ConfirmResult | null) => void }) {
  const [reason, setReason] = useState(o.reason?.initial ?? "");
  const [checked, setChecked] = useState(false);
  const first = useRef<HTMLInputElement | HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") done(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [done]);
  const blocked = (o.reason && !o.reason.optional && !reason.trim()) || (o.checkbox?.required && !checked);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => done(null)}>
      <form
        role="alertdialog" aria-modal="true" aria-labelledby="confirm-title"
        className="w-full max-w-md space-y-4 rounded-t-2xl border border-line bg-panel p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); if (!blocked) done({ reason: reason.trim(), checked }); }}
      >
        <div className="flex gap-3">
          {o.danger && (
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-300 ring-1 ring-inset ring-red-400/30">
              <AlertTriangle size={20} />
            </span>
          )}
          <div className="min-w-0">
            <h2 id="confirm-title" className="text-lg font-bold tracking-[-0.02em]">{o.title}</h2>
            {o.message && <div className="mt-1 text-sm text-muted">{o.message}</div>}
          </div>
        </div>
        {o.reason && (
          <label className="block">
            <span className="eyebrow-tight mb-1.5 block text-muted">{o.reason.label}{o.reason.optional && " (facultatif)"}</span>
            <input ref={first as React.RefObject<HTMLInputElement>} className={input} value={reason} placeholder={o.reason.placeholder}
              onChange={(e) => setReason(e.target.value)} />
          </label>
        )}
        {o.checkbox && (
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-line bg-bg/50 p-3">
            <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <span className="text-sm">
              <span className="font-medium">{o.checkbox.label}</span>
              {o.checkbox.hint && <span className="mt-0.5 block text-xs text-muted">{o.checkbox.hint}</span>}
            </span>
          </label>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={btn.secondary} onClick={() => done(null)}
            ref={o.reason ? undefined : (first as React.RefObject<HTMLButtonElement>)}>Annuler</button>
          <button type="submit" className={o.danger ? btn.danger : btn.primary} disabled={!!blocked}>{o.confirmLabel ?? "Confirmer"}</button>
        </div>
      </form>
    </div>
  );
}
