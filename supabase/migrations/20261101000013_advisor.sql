-- Lefort OS — advisor ("Conseils"): the figures behind the advice, computed from the business data in one call.
-- No AI: the app turns these facts into tasks and recommendations with explicit rules (src/lib/advisor.ts).
-- SECURITY INVOKER: everything goes through the caller's row-level security (money views are managers-only).

-- ───────────────────────── Faster row-level security ─────────────────────────
-- Policies called public.is_manager() / auth_org_id() once per row (1.2 s to read 20 000 item costs).
-- Wrapped in a sub-select, Postgres evaluates them once per query: same rules, much faster.
do $$
declare t text;
begin
  foreach t in array array['item_costs', 'batch_cost_lines', 'batch_cost_adjustments', 'orders',
                           'order_lines', 'refunds', 'expenses', 'scenarios', 'audit_log'] loop
    execute format('alter policy %I on %I using (org_id = (select public.auth_org_id()) and (select public.is_manager()))',
                   t || '_mgr_read', t);
  end loop;
  foreach t in array array['suppliers', 'brands', 'measurement_templates', 'shot_lists', 'categories',
    'attribute_values', 'tax_rates', 'locations', 'batches', 'sku_labels', 'items', 'item_photos',
    'item_measurements', 'item_events', 'item_location_moves', 'price_changes', 'listings',
    'shipments', 'ai_suggestions'] loop
    execute format('alter policy %I on %I using (org_id = (select public.auth_org_id()))', t || '_read', t);
  end loop;
end $$;

create function public.advisor_facts() returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_org uuid := public.auth_org_id();
  v_dead int;
  v_fee_pct numeric; v_fee_fixed bigint;
  v_ship_avg numeric;
  r jsonb;
begin
  if v_org is null or not public.is_manager() then
    raise exception using errcode = 'LF403', message = 'Conseils réservés aux responsables.';
  end if;
  select dead_stock_days, vinted_fee_pct, vinted_fee_fixed_cents into v_dead, v_fee_pct, v_fee_fixed
    from organizations where id = v_org;

  -- average shipping + packaging paid per sold item (last 180 days), used to tell a loss-making price
  select coalesce(sum(o.shipping_cost_cents + o.packaging_cost_cents)::numeric / nullif(count(ol.id), 0), 0) into v_ship_avg
    from orders o join order_lines ol on ol.order_id = o.id and ol.status = 'active'
   where o.org_id = v_org and o.status <> 'cancelled' and o.sold_at >= now() - interval '180 days';

  with e as (
    select e.*, i.size_label, i.list_price_cents, i.title, i.status_changed_at, i.priority,
           coalesce(i.listed_at, i.status_changed_at) as online_since,
           b.name as brand, c.name as category
      from v_item_economics e
      join items i on i.id = e.item_id
      left join brands b on b.id = e.brand_id
      left join categories c on c.id = e.category_id
     where e.org_id = v_org
  ),
  stock as (select * from e where status in ('received', 'sorted', 'photographed', 'measured', 'listing_ready', 'listed', 'reserved', 'on_hold', 'returned')),
  -- time to sell is only known when the item went through the stock (imported past sales are created after the sale)
  sold as (select *, case when sold_at > received_at + interval '1 hour'
                          then greatest(extract(epoch from sold_at - received_at) / 86400, 0.5) end as days_in_stock
             from e where is_sold and sold_at is not null),
  -- brand averages of sold items: the reference price of a brand
  brand_ref as (select brand_id, count(*) as n, avg(revenue_cents) as avg_price, avg(gross_profit_cents) as avg_profit from sold group by brand_id),
  bat as (select b.id as batch_id, b.code, b.supplier_id, sup.name as supplier, b.purchased_at,
                 count(e.item_id) as items, count(e.item_id) filter (where e.is_sold) as sold,
                 coalesce(sum(e.revenue_cents), 0) as revenue, coalesce(sum(e.variable_costs_cents + e.vat_cents), 0) as variable,
                 (select coalesce(sum(amount_cents), 0) from batch_cost_lines where batch_id = b.id)
                 + (select coalesce(sum(amount_cents), 0) from batch_cost_adjustments where batch_id = b.id) as cost
            from batches b join suppliers sup on sup.id = b.supplier_id join e on e.batch_id = b.id
           where b.org_id = v_org and b.kind = 'purchase'
           group by b.id, sup.name),
  -- priced below what it costs once Vinted fees and shipping are paid
  bc as (select *, list_price_cents * (1 - v_fee_pct / 100) - v_fee_fixed - v_ship_avg as net from stock
          where list_price_cents is not null and cost_cents > 0
            and list_price_cents * (1 - v_fee_pct / 100) - v_fee_fixed - v_ship_avg < cost_cents),
  -- priced well under what the brand usually sells for (at least 3 sales of the brand)
  up as (select s.*, br.avg_price, br.n from stock s join brand_ref br on br.brand_id = s.brand_id
          where br.n >= 3 and s.list_price_cents is not null and s.list_price_cents < br.avg_price * 0.7)
  select jsonb_build_object(
    'dead_days', v_dead,
    'fee_pct', v_fee_pct, 'fee_fixed_cents', v_fee_fixed, 'ship_avg_cents', round(v_ship_avg),

    -- ── work waiting
    'queues', (select coalesce(jsonb_object_agg(status, jsonb_build_object('n', n, 'oldest_days', oldest)), '{}') from (
                 select i.status, count(*) as n, round(max(extract(epoch from now() - i.status_changed_at) / 86400)::numeric, 1) as oldest
                   from items i where i.org_id = v_org and i.deleted_at is null
                    and i.status in ('received', 'sorted', 'photographed', 'measured', 'returned', 'listing_ready', 'on_hold', 'reserved')
                  group by i.status) q),
    'blocked', (select jsonb_build_object('n', count(*), 'oldest_days', round(max(extract(epoch from now() - blocked_at) / 86400)::numeric, 1))
                  from items where org_id = v_org and deleted_at is null and blocked_reason is not null),
    'to_ship', (select jsonb_build_object('orders', count(*), 'oldest_hours', round(max(extract(epoch from now() - sold_at) / 3600)::numeric))
                  from orders where org_id = v_org and status = 'pending'),
    'reserved_long', (select coalesce(jsonb_agg(jsonb_build_object('id', item_id, 'sku', sku, 'brand', brand,
                          'days', round((extract(epoch from now() - status_changed_at) / 86400)::numeric, 1)) order by status_changed_at), '[]')
                        from (select * from stock where status = 'reserved' and status_changed_at < now() - interval '3 days' order by status_changed_at limit 50) x),
    'reserved_long_n', (select count(*) from stock where status = 'reserved' and status_changed_at < now() - interval '3 days'),
    'ready_no_price', (select count(*) from stock where status = 'listing_ready' and list_price_cents is null),
    -- items ready to publish, best expected profit first (own price, else the brand's average sale price)
    'ready', (select jsonb_build_object('n', count(*), 'value_cents', coalesce(sum(list_price_cents), 0)) from stock where status = 'listing_ready'),
    -- the 50 items ready to publish with the best expected profit (own price, else the brand's average sale price)
    'ready_best', (select coalesce(jsonb_agg(x order by ord), '[]') from (
                select jsonb_build_object('id', s.item_id, 'sku', s.sku, 'brand', s.brand, 'title', s.title, 'priority', s.priority,
                         'price_cents', s.list_price_cents, 'cost_cents', s.cost_cents,
                         'expected_profit_cents', round(coalesce(s.list_price_cents, br.avg_price) * (1 - v_fee_pct / 100) - v_fee_fixed - v_ship_avg - s.cost_cents)) as x,
                       row_number() over (order by coalesce(s.list_price_cents, br.avg_price) * (1 - v_fee_pct / 100) - s.cost_cents desc nulls last) as ord
                  from stock s left join brand_ref br on br.brand_id = s.brand_id and br.n >= 2
                 where s.status = 'listing_ready'
                 order by ord limit 50) y),
    'to_label', (select count(*) from items i join locations l on l.id = i.current_location_id
                  where i.org_id = v_org and i.deleted_at is null and l.code = 'EMP-A-ETIQUETER'
                    and i.status in ('listed', 'reserved', 'listing_ready', 'measured', 'received', 'sorted', 'photographed')),
    'batches_incomplete', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'code', b.code, 'expected', b.expected_qty, 'received', n.k)), '[]')
                             from batches b cross join lateral (select count(*) as k from items i where i.batch_id = b.id and i.deleted_at is null and i.status <> 'received') n
                            where b.org_id = v_org and b.status = 'open' and b.expected_qty > 0 and n.k < b.expected_qty
                              and b.purchased_at < current_date - 7),
    'last_vinted_sync', (select max(created_at) from item_events where org_id = v_org and station in ('vinted_sync', 'vinted_import')),

    -- ── stock
    'stock', (select jsonb_build_object('n', count(*), 'cost_cents', coalesce(sum(cost_cents), 0),
                       'value_cents', coalesce(sum(list_price_cents), 0),
                       'offline_n', count(*) filter (where status not in ('listed', 'reserved')),
                       'offline_cost_cents', coalesce(sum(cost_cents) filter (where status not in ('listed', 'reserved')), 0)) from stock),
    'aging', (select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket, 'n', n, 'cost_cents', cost) order by bucket), '[]') from (
                select case when age_days < 30 then 0 when age_days < 60 then 1 when age_days < 90 then 2 when age_days < 180 then 3 else 4 end as bucket,
                       count(*) as n, sum(cost_cents) as cost from stock group by 1) a),
    -- online for longer than the dead-stock threshold, oldest first
    'dormant', (select jsonb_build_object('n', count(*), 'cost_cents', coalesce(sum(cost_cents), 0))
                  from stock where status in ('listed', 'reserved') and online_since < now() - make_interval(days => v_dead)),
    'dormant_items', (select coalesce(jsonb_agg(jsonb_build_object('id', item_id, 'sku', sku, 'brand', brand, 'title', title, 'size', size_label,
                          'price_cents', list_price_cents, 'cost_cents', cost_cents,
                          'days', round((extract(epoch from now() - online_since) / 86400)::numeric)) order by online_since), '[]')
                  from (select * from stock where status in ('listed', 'reserved') and online_since < now() - make_interval(days => v_dead)
                         order by online_since limit 50) d),
    -- priced below what it costs once Vinted fees and shipping are paid
    'below_cost', (select jsonb_build_object('n', count(*), 'loss_cents', coalesce(round(sum(cost_cents - net)), 0),
                          'items', coalesce((select jsonb_agg(jsonb_build_object('id', item_id, 'sku', sku, 'brand', brand, 'price_cents', list_price_cents,
                                     'cost_cents', cost_cents, 'net_cents', round(net)) order by net - cost_cents)
                                     from (select * from bc order by net - cost_cents limit 50) b50), '[]'))
                     from bc),
    -- priced well under what the brand usually sells for (at least 3 sales of the brand)
    'underpriced', (select jsonb_build_object('n', count(*), 'gain_cents', coalesce(round(sum(avg_price * 0.9 - list_price_cents)), 0),
                           'items', coalesce((select jsonb_agg(jsonb_build_object('id', item_id, 'sku', sku, 'brand', brand, 'price_cents', list_price_cents,
                                      'brand_avg_cents', round(avg_price), 'brand_sales', n) order by avg_price - list_price_cents desc)
                                      from (select * from up order by avg_price - list_price_cents desc limit 50) u50), '[]'))
                      from up),

    -- ── what pays (all sales; per group: sales, profit, speed, what is left in stock)
    'brands', (select coalesce(jsonb_agg(g), '[]') from (
                 select jsonb_build_object('id', k.brand_id, 'name', coalesce(k.brand, 'Sans marque'),
                          'sold', count(s.item_id), 'revenue_cents', coalesce(sum(s.revenue_cents), 0), 'profit_cents', coalesce(sum(s.gross_profit_cents), 0),
                          'avg_days', round(avg(s.days_in_stock)::numeric, 1), 'avg_cost_cents', round(avg(s.cost_cents)),
                          'stock', coalesce(max(st.n), 0), 'stock_cost_cents', coalesce(max(st.cost), 0)) as g
                   from (select distinct brand_id, brand from e where status in ('received', 'sorted', 'photographed', 'measured', 'listing_ready', 'listed', 'reserved', 'on_hold', 'returned') or is_sold) k
                   left join sold s on s.brand_id is not distinct from k.brand_id
                   left join (select brand_id, count(*) as n, sum(cost_cents) as cost from stock group by brand_id) st on st.brand_id is not distinct from k.brand_id
                  group by k.brand_id, k.brand) x),
    'categories', (select coalesce(jsonb_agg(g), '[]') from (
                 select jsonb_build_object('id', k.category_id, 'name', coalesce(k.category, 'Sans catégorie'),
                          'sold', count(s.item_id), 'revenue_cents', coalesce(sum(s.revenue_cents), 0), 'profit_cents', coalesce(sum(s.gross_profit_cents), 0),
                          'avg_days', round(avg(s.days_in_stock)::numeric, 1), 'avg_cost_cents', round(avg(s.cost_cents)),
                          'stock', coalesce(max(st.n), 0), 'stock_cost_cents', coalesce(max(st.cost), 0)) as g
                   from (select distinct category_id, category from e where status in ('received', 'sorted', 'photographed', 'measured', 'listing_ready', 'listed', 'reserved', 'on_hold', 'returned') or is_sold) k
                   left join sold s on s.category_id is not distinct from k.category_id
                   left join (select category_id, count(*) as n, sum(cost_cents) as cost from stock group by category_id) st on st.category_id is not distinct from k.category_id
                  group by k.category_id, k.category) x),
    'sizes', (select coalesce(jsonb_agg(g), '[]') from (
                 select jsonb_build_object('name', k.size_label, 'sold', count(s.item_id), 'profit_cents', coalesce(sum(s.gross_profit_cents), 0),
                          'avg_days', round(avg(s.days_in_stock)::numeric, 1),
                          'stock', coalesce(max(st.n), 0)) as g
                   from (select distinct size_label from e where size_label is not null and (is_sold or status in ('received', 'sorted', 'photographed', 'measured', 'listing_ready', 'listed', 'reserved', 'on_hold', 'returned'))) k
                   left join sold s on s.size_label = k.size_label
                   left join (select size_label, count(*) as n from stock group by size_label) st on st.size_label = k.size_label
                  group by k.size_label) x),
    -- real purchases only: stock that existed before Lefort OS has no purchase price to compare.
    -- Profit counts the whole amount paid for the batch (unsold items are money spent too).
    'suppliers', (select coalesce(jsonb_agg(jsonb_build_object('id', supplier_id, 'name', supplier, 'items', items, 'sold', sold,
                          'cost_cents', cost, 'revenue_cents', revenue, 'profit_cents', profit,
                          'roi_pct', case when cost > 0 then round(profit * 100.0 / cost, 1) end,
                          'sell_through_pct', case when items > 0 then round(sold * 100.0 / items, 1) end)), '[]')
                    from (select supplier_id, supplier, sum(items)::int as items, sum(sold)::int as sold, sum(cost)::bigint as cost,
                                 sum(revenue)::bigint as revenue, sum(revenue - variable - cost)::bigint as profit
                            from bat group by supplier_id, supplier) sp),
    'batches', (select coalesce(jsonb_agg(jsonb_build_object('id', batch_id, 'code', code, 'supplier', supplier, 'items', items, 'sold', sold,
                          'cost_cents', cost, 'profit_cents', revenue - variable - cost,
                          'roi_pct', case when cost > 0 then round((revenue - variable - cost) * 100.0 / cost, 1) end,
                          'sell_through_pct', case when items > 0 then round(sold * 100.0 / items, 1) end,
                          'purchased_at', purchased_at)), '[]') from bat),
    'price_bands', (select coalesce(jsonb_agg(jsonb_build_object('band', band, 'sold', n, 'profit_cents', profit, 'revenue_cents', revenue,
                          'avg_days', days) order by band), '[]') from (
                      select case when revenue_cents < 2000 then 0 when revenue_cents < 4000 then 1 when revenue_cents < 6000 then 2
                                  when revenue_cents < 10000 then 3 else 4 end as band,
                             count(*) as n, sum(gross_profit_cents) as profit, sum(revenue_cents) as revenue, round(avg(days_in_stock)::numeric, 1) as days
                        from sold group by 1) p),
    'weekdays', (select coalesce(jsonb_agg(jsonb_build_object('dow', dow, 'n', n) order by dow), '[]') from (
                   select extract(isodow from o.sold_at at time zone 'Europe/Paris')::int as dow, count(*) as n
                     from orders o where o.org_id = v_org and o.status <> 'cancelled' and o.sold_at >= now() - interval '180 days' and not o.is_historical
                    group by 1) w),
    -- accepted price vs asked price on recent sales (offers and negotiation)
    'discount', (select jsonb_build_object('n', count(*), 'avg_pct', round(avg(100 - ol.sale_price_cents * 100.0 / i.list_price_cents), 1))
                   from order_lines ol join orders o on o.id = ol.order_id join items i on i.id = ol.item_id
                  where o.org_id = v_org and o.status <> 'cancelled' and ol.status = 'active' and not o.is_historical
                    and o.sold_at >= now() - interval '180 days' and i.list_price_cents > 0 and ol.sale_price_cents > 0),
    'fees_90d', (select jsonb_build_object('orders', count(*), 'revenue_cents', coalesce(sum(gross_cents), 0),
                        'platform_cents', coalesce(sum(platform_fee_cents + promotion_fee_cents), 0),
                        'shipping_cents', coalesce(sum(shipping_cost_cents), 0), 'packaging_cents', coalesce(sum(packaging_cost_cents), 0))
                   from orders where org_id = v_org and status <> 'cancelled' and not is_historical and sold_at >= now() - interval '90 days'),
    'trend', (select jsonb_build_object(
                'last_n', count(*) filter (where sold_at >= now() - interval '30 days'),
                'prev_n', count(*) filter (where sold_at < now() - interval '30 days'),
                'last_profit_cents', coalesce(sum(gross_profit_cents) filter (where sold_at >= now() - interval '30 days'), 0),
                'prev_profit_cents', coalesce(sum(gross_profit_cents) filter (where sold_at < now() - interval '30 days'), 0),
                'last_revenue_cents', coalesce(sum(revenue_cents) filter (where sold_at >= now() - interval '30 days'), 0),
                'prev_revenue_cents', coalesce(sum(revenue_cents) filter (where sold_at < now() - interval '30 days'), 0))
                from sold where sold_at >= now() - interval '60 days'),
    'totals', (select jsonb_build_object('sold', count(*), 'profit_cents', coalesce(sum(gross_profit_cents), 0),
                        'revenue_cents', coalesce(sum(revenue_cents), 0), 'avg_days', round(avg(days_in_stock)::numeric, 1),
                        'sold_90d', count(*) filter (where sold_at >= now() - interval '90 days')) from sold),
    'turnover', (select coalesce(jsonb_agg(jsonb_build_object('month', month, 'turnover_cents', turnover_cents, 'contributions_cents', contributions_cents) order by month), '[]')
                   from v_monthly_turnover where org_id = v_org and month >= (date_trunc('month', now()) - interval '4 months')::date)
  ) into r
  from (select 1) one;
  return r;
end $$;

revoke all on function public.advisor_facts() from public, anon;
grant execute on function public.advisor_facts() to authenticated;
