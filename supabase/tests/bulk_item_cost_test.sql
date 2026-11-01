-- Purchase price of several items from the Stock: the chosen items change, the other items of their lots keep their
-- price, each lot's cost moves by the difference (an adjustment), sales follow except in a closed lot.
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
create function t.cost(p_sku text) returns bigint language sql security definer as
  $$ select ic.allocated_cost_cents from item_costs ic join items i on i.id = ic.item_id where i.sku = p_sku $$;
create function t.lot(p_code text) returns bigint language sql security definer as
  $$ select coalesce((select sum(amount_cents) from batch_cost_lines l join batches b on b.id = l.batch_id where b.code = p_code), 0)
          + coalesce((select sum(amount_cents) from batch_cost_adjustments a join batches b on b.id = a.batch_id where b.code = p_code), 0) $$;
create function t.ids(variadic p text[]) returns jsonb language sql security definer as
  $$ select jsonb_agg(id) from items where sku = any(p) $$;
grant usage on schema t to authenticated;
grant execute on all functions in schema t to authenticated;

insert into auth.users values ('00000000-0000-0000-0000-0000000000a1', 'admin@example.com'),
                              ('00000000-0000-0000-0000-0000000000b1', 'op@example.com');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select public.bootstrap_organization('Lefort Second Hand', 'Mathéo');
select public.add_member('op@example.com', 'operator');
-- lot A (open): 80 € for 4 items → 20 € each; lot B (closed): 30 € for 3 items → 10 € each
do $$ declare v_a uuid; v_b uuid; r jsonb; begin
  insert into suppliers(org_id, name) values (public.auth_org_id(), 'Grossiste');
  insert into batches(org_id, code, supplier_id, purchased_at, allocation_method, created_by)
  select org_id, 'LOT-A', id, current_date, 'equal', auth.uid() from suppliers limit 1 returning id into v_a;
  insert into batch_cost_lines(org_id, batch_id, kind, amount_cents) values (public.auth_org_id(), v_a, 'goods', 8000);
  r := public.create_batch_skus(v_a, 'A-', 1, 4);
  insert into batches(org_id, code, supplier_id, purchased_at, allocation_method, created_by)
  select org_id, 'LOT-B', id, current_date, 'equal', auth.uid() from suppliers limit 1 returning id into v_b;
  insert into batch_cost_lines(org_id, batch_id, kind, amount_cents) values (public.auth_org_id(), v_b, 'goods', 3000);
  r := public.create_batch_skus(v_b, 'B-', 1, 3);
end $$;
do $$ begin assert t.cost('A-1') = 2000 and t.cost('B-1') = 1000, 'starting costs'; end $$;

-- A-1 and A-2 at 5 €: A-3 and A-4 keep 20 €, lot A now costs 50 €
do $$ declare r jsonb := public.bulk_set_item_cost((select jsonb_agg(jsonb_build_object('id', x, 'cost_cents', 500)) from jsonb_array_elements_text(t.ids('A-1', 'A-2')) x)); begin
  assert (r->>'updated')::int = 2 and jsonb_array_length(r->'errors') = 0, r::text;
  assert t.cost('A-1') = 500 and t.cost('A-2') = 500, 'chosen items changed';
  assert t.cost('A-3') = 2000 and t.cost('A-4') = 2000, 'the others keep their price';
  assert t.lot('LOT-A') = 5000, 'lot cost moved by the difference';
end $$;
-- a later change of the lot's lines is shared by the items not set by hand only
reset role;
insert into batch_cost_lines(org_id, batch_id, kind, amount_cents) select org_id, id, 'transport', 400 from batches where code = 'LOT-A';
set role authenticated;
do $$ begin assert t.cost('A-1') = 500 and t.cost('A-3') = 2200, 'transport shared by the others'; end $$;

-- lot B closed, then B-1 sold, B-2 set to 25 €: allowed (not sold), B-1 refused (its sale cost is frozen)
select public.close_batch((select id from batches where code = 'LOT-B'));
reset role;
update items set status = 'listed', list_price_cents = 4000 where sku = 'B-1';
set role authenticated;
select public.record_sale(array[(select id from items where sku = 'B-1')], 4000);
do $$ declare r jsonb := public.bulk_set_item_cost((select jsonb_agg(jsonb_build_object('id', x, 'cost_cents', 2500)) from jsonb_array_elements_text(t.ids('B-1', 'B-2')) x)); begin
  assert (r->>'updated')::int = 1 and r->'errors'->0->>'sku' = 'B-1' and r->'errors'->0->>'error' like '%figé%', r::text;
  assert t.cost('B-2') = 2500 and t.cost('B-3') = 1000 and t.cost('B-1') = 1000, 'closed lot: only B-2';
  assert t.lot('LOT-B') = 4500, 'closed lot cost moved by an adjustment';
  assert (select reason from batch_cost_adjustments a join batches b on b.id = a.batch_id where b.code = 'LOT-B') like 'Prix d''achat modifié depuis le stock (1 article)';
end $$;

-- a sold item of an open lot: its sale follows
reset role;
update items set status = 'listed', list_price_cents = 4000 where sku = 'A-4';
set role authenticated;
select public.record_sale(array[(select id from items where sku = 'A-4')], 4000);
select public.bulk_set_item_cost((select jsonb_agg(jsonb_build_object('id', x, 'cost_cents', 1200)) from jsonb_array_elements_text(t.ids('A-4')) x));
do $$ begin
  assert (select cost_snapshot_cents from order_lines ol join items i on i.id = ol.item_id where i.sku = 'A-4') = 1200, 'sale cost follows';
end $$;

-- undo: each item gets its own former price back
select public.bulk_set_item_cost(jsonb_build_array(
  jsonb_build_object('id', (select id from items where sku = 'A-1'), 'cost_cents', 2000),
  jsonb_build_object('id', (select id from items where sku = 'A-2'), 'cost_cents', 2100)));
do $$ begin assert t.cost('A-1') = 2000 and t.cost('A-2') = 2100 and t.cost('A-3') = 2200; end $$;

-- invalid price, the operator
select t.expect_error($$select public.bulk_set_item_cost('{}')$$, 'Liste d''articles attendue');
do $$ declare r jsonb := public.bulk_set_item_cost(jsonb_build_array(jsonb_build_object('id', (select id from items where sku = 'A-3'), 'cost_cents', -5))); begin
  assert r->'errors'->0->>'error' = 'prix invalide', r::text;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select t.expect_error($$select public.bulk_set_item_cost(jsonb_build_array(jsonb_build_object('id', (select id from items where sku = 'A-3'), 'cost_cents', 100)))$$, '');
do $$ begin assert t.cost('A-3') = 2200, 'operator changed nothing'; end $$;
reset role;
select 'bulk item cost tests passed';
