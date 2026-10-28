-- Markdown suggestions: steps from the price it went online at, floors (minimum price, cost), waiting time after a
-- markdown, "not now", rights. Runs on a freshly migrated database.
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
-- test helper: an item online for N days at a price
create function t.online(p_sku text, p_days int, p_price bigint) returns void language sql security definer as
  $$ update items set status = 'listed', list_price_cents = p_price, received_at = now() - make_interval(days => p_days + 2),
            listed_at = now() - make_interval(days => p_days) where sku = p_sku $$;
create function t.backdate(p_sku text, p_days int) returns void language sql security definer as
  $$ update price_changes set changed_at = now() - make_interval(days => p_days) where item_id = (select id from items where sku = p_sku) $$;
create function t.s(p_sku text) returns jsonb language sql as
  $$ select s from jsonb_array_elements(public.price_suggestions()->'items') s where s->>'sku' = p_sku $$;
grant usage on schema t to authenticated;
grant execute on all functions in schema t to authenticated;
-- price_changes are append-only in the app; the test moves them back in time as the owner
alter table price_changes disable trigger price_changes_no_change;

insert into auth.users values ('00000000-0000-0000-0000-0000000000a1', 'admin@example.com'),
                              ('00000000-0000-0000-0000-0000000000b1', 'op@example.com');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select public.bootstrap_organization('Lefort Second Hand', 'Mathéo');
select public.add_member('op@example.com', 'operator');
-- simple fees for exact numbers: 0 % + 0 €, no shipping history
update organizations set vinted_fee_pct = 0, vinted_fee_fixed_cents = 0;

-- 6 items costing 10 € each (60 € lot)
do $$ declare v_batch uuid; r jsonb; begin
  insert into suppliers(org_id, name) values (public.auth_org_id(), 'Fripes & Co');
  insert into batches(org_id, code, supplier_id, purchased_at, allocation_method, created_by)
  select org_id, 'LOT-P', id, current_date - 90, 'equal', auth.uid() from suppliers limit 1 returning id into v_batch;
  insert into batch_cost_lines(org_id, batch_id, kind, amount_cents) values (public.auth_org_id(), v_batch, 'goods', 6000);
  r := public.create_batch_skus(v_batch, 'P-', 1, 6);
  perform t.online('P-1', 5, 5000);    -- too recent: nothing
  perform t.online('P-2', 20, 5000);   -- 14-day step: −10 % → 45 €
  perform t.online('P-3', 35, 5000);   -- 30-day step: −20 % → 40 €
  perform t.online('P-4', 50, 1400);   -- 45-day step: −30 % → 9,80 € → under cost + 1 € (11 €): held at 11 €
  perform t.online('P-5', 35, 5000);   -- minimum price 45 € → held at 45 €
  perform t.online('P-6', 35, 5000);   -- will be put aside
end $$;
update items set min_price_cents = 4500 where sku = 'P-5';

do $$ declare d jsonb := public.price_suggestions(); begin
  assert t.s('P-1') is null, d::text;
  assert (t.s('P-2')->>'suggested')::int = 4500 and (t.s('P-2')->>'step_pct')::int = 10, t.s('P-2')::text;
  assert (t.s('P-3')->>'suggested')::int = 4000 and t.s('P-3')->>'held_by' is null, t.s('P-3')::text;
  assert (t.s('P-4')->>'suggested')::int = 1100 and t.s('P-4')->>'held_by' = 'cost', t.s('P-4')::text;
  assert (t.s('P-4')->>'margin')::int = 100, t.s('P-4')::text;
  assert (t.s('P-5')->>'suggested')::int = 4500 and t.s('P-5')->>'held_by' = 'min_price', t.s('P-5')::text;
  assert (d->>'listed')::int = 6, d::text;
end $$;

-- apply P-3: no new suggestion while waiting (7 days), then the next step counts from the price it went online at
update items set list_price_cents = 4000 where sku = 'P-3';
do $$ begin
  assert t.s('P-3') is null;
  assert (public.price_suggestions()->>'waiting')::int = 0; -- 40 € is the 30-day target: nothing more to do
  assert jsonb_array_length(public.price_suggestions()->'recent') = 1;
end $$;
select t.backdate('P-3', 20);
select t.online('P-3', 50, 4000);
do $$ begin
  -- 45-day step: −30 % of 50 € (the price it went online at, not of 40 €) = 35 €
  assert (t.s('P-3')->>'suggested')::int = 3500 and (t.s('P-3')->>'start_price')::int = 5000, t.s('P-3')::text;
end $$;
-- a markdown 2 days ago holds the next one back
update items set list_price_cents = 4800 where sku = 'P-2';
do $$ begin
  assert t.s('P-2') is null;
  assert (public.price_suggestions()->>'waiting')::int >= 0;
end $$;

-- a markdown cancelled right away (price put back) neither holds the item back nor counts as "lowered this week"
update items set list_price_cents = 4500 where sku = 'P-6';
update items set list_price_cents = 5000 where sku = 'P-6';
do $$ begin
  assert t.s('P-6') is not null, 'cancelled markdown still holds the item back';
  assert not exists (select 1 from jsonb_array_elements(public.price_suggestions()->'recent') r where r->>'sku' = 'P-6');
end $$;

-- "not now"
insert into price_skips(item_id, until) select id, current_date + 7 from items where sku = 'P-6';
do $$ begin
  assert t.s('P-6') is null;
  assert (public.price_suggestions()->>'skipped')::int = 1;
end $$;
update price_skips set until = current_date - 1;
do $$ begin assert t.s('P-6') is not null; end $$;

-- the rules are the organisation's
update organizations set price_steps = '[{"days": 3, "pct": 5}]';
do $$ begin assert (t.s('P-1')->>'suggested')::int = 4800, t.s('P-1')::text; end $$;

-- not for the team
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select t.expect_error('select public.price_suggestions()', 'réservés aux responsables');
do $$ begin
  insert into price_skips(item_id, until) select id, current_date from items where sku = 'P-1';
  raise exception 'operator could put a suggestion aside';
exception when insufficient_privilege then null;
end $$;

reset role;
select 'pricing tests passed';
