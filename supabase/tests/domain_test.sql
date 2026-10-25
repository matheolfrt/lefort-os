-- End-to-end test of the item lifecycle, permissions and financial integrity.
-- Runs as plain psql against a database migrated on top of supabase_stub.sql.
\set ON_ERROR_STOP 1
set client_min_messages = warning;

create schema t;
create table t.ctx (k text primary key, v text);
create function t.v(k text) returns uuid language sql as $$ select v::uuid from t.ctx where ctx.k = $1 $$;
create function t.put(k text, v text) returns void language sql as
  $$ insert into t.ctx values ($1, $2) on conflict (k) do update set v = excluded.v $$;
-- Expects `sql` to fail with a message containing `fragment`
create function t.expect_error(sql text, fragment text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'Expected error containing "%" but statement succeeded: %', fragment, sql;
exception when others then
  if position(fragment in sqlerrm) = 0 then
    raise exception 'Expected error containing "%", got "%"', fragment, sqlerrm;
  end if;
end $$;
grant usage on schema t to authenticated;
grant select, insert, update on t.ctx to authenticated;
grant execute on all functions in schema t to authenticated;

insert into auth.users values
  ('00000000-0000-0000-0000-00000000000a', 'matheo@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'operateur@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'intrus@example.com');

-- ── Admin bootstraps the organization ──
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select t.put('org', public.bootstrap_organization('Lefort Second Hand', 'Mathéo')::text);
do $$ begin
  assert (select trade_name from organizations) = 'Lefort Second Hand';
  assert (select count(*) from categories) = 8, 'categories seeded';
  assert (select count(*) from locations where kind = 'storage') = 5, 'storage seeded';
  assert public.auth_role() = 'admin';
end $$;
select public.add_member('operateur@example.com', 'operator', 'Opérateur');
select t.expect_error($$select public.bootstrap_organization('x', 'y')$$, 'déjà');

insert into suppliers(org_id, name) values (t.v('org'), 'Fripes Grossiste');
insert into batches(org_id, code, supplier_id, purchased_at, payment_method, invoice_number)
  select t.v('org'), 'LOT-2026-01', id, '2026-10-01', 'Virement', 'F-123' from suppliers;
select t.put('batch', (select id::text from batches));
insert into batch_cost_lines(org_id, batch_id, kind, amount_cents)
  values (t.v('org'), t.v('batch'), 'goods', 50000), (t.v('org'), t.v('batch'), 'transport', 5000);

-- ── Labels ──
do $$ declare s text[]; begin
  s := array(select public.issue_sku_labels(t.v('batch'), 4));
  assert s = array['LSH00001', 'LSH00002', 'LSH00003', 'LSH00004'], 'sequential SKUs: ' || s::text;
end $$;

-- ── Operator receives and sorts ──
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ declare v_cat uuid; v_brand uuid; v_item items; begin
  select id into v_cat from categories where name = 'Blazer';
  select id into v_brand from brands where name = 'Hugo Boss';
  v_item := public.receive_item(t.v('batch'), 'lsh00001',
    jsonb_build_object('category_id', v_cat, 'brand_id', v_brand, 'size_label', '50', 'condition', 'very_good'), 'sorted');
  assert v_item.status = 'sorted';
  assert (select code from locations where id = v_item.current_location_id) = 'EMP-ATTENTE-PHOTO', 'auto staging';
  perform t.put('i1', v_item.id::text);
  v_item := public.receive_item(t.v('batch'), 'LSH00002',
    jsonb_build_object('category_id', v_cat, 'size_label', '48', 'condition', 'good'), 'sorted');
  perform t.put('i2', v_item.id::text);
  v_item := public.receive_item(t.v('batch'), 'LSH00003', jsonb_build_object('category_id', v_cat, 'size_label', '52', 'condition', 'good'));
  perform t.put('i3', v_item.id::text);
end $$;
select t.expect_error($$select public.receive_item(t.v('batch'), 'LSH00001')$$, 'déjà utilisée');
select t.expect_error($$select public.receive_item(t.v('batch'), 'LSH99999')$$, 'inconnue');
-- Operator cannot see costs or orders
do $$ begin
  assert (select count(*) from item_costs) = 0, 'operator must not see costs';
  assert (select count(*) from batch_cost_lines) = 0, 'operator must not see cost lines';
end $$;
select t.expect_error($$update items set status = 'listed' where id = t.v('i1')$$, 'permission denied');
select t.expect_error($$insert into items(org_id, sku, batch_id) values (t.v('org'), 'X', t.v('batch'))$$, 'permission denied');

-- ── Costs are allocated exactly ──
reset role;
do $$ begin
  assert (select sum(allocated_cost_cents) from item_costs) = 55000, 'allocation sums to batch cost';
  assert (select array_agg(allocated_cost_cents order by allocated_cost_cents desc) from item_costs) = array[18334, 18333, 18333]::bigint[];
  assert private.allocate_cents(100, array[1, 1, 1]) = array[34, 33, 33]::bigint[];
  assert private.allocate_cents(1000, array[1.8, 1, 0.5]) = array[545, 303, 152]::bigint[];
end $$;
set role authenticated;

-- ── Photo + measure station ──
select t.expect_error($$select public.transition_item(t.v('i1'), 'photographed')$$, 'photos requises');
insert into item_photos(org_id, item_id, storage_path, shot_key, position)
  values (t.v('org'), t.v('i1'), 'o/i1/1.jpg', 'front', 0), (t.v('org'), t.v('i1'), 'o/i1/2.jpg', 'back', 1),
         (t.v('org'), t.v('i1'), 'o/i1/3.jpg', 'detail', 2);
select t.expect_error($$select public.transition_item(t.v('i1'), 'photographed')$$, 'Étiquette marque');
insert into item_photos(org_id, item_id, storage_path, shot_key, position)
  values (t.v('org'), t.v('i1'), 'o/i1/4.jpg', 'label', 3);
select t.expect_error($$select public.transition_item(t.v('i1'), 'measured')$$, 'Mesures manquantes');
insert into item_measurements(org_id, item_id, definition_id, value_mm)
  select t.v('org'), t.v('i1'), d.id, 560 from measurement_definitions d
    join measurement_templates mt on mt.id = d.template_id where mt.name = 'Veste / Blazer' and d.key <> 'sleeve';
select t.expect_error($$select public.transition_item(t.v('i1'), 'measured')$$, 'Manche');
insert into item_measurements(org_id, item_id, definition_id, value_mm)
  select t.v('org'), t.v('i1'), d.id, 640 from measurement_definitions d
    join measurement_templates mt on mt.id = d.template_id where mt.name = 'Veste / Blazer' and d.key = 'sleeve';
do $$ declare v items; begin
  v := public.transition_item(t.v('i1'), 'measured', null, 'photo_measure');
  assert v.status = 'measured' and v.photo_count = 4;
  assert (select code from locations where id = v.current_location_id) = 'EMP-A-RANGER';
end $$;
-- stale version is rejected
select t.expect_error($$select public.transition_item(t.v('i1'), 'on_hold', 1)$$, 'modifié');

-- ── Storage: putting a measured item away promotes it ──
do $$ declare r jsonb; begin
  r := public.move_item(t.v('i1'), 'emp-a-01-01');
  assert (r->>'promoted')::boolean, 'promoted to listing_ready: ' || r::text;
  assert (select status from items where id = t.v('i1')) = 'listing_ready';
end $$;
select t.expect_error($$select public.move_item(t.v('i1'), 'EMP-Z-99-99')$$, 'inconnu');

-- ── Listing ──
update items set min_price_cents = 3000 where id = t.v('i1');
select t.expect_error($$select public.publish_item(t.v('i1'), 'https://www.vinted.fr/items/1', 2500)$$, 'minimum');
select public.publish_item(t.v('i1'), 'https://www.vinted.fr/items/123-blazer', 4500, 'Blazer Hugo Boss 50', 'desc', 'vinted', '123');
do $$ begin
  assert (select status from items where id = t.v('i1')) = 'listed';
  assert (select count(*) from price_changes where item_id = t.v('i1')) = 2, 'price history';
end $$;

-- ── Claims: a second operator cannot take a claimed item ──
do $$ declare v items; begin
  v := public.claim_next_item('photo');
  assert v.id = t.v('i2'), 'next photo item is i2';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select t.expect_error($$select public.claim_item(t.v('i2'))$$, 'en cours de traitement');
do $$ begin assert public.claim_next_item('photo') is null, 'no other photo item free'; end $$;

-- ── Sale (admin records it) ──
select t.expect_error($$select public.record_sale(array[t.v('i2')], 4000)$$, 'non vendables');
select t.put('o1', public.record_sale(array[t.v('i1')], 4000, '2026-10-20 10:00+02', 'vinted', 'VNT-1', 'acheteur1',
                                       null, 0, 0, 50)::text);
select t.expect_error($$select public.record_sale(array[t.v('i1')], 4000)$$, 'non vendables');
do $$ begin
  assert (select status from items where id = t.v('i1')) = 'sold';
  assert (select cost_snapshot_cents from order_lines where order_id = t.v('o1')) = 18334;
  assert (select status from listings where item_id = t.v('i1')) = 'sold';
end $$;
-- history is protected
select t.expect_error($$update order_lines set sale_price_cents = 1 where order_id = t.v('o1')$$, 'permission denied');
reset role;
select t.expect_error($$update order_lines set sale_price_cents = 1 where order_id = t.v('o1')$$, 'Historique protégé');
select t.expect_error($$delete from orders where id = t.v('o1')$$, 'Historique protégé');
set role authenticated;

-- Changing the current price later never changes the sale
reset role;
update items set list_price_cents = 9900 where id = t.v('i1');
set role authenticated;
do $$ begin assert (select sale_price_cents from order_lines where order_id = t.v('o1')) = 4000; end $$;

-- ── Operator ships; sees the queue without money ──
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  assert (select count(*) from public.shipping_queue()) = 1;
  assert (select count(*) from orders) = 0, 'operator must not read orders';
end $$;
select public.ship_order(t.v('o1'), 'Mondial Relay', 'MR123');
select t.expect_error($$select public.record_refund(t.v('o1'), 100, 'x')$$, 'non autorisée');

-- ── Admin completes; batch closes; accounting ──
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select public.complete_order(t.v('o1'), '2026-10-24 12:00+02');
select public.close_batch(t.v('batch'));
select t.expect_error($$insert into batch_cost_lines(org_id, batch_id, kind, amount_cents) values (t.v('org'), t.v('batch'), 'other', 100)$$, 'clôturé');
insert into batch_cost_adjustments(org_id, batch_id, amount_cents, reason) values (t.v('org'), t.v('batch'), 1000, 'Facture transport complémentaire');
do $$ declare e v_item_economics; b v_batch_profitability; m v_monthly_turnover; begin
  select * into e from v_item_economics where item_id = t.v('i1');
  assert e.revenue_cents = 4000 and e.cost_cents = 18334 and e.variable_costs_cents = 50, e::text;
  assert e.gross_profit_cents = 4000 - 18334 - 50;
  select * into b from v_batch_profitability;
  assert b.total_cost_cents = 56000 and b.items = 3 and b.items_sold = 1, b::text;
  assert b.profit_cents = 4000 - 50 - 56000;
  select * into m from v_monthly_turnover;
  assert m.month = '2026-10-01' and m.turnover_cents = 4000, m::text;
  assert m.contributions_cents = round(4000 * 0.124), 'URSSAF 12.3% + CFP 0.1%: ' || m.contributions_cents;
  assert (select count(*) from v_livre_recettes) = 1;
  assert (select sum(montant_cents) from v_registre_achats) = 56000;
end $$;
select t.expect_error($$update orders set platform_fee_cents = 0 where id = t.v('o1')$$, 'verrouillés');

-- ── Return (rétractation): refund + item back to stock ──
select public.record_refund(t.v('o1'), 4000, 'Rétractation', array[t.v('i1')]);
do $$ declare r jsonb; begin
  assert (select status from items where id = t.v('i1')) = 'returned';
  assert (select code from locations l join items i on i.current_location_id = l.id where i.id = t.v('i1')) = 'EMP-RETOURS';
  assert (select sum(montant_cents) from v_livre_recettes) = 0, 'refund is a negative receipt';
  r := public.move_item(t.v('i1'), 'EMP-A-01-02');
  assert (r->>'promoted')::boolean, 'returned item back to listing_ready';
end $$;

-- ── Hold & release ──
select public.transition_item(t.v('i3'), 'on_hold', null, 'sort', '{"hold_reason":"cleaning"}');
select t.expect_error($$select public.transition_item(t.v('i3'), 'photographed')$$, 'Transition impossible');
do $$ begin
  assert (select status from public.transition_item(t.v('i3'), 'received')) = 'received';
end $$;

-- ── Cancelled order puts the item back on sale ──
select public.publish_item(t.v('i1'), 'https://www.vinted.fr/items/124', 4500);
select t.put('o2', public.record_sale(array[t.v('i1')], 4200)::text);
select public.cancel_order(t.v('o2'), 'Acheteur injoignable');
do $$ begin
  assert (select status from items where id = t.v('i1')) = 'listed';
  assert (select sold_at from items where id = t.v('i1')) is null;
  assert (select count(*) from listings where item_id = t.v('i1') and status = 'active') = 1;
end $$;

-- ── Bundle sale splits the price exactly ──
reset role;
update batches set status = 'open' where id = t.v('batch');
set role authenticated;
select public.receive_item(t.v('batch'), 'LSH00004', jsonb_build_object('category_id', (select id from categories where name = 'Costume')));
reset role;
-- fast-forward i4 to listed for the bundle test
update items set status = 'listed', list_price_cents = 9000, size_label = '50', condition = 'good' where sku = 'LSH00004';
set role authenticated;
select t.put('o3', public.record_sale(array[t.v('i1'), (select id from items where sku = 'LSH00004')], 10001)::text);
do $$ begin
  assert (select sum(sale_price_cents) from order_lines where order_id = t.v('o3')) = 10001;
  assert (select array_agg(sale_price_cents order by sale_price_cents) from order_lines where order_id = t.v('o3')) = array[3334, 6667]::bigint[];
end $$;

-- ── An outsider sees nothing ──
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
do $$ begin
  assert (select count(*) from items) = 0;
  assert (select count(*) from organizations) = 0;
  assert public.claim_next_item('photo') is null;
exception when others then
  assert position('aucun compte actif' in sqlerrm) > 0, sqlerrm;
end $$;
select t.expect_error($$select public.claim_next_item('photo')$$, 'aucun compte actif');

reset role;
select 'ok' as domain_tests;
