-- Packaging of each parcel: 0,15 € by default on every sale recorded without an amount. Runs on a freshly migrated database.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create schema t;
create function t.list(p_sku text) returns uuid language sql security definer as
  $$ update items set status = 'listed', list_price_cents = 3000, listed_at = now() where sku = p_sku returning id $$;
create function t.pack(p_order uuid) returns bigint language sql security definer as $$ select packaging_cost_cents from orders where id = p_order $$;
grant usage on schema t to authenticated;
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
  select org_id, 'LOT-P', id, current_date, 'equal', auth.uid() from suppliers limit 1 returning id into v_batch;
  r := public.create_batch_skus(v_batch, 'P-', 1, 8);
end $$;

do $$ declare o uuid; begin
  assert (select packaging_cost_cents from organizations) = 15, 'default: 0,15 €';
  -- no amount given: the default, once for the parcel
  o := public.record_sale(array[t.list('P-1')], 4000);
  assert t.pack(o) = 15, 'one item: 15 cents';
  o := public.record_sale(array[t.list('P-2'), t.list('P-3')], 6000);
  assert t.pack(o) = 15, 'two items in one parcel: one packaging';
  -- an amount typed is kept, 0 included
  o := public.record_sale(array[t.list('P-4')], 3000, now(), 'vinted', null, null, null, 0, 0, 0);
  assert t.pack(o) = 0, 'typed 0 stays 0';
  o := public.record_sale(array[t.list('P-5')], 3000, now(), 'vinted', null, null, null, 0, 0, 40);
  assert t.pack(o) = 40, 'typed 0,40 € stays';
end $$;

-- the amount is set in Paramètres
update organizations set packaging_cost_cents = 25;
do $$ declare o uuid; begin
  o := public.record_sale(array[t.list('P-6')], 3000);
  assert t.pack(o) = 25, 'the amount of the settings';
end $$;

-- CSV import: without the column, the default; with it, the amount of the file
do $$ declare r jsonb; begin
  perform t.list('P-7'); perform t.list('P-8');
  r := public.import_sales(jsonb_build_array(
    jsonb_build_object('sold_at', now(), 'order_ref', 'CSV-1', 'lines', jsonb_build_array(jsonb_build_object('sku', 'P-7', 'price_cents', 2000))),
    jsonb_build_object('sold_at', now(), 'order_ref', 'CSV-2', 'packaging_cents', 0, 'lines', jsonb_build_array(jsonb_build_object('sku', 'P-8', 'price_cents', 2000)))
  ), false);
  assert (select packaging_cost_cents from orders where external_order_id = 'CSV-1') = 25, r::text;
  assert (select packaging_cost_cents from orders where external_order_id = 'CSV-2') = 0, r::text;
end $$;

-- the margin of an item counts it
do $$ begin
  assert (select variable_costs_cents from v_item_economics e join items i on i.id = e.item_id where i.sku = 'P-1') = 15;
end $$;

reset role;
select 'packaging tests passed';
