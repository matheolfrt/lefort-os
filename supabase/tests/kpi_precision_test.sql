-- When a lot pays itself back, returns and what they cost, the realised price. Runs on a freshly migrated database.
-- A lot bought 100 €, four items sold one after the other; a return and a goodwill refund push it back under its cost,
-- the returned item is sold again (cheaper) and the lot is paid back for good.
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
create table t.vars(k text primary key, v text);
create function t.put(k text, v text) returns void language sql as $$ insert into t.vars values (k, v) on conflict (k) do update set v = excluded.v $$;
create function t.v(k text) returns uuid language sql as $$ select v::uuid from t.vars where vars.k = $1 $$;
create function t.list(p_sku text) returns uuid language sql security definer as
  $$ update items set status = 'listed', list_price_cents = 3000, listed_at = coalesce(listed_at, now() - interval '60 days') where sku = p_sku returning id $$;
create function t.day(n int) returns timestamptz language sql as $$ select date_trunc('day', now()) - make_interval(days => n) + interval '10 hours' $$;
create function t.pb() returns v_lot_payback language sql as $$ select * from v_lot_payback where code = 'LOT-PB' $$;
grant usage on schema t to authenticated;
grant all on all tables in schema t to authenticated;
grant execute on all functions in schema t to authenticated;

insert into auth.users values ('00000000-0000-0000-0000-0000000000a1', 'admin@example.com'),
                              ('00000000-0000-0000-0000-0000000000b1', 'op@example.com');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select public.bootstrap_organization('Lefort Second Hand', 'Mathéo');
select public.add_member('op@example.com', 'operator');
do $$ declare v_batch uuid; r jsonb; begin
  insert into suppliers(org_id, name) values (public.auth_org_id(), 'Grossiste');
  insert into batches(org_id, code, supplier_id, purchased_at, allocation_method, created_by)
  select org_id, 'LOT-PB', id, (now() - interval '50 days')::date, 'equal', auth.uid() from suppliers limit 1 returning id into v_batch;
  insert into batch_cost_lines(org_id, batch_id, kind, amount_cents) values (public.auth_org_id(), v_batch, 'goods', 9000),
                                                                            (public.auth_org_id(), v_batch, 'transport', 1000);
  r := public.create_batch_skus(v_batch, 'PB-', 1, 4);
  update items set brand_id = (select id from brands where name = 'Hugo Boss'), size_label = case sku when 'PB-3' then '52' else '50' end;
end $$;

-- nothing sold: 100 € to recover
do $$ declare p v_lot_payback := t.pb(); begin
  assert p.cost_cents = 10000 and p.recovered_cents = 0 and p.payback_at is null and p.first_cash_at is null, row_to_json(p)::text;
end $$;

-- A 40 € (packaging 2 €), paid 3 days later; B 50 €; C 30 € (shipping 3 €): 38 + 50 + 27 = 115 € ≥ 100 €
select t.put('oA', public.record_sale(array[t.list('PB-1')], 4000, t.day(40), 'vinted', 'A', null, 0, 0, 0, 200)::text);
select public.ship_order(t.v('oA'), 'MR', '1');
select public.complete_order(t.v('oA'), t.day(37));
select t.put('oB', public.record_sale(array[t.list('PB-2')], 5000, t.day(35), 'vinted', 'B', null, 0, 0, 0, 0)::text);
select public.ship_order(t.v('oB'), 'MR', '2');
select public.complete_order(t.v('oB'), t.day(32));
do $$ declare p v_lot_payback := t.pb(); begin
  assert p.recovered_cents = 8800 and p.payback_at is null and p.first_cash_at = t.day(37) and p.cashed_sales = 2, row_to_json(p)::text;
end $$;
select t.put('oC', public.record_sale(array[t.list('PB-3')], 3000, t.day(30), 'vinted', 'C', null, 0, 0, 300, 0)::text);
select public.ship_order(t.v('oC'), 'MR', '3');
select public.complete_order(t.v('oC'), t.day(28));
do $$ declare p v_lot_payback := t.pb(); begin
  assert p.recovered_cents = 11500, p.recovered_cents::text;
  assert p.payback_at = t.day(28), 'paid back the day the third sale was paid: ' || coalesce(p.payback_at::text, 'null');
end $$;

-- C comes back (wrong size) and B gets a 5 € goodwill refund: 115 − 30 − 5 = 80 €, not paid back any more
select public.record_refund(t.v('oC'), 3000, 'Taille trop petite', array[(select id from items where sku = 'PB-3')], t.day(20));
select public.record_refund(t.v('oB'), 500, 'Geste commercial', '{}', t.day(19));
do $$ declare p v_lot_payback := t.pb(); begin
  assert p.recovered_cents = 8000 and p.payback_at is null, row_to_json(p)::text;
end $$;

-- D sold, not paid yet: money on its way, not recovered
select t.put('oD', public.record_sale(array[t.list('PB-4')], 2500, t.day(5), 'vinted', 'D', null, 0, 0, 0, 0)::text);
do $$ declare p v_lot_payback := t.pb(); begin
  assert p.pending_cents = 2500 and p.recovered_cents = 8000 and p.payback_at is null, row_to_json(p)::text;
end $$;

-- C sold again, 20 € this time, paid: 80 + 20 = 100 € → paid back for good, on that day
reset role;
update items set status = 'listed' where sku = 'PB-3';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select t.put('oC2', public.record_sale(array[(select id from items where sku = 'PB-3')], 2000, t.day(10), 'vinted', 'C2', null, 0, 0, 0, 0)::text);
select public.ship_order(t.v('oC2'), 'MR', '4');
select public.complete_order(t.v('oC2'), t.day(8));
do $$ declare p v_lot_payback := t.pb(); begin
  assert p.recovered_cents = 10000 and p.payback_at = t.day(8), row_to_json(p)::text;
  assert p.last_cash_at = t.day(8) and p.cashed_sales = 4, row_to_json(p)::text;
end $$;

-- a cancelled sale brings no money
do $$ declare v uuid; begin
  perform public.void_order(t.v('oD'), 'Erreur de saisie');
  assert (t.pb()).pending_cents = 0, 'a cancelled sale is not on its way';
end $$;

-- ── returns over the period: 5 sales (A, B, C, D cancelled → not counted, C2), 1 returned
do $$ declare r jsonb := public.return_stats(); begin
  assert (r->>'sold')::int = 4 and (r->>'returned')::int = 1, r::text;
  assert (r->>'refunded_cents')::int = 3000, r::text;
  assert (r->>'lost_fees_cents')::int = 300, 'the shipping of the returned sale is lost: ' || r::text;
  assert (r->>'resold')::int = 1 and (r->>'resale_loss_cents')::int = 1000, 'sold again 10 € cheaper: ' || r::text;
  assert (r->>'goodwill_cents')::int = 500 and (r->>'goodwill_n')::int = 1, r::text;
  assert r->'by_size' = '[{"label": "52", "sold": 2, "returned": 1}]'::jsonb, r->>'by_size';
  assert r->'by_brand' = '[{"label": "Hugo Boss", "sold": 4, "returned": 1}]'::jsonb, r->>'by_brand';
  assert r->'by_reason' = '[{"label": "Taille trop petite", "n": 1}]'::jsonb, r->>'by_reason';
end $$;
-- a period without the returned sale
do $$ declare r jsonb := public.return_stats((now() - interval '12 days')::date); begin
  assert (r->>'sold')::int = 1 and (r->>'returned')::int = 0 and (r->>'lost_fees_cents')::int = 0, r::text;
end $$;

-- ── realised price: kept sales (A 40, B 50, C2 20) against 30 € shown each → 110 / 90
do $$ declare r jsonb := public.realised_price(); begin
  assert (r->>'n')::int = 3 and (r->>'paid_cents')::int = 11000 and (r->>'shown_cents')::int = 9000, r::text;
  assert (r->>'ratio')::numeric = 1.2222, r::text;
end $$;
do $$ declare r jsonb := public.realised_price(9); begin
  assert (r->>'n')::int = 0 and r->'ratio' = 'null'::jsonb, r::text;
end $$;

-- ── money is for managers
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select t.expect_error($$select public.return_stats()$$, 'non autorisée');
select t.expect_error($$select public.realised_price()$$, 'non autorisée');
do $$ begin
  assert not exists (select 1 from v_lot_cash_events), 'operators see no money movement';
  assert (select recovered_cents = 0 and cost_cents = 0 from v_lot_payback where code = 'LOT-PB'), 'nor costs';
end $$;

reset role;
select 'kpi precision tests passed';
