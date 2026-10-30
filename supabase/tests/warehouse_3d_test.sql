-- Entrepôt 3D: levels are locations (existing ones adopted), items get a slot, sales are traced back to their shelf,
-- the item card tells its history, picking moves to the preparation table. Runs on a freshly migrated database.
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
create function t.item(p_sku text) returns uuid language sql as $$ select id from items where sku = p_sku $$;
create function t.loc(p_rack text, p_shelf int, p_level int) returns locations language sql as
  $$ select * from locations where rack = p_rack and shelf_no = p_shelf and level_no = p_level $$;
create function t.list(p_sku text) returns uuid language sql security definer as
  $$ update items set status = 'listed', list_price_cents = 5000, listed_at = now() - interval '20 days' where sku = p_sku returning id $$;
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
  select org_id, 'LOT-W', id, current_date, 'equal', auth.uid() from suppliers limit 1 returning id into v_batch;
  insert into batch_cost_lines(org_id, batch_id, kind, amount_cents) values (public.auth_org_id(), v_batch, 'goods', 8000);
  r := public.create_batch_skus(v_batch, 'W-', 1, 8);
  perform public.close_batch(v_batch); -- allocates the cost: 80 € over 8 items
end $$;

-- a building: racks A (2 shelves) and B (1 shelf), 5 levels of 3 items
do $$ declare v uuid; begin
  insert into warehouses(name, config) values ('Entrepôt', '{"shelf": {"levels": 5, "perLevel": 3},
    "racks": [{"code": "A", "shelves": 2}, {"code": "B", "shelves": 1}]}') returning id into v;
  perform t.put('w', v::text);
end $$;
do $$ declare r jsonb := public.warehouse_sync(t.v('w')); begin
  -- the 5 locations of the default shop (EMP-A-01-01 … 05) are rack A, shelf 1: adopted, not duplicated
  assert (r->>'adopted')::int = 5 and (r->>'created')::int = 10 and (r->>'levels')::int = 15, r::text;
  assert (t.loc('A', 1, 3)).code = 'EMP-A-01-03', 'the old name is kept';
  assert (t.loc('A', 2, 4)).code = 'EMP-A-02-L4' and (t.loc('A', 2, 4)).capacity = 3;
  assert (select count(*) from locations where code like 'EMP-A-01-%') = 5, 'no duplicate';
  -- running it again changes nothing
  r := public.warehouse_sync(t.v('w'));
  assert (r->>'created')::int = 0 and (r->>'adopted')::int = 0, r::text;
end $$;

-- slots: the first free one, past the capacity when full, freed when an item leaves
do $$ begin
  perform t.list('W-' || n) from generate_series(1, 5) n;
  perform public.move_item(t.item('W-1'), 'EMP-A-02-L1', 'manual');
  perform public.move_item(t.item('W-2'), 'EMP-A-02-L1', 'manual');
  perform public.move_item(t.item('W-3'), 'EMP-A-02-L1', 'manual');
  assert (select array_agg(location_position order by sku) from items where sku in ('W-1', 'W-2', 'W-3')) = array[1, 2, 3];
  perform public.move_item(t.item('W-4'), 'EMP-A-02-L1', 'manual');
  assert (select location_position from items where sku = 'W-4') = 4, 'a full level: the item is still placed, past the capacity';
  perform public.move_item(t.item('W-2'), 'EMP-B-01-L3', 'manual');
  assert (select location_position from items where sku = 'W-2') = 1;
  perform public.move_item(t.item('W-5'), 'EMP-A-02-L1', 'manual');
  assert (select location_position from items where sku = 'W-5') = 2, 'the slot W-2 left';
  -- a staging location has no slot
  perform public.move_item(t.item('W-6'), 'EMP-RECEPTION', 'manual');
  assert (select location_position from items where sku = 'W-6') is null;
end $$;

-- what the 3D view draws
do $$ declare s jsonb := public.warehouse_snapshot(t.v('w')); it jsonb; begin
  assert jsonb_array_length(s->'levels') = 15, (s->'levels')::text;
  select x into it from jsonb_array_elements(s->'items') x where x->>1 = 'W-1';
  assert it->>2 = 'listed' and (it->>3)::uuid = (t.loc('A', 2, 1)).id and (it->>4)::int = 1, it::text;
  assert (it->>8)::int = 1000, 'managers get the cost: ' || it::text;
  assert (s->>'manager')::boolean and jsonb_array_length(s->'staging') >= 7;
end $$;

-- a sale from shelf A-02 level 1: picked, then traced back to its shelf
select t.put('o', public.record_sale(array[t.item('W-1')], 6000)::text);
do $$ declare r jsonb; begin
  r := public.pick_item(t.item('W-1'));
  assert r->>'from' = 'EMP-A-02-L1' and not (r->>'already')::boolean, r::text;
  assert (select l.code from items i join locations l on l.id = i.current_location_id where i.sku = 'W-1') = 'EMP-PREPARATION';
  assert (select count(*) from item_events where item_id = t.item('W-1') and type = 'picked') = 1;
  assert (public.pick_item(t.item('W-1'))->>'already')::boolean, 'picking twice is harmless';
end $$;
select t.expect_error($$select public.pick_item(t.item('W-3'))$$, 'pas une vente à préparer');

do $$ declare h jsonb := public.warehouse_heat(t.v('w')); a jsonb; begin
  select x into a from jsonb_array_elements(h->'levels') x where (x->>0)::uuid = (t.loc('A', 2, 1)).id;
  -- on the level now: W-3, W-4, W-5 (W-1 left for the preparation table); sold from it: W-1, 60 € of revenue
  assert (a->>1)::int = 3 and (a->>2)::int = 3000, 'count and value at cost: ' || a::text;
  assert (a->>5)::int = 1 and (a->>6)::int = 6000, 'sold from this level: ' || a::text;
  assert (a->>7)::int = 6000 - 1000 - (select platform_fee_cents + packaging_cost_cents from orders where id = t.v('o')), a::text;
end $$;

-- the item card: where it is, and its history (statuses and moves)
do $$ declare c jsonb := public.warehouse_item(t.item('W-1')); begin
  assert c->>'sku' = 'W-1' and c->>'status' = 'sold' and (c->>'cost_cents')::int = 1000 and (c->>'price_cents')::int = 5000, c::text;
  assert c->'location'->>'code' = 'EMP-PREPARATION', c::text;
  assert exists (select 1 from jsonb_array_elements(c->'history') x where x->>'kind' = 'move' and x->>'to' = 'EMP-A-02-L1'), c::text;
  assert exists (select 1 from jsonb_array_elements(c->'history') x where x->>'type' = 'picked'), c::text;
  assert (c->'history'->0->>'at') >= (c->'history'->1->>'at'), 'most recent first';
end $$;

-- fewer shelves: an empty level is archived, a level with items is kept and reported
update warehouses set config = jsonb_set(config, '{racks}', '[{"code": "A", "shelves": 1}, {"code": "B", "shelves": 1}]') where id = t.v('w');
do $$ declare r jsonb := public.warehouse_sync(t.v('w')); begin
  assert r->'kept_not_empty' = '["EMP-A-02-L1"]'::jsonb and (r->>'archived')::int = 4, r::text;
end $$;

-- rack letters are unique in the shop
insert into warehouses(name, config, is_default) values ('Annexe', '{"shelf": {"levels": 5, "perLevel": 3}, "racks": [{"code": "B", "shelves": 1}]}', false);
select t.expect_error($$select public.warehouse_sync((select id from warehouses where name = 'Annexe'))$$, 'existe déjà dans un autre entrepôt');

-- the team: sees the building, no money, cannot change it
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
do $$ declare s jsonb := public.warehouse_snapshot(t.v('w')); it jsonb; h jsonb := public.warehouse_heat(t.v('w')); begin
  select x into it from jsonb_array_elements(s->'items') x where x->>1 = 'W-3';
  assert it->8 = 'null'::jsonb and not (s->>'manager')::boolean, it::text;
  assert (select bool_and(x->2 = 'null'::jsonb and x->6 = 'null'::jsonb) from jsonb_array_elements(h->'levels') x), 'no money in the heat';
  assert (public.warehouse_item(t.item('W-3'))->'cost_cents') = 'null'::jsonb;
end $$;
select t.expect_error($$select public.warehouse_sync(t.v('w'))$$, 'non autorisée');
update warehouses set name = 'X';
do $$ begin assert (select name from warehouses where id = t.v('w')) = 'Entrepôt'; end $$;

reset role;
select 'warehouse 3d tests passed';
