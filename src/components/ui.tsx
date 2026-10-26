import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { STATUS_LABEL, STATUS_TONE } from "@/i18n/fr";
import type { ItemStatus } from "@/lib/types";

export function StatusChip({ status, large }: { status: ItemStatus; large?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded font-semibold uppercase tracking-wide ${STATUS_TONE[status]} ${
        large ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-[11px]"
      }`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions, back }: {
  title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: string;
}) {
  return (
    <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-1">
        {back && (
          <Link href={back} aria-label="Retour"
            className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-line/60 hover:text-fg">
            <ChevronLeft size={22} />
          </Link>
        )}
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold leading-tight tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex w-full flex-wrap gap-2 sm:w-auto [&>*]:flex-1 sm:[&>*]:flex-none">{actions}</div>}
    </header>
  );
}

export function Card({ title, children, className = "" }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-panel p-4 ${className}`}>
      {title && <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">{title}</h2>}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-panel px-3.5 py-3">
      <div className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-[24px] font-black leading-tight tracking-tight tabular-nums">{value}</div>
      {hint && <div className="text-xs leading-snug text-muted">{hint}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line bg-panel/50 p-8 text-center text-muted">{children}</div>;
}

export const btn = {
  primary:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-4 font-semibold text-accent-fg transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50",
  secondary:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line bg-panel px-4 font-medium transition hover:border-fg/30 active:scale-[0.98] disabled:opacity-50",
  danger:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 font-semibold text-white transition hover:bg-red-700 active:scale-[0.98] disabled:opacity-50",
  huge: "inline-flex min-h-16 w-full items-center justify-center gap-2 rounded-lg bg-accent px-6 text-lg font-bold text-accent-fg hover:brightness-110 disabled:opacity-50",
};

export const input =
  "min-h-11 w-full rounded-lg border border-line bg-bg px-3 text-base outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function SkuLink({ sku }: { sku: string }) {
  return (
    <Link href={`/stock/${sku}`} className="font-mono font-semibold text-fg underline-offset-2 hover:text-accent hover:underline">
      {sku}
    </Link>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-current/30 px-1.5 py-0.5 font-mono text-[11px] opacity-70">{children}</kbd>
  );
}
