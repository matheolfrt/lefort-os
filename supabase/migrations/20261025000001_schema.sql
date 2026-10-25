-- Lefort OS — core schema
-- Conventions: money = bigint cents (EUR), timestamps = timestamptz,
-- every business table carries org_id, financial history is append-only.

create extension if not exists pg_trgm with schema extensions;

-- ───────────────────────── Enums ─────────────────────────
create type app_role as enum (
  'admin', 'manager', 'operator',
  'reception', 'photographer', 'listing_operator', 'warehouse', 'shipping'
);
create type item_status as enum (
  'received', 'sorted', 'photographed', 'measured', 'listing_ready',
  'listed', 'reserved', 'sold', 'shipped', 'completed',
  'on_hold', 'rejected', 'returned'
);
create type item_condition as enum ('new_with_tags', 'new_without_tags', 'very_good', 'good', 'satisfactory');
create type hold_reason as enum ('repair', 'cleaning', 'research', 'other');
create type batch_status as enum ('open', 'closed');
create type allocation_method as enum ('equal', 'weighted');
create type cost_line_kind as enum ('goods', 'transport', 'customs', 'fees', 'other');
create type location_kind as enum ('storage', 'staging', 'virtual');
create type listing_status as enum ('draft', 'active', 'reserved', 'sold', 'delisted');
create type order_status as enum ('pending', 'shipped', 'completed', 'cancelled');
create type order_line_status as enum ('active', 'cancelled', 'returned');
create type attr_kind as enum ('color', 'pattern', 'material', 'fit');
create type brand_tier as enum ('premium', 'mid', 'mass', 'unknown');
create type vat_regime as enum ('franchise', 'margin_scheme');
create type expense_category as enum ('rent', 'salary', 'packaging', 'software', 'equipment', 'transport', 'other');
create type tax_kind as enum ('urssaf_bic_vente', 'versement_liberatoire', 'cfp');

-- ───────────────────────── Identity ─────────────────────────
create table organizations (
  id uuid primary key default gen_random_uuid(),
  trade_name text not null,
  legal_name text,
  siret text check (siret is null or siret ~ '^[0-9]{14}$'),
  address text,
  currency char(3) not null default 'EUR',
  timezone text not null default 'Europe/Paris',
  sku_prefix text not null default 'LSH' check (sku_prefix ~ '^[A-Z]{2,5}$'),
  sku_next bigint not null default 1 check (sku_next > 0),
  vat_regime vat_regime not null default 'franchise',
  declaration_frequency text not null default 'monthly' check (declaration_frequency in ('monthly', 'quarterly')),
  versement_liberatoire boolean not null default false,
  min_photos int not null default 3 check (min_photos >= 0),
  dead_stock_days int not null default 90 check (dead_stock_days > 0),
  vinted_fee_pct numeric(5,2) not null default 0 check (vinted_fee_pct >= 0),
  vinted_fee_fixed_cents bigint not null default 0 check (vinted_fee_fixed_cents >= 0),
  listing_signature text not null default 'Lefort Second Hand · Mesures prises à plat · Envoi soigné sous 24/48 h',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  created_at timestamptz not null default now()
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  user_id uuid not null references auth.users(id),
  role app_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
-- V1: a user belongs to exactly one active organization
create unique index memberships_one_active_org on memberships(user_id) where active;

-- ───────────────────────── Reference data ─────────────────────────
create table suppliers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null,
  country text,
  contact text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
create unique index suppliers_name_uq on suppliers(org_id, lower(name));

create table brands (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null,
  tier brand_tier not null default 'unknown',
  aliases text[] not null default '{}',
  created_at timestamptz not null default now()
);
create unique index brands_name_uq on brands(org_id, lower(name));
create index brands_name_trgm on brands using gin (name extensions.gin_trgm_ops);

create table measurement_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null,
  unique (org_id, name)
);

create table measurement_definitions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references measurement_templates(id) on delete cascade,
  key text not null,
  label text not null,
  min_mm int not null check (min_mm >= 0),
  max_mm int not null,
  required boolean not null default true,
  sort int not null default 0,
  unique (template_id, key),
  check (max_mm > min_mm)
);

create table shot_lists (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null,
  -- [{"key":"front","label":"Face","required":true}, ...]
  shots jsonb not null default '[]',
  unique (org_id, name)
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  parent_id uuid references categories(id),
  name text not null,
  hotkey smallint check (hotkey between 1 and 9),
  cost_weight numeric(6,2) not null default 1 check (cost_weight > 0),
  measurement_template_id uuid references measurement_templates(id),
  shot_list_id uuid references shot_lists(id),
  active boolean not null default true,
  unique (org_id, parent_id, name)
);
create unique index categories_hotkey_uq on categories(org_id, hotkey) where hotkey is not null;

create table attribute_values (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  kind attr_kind not null,
  value text not null,
  sort int not null default 0,
  unique (org_id, kind, value)
);

create table tax_rates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  kind tax_kind not null,
  rate_pct numeric(6,3) not null check (rate_pct >= 0),
  valid_from date not null,
  unique (org_id, kind, valid_from)
);

-- ───────────────────────── Warehouse ─────────────────────────
create table locations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  code text not null check (code ~ '^EMP-[A-Z0-9-]+$'),
  label text,
  kind location_kind not null default 'storage',
  -- staging/virtual location an item is moved to automatically on entering this status
  auto_for_status item_status,
  pick_order int not null default 0,
  capacity int check (capacity is null or capacity > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, code)
);
create unique index locations_auto_status_uq on locations(org_id, auto_for_status) where auto_for_status is not null;

-- ───────────────────────── Batches ─────────────────────────
create table batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  code text not null,
  supplier_id uuid not null references suppliers(id),
  status batch_status not null default 'open',
  purchased_at date not null,
  received_at date,
  expected_qty int check (expected_qty is null or expected_qty >= 0),
  allocation_method allocation_method not null default 'equal',
  invoice_number text,
  invoice_path text,
  payment_method text,
  notes text,
  closed_at timestamptz,
  closed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (org_id, code)
);
create index batches_supplier_idx on batches(supplier_id);

create table batch_cost_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  batch_id uuid not null references batches(id),
  kind cost_line_kind not null,
  amount_cents bigint not null check (amount_cents >= 0),
  description text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create index batch_cost_lines_batch_idx on batch_cost_lines(batch_id);

-- After a batch is closed, cost changes are recorded here, never by editing lines
create table batch_cost_adjustments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  batch_id uuid not null references batches(id),
  amount_cents bigint not null check (amount_cents <> 0),
  reason text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

-- Pre-printed SKU labels: issued in advance, bound to an item at reception
create table sku_labels (
  sku text primary key,
  org_id uuid not null references organizations(id),
  batch_id uuid references batches(id),
  issued_at timestamptz not null default now(),
  issued_by uuid references auth.users(id)
);
create index sku_labels_batch_idx on sku_labels(batch_id);

-- ───────────────────────── Items ─────────────────────────
create table items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  sku text not null,
  batch_id uuid not null references batches(id),
  status item_status not null default 'received',
  status_before_hold item_status,
  hold_reason hold_reason,
  status_changed_at timestamptz not null default now(),

  category_id uuid references categories(id),
  brand_id uuid references brands(id),
  gender text not null default 'men' check (gender in ('men', 'women', 'unisex', 'kids')),
  size_label text,
  trouser_size_label text,
  color_id uuid references attribute_values(id),
  secondary_color_id uuid references attribute_values(id),
  pattern_id uuid references attribute_values(id),
  material_id uuid references attribute_values(id),
  composition text,
  condition item_condition,
  defects text,
  notes text,

  title text,
  description text,
  list_price_cents bigint check (list_price_cents is null or list_price_cents > 0),
  min_price_cents bigint check (min_price_cents is null or min_price_cents > 0),

  current_location_id uuid references locations(id),
  photo_count int not null default 0,

  claimed_by uuid references auth.users(id),
  claimed_until timestamptz,

  received_at timestamptz not null default now(),
  listed_at timestamptz,
  sold_at timestamptz,
  shipped_at timestamptz,
  completed_at timestamptz,

  version int not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,

  unique (org_id, sku),
  check (min_price_cents is null or list_price_cents is null or min_price_cents <= list_price_cents),
  check ((status = 'on_hold') = (status_before_hold is not null))
);
create index items_queue_idx on items(org_id, status, received_at) where deleted_at is null;
create index items_batch_idx on items(batch_id);
create index items_location_idx on items(current_location_id);
create index items_brand_idx on items(brand_id);
create index items_category_idx on items(category_id);
create index items_sku_trgm on items using gin (sku extensions.gin_trgm_ops);
create index items_title_trgm on items using gin (title extensions.gin_trgm_ops);

-- Cost lives apart from the item so RLS can hide it from operators
create table item_costs (
  item_id uuid primary key references items(id),
  org_id uuid not null references organizations(id),
  allocated_cost_cents bigint not null default 0 check (allocated_cost_cents >= 0),
  manual boolean not null default false,
  updated_at timestamptz not null default now()
);

create table item_photos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  item_id uuid not null references items(id),
  storage_path text not null unique,
  shot_key text,
  position int not null default 0,
  width int,
  height int,
  bytes int,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create index item_photos_item_idx on item_photos(item_id, position);

create table item_measurements (
  item_id uuid not null references items(id),
  definition_id uuid not null references measurement_definitions(id),
  org_id uuid not null references organizations(id),
  value_mm int not null check (value_mm > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (item_id, definition_id)
);

create table item_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references organizations(id),
  item_id uuid not null references items(id),
  type text not null,
  from_status item_status,
  to_status item_status,
  station text,
  actor_id uuid references auth.users(id),
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index item_events_item_idx on item_events(item_id, created_at);
create index item_events_org_time_idx on item_events(org_id, created_at);

create table item_location_moves (
  id bigint generated always as identity primary key,
  org_id uuid not null references organizations(id),
  item_id uuid not null references items(id),
  from_location_id uuid references locations(id),
  to_location_id uuid not null references locations(id),
  method text not null default 'scan' check (method in ('scan', 'manual', 'auto', 'bulk')),
  moved_by uuid references auth.users(id),
  moved_at timestamptz not null default now()
);
create index item_location_moves_item_idx on item_location_moves(item_id, moved_at);

create table price_changes (
  id bigint generated always as identity primary key,
  org_id uuid not null references organizations(id),
  item_id uuid not null references items(id),
  field text not null check (field in ('list_price', 'min_price')),
  old_cents bigint,
  new_cents bigint,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);
create index price_changes_item_idx on price_changes(item_id, changed_at);

-- ───────────────────────── Channels & listings ─────────────────────────
create table channels (
  code text primary key,
  name text not null
);
insert into channels(code, name) values
  ('vinted', 'Vinted'), ('ebay', 'eBay'), ('etsy', 'Etsy'),
  ('leboncoin', 'Leboncoin'), ('direct', 'Vente directe');

create table listings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  item_id uuid not null references items(id),
  channel text not null references channels(code),
  external_id text,
  url text,
  title text,
  description text,
  price_cents bigint check (price_cents is null or price_cents > 0),
  status listing_status not null default 'active',
  listed_at timestamptz not null default now(),
  ended_at timestamptz,
  created_by uuid references auth.users(id)
);
create unique index listings_external_uq on listings(channel, external_id) where external_id is not null;
create unique index listings_one_live_per_channel on listings(item_id, channel) where status in ('draft', 'active', 'reserved');
create index listings_item_idx on listings(item_id);

-- ───────────────────────── Sales ─────────────────────────
create table orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  number bigint generated always as identity,
  channel text not null references channels(code),
  external_order_id text,
  buyer_handle text,
  sold_at timestamptz not null,
  paid_at timestamptz,
  status order_status not null default 'pending',
  gross_cents bigint not null check (gross_cents >= 0),       -- price of the goods (= chiffre d'affaires)
  platform_fee_cents bigint not null default 0 check (platform_fee_cents >= 0),
  promotion_fee_cents bigint not null default 0 check (promotion_fee_cents >= 0),
  shipping_cost_cents bigint not null default 0 check (shipping_cost_cents >= 0), -- borne by seller
  packaging_cost_cents bigint not null default 0 check (packaging_cost_cents >= 0),
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  vat_regime_at_sale vat_regime not null,
  payment_method text not null default 'Porte-monnaie Vinted',
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
create unique index orders_external_uq on orders(channel, external_order_id) where external_order_id is not null;
create index orders_sold_idx on orders(org_id, sold_at);
create index orders_paid_idx on orders(org_id, paid_at);

create table order_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  order_id uuid not null references orders(id),
  item_id uuid not null references items(id),
  sale_price_cents bigint not null check (sale_price_cents >= 0),   -- snapshot, allocated share of gross
  cost_snapshot_cents bigint not null check (cost_snapshot_cents >= 0),
  status order_line_status not null default 'active',
  created_at timestamptz not null default now()
);
-- an item can be in at most one live sale: prevents double-selling
create unique index order_lines_one_active_sale on order_lines(item_id) where status = 'active';
create index order_lines_order_idx on order_lines(order_id);

create table refunds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  order_id uuid not null references orders(id),
  order_line_id uuid references order_lines(id),
  amount_cents bigint not null check (amount_cents >= 0),
  item_returned boolean not null default false,
  reason text not null,
  refunded_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create index refunds_order_idx on refunds(order_id);

create table shipments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  order_id uuid not null references orders(id),
  carrier text,
  tracking_number text,
  shipped_at timestamptz not null default now(),
  delivered_at timestamptz,
  created_by uuid references auth.users(id)
);
create index shipments_order_idx on shipments(order_id);

create table expenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  category expense_category not null,
  amount_cents bigint not null check (amount_cents >= 0),
  spent_on date not null,
  supplier text,
  invoice_number text,
  payment_method text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
create index expenses_org_date_idx on expenses(org_id, spent_on);

-- ───────────────────────── Platform ─────────────────────────
create table ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  item_id uuid not null references items(id),
  field text not null,
  suggested jsonb not null,
  confidence numeric(4,3),
  model text,
  accepted boolean,
  final jsonb,
  created_at timestamptz not null default now()
);

create table scenarios (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null,
  inputs jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table audit_log (
  id bigint generated always as identity primary key,
  org_id uuid,
  table_name text not null,
  row_id text not null,
  action text not null,
  old_row jsonb,
  new_row jsonb,
  actor_id uuid,
  at timestamptz not null default now()
);
create index audit_log_row_idx on audit_log(table_name, row_id);
