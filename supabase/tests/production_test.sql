-- Production board (Kanban): moves, rules, manager corrections, priority, blocking, assignment, tasks, stats.
-- Runs on a freshly migrated database.
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
create function t.id(p_sku text) returns uuid language sql as $$ select id from items where sku = p_sku $$;
create function t.col(p_board jsonb, p_status text) returns jsonb language sql as
  $$ select c from jsonb_array_elements(p_board->'columns') c where c->>'status' = p_status $$;
create function t.add_listing(p_sku text) returns void language sql security definer as
  $$ insert into listings(org_id, item_id, channel, url, price_cents)
     select org_id, id, 'vinted', 'https://www.vinted.fr/items/1', 3900 from items where sku = p_sku $$;
grant usage on schema t to authenticated;
grant execute on all functions in schema t to authenticated;

insert into auth.users values ('00000000-0000-0000-0000-0000000000a1', 'admin@example.com'),
                              ('00000000-0000-0000-0000-0000000000b1', 'op@example.com'),
                              ('00000000-0000-0000-0000-0000000000b2', 'photo@example.com');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select public.bootstrap_organization('Lefort Second Hand', 'Mathéo');
select public.add_member('op@example.com', 'operator');
select public.add_member('photo@example.com', 'photographer');

do $$ declare r jsonb; v_batch uuid; v_cat uuid; begin
  insert into suppliers(org_id, name) values (public.auth_org_id(), 'Fripes & Co');
  insert into batches(org_id, code, supplier_id, purchased_at, allocation_method, created_by)
  select org_id, 'LOT-PROD', id, current_date, 'equal', auth.uid() from suppliers limit 1 returning id into v_batch;
  insert into batch_cost_lines(org_id, batch_id, kind, amount_cents) values (public.auth_org_id(), v_batch, 'goods', 4000);
  r := public.create_batch_skus(v_batch, 'P-', 1, 10);
  assert (r->>'items_created')::int = 10, r::text;
  select id into v_cat from categories where name ilike 'Blazer%' or name ilike 'Veste%' order by hotkey limit 1;
  update items set category_id = v_cat, title = 'Blazer laine', size_label = '52', list_price_cents = 3900 where sku like 'P-%';
end $$;

-- board: nine columns, counts, cost visible to the manager
do $$ declare b jsonb; begin
  b := public.production_board();
  assert jsonb_array_length(b->'columns') = 9, b::text;
  assert (t.col(b, 'received')->>'count')::int = 10 and (t.col(b, 'received')->>'value_cents')::bigint = 39000, b::text;
  assert (t.col(b, 'received')->>'cost_cents')::bigint = 4000, b::text;
  assert jsonb_array_length(b->'items') = 10 and (b->'items'->0->>'cost_cents')::int = 400, b::text;
  -- one column, paginated
  b := public.production_board('{}', '{"received":"sku"}', 3, 'received', 3);
  assert jsonb_array_length(b->'items') = 3 and b->'items'->0->>'sku' = 'P-4' and (b->'items'->0->>'rn')::int = 4, b::text;
  -- filters
  b := public.production_board('{"q":"p-1"}');
  assert (t.col(b, 'received')->>'count')::int = 2, b::text; -- P-1, P-10
  b := public.production_board('{"price_min":4000}');
  assert (t.col(b, 'received')->>'count')::int = 0, b::text;
end $$;

-- the usual step goes through the state machine; jumps are for managers, with confirmation
do $$ declare c jsonb; begin
  c := public.kanban_move(t.id('P-1'), 'sorted');
  assert c->>'status' = 'sorted' and c->>'col' = 'sorted', c::text;
  assert (select actor_id = auth.uid() and station = 'production' and from_status = 'received'
            from item_events where item_id = t.id('P-1') and type = 'status' order by id desc limit 1);
  -- the photo rule still applies
  perform t.expect_error(format('select public.kanban_move(%L, ''photographed'')', t.id('P-1')), 'photos requises');
  -- a jump needs confirmation, then is recorded as forced
  perform t.expect_error(format('select public.kanban_move(%L, ''listed'')', t.id('P-2')), 'confirmation');
  c := public.kanban_move(t.id('P-2'), 'listed', null, true);
  assert c->>'status' = 'listed', c::text;
  assert (select (payload->>'forced')::boolean from item_events where item_id = t.id('P-2') order by id desc limit 1);
  -- back from En ligne: the listing is taken down
  perform t.add_listing('P-2');
  c := public.kanban_move(t.id('P-2'), 'reserved');
  assert c->>'status' = 'reserved' and (select status from listings where item_id = t.id('P-2')) = 'reserved', c::text;
  c := public.kanban_move(t.id('P-2'), 'listing_ready', null, true);
  assert (select status from listings where item_id = t.id('P-2')) = 'delisted', c::text;
  -- sold and shipped only through Ventes / Expédition
  perform t.expect_error(format('select public.kanban_move(%L, ''sold'', null, true)', t.id('P-2')), 'Ventes');
  perform t.expect_error(format('select public.kanban_move(%L, ''shipped'', null, true)', t.id('P-2')), 'Expédition');
  -- stale card
  perform t.expect_error(format('select public.kanban_move(%L, ''sorted'', 999)', t.id('P-3')), 'entre-temps');
end $$;

-- priority, blocking, assignment (none of them bump the item version)
do $$ declare c jsonb; v_version int; r jsonb; begin
  select version into v_version from items where sku = 'P-3';
  r := public.set_item_priority(array[t.id('P-3'), t.id('P-4')], 3);
  assert (r->>'updated')::int = 2, r::text;
  perform t.expect_error(format('select public.set_item_priority(array[%L]::uuid[], 7)', t.id('P-3')), 'invalide');
  c := public.set_item_block(t.id('P-4'), 'missing_info', 'Marque illisible');
  assert c->>'blocked_reason' = 'missing_info' and c->>'blocked_note' = 'Marque illisible', c::text;
  perform t.expect_error(format('select public.set_item_block(%L, ''other'')', t.id('P-5')), 'Précisez');
  perform t.expect_error(format('select public.kanban_move(%L, ''sorted'')', t.id('P-4')), 'bloqué');
  assert (select version from items where sku = 'P-3') = v_version, 'priority must not bump version';
  assert (t.col(public.production_board('{"blocked":true}'), 'received')->>'count')::int = 1;
  r := public.assign_items(array[t.id('P-5'), t.id('P-6')], '00000000-0000-0000-0000-0000000000b1');
  assert (r->>'updated')::int = 2, r::text;
  assert (select count(*) from item_events where type in ('priority', 'block', 'assign')) = 5;
end $$;

-- an operator: next task (assigned first, then urgent), no jumps, may take an item for themself only
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
do $$ declare c jsonb; r jsonb; begin
  c := public.next_task();
  assert c->>'sku' in ('P-5', 'P-6') and c->>'cost_cents' is null, c::text; -- assigned to them; no cost for operators
  c := public.start_task((c->>'id')::uuid);
  assert c->>'claimed_by' = '00000000-0000-0000-0000-0000000000b1', c::text;
  assert public.next_task()->>'sku' = c->>'sku', 'the item in hand stays the next task';
  perform pg_sleep(0.05);
  c := public.kanban_move((c->>'id')::uuid, 'sorted');
  assert c->>'status' = 'sorted' and c->>'claimed_by' is null, c::text;
  perform t.expect_error(format('select public.kanban_move(%L, ''listed'', null, true)', t.id('P-7')), 'responsable');
  perform t.expect_error(format('select public.kanban_move(%L, ''photographed'')', t.id('P-7')), 'responsable');
  perform t.expect_error(format('select public.assign_items(array[%L]::uuid[], %L)', t.id('P-7'), '00000000-0000-0000-0000-0000000000b2'), 'responsable');
  r := public.assign_items(array[t.id('P-7')], '00000000-0000-0000-0000-0000000000b1');
  assert (r->>'updated')::int = 1, r::text;
  r := public.production_overview();
  assert (r->>'done_today')::int = 1 and (r->'priorities'->>'urgent')::int = 1 and (r->>'assigned_to_me')::int = 3, r::text;
  r := public.production_stats(now() - interval '1 day');
  assert (r->'total'->>'n')::int = 1 and (r->'total'->>'timed')::int = 0 and jsonb_array_length(r->'people') = 1, r::text;
  assert r->'bottleneck' is null, 'manager metrics stay hidden';
end $$;

-- a photographer's next task is in their columns only; a blocked item is never offered
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
do $$ declare c jsonb; begin
  c := public.next_task();
  assert c->>'status' = 'sorted', c::text;
  assert public.next_task(array['received']::item_status[])->>'sku' not in ('P-4', 'P-5', 'P-6', 'P-7'), 'blocked or assigned elsewhere';
end $$;

-- manager view
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
do $$ declare r jsonb; begin
  r := public.production_stats(now() - interval '1 day');
  assert (r->'total'->>'n')::int = 3 and jsonb_array_length(r->'people') = 2, r::text;
  assert (r->>'pending')::int = 10 and (r->>'blocked')::int = 1 and r->'bottleneck'->>'col' is not null, r::text;
  assert jsonb_array_length(r->'columns') = 6, r::text;
end $$;

-- an outsider reaches nothing
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select t.expect_error($$select public.production_board()$$, 'aucun compte actif');
reset role;
