-- Niches Vinted: keys, jobs, what a collector sends (new listings, re-seen, sold, gone, back), figures by search and
-- by brand, permissions (collector key, manager, operator, other company). Runs on a freshly migrated database.
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
create table t.vars(k text primary key, v text);
create function t.put(k text, v text) returns void language sql as $$ insert into t.vars values (k, v) on conflict (k) do update set v = excluded.v $$;
create function t.v(k text) returns text language sql as $$ select v from t.vars where vars.k = $1 $$;
-- moves a listing back in time (test only), to measure sale times
create function t.age(p_id bigint, p_listed interval, p_ended interval) returns void language sql security definer as
  $$ update market_items set listed_at = now() - p_listed, listed_exact = true, ended_at = case when p_ended is null then ended_at else now() - p_ended end where vinted_id = p_id $$;
create function t.items() returns setof market_items language sql security definer as $$ select * from market_items $$;
create function t.runs() returns setof market_runs language sql security definer as $$ select * from market_runs $$;
create function t.searches() returns setof market_searches language sql security definer as $$ select * from market_searches $$;
grant usage on schema t to anon, authenticated;
grant all on all tables in schema t to anon, authenticated;
grant execute on all functions in schema t to anon, authenticated;

insert into auth.users values ('00000000-0000-0000-0000-0000000000a1', 'admin@example.com'),
                              ('00000000-0000-0000-0000-0000000000b1', 'op@example.com'),
                              ('00000000-0000-0000-0000-0000000000c1', 'other@example.com');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select public.bootstrap_organization('Lefort Second Hand', 'Mathéo');
select public.add_member('op@example.com', 'operator');

-- a search and a key
insert into market_searches(name, query) values ('Costume laine', '{"search_text": "costume laine", "catalog_ids": [2050]}');
select t.put('s', (select id::text from market_searches));
select t.put('key', public.market_create_key('GitHub'));
do $$ begin
  if t.v('key') !~ '^lfm_[0-9a-f]{64}$' then raise exception 'key format %', t.v('key'); end if;
end $$;
select t.expect_error($$select key_hash from market_keys$$, 'permission denied');
reset role;
do $$ begin
  if exists (select 1 from market_keys where key_hash = t.v('key')) then raise exception 'the key itself must not be stored'; end if;
end $$;
set role authenticated;

-- ── the collector, without a session ────────────────────────────────────────────────────────────────────────────
reset role; set role anon; select set_config('request.jwt.claim.sub', '', false);
select t.expect_error($$select public.market_jobs('lfm_wrong')$$, 'Clé de collecteur invalide');
select t.expect_error($$select public.market_jobs(null)$$, 'Réservé aux responsables et aux collecteurs');
select t.expect_error($$select public.market_overview(t.v('s')::uuid)$$, 'permission denied');
do $$ declare j jsonb := public.market_jobs(t.v('key'));
begin
  if jsonb_array_length(j->'searches') <> 1 or j->'searches'->0->>'name' <> 'Costume laine'
     or j->'searches'->0->'query'->>'search_text' <> 'costume laine' then raise exception 'jobs %', j; end if;
end $$;

-- first pass: 6 listings (one with a posting time Vinted gave, one with an absurd one)
do $$ declare r jsonb := public.market_ingest(t.v('key'), t.v('s')::uuid, 'github', jsonb_build_object(
  'ok', true, 'http_status', 200, 'pages', 1, 'sample_keys', '["id","title","price"]'::jsonb,
  'items', jsonb_build_array(
    jsonb_build_object('id', 1001, 'title', 'Costume Boggi', 'brand', 'Boggi Milano', 'size', 'M', 'price_cents', 5500, 'currency', 'EUR', 'seller_id', 77, 'seller_login', 'paul', 'created_ts', extract(epoch from now() - interval '2 days')::bigint),
    jsonb_build_object('id', 1002, 'title', 'Costume Boggi bleu', 'brand', 'Boggi Milano', 'size', 'L', 'price_cents', 6000, 'seller_id', 77, 'seller_login', 'paul'),
    jsonb_build_object('id', 1003, 'title', 'Costume Zara', 'brand', 'Zara', 'price_cents', 2000, 'seller_id', 88, 'seller_login', 'lea'),
    jsonb_build_object('id', 1004, 'title', 'Costume Zara gris', 'brand', 'Zara', 'price_cents', 2500, 'created_ts', 99),
    jsonb_build_object('id', 1005, 'title', 'Costume sans marque', 'price_cents', 1500),
    jsonb_build_object('id', 'abc', 'title', 'ignored: not a Vinted id'))));
begin
  if r->>'seen' <> '5' or r->>'new_items' <> '5' then raise exception 'first pass %', r; end if;
  if not (select listed_exact from t.items() where vinted_id = 1001) then raise exception 'posting time kept'; end if;
  if (select listed_exact from t.items() where vinted_id = 1004) then raise exception 'absurd posting time refused'; end if;
end $$;

-- second pass: 1001 seen again (no new), 1006 new
do $$ declare r jsonb := public.market_ingest(t.v('key'), t.v('s')::uuid, 'github', jsonb_build_object('ok', true,
  'items', jsonb_build_array(jsonb_build_object('id', 1001, 'price_cents', 5000), jsonb_build_object('id', 1006, 'title', 'Costume Boggi gris', 'brand', 'Boggi Milano', 'price_cents', 7000))));
begin
  if r->>'new_items' <> '1' then raise exception 'second pass %', r; end if;
  if (select price_cents from t.items() where vinted_id = 1001) <> 5000 then raise exception 'price updated'; end if;
  if (select count(*) from t.items()) <> 6 then raise exception 'no duplicate'; end if;
end $$;

-- nothing to look at again yet (checked less than 45 minutes ago counts from first seen)
do $$ begin
  if jsonb_array_length(public.market_jobs(t.v('key'))->'searches'->0->'recheck') <> 0 then raise exception 'too early to recheck'; end if;
end $$;
reset role;
update market_items set first_seen_at = now() - interval '3 days';
set role anon;
do $$ begin
  if jsonb_array_length(public.market_jobs(t.v('key'))->'searches'->0->'recheck') <> 6 then raise exception 'recheck list'; end if;
end $$;

-- checks: 1001 and 1002 sold, 1003 gone, 1004 reserved, 1005 still there, one unavailable, one unknown id
do $$ declare r jsonb := public.market_ingest(t.v('key'), t.v('s')::uuid, 'github', jsonb_build_object('ok', true,
  'checks', '[{"id":1001,"state":"sold"},{"id":1002,"state":"sold"},{"id":1003,"state":"gone"},{"id":1004,"state":"reserved"},{"id":1005,"state":"active"},{"id":1006,"state":"unavailable"},{"id":999,"state":"sold"}]'::jsonb));
begin
  if r->>'checked' <> '5' or r->>'sold' <> '2' or r->>'gone' <> '1' or r->>'unavailable' <> '1' then raise exception 'checks %', r; end if;
end $$;
-- a sale is never undone; a « gone » listing seen again in the catalogue is back for sale
select public.market_ingest(t.v('key'), t.v('s')::uuid, 'github', '{"checks":[{"id":1001,"state":"active"}]}');
select public.market_ingest(t.v('key'), t.v('s')::uuid, 'cloudflare', '{"items":[{"id":1003,"title":"Costume Zara"}]}');
do $$ begin
  if (select state from t.items() where vinted_id = 1001) <> 'sold' then raise exception 'sale undone'; end if;
  if (select state || coalesce(ended_at::text, '-') from t.items() where vinted_id = 1003) <> 'active-' then raise exception 'back for sale'; end if;
end $$;
-- a failed pass is recorded (status page)
select public.market_ingest(t.v('key'), t.v('s')::uuid, 'vercel', '{"ok":false,"http_status":403,"error":"Vinted a refusé la requête (403)."}');
do $$ begin
  if (select count(*) from t.runs()) <> 6 then raise exception 'runs %', (select count(*) from t.runs()); end if;
  if (select collector || ok::text || http_status from t.runs() order by at desc, id desc limit 1) <> 'vercelfalse403' then raise exception 'failed run'; end if;
  if (select last_ok_at from t.searches()) is null or (select last_run_at from t.searches()) is null then raise exception 'search dates'; end if;
end $$;

-- ── the manager reads the figures ──────────────────────────────────────────────────────────────────────────────
reset role; set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select t.age(1001, interval '50 hours', interval '2 hours');   -- sold after 48 h
select t.age(1002, interval '26 hours', interval '2 hours');   -- sold after 24 h
do $$ declare o jsonb := public.market_overview(t.v('s')::uuid, 30);
begin
  if (o->>'items')::int <> 6 or (o->>'sold')::int <> 2 or (o->>'gone')::int <> 0 or (o->>'active')::int <> 4 then raise exception 'counts %', o; end if;
  if (o->>'rate')::numeric <> round(2 / 6.0, 4) then raise exception 'rate %', o->>'rate'; end if;
  if (o->>'avg_hours')::numeric <> 36 or (o->>'median_hours')::numeric <> 36 then raise exception 'sale time %', o; end if;
  if (o->>'avg_sold_price_cents')::int <> 5500 or (o->>'revenue_30_cents')::int <> 11000 then raise exception 'prices %', o; end if;
  if (o->>'score') is null then raise exception 'score expected %', o; end if;
  if jsonb_array_length(o->'daily') <> 14 or (select sum((d->>'sold')::int) from jsonb_array_elements(o->'daily') d) <> 2 then raise exception 'daily %', o->'daily'; end if;
  if (select sum((b->>'n')::int) from jsonb_array_elements(o->'sell_times') b) <> 2
     or (select (b->>'n')::int from jsonb_array_elements(o->'sell_times') b where b->>'label' = '1–3 j') <> 2 then raise exception 'sell times %', o->'sell_times'; end if;
  if (o->'last_run'->>'ok')::boolean then raise exception 'last run is the failed one'; end if;
end $$;
do $$ declare b record; n int := 0;
begin
  for b in select * from public.market_groups(t.v('s')::uuid, 'brand', 30) loop
    n := n + 1;
    if n = 1 and (b.key <> 'Boggi Milano' or b.items <> 3 or b.sold <> 2 or b.revenue_cents <> 11000) then raise exception 'first brand %', b; end if;
    if b.key = 'Zara' and b.score is not null then raise exception 'no score without a sale'; end if;
  end loop;
  if n <> 3 then raise exception 'brands %', n; end if;
  if (select count(*) from public.market_groups(t.v('s')::uuid, 'seller', 30)) <> 3 then raise exception 'sellers'; end if;
end $$;
select t.expect_error($$select * from public.market_groups(t.v('s')::uuid, 'colour', 30)$$, 'Regroupement inconnu');

-- the manager can run a pass himself (test button), without a key
select public.market_ingest(null, t.v('s')::uuid, 'manuel', '{"items":[{"id":1007,"title":"Costume test"}]}');
-- a key can be withdrawn
select public.market_revoke_key((select id from market_keys));
set role anon; select set_config('request.jwt.claim.sub', '', false);
select t.expect_error($$select public.market_jobs(t.v('key'))$$, 'Clé de collecteur invalide');

-- ── the team reads, does not configure ─────────────────────────────────────────────────────────────────────────
reset role; set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select t.expect_error($$select public.market_create_key('x')$$, 'Réservé aux responsables');
select t.expect_error($$select public.market_ingest(null, t.v('s')::uuid, 'manuel', '{}')$$, 'Réservé aux responsables');
select t.expect_error($$insert into market_searches(name) values ('x')$$, 'row-level security');
do $$ begin
  if (select count(*) from market_items) <> 7 then raise exception 'team reads listings'; end if;
  if (select count(*) from market_keys) <> 0 then raise exception 'team does not see keys'; end if;
  perform public.market_overview(t.v('s')::uuid);
end $$;

-- ── another company sees nothing, and its key cannot write into this search ─────────────────────────────────────
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select public.bootstrap_organization('Autre', 'Autre');
select t.put('key2', public.market_create_key('autre'));
do $$ begin
  if (select count(*) from market_items) + (select count(*) from market_searches) + (select count(*) from market_runs) <> 0 then raise exception 'isolation'; end if;
end $$;
select t.expect_error($$select public.market_overview(t.v('s')::uuid)$$, 'Recherche introuvable');
set role anon; select set_config('request.jwt.claim.sub', '', false);
select t.expect_error($$select public.market_ingest(t.v('key2'), t.v('s')::uuid, 'github', '{}')$$, 'Recherche introuvable');
do $$ begin
  if jsonb_array_length(public.market_jobs(t.v('key2'))->'searches') <> 0 then raise exception 'other company jobs'; end if;
end $$;
select 'market ok';
