-- Lefort OS — sharper figures for buying and selling decisions (managers only: they are money):
--   · when a lot has paid itself back: the money that came in for its items, net of fees, against what it cost;
--   · returns: how many sales come back, what they cost, by brand, size and reason;
--   · the realised price: what buyers really pay against the price shown.
-- Everything is derived from existing tables; nothing new is stored.

-- ── Money in, lot by lot ──────────────────────────────────────────────────────────────────────────────────────────
-- One row per movement of money for a lot:
--   sale    a sold item at the date the money came in (paid_at; for a completed or historical sale without that
--           date, its sale date), net of its share of the order's fees, shipping, packaging and VAT;
--   pending a sale not paid yet (at is null): money on its way, not counted as recovered;
--   refund  money given back, at its date (a refund of a whole order is shared between its items by price).
create view v_lot_cash_events with (security_invoker = true) as
with lines as (
  select ol.id as line_id, ol.org_id, ol.order_id, i.batch_id, ol.sale_price_cents,
         o.gross_cents, o.platform_fee_cents + o.promotion_fee_cents + o.shipping_cost_cents + o.packaging_cost_cents + o.tax_cents as costs_cents,
         coalesce(o.paid_at, case when o.is_historical or o.status = 'completed' then o.sold_at end) as cashed_at,
         sum(ol.sale_price_cents) over (partition by ol.order_id) as order_lines_cents
    from order_lines ol
    join orders o on o.id = ol.order_id and o.status <> 'cancelled'
    join items i on i.id = ol.item_id
   where ol.status <> 'cancelled'
)
select l.org_id, l.batch_id, l.cashed_at as at,
       (l.sale_price_cents - case when l.gross_cents > 0
          then round(l.costs_cents * l.sale_price_cents::numeric / l.gross_cents) else 0 end)::bigint as cents,
       case when l.cashed_at is null then 'pending' else 'sale' end as kind
  from lines l
union all
-- a refund of one item belongs to that item's lot
select l.org_id, l.batch_id, r.refunded_at, -r.amount_cents, 'refund'
  from refunds r join lines l on l.line_id = r.order_line_id
union all
-- a refund of the whole order is shared between its items, by price
select l.org_id, l.batch_id, r.refunded_at,
       -round(r.amount_cents * l.sale_price_cents::numeric / nullif(l.order_lines_cents, 0))::bigint, 'refund'
  from refunds r join lines l on l.order_id = r.order_id
 where r.order_line_id is null;
grant select on v_lot_cash_events to authenticated;

-- ── When each lot paid itself back ────────────────────────────────────────────────────────────────────────────────
-- cost_cents       what the lot cost (purchase lines and adjustments), the money to recover
-- recovered_cents  net money in so far (refunds deducted); pending_cents: sold, not paid yet
-- payback_at       the day the money in reached the cost and stayed there (a refund that brings it back under the
--                  cost cancels it: the lot is not paid back any more, until the next crossing)
create view v_lot_payback with (security_invoker = true) as
with cost as (
  select b.id as batch_id, b.org_id, b.code, b.purchased_at, b.listing_started_at,
         (select coalesce(sum(amount_cents), 0) from batch_cost_lines where batch_id = b.id)
         + (select coalesce(sum(amount_cents), 0) from batch_cost_adjustments where batch_id = b.id) as cost_cents
    from batches b
),
ev as (
  select batch_id, at, sum(cents) as cents, count(*) filter (where kind = 'sale') as sales
    from v_lot_cash_events where at is not null group by batch_id, at
),
cum as (
  select e.batch_id, e.at, e.sales, sum(e.cents) over (partition by e.batch_id order by e.at) as cum, c.cost_cents
    from ev e join cost c using (batch_id)
),
last_below as (
  select batch_id, max(at) filter (where cum < cost_cents) as at from cum group by batch_id
)
select c.batch_id, c.org_id, c.code, c.purchased_at, c.listing_started_at, c.cost_cents,
       coalesce((select sum(cents) from ev where ev.batch_id = c.batch_id), 0)::bigint as recovered_cents,
       coalesce((select sum(cents) from v_lot_cash_events p where p.batch_id = c.batch_id and p.kind = 'pending'), 0)::bigint as pending_cents,
       coalesce((select sum(sales) from ev where ev.batch_id = c.batch_id), 0)::int as cashed_sales,
       (select min(at) from ev where ev.batch_id = c.batch_id) as first_cash_at,
       (select max(at) from ev where ev.batch_id = c.batch_id) as last_cash_at,
       case when c.cost_cents > 0 then
         (select min(cm.at) from cum cm where cm.batch_id = c.batch_id and cm.cum >= c.cost_cents
             and (lb.at is null or cm.at > lb.at))
       end as payback_at
  from cost c
  left join last_below lb using (batch_id);
grant select on v_lot_payback to authenticated;

-- ── Returns ───────────────────────────────────────────────────────────────────────────────────────────────────────
-- Over the sales of a period (by sale date): how many came back and what they cost.
--   lost_fees_cents    fees, shipping and packaging of the returned sales: paid, never recovered
--   resale_loss_cents  for returned items sold again, how much cheaper they went the second time
--   goodwill_cents     refunds without a return (« geste commercial »): money given away
-- The return postage paid by the seller, when there is one, is not recorded in Lefort OS: it is not counted.
create function public.return_stats(p_from date default (now() at time zone 'Europe/Paris')::date - 365,
                                    p_to date default (now() at time zone 'Europe/Paris')::date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := private.require_role('manager'); r jsonb;
begin
  with l as (
    select ol.id, ol.item_id, ol.status, ol.sale_price_cents, o.sold_at, i.size_label, br.name as brand,
           case when o.gross_cents > 0 then round((o.platform_fee_cents + o.promotion_fee_cents + o.shipping_cost_cents + o.packaging_cost_cents)
                                                  * ol.sale_price_cents::numeric / o.gross_cents) else 0 end as fees_cents
      from order_lines ol
      join orders o on o.id = ol.order_id and o.status <> 'cancelled'
      join items i on i.id = ol.item_id
      left join brands br on br.id = i.brand_id
     where ol.org_id = v_org and ol.status <> 'cancelled'
       and (o.sold_at at time zone 'Europe/Paris')::date between p_from and p_to
  ),
  ret as (
    select l.*,
           -- the next sale of the same item after it came back
           (select ol2.sale_price_cents from order_lines ol2 join orders o2 on o2.id = ol2.order_id and o2.status <> 'cancelled'
             where ol2.item_id = l.item_id and ol2.status <> 'cancelled' and o2.sold_at > l.sold_at
             order by o2.sold_at limit 1) as resold_cents,
           (select string_agg(distinct rf.reason, ' · ') from refunds rf where rf.order_line_id = l.id and rf.item_returned) as reason
      from l where l.status = 'returned'
  ),
  goodwill as (
    select coalesce(sum(rf.amount_cents), 0) as cents, count(*) as n
      from refunds rf join orders o on o.id = rf.order_id and o.status <> 'cancelled'
     where rf.org_id = v_org and not rf.item_returned
       and (o.sold_at at time zone 'Europe/Paris')::date between p_from and p_to
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'sold', (select count(*) from l),
    'returned', (select count(*) from ret),
    'refunded_cents', coalesce((select sum(rf.amount_cents) from refunds rf join ret on rf.order_line_id = ret.id where rf.item_returned), 0),
    'lost_fees_cents', coalesce((select sum(fees_cents) from ret), 0),
    'resold', (select count(*) from ret where resold_cents is not null),
    'resale_loss_cents', coalesce((select sum(greatest(sale_price_cents - resold_cents, 0)) from ret where resold_cents is not null), 0),
    'goodwill_cents', (select cents from goodwill), 'goodwill_n', (select n from goodwill),
    'by_brand', coalesce((select jsonb_agg(x order by x.returned desc, x.sold desc) from (
        select coalesce(brand, 'Sans marque') as label, count(*) as sold, count(*) filter (where status = 'returned') as returned
          from l group by 1 having count(*) filter (where status = 'returned') > 0) x), '[]'),
    'by_size', coalesce((select jsonb_agg(x order by x.returned desc, x.sold desc) from (
        select coalesce(nullif(trim(size_label), ''), 'Sans taille') as label, count(*) as sold, count(*) filter (where status = 'returned') as returned
          from l group by 1 having count(*) filter (where status = 'returned') > 0) x), '[]'),
    'by_reason', coalesce((select jsonb_agg(x order by x.n desc) from (
        select coalesce(reason, 'Sans motif') as label, count(*) as n from ret group by 1) x), '[]')
  ) into r;
  return r;
end $$;
revoke all on function public.return_stats(date, date) from public, anon;
grant execute on function public.return_stats(date, date) to authenticated;

-- ── Realised price ────────────────────────────────────────────────────────────────────────────────────────────────
-- What buyers paid against the price shown, over the sales of the last days (sales kept: not cancelled, not
-- returned; items with a price shown). ratio = paid / shown, the factor that turns a shown price into a probable one.
create function public.realised_price(p_days int default 90) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := private.require_role('manager'); r jsonb;
begin
  select jsonb_build_object(
    'days', p_days,
    'n', count(*),
    'paid_cents', coalesce(sum(ol.sale_price_cents), 0),
    'shown_cents', coalesce(sum(i.list_price_cents), 0),
    'ratio', case when sum(i.list_price_cents) > 0 then round(sum(ol.sale_price_cents)::numeric / sum(i.list_price_cents), 4) end)
    into r
    from order_lines ol
    join orders o on o.id = ol.order_id and o.status <> 'cancelled'
    join items i on i.id = ol.item_id
   where ol.org_id = v_org and ol.status = 'active'
     and i.list_price_cents is not null and o.sold_at >= now() - make_interval(days => p_days);
  return r;
end $$;
revoke all on function public.realised_price(int) from public, anon;
grant execute on function public.realised_price(int) to authenticated;
