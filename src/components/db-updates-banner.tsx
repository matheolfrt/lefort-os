"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

const PAGE = "/parametres/mises-a-jour";

/** Database updates not run yet: some pages would fail, the managers are told where to fix it (not on that page itself) */
export function DbUpdatesBanner({ count }: { count: number }) {
  const path = usePathname();
  if (!count || path.startsWith(PAGE)) return null;
  return (
    <Link href={PAGE} data-testid="db-updates"
      className="mb-4 flex items-center gap-3 rounded-2xl border border-highlight/40 bg-highlight/10 px-4 py-3 text-sm transition hover:bg-highlight/15">
      <span className="size-2 shrink-0 animate-pulse rounded-full bg-highlight" />
      <span className="flex-1">
        <strong>{count} mise{count > 1 ? "s" : ""} à jour de la base</strong> en attente : certaines pages ne fonctionnent pas encore.
      </span>
      <span className="shrink-0 font-semibold text-highlight">Mettre à jour →</span>
    </Link>
  );
}

/** After updates are applied or checked, reloads the layout once so the banner knows (it is remembered for a few minutes) */
export function RefreshOnce() {
  const router = useRouter();
  useEffect(() => router.refresh(), [router]);
  return null;
}
