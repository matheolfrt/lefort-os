-- Financial Command Center: capital, stock, dormant stock, money to receive, cash ledger, drill-downs and rights,
-- on a realistic set: a lot, single and multi-item sales, a refund with a return, a cancelled order, a rejected item,
-- a deleted item, imported history, expenses and planned purchases. Every expected figure is worked out in the comments.
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
-- test helpers: an item received and put on sale N days ago at 30 €
create function t.list(p_sku text, p_days int) returns uuid language sql security definer as
  $$ update items set status = 'listed', list_price_cents = 3000, received_at = now() - make_interval(days => p_days),
            listed_at = now() - make_interval(days => p_days) where sku = p_sku returning id $$;
create function t.id(p_sku text) returns uuid language sql security definer as $$ select id from items where sku = p_sku $$;
create function t.reject(p_sku text) returns void language sql security definer as $$ update items set status = 'rejected' where sku = p_sku $$;
create table t.v(k text primary key, v uuid);
grant usage on schema t to authenticated;
grant all on all tables in schema t to authenticated;
grant execute on all functions in schema t to authenticated;

insert into auth.users values ('00000000-0000-0000-0000-0000000000a1', 'admin@example.com'),
                              ('00000000-0000-0000-0000-0000000000b1', 'op@example.com'),
                              ('00000000-0000-0000-0000-0000000000c1', 'other@example.com');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select public.bootstrap_organization('Lefort Second Hand', 'Mathéo');
select public.add_member('op@example.com', 'operator');
-- simple fees for exact numbers: 0 % + 0 €
update organizations set vinted_fee_pct = 0, vinted_fee_fixed_cents = 0;

-- Before anything: an empty business, every figure at zero, no cash known
do $$ declare o jsonb := public.finance_overview(); begin
  assert (o->'stock'->>'count')::int = 0 and (o->'stock'->>'cost_cents')::bigint = 0, o->>'stock';
  assert o->'balance' = 'null'::jsonb and o->'ledger' = 'null'::jsonb, 'no cash declared';
  assert (o->'receivable'->>'amount_cents')::bigint = 0;
  assert jsonb_array_length(o->'daily') = 0 or (select sum((d->>'items')::int) from jsonb_array_elements(o->'daily') d) = 0;
end $$;

-- A lot of 10 items for 200 € (20 € each), bought 60 days ago
do $$ declare v_batch uuid; r jsonb; v uuid; begin
  insert into suppliers(org_id, name) values (public.auth_org_id(), 'Fripes & Co');
  insert into batches(org_id, code, supplier_id, purchased_at, allocation_method, created_by)
  select org_id, 'LOT-F', id, current_date - 60, 'equal', auth.uid() from suppliers limit 1 returning id into v_batch;
  insert into batch_cost_lines(org_id, batch_id, kind, amount_cents) values (public.auth_org_id(), v_batch, 'goods', 20000);
  r := public.create_batch_skus(v_batch, 'F-', 1, 10);
  -- F-1..F-3: one sale each, 50 €, 10 days ago, paid 5 days ago
  for i in 1..3 loop
    v := public.record_sale(array[t.list('F-' || i, 40)], 5000, now() - interval '10 days', 'vinted', null, null, 0);
    perform public.ship_order(v);
    perform public.complete_order(v, now() - interval '5 days');
  end loop;
  -- F-4 + F-5: one order of two items, 100 €, 3 days ago, not paid yet → 100 € to receive
  v := public.record_sale(array[t.list('F-4', 40), t.list('F-5', 40)], 10000, now() - interval '3 days', 'vinted', null, null, 0);
  insert into t.v values ('multi', v);
  -- F-6: sold 50 €, paid, then refunded and returned to stock → no revenue, back in stock
  v := public.record_sale(array[t.list('F-6', 20)], 5000, now() - interval '8 days', 'vinted', null, null, 0);
  perform public.ship_order(v);
  perform public.complete_order(v, now() - interval '5 days');
  perform public.record_refund(v, 5000, 'Rétractation', array[t.id('F-6')]);
  -- F-7: sold then cancelled → back on sale, nothing received
  v := public.record_sale(array[t.list('F-7', 20)], 4000, now() - interval '2 days', 'vinted', null, null, 0);
  perform public.cancel_order(v, 'Acheteur injoignable');
  -- F-8 written off, F-9 deleted, F-10 on sale for 100 days (dormant)
  perform t.reject('F-8');
  perform public.delete_items(array[t.list('F-9', 10)], 'Doublon');
  perform t.list('F-10', 100);
end $$;

-- Deleting F-9 takes it out of the lot: the 200 € are shared by the 9 others (22,22 €, one at 22,23 €: F-1 and F-10).
-- Stock: F-6 (returned), F-7 (back to publish), F-10 → 3 items, 66,67 € at cost, 90 € at displayed price
-- Dormant (> 90 days): F-10 only. Written off: F-8. Deleted F-9 counted nowhere.
do $$ declare o jsonb := public.finance_overview(); s jsonb := o->'stock'; begin
  assert (s->>'count')::int = 3 and (s->>'cost_cents')::bigint = 6667, s::text;
  assert (s->>'price_cents')::bigint = 9000 and (s->>'unpriced_count')::int = 0, s::text;
  assert (s->>'dormant_count')::int = 1 and (s->>'dormant_cost_cents')::bigint = 2223, s::text;
  -- aging: 0–30 j: F-6, F-7 (20 days); 91+ j: F-10
  assert (s->'aging'->0->>'count')::int = 2 and (s->'aging'->3->>'count')::int = 1 and (s->'aging'->3->>'cost_cents')::bigint = 2223, s->>'aging';
  assert (o->'rejected'->>'count')::int = 1 and (o->'rejected'->>'cost_cents')::bigint = 2222, o->>'rejected';
  -- to receive: the unpaid two-item order only (the cancelled one never counts)
  assert (o->'receivable'->>'count')::int = 1 and (o->'receivable'->>'amount_cents')::bigint = 10000, o->>'receivable';
  -- sales of the last 30 days: F-1..F-5 = 5 items, 250 € of revenue, 111,11 € of cost; F-6 refunded, F-7 cancelled: none
  assert (o->'periods'->'current'->>'items')::int = 5, o->'periods'->>'current';
  assert (o->'periods'->'current'->>'revenue_cents')::bigint = 25000, o->'periods'->>'current';
  assert (o->'periods'->'current'->>'cogs_cents')::bigint = 11111, o->'periods'->>'current';
  assert (o->'periods'->'current'->>'gross_profit_cents')::bigint = 13889, o->'periods'->>'current';
  -- daily history: the same 5 items, no double count of the multi-item order
  assert (select sum((d->>'items')::int) from jsonb_array_elements(o->'daily') d) = 5, o->>'daily';
  assert (select sum((d->>'cogs_cents')::bigint) from jsonb_array_elements(o->'daily') d) = 11111, o->>'daily';
end $$;

-- Imported history: a sale imported as historical never counts as cash to receive
reset role;
insert into orders(org_id, channel, sold_at, gross_cents, platform_fee_cents, is_historical, status, vat_regime_at_sale)
select id, 'vinted', now() - interval '400 days', 7000, 0, true, 'pending', vat_regime from organizations;
set role authenticated;
do $$ begin
  assert (public.finance_overview()->'receivable'->>'amount_cents')::bigint = 10000;
  assert jsonb_array_length(public.finance_receivables()) = 1;
end $$;

-- Cash: a balance of 1 000 € declared 7 days ago. Since then: receipts F-1..F-3 + F-6 paid 5 days ago = 200 €,
-- the F-6 refund 50 €, a 30 € packaging expense today; the lot (60 days ago) is before the balance: not counted again.
insert into cash_balances(amount_cents, as_of, note) values (100000, now() - interval '7 days', 'Relevé');
insert into expenses(org_id, category, amount_cents, spent_on) values (public.auth_org_id(), 'packaging', 3000, current_date);
insert into expenses(org_id, category, amount_cents, spent_on) values (public.auth_org_id(), 'other', 9900, current_date - 10); -- before the balance
do $$ declare l jsonb := public.finance_overview()->'ledger'; begin
  assert (l->>'receipts_cents')::bigint = 20000, l::text;
  assert (l->>'refunds_cents')::bigint = 5000, l::text;
  assert (l->>'purchases_cents')::bigint = 0, l::text;
  assert l->'expenses_by_category' = '{"packaging": 3000}'::jsonb, l::text;
  assert (public.finance_overview()->'balance'->>'amount_cents')::bigint = 100000;
end $$;
-- the latest balance is the reference: a new one resets the ledger
insert into cash_balances(amount_cents, as_of) values (123400, now());
do $$ declare o jsonb := public.finance_overview(); begin
  assert (o->'balance'->>'amount_cents')::bigint = 123400;
  assert (o->'ledger'->>'receipts_cents')::bigint = 0 and o->'ledger'->'expenses_by_category' = '{}'::jsonb, o->>'ledger';
end $$;

-- Recurring charges and planned purchases: only what is planned, cancelled and done ones left out
insert into recurring_expenses(label, category, amount_cents, frequency, day_of_month, starts_on) values ('Loyer', 'rent', 30000, 'monthly', 5, current_date - 60);
insert into planned_purchases(label, amount_cents, due_on) values ('Lot laine', 40000, current_date + 10), ('Lot annulé', 99900, current_date + 5);
update planned_purchases set status = 'cancelled' where label = 'Lot annulé';
select t.expect_error($$insert into recurring_expenses(label, category, amount_cents, frequency, day_of_month) values ('x', 'rent', 0, 'monthly', 1)$$, 'check');
select t.expect_error($$insert into recurring_expenses(label, category, amount_cents, frequency, day_of_month) values ('x', 'rent', 100, 'daily', 1)$$, 'check');
do $$ declare o jsonb := public.finance_overview(); begin
  assert jsonb_array_length(o->'recurring') = 1 and (o->'recurring'->0->>'amount_cents')::bigint = 30000, o->>'recurring';
  assert jsonb_array_length(o->'planned') = 1 and (o->'planned'->0->>'amount_cents')::bigint = 40000, o->>'planned';
end $$;

-- Settings: thresholds move the dormant stock; nothing is hard-coded
update organizations set dead_stock_days = 15, aging_bounds = '{5,10}';
do $$ declare s jsonb := public.finance_overview()->'stock'; begin
  assert (s->>'dormant_count')::int = 3 and (s->>'dormant_cost_cents')::bigint = 6667, s::text;
  assert (public.finance_items('dormant')->>'total')::int = 3;
end $$;
update organizations set dead_stock_days = 90, aging_bounds = '{30,60}';

-- Drill-downs agree with the overview
do $$ declare i jsonb; s jsonb; begin
  i := public.finance_items('stock');
  assert (i->>'total')::int = 3 and (i->>'cost_cents')::bigint = 6667 and (i->>'price_cents')::bigint = 9000, i::text;
  i := public.finance_items('dormant');
  assert (i->>'total')::int = 1 and i->'rows'->0->>'sku' = 'F-10' and (i->'rows'->0->>'age')::int = 100, i::text;
  i := public.finance_items('active');
  assert (i->>'total')::int = 2, i::text;
  i := public.finance_items('age', 91, null);
  assert (i->>'total')::int = 1, i::text;
  i := public.finance_items('stock', null, null, 'age', 1, 1); -- page 2 of 1-item pages, oldest first
  assert (i->>'total')::int = 3 and jsonb_array_length(i->'rows') = 1, i::text;
  s := public.finance_sales(30);
  assert (s->>'total')::int = 5 and (s->>'revenue_cents')::bigint = 25000 and (s->>'gross_profit_cents')::bigint = 13889, s::text;
  -- segments: the 5 sales and the 3 items in stock, all in one "no category" segment
  s := public.finance_segments('category', 365);
  assert (s->0->>'sold')::int = 5 and (s->0->>'stock')::int = 3 and (s->0->>'revenue_cents')::bigint = 25000, s::text;
  assert (s->0->>'stock_cost_cents')::bigint = 6667 and (s->0->>'sold_cost_cents')::bigint = 11111, s::text;
  -- received 40 days ago, sold 10 days ago (3 items: 30 days) and 3 days ago (2 items: 37 days) → (90 + 74) / 5 = 32,8 days
  assert (s->0->>'timed')::int = 5 and (s->0->>'avg_days')::numeric = 32.8, s::text;
  s := public.finance_segments('platform', null);
  assert s::text like '%"vinted"%', s::text;
end $$;
select t.expect_error($$select public.finance_segments('couleur')$$, 'Axe');

-- Snapshots: one row a day, the latest call wins
select public.finance_snapshot(100000, 6000, 2000, 10000);
select public.finance_snapshot(123400, 6000, 2000, 10000);
select public.finance_snapshot(null, 6000, 2000, 10000);
do $$ begin
  assert (select count(*) from capital_snapshots) = 1;
  assert (select cash_cents from capital_snapshots) is null;
  assert jsonb_array_length(public.finance_overview()->'snapshots') = 1;
end $$;

-- price_plan feeds the drill-down recommendations: F-10 online for 100 days at 30 € → the last step (−30 %) = 21 €,
-- but that is under its cost (22,23 €): held at the floor, 24 €, never a loss
do $$ declare r jsonb := public.finance_items('dormant')->'rows'->0; begin
  assert (r->>'suggested_cents')::int = 2400 and r->>'held_by' = 'cost' and (r->>'suggest_todo')::boolean, r::text;
end $$;

-- Rights: an operator sees nothing of the money
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select t.expect_error($$select public.finance_overview()$$, 'responsables');
select t.expect_error($$select public.finance_items('stock')$$, 'responsables');
select t.expect_error($$select public.finance_sales(30)$$, 'responsables');
select t.expect_error($$select public.finance_receivables()$$, 'responsables');
select t.expect_error($$select public.finance_segments('brand')$$, 'responsables');
do $$ begin
  assert (select count(*) from cash_balances) = 0;
  assert (select count(*) from recurring_expenses) = 0;
  assert (select count(*) from planned_purchases) = 0;
  assert (select count(*) from capital_snapshots) = 0;
end $$;
select t.expect_error($$insert into cash_balances(amount_cents) values (1)$$, 'row-level security');
select public.finance_snapshot(1, 1, 1, 1); -- silently ignored
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
do $$ begin assert (select cash_cents from capital_snapshots) is null, 'the operator call changed nothing'; end $$;

-- Another business sees none of it
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select public.bootstrap_organization('Autre boutique', 'Autre');
do $$ declare o jsonb := public.finance_overview(); begin
  assert (select count(*) from cash_balances) = 0 and (select count(*) from planned_purchases) = 0;
  assert (o->'stock'->>'count')::int = 0 and o->'balance' = 'null'::jsonb and jsonb_array_length(o->'recurring') = 0, o::text;
  assert (public.finance_items('stock')->>'total')::int = 0;
end $$;
select t.expect_error($$insert into cash_balances(org_id, amount_cents) values ((select org_id from memberships where user_id = '00000000-0000-0000-0000-0000000000a1'), 1)$$, 'row-level security');

reset role;
select 'finance tests passed';
