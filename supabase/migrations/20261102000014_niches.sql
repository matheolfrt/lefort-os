-- Lefort OS — niches to try ("Niches"): ideas, tests and decisions, measured on the real sales.
-- A niche is a set of criteria (brands, categories, sizes, title keywords, price range). The items it covers are those
-- matching every criterion that is filled in, plus every item of the batches bought to test it (batches.niche_id).

create type niche_status as enum ('idea', 'testing', 'validated', 'dropped');

create table niches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  name text not null check (length(trim(name)) between 1 and 80),
  hypothesis text,
  status niche_status not null default 'idea',
  brand_ids uuid[] not null default '{}',
  category_ids uuid[] not null default '{}',
  sizes text[] not null default '{}',
  keywords text[] not null default '{}',
  price_min_cents bigint check (price_min_cents is null or price_min_cents >= 0),
  price_max_cents bigint check (price_max_cents is null or price_max_cents >= 0),
  target_buy_cents bigint check (target_buy_cents is null or target_buy_cents >= 0),  -- purchase price aimed at, per item
  target_sell_cents bigint check (target_sell_cents is null or target_sell_cents >= 0), -- resale price aimed at
  budget_cents bigint check (budget_cents is null or budget_cents >= 0),                -- money put into the test
  test_items int check (test_items is null or test_items > 0),                          -- items to sell before deciding
  started_at date,
  decided_at date,
  decision_note text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (org_id, name)
);
create trigger niches_touch before update on niches for each row execute function private.touch_updated_at();

alter table batches add column niche_id uuid references niches(id) on delete set null;
create index batches_niche_idx on batches(niche_id) where niche_id is not null;

-- Buying decisions and margins: managers only, like the other money screens
alter table niches enable row level security;
grant select, insert, update, delete on niches to authenticated;
create policy niches_mgr_read on niches for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_manager()));
create policy niches_mgr_insert on niches for insert to authenticated
  with check (org_id = (select public.auth_org_id()) and (select public.is_manager()));
create policy niches_mgr_update on niches for update to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_manager()))
  with check (org_id = (select public.auth_org_id()));
create policy niches_mgr_delete on niches for delete to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_manager()));

-- Items covered by each niche, with their economics (one row per niche × item). Managers only (niches RLS).
create view v_niche_items with (security_invoker = true) as
select n.id as niche_id, e.item_id, e.sku, b.name as brand, i.title, i.size_label, e.status, e.received_at, e.sold_at, e.is_sold,
       i.list_price_cents, e.cost_cents, e.revenue_cents, e.variable_costs_cents + e.vat_cents as variable_cents,
       e.gross_profit_cents as profit_cents,
       case when e.is_sold and e.sold_at > e.received_at + interval '1 hour'
            then greatest(extract(epoch from e.sold_at - e.received_at) / 86400, 0.5)::numeric end as days_in_stock,
       -- bought for the test: in a test batch, or received since the test started
       (bt.niche_id is not distinct from n.id or (n.started_at is not null and e.received_at >= n.started_at)) as in_test
  from niches n
  join v_item_economics e on e.org_id = n.org_id
  join items i on i.id = e.item_id
  join batches bt on bt.id = e.batch_id
  left join brands b on b.id = e.brand_id
 where e.status <> 'rejected'
   and (bt.niche_id = n.id or (
         (cardinality(n.brand_ids) + cardinality(n.category_ids) + cardinality(n.sizes) + cardinality(n.keywords) > 0
          or n.price_min_cents is not null or n.price_max_cents is not null)
     and (cardinality(n.brand_ids) = 0 or e.brand_id = any(n.brand_ids))
     and (cardinality(n.category_ids) = 0 or e.category_id = any(n.category_ids))
     and (cardinality(n.sizes) = 0 or lower(i.size_label) = any(select lower(s) from unnest(n.sizes) s))
     and (cardinality(n.keywords) = 0 or exists (
           select 1 from unnest(n.keywords) k
            where coalesce(i.title, '') ilike '%' || k || '%' or coalesce(b.name, '') ilike '%' || k || '%'))
     and (n.price_min_cents is null or coalesce(nullif(e.revenue_cents, 0), i.list_price_cents) >= n.price_min_cents)
     and (n.price_max_cents is null or coalesce(nullif(e.revenue_cents, 0), i.list_price_cents) <= n.price_max_cents)));
grant select on v_niche_items to authenticated;

-- Results of every niche (all matching items, and only those bought for the test), plus the business average
create function public.niche_stats() returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare v_org uuid := public.auth_org_id(); r jsonb;
begin
  if v_org is null or not public.is_manager() then
    raise exception using errcode = 'LF403', message = 'Niches réservées aux responsables.';
  end if;
  with ni as (select * from v_niche_items),
  m as (
    select niche_id, t.scope,
           count(*) as items,
           count(*) filter (where is_sold) as sold,
           count(*) filter (where not is_sold and status not in ('sold', 'shipped', 'completed')) as in_stock,
           coalesce(sum(cost_cents), 0) as cost,
           coalesce(sum(revenue_cents) filter (where is_sold), 0) as revenue,
           coalesce(sum(profit_cents) filter (where is_sold), 0) as profit,
           coalesce(sum(revenue_cents - variable_cents) filter (where is_sold), 0) as net,
           avg(days_in_stock) as days,
           avg(cost_cents) as avg_cost,
           avg(revenue_cents) filter (where is_sold) as avg_price
      from ni cross join lateral (values ('all'), ('test')) t(scope)
     where t.scope = 'all' or in_test
     group by niche_id, t.scope
  ),
  -- whole business, for comparison
  ref as (
    select count(*) as sold, avg(gross_profit_cents) as ppi,
           avg(case when sold_at > received_at + interval '1 hour' then greatest(extract(epoch from sold_at - received_at) / 86400, 0.5) end) as days
      from v_item_economics where org_id = v_org and is_sold
  )
  select jsonb_build_object(
    'reference', (select jsonb_build_object('sold', sold, 'profit_per_item_cents', round(ppi), 'avg_days', round(days::numeric, 1)) from ref),
    'niches', coalesce((select jsonb_agg(jsonb_build_object(
        'id', n.id,
        'all', (select to_jsonb(x) - 'niche_id' - 'scope' from m x where x.niche_id = n.id and x.scope = 'all'),
        'test', (select to_jsonb(x) - 'niche_id' - 'scope' from m x where x.niche_id = n.id and x.scope = 'test'))) from niches n where n.org_id = v_org), '[]')
  ) into r;
  return r;
end $$;

-- Items of one niche, latest first (detail page)
create function public.niche_item_list(p_niche_id uuid, p_limit int default 200) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare v_org uuid := public.auth_org_id();
begin
  if v_org is null or not public.is_manager() then
    raise exception using errcode = 'LF403', message = 'Niches réservées aux responsables.';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.is_sold, coalesce(x.sold_at, x.received_at) desc)
                     from (select * from v_niche_items where niche_id = p_niche_id
                            order by is_sold, coalesce(sold_at, received_at) desc limit least(greatest(p_limit, 1), 1000)) x), '[]');
end $$;

revoke all on function public.niche_stats(), public.niche_item_list(uuid, int) from public, anon;
grant execute on function public.niche_stats(), public.niche_item_list(uuid, int) to authenticated;
