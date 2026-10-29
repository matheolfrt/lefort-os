-- Products spotted at a supplier: link + reference, managers only, never across shops. Runs on a freshly migrated database.
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
insert into suppliers(org_id, name) values (public.auth_org_id(), 'Grossiste Milan');

-- a link with its reference, a price seen and a note
insert into supplier_products(supplier_id, url, reference, price_cents, note)
values ((select id from suppliers where name = 'Grossiste Milan'), 'https://grossiste.example/blazers/12345', 'Blazer laine Boss 12345', 1800, 'Taille 50 surtout');
do $$ begin
  assert (select count(*) from supplier_products) = 1;
  assert (select created_by = auth.uid() and org_id = public.auth_org_id() from supplier_products);
end $$;
-- a link must be a web address
select t.expect_error($$insert into supplier_products(supplier_id, url) values ((select id from suppliers limit 1), 'javascript:alert(1)')$$, 'check');
select t.expect_error($$insert into supplier_products(supplier_id, url) values ((select id from suppliers limit 1), 'pas un lien')$$, 'check');

-- the team does not see supplier prices
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
do $$ begin assert (select count(*) from supplier_products) = 0, 'operators see nothing'; end $$;
select t.expect_error($$insert into supplier_products(supplier_id, url) values ((select id from suppliers limit 1), 'https://x.example')$$, 'row-level security');

-- another shop sees nothing and cannot attach a link to this supplier
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select public.bootstrap_organization('Autre boutique', 'Autre');
do $$ begin assert (select count(*) from supplier_products) = 0; end $$;
reset role;
create temp table s as select id from suppliers where name = 'Grossiste Milan';
grant select on s to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select t.expect_error($$insert into supplier_products(supplier_id, url) values ((select id from s), 'https://x.example')$$, 'row-level security');

-- deleting the supplier's link, then the supplier takes its links with it
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
delete from supplier_products where reference = 'Blazer laine Boss 12345';
do $$ begin assert (select count(*) from supplier_products) = 0; end $$;
reset role;
insert into supplier_products(org_id, supplier_id, url) select org_id, id, 'https://y.example' from suppliers where name = 'Grossiste Milan';
delete from suppliers where name = 'Grossiste Milan';
do $$ begin assert (select count(*) from supplier_products) = 0, 'cascade'; end $$;

select 'supplier products tests passed';
