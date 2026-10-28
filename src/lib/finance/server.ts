import "server-only";
import { createClient } from "@/lib/supabase/server";
import { parisToday } from "@/lib/format";
import { capital, cashPosition, forecast, immobilization, performance, purchaseBudget, turnover } from "./calc";
import type { Overview } from "./types";

/**
 * Everything the command center and the dashboard card show, computed once from finance_overview.
 * Returns null when the database is not up to date (the function is missing) or the user is not a manager.
 * `snapshot` records today's capital (once a day is enough: the row is upserted), which feeds the evolution and averages.
 */
export async function loadFinance({ snapshot = false } = {}) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("finance_overview");
  if (error || !data) return null;
  const o = data as Overview;
  const today = parisToday(new Date(o.now));
  const cash = cashPosition(o, today);
  const cap = capital(o, cash);
  const perf = performance(o, today);
  const turn = turnover(o, perf, cap, today);
  const fc = forecast(o, cash, today);
  const budget = purchaseBudget(o, cash, fc, today);
  const immob = immobilization(o.stock.cost_cents, cap.total, o.settings.immob_levels);
  if (snapshot) {
    await supabase.rpc("finance_snapshot", {
      p_cash: cash.known ? cash.cents : null, p_stock: o.stock.cost_cents, p_dormant: o.stock.dormant_cost_cents, p_receivable: o.receivable.amount_cents,
    });
  }
  return { o, today, cash, cap, perf, turn, fc, budget, immob };
}

export type FinanceData = NonNullable<Awaited<ReturnType<typeof loadFinance>>>;
