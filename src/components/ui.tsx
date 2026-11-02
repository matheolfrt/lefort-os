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
            className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-[var(--fill)] hover:text-fg">
            <ChevronLeft size={22} />
          </Link>
        )}
        <div className="min-w-0">
          <h1 className="text-[28px] font-bold leading-tight tracking-[-0.03em] sm:text-[34px]">{title}</h1>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {/* one primary action: last (on the right) on a computer, first and full width on a phone; the others share a row */}
      {actions && <div className="flex w-full flex-wrap gap-2 sm:w-auto [&>*]:flex-1 sm:[&>*]:flex-none [&>.act-primary]:max-sm:order-first [&>.act-primary]:max-sm:basis-full sm:[&>.act-primary]:order-last">{actions}</div>}
    </header>
  );
}

export function Card({ title, children, className = "" }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`glass rounded-2xl p-4 sm:p-5 ${className}`}>
      {title && <h2 className="eyebrow mb-3 text-muted">{title}</h2>}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, help }: { label: string; value: ReactNode; hint?: ReactNode; help?: string }) {
  return (
    <div className="glass rounded-2xl px-4 py-3.5">
      <div className="eyebrow-tight flex items-start gap-1 leading-tight text-muted">{label}{help && <Help text={help} />}</div>
      <div className="mt-1.5 figure text-[28px] font-semibold leading-tight tracking-[-0.025em] tabular-nums">{value}</div>
      {hint && <div className="text-xs leading-snug text-muted">{hint}</div>}
    </div>
  );
}

/** An empty list says what to do next: a short sentence and, when useful, the button that does it */
export function Empty({ children, action, secondary }: {
  children: ReactNode; action?: { href: string; label: string }; secondary?: { href: string; label: string };
}) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-panel/40 p-8 text-center text-muted">
      <div>{children}</div>
      {(action || secondary) && (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {action && <Link href={action.href} className={btn.primary}>{action.label}</Link>}
          {secondary && <Link href={secondary.href} className={btn.secondary}>{secondary.label}</Link>}
        </div>
      )}
    </div>
  );
}

/** A small « ? » that explains a figure: on hover, on keyboard focus and on tap */
export function Help({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex normal-case tracking-normal">
      <button type="button" aria-label={`Aide : ${text}`}
        className="-m-3 inline-flex size-11 items-center justify-center rounded-full text-muted/70 transition hover:text-fg focus-visible:text-fg">
        {/* a finger-sized button around a small mark */}
        <span className="flex size-5 items-center justify-center rounded-full text-[11px] font-semibold">?</span>
      </button>
      <span role="tooltip"
        className="glass-strong pointer-events-none fixed inset-x-4 bottom-4 z-[60] hidden rounded-2xl p-3 font-sans text-sm font-normal leading-relaxed text-fg shadow-xl group-hover:block group-focus-within:block sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-1 sm:w-64 sm:text-xs">
        {text}
      </span>
    </span>
  );
}

export const btn = {
  // act-primary: the page header puts it last on a computer, first and full width on a phone
  primary:
    "act-primary inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-accent px-5 font-semibold text-accent-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.28),0_1px_2px_rgb(0_0_0/0.12),0_4px_14px_-8px_var(--accent)] transition hover:brightness-105 active:scale-[0.97] disabled:opacity-50 disabled:shadow-none",
  /** Glass capsule: translucent, a light rim, the backdrop blurred behind */
  secondary:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[var(--control)] px-5 font-medium ring-1 ring-inset ring-[var(--glass-edge)] shadow-[inset_0_1px_0_var(--glass-rim),0_1px_3px_rgb(0_0_0/0.08)] backdrop-blur-xl transition hover:bg-[var(--control-hover)] active:scale-[0.97] disabled:opacity-50",
  danger:
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-red-600 px-5 font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.22)] transition hover:bg-red-500 active:scale-[0.97] disabled:opacity-50",
  /** Primary action inside a card or a list (smaller than a page action) */
  sm: "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full bg-accent px-4 text-sm font-semibold text-accent-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.25)] transition hover:brightness-105 active:scale-[0.97] disabled:opacity-50",
  /** Secondary action inside a card or a list: a light fill, never a strong colour */
  ghost: "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full bg-[var(--fill)] px-4 text-sm font-medium transition hover:bg-[var(--fill-hover)] active:scale-[0.97] disabled:opacity-50",
  /** A round button with only an icon (give it an aria-label) */
  icon: "inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--fill)] transition hover:bg-[var(--fill-hover)] active:scale-[0.95] disabled:opacity-50",
  huge: "inline-flex min-h-16 w-full items-center justify-center gap-2 rounded-full bg-accent px-6 text-lg font-bold text-accent-fg shadow-[inset_0_1px_0_rgb(255_255_255/0.28),0_10px_28px_-12px_var(--accent)] transition hover:brightness-105 active:scale-[0.985] disabled:opacity-50 disabled:shadow-none",
};

/**
 * A choice between a few views (tabs) or values (radio), drawn as an iOS segmented control: the chosen one sits on a
 * raised capsule. Same look everywhere: `<div role="tablist" className={seg.wrap}><button className={seg.item(on)}>…`
 */
export const seg = {
  wrap: "inline-flex max-w-full overflow-x-auto rounded-full bg-[var(--fill)] p-1",
  item: (on: boolean) => `inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition ${on ? "bg-[var(--seg-on)] text-fg shadow-[0_1px_3px_rgb(0_0_0/0.14),0_1px_1px_rgb(0_0_0/0.06)]" : "text-muted hover:text-fg"}`,
};

/** A small pill (a state, a verdict): add its tone, e.g. `${chip} bg-sky-400/10 text-sky-300 ring-sky-400/25` */
export const chip = "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset";

export const input =
  "min-h-11 w-full rounded-xl border border-transparent bg-[var(--fill)] px-3 text-base outline-none transition placeholder:text-muted/70 focus:border-accent/60 focus:bg-transparent focus:ring-4 focus:ring-accent/15";

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
