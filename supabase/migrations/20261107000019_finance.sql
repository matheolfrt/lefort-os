-- Lefort OS — Financial Command Center (« Où est mon argent ? »).
-- Every euro is located: cash (declared balance + what was recorded since), stock at cost (split active / dormant),
-- money still to be received from sales, and what is planned (recurring charges, purchases).
-- The money facts come from the existing canonical sources: v_item_economics (one economics row per item, cancelled
-- sales and refunds already handled), orders (paid_at = cash received), batches and their cost lines (purchases),
-- expenses (one-off spending). Nothing here duplicates them. Managers only.

alter type expense_category add value if not exists 'taxes';

-- ── Settings (never hard-coded in the app)
alter table organizations
  add column cash_reserve_cents bigint not null default 0 check (cash_reserve_cents >= 0),
  add column liquidation_pct numeric(5, 2) not null default 70 check (liquidation_pct between 0 and 100),
  -- share of the capital tied up in stock: below "normal" = faible, then normal, élevé, critique
  add column immob_levels jsonb not null default '{"normal": 40, "high": 70, "critical": 85}',
  -- age of an item in stock: from when it went online (falls back to reception), or from reception
  add column aging_basis text not null default 'listed' check (aging_basis in ('listed', 'received')),
  -- the first two age limits; the third is the dormant threshold (dead_stock_days)
  add column aging_bounds int[] not null default '{30,60}',
  add column forecast jsonb not null default
    '{"window_days": 90, "horizon_days": 90, "growth_pct": 0, "payout_days": 7, "stock_target_days": 60, "variable_cost_pct": 0, "analysis_days": 30}';
grant update (cash_reserve_cents, liquidation_pct, immob_levels, aging_basis, aging_bounds, forecast) on organizations to authenticated;

-- ── Cash balances declared by the manager (bank + Vinted wallet), the anchor of the cash position
create table cash_balances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.auth_org_id() references organizations(id),
  as_of timestamptz not null default now(),
  amount_cents bigint not null,
  note text check (note is null or length(note) <= 300),
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index cash_balances_org_idx on cash_balances(org_id, as_of desc);

-- ── Recurring charges (rent, salaries, software…): entered once, counted every period, past and future
create table recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.auth_org_id() references organizations(id),
  label text not null check (length(trim(label)) between 1 and 120),
  category expense_category not null,
  amount_cents bigint not null check (amount_cents > 0),
  frequency text not null default 'monthly' check (frequency in ('weekly', 'monthly', 'quarterly', 'yearly')),
  day_of_month int not null default 1 check (day_of_month between 1 and 28),
  starts_on date not null default current_date,
  ends_on date,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index recurring_expenses_org_idx on recurring_expenses(org_id);

-- ── Purchases planned or committed but not paid yet (a lot reserved, a supplier order…)
create table planned_purchases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.auth_org_id() references organizations(id),
  label text not null check (length(trim(label)) between 1 and 120),
  supplier_id uuid references suppliers(id),
  amount_cents bigint not null check (amount_cents > 0),
  due_on date not null,
  status text not null default 'planned' check (status in ('planned', 'done', 'cancelled')),
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index planned_purchases_org_idx on planned_purchases(org_id, status, due_on);

-- ── One line a day of the capital, to show its evolution (written when the page is opened)
create table capital_snapshots (
  org_id uuid not null references organizations(id),
  day date not null,
  cash_cents bigint,
  stock_cost_cents bigint not null,
  dormant_cost_cents bigint not null,
  receivable_cents bigint not null,
  primary key (org_id, day)
);

do $$
declare t text;
begin
  foreach t in array array['cash_balances', 'recurring_expenses', 'planned_purchases', 'capital_snapshots'] loop
    execute format('alter table %I enable row level security', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('create policy %I on %I for all to authenticated using (org_id = (select public.auth_org_id()) and (select public.is_manager())) with check (org_id = (select public.auth_org_id()) and (select public.is_manager()))', t || '_mgr', t);
  end loop;
end $$;
-- one-off expenses: the existing table, now entered from the finance settings
grant select, insert, update, delete on expenses to authenticated;

-- receivables and sales by day are read often
create index if not exists orders_unpaid_idx on orders(org_id) where paid_at is null and status <> 'cancelled';

-- ── Markdown plan per item on sale: the rule behind « Prix à baisser », shared with the dormant stock list
create function public.price_plan(p_items uuid[] default null)
returns table (item_id uuid, price bigint, start_price bigint, suggested bigint, step_days int, step_pct numeric,
               next_days int, days_online int, held_by text, waiting boolean, skipped boolean, margin bigint, todo boolean)
language plpgsql stable security invoker set search_path = public as $$
declare
  v_org uuid := public.auth_org_id();
  v_steps jsonb; v_wait int; v_fee_pct numeric; v_fee_fixed bigint; v_ship numeric;
  v_today date := (now() at time zone 'Europe/Paris')::date;
begin
  if v_org is null or not public.is_manager() then
    raise exception using errcode = 'LF403', message = 'Prix réservés aux responsables.';
  end if;
  select o.price_steps, o.price_wait_days, o.vinted_fee_pct, o.vinted_fee_fixed_cents into v_steps, v_wait, v_fee_pct, v_fee_fixed
    from organizations o where o.id = v_org;
  -- average shipping + packaging paid per sold item (last 180 days), as in Conseils
  select coalesce(sum(o.shipping_cost_cents + o.packaging_cost_cents)::numeric / nullif(count(ol.id), 0), 0) into v_ship
    from orders o join order_lines ol on ol.order_id = o.id and ol.status = 'active'
   where o.org_id = v_org and o.status <> 'cancelled' and o.sold_at >= now() - interval '180 days';

  return query
  with steps as (
    select (s->>'days')::int as days, (s->>'pct')::numeric as pct from jsonb_array_elements(v_steps) s
  ),
  live as (
    select i.id, i.list_price_cents as price, i.min_price_cents as min_price,
           coalesce(i.listed_at, i.status_changed_at) as online_since, e.cost_cents as cost
      from items i join v_item_economics e on e.item_id = i.id
     where i.org_id = v_org and i.deleted_at is null and i.status = 'listed' and i.list_price_cents is not null
       and (p_items is null or i.id = any(p_items))
  ),
  -- one pass over the price history (a sub-query per item would re-check the access rules for every item)
  pch as (
    select pc.item_id,
           max(greatest(coalesce(pc.old_cents, 0), coalesce(pc.new_cents, 0))) as max_price,
           max(pc.changed_at) filter (where pc.new_cents < pc.old_cents) as last_markdown
      from price_changes pc join live l on l.id = pc.item_id
     where pc.field = 'list_price' and pc.changed_at >= l.online_since
     group by pc.item_id
  ),
  hist as (
    -- the price it went online at: the highest asking price since then; and the last markdown
    select l.*, greatest(l.price, coalesce(h.max_price, 0)) as start_price, h.last_markdown,
           floor(extract(epoch from now() - l.online_since) / 86400)::int as days_online
      from live l left join pch h on h.item_id = l.id
  ),
  -- materialized: the step of each item is looked up once, not again in every expression that uses it
  calc as materialized (
    select h.*, st.days as step_days, st.pct as step_pct, nx.days as next_days,
           -- never under cost + fees + shipping + 1 € (rounded up to the euro), nor under the minimum price
           ceil((h.cost + v_fee_fixed + v_ship + 100) / (1 - v_fee_pct / 100) / 100) * 100 as floor_cost
      from hist h
      left join lateral (select s.days, s.pct from steps s where s.days <= h.days_online order by s.days desc limit 1) st on true
      left join lateral (select min(s.days) as days from steps s where s.days > h.days_online) nx on true
  ),
  base as (
    select c.*,
           case when c.step_pct is not null then round(c.start_price * (1 - c.step_pct / 100) / 100) * 100 end as target,
           greatest(c.floor_cost, coalesce(c.min_price, 0)) as floor_price
      from calc c
  ),
  sugg as (
    select b.*,
           case when b.target is not null then greatest(b.target, b.floor_price) end as sug,
           -- what stops the price going down to the rule's target
           case when b.target is null or b.target >= b.floor_price then null
                when coalesce(b.min_price, 0) >= b.floor_cost then 'min_price' else 'cost' end as held,
           -- a recent markdown still in effect gives it time to work (one cancelled with « Annuler » does not count)
           b.last_markdown is not null and b.last_markdown > now() - make_interval(days => v_wait) and b.price < b.start_price as wait,
           k.item_id is not null as skip
      from base b left join price_skips k on k.item_id = b.id and k.until >= v_today
  )
  select s.id, s.price, s.start_price::bigint, s.sug::bigint, s.step_days, s.step_pct, s.next_days, s.days_online, s.held, s.wait, s.skip,
         case when s.sug is not null then round(s.sug * (1 - v_fee_pct / 100) - v_fee_fixed - v_ship - s.cost)::bigint end,
         coalesce(s.sug <= s.price - 100 and not s.wait and not s.skip, false)
    from sugg s;
end $$;
revoke all on function public.price_plan(uuid[]) from public, anon;
grant execute on function public.price_plan(uuid[]) to authenticated;

-- « Prix à baisser » now reads the shared plan (same output as before)
create or replace function public.price_suggestions() returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_org uuid := public.auth_org_id();
  v_steps jsonb; v_wait int;
  r jsonb;
begin
  if v_org is null or not public.is_manager() then
    raise exception using errcode = 'LF403', message = 'Prix réservés aux responsables.';
  end if;
  select price_steps, price_wait_days into v_steps, v_wait from organizations where id = v_org;

  with plan as (select * from public.price_plan()),
  -- the link of each live listing, in one pass
  links as (
    select distinct on (l.item_id) l.item_id, l.url from listings l
     where l.org_id = v_org and l.status = 'active' and l.url is not null order by l.item_id, l.listed_at desc
  ),
  cuts as (
    -- what markdowns did: sold within 14 days after the markdown, by size of the cut (last 180 days)
    select pc.item_id, (pc.old_cents - pc.new_cents) * 100.0 / pc.old_cents as cut,
           exists (select 1 from items i where i.id = pc.item_id and i.sold_at between pc.changed_at and pc.changed_at + interval '14 days') as sold14
      from price_changes pc
     where pc.org_id = v_org and pc.field = 'list_price' and pc.old_cents > 0 and pc.new_cents < pc.old_cents
       and pc.changed_at >= now() - interval '180 days' and pc.changed_at <= now() - interval '14 days'
  )
  select jsonb_build_object(
    'steps', v_steps, 'wait_days', v_wait,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'sku', i.sku, 'title', i.title, 'brand', b.name, 'category', c.name, 'size', i.size_label,
        'url', lk.url,
        'price', p.price, 'start_price', p.start_price, 'suggested', p.suggested, 'min_price', i.min_price_cents,
        'cost', e.cost_cents,
        'days_online', p.days_online, 'step_days', p.step_days, 'step_pct', p.step_pct, 'held_by', p.held_by,
        'margin', p.margin) order by p.days_online desc, i.sku)
      from plan p join items i on i.id = p.item_id join v_item_economics e on e.item_id = p.item_id
      left join brands b on b.id = i.brand_id left join categories c on c.id = i.category_id
      left join links lk on lk.item_id = p.item_id
     where p.todo), '[]'),
    -- held at the floor: the price cannot go lower without selling at a loss or under the minimum
    'at_floor', (select count(*) from plan where suggested is not null and suggested > price - 100 and held_by is not null and not skipped),
    'waiting', (select count(*) from plan where waiting and suggested <= price - 100),
    'skipped', (select count(*) from plan where skipped and suggested is not null),
    'soon', (select count(*) from plan where next_days is not null and next_days - days_online <= 7),
    'listed', (select count(*) from plan),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'sku', i.sku, 'title', i.title, 'old', pc.old_cents, 'new', pc.new_cents,
        'at', pc.changed_at,
        'url', (select l.url from listings l where l.item_id = i.id and l.url is not null order by l.listed_at desc limit 1)) order by pc.changed_at desc)
      from (select distinct on (item_id) * from price_changes
             where org_id = v_org and field = 'list_price' and new_cents < old_cents and changed_at >= now() - interval '7 days'
             order by item_id, changed_at desc) pc
      join items i on i.id = pc.item_id
     -- a reminder to change the price on Vinted too: only items still for sale
     where i.status = 'listed' and i.deleted_at is null and i.list_price_cents = pc.new_cents), '[]'),
    'effect', (select jsonb_agg(jsonb_build_object('band', band, 'n', n, 'sold', sold) order by band)
                 from (select case when cut < 12.5 then 1 when cut < 22.5 then 2 else 3 end as band, count(*) as n, count(*) filter (where sold14) as sold
                         from cuts group by 1) x)
  ) into r;
  return r;
end $$;

-- ── The whole money picture, aggregated in the database (never item by item in the browser)
create function public.finance_overview() returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_org uuid := public.auth_org_id();
  o organizations;
  v_bal cash_balances;
  v_anchor timestamptz;
  v_window int; v_analysis int; v_b1 int; v_b2 int;
  r jsonb;
begin
  if v_org is null or not public.is_manager() then
    raise exception using errcode = 'LF403', message = 'Finance réservée aux responsables.';
  end if;
  select * into o from organizations where id = v_org;
  select * into v_bal from cash_balances where org_id = v_org order by as_of desc, created_at desc limit 1;
  v_anchor := v_bal.as_of;
  v_window := least(400, greatest(30, coalesce((o.forecast->>'window_days')::int, 90)));
  v_analysis := least(365, greatest(7, coalesce((o.forecast->>'analysis_days')::int, 30)));
  v_b1 := coalesce(o.aging_bounds[1], 30); v_b2 := coalesce(o.aging_bounds[2], 60);

  with e as (
    select e.*, i.listed_at, i.list_price_cents,
           -- whole days, as in finance_items: the same item is never dormant here and active in the list
           floor(extract(epoch from now() - case when o.aging_basis = 'listed' then coalesce(i.listed_at, e.received_at) else e.received_at end) / 86400) as age
      from v_item_economics e join items i on i.id = e.item_id
     where e.org_id = v_org
  ),
  stock as (select * from e where status in ('received', 'sorted', 'photographed', 'measured', 'listing_ready', 'listed', 'reserved', 'on_hold', 'returned')),
  -- one row per sale that went through the stock (orders not cancelled, imported history excluded from cash)
  sold as (select * from e where is_sold and sold_at is not null),
  -- refunds and active lines summed once per order (joins, not a sub-query per order)
  rfd as (select rf.order_id, sum(rf.amount_cents) as refunded from refunds rf where rf.org_id = v_org group by rf.order_id),
  lns as (select ol.order_id, count(*) as items, sum(ol.cost_snapshot_cents) as cogs from order_lines ol
           where ol.org_id = v_org and ol.status = 'active' group by ol.order_id),
  ord as (
    select od.*, coalesce(rfd.refunded, 0) as refunded, coalesce(lns.items, 0) as line_items, coalesce(lns.cogs, 0) as line_cogs
      from orders od left join rfd on rfd.order_id = od.id left join lns on lns.order_id = od.id
     where od.org_id = v_org and od.status <> 'cancelled'
  )
  select jsonb_build_object(
    'now', now(),
    'settings', jsonb_build_object(
      'cash_reserve_cents', o.cash_reserve_cents, 'liquidation_pct', o.liquidation_pct, 'immob_levels', o.immob_levels,
      'aging_basis', o.aging_basis, 'aging_bounds', jsonb_build_array(v_b1, v_b2, o.dead_stock_days), 'dead_stock_days', o.dead_stock_days,
      'forecast', o.forecast, 'vinted_fee_pct', o.vinted_fee_pct, 'vinted_fee_fixed_cents', o.vinted_fee_fixed_cents,
      'declaration_frequency', o.declaration_frequency, 'versement_liberatoire', o.versement_liberatoire,
      'contribution_rate_pct', (select coalesce(sum(rate_pct), 0) from (
          select distinct on (kind) kind, rate_pct from tax_rates
           where org_id = v_org and valid_from <= current_date
             and (kind <> 'versement_liberatoire' or o.versement_liberatoire)
           order by kind, valid_from desc) t)),
    'balance', case when v_bal.id is null then null else jsonb_build_object('as_of', v_bal.as_of, 'amount_cents', v_bal.amount_cents, 'note', v_bal.note) end,
    -- what was recorded since the declared balance (cash in, cash out)
    'ledger', case when v_anchor is null then null else jsonb_build_object(
      'receipts_cents', (select coalesce(sum(gross_cents - platform_fee_cents - promotion_fee_cents), 0) from ord where paid_at > v_anchor and not is_historical),
      'refunds_cents', (select coalesce(sum(rf.amount_cents), 0) from refunds rf join orders od on od.id = rf.order_id
                         where od.org_id = v_org and od.status <> 'cancelled' and rf.refunded_at > v_anchor),
      'shipping_cents', (select coalesce(sum(shipping_cost_cents + packaging_cost_cents), 0) from ord where sold_at > v_anchor and not is_historical),
      'purchases_cents', (select coalesce(sum(l.amount_cents), 0) from batch_cost_lines l join batches b on b.id = l.batch_id
                           where b.org_id = v_org and b.kind = 'purchase' and b.purchased_at > (v_anchor at time zone 'Europe/Paris')::date)
                       + (select coalesce(sum(a.amount_cents), 0) from batch_cost_adjustments a join batches b on b.id = a.batch_id
                           where b.org_id = v_org and b.kind = 'purchase' and a.created_at > v_anchor),
      'expenses_by_category', coalesce((select jsonb_object_agg(category, total) from (
          select category::text, sum(amount_cents) as total from expenses
           where org_id = v_org and spent_on > (v_anchor at time zone 'Europe/Paris')::date group by category) x), '{}')
    ) end,
    'stock', (select jsonb_build_object(
        'count', count(*), 'cost_cents', coalesce(sum(cost_cents), 0),
        'priced_count', count(*) filter (where list_price_cents is not null),
        'price_cents', coalesce(sum(list_price_cents), 0),
        'unpriced_count', count(*) filter (where list_price_cents is null),
        'unpriced_cost_cents', coalesce(sum(cost_cents) filter (where list_price_cents is null), 0),
        'listed_count', count(*) filter (where status = 'listed'),
        'dormant_count', count(*) filter (where age > o.dead_stock_days),
        'dormant_cost_cents', coalesce(sum(cost_cents) filter (where age > o.dead_stock_days), 0),
        'dormant_price_cents', coalesce(sum(list_price_cents) filter (where age > o.dead_stock_days), 0),
        'aging', jsonb_build_array(
          jsonb_build_object('from', 0, 'to', v_b1, 'count', count(*) filter (where age <= v_b1), 'cost_cents', coalesce(sum(cost_cents) filter (where age <= v_b1), 0)),
          jsonb_build_object('from', v_b1 + 1, 'to', v_b2, 'count', count(*) filter (where age > v_b1 and age <= v_b2), 'cost_cents', coalesce(sum(cost_cents) filter (where age > v_b1 and age <= v_b2), 0)),
          jsonb_build_object('from', v_b2 + 1, 'to', o.dead_stock_days, 'count', count(*) filter (where age > v_b2 and age <= o.dead_stock_days), 'cost_cents', coalesce(sum(cost_cents) filter (where age > v_b2 and age <= o.dead_stock_days), 0)),
          jsonb_build_object('from', o.dead_stock_days + 1, 'to', null, 'count', count(*) filter (where age > o.dead_stock_days), 'cost_cents', coalesce(sum(cost_cents) filter (where age > o.dead_stock_days), 0)))
      ) from stock),
    -- written off: not capital any more, shown for transparency
    'rejected', (select jsonb_build_object('count', count(*), 'cost_cents', coalesce(sum(cost_cents), 0)) from e where status = 'rejected'),
    -- money from sales not received yet (Vinted wallet not released)
    'receivable', (select jsonb_build_object('count', count(*),
        'amount_cents', coalesce(sum(greatest(gross_cents - platform_fee_cents - promotion_fee_cents - refunded, 0)), 0),
        'oldest_sold_at', min(sold_at)) from ord where paid_at is null and not is_historical),
    'unpaid_orders', coalesce((select jsonb_agg(jsonb_build_object('sold_at', sold_at,
        'amount_cents', greatest(gross_cents - platform_fee_cents - promotion_fee_cents - refunded, 0)) order by sold_at)
        from ord where paid_at is null and not is_historical), '[]'),
    -- sales performance on the analysis period and the one before (same length)
    'periods', jsonb_build_object(
      'days', v_analysis,
      'current', (select jsonb_build_object('items', count(*), 'revenue_cents', coalesce(sum(revenue_cents), 0), 'cogs_cents', coalesce(sum(cost_cents), 0),
                    'variable_cents', coalesce(sum(variable_costs_cents + vat_cents), 0), 'gross_profit_cents', coalesce(sum(gross_profit_cents), 0))
                    from sold where sold_at > now() - make_interval(days => v_analysis)),
      'previous', (select jsonb_build_object('items', count(*), 'revenue_cents', coalesce(sum(revenue_cents), 0), 'cogs_cents', coalesce(sum(cost_cents), 0),
                    'variable_cents', coalesce(sum(variable_costs_cents + vat_cents), 0), 'gross_profit_cents', coalesce(sum(gross_profit_cents), 0))
                    from sold where sold_at > now() - make_interval(days => 2 * v_analysis) and sold_at <= now() - make_interval(days => v_analysis)),
      'year', (select jsonb_build_object('items', count(*), 'revenue_cents', coalesce(sum(revenue_cents), 0), 'cogs_cents', coalesce(sum(cost_cents), 0),
                    'gross_profit_cents', coalesce(sum(gross_profit_cents), 0)) from sold where sold_at > now() - interval '365 days'),
      'cashed_cents', (select coalesce(sum(montant_cents), 0) from v_livre_recettes where org_id = v_org
                        and date_encaissement > (now() at time zone 'Europe/Paris')::date - v_analysis),
      'expenses_by_category', coalesce((select jsonb_object_agg(category, total) from (
          select category::text, sum(amount_cents) as total from expenses
           where org_id = v_org and spent_on > (now() at time zone 'Europe/Paris')::date - v_analysis group by category) x), '{}'),
      'first_sale_at', (select min(sold_at) from sold),
      'avg_days_to_sell', (select round(avg(extract(epoch from sold_at - received_at) / 86400)::numeric, 1) from sold
                            where sold_at > received_at + interval '1 hour' and sold_at > now() - interval '365 days')),
    -- day by day over the history window: the basis of the forecast (cash after fees and seller shipping)
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'net_cents', coalesce(x.net, 0), 'gross_cents', coalesce(x.gross, 0),
        'items', coalesce(x.items, 0), 'cogs_cents', coalesce(x.cogs, 0)) order by d)
        from generate_series((now() at time zone 'Europe/Paris')::date - v_window + 1, (now() at time zone 'Europe/Paris')::date, interval '1 day') d
        left join (
          select (od.sold_at at time zone 'Europe/Paris')::date as day,
                 sum(od.gross_cents - od.platform_fee_cents - od.promotion_fee_cents - od.shipping_cost_cents - od.packaging_cost_cents - od.refunded) as net,
                 sum(od.gross_cents - od.refunded) as gross,
                 sum(od.line_items) as items,
                 sum(od.line_cogs) as cogs
            from ord od where not od.is_historical and od.sold_at > now() - make_interval(days => v_window + 1)
           group by 1) x on x.day = d::date), '[]'),
    -- month by month over two years: seasonality, only used when there is enough history
    'monthly', coalesce((select jsonb_agg(jsonb_build_object('month', m, 'net_cents', net, 'orders', n) order by m) from (
        select to_char(od.sold_at at time zone 'Europe/Paris', 'YYYY-MM') as m,
               sum(od.gross_cents - od.platform_fee_cents - od.promotion_fee_cents - od.shipping_cost_cents - od.packaging_cost_cents - od.refunded) as net,
               count(*) as n
          from ord od where not od.is_historical and od.sold_at > now() - interval '25 months' group by 1) y), '[]'),
    -- cash received per month (livre des recettes), for the contributions still to pay
    'cashed_months', coalesce((select jsonb_agg(jsonb_build_object('month', to_char(month, 'YYYY-MM'), 'cents', turnover_cents) order by month)
        from v_monthly_turnover where org_id = v_org and month >= date_trunc('month', now()) - interval '4 months'), '[]'),
    'snapshots', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'cash_cents', cash_cents, 'stock_cost_cents', stock_cost_cents,
        'dormant_cost_cents', dormant_cost_cents, 'receivable_cents', receivable_cents) order by day)
        from capital_snapshots where org_id = v_org and day > current_date - 400), '[]'),
    'recurring', coalesce((select jsonb_agg(to_jsonb(x) order by x.label) from recurring_expenses x where x.org_id = v_org), '[]'),
    'planned', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'label', p.label, 'amount_cents', p.amount_cents, 'due_on', p.due_on,
        'supplier', s.name) order by p.due_on) from planned_purchases p left join suppliers s on s.id = p.supplier_id
        where p.org_id = v_org and p.status = 'planned'), '[]')
  ) into r;
  return r;
end $$;
revoke all on function public.finance_overview() from public, anon;
grant execute on function public.finance_overview() to authenticated;

/** Records today's capital (once a day, the latest call wins), for the evolution */
create function public.finance_snapshot(p_cash bigint, p_stock bigint, p_dormant bigint, p_receivable bigint) returns void
language plpgsql security invoker set search_path = public as $$
declare v_org uuid := public.auth_org_id();
begin
  if v_org is null or not public.is_manager() then return; end if;
  insert into capital_snapshots(org_id, day, cash_cents, stock_cost_cents, dormant_cost_cents, receivable_cents)
  values (v_org, (now() at time zone 'Europe/Paris')::date, p_cash, p_stock, p_dormant, p_receivable)
  on conflict (org_id, day) do update set cash_cents = excluded.cash_cents, stock_cost_cents = excluded.stock_cost_cents,
    dormant_cost_cents = excluded.dormant_cost_cents, receivable_cents = excluded.receivable_cents;
end $$;
grant execute on function public.finance_snapshot(bigint, bigint, bigint, bigint) to authenticated;

/**
 * Drill-down: the items behind a stock figure. p_view: 'stock' (all), 'active' (not dormant), 'dormant', 'age'
 * (p_min / p_max days), 'unpriced'. Paginated in the database; totals are for the whole selection.
 */
create function public.finance_items(p_view text, p_min int default null, p_max int default null,
                                     p_sort text default 'cost', p_limit int default 50, p_offset int default 0) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_org uuid := public.auth_org_id();
  o organizations;
  r jsonb;
begin
  if v_org is null or not public.is_manager() then
    raise exception using errcode = 'LF403', message = 'Finance réservée aux responsables.';
  end if;
  select * into o from organizations where id = v_org;
  with s as (
    select e.item_id, e.sku, e.cost_cents, e.status, i.list_price_cents, i.title, i.size_label, b.name as brand, c.name as category,
           lo.code as location,
           floor(extract(epoch from now() - case when o.aging_basis = 'listed' then coalesce(i.listed_at, e.received_at) else e.received_at end) / 86400)::int as age
      from v_item_economics e
      join items i on i.id = e.item_id
      left join brands b on b.id = i.brand_id
      left join categories c on c.id = i.category_id
      left join locations lo on lo.id = i.current_location_id
     where e.org_id = v_org
       and e.status in ('received', 'sorted', 'photographed', 'measured', 'listing_ready', 'listed', 'reserved', 'on_hold', 'returned')
  ),
  f as (
    select * from s where case p_view
      when 'stock' then true
      when 'active' then age <= o.dead_stock_days
      when 'dormant' then age > o.dead_stock_days
      when 'age' then age >= coalesce(p_min, 0) and (p_max is null or age <= p_max)
      when 'unpriced' then list_price_cents is null
      else false end
  ),
  page as (
    select * from f
     order by case when p_sort = 'age' then -age when p_sort = 'price' then -coalesce(list_price_cents, 0) else -cost_cents end, sku
     limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'cost_cents', (select coalesce(sum(cost_cents), 0) from f),
    'price_cents', (select coalesce(sum(list_price_cents), 0) from f),
    'dead_stock_days', o.dead_stock_days,
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', p.item_id, 'sku', p.sku, 'title', p.title, 'brand', p.brand, 'category', p.category,
        'size', p.size_label, 'status', p.status, 'cost_cents', p.cost_cents, 'price_cents', p.list_price_cents, 'age', p.age,
        'location', p.location, 'platform', li.platform, 'url', li.url,
        'suggested_cents', pp.suggested, 'suggest_todo', pp.todo, 'held_by', pp.held_by)
        order by case when p_sort = 'age' then -p.age when p_sort = 'price' then -coalesce(p.list_price_cents, 0) else -p.cost_cents end, p.sku)
      -- platform, link and price suggestion only for the rows of the page, not for the whole stock
      from page p
      left join public.price_plan((select array_agg(item_id) from page)) pp on pp.item_id = p.item_id
      left join lateral (select l.channel as platform, l.url from listings l where l.item_id = p.item_id and l.status = 'active'
                          order by (l.url is not null) desc, l.listed_at desc limit 1) li on true), '[]')
  ) into r;
  return r;
end $$;
revoke all on function public.finance_items(text, int, int, text, int, int) from public, anon;
grant execute on function public.finance_items(text, int, int, text, int, int) to authenticated;

/** Drill-down: the sales behind a margin, over the last p_days; totals for the whole period */
create function public.finance_sales(p_days int, p_limit int default 50, p_offset int default 0) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare v_org uuid := public.auth_org_id(); r jsonb;
begin
  if v_org is null or not public.is_manager() then
    raise exception using errcode = 'LF403', message = 'Finance réservée aux responsables.';
  end if;
  with s as (
    select e.item_id, e.sku, e.sold_at, e.revenue_cents, e.cost_cents, e.variable_costs_cents + e.vat_cents as variable_cents,
           e.gross_profit_cents, i.title, b.name as brand,
           (select o.number from order_lines ol join orders o on o.id = ol.order_id where ol.item_id = e.item_id and ol.status = 'active' limit 1) as order_number
      from v_item_economics e join items i on i.id = e.item_id left join brands b on b.id = i.brand_id
     where e.org_id = v_org and e.is_sold and e.sold_at > now() - make_interval(days => greatest(p_days, 1))
  )
  select jsonb_build_object(
    'total', (select count(*) from s),
    'revenue_cents', (select coalesce(sum(revenue_cents), 0) from s),
    'cost_cents', (select coalesce(sum(cost_cents), 0) from s),
    'variable_cents', (select coalesce(sum(variable_cents), 0) from s),
    'gross_profit_cents', (select coalesce(sum(gross_profit_cents), 0) from s),
    'rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.sold_at desc) from
        (select * from s order by sold_at desc limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)) x), '[]')
  ) into r;
  return r;
end $$;
revoke all on function public.finance_sales(int, int, int) from public, anon;
grant execute on function public.finance_sales(int, int, int) to authenticated;

/** Drill-down: sales not paid out yet */
create function public.finance_receivables() returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare v_org uuid := public.auth_org_id(); r jsonb;
begin
  if v_org is null or not public.is_manager() then
    raise exception using errcode = 'LF403', message = 'Finance réservée aux responsables.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'number', o.number, 'sold_at', o.sold_at, 'status', o.status, 'buyer', o.buyer_handle,
           'gross_cents', o.gross_cents, 'fees_cents', o.platform_fee_cents + o.promotion_fee_cents,
           'refunded_cents', coalesce((select sum(amount_cents) from refunds rf where rf.order_id = o.id), 0),
           'skus', (select string_agg(i.sku, ', ' order by i.sku) from order_lines ol join items i on i.id = ol.item_id where ol.order_id = o.id and ol.status = 'active'))
           order by o.sold_at), '[]')
    into r from orders o
   where o.org_id = v_org and o.status <> 'cancelled' and o.paid_at is null and not o.is_historical;
  return r;
end $$;
revoke all on function public.finance_receivables() from public, anon;
grant execute on function public.finance_receivables() to authenticated;

/**
 * Segments compared on capital: p_dim in category, brand, supplier, size, material, platform. Sales over the last
 * p_days (null = all), current stock always. Items whose sale was imported (no reception) do not count in the delay.
 */
create function public.finance_segments(p_dim text, p_days int default 365) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare v_org uuid := public.auth_org_id(); r jsonb;
begin
  if v_org is null or not public.is_manager() then
    raise exception using errcode = 'LF403', message = 'Finance réservée aux responsables.';
  end if;
  if p_dim not in ('category', 'brand', 'supplier', 'size', 'material', 'platform') then
    raise exception using errcode = 'LF422', message = 'Axe d''analyse inconnu.';
  end if;
  with e as (
    select e.*, i.size_label, i.material_id,
           e.status in ('received', 'sorted', 'photographed', 'measured', 'listing_ready', 'listed', 'reserved', 'on_hold', 'returned') as in_stock,
           e.is_sold and (p_days is null or e.sold_at > now() - make_interval(days => p_days)) as sold_in,
           case when e.is_sold and e.sold_at > e.received_at + interval '1 hour' then extract(epoch from e.sold_at - e.received_at) / 86400 end as days
      from v_item_economics e join items i on i.id = e.item_id
     where e.org_id = v_org
  ),
  -- names come from joins (one pass), not from a sub-query per item
  sale_ch as (
    select distinct on (ol.item_id) ol.item_id, od.channel
      from order_lines ol join orders od on od.id = ol.order_id
     where p_dim = 'platform' and ol.status = 'active' and od.org_id = v_org
     order by ol.item_id, od.sold_at desc
  ),
  list_ch as (
    select distinct on (l.item_id) l.item_id, l.channel
      from listings l
     where p_dim = 'platform' and l.status = 'active' and l.org_id = v_org
     order by l.item_id, l.listed_at desc
  ),
  k as (
    select e.*, case p_dim
        when 'category' then coalesce(c.name, 'Sans catégorie')
        when 'brand' then coalesce(b.name, 'Sans marque')
        when 'supplier' then coalesce(su.name, '—')
        when 'size' then coalesce(nullif(trim(e.size_label), ''), 'Sans taille')
        when 'material' then coalesce(av.value, 'Non renseignée')
        when 'platform' then coalesce(sc.channel, lc.channel, 'Non publié')
      end as seg
      from e
      left join categories c on p_dim = 'category' and c.id = e.category_id
      left join brands b on p_dim = 'brand' and b.id = e.brand_id
      left join suppliers su on p_dim = 'supplier' and su.id = e.supplier_id
      left join attribute_values av on p_dim = 'material' and av.id = e.material_id
      left join sale_ch sc on sc.item_id = e.item_id
      left join list_ch lc on lc.item_id = e.item_id
     where e.in_stock or e.sold_in
  ),
  g as (
    select seg, count(*) as items, count(*) filter (where sold_in) as sold, count(*) filter (where in_stock) as stock,
           round(avg(cost_cents)) as avg_cost, round(avg(revenue_cents) filter (where sold_in)) as avg_price,
           coalesce(sum(revenue_cents) filter (where sold_in), 0) as revenue, coalesce(sum(gross_profit_cents) filter (where sold_in), 0) as margin,
           coalesce(sum(cost_cents) filter (where sold_in), 0) as sold_cost, round(avg(days) filter (where sold_in)::numeric, 1) as avg_days,
           count(days) filter (where sold_in) as timed,
           coalesce(sum(cost_cents) filter (where in_stock), 0) as stock_cost
      from k group by seg
  )
  select coalesce(jsonb_agg(jsonb_build_object('name', seg, 'items', items, 'sold', sold, 'stock', stock, 'avg_cost_cents', avg_cost,
           'avg_price_cents', avg_price, 'revenue_cents', revenue, 'margin_cents', margin, 'sold_cost_cents', sold_cost,
           'avg_days', avg_days, 'timed', timed, 'stock_cost_cents', stock_cost) order by revenue desc, stock_cost desc), '[]')
    into r from (select * from g order by revenue desc, stock_cost desc limit 60) g;
  return r;
end $$;
revoke all on function public.finance_segments(text, int) from public, anon;
grant execute on function public.finance_segments(text, int) to authenticated;
