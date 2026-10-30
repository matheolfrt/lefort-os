-- « Mon futur local » : one plan per name and shop, read by the team, changed by managers.
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
grant usage on schema t to authenticated;
grant execute on all functions in schema t to authenticated;

insert into auth.users values ('00000000-0000-0000-0000-0000000000a1', 'admin@example.com'),
                              ('00000000-0000-0000-0000-0000000000b1', 'op@example.com'),
                              ('00000000-0000-0000-0000-0000000000c1', 'other@example.com');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select public.bootstrap_organization('Lefort Second Hand', 'Mathéo');
select public.add_member('op@example.com', 'operator');

insert into floor_plans(plan) values ('{"room": {"w": 20, "d": 10, "h": 3.5}, "shelves": []}');
select t.expect_error($$insert into floor_plans(name) values ('mon futur local')$$, 'duplicate key');
update floor_plans set plan = jsonb_set(plan, '{shelves}', '[{"x": 1, "z": 1}]');
do $$ begin assert (select jsonb_array_length(plan->'shelves') from floor_plans) = 1; end $$;

-- the team looks, does not change
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
do $$ begin assert (select count(*) from floor_plans) = 1; end $$;
update floor_plans set plan = '{}';
do $$ begin assert (select jsonb_array_length(plan->'shelves') from floor_plans) = 1, 'operators cannot change the plan'; end $$;
select t.expect_error($$insert into floor_plans(name) values ('Autre')$$, 'row-level security');

-- another shop sees nothing
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select public.bootstrap_organization('Autre boutique', 'Autre');
do $$ begin assert (select count(*) from floor_plans) = 0; end $$;
insert into floor_plans(plan) values ('{}');  -- its own « Mon futur local »: same name, other shop

reset role;
select 'floor plans tests passed';
