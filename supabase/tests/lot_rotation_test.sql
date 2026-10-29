-- Rotation of a lot: the dates the three KPI come from, and the official start of the listing.
-- The required case: 300 blazers, 10 listed a day for 30 days, each sold 10 or 30 days after its own listing (20 days on
-- average), the last sale 30 days after the last listing. The brief's 1 Nov → 30 Nov → 30 Dec is moved to the same days
-- of June/July (a start in the future is refused): 1 June → 30 June → 30 July. Runs on a freshly migrated database.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create schema t;
create function t.expect_error(sql text, fragment text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'Expected error containing "%" but statement succeeded: %', fragment, sql;
exception when others then
  if position(fragment in sqlerrm) = 0 then raise exception 'Expected error containing "%", got "%"', fragment, sqlerrm; end if;
end $$;
create function t.lot() returns v_lot_rotation language sql as $$ select * from v_lot_rotation where code = 'LOT-BLAZERS' $$;
grant usage on schema t to authenticated;
grant execute on all functions in schema t to authenticated;

insert into auth.users values ('00000000-0000-0000-0000-0000000000a1', 'admin@example.com'),
                              ('00000000-0000-0000-0000-0000000000b1', 'op@example.com');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select public.bootstrap_organization('Lefort Second Hand', 'Mathéo');
select public.add_member('op@example.com', 'operator');
do $$ declare v_batch uuid; r jsonb; begin
  insert into suppliers(org_id, name) values (public.auth_org_id(), 'Grossiste blazers');
  insert into batches(org_id, code, supplier_id, purchased_at, allocation_method, created_by)
  select org_id, 'LOT-BLAZERS', id, date '2026-05-25', 'equal', auth.uid() from suppliers limit 1 returning id into v_batch;
  r := public.create_batch_skus(v_batch, 'BLZ', 1, 300);
end $$;

-- before anything: 300 items, nothing listed, no start
do $$ declare l v_lot_rotation := t.lot(); begin
  assert l.total = 300 and l.listed = 0 and l.sold = 0 and l.listing_started_at is null, row_to_json(l)::text;
  assert l.avg_days_to_sell is null and l.last_sold_at is null;
end $$;

-- 🚀 the first item goes online on 1 June at 10:00 (chosen date: the lot existed before the button)
select public.set_listing_started((select batch_id from v_lot_rotation where code = 'LOT-BLAZERS'), timestamptz '2026-06-01 10:00+02');
do $$ begin assert (t.lot()).listing_started_edited_at is null, 'a date chosen the first time is not an edit'; end $$;
select t.expect_error($$select public.set_listing_started((select batch_id from v_lot_rotation where code = 'LOT-BLAZERS'))$$, 'déjà commencé');
select t.expect_error($$select public.set_listing_started((select batch_id from v_lot_rotation where code = 'LOT-BLAZERS'), now() + interval '2 days', true)$$, 'futur');
select t.expect_error($$update batches set listing_started_at = now() where code = 'LOT-BLAZERS'$$, 'permission denied');

-- 10 items a day for 30 days, each sold 10 or 30 days after its own listing (20 on average); the history is written
-- as the owner, the way the stations would have done it day after day
reset role;
update items i set status = 'completed',
       listed_at = timestamptz '2026-06-01 10:00+02' + make_interval(days => ((n.k - 1) / 10)::int),
       sold_at = timestamptz '2026-06-01 10:00+02' + make_interval(days => ((n.k - 1) / 10 + case when n.k % 2 = 0 then 30 else 10 end)::int)
  from (select id, row_number() over (order by length(sku), sku) as k from items) n where n.id = i.id;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
do $$ declare l v_lot_rotation := t.lot(); begin
  assert l.listed = 300 and l.sold = 300 and l.rejected = 0, row_to_json(l)::text;
  assert l.first_listed_at = timestamptz '2026-06-01 10:00+02' and l.last_listed_at = timestamptz '2026-06-30 10:00+02';
  -- KPI 1 — listing time: 1 → 30 June
  assert extract(day from l.last_listed_at - l.listing_started_at) = 29, (l.last_listed_at - l.listing_started_at)::text;
  -- KPI 2 — average time to sell, each item from its own listing date
  assert l.avg_days_to_sell = 20.00 and l.timed = 300, l.avg_days_to_sell::text;
  -- KPI 3 — liquidation from the FIRST listing to the last sale (30 July), not from the last listing
  assert l.last_sold_at = timestamptz '2026-07-30 10:00+02', l.last_sold_at::text;
  assert extract(day from l.last_sold_at - l.listing_started_at) = 59, (l.last_sold_at - l.listing_started_at)::text;
  assert extract(day from l.last_sold_at - l.last_listed_at) = 30, 'from the last listing it would only be 30';
end $$;

-- a cancelled sale is not a sale; a written-off item is not waited for; a deleted item is not in the lot
reset role;
update items set status = 'listed', sold_at = null where sku = 'BLZ300';          -- its sale was cancelled
update items set status = 'rejected' where sku = 'BLZ299';                        -- stained: written off
update items set deleted_at = now() where sku = 'BLZ298';                         -- typed by mistake
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
do $$ declare l v_lot_rotation := t.lot(); begin
  assert l.total = 299 and l.rejected = 1 and l.sold = 297 and l.listed = 298, row_to_json(l)::text;
end $$;

-- a returned item is not sold any more
reset role;
update items set status = 'returned' where sku = 'BLZ297';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
do $$ begin assert (t.lot()).sold = 296; end $$;

-- the start date: an operator clicks the button of a new lot, but only a manager may change it
do $$ declare v_batch uuid; begin
  insert into batches(org_id, code, supplier_id, purchased_at, allocation_method, created_by)
  select org_id, 'LOT-NEUF', id, current_date, 'equal', auth.uid() from suppliers limit 1 returning id into v_batch;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
do $$ declare v timestamptz; begin
  v := public.set_listing_started((select id from batches where code = 'LOT-NEUF'));
  assert abs(extract(epoch from v - now())) < 5, 'the click records now';
  assert (select listing_started_edited_at is null and listing_started_by = auth.uid() from batches where code = 'LOT-NEUF');
  assert (select listing_started_at from v_lot_rotation where code = 'LOT-NEUF') = v, 'operators read the lot rotation';
end $$;
select t.expect_error($$select public.set_listing_started((select id from batches where code = 'LOT-NEUF'), now() - interval '1 day', true)$$, 'non autorisée');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
do $$ begin
  perform public.set_listing_started((select id from batches where code = 'LOT-NEUF'), now() - interval '1 day', true);
  assert (select listing_started_edited_at is not null and listing_started_at < now() - interval '23 hours' from batches where code = 'LOT-NEUF');
end $$;

-- the listing date of an item is kept when it is listed again (the KPI measures from its own first listing)
reset role;
update items set status = 'listing_ready' where sku = 'BLZ300';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
do $$ declare v_first timestamptz; begin
  select listed_at into v_first from items where sku = 'BLZ300';
  perform public.bulk_put_on_sale(array[(select id from items where sku = 'BLZ300')]);
  assert (select status = 'listed' and listed_at = v_first from items where sku = 'BLZ300'), 'listed again, first date kept';
end $$;

reset role;
select 'lot rotation tests passed';
