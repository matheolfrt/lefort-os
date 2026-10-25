import Link from "next/link";
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

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, className = "" }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-panel p-4 ${className}`}>
      {title && <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line p-8 text-center text-muted">{children}</div>;
}

export const btn = {
  primary:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-accent px-4 font-semibold text-accent-fg hover:brightness-110 disabled:opacity-50",
  secondary:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-line bg-panel px-4 font-medium hover:bg-line/40 disabled:opacity-50",
  danger:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-red-600 px-4 font-semibold text-white hover:bg-red-700 disabled:opacity-50",
  huge: "inline-flex min-h-16 w-full items-center justify-center gap-2 rounded-lg bg-accent px-6 text-lg font-bold text-accent-fg hover:brightness-110 disabled:opacity-50",
};

export const input =
  "min-h-11 w-full rounded-md border border-line bg-bg px-3 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function SkuLink({ sku }: { sku: string }) {
  return (
    <Link href={`/stock/${sku}`} className="font-mono font-semibold text-accent hover:underline">
      {sku}
    </Link>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-current/30 px-1.5 py-0.5 font-mono text-[11px] opacity-70">{children}</kbd>
  );
}
