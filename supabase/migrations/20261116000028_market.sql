-- Lefort OS — « Niches Vinted » : market research on public Vinted listings, collected for real (nothing estimated
-- from outside data). Collectors (GitHub Actions, the Vercel server, a Cloudflare Worker) read the searches to follow,
-- read Vinted's catalogue, and send back what they saw; the database keeps every listing and when it ended.
--
--   market_searches   a search to follow (text, categories, brands, sizes, prices: what a Vinted URL says)
--   market_items      every listing seen for a search: price, brand, size, seller, when posted, when it ended
--   market_runs       every pass of a collector: ok or not, what Vinted answered, how much was read (status page)
--   market_keys       keys given to the collectors (only a hash is kept)
--
-- A sale is never invented: a listing is « sold » when Vinted says so when it is checked again, « gone » when it
-- disappeared without saying why (deleted or sold: counted apart, shown as « probable »).

create table market_searches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.auth_org_id() references organizations(id),
  name text not null check (length(trim(name)) between 1 and 80),
  -- search_text, catalog_ids[], brand_ids[], size_ids[], status_ids[], color_ids[], material_ids[], price_from, price_to
  query jsonb not null default '{}'::jsonb check (jsonb_typeof(query) = 'object' and pg_column_size(query) < 20000),
  domain text not null default 'www.vinted.fr' check (domain ~ '^www\.vinted\.[a-z]{2,3}(\.[a-z]{2})?$'),
  active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  last_run_at timestamptz,
  last_ok_at timestamptz
);
create index market_searches_org on market_searches(org_id);
alter table market_searches enable row level security;
grant select, insert, delete on market_searches to authenticated;
grant update (name, query, domain, active) on market_searches to authenticated;
create policy market_searches_read on market_searches for select to authenticated using (org_id = (select public.auth_org_id()));
create policy market_searches_insert on market_searches for insert to authenticated
  with check (org_id = (select public.auth_org_id()) and (select public.is_manager()));
create policy market_searches_update on market_searches for update to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_manager())) with check (org_id = (select public.auth_org_id()));
create policy market_searches_delete on market_searches for delete to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_manager()));

create table market_items (
  search_id uuid not null references market_searches(id) on delete cascade,
  vinted_id bigint not null,
  org_id uuid not null references organizations(id),
  title text, brand text, size text, condition text,
  price_cents int check (price_cents >= 0), currency text,
  photo_url text, url text,
  seller_id bigint, seller_login text,
  favourites int, views int,
  listed_at timestamptz not null,            -- posted on Vinted (from the listing), or first seen
  listed_exact boolean not null default false, -- true when Vinted gave the posting time
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_check_at timestamptz,                 -- last time its own page was read
  state text not null default 'active' check (state in ('active', 'reserved', 'sold', 'gone')),
  ended_at timestamptz,                      -- when the sale (or the disappearance) was seen
  alive_at timestamptz,                      -- last time it was seen still for sale: the sale is between the two
  primary key (search_id, vinted_id)
);
create index market_items_org on market_items(org_id);
create index market_items_state on market_items(search_id, state, ended_at);
create index market_items_check on market_items(search_id, last_check_at nulls first) where state in ('active', 'reserved');
alter table market_items enable row level security;
grant select on market_items to authenticated;
create policy market_items_read on market_items for select to authenticated using (org_id = (select public.auth_org_id()));

create table market_runs (
  id bigint generated always as identity primary key,
  org_id uuid not null references organizations(id),
  search_id uuid references market_searches(id) on delete cascade,
  collector text not null check (collector in ('github', 'vercel', 'cloudflare', 'manuel', 'autre')),
  at timestamptz not null default now(),
  ok boolean not null,
  http_status int,
  pages int not null default 0, seen int not null default 0, new_items int not null default 0,
  checked int not null default 0, sold int not null default 0, gone int not null default 0,
  check_unavailable int not null default 0,
  duration_ms int,
  error text check (length(error) <= 500),
  sample_keys text[]                          -- field names Vinted returned (no values): to adapt if its format changes
);
create index market_runs_org on market_runs(org_id, at desc);
create index market_runs_search on market_runs(search_id, at desc);
alter table market_runs enable row level security;
grant select on market_runs to authenticated;
create policy market_runs_read on market_runs for select to authenticated using (org_id = (select public.auth_org_id()));

create table market_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  label text not null default 'Collecteur' check (length(label) <= 60),
  key_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
alter table market_keys enable row level security;
grant select (id, label, created_at, last_used_at, revoked_at) on market_keys to authenticated;
create policy market_keys_read on market_keys for select to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_manager()));

-- ── Who is calling: a collector with its key, or a manager signed in (test button) ───────────────────────────────
create function private.market_org(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if nullif(trim(p_token), '') is not null then
    update market_keys set last_used_at = now()
     where key_hash = encode(sha256(convert_to(trim(p_token), 'UTF8')), 'hex') and revoked_at is null
    returning org_id into v_org;
    if v_org is null then raise exception using errcode = 'LF403', message = 'Clé de collecteur invalide ou retirée.'; end if;
    return v_org;
  end if;
  if public.is_manager() then return public.auth_org_id(); end if;
  raise exception using errcode = 'LF403', message = 'Réservé aux responsables et aux collecteurs.';
end $$;

/** A new key for a collector, shown once (only its hash is kept) */
create function public.market_create_key(p_label text default 'Collecteur') returns text
language plpgsql security definer set search_path = public as $$
declare v_key text := 'lfm_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if not public.is_manager() then raise exception using errcode = 'LF403', message = 'Réservé aux responsables.'; end if;
  insert into market_keys(org_id, label, key_hash)
  values (public.auth_org_id(), coalesce(nullif(trim(p_label), ''), 'Collecteur'), encode(sha256(convert_to(v_key, 'UTF8')), 'hex'));
  return v_key;
end $$;

create function public.market_revoke_key(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception using errcode = 'LF403', message = 'Réservé aux responsables.'; end if;
  update market_keys set revoked_at = now() where id = p_id and org_id = public.auth_org_id() and revoked_at is null;
end $$;

-- ── What to collect: the active searches, and for each the listings to look at again (oldest checked first) ──────
create function public.market_jobs(p_token text default null, p_recheck int default 120, p_search_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.market_org(p_token);
begin
  return jsonb_build_object('searches', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'domain', s.domain, 'query', s.query,
      'known', (select count(*) from market_items i where i.search_id = s.id),
      'recheck', coalesce((
        select jsonb_agg(r.vinted_id) from (
          select i.vinted_id from market_items i
           where i.search_id = s.id and i.state in ('active', 'reserved')
             and coalesce(i.last_check_at, i.first_seen_at) < now() - interval '45 minutes'
           order by i.last_check_at nulls first, i.first_seen_at
           limit least(greatest(coalesce(p_recheck, 120), 0), 1000)) r), '[]'::jsonb)
    ) order by s.last_run_at nulls first)
      from market_searches s
     where s.org_id = v_org and s.active and (p_search_id is null or s.id = p_search_id)), '[]'::jsonb));
end $$;

-- ── What a collector saw ──────────────────────────────────────────────────────────────────────────────────────────
-- p_payload: { ok, http_status, error, pages, duration_ms, sample_keys[],
--              items: [{ id, title, brand, size, condition, price_cents, currency, photo_url, url, seller_id,
--                        seller_login, favourites, views, created_ts }],
--              checks: [{ id, state: active | reserved | sold | gone | unavailable }] }
create function public.market_ingest(p_token text, p_search_id uuid, p_collector text, p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := private.market_org(p_token);
  v_new int := 0; v_seen int := 0; v_checked int := 0; v_sold int := 0; v_gone int := 0; v_unavail int := 0;
  v_ok boolean := coalesce((p_payload->>'ok')::boolean, true);
  e jsonb; v_ts timestamptz; v_inserted boolean; v_state text; n int;
begin
  if not exists (select 1 from market_searches where id = p_search_id and org_id = v_org) then
    raise exception using errcode = 'LF404', message = 'Recherche introuvable.';
  end if;
  if p_collector not in ('github', 'vercel', 'cloudflare', 'manuel', 'autre') then p_collector := 'autre'; end if;
  if jsonb_array_length(coalesce(p_payload->'items', '[]')) > 5000 or jsonb_array_length(coalesce(p_payload->'checks', '[]')) > 2000 then
    raise exception using errcode = 'LF422', message = 'Trop d''annonces dans un seul envoi.';
  end if;

  for e in select * from jsonb_array_elements(coalesce(p_payload->'items', '[]')) loop
    continue when (e->>'id') !~ '^\d{1,18}$';
    v_seen := v_seen + 1;
    -- posting time given by Vinted (seconds since 1970), kept only when plausible
    v_ts := case when (e->>'created_ts') ~ '^\d{9,11}$' then to_timestamp((e->>'created_ts')::bigint) end;
    if v_ts is not null and (v_ts < timestamptz '2008-01-01' or v_ts > now() + interval '1 day') then v_ts := null; end if;
    insert into market_items as m (search_id, vinted_id, org_id, title, brand, size, condition, price_cents, currency,
                                   photo_url, url, seller_id, seller_login, favourites, views, listed_at, listed_exact)
    values (p_search_id, (e->>'id')::bigint, v_org, left(e->>'title', 200), left(e->>'brand', 80), left(e->>'size', 40),
            left(e->>'condition', 60), nullif(e->>'price_cents', '')::numeric::int, left(e->>'currency', 3),
            left(e->>'photo_url', 500), left(e->>'url', 500), nullif(e->>'seller_id', '')::numeric::bigint,
            left(e->>'seller_login', 80), nullif(e->>'favourites', '')::numeric::int, nullif(e->>'views', '')::numeric::int,
            coalesce(v_ts, now()), v_ts is not null)
    on conflict (search_id, vinted_id) do update set
      title = coalesce(excluded.title, m.title), brand = coalesce(excluded.brand, m.brand), size = coalesce(excluded.size, m.size),
      condition = coalesce(excluded.condition, m.condition), price_cents = coalesce(excluded.price_cents, m.price_cents),
      currency = coalesce(excluded.currency, m.currency), photo_url = coalesce(excluded.photo_url, m.photo_url),
      url = coalesce(excluded.url, m.url), seller_id = coalesce(excluded.seller_id, m.seller_id),
      seller_login = coalesce(excluded.seller_login, m.seller_login), favourites = coalesce(excluded.favourites, m.favourites),
      views = coalesce(excluded.views, m.views), last_seen_at = now(), alive_at = now(),
      listed_at = case when not m.listed_exact and excluded.listed_exact then excluded.listed_at else m.listed_at end,
      listed_exact = m.listed_exact or excluded.listed_exact,
      -- back in the catalogue: it was not sold after all (hidden for a while, or put back on sale)
      state = case when m.state = 'gone' then 'active' else m.state end,
      ended_at = case when m.state = 'gone' then null else m.ended_at end
    returning (xmax = 0) into v_inserted;
    if v_inserted then v_new := v_new + 1; end if;
  end loop;

  for e in select * from jsonb_array_elements(coalesce(p_payload->'checks', '[]')) loop
    continue when (e->>'id') !~ '^\d{1,18}$';
    v_state := e->>'state';
    if v_state = 'unavailable' then v_unavail := v_unavail + 1; continue; end if;
    continue when v_state not in ('active', 'reserved', 'sold', 'gone');
    update market_items set
      last_check_at = now(),
      state = case when state = 'sold' then 'sold' else v_state end,   -- a sale is never undone by a later check
      ended_at = case when v_state in ('sold', 'gone') and state in ('active', 'reserved') then now()
                      when v_state in ('active', 'reserved') and state <> 'sold' then null else ended_at end,
      alive_at = case when v_state in ('active', 'reserved') then now() else alive_at end
     where search_id = p_search_id and vinted_id = (e->>'id')::bigint and state <> 'sold';
    get diagnostics n = row_count;
    if n > 0 then
      v_checked := v_checked + 1;
      if v_state = 'sold' then v_sold := v_sold + 1; elsif v_state = 'gone' then v_gone := v_gone + 1; end if;
    end if;
  end loop;

  insert into market_runs(org_id, search_id, collector, ok, http_status, pages, seen, new_items, checked, sold, gone,
                          check_unavailable, duration_ms, error, sample_keys)
  values (v_org, p_search_id, p_collector, v_ok, nullif(p_payload->>'http_status', '')::int,
          coalesce(nullif(p_payload->>'pages', '')::int, 0), v_seen, v_new, v_checked, v_sold, v_gone, v_unavail,
          nullif(p_payload->>'duration_ms', '')::int, left(p_payload->>'error', 500),
          (select array_agg(left(x, 60)) from (select jsonb_array_elements_text(case when jsonb_typeof(p_payload->'sample_keys') = 'array' then p_payload->'sample_keys' else '[]' end) x limit 80) k));
  update market_searches set last_run_at = now(), last_ok_at = case when v_ok then now() else last_ok_at end where id = p_search_id;
  -- the status page keeps 60 days of passes
  delete from market_runs where org_id = v_org and at < now() - interval '60 days';
  return jsonb_build_object('seen', v_seen, 'new_items', v_new, 'checked', v_checked, 'sold', v_sold, 'gone', v_gone, 'unavailable', v_unavail);
end $$;

-- ── Figures of a search (only from what was collected) ───────────────────────────────────────────────────────────
-- Score (0–100), shown with its recipe: 50 for the share sold (full at 60 %), 30 for speed (full when it sells at
-- once, nothing at 14 days), 20 for volume (full at 2 sales a day). No score below 5 listings or without a sale.
create function private.market_score(p_rate numeric, p_hours numeric, p_per_day numeric, p_items bigint, p_sold bigint)
returns int language sql immutable as $$
  select case when p_items < 5 or p_sold = 0 or p_rate is null then null else round(
    least(p_rate / 0.6, 1) * 50 + (1 - least(coalesce(p_hours, 336) / 336, 1)) * 30 + least(coalesce(p_per_day, 0) / 2, 1) * 20)::int end
$$;

create function public.market_overview(p_search_id uuid, p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_from timestamptz := now() - make_interval(days => greatest(least(coalesce(p_days, 30), 365), 1));
  v_first timestamptz; v_span numeric; r jsonb;
begin
  if not exists (select 1 from market_searches where id = p_search_id and org_id = public.auth_org_id()) then
    raise exception using errcode = 'LF404', message = 'Recherche introuvable.';
  end if;
  select min(at) into v_first from market_runs where search_id = p_search_id and ok;
  -- days actually observed (a search followed for 2 days is not divided by 30)
  v_span := greatest(extract(epoch from now() - greatest(coalesce(v_first, now()), v_from)) / 86400, 1);
  with i as (select * from market_items where search_id = p_search_id),
  win as (select * from i where first_seen_at >= v_from or listed_at >= v_from or ended_at >= v_from),
  sold as (select * from i where state = 'sold' and ended_at >= v_from),
  agg as (
    select (select count(*) from win) n_items,
           (select count(*) from i where state in ('active', 'reserved')) n_active,
           (select count(*) from sold) n_sold,
           (select count(*) from i where state = 'gone' and ended_at >= v_from) n_gone,
           (select count(*) from win where state = 'sold') n_win_sold,
           (select avg(extract(epoch from ended_at - listed_at) / 3600) from sold where listed_exact) avg_hours,
           (select percentile_cont(0.5) within group (order by extract(epoch from ended_at - listed_at) / 3600) from sold where listed_exact) med_hours,
           (select avg(price_cents) from sold) avg_sold_price,
           (select avg(price_cents) from win where price_cents is not null) avg_price,
           (select sum(price_cents) from i where state = 'sold' and ended_at >= now() - interval '30 days') revenue_30,
           (select count(*) from i where state = 'sold' and ended_at >= now() - interval '7 days') sold_7,
           (select count(*) from i where first_seen_at >= now() - interval '7 days' and listed_at >= now() - interval '7 days') new_7)
  select jsonb_build_object(
    'items', n_items, 'active', n_active, 'sold', n_sold, 'gone', n_gone,
    'rate', case when n_items > 0 then round(n_win_sold::numeric / n_items, 4) end,
    'avg_hours', round(avg_hours::numeric, 1), 'median_hours', round(med_hours::numeric, 1),
    'avg_sold_price_cents', round(avg_sold_price), 'avg_price_cents', round(avg_price),
    'revenue_30_cents', coalesce(revenue_30, 0),
    'sold_per_day', round(sold_7::numeric / least(7, v_span), 2),
    'new_per_day', round(new_7::numeric / least(7, v_span), 2),
    'observed_days', round(v_span, 1), 'first_run', v_first,
    'score', private.market_score(case when n_items > 0 then n_win_sold::numeric / n_items end, avg_hours::numeric,
                                  sold_7::numeric / least(7, v_span), n_items, n_win_sold)
  ) into r from agg;

  return r || jsonb_build_object(
    -- day by day: new listings (posted that day) and sales seen that day, the last 14 days
    'daily', (select jsonb_agg(jsonb_build_object('day', d::date,
        'new', (select count(*) from market_items where search_id = p_search_id and listed_at >= d and listed_at < d + interval '1 day' and first_seen_at < d + interval '2 days'),
        'sold', (select count(*) from market_items where search_id = p_search_id and state = 'sold' and ended_at >= d and ended_at < d + interval '1 day'),
        'gone', (select count(*) from market_items where search_id = p_search_id and state = 'gone' and ended_at >= d and ended_at < d + interval '1 day')
      ) order by d)
      from generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') d),
    -- how long sales took
    'sell_times', (select jsonb_agg(jsonb_build_object('label', b.label, 'n', (
        select count(*) from market_items where search_id = p_search_id and state = 'sold' and listed_exact and ended_at >= v_from
           and extract(epoch from ended_at - listed_at) / 3600 >= b.lo and extract(epoch from ended_at - listed_at) / 3600 < b.hi))
        order by b.lo)
      from (values ('< 6 h', 0, 6), ('6–24 h', 6, 24), ('1–3 j', 24, 72), ('3–7 j', 72, 168), ('7–14 j', 168, 336), ('14 j et +', 336, 1e9)) b(label, lo, hi)),
    -- at what price they sell
    'prices', (select jsonb_agg(jsonb_build_object('label', b.label, 'listed', (
          select count(*) from market_items where search_id = p_search_id and (first_seen_at >= v_from or listed_at >= v_from) and price_cents >= b.lo and price_cents < b.hi),
        'sold', (select count(*) from market_items where search_id = p_search_id and state = 'sold' and ended_at >= v_from and price_cents >= b.lo and price_cents < b.hi))
        order by b.lo)
      from (values ('< 10 €', 0, 1000), ('10–20 €', 1000, 2000), ('20–30 €', 2000, 3000), ('30–50 €', 3000, 5000), ('50–100 €', 5000, 10000), ('100 € et +', 10000, 1e9)) b(label, lo, hi)),
    'last_run', (select jsonb_build_object('at', at, 'ok', ok, 'collector', collector, 'error', error, 'http_status', http_status)
                   from market_runs where search_id = p_search_id order by at desc limit 1)
  );
end $$;

-- ── One line per brand, seller or size: the « niches » inside a search ───────────────────────────────────────────
create function public.market_groups(p_search_id uuid, p_by text default 'brand', p_days int default 30)
returns table (key text, items bigint, sold bigint, gone bigint, rate numeric, avg_hours numeric, sold_per_day numeric,
               avg_price_cents numeric, revenue_cents bigint, score int)
language plpgsql stable security definer set search_path = public as $$
declare v_from timestamptz := now() - make_interval(days => greatest(least(coalesce(p_days, 30), 365), 1)); v_span numeric;
begin
  if not exists (select 1 from market_searches where id = p_search_id and org_id = public.auth_org_id()) then
    raise exception using errcode = 'LF404', message = 'Recherche introuvable.';
  end if;
  if p_by not in ('brand', 'seller', 'size') then raise exception using errcode = 'LF422', message = 'Regroupement inconnu.'; end if;
  select greatest(extract(epoch from now() - greatest(coalesce(min(r.at), now()), v_from)) / 86400, 1) into v_span
    from market_runs r where r.search_id = p_search_id and r.ok;
  return query
  with w as (
    select case p_by when 'brand' then coalesce(nullif(trim(m.brand), ''), 'Sans marque')
                     when 'seller' then coalesce(m.seller_login, m.seller_id::text, 'Inconnu')
                     else coalesce(nullif(trim(m.size), ''), 'Sans taille') end k, m.*
      from market_items m
     where m.search_id = p_search_id and (m.first_seen_at >= v_from or m.listed_at >= v_from or m.ended_at >= v_from)),
  g as (
    select w.k, count(*) n, count(*) filter (where w.state = 'sold') s, count(*) filter (where w.state = 'gone') gn,
           avg(extract(epoch from w.ended_at - w.listed_at) / 3600) filter (where w.state = 'sold' and w.listed_exact) h,
           avg(w.price_cents) filter (where w.state = 'sold') sp, avg(w.price_cents) ap,
           sum(w.price_cents) filter (where w.state = 'sold') rev
      from w group by w.k)
  select g.k, g.n, g.s, g.gn, round(g.s::numeric / g.n, 4), round(g.h::numeric, 1), round(g.s::numeric / v_span, 2),
         round(coalesce(g.sp, g.ap)), coalesce(g.rev, 0)::bigint,
         private.market_score(g.s::numeric / g.n, g.h::numeric, g.s::numeric / v_span, g.n, g.s)
    from g
   order by private.market_score(g.s::numeric / g.n, g.h::numeric, g.s::numeric / v_span, g.n, g.s) desc nulls last, g.s desc, g.n desc
   limit 300;
end $$;

-- ── The list of searches with their counts (one call for the list page) ─────────────────────────────────────────────
create function public.market_list() returns table (id uuid, name text, domain text, query jsonb, active boolean,
  created_at timestamptz, last_run_at timestamptz, last_ok_at timestamptz, items bigint, active_items bigint, sold bigint, gone bigint,
  sold_7 bigint, photo_url text, last_error text)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.domain, s.query, s.active, s.created_at, s.last_run_at, s.last_ok_at,
         count(i.vinted_id), count(i.vinted_id) filter (where i.state in ('active', 'reserved')),
         count(i.vinted_id) filter (where i.state = 'sold'), count(i.vinted_id) filter (where i.state = 'gone'),
         count(i.vinted_id) filter (where i.state = 'sold' and i.ended_at >= now() - interval '7 days'),
         (select m.photo_url from market_items m where m.search_id = s.id and m.photo_url is not null order by m.first_seen_at desc limit 1),
         (select r.error from market_runs r where r.search_id = s.id order by r.at desc limit 1)
    from market_searches s left join market_items i on i.search_id = s.id
   where s.org_id = public.auth_org_id()
   group by s.id
   order by s.created_at desc
$$;

-- the collectors' functions are called without a session (their key says who they are); the others need one
grant execute on function public.market_jobs(text, int, uuid) to anon, authenticated;
grant execute on function public.market_ingest(text, uuid, text, jsonb) to anon, authenticated;
revoke execute on function public.market_overview(uuid, int), public.market_groups(uuid, text, int), public.market_list(),
  public.market_create_key(text), public.market_revoke_key(uuid) from public, anon;
grant execute on function public.market_overview(uuid, int), public.market_groups(uuid, text, int), public.market_list(),
  public.market_create_key(text), public.market_revoke_key(uuid) to authenticated;

-- update marker (Paramètres → Mises à jour)
create function public.market_ready() returns boolean language sql stable as $$ select true $$;
