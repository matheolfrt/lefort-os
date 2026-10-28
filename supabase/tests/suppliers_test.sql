-- Suppliers: margin on what is sold (unsold stock is not a loss), sell-through in the window, rejects, rights.
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
-- test helpers: an item received N days ago and put on sale, then sold with the real function
create function t.list(p_sku text, p_days int) returns uuid language sql security definer as
  $$ update items set status = 'listed', list_price_cents = 3000, received_at = now() - make_interval(days => p_days),
            listed_at = now() - make_interval(days => p_days) where sku = p_sku returning id $$;
create function t.reject(p_sku text) returns void language sql security definer as
  $$ update items set status = 'rejected' where sku = p_sku $$;
create function t.sup(p_name text) returns jsonb language sql as
  $$ select s from jsonb_array_elements(public.supplier_stats()->'suppliers') s where s->>'name' = p_name $$;
grant usage on schema t to authenticated;
grant execute on all functions in schema t to authenticated;

insert into auth.users values ('00000000-0000-0000-0000-0000000000a1', 'admin@example.com'),
                              ('00000000-0000-0000-0000-0000000000b1', 'op@example.com');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select public.bootstrap_organization('Lefort Second Hand', 'Mathéo');
select public.add_member('op@example.com', 'operator');

-- a lot of 10 items for 200 € (20 € each): 4 sold 40 days after reception for 50 €, 1 rejected, 5 still in stock
do $$ declare v_batch uuid; r jsonb; begin
  insert into suppliers(org_id, name, country) values (public.auth_org_id(), 'Fripes & Co', 'France');
  insert into suppliers(org_id, name) values (public.auth_org_id(), 'Sans lot');
  insert into batches(org_id, code, supplier_id, purchased_at, allocation_method, created_by)
  select org_id, 'LOT-S1', id, current_date - 60, 'equal', auth.uid() from suppliers where name = 'Fripes & Co' returning id into v_batch;
  insert into batch_cost_lines(org_id, batch_id, kind, amount_cents) values (public.auth_org_id(), v_batch, 'goods', 20000);
  r := public.create_batch_skus(v_batch, 'S-', 1, 10);
  for i in 1..4 loop
    perform public.record_sale(array[t.list('S-' || i, 45)], 5000, now() - interval '5 days', 'vinted', null, null, 0);
  end loop;
  for i in 6..10 loop perform t.list('S-' || i, 45); end loop;
  perform t.reject('S-5');
end $$;

do $$ declare s jsonb := t.sup('Fripes & Co'); begin
  assert (s->>'paid_cents')::int = 20000 and (s->>'items')::int = 10 and (s->>'sold')::int = 4, s::text;
  assert (s->>'rejected')::int = 1 and (s->>'in_stock')::int = 5, s::text;
  assert (s->>'revenue_cents')::int = 20000, s::text;
  -- margin on the 4 sold: 4 × (50 − 20) = 120 €, the 5 unsold are not counted as a loss
  assert (s->>'profit_cents')::int = 12000, s::text;
  assert (s->>'stock_cost_cents')::int = 10000, s::text;
  -- sold 40 days after reception: none within the 30-day window; 9 items old enough to tell (the rejected one is not)
  assert (s->>'matured')::int = 9 and (s->>'in_time')::int = 0, s::text;
  assert (s->>'avg_days')::numeric between 39 and 41, s::text;
  assert (s->>'batches')::int = 1 and not (s->>'opening_only')::boolean, s::text;
  assert (t.sup('Sans lot')->>'batches')::int = 0, t.sup('Sans lot')::text;
end $$;

do $$ declare d jsonb := public.supplier_detail((select id from suppliers where name = 'Fripes & Co')); begin
  assert jsonb_array_length(d->'batches') = 1, d::text;
  assert (d->'batches'->0->>'sold')::int = 4 and (d->'batches'->0->>'profit_cents')::int = 12000, d::text;
  assert jsonb_array_length(d->'months') = 12, d::text;
  assert (d->'months'->11->>'sold')::int + (d->'months'->10->>'sold')::int = 4, d->'months';
  assert public.supplier_detail('00000000-0000-0000-0000-000000000000') is null;
end $$;

-- not for the team
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select t.expect_error('select public.supplier_stats()', 'réservés aux responsables');
select t.expect_error($$select public.supplier_detail((select id from suppliers limit 1))$$, 'réservés aux responsables');

reset role;
select 'suppliers tests passed';
