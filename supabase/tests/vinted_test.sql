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

-- an outsider reaches nothing
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select t.expect_error($$select public.vinted_sync_preview('[]')$$, 'aucun compte actif');
reset role;
