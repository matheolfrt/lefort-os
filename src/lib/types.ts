// Hand-written subset of the database types used by the UI.
// Regenerate with `supabase gen types typescript` once the project is linked.

export type AppRole =
  | "admin" | "manager" | "operator" | "reception" | "photographer" | "listing_operator" | "warehouse" | "shipping";

export type ItemStatus =
  | "received" | "sorted" | "photographed" | "measured" | "listing_ready" | "listed" | "reserved"
  | "sold" | "shipped" | "completed" | "on_hold" | "rejected" | "returned";

export type ItemCondition = "new_with_tags" | "new_without_tags" | "very_good" | "good" | "satisfactory";
export type HoldReason = "repair" | "cleaning" | "research" | "other";
export type Station = "sort" | "photo" | "measure" | "photo_measure" | "storage" | "listing" | "shipping";

export interface Organization {
  id: string;
  trade_name: string;
  legal_name: string | null;
  siret: string | null;
  address: string | null;
  sku_prefix: string;
  vat_regime: "franchise" | "margin_scheme";
  declaration_frequency: "monthly" | "quarterly";
  versement_liberatoire: boolean;
  min_photos: number;
  dead_stock_days: number;
  /** optional until the sell-through migration has run */
  sellthrough_target_pct?: number;
  sellthrough_days?: number;
  vinted_fee_pct: number;
  vinted_fee_fixed_cents: number;
  listing_signature: string;
}

export interface Item {
  id: string;
  sku: string;
  batch_id: string;
  status: ItemStatus;
  status_before_hold: ItemStatus | null;
  hold_reason: HoldReason | null;
  status_changed_at: string;
  category_id: string | null;
  brand_id: string | null;
  gender: string;
  size_label: string | null;
  trouser_size_label: string | null;
  color_id: string | null;
  secondary_color_id: string | null;
  pattern_id: string | null;
  material_id: string | null;
  composition: string | null;
  condition: ItemCondition | null;
  defects: string | null;
  notes: string | null;
  title: string | null;
  description: string | null;
  list_price_cents: number | null;
  min_price_cents: number | null;
  current_location_id: string | null;
  photo_count: number;
  claimed_by: string | null;
  claimed_until: string | null;
  received_at: string;
  listed_at: string | null;
  sold_at: string | null;
  version: number;
  deleted_at?: string | null;
}

export interface Category {
  id: string;
  name: string;
  hotkey: number | null;
  cost_weight: number;
  measurement_template_id: string | null;
  shot_list_id: string | null;
  active: boolean;
}

export interface Brand {
  id: string;
  name: string;
  tier: "premium" | "mid" | "mass" | "unknown";
}

export interface AttributeValue {
  id: string;
  kind: "color" | "pattern" | "material" | "fit";
  value: string;
  sort: number;
}

export interface MeasurementDefinition {
  id: string;
  template_id: string;
  key: string;
  label: string;
  min_mm: number;
  max_mm: number;
  required: boolean;
  sort: number;
}

export interface Shot {
  key: string;
  label: string;
  required: boolean;
}

export interface ShotList {
  id: string;
  name: string;
  shots: Shot[];
}

export interface ItemPhoto {
  id: string;
  item_id: string;
  storage_path: string;
  shot_key: string | null;
  position: number;
}

export interface Location {
  id: string;
  code: string;
  label: string | null;
  kind: "storage" | "staging" | "virtual";
  pick_order: number;
  capacity: number | null;
  active: boolean;
}

export interface Batch {
  id: string;
  code: string;
  supplier_id: string;
  status: "open" | "closed";
  purchased_at: string;
  received_at: string | null;
  expected_qty: number | null;
  allocation_method: "equal" | "weighted";
  invoice_number: string | null;
  payment_method: string | null;
  notes: string | null;
}

/** Reference data loaded once per station session */
export interface Catalog {
  categories: Category[];
  brands: Brand[];
  attributes: AttributeValue[];
  definitions: MeasurementDefinition[];
  shotLists: ShotList[];
}
