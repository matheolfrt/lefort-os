-- Vinted synchronisation that runs on its own: never a duplicate, never a sale lost, nothing uncertain decided alone,
-- everything it did can be undone. Each scenario reads like what happens in the shop. Runs on a freshly migrated database.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create schema t;
create table t.ctx (k text primary key, v text);
create function t.v(k text) returns text language sql as $$ select v from t.ctx where ctx.k = $1 $$;
create function t.put(k text, v text) returns void language sql as
  $$ insert into t.ctx values ($1, $2) on conflict (k) do update set v = excluded.v $$;
create function t.expect_error(sql text, fragment text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'Expected error containing "%" but statement succeeded: %', fragment, sql;
exception when others then
  if position(fragment in sqlerrm) = 0 then raise exception 'Expected error containing "%", got "%"', fragment, sqlerrm; end if;
end $$;
-- an item put on sale N days ago at a price, optionally with its Vinted listing, brand and size
create function t.list(p_sku text, p_ext text, p_price bigint, p_brand text default null, p_size text default null)
returns uuid language plpgsql security definer as $$
declare v_id uuid;
begin
  update items set status = 'listed', list_price_cents = p_price, listed_at = now() - interval '20 days',
         received_at = now() - interval '25 days', size_label = p_size,
         brand_id = case when p_brand is null then null else private.brand_for(org_id, p_brand) end
   where sku = p_sku returning id into v_id;
  if p_ext is not null then
    insert into listings(org_id, item_id, channel, external_id, url, price_cents, listed_at)
    select org_id, id, 'vinted', p_ext, 'https://www.vinted.fr/items/' || p_ext, p_price, now() - interval '20 days' from items where id = v_id;
  end if;
  return v_id;
end $$;
create function t.id(p_sku text) returns uuid language sql security definer as $$ select id from items where sku = p_sku $$;
create function t.status(p_sku text) returns text language sql security definer as $$ select status::text from items where sku = p_sku $$;
-- a Vinted sale as the extension sends it
create function t.vo(p_tid text, p_state text, p_items text[], p_price bigint, p_days numeric default 2, p_buyer text default 'acheteuse',
                     p_detail jsonb default null)
returns jsonb language sql as $$
  select jsonb_build_object('transaction_id', p_tid, 'state', p_state, 'item_ids', to_jsonb(p_items), 'price_cents', p_price,
           'sold_at', now() - make_interval(secs => (p_days * 86400)::double precision), 'buyer', p_buyer, 'title', 'Vente ' || p_tid,
           'items', coalesce(p_detail, (select coalesce(jsonb_agg(jsonb_build_object('id', x, 'title', 'Article ' || x)), '[]') from unnest(p_items) x)))
$$;
-- one whole synchronisation of sales: start, read, finish
create function t.sync(p_orders jsonb, p_complete boolean default true) returns jsonb language plpgsql as $$
declare v_run uuid := public.vinted_sync_start('auto', 'orders'); r jsonb;
begin
  r := public.vinted_reconcile(v_run, p_orders);
  perform public.vinted_sync_finish(v_run, 'ok', p_complete, now() - interval '60 days', null, null, null);
  return r;
end $$;
create function t.wardrobe(p_listings jsonb, p_complete boolean default true) returns jsonb language plpgsql as $$
declare v_run uuid := public.vinted_sync_start('auto', 'wardrobe'); r jsonb;
begin
  r := public.vinted_listings_seen(v_run, p_listings);
  return public.vinted_sync_finish(v_run, 'ok', null, null, p_complete, null, null);
end $$;
create function t.m(p_tid text) returns vinted_orders language sql security definer as
  $$ select * from vinted_orders where transaction_id = p_tid $$;
create function t.orders(p_tid text) returns int language sql security definer as
  $$ select count(*)::int from orders where external_order_id = p_tid $$;
create function t.sales_of(p_sku text) returns int language sql security definer as
  $$ select count(*)::int from order_lines ol join orders o on o.id = ol.order_id
      where ol.item_id = (select id from items where sku = p_sku) and o.status <> 'cancelled' and ol.status <> 'cancelled' $$;
create function t.event(p_tid text, p_action text) returns uuid language sql security definer as
  $$ select id from vinted_sync_events where transaction_id = p_tid and action = p_action and undone_at is null order by at desc limit 1 $$;
grant usage on schema t to authenticated;
grant select, insert, update on t.ctx to authenticated;
grant execute on all functions in schema t to authenticated;

insert into auth.users values ('00000000-0000-0000-0000-0000000000a1', 'admin@example.com'),
                              ('00000000-0000-0000-0000-0000000000b1', 'op@example.com'),
                              ('00000000-0000-0000-0000-0000000000c1', 'other@example.com');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select public.bootstrap_organization('Lefort Second Hand', 'Mathéo');
select public.add_member('op@example.com', 'operator');
update organizations set vinted_fee_pct = 0, vinted_fee_fixed_cents = 0;

-- 20 items of a 400 € lot (20 € each)
do $$ declare v_batch uuid; r jsonb; begin
  insert into suppliers(org_id, name) values (public.auth_org_id(), 'Fripes & Co');
  insert into batches(org_id, code, supplier_id, purchased_at, allocation_method, created_by)
  select org_id, 'LOT-V', id, current_date - 40, 'equal', auth.uid() from suppliers limit 1 returning id into v_batch;
  insert into batch_cost_lines(org_id, batch_id, kind, amount_cents) values (public.auth_org_id(), v_batch, 'goods', 40000);
  r := public.create_batch_skus(v_batch, 'V-', 1, 20);
end $$;
select t.list('V-1', '1001', 5000);
select t.list('V-2', '1002', 4000);
select t.list('V-3', null, 4500);                         -- published without its Vinted link
select t.list('V-4', null, 5200, 'Hugo Boss', '50');      -- not linked either
select t.list('V-5', null, 3900);                         -- linked later by the « Réf. » in its description
select t.list('V-6', '1006', 4400);
select t.list('V-7', '1007', 3000);
select t.list('V-8', '1008', 3100);
select t.list('V-9', '1009', 3200);
select t.list('V-10', '1010', 3300);
select t.list('V-11', '1011', 6000);
select t.list('V-12', null, 2500);
select t.list('V-13', '1013', 2600);
select t.list('V-14', '1014', 2700);
select t.list('V-15', '1015', 2800);
select t.list('V-16', '1016', 2900);

-- ── 0. Before choosing a start date, nothing is recorded on its own ─────────────────────────────────────────────
do $$ declare r jsonb; begin
  r := t.sync(jsonb_build_array(t.vo('T1', 'pending', '{1001}', 5000)));
  assert (r->>'issue')::int = 1, r::text;
  assert t.orders('T1') = 0 and t.status('V-1') = 'listed';
  assert (t.m('T1')).issue = 'before_start' and (t.m('T1')).candidates->'in_stock' = '["V-1"]', (t.m('T1')).candidates::text;
end $$;
-- a start date: what waited and is after it is recorded now
select public.vinted_set_sync_from(current_date - 30);

-- ── 1. A new Vinted sale of a linked item is recorded once, at its Vinted state ─────────────────────────────────
do $$ begin
  assert t.orders('T1') = 1, 'recorded when the start date was chosen';
  assert t.status('V-1') = 'sold' and (t.m('T1')).match = 'created' and (t.m('T1')).issue is null;
  assert (select gross_cents from orders where external_order_id = 'T1') = 5000;
  assert (select notes from orders where external_order_id = 'T1') = 'Synchro Vinted';
end $$;
-- read again (every hour, several times, twice in one read): never a second sale
do $$ declare r jsonb; begin
  r := t.sync(jsonb_build_array(t.vo('T1', 'pending', '{1001}', 5000), t.vo('T1', 'pending', '{1001}', 5000)));
  assert (r->>'unchanged')::int = 2, r::text;
  r := t.sync(jsonb_build_array(t.vo('T1', 'pending', '{1001}', 5000)));
  assert t.orders('T1') = 1 and t.sales_of('V-1') = 1;
  assert (select count(*) from vinted_orders where transaction_id = 'T1') = 1;
end $$;
-- it moves forward with Vinted, and a read that is behind never moves it back
do $$ begin
  perform t.sync(jsonb_build_array(t.vo('T1', 'shipped', '{1001}', 5000)));
  assert (select status from orders where external_order_id = 'T1') = 'shipped' and t.status('V-1') = 'shipped';
  perform t.sync(jsonb_build_array(t.vo('T1', 'completed', '{1001}', 5000) || jsonb_build_object('completed_at', now() - interval '1 day')));
  assert (select status from orders where external_order_id = 'T1') = 'completed';
  assert (select paid_at::date from orders where external_order_id = 'T1') = (now() - interval '1 day')::date, 'paid when Vinted paid';
  perform t.sync(jsonb_build_array(t.vo('T1', 'pending', '{}', null)));
  assert (select status from orders where external_order_id = 'T1') = 'completed' and (t.m('T1')).state = 'completed';
  assert (t.m('T1')).item_ids = '{1001}' and (t.m('T1')).price_cents = 5000, 'a read without details keeps what was known';
  assert (select count(*) from vinted_sync_events where transaction_id = 'T1' and action = 'order_advanced') = 2;
end $$;

-- ── 2. A sale typed by hand for a linked item is recognised, not recorded again ─────────────────────────────────
select t.put('o2', public.record_sale(array[t.id('V-2')], 4000, now() - interval '1 day', 'vinted')::text);
do $$ declare r jsonb; begin
  r := t.sync(jsonb_build_array(t.vo('T2', 'pending', '{1002}', 4000, 1)));
  assert (r->>'linked')::int = 1, r::text;
  assert t.sales_of('V-2') = 1 and (select external_order_id from orders where id = t.v('o2')::uuid) = 'T2';
  assert (t.m('T2')).match = 'listing' and (t.m('T2')).order_id = t.v('o2')::uuid;
end $$;

-- ── 3. A sale typed by hand for an item without link: proposed, never guessed ───────────────────────────────────
select t.put('o3', public.record_sale(array[t.id('V-3')], 4500, now() - interval '2 days', 'vinted', null, 'paul75')::text);
do $$ declare r jsonb; begin
  r := t.sync(jsonb_build_array(t.vo('T3', 'pending', '{9003}', 4500, 2.2, 'paul75')));
  assert (r->>'issue')::int = 1 and t.orders('T3') = 0 and t.sales_of('V-3') = 1, r::text;
  assert (t.m('T3')).issue = 'possible_match', (t.m('T3')).issue;
  assert (t.m('T3')).candidates->'orders'->0->>'order_id' = t.v('o3'), (t.m('T3')).candidates::text;
  -- the next readings do not change their mind
  perform t.sync(jsonb_build_array(t.vo('T3', 'pending', '{9003}', 4500, 2.2, 'paul75')));
  assert t.orders('T3') = 0 and (select count(*) from orders where status <> 'cancelled') = 3;
  -- the seller confirms
  perform public.vinted_resolve((t.m('T3')).id, 'link_order', jsonb_build_object('order_id', t.v('o3')));
  assert (select external_order_id from orders where id = t.v('o3')::uuid) = 'T3' and (t.m('T3')).issue is null;
  perform t.sync(jsonb_build_array(t.vo('T3', 'shipped', '{9003}', 4500, 2.2, 'paul75')));
  assert (select status from orders where id = t.v('o3')::uuid) = 'shipped' and t.sales_of('V-3') = 1;
end $$;
-- an order already linked to another Vinted sale cannot be linked twice
do $$ declare r jsonb; begin
  r := t.sync(jsonb_build_array(t.vo('T3B', 'pending', '{9033}', 4500, 2.2, 'paul75')));
  assert (t.m('T3B')).issue = 'unknown_items', 'the linked order is no longer proposed';
end $$;
select t.expect_error(format($$select public.vinted_resolve(%L, 'link_order', '{"order_id": "%s"}')$$, (t.m('T3B')).id, t.v('o3')), 'déjà liée');

-- ── 4. An unknown Vinted item: the seller picks the item, then the sale is recorded ─────────────────────────────
do $$ declare r jsonb; c jsonb; begin
  r := t.sync(jsonb_build_array(t.vo('T4', 'pending', '{9004}', 5000, 1, 'zoe',
         '[{"id":"9004","title":"Blazer Hugo Boss","brand":"Hugo Boss","size":"50","price_cents":5200}]')));
  assert (t.m('T4')).issue = 'unknown_items' and t.orders('T4') = 0;
  c := (t.m('T4')).candidates->'items'->0->'candidates';
  assert c->0->>'sku' = 'V-4', 'same brand and size proposed first: ' || c::text;
  perform public.vinted_resolve((t.m('T4')).id, 'assign_items',
    jsonb_build_object('items', jsonb_build_array(jsonb_build_object('external_id', '9004', 'item_id', t.id('V-4')))));
  assert t.orders('T4') = 1 and t.status('V-4') = 'sold' and (t.m('T4')).issue is null;
  assert (select external_id from listings where item_id = t.id('V-4') and channel = 'vinted') = '9004', 'the link is kept';
  -- read again: same sale, no duplicate
  perform t.sync(jsonb_build_array(t.vo('T4', 'pending', '{9004}', 5000, 1, 'zoe')));
  assert t.orders('T4') = 1 and t.sales_of('V-4') = 1;
end $$;
select t.expect_error(format($$select public.vinted_resolve(%L, 'assign_items', '{"items":[{"external_id":"9004","item_id":"%s"}]}')$$,
                             (t.m('T4')).id, t.id('V-5')), 'déjà liée');

-- ── 5. The « Réf. » in the description links a listing; its sale is then recorded on its own ───────────────────
do $$ declare s jsonb; begin
  s := t.wardrobe('[{"external_id":"1005","state":"active","title":"Veste laine","description":"Belle veste\nRéf. V-5","price_cents":3900,"views":12,"favourites":3},
                    {"external_id":"1001","state":"sold","title":"Blazer","views":40,"favourites":8}]');
  assert (select external_id from listings where item_id = t.id('V-5') and channel = 'vinted') = '1005', 'linked by SKU';
  assert (s->>'listing_linked')::int = 1, s::text;
  perform t.sync(jsonb_build_array(t.vo('T5', 'pending', '{1005}', 3900, 0.5)));
  assert t.orders('T5') = 1 and t.status('V-5') = 'sold';
end $$;

-- ── 6. A listing deleted then recreated on Vinted: the new one takes its place, only on a complete read ─────────
do $$ begin
  -- incomplete read: the old listing may still exist, nothing changes
  perform t.wardrobe('[{"external_id":"2006","state":"active","description":"Réf. V-6"}]', false);
  assert (select external_id from listings where item_id = t.id('V-6') and status = 'active') = '1006';
  -- complete read with both: two listings for one item, left to the seller
  perform t.wardrobe('[{"external_id":"2006","state":"active","description":"Réf. V-6"},{"external_id":"1006","state":"active"}]');
  assert (select external_id from listings where item_id = t.id('V-6') and status = 'active') = '1006';
  -- complete read, the old one is gone: replaced
  perform t.wardrobe('[{"external_id":"2006","state":"active","description":"Réf. V-6"}]');
  assert (select external_id from listings where item_id = t.id('V-6') and status = 'active') = '2006';
  assert (select status from listings where external_id = '1006') = 'delisted';
end $$;

-- ── 7. Cancelled on Vinted: the seller cancels it in Lefort OS in one click ─────────────────────────────────────
do $$ begin
  perform t.sync(jsonb_build_array(t.vo('T7', 'pending', '{1007}', 3000)));
  assert t.status('V-7') = 'sold';
  perform t.sync(jsonb_build_array(t.vo('T7', 'cancelled', '{1007}', 3000)));
  assert (t.m('T7')).issue = 'cancelled_on_vinted' and t.status('V-7') = 'sold', 'never cancelled alone';
  perform public.vinted_resolve((t.m('T7')).id, 'cancel_in_lefort');
  assert (select status from orders where external_order_id = 'T7') = 'cancelled' and t.status('V-7') = 'listed';
  perform t.sync(jsonb_build_array(t.vo('T7', 'cancelled', '{1007}', 3000)));
  assert (t.m('T7')).issue is null and t.sales_of('V-7') = 0, 'not recorded again';
end $$;

-- ── 8. Undo a sale the synchronisation recorded: it is not recorded again; « Rétablir » records it again ────────
do $$ begin
  perform t.sync(jsonb_build_array(t.vo('T8', 'pending', '{1008}', 3100)));
  assert t.status('V-8') = 'sold';
  perform public.vinted_undo(t.event('T8', 'order_imported'));
  assert t.status('V-8') = 'listing_ready' and t.sales_of('V-8') = 0 and (t.m('T8')).decision = 'ignored';
  perform t.sync(jsonb_build_array(t.vo('T8', 'pending', '{1008}', 3100)));
  assert t.sales_of('V-8') = 0, 'an undone import stays undone';
  perform public.vinted_resolve((t.m('T8')).id, 'unignore');
  assert t.sales_of('V-8') = 1 and t.orders('T8') = 1, 'back again on a new sale';
end $$;
select t.expect_error(format($$select public.vinted_undo(%L)$$, (select id from vinted_sync_events where transaction_id = 'T8' and action = 'order_imported' and undone_at is not null)), 'Déjà annulée');
select t.expect_error(format($$select public.vinted_undo(%L)$$, t.event('T1', 'order_advanced')), 'ne peut pas être annulée');

-- ── 9. A sale deleted by hand in Lefort OS is not recorded again behind the seller's back ───────────────────────
do $$ begin
  perform t.sync(jsonb_build_array(t.vo('T9', 'pending', '{1009}', 3200)));
  perform public.void_order((select id from orders where external_order_id = 'T9'), 'erreur');
  perform t.sync(jsonb_build_array(t.vo('T9', 'pending', '{1009}', 3200)));
  assert t.sales_of('V-9') = 0 and (t.m('T9')).issue = 'voided_in_lefort', (t.m('T9')).issue;
  perform public.vinted_resolve((t.m('T9')).id, 'reimport');
  assert t.sales_of('V-9') = 1 and t.orders('T9') = 1;
end $$;

-- ── 10. The item is already sold in another sale: a conflict to look at, nothing recorded ───────────────────────
do $$ begin
  perform public.record_sale(array[t.id('V-10')], 3300, now() - interval '3 days', 'vinted', 'AUTRE-REF');
  perform t.sync(jsonb_build_array(t.vo('T10', 'pending', '{1010}', 3300)));
  assert (t.m('T10')).issue = 'item_conflict' and t.orders('T10') = 0 and t.sales_of('V-10') = 1;
  assert (t.m('T10')).candidates->'items'->0->'orders'->0->>'ref' = 'AUTRE-REF', (t.m('T10')).candidates::text;
end $$;

-- ── 11. A different price: shown, and replaced by the Vinted price only when asked ──────────────────────────────
select t.put('o11', public.record_sale(array[t.id('V-11')], 6000, now() - interval '1 day', 'vinted')::text);
do $$ begin
  perform t.sync(jsonb_build_array(t.vo('T11', 'pending', '{1011}', 5000, 1)));
  assert (t.m('T11')).issue = 'price_diff' and (select gross_cents from orders where id = t.v('o11')::uuid) = 6000;
  perform public.vinted_resolve((t.m('T11')).id, 'use_vinted_price');
  assert (select status from orders where id = t.v('o11')::uuid) = 'cancelled';
  assert (select gross_cents from orders where external_order_id = 'T11' and status <> 'cancelled') = 5000 and t.sales_of('V-11') = 1;
  assert (t.m('T11')).issue is null;
end $$;

-- ── 12. In Lefort OS but not on Vinted (over the period a complete read covered), until marked as normal ────────
select t.put('o12', public.record_sale(array[t.id('V-12')], 2500, now() - interval '5 days', 'vinted')::text);
do $$ declare r jsonb; begin
  r := public.vinted_reconciliation(90);
  assert exists (select 1 from jsonb_array_elements(r->'lefort_only') x where x->>'order_id' = t.v('o12')), r->>'lefort_only';
  assert not exists (select 1 from jsonb_array_elements(r->'lefort_only') x where x->>'order_id' = t.v('o2')), 'a linked sale is not missing';
  perform public.vinted_ack_order(t.v('o12')::uuid, 'Vendu en main propre');
  r := public.vinted_reconciliation(90);
  assert not exists (select 1 from jsonb_array_elements(r->'lefort_only') x where x->>'order_id' = t.v('o12'));
end $$;

-- ── 13. A bundle with a known item and an unknown one waits ─────────────────────────────────────────────────────
do $$ begin
  perform t.sync(jsonb_build_array(t.vo('T13', 'pending', '{1013,9013}', 5000)));
  assert (t.m('T13')).issue = 'unknown_items' and t.status('V-13') = 'listed';
  assert (t.m('T13')).candidates->'known'->0->>'sku' = 'V-13';
  -- the seller creates the unknown one (sold outside the stock): one sale, two items
  perform public.vinted_resolve((t.m('T13')).id, 'create_items', '{"historical": false}');
  assert t.orders('T13') = 1 and t.status('V-13') = 'sold';
  assert (select count(*) from order_lines ol join orders o on o.id = ol.order_id where o.external_order_id = 'T13') = 2;
  assert jsonb_array_length((select detail->'created_items' from vinted_sync_events where transaction_id = 'T13' and action = 'order_imported')) = 1;
  -- undone: the sale goes, the created item is deleted, the known one is back on sale
  perform public.vinted_undo(t.event('T13', 'order_imported'));
  assert t.status('V-13') = 'listing_ready' and t.orders('T13') = 0;
  assert (select count(*) from items where notes = 'Créé par l''import des ventes' and deleted_at is null) = 0;
end $$;

-- ── 14. Missing price ───────────────────────────────────────────────────────────────────────────────────────────
do $$ begin
  perform t.sync(jsonb_build_array(t.vo('T14', 'pending', '{1014}', null)));
  assert (t.m('T14')).issue = 'missing_price' and t.status('V-14') = 'listed';
  perform t.sync(jsonb_build_array(t.vo('T14', 'pending', '{1014}', 2700)));
  assert t.orders('T14') = 1, 'recorded once the price is read';
end $$;

-- ── 15. History before the start date: never alone; recorded as history (out of the livre des recettes) ─────────
do $$ begin
  perform t.sync(jsonb_build_array(t.vo('T15', 'completed', '{1015}', 2800, 45) || jsonb_build_object('completed_at', now() - interval '40 days')));
  assert (t.m('T15')).issue = 'before_start' and t.status('V-15') = 'listed';
  perform public.vinted_resolve((t.m('T15')).id, 'import', '{"historical": true}');
  assert (select is_historical and status = 'completed' from orders where external_order_id = 'T15');
  assert not exists (select 1 from v_livre_recettes where reference = 'V-' || (select number from orders where external_order_id = 'T15'));
end $$;

-- ── 15b. An old sale typed by hand for an item without link: proposed, never recorded a second time ─────────────
select t.list('V-17', null, 2500);
select t.put('o15b', public.record_sale(array[t.id('V-17')], 2500, now() - interval '50 days', 'vinted', null, 'mamie')::text);
do $$ begin
  perform t.sync(jsonb_build_array(t.vo('T15B', 'completed', '{9915}', 2500, 50.1, 'mamie')));
  assert (t.m('T15B')).issue = 'before_start' and (t.m('T15B')).candidates->'orders'->0->>'order_id' = t.v('o15b'), (t.m('T15B')).candidates::text;
end $$;
select t.expect_error($$select public.vinted_resolve((t.m('T15B')).id, 'create_items', '{"historical": true}')$$, 'ressemble');
do $$ begin
  perform public.vinted_resolve((t.m('T15B')).id, 'link_order', jsonb_build_object('order_id', t.v('o15b')));
  assert (select external_order_id from orders where id = t.v('o15b')::uuid) = 'T15B' and (t.m('T15B')).issue is null;
end $$;

-- ── 16. An order cancelled in Lefort OS keeps its Vinted number: the Vinted sale finds it, nothing duplicated ───
do $$ begin
  perform public.cancel_order(public.record_sale(array[t.id('V-16')], 2900, now() - interval '1 day', 'vinted', 'T16'), 'test');
  perform t.sync(jsonb_build_array(t.vo('T16', 'pending', '{1016}', 2900, 1)));
  assert (t.m('T16')).issue = 'voided_in_lefort' and t.sales_of('V-16') = 0 and t.orders('T16') = 1;
end $$;

-- ── 17. Ignoring, the journal, the reading of statistics ────────────────────────────────────────────────────────
do $$ begin
  perform public.vinted_resolve((t.m('T10')).id, 'ignore', '{"note": "Doublon d''annonce"}');
  assert (t.m('T10')).decision = 'ignored' and (t.m('T10')).issue is null;
  perform t.sync(jsonb_build_array(t.vo('T10', 'pending', '{1010}', 3300)));
  assert (t.m('T10')).issue is null, 'stays ignored';
  -- statistics: one row a day, updated
  perform t.wardrobe('[{"external_id":"1005","state":"sold","views":15,"favourites":4}]');
  assert (select views from vinted_listing_stats where external_id = '1005') = 15;
  assert (select count(*) from vinted_listing_stats where external_id = '1005') = 1;
  assert (select views from vinted_listings where external_id = '1001') = 40, 'kept when a later read has no figure';
  -- the finance drill-down shows the audience of items for sale
  perform t.wardrobe('[{"external_id":"2006","state":"active","description":"Réf. V-6","views":7,"favourites":2}]');
  assert (select (r->>'views')::int = 7 and (r->>'favourites')::int = 2
            from jsonb_array_elements(public.finance_items('stock', null, null, 'cost', 200)->'rows') r where r->>'sku' = 'V-6'),
         'views in the finance list';
end $$;
select t.expect_error($$select public.vinted_resolve((t.m('T10')).id, 'link_order', '{}')$$, 'ignorée');
select t.expect_error($$select public.vinted_resolve((t.m('T1')).id, 'cancel_in_lefort')$$, 'pas annulée');
select t.expect_error($$select public.vinted_resolve((t.m('T1')).id, 'fly')$$, 'Action inconnue');

-- ── 18. Undo a listing link: never made again by the same « Réf. » ──────────────────────────────────────────────
do $$ begin
  perform t.wardrobe('[{"external_id":"3012","state":"active","description":"Réf. V-12"}]');
  assert (select external_id from listings where item_id = t.id('V-12') and channel = 'vinted') = '3012';
  perform public.vinted_undo((select id from vinted_sync_events where external_id = '3012' and action = 'listing_linked'));
  assert not exists (select 1 from listings where external_id = '3012');
  perform t.wardrobe('[{"external_id":"3012","state":"active","description":"Réf. V-12"}]');
  assert not exists (select 1 from listings where external_id = '3012'), 'refused link stays refused';
  -- the seller links it from the page instead
  perform public.vinted_link_item(t.id('V-12'), 'https://www.vinted.fr/items/3012-veste?referrer=catalog');
  assert (select external_id from listings where item_id = t.id('V-12') and status = 'active') = '3012';
end $$;
select t.expect_error(format($$select public.vinted_link_item(%L, 'pas un lien')$$, t.id('V-14')), 'Collez le lien');
select t.expect_error(format($$select public.vinted_link_item(%L, '3012')$$, t.id('V-14')), 'déjà liée à V-12');

-- ── 19. What the pages read ─────────────────────────────────────────────────────────────────────────────────────
do $$ declare s jsonb; r jsonb; k jsonb; begin
  s := public.vinted_sync_status();
  assert (s->>'open_issues')::int = (select count(*) from vinted_orders where decision is null and issue is not null and issue <> 'before_start'), s::text;
  assert s->'last_run'->>'status' = 'ok' and s->>'sync_from' = (current_date - 30)::text;
  r := public.vinted_reconciliation(90);
  assert jsonb_array_length(r->'issues') = (s->>'open_issues')::int;
  assert jsonb_typeof(r->'before_start') = 'object' and (r->>'open_issues')::int = (s->>'open_issues')::int, 'page blocks kept';
  assert (r->'matched'->>'count')::int >= 6, r->>'matched';
  assert jsonb_array_length(r->'events') > 0 and jsonb_array_length(r->'runs') > 0;
  -- statuses settled on both sides need no detail next time
  k := public.vinted_known(null);
  assert k->'settled' ? 'T1' and not (k->'settled' ? 'T2'), k::text;
end $$;
-- a finished run cannot be fed any more; a run left open is closed by the next one
select t.expect_error($$select public.vinted_reconcile((select id from vinted_sync_runs where status = 'ok' limit 1), '[]')$$, 'déjà terminée');
select t.expect_error($$select public.vinted_reconcile(public.vinted_sync_start('manual', 'orders'), (select jsonb_agg(x) from generate_series(1, 501) x))$$, 'Maximum 500');

-- ── 19b. The wardrobe import never creates an item that is already in Lefort OS ─────────────────────────────────
do $$ declare r jsonb; begin
  r := public.vinted_import('[{"external_id":"5001","state":"active","title":"Veste","description":"Superbe\nRéf. V-14"},
                              {"external_id":"5002","state":"active","title":"Manteau inconnu","price_cents":4000}]', 0);
  assert r->'skipped' = '["5001"]' and jsonb_array_length(r->'imported') = 1, r::text;
  assert (select count(*) from items where notes = 'Importé de Vinted') = 1;
  assert public.vinted_known(null)->'linked' ? '5002' and public.vinted_known(null)->'linked' ? '1001';
end $$;

-- ── 20. Rights ──────────────────────────────────────────────────────────────────────────────────────────────────
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select t.expect_error($$select public.vinted_sync_start('auto', 'orders')$$, 'non autorisée');
select t.expect_error($$select public.vinted_reconciliation(90)$$, 'non autorisée');
select t.expect_error($$select public.vinted_resolve((select id from vinted_orders limit 1), 'ignore')$$, 'non autorisée');
do $$ begin
  assert (select count(*) from vinted_orders) = 0 and (select count(*) from vinted_sync_events) = 0, 'operators see nothing';
end $$;
select t.expect_error($$insert into vinted_orders(org_id, transaction_id, state) values (public.auth_org_id(), 'X', 'pending')$$, 'permission denied');
-- another business sees nothing
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select public.bootstrap_organization('Autre boutique', 'Autre');
do $$ declare r jsonb; begin
  assert (select count(*) from vinted_orders) = 0;
  r := public.vinted_reconciliation(90);
  assert jsonb_array_length(r->'issues') = 0 and (r->'matched'->>'count')::int = 0, r::text;
end $$;

reset role;
select 'vinted sync tests passed';
