import Link from "next/link";
import { ChevronRight, Landmark } from "lucide-react";
import { loadFinance } from "@/lib/finance/server";
import { euro } from "@/lib/finance";

/** « Où est mon argent ? » in one line of figures on the dashboard, leading to the command center */
export async function FinanceCard() {
  const f = await loadFinance();
  if (!f) return null;
  const { cash, cap, budget, o } = f;
  const figures = [
    { k: "Trésorerie", v: cash.known ? euro(cash.cents) : "À déclarer" },
    { k: "Capital total", v: euro(cap.total) },
    { k: "Stock dormant", v: euro(o.stock.dormant_cost_cents) },
    { k: "Budget d'achat", v: budget.known ? euro(budget.recommended) : "—" },
  ];
  return (
    <Link href="/finance" data-testid="finance-card"
      className="group block rounded-2xl border border-line bg-panel/80 p-4 transition hover:-translate-y-px hover:border-fg/25 hover:shadow-lg">
      <div className="mb-2 flex items-center gap-2">
        <Landmark size={18} className="text-accent" aria-hidden />
        <h2 className="flex-1 font-semibold">Où est mon argent ?</h2>
        <ChevronRight size={18} className="text-muted transition group-hover:translate-x-0.5" aria-hidden />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-4">
        {figures.map((x) => (
          <div key={x.k} className="min-w-0">
            <dt className="eyebrow-tight truncate text-muted">{x.k}</dt>
            <dd className="figure text-lg font-semibold tabular-nums">{x.v}</dd>
          </div>
        ))}
      </dl>
    </Link>
  );
}

/** Same shape as the card, so nothing below it moves when the figures arrive */
export function FinanceCardSkeleton() {
  return (
    <div aria-hidden className="rounded-2xl border border-line bg-panel/80 p-4">
      <div className="mb-2 flex items-center gap-2"><div className="skeleton size-[18px] rounded" /><div className="skeleton h-5 w-44 rounded" /></div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-1.5 py-0.5"><div className="skeleton h-3 w-20 rounded" /><div className="skeleton h-6 w-24 rounded" /></div>
        ))}
      </div>
    </div>
  );
}
