-- Lefort OS — price markdown suggestions ("Prix à baisser"). Rules by time online (by default −10 % after 14 days,
-- −20 % after 30, −30 % after 45, from the price the item was put online at), never under the minimum price nor under
-- cost + Vinted fees + shipping + 1 €, and not again within a few days of the last markdown. Nothing is changed
-- automatically: the manager applies a suggestion or puts it aside. Managers only: it shows costs and margins.

alter table organizations
  add column price_steps jsonb not null default '[{"days": 14, "pct": 10}, {"days": 30, "pct": 20}, {"days": 45, "pct": 30}]',
  add column price_wait_days int not null default 7 check (price_wait_days between 0 and 60);
grant update (price_steps, price_wait_days) on organizations to authenticated;

-- "Not now": a suggestion put aside until a date
create table price_skips (
  item_id uuid primary key references items(id) on delete cascade,
  org_id uuid not null default public.auth_org_id() references organizations(id),
  until date not null,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
alter table price_skips enable row level security;
grant select, insert, update, delete on price_skips to authenticated;
create policy price_skips_mgr on price_skips for all to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_manager()))
  with check (org_id = (select public.auth_org_id()) and (select public.is_manager()));

create function public.price_suggestions() returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_org uuid := public.auth_org_id();
  v_steps jsonb; v_wait int; v_fee_pct numeric; v_fee_fixed bigint; v_ship numeric;
  v_today date := (now() at time zone 'Europe/Paris')::date;
  r jsonb;
begin
  if v_org is null or not public.is_manager() then
    raise exception using errcode = 'LF403', message = 'Prix réservés aux responsables.';
  end if;
  select price_steps, price_wait_days, vinted_fee_pct, vinted_fee_fixed_cents into v_steps, v_wait, v_fee_pct, v_fee_fixed
    from organizations where id = v_org;
  -- average shipping + packaging paid per sold item (last 180 days), as in Conseils
  select coalesce(sum(o.shipping_cost_cents + o.packaging_cost_cents)::numeric / nullif(count(ol.id), 0), 0) into v_ship
    from orders o join order_lines ol on ol.order_id = o.id and ol.status = 'active'
   where o.org_id = v_org and o.status <> 'cancelled' and o.sold_at >= now() - interval '180 days';

  with steps as (
    select (s->>'days')::int as days, (s->>'pct')::numeric as pct from jsonb_array_elements(v_steps) s
  ),
  live as (
    select i.id, i.sku, i.title, i.size_label, i.list_price_cents as price, i.min_price_cents as min_price,
           coalesce(i.listed_at, i.status_changed_at) as online_since, b.name as brand, c.name as category, e.cost_cents as cost,
           (select l.url from listings l where l.item_id = i.id and l.status = 'active' and l.url is not null order by l.listed_at desc limit 1) as url
      from items i
      join v_item_economics e on e.item_id = i.id
      left join brands b on b.id = i.brand_id
      left join categories c on c.id = i.category_id
     where i.org_id = v_org and i.deleted_at is null and i.status = 'listed' and i.list_price_cents is not null
  ),
  hist as (
    -- the price it went online at: the highest asking price since then; and the last markdown
    select l.*,
           greatest(l.price, coalesce((select max(greatest(coalesce(pc.old_cents, 0), coalesce(pc.new_cents, 0))) from price_changes pc
                                        where pc.item_id = l.id and pc.field = 'list_price' and pc.changed_at >= l.online_since), 0)) as start_price,
           (select max(pc.changed_at) from price_changes pc
             where pc.item_id = l.id and pc.field = 'list_price' and pc.changed_at >= l.online_since and pc.new_cents < pc.old_cents) as last_markdown,
           floor(extract(epoch from now() - l.online_since) / 86400)::int as days_online
      from live l
  ),
  calc as (
    select h.*,
           (select s.days from steps s where s.days <= h.days_online order by s.days desc limit 1) as step_days,
           (select s.pct from steps s where s.days <= h.days_online order by s.days desc limit 1) as step_pct,
           (select min(s.days) from steps s where s.days > h.days_online) as next_days,
           -- never under cost + fees + shipping + 1 € (rounded up to the euro), nor under the minimum price
           ceil((h.cost + v_fee_fixed + v_ship + 100) / (1 - v_fee_pct / 100) / 100) * 100 as floor_cost
      from hist h
  ),
  base as (
    select c.*, round(c.start_price * (1 - c.step_pct / 100) / 100) * 100 as target,
           greatest(c.floor_cost, coalesce(c.min_price, 0)) as floor_price
      from calc c where c.step_pct is not null
  ),
  sugg as (
    select b.*, greatest(b.target, b.floor_price) as suggested,
           -- what stops the price going down to the rule's target
           case when b.target >= b.floor_price then null
                when coalesce(b.min_price, 0) >= b.floor_cost then 'min_price' else 'cost' end as held_by,
           -- a recent markdown still in effect gives it time to work (one cancelled with « Annuler » does not count)
           b.last_markdown is not null and b.last_markdown > now() - make_interval(days => v_wait) and b.price < b.start_price as waiting,
           exists (select 1 from price_skips k where k.item_id = b.id and k.until >= v_today) as skipped
      from base b
  ),
  todo as (
    select * from sugg where suggested <= price - 100 and not waiting and not skipped
  ),
  -- what markdowns did: sold within 14 days after the markdown, by size of the cut (last 180 days)
  cuts as (
    select pc.item_id, pc.changed_at, (pc.old_cents - pc.new_cents) * 100.0 / pc.old_cents as cut,
           exists (select 1 from items i where i.id = pc.item_id and i.sold_at between pc.changed_at and pc.changed_at + interval '14 days') as sold14
      from price_changes pc
     where pc.org_id = v_org and pc.field = 'list_price' and pc.old_cents > 0 and pc.new_cents < pc.old_cents
       and pc.changed_at >= now() - interval '180 days' and pc.changed_at <= now() - interval '14 days'
  )
  select jsonb_build_object(
    'steps', v_steps, 'wait_days', v_wait,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'sku', sku, 'title', title, 'brand', brand, 'category', category, 'size', size_label, 'url', url,
        'price', price, 'start_price', start_price, 'suggested', suggested, 'min_price', min_price, 'cost', cost,
        'days_online', days_online, 'step_days', step_days, 'step_pct', step_pct, 'held_by', held_by,
        'margin', round(suggested * (1 - v_fee_pct / 100) - v_fee_fixed - v_ship - cost)) order by days_online desc, sku)
      from todo), '[]'),
    -- held at the floor: the price cannot go lower without selling at a loss or under the minimum
    'at_floor', (select count(*) from sugg where suggested > price - 100 and held_by is not null and not skipped),
    'waiting', (select count(*) from sugg where waiting and suggested <= price - 100),
    'skipped', (select count(*) from sugg where skipped),
    'soon', (select count(*) from calc where next_days is not null and next_days - days_online <= 7) ,
    'listed', (select count(*) from live),
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
revoke all on function public.price_suggestions() from public, anon;
grant execute on function public.price_suggestions() to authenticated;
