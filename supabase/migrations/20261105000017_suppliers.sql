-- Lefort OS — suppliers compared on what matters for buying again: margin on what was sold (not counting the unsold
-- stock as a loss), cost per item, resale price, speed, sell-through within the target window, rejects, and how much
-- of what was paid has come back. Managers only: it carries costs and margins.

create function public.supplier_stats() returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_org uuid := public.auth_org_id();
  v_days int;
  r jsonb;
begin
  if v_org is null or not public.is_manager() then
    raise exception using errcode = 'LF403', message = 'Fournisseurs réservés aux responsables.';
  end if;
  select sellthrough_days into v_days from organizations where id = v_org;

  with it as (
    select b.supplier_id, b.kind, e.status, e.is_sold, e.cost_cents, e.revenue_cents, e.gross_profit_cents,
           e.variable_costs_cents + e.vat_cents as variable_cents, i.list_price_cents,
           e.status in ('received', 'sorted', 'photographed', 'measured', 'listing_ready', 'listed', 'reserved', 'on_hold', 'returned') as in_stock,
           -- time to sell is only known when the item went through the stock (imported past sales are created after the sale)
           case when e.is_sold and e.sold_at > e.received_at + interval '1 hour'
                then greatest(extract(epoch from e.sold_at - e.received_at) / 86400, 0.5) end as days,
           e.received_at <= now() - make_interval(days => v_days) as matured,
           coalesce(e.is_sold and e.sold_at <= e.received_at + make_interval(days => v_days), false) as in_time
      from v_item_economics e
      join items i on i.id = e.item_id
      join batches b on b.id = e.batch_id
     where e.org_id = v_org
  ),
  paid as (
    select b.supplier_id, count(*) filter (where b.kind = 'purchase') as batches,
           max(b.purchased_at) filter (where b.kind = 'purchase') as last_purchase,
           min(b.purchased_at) filter (where b.kind = 'purchase') as first_purchase,
           sum((select coalesce(sum(amount_cents), 0) from batch_cost_lines where batch_id = b.id)
             + (select coalesce(sum(amount_cents), 0) from batch_cost_adjustments where batch_id = b.id)) as paid_cents,
           bool_and(b.kind <> 'purchase') as opening_only
      from batches b where b.org_id = v_org group by b.supplier_id
  ),
  agg as (
    select supplier_id,
           count(*) as items,
           count(*) filter (where is_sold) as sold,
           count(*) filter (where status = 'rejected') as rejected,
           count(*) filter (where in_stock) as in_stock,
           coalesce(sum(cost_cents) filter (where in_stock), 0) as stock_cost_cents,
           coalesce(sum(list_price_cents) filter (where in_stock), 0) as stock_price_cents,
           coalesce(sum(revenue_cents) filter (where is_sold), 0) as revenue_cents,
           coalesce(sum(variable_cents) filter (where is_sold), 0) as variable_cents,
           coalesce(sum(gross_profit_cents) filter (where is_sold), 0) as profit_cents,
           coalesce(sum(cost_cents) filter (where is_sold), 0) as sold_cost_cents,
           round(avg(days)::numeric, 1) as avg_days,
           count(days) as timed,
           count(*) filter (where matured and status <> 'rejected') as matured,
           count(*) filter (where matured and in_time) as in_time
      from it group by supplier_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.name, 'country', s.country, 'contact', s.contact, 'notes', s.notes, 'active', s.active,
           'opening_only', coalesce(p.opening_only, false),
           'batches', coalesce(p.batches, 0), 'first_purchase', p.first_purchase, 'last_purchase', p.last_purchase,
           'paid_cents', coalesce(p.paid_cents, 0),
           'items', coalesce(a.items, 0), 'sold', coalesce(a.sold, 0), 'rejected', coalesce(a.rejected, 0),
           'in_stock', coalesce(a.in_stock, 0), 'stock_cost_cents', coalesce(a.stock_cost_cents, 0),
           'stock_price_cents', coalesce(a.stock_price_cents, 0),
           'revenue_cents', coalesce(a.revenue_cents, 0), 'variable_cents', coalesce(a.variable_cents, 0),
           'profit_cents', coalesce(a.profit_cents, 0), 'sold_cost_cents', coalesce(a.sold_cost_cents, 0),
           'avg_days', a.avg_days, 'timed', coalesce(a.timed, 0),
           'matured', coalesce(a.matured, 0), 'in_time', coalesce(a.in_time, 0)
         ) order by s.name), '[]')
    into r
    from suppliers s
    left join paid p on p.supplier_id = s.id
    left join agg a on a.supplier_id = s.id
   where s.org_id = v_org;
  return jsonb_build_object('days', v_days, 'suppliers', r);
end $$;
revoke all on function public.supplier_stats() from public, anon;
grant execute on function public.supplier_stats() to authenticated;

/** One supplier: its lots, what sells and what does not (brands, categories, sizes), month by month */
create function public.supplier_detail(p_supplier_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_org uuid := public.auth_org_id();
  v_days int;
  r jsonb;
begin
  if v_org is null or not public.is_manager() then
    raise exception using errcode = 'LF403', message = 'Fournisseurs réservés aux responsables.';
  end if;
  select sellthrough_days into v_days from organizations where id = v_org;
  if not exists (select 1 from suppliers where id = p_supplier_id and org_id = v_org) then return null; end if;

  with it as (
    select b.id as batch_id, e.status, e.is_sold, e.cost_cents, e.revenue_cents, e.gross_profit_cents, e.sold_at,
           e.variable_costs_cents + e.vat_cents as variable_cents,
           coalesce(br.name, 'Sans marque') as brand, coalesce(c.name, 'Sans catégorie') as category,
           coalesce(nullif(i.size_label, ''), '—') as size,
           e.status in ('received', 'sorted', 'photographed', 'measured', 'listing_ready', 'listed', 'reserved', 'on_hold', 'returned') as in_stock,
           case when e.is_sold and e.sold_at > e.received_at + interval '1 hour'
                then greatest(extract(epoch from e.sold_at - e.received_at) / 86400, 0.5) end as days,
           e.received_at <= now() - make_interval(days => v_days) as matured,
           coalesce(e.is_sold and e.sold_at <= e.received_at + make_interval(days => v_days), false) as in_time
      from v_item_economics e
      join items i on i.id = e.item_id
      join batches b on b.id = e.batch_id
      left join brands br on br.id = e.brand_id
      left join categories c on c.id = e.category_id
     where e.org_id = v_org and b.supplier_id = p_supplier_id
  ),
  grp as (
    select dim, name, count(*) filter (where is_sold) as sold, count(*) filter (where in_stock) as stock,
           count(*) filter (where status = 'rejected') as rejected,
           coalesce(sum(gross_profit_cents) filter (where is_sold), 0) as profit_cents,
           coalesce(sum(revenue_cents) filter (where is_sold), 0) as revenue_cents,
           round(avg(days)::numeric, 1) as avg_days
      from it, lateral (values ('brand', brand), ('category', category), ('size', size)) d(dim, name)
     group by dim, name
  )
  select jsonb_build_object(
    'days', v_days,
    'batches', coalesce((select jsonb_agg(x order by x->>'purchased_at' desc) from (
        select jsonb_build_object('id', b.id, 'code', b.code, 'kind', b.kind, 'status', b.status, 'purchased_at', b.purchased_at,
          'paid_cents', (select coalesce(sum(amount_cents), 0) from batch_cost_lines where batch_id = b.id)
                      + (select coalesce(sum(amount_cents), 0) from batch_cost_adjustments where batch_id = b.id),
          'items', count(t.batch_id), 'sold', count(*) filter (where t.is_sold), 'rejected', count(*) filter (where t.status = 'rejected'),
          'in_stock', count(*) filter (where t.in_stock),
          'revenue_cents', coalesce(sum(t.revenue_cents) filter (where t.is_sold), 0),
          'variable_cents', coalesce(sum(t.variable_cents) filter (where t.is_sold), 0),
          'profit_cents', coalesce(sum(t.gross_profit_cents) filter (where t.is_sold), 0),
          'matured', count(*) filter (where t.matured and t.status <> 'rejected'), 'in_time', count(*) filter (where t.matured and t.in_time),
          'avg_days', round(avg(t.days)::numeric, 1)) as x
          from batches b left join it t on t.batch_id = b.id
         where b.supplier_id = p_supplier_id and b.org_id = v_org
         group by b.id) q), '[]'),
    'brands', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'sold', sold, 'stock', stock, 'rejected', rejected,
                  'profit_cents', profit_cents, 'revenue_cents', revenue_cents, 'avg_days', avg_days) order by sold desc, stock desc)
                  from (select * from grp where dim = 'brand' order by sold desc, stock desc limit 30) g), '[]'),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'sold', sold, 'stock', stock, 'rejected', rejected,
                  'profit_cents', profit_cents, 'revenue_cents', revenue_cents, 'avg_days', avg_days) order by sold desc, stock desc)
                  from grp where dim = 'category'), '[]'),
    'sizes', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'sold', sold, 'stock', stock, 'rejected', rejected,
                  'profit_cents', profit_cents, 'revenue_cents', revenue_cents, 'avg_days', avg_days) order by sold desc, stock desc)
                  from (select * from grp where dim = 'size' order by sold desc, stock desc limit 20) g), '[]'),
    -- month by month over a year: money paid for its lots, and sales of its items
    'months', (select jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'),
                  'paid_cents', (select coalesce(sum(l.amount_cents), 0) from batch_cost_lines l join batches b on b.id = l.batch_id
                                  where b.supplier_id = p_supplier_id and b.kind = 'purchase' and date_trunc('month', b.purchased_at) = m),
                  'revenue_cents', (select coalesce(sum(revenue_cents), 0) from it
                                     where is_sold and date_trunc('month', sold_at at time zone 'Europe/Paris') = m),
                  'sold', (select count(*) from it where is_sold and date_trunc('month', sold_at at time zone 'Europe/Paris') = m)) order by m)
                 from generate_series(date_trunc('month', now() at time zone 'Europe/Paris') - interval '11 months',
                                      date_trunc('month', now() at time zone 'Europe/Paris'), interval '1 month') m)
  ) into r;
  return r;
end $$;
revoke all on function public.supplier_detail(uuid) from public, anon;
grant execute on function public.supplier_detail(uuid) to authenticated;
