import Link from "next/link";
import { ChevronRight, TrendingDown } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { PriceData } from "@/lib/pricing";

/** A line on the dashboard when some prices should come down today (nothing is changed from here) */
export async function PriceReminder() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("price_suggestions");
  const n = error || !data ? 0 : (data as PriceData).items.length;
  if (!n) return null;
  return (
    <Link href="/prix" data-testid="price-reminder"
      className="flex min-h-12 items-center gap-3 rounded-2xl border border-line bg-panel/80 px-4 py-3 text-sm transition hover:border-fg/25">
      <TrendingDown size={20} className="shrink-0 text-highlight" />
      <span className="flex-1"><strong>{n} prix à baisser aujourd&apos;hui</strong> <span className="text-muted">selon vos règles : à vous de valider.</span></span>
      <ChevronRight size={18} className="text-muted" />
    </Link>
  );
}
