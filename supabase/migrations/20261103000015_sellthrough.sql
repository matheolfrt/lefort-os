-- Lefort OS — sell-through ("écoulement") : the share of items sold within N days of being received (default 80 % in 30 days).
-- The clock of an item starts when it is received; only batches that were really bought count (opening stock and
-- historical imports have artificial dates). Managers only: it carries costs and margins.

alter table organizations
  add column sellthrough_target_pct int not null default 80 check (sellthrough_target_pct between 1 and 100),
  add column sellthrough_days int not null default 30 check (sellthrough_days between 7 and 120);
grant update (sellthrough_target_pct, sellthrough_days) on organizations to authenticated;

create function public.sellthrough_stats() returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_org uuid := public.auth_org_id();
  v_days int; v_target int; r jsonb;
begin
  if v_org is null or not public.is_manager() then
    raise exception using errcode = 'LF403', message = 'Écoulement réservé aux responsables.';
  end if;
  select sellthrough_days, sellthrough_target_pct into v_days, v_target from organizations where id = v_org;

  with it as (
    select e.item_id, e.batch_id, bt.supplier_id, e.brand_id, e.category_id, e.status, e.received_at,
           e.is_sold, e.cost_cents, e.revenue_cents, e.gross_profit_cents,
           extract(epoch from now() - e.received_at) / 86400 as age_days,
           coalesce(e.is_sold and e.sold_at <= e.received_at + make_interval(days => v_days), false) as in_time,
           (not e.is_sold and e.status in ('received', 'sorted', 'photographed', 'measured', 'listing_ready', 'on_hold', 'returned')) as offline
      from v_item_economics e
      join batches bt on bt.id = e.batch_id
     where e.org_id = v_org and bt.kind = 'purchase' and e.status <> 'rejected'
  ),
  -- items whose whole window has elapsed: their result is final
  done as (select * from it where age_days >= v_days),
  bat as (
    select b.id, b.code, sp.name as supplier, b.purchased_at,
           count(*) as items,
           count(*) filter (where i.is_sold) as sold_total,
           count(*) filter (where i.in_time) as sold_in_time,
           count(*) filter (where i.offline) as not_online,
           min(i.received_at) as first_received, max(i.received_at) as last_received,
           coalesce(sum(i.cost_cents), 0) as cost, coalesce(sum(i.revenue_cents) filter (where i.is_sold), 0) as revenue,
           coalesce(sum(i.gross_profit_cents) filter (where i.is_sold), 0) as profit
      from it i
      join batches b on b.id = i.batch_id
      join suppliers sp on sp.id = b.supplier_id
     group by b.id, sp.name
  )
  select jsonb_build_object(
    'days', v_days, 'target_pct', v_target,
    -- recent finished results: items received in the last 6 months whose window has elapsed
    'overall', (select jsonb_build_object('items', count(*), 'sold', count(*) filter (where in_time),
                       'pct', case when count(*) > 0 then round(count(*) filter (where in_time) * 100.0 / count(*), 1) end)
                  from done where received_at >= now() - interval '180 days'),
    'batches', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', id, 'code', code, 'supplier', supplier, 'purchased_at', purchased_at, 'items', items,
                  'sold_total', sold_total, 'sold_in_time', sold_in_time, 'not_online', not_online,
                  'first_received', first_received, 'last_received', last_received,
                  'age_days', round((extract(epoch from now() - first_received) / 86400)::numeric, 1),
                  'matured', last_received + make_interval(days => v_days) <= now(),
                  'cost_cents', cost, 'revenue_cents', revenue, 'profit_cents', profit) order by first_received desc)
                  from (select * from bat order by first_received desc limit 150) b150), '[]'),
    'suppliers', coalesce((select jsonb_agg(jsonb_build_object('name', sp.name, 'items', d.n, 'sold', d.s,
                    'pct', round(d.s * 100.0 / d.n, 1)) order by d.s * 1.0 / d.n desc)
                  from (select supplier_id, count(*) n, count(*) filter (where in_time) s from done group by supplier_id) d
                  join suppliers sp on sp.id = d.supplier_id), '[]'),
    'brands', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(br.name, 'Sans marque'), 'items', d.n, 'sold', d.s,
                    'pct', round(d.s * 100.0 / d.n, 1)) order by d.n desc)
                  from (select brand_id, count(*) n, count(*) filter (where in_time) s from done group by brand_id having count(*) >= 3) d
                  left join brands br on br.id = d.brand_id), '[]'),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(c.name, 'Sans catégorie'), 'items', d.n, 'sold', d.s,
                    'pct', round(d.s * 100.0 / d.n, 1)) order by d.n desc)
                  from (select category_id, count(*) n, count(*) filter (where in_time) s from done group by category_id having count(*) >= 3) d
                  left join categories c on c.id = d.category_id), '[]'),
    'months', coalesce((select jsonb_agg(jsonb_build_object('month', m, 'items', n, 'sold', s, 'pct', round(s * 100.0 / n, 1)) order by m)
                  from (select date_trunc('month', received_at)::date as m, count(*) n, count(*) filter (where in_time) s
                          from done where received_at >= now() - interval '12 months' group by 1) mm), '[]')
  ) into r;
  return r;
end $$;

revoke all on function public.sellthrough_stats() from public, anon;
grant execute on function public.sellthrough_stats() to authenticated;
