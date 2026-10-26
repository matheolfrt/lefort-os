import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";

/** Shared header of every station: way back, what this station is, and today's progress. */
export function StationHeader({ title, queue, done, children }: {
  title: string;
  queue?: number | null;
  done?: number;
  children?: ReactNode;
}) {
  return (
    <header className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
      <Link href="/postes" aria-label="Tous les postes"
        className="-ml-2 flex size-11 items-center justify-center rounded-full text-muted hover:bg-line/60 hover:text-fg">
        <ChevronLeft size={22} />
      </Link>
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-bold leading-tight tracking-[-0.03em] sm:text-[28px]">{title}</h1>
        {(queue != null || done != null) && (
          <p className="text-sm text-muted">
            {queue != null && <><b className="tabular-nums text-fg">{queue}</b> en attente</>}
            {queue != null && done != null && " · "}
            {done != null && <><b className="tabular-nums text-fg">{done}</b> traité{done > 1 ? "s" : ""} cette session</>}
          </p>
        )}
      </div>
      {children && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{children}</div>}
    </header>
  );
}
