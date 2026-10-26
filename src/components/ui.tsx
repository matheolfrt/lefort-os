import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { STATUS_LABEL, STATUS_TONE } from "@/i18n/fr";
import type { ItemStatus } from "@/lib/types";

export function StatusChip({ status, large }: { status: ItemStatus; large?: boolean }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full font-medium ${STATUS_TONE[status]} ${
        large ? "px-3 py-1 text-sm" : "px-2.5 py-0.5 text-xs"
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
          <h1 className="text-2xl font-bold leading-tight tracking-[-0.03em] sm:text-[28px]">{title}</h1>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex w-full flex-wrap gap-2 sm:w-auto [&>*]:flex-1 sm:[&>*]:flex-none">{actions}</div>}
    </header>
  );
}

export function Card({ title, children, className = "" }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-panel/80 p-4 shadow-[0_1px_0_0_rgb(255_255_255/0.03)_inset] backdrop-blur ${className}`}>
      {title && <h2 className="eyebrow mb-3 text-muted">{title}</h2>}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-panel/80 px-4 py-3">
      <div className="eyebrow-tight leading-tight text-muted">{label}</div>
      <div className="mt-1.5 font-mono text-[26px] font-medium leading-tight tracking-tight tabular-nums">{value}</div>
      {hint && <div className="text-xs leading-snug text-muted">{hint}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-line bg-panel/40 p-8 text-center text-muted">{children}</div>;
}

export const btn = {
  primary:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 font-semibold text-accent-fg shadow-[0_0_24px_-6px_var(--accent)] transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50 disabled:shadow-none",
  secondary:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line bg-panel-2 px-4 font-medium transition hover:border-fg/25 hover:bg-panel-2/70 active:scale-[0.98] disabled:opacity-50",
  danger:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 font-semibold text-white transition hover:bg-red-500 active:scale-[0.98] disabled:opacity-50",
  huge: "inline-flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl bg-accent px-6 text-lg font-bold text-accent-fg shadow-[0_0_32px_-8px_var(--accent)] transition hover:brightness-110 active:scale-[0.99] disabled:opacity-50 disabled:shadow-none",
};

export const input =
  "min-h-11 w-full rounded-xl border border-line bg-bg/70 px-3 text-base outline-none transition placeholder:text-muted/60 focus:border-accent focus:ring-2 focus:ring-accent/25";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="eyebrow-tight mb-1.5 block text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function SkuLink({ sku }: { sku: string }) {
  return (
    <Link prefetch={false} href={`/stock/${sku}`} className="font-mono font-semibold text-fg underline-offset-2 hover:text-accent hover:underline">
      {sku}
    </Link>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-current/30 px-1.5 py-0.5 font-mono text-[11px] opacity-70">{children}</kbd>
  );
}
