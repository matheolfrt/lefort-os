-- Notes: private to their author unless shared; only the author changes them; never across shops.
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

insert into notes(title, body) values ('Idées achats', 'Chercher des blazers Boss taille 50');
insert into notes(title, body, shared) values ('Procédure emballage', 'Papier de soie + carte de remerciement', true);
do $$ begin
  assert (select count(*) from notes) = 2;
  assert (select author_id = auth.uid() and not pinned from notes where title = 'Idées achats');
end $$;

-- the operator sees the shared note only, and cannot change it
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
do $$ begin
  assert (select count(*) from notes) = 1, 'private notes stay private';
  assert (select title from notes) = 'Procédure emballage';
end $$;
update notes set body = 'changé' where title = 'Procédure emballage';
do $$ begin assert (select body from notes) = 'Papier de soie + carte de remerciement', 'only the author changes a note'; end $$;
delete from notes;
-- their own note
insert into notes(title) values ('Mes rappels');
select t.expect_error($$insert into notes(title, author_id) values ('x', '00000000-0000-0000-0000-0000000000a1')$$, 'row-level security');

-- the author edits, pins, shares, and updated_at moves
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
do $$ declare before timestamptz; begin
  assert (select count(*) from notes) = 2, 'the operator''s note is private to them';
  select updated_at into before from notes where title = 'Idées achats';
  perform pg_sleep(0.01);
  update notes set body = body || ' et 52', pinned = true where title = 'Idées achats';
  assert (select pinned and body like '%52' and updated_at > before from notes where title = 'Idées achats');
end $$;
select t.expect_error($$update notes set author_id = '00000000-0000-0000-0000-0000000000b1'$$, 'permission denied');

-- another shop sees nothing
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select public.bootstrap_organization('Autre boutique', 'Autre');
do $$ begin assert (select count(*) from notes) = 0; end $$;

reset role;
select 'notes tests passed';
