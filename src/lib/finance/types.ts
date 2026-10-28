// Shapes of what the database returns for the Financial Command Center (finance_overview and the drill-downs).
// All amounts are in cents.

export type Cents = number;

export interface Recurring {
  id: string; label: string; category: string; amount_cents: Cents;
  frequency: "weekly" | "monthly" | "quarterly" | "yearly"; day_of_month: number; starts_on: string; ends_on: string | null;
}
export interface Planned { id: string; label: string; amount_cents: Cents; due_on: string; supplier: string | null }

export interface ForecastSettings {
  window_days: number; horizon_days: number; growth_pct: number; payout_days: number;
  stock_target_days: number; variable_cost_pct: number; analysis_days: number;
}
export interface FinanceSettings {
  cash_reserve_cents: Cents; liquidation_pct: number; immob_levels: { normal: number; high: number; critical: number };
  aging_basis: "listed" | "received"; aging_bounds: [number, number, number]; dead_stock_days: number;
  forecast: ForecastSettings; vinted_fee_pct: number; vinted_fee_fixed_cents: Cents;
  declaration_frequency: "monthly" | "quarterly"; versement_liberatoire: boolean; contribution_rate_pct: number;
}
export interface Period { items: number; revenue_cents: Cents; cogs_cents: Cents; variable_cents?: Cents; gross_profit_cents: Cents }
export interface AgingBucket { from: number; to: number | null; count: number; cost_cents: Cents }

export interface Overview {
  now: string;
  settings: FinanceSettings;
  balance: { as_of: string; amount_cents: Cents; note: string | null } | null;
  ledger: {
    receipts_cents: Cents; refunds_cents: Cents; shipping_cents: Cents; purchases_cents: Cents;
    expenses_by_category: Record<string, Cents>;
  } | null;
  stock: {
    count: number; cost_cents: Cents; priced_count: number; price_cents: Cents; unpriced_count: number; unpriced_cost_cents: Cents;
    listed_count: number; dormant_count: number; dormant_cost_cents: Cents; dormant_price_cents: Cents; aging: AgingBucket[];
  };
  rejected: { count: number; cost_cents: Cents };
  receivable: { count: number; amount_cents: Cents; oldest_sold_at: string | null };
  unpaid_orders: { sold_at: string; amount_cents: Cents }[];
  periods: {
    days: number; current: Period; previous: Period; year: Period; cashed_cents: Cents;
    expenses_by_category: Record<string, Cents>; first_sale_at: string | null; avg_days_to_sell: number | null;
  };
  daily: { day: string; net_cents: Cents; gross_cents: Cents; items: number; cogs_cents: Cents }[];
  monthly: { month: string; net_cents: Cents; orders: number }[];
  cashed_months: { month: string; cents: Cents }[];
  snapshots: { day: string; cash_cents: Cents | null; stock_cost_cents: Cents; dormant_cost_cents: Cents; receivable_cents: Cents }[];
  recurring: Recurring[];
  planned: Planned[];
}

export interface Segment {
  name: string; items: number; sold: number; stock: number; avg_cost_cents: Cents | null; avg_price_cents: Cents | null;
  revenue_cents: Cents; margin_cents: Cents; sold_cost_cents: Cents; avg_days: number | null; timed: number; stock_cost_cents: Cents;
}

/** One line of a « Comment est calculé ce chiffre ? » explanation */
export interface Line { label: string; value: string; op?: "+" | "−" | "×" | "÷" | "=" ; muted?: boolean }
