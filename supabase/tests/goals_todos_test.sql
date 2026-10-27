-- Objectives and to-dos: rights, progress figures, repeating to-dos. Runs on a freshly migrated database.
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
-- test helpers: put an item on sale directly, then sell it with the real function
create function t.list(p_sku text) returns uuid language sql security definer as
  $$ update items set status = 'listed', list_price_cents = 3000, listed_at = now() where sku = p_sku returning id $$;
create function t.sell(p_sku text, p_cents bigint, p_at timestamptz) returns void language plpgsql as $$
begin perform public.record_sale(array[t.list(p_sku)], p_cents, p_at); end $$;
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

do $$ declare v_batch uuid; r jsonb; begin
  insert into suppliers(org_id, name) values (public.auth_org_id(), 'Fripes & Co');
  insert into batches(org_id, code, supplier_id, purchased_at, allocation_method, created_by)
  select org_id, 'LOT-G', id, current_date, 'equal', auth.uid() from suppliers limit 1 returning id into v_batch;
  insert into batch_cost_lines(org_id, batch_id, kind, amount_cents) values (public.auth_org_id(), v_batch, 'goods', 5000);
  r := public.create_batch_skus(v_batch, 'G-', 1, 6);
  perform t.sell('G-1', 4000, now());
  perform t.sell('G-2', 2500, now());
  perform t.sell('G-3', 3000, now() - interval '400 days'); -- too old for any period
end $$;

-- ── objectives
do $$ declare p jsonb; begin
  perform public.set_goal('month', 'revenue', 600000);
  perform public.set_goal('day', 'sales', 5);
  perform public.set_goal('day', 'listed', 10);
  perform public.set_goal('day', 'listed', 12); -- replaces
  perform public.set_goal('day', 'listed', null); -- removes
  assert (select count(*) from goals) = 2, (select jsonb_agg(goals) from goals)::text;
  p := public.goal_progress();
  assert (p->>'manager')::boolean, p::text;
  assert (p->'periods'->'day'->>'sales')::int = 2 and (p->'periods'->'day'->>'revenue_cents')::bigint = 6500, p::text;
  assert (p->'periods'->'year'->>'sales')::int >= 2 and (p->'periods'->'month'->>'revenue_cents')::bigint >= 6500, p::text;
  assert jsonb_array_length(p->'days') = 30 and (p->'days'->29->>'sales')::int = 2, p::text;
  assert jsonb_array_length(p->'goals') = 2, p::text;
  perform public.set_goal('day', 'sales', 0); -- zero removes too
  assert (select count(*) from goals) = 1;
  perform public.set_goal('day', 'sales', 5);
end $$;

-- the team sees the item counts, not the money
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
do $$ declare p jsonb; begin
  p := public.goal_progress();
  assert not (p->>'manager')::boolean and p->'periods'->'day'->'revenue_cents' = 'null'::jsonb, p::text;
  assert (p->'periods'->'day'->>'sales')::int = 2, p::text;
  assert jsonb_array_length(p->'goals') = 1 and p->'goals'->0->>'metric' = 'sales', p::text;
  assert (select count(*) from goals) = 1; -- RLS: the revenue objective is not visible
  perform t.expect_error($q$ select public.set_goal('day', 'sales', 3) $q$, 'réservés aux responsables');
  perform t.expect_error($q$ insert into goals(org_id, period, metric, target) values (public.auth_org_id(), 'week', 'sales', 3) $q$, 'row-level security');
end $$;

-- ── to-dos
-- the operator: for themselves or the team, not for someone else
do $$ declare v uuid; begin
  insert into todos(title, due_on) values ('Ranger l''atelier', current_date);
  insert into todos(title, assigned_to) values ('Mes photos', auth.uid());
  perform t.expect_error($q$ insert into todos(title, assigned_to) values ('Pour Mathéo', '00000000-0000-0000-0000-0000000000a1') $q$, 'row-level security');
  assert (select count(*) from todos) = 2;
  assert (select org_id from todos limit 1) = public.auth_org_id();
end $$;

-- the manager gives one to the photographer and makes it weekly
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
do $$ declare v uuid; v_next uuid; v_today date := (now() at time zone 'Europe/Paris')::date; begin
  insert into todos(title, assigned_to, repeat, due_on) values ('Photos du lundi', '00000000-0000-0000-0000-0000000000b2', 'weekly', v_today - 14)
  returning id into v;
  -- done: comes back the next date after today, on the same weekday
  v_next := public.complete_todo(v);
  assert v_next is not null;
  assert (select due_on from todos where id = v_next) = v_today + 7, (select due_on from todos where id = v_next)::text;
  assert (select done_at is not null and done_by = auth.uid() from todos where id = v);
  assert (select assigned_to from todos where id = v_next) = '00000000-0000-0000-0000-0000000000b2';
  -- ticking twice does nothing
  assert public.complete_todo(v) is null;
  assert (select count(*) from todos where repeated_from = v) = 1;
  -- untick: the next occurrence goes away
  perform public.reopen_todo(v);
  assert (select done_at is null from todos where id = v);
  assert (select count(*) from todos where repeated_from = v) = 0;
  -- done early (due next week): comes back the week after, not on the same date
  insert into todos(title, repeat, due_on) values ('Compta', 'weekly', v_today + 3) returning id into v;
  v_next := public.complete_todo(v);
  assert (select due_on from todos where id = v_next) = v_today + 10, (select due_on from todos where id = v_next)::text;
  -- monthly on the 31st: the next month has fewer days
  insert into todos(title, repeat, due_on) values ('Fin de mois', 'monthly', date '2020-01-31') returning id into v;
  v_next := public.complete_todo(v);
  assert (select due_on from todos where id = v_next) > v_today;
  -- a one-off: no next
  insert into todos(title) values ('Acheter du scotch') returning id into v;
  assert public.complete_todo(v) is null;
  -- a daily one without a date comes back tomorrow
  insert into todos(title, repeat) values ('Publier 20 articles', 'daily') returning id into v;
  v_next := public.complete_todo(v);
  assert (select due_on from todos where id = v_next) = v_today + 1;
end $$;

-- the photographer: ticks what is theirs, cannot delete what they did not create, cannot touch someone else's
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
do $$ declare v uuid; begin
  select id into v from todos where title = 'Photos du lundi' and done_at is null;
  assert public.complete_todo(v) is not null;
  perform public.reopen_todo(v);
  delete from todos where id = v;
  assert exists (select 1 from todos where id = v); -- RLS: not deleted
  select id into v from todos where title = 'Mes photos';
  update todos set title = 'Volé' where id = v;
  assert (select title from todos where id = v) = 'Mes photos'; -- RLS: not changed
  perform t.expect_error(format('select public.reopen_todo(%L)', v), 'non modifiable');
end $$;

reset role;
select 'goals & todos tests passed';

