-- What an employee with the « Opérateur » role can read and change: no purchase cost, margin, expense or cash figure,
-- no change to the company, the team, the lots or their costs. Guards the promise made in Paramètres → Équipe.
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
create function t.cost(p_sku text) returns bigint language sql security definer as
  $$ select ic.allocated_cost_cents from item_costs ic join items i on i.id = ic.item_id where i.sku = p_sku $$;
create function t.lot(p_code text) returns bigint language sql security definer as
  $$ select coalesce((select sum(amount_cents) from batch_cost_lines l join batches b on b.id = l.batch_id where b.code = p_code), 0)
          + coalesce((select sum(amount_cents) from batch_cost_adjustments a join batches b on b.id = a.batch_id where b.code = p_code), 0) $$;
create function t.ids(variadic p text[]) returns jsonb language sql security definer as
  $$ select jsonb_agg(id) from items where sku = any(p) $$;
grant usage on schema t to authenticated;
grant execute on all functions in schema t to authenticated;

insert into auth.users values ('00000000-0000-0000-0000-0000000000a1', 'admin@example.com'),
                              ('00000000-0000-0000-0000-0000000000b1', 'op@example.com');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select public.bootstrap_organization('Lefort Second Hand', 'Mathéo');
select public.add_member('op@example.com', 'operator');
-- lot A (open): 80 € for 4 items → 20 € each; lot B (closed): 30 € for 3 items → 10 € each
do $$ declare v_a uuid; v_b uuid; r jsonb; begin
  insert into suppliers(org_id, name) values (public.auth_org_id(), 'Grossiste');
  insert into batches(org_id, code, supplier_id, purchased_at, allocation_method, created_by)
  select org_id, 'LOT-A', id, current_date, 'equal', auth.uid() from suppliers limit 1 returning id into v_a;
  insert into batch_cost_lines(org_id, batch_id, kind, amount_cents) values (public.auth_org_id(), v_a, 'goods', 8000);
  r := public.create_batch_skus(v_a, 'A-', 1, 4);
  insert into batches(org_id, code, supplier_id, purchased_at, allocation_method, created_by)
  select org_id, 'LOT-B', id, current_date, 'equal', auth.uid() from suppliers limit 1 returning id into v_b;
  insert into batch_cost_lines(org_id, batch_id, kind, amount_cents) values (public.auth_org_id(), v_b, 'goods', 3000);
  r := public.create_batch_skus(v_b, 'B-', 1, 3);
end $$;
do $$ begin assert t.cost('A-1') = 2000 and t.cost('B-1') = 1000, 'starting costs'; end $$;

reset role;
update items set status = 'listed', list_price_cents = 4000 where sku in ('A-1', 'A-2');
set role authenticated;
select public.record_sale(array[(select id from items where sku = 'A-1')], 4000);
reset role;
insert into expenses(org_id, category, amount_cents, spent_on) select id, (select enum_range(null::expense_category))[1], 1234, current_date from organizations;
insert into cash_balances(org_id, amount_cents) select id, 50000 from organizations;
insert into audit_log(org_id, table_name, row_id, action, new_row) select id, 'item_costs', 'x', 'UPDATE', '{"allocated_cost_cents": 2000}' from organizations;

-- ── the operator reads: no money ──
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
do $$ declare t text; n bigint; begin
  foreach t in array array['item_costs', 'batch_cost_lines', 'batch_cost_adjustments', 'expenses', 'recurring_expenses',
    'cash_balances', 'planned_purchases', 'capital_snapshots', 'audit_log', 'v_item_economics', 'v_livre_recettes', 'v_monthly_turnover'] loop
    execute format('select count(*) from public.%I', t) into n;
    assert n = 0, format('operator reads %s rows of %s', n, t);
  end loop;
  assert (select count(*) from items) = 7, 'the stock itself stays visible (work needs it)';
  assert (select coalesce(sum(total_cost_cents), 0) + coalesce(sum(revenue_cents), 0) from v_batch_economics) = 0, 'lot economics without figures';
  assert (select coalesce(sum(profit_cents), 0) from v_batch_profitability) = 0, 'no lot profit';
  assert (select coalesce(sum(total_cost_cents), 0) + coalesce(sum(profit_cents), 0) from v_supplier_profitability) = 0, 'no supplier profit';
  assert (select coalesce(sum(cost_cents), 0) + coalesce(sum(recovered_cents), 0) from v_lot_payback) = 0, 'no payback figures';
  assert (select coalesce(sum(montant_cents), 0) from v_registre_achats) = 0, 'no purchase amounts';
end $$;

-- ── the operator changes: nothing outside the daily work ──
do $$ declare n int; begin
  update organizations set vinted_fee_pct = 99; get diagnostics n = row_count; assert n = 0, 'company settings';
  update batch_cost_lines set amount_cents = 1; get diagnostics n = row_count; assert n = 0, 'lot costs';
  update suppliers set name = 'Z'; get diagnostics n = row_count; assert n = 0, 'suppliers';
end $$;
select t.expect_error($$select public.add_member('op@example.com', 'admin')$$, 'non autorisée');
select t.expect_error($$select public.set_member('00000000-0000-0000-0000-0000000000b1', 'admin', true)$$, 'non autorisée');
select t.expect_error($$update memberships set role = 'admin'$$, 'permission denied');
select t.expect_error($$delete from items where sku = 'A-3'$$, 'permission denied');
select t.expect_error($$delete from batches$$, 'permission denied');
select t.expect_error($$insert into expenses(org_id, category, amount_cents, spent_on) select org_id, (select enum_range(null::expense_category))[1], 1, current_date from memberships limit 1$$, 'row-level security');
select t.expect_error($$insert into tax_rates(org_id, kind, rate_pct, valid_from) select org_id, 'cfp', 1, current_date from memberships limit 1$$, 'row-level security');

-- ── and the manager still sees everything ──
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
do $$ begin
  assert (select count(*) from item_costs) = 7 and (select count(*) from expenses) = 1, 'manager reads the money';
  assert (select vinted_fee_pct from organizations) <> 99, 'company settings untouched';
end $$;
select 'operator access tests passed';
