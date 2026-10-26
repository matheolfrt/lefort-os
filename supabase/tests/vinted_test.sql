-- Vinted import & resync. Runs on a freshly migrated database (independent of domain_test.sql).
\set ON_ERROR_STOP 1
set client_min_messages = warning;
create schema t;
create table t.ctx (k text primary key, v text);
create function t.v(k text) returns uuid language sql as $$ select v::uuid from t.ctx where ctx.k = $1 $$;
create function t.put(k text, v text) returns void language sql as
  $$ insert into t.ctx values ($1, $2) on conflict (k) do update set v = excluded.v $$;
create function t.expect_error(sql text, fragment text) returns void language plpgsql as $$
begin
  execute sql;
  raise exception 'Expected error containing "%" but statement succeeded: %', fragment, sql;
exception when others then
  if position(fragment in sqlerrm) = 0 then raise exception 'Expected error containing "%", got "%"', fragment, sqlerrm; end if;
end $$;
grant usage on schema t to authenticated;
grant select, insert, update on t.ctx to authenticated;
grant execute on all functions in schema t to authenticated;

insert into auth.users values ('00000000-0000-0000-0000-0000000000a1', 'admin@example.com'),
                              ('00000000-0000-0000-0000-0000000000b1', 'op@example.com');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select t.put('org', public.bootstrap_organization('Lefort Second Hand', 'Admin')::text);
select public.add_member('op@example.com', 'operator');

create temp table snap as select $j$[
  {"external_id":"111","url":"https://www.vinted.fr/items/111-blazer","title":"Blazer Hugo Boss laine T50","price_cents":5500,
   "brand":"hugo boss","size":"50","condition":"very_good","state":"active","photos":["https://images1.vinted.net/a.jpg"]},
  {"external_id":"222","title":"Costume Zegna gris","price_cents":18900,"brand":"Ermenegildo Zegna","size":"52","condition":"good","state":"reserved"},
  {"external_id":"333","title":"Manteau camel","price_cents":9000,"brand":"Marque Inconnue X","size":"L","state":"active"},
  {"external_id":"444","title":"Vieux pantalon","price_cents":1500,"state":"sold"}
]$j$::jsonb as j;
grant select on snap to authenticated;

-- operators may preview but not import (import creates a batch and costs)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
do $$ declare p jsonb; begin
  p := public.vinted_sync_preview((select j from snap));
  assert jsonb_array_length(p->'new') = 3 and (p->>'sold_history_ignored')::int = 1, p::text;
end $$;
select t.expect_error($$select public.vinted_import((select j from snap), 2000)$$, 'non autorisée');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
do $$ declare r jsonb; begin
  r := public.vinted_import((select j from snap), 2000);
  assert jsonb_array_length(r->'imported') = 3, r::text;
  assert (r->'imported'->0->'photos'->>0) = 'https://images1.vinted.net/a.jpg';
  perform t.put('batch', r->>'batch_id');
end $$;
do $$ begin
  assert (select count(*) from items) = 3;
  assert (select i.status from items i join listings l on l.item_id = i.id where l.external_id = '222') = 'reserved';
  assert (select c.name from items i join listings l on l.item_id = i.id join categories c on c.id = i.category_id where l.external_id = '111') = 'Blazer';
  assert (select c.name from items i join listings l on l.item_id = i.id join categories c on c.id = i.category_id where l.external_id = '222') = 'Costume';
  assert (select b.name from items i join listings l on l.item_id = i.id join brands b on b.id = i.brand_id where l.external_id = '111') = 'Hugo Boss', 'brand matched case-insensitively';
  assert exists (select 1 from brands where name = 'Marque Inconnue X'), 'unknown brand created';
  assert (select code from locations l join items i on i.current_location_id = l.id limit 1) = 'EMP-A-ETIQUETER';
  assert (select sum(allocated_cost_cents) from item_costs) = 6000, 'estimated cost 3 × 20 €';
  assert (select count(*) from v_registre_achats) = 0, 'opening stock stays out of the purchase register';
end $$;

-- importing again changes nothing
do $$ begin
  assert jsonb_array_length(public.vinted_import((select j from snap), 2000)->'imported') = 0;
  assert (select count(*) from items) = 3;
end $$;

-- next sync: 111 sold on Vinted, 222 no longer reserved and cheaper, 333 deleted from Vinted, 555 new
update snap set j = $j$[
  {"external_id":"111","title":"Blazer Hugo Boss laine T50","price_cents":5500,"state":"sold"},
  {"external_id":"222","title":"Costume Zegna gris","price_cents":17500,"state":"active"},
  {"external_id":"555","title":"Gilet Brice","price_cents":1200,"state":"active"}
]$j$::jsonb;
do $$ declare p jsonb; r jsonb; begin
  p := public.vinted_sync_preview((select j from snap));
  assert p->'new' = '["555"]'::jsonb, p::text;
  assert jsonb_array_length(p->'sold_on_vinted') = 1 and (p->'sold_on_vinted'->0->>'price_cents')::int = 5500, p::text;
  assert jsonb_array_length(p->'price_changes') = 1 and (p->'price_changes'->0->>'new_cents')::int = 17500, p::text;
  assert p->'reservation_changes'->0->>'to' = 'listed', p::text;
  assert jsonb_array_length(p->'missing_on_vinted') = 1, p::text;
  assert jsonb_array_length(public.vinted_sync_preview((select j from snap), false)->'missing_on_vinted') = 0, 'partial snapshot never reports deletions';

  r := public.vinted_apply_updates((select j from snap));
  assert (r->>'prices_updated')::int = 1 and (r->>'reservations_updated')::int = 1, r::text;
  assert (select i.status from items i join listings l on l.item_id = i.id where l.external_id = '222') = 'listed';
  assert (select i.list_price_cents from items i join listings l on l.item_id = i.id where l.external_id = '222') = 17500;
  assert (select count(*) from price_changes) = 1, 'price change is recorded in history';

  -- recording the Vinted sale uses the normal sale flow
  perform public.record_sale(array[(p->'sold_on_vinted'->0->>'item_id')::uuid], 5500);
  assert jsonb_array_length(public.vinted_sync_preview((select j from snap))->'sold_on_vinted') = 0;
end $$;

-- imported without a date: a later sync that knows the photo date corrects the age
do $$ declare p jsonb; r jsonb; v_snap jsonb := $j$[
  {"external_id":"222","title":"Costume Zegna gris","price_cents":17500,"state":"active","listed_at":"2026-01-15T10:00:00Z"}
]$j$; begin
  p := public.vinted_sync_preview(v_snap, false);
  assert jsonb_array_length(p->'date_fixes') = 1, p::text;
  r := public.vinted_apply_updates(v_snap);
  assert (r->>'dates_updated')::int = 1, r::text;
  assert (select i.listed_at from items i join listings l on l.item_id = i.id where l.external_id = '222') = '2026-01-15T10:00:00Z';
  assert (select i.received_at from items i join listings l on l.item_id = i.id where l.external_id = '222') = '2026-01-15T10:00:00Z';
  assert jsonb_array_length(public.vinted_sync_preview(v_snap, false)->'date_fixes') = 0, 'fixed once';
end $$;

-- bulk actions from the Stock list
do $$ declare ids uuid[]; r jsonb; begin
  select array_agg(i.id order by i.sku) into ids from items i where i.status in ('listed', 'reserved', 'sold');
  -- sold item is refused, the others go back to "prêt à publier" and their Vinted listing is closed
  r := public.bulk_transition(ids, 'listing_ready');
  assert (r->>'updated')::int = 2 and jsonb_array_length(r->'errors') = 1, r::text;
  assert r->'errors'->0->>'error' like 'Article vendu%', r::text;
  assert not exists (select 1 from listings l join items i on i.id = l.item_id
                      where i.status = 'listing_ready' and l.status in ('active', 'reserved'));
  r := public.bulk_transition(ids, 'on_hold', '{"hold_reason":"cleaning"}');
  assert (r->>'updated')::int = 2, r::text;
  r := public.bulk_transition(ids, null);
  assert (r->>'updated')::int = 2 and (select count(*) from items where status = 'on_hold') = 0, r::text;
  r := public.bulk_move(ids, 'emp-a-01-01');
  assert (r->>'updated')::int = 3, r::text;
end $$;
select t.expect_error($$select public.bulk_transition(array[gen_random_uuid()], 'sold')$$, 'Ventes');
select t.expect_error($$select public.transition_item((select id from items where status = 'sold' limit 1), 'listing_ready')$$, 'Article vendu');
select t.expect_error($$select public.bulk_move(array[gen_random_uuid()], 'EMP-NOPE')$$, 'inconnu');

-- CSV import: create, update, refuse
do $$ declare r jsonb; v_n int; begin
  r := public.import_items($j$[
    {"sku":"IMP-001","category":"blazer","brand":"Hugo Boss","size":"50","condition":"good","color":"bleu marine",
     "title":"Blazer Boss","price_cents":4500,"min_price_cents":4000,"status":"listed",
     "vinted_url":"https://www.vinted.fr/items/7777-blazer","cost_cents":1500},
    {"category":"Costume","title":"Costume gris","status":"received"},
    {"sku":"IMP-003","title":"Mauvais statut","status":"Vendu"},
    {"sku":"IMP-004","title":"Prix incohérent","price_cents":1000,"min_price_cents":2000}
  ]$j$);
  assert (r->>'created')::int = 2 and jsonb_array_length(r->'errors') = 2, r::text;
  assert (select kind from batches where id = (r->>'batch_id')::uuid) = 'opening_stock';
  assert (select i.status from items i where sku = 'IMP-001') = 'listed';
  assert (select external_id from listings l join items i on i.id = l.item_id where i.sku = 'IMP-001') = '7777';
  assert (select allocated_cost_cents from item_costs ic join items i on i.id = ic.item_id where i.sku = 'IMP-001') = 1500;
  assert (select c.name from items i join categories c on c.id = i.category_id where i.sku = 'IMP-001') = 'Blazer';
  assert (select code from locations l join items i on i.current_location_id = l.id where i.sku = 'IMP-001') = 'EMP-A-ETIQUETER';

  -- known SKU: skipped unless update requested, then field by field
  r := public.import_items('[{"sku":"imp-001","price_cents":3900,"size":""}]');
  assert (r->'rows'->0->>'action') = 'skipped', r::text;
  r := public.import_items('[{"sku":"imp-001","price_cents":3900,"min_price_cents":3500,"size":"","location":"EMP-A-01-02"}]', null, true);
  assert (r->'rows'->0->>'action') = 'updated' and r->>'batch_id' is null, r::text;
  assert (select list_price_cents from items where sku = 'IMP-001') = 3900;
  assert (select size_label from items where sku = 'IMP-001') = '50', 'empty cell keeps value';
  assert (select price_cents from listings l join items i on i.id = l.item_id where i.sku = 'IMP-001') = 3900;
  assert (select code from locations l join items i on i.current_location_id = l.id where i.sku = 'IMP-001') = 'EMP-A-01-02';

  -- round trip: sold items and unknown status labels on existing items are left alone
  r := public.import_items(jsonb_build_array(jsonb_build_object('sku', (select sku from items where status = 'sold' limit 1), 'status', 'Vendu', 'price_cents', 1)), null, true);
  assert (r->'rows'->0->>'action') = 'skipped' and jsonb_array_length(r->'errors') = 0, r::text;
  r := public.import_items('[{"sku":"imp-001","status":"En ligne","cost_cents":1500}]', null, true);
  assert jsonb_array_length(r->'errors') = 0, r::text;

  -- an import with only failures leaves no empty batch behind
  select count(*) into v_n from batches;
  r := public.import_items('[{"sku":"BAD SKU!","title":"x"}]');
  assert (r->>'created')::int = 0 and (select count(*) from batches) = v_n, r::text;
end $$;

-- delete / restore
do $$ declare r jsonb; v_sold uuid; v_item uuid; begin
  select id into v_item from items where sku = 'IMP-001';
  select item_id into v_sold from order_lines limit 1;
  r := public.delete_items(array[v_item, v_sold], 'Doublon');
  assert (r->>'updated')::int = 1 and jsonb_array_length(r->'errors') = 1, r::text;
  assert (select deleted_at is not null from items where id = v_item);
  assert (select status from listings where item_id = v_item) = 'delisted';
  assert (select count(*) from v_pipeline p where p.items > 0) >= 0;
  -- a deleted Vinted item is not proposed for import again
  assert public.vinted_sync_preview('[{"external_id":"7777","state":"active","title":"x","price_cents":3900}]', false)->'new' = '[]'::jsonb;
  -- importing its SKU again is refused
  assert jsonb_array_length(public.import_items('[{"sku":"IMP-001"}]', null, true)->'errors') = 1;
  r := public.restore_items(array[v_item]);
  assert (r->>'updated')::int = 1 and (select deleted_at is null from items where id = v_item);
  assert (select status from items where id = v_item) = 'listing_ready', 'a restored item goes back to listing';
  assert (select count(*) from item_events where item_id = v_item and type in ('deleted', 'restored')) = 2;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select t.expect_error($$select public.delete_items(array[(select id from items limit 1)])$$, 'non autorisée');
select t.expect_error($$select public.import_items('[]')$$, 'non autorisée');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);

-- sales import, including items never in stock
do $$ declare r jsonb; v_n int; v_ledger int; v_o uuid; begin
  select count(*) into v_ledger from v_livre_recettes;
  r := public.import_sales($j$[
    {"sold_at":"2025-03-10T12:00:00Z","paid_at":"2025-03-13T12:00:00Z","buyer":"jean","order_ref":"V-H1","shipping_cents":0,
     "lines":[{"sku":"","title":"Blazer Hugo Boss bleu","brand":"Hugo Boss","size":"50","price_cents":4500,"cost_cents":1200,
               "vinted_url":"https://www.vinted.fr/items/9191-blazer"}]},
    {"sold_at":"2025-03-11T12:00:00Z","lines":[{"sku":"HIST-01","title":"Costume gris","price_cents":6000},
                                              {"sku":"imp-001","price_cents":2000}]},
    {"lines":[{"sku":"HIST-02","title":"Sans prix"}]},
    {"lines":[{"sku":"BAD SKU!","price_cents":100}]}
  ]$j$, true, 'completed');
  assert (r->>'orders')::int = 2 and (r->>'items_created')::int = 2 and jsonb_array_length(r->'errors') = 2, r::text;
  assert (select count(*) from v_livre_recettes) = v_ledger, 'historical sales stay out of the ledger';
  select id into v_o from orders where external_order_id = 'V-H1';
  assert (select status from orders where id = v_o) = 'completed';
  assert (select is_historical and paid_at = '2025-03-13T12:00:00Z' from orders where id = v_o);
  assert (select cost_snapshot_cents from order_lines where order_id = v_o) = 1200;
  assert (select l.status from listings l where external_id = '9191') = 'sold';
  assert (select b.kind from items i join batches b on b.id = i.batch_id where i.sku = 'HIST-01') = 'opening_stock';
  assert (select sale_price_cents from order_lines ol join items i on i.id = ol.item_id where i.sku = 'HIST-01') = 6000;
  assert (select status from items where sku = 'IMP-001') = 'completed';
  assert (select days_to_sell is null from v_item_economics e join items i on i.id = e.item_id where i.sku = 'HIST-01');
  -- an item already sold cannot be sold again, and a failed-only import leaves no batch behind
  select count(*) into v_n from batches;
  r := public.import_sales('[{"lines":[{"sku":"HIST-01","price_cents":100}]},{"lines":[{"sku":"BAD SKU!","price_cents":100}]},
                             {"order_ref":"V-H1","lines":[{"sku":"","price_cents":4500}]},
                             {"lines":[{"sku":"","title":"x","price_cents":4500,"vinted_url":"https://www.vinted.fr/items/9191-blazer"}]}]', true);
  assert (r->>'orders')::int = 0 and jsonb_array_length(r->'errors') = 4 and r->'errors'->2->>'error' like '%déjà enregistrée%'
     and r->'errors'->3->>'error' like '%pas en vente%' and (select count(*) from batches) = v_n, r::text;
  -- sales to account for, still to ship
  r := public.import_sales('[{"sold_at":"2025-04-01T10:00:00Z","lines":[{"sku":"HIST-03","price_cents":3000}]}]', false, 'pending');
  assert (r->>'orders')::int = 1, r::text;
  assert (select o.status = 'pending' and not o.is_historical from orders o join order_lines ol on ol.order_id = o.id
            join items i on i.id = ol.item_id where i.sku = 'HIST-03');
  assert (select code from locations l join items i on i.current_location_id = l.id where i.sku = 'HIST-03') = 'EMP-A-ETIQUETER';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select t.expect_error($$select public.import_sales('[]', true)$$, 'non autorisée');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);

-- an outsider reaches nothing
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select t.expect_error($$select public.vinted_sync_preview('[]')$$, 'aucun compte actif');
reset role;
