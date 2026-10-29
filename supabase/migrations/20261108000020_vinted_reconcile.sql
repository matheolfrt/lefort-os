-- Lefort OS — Vinted synchronisation that can run on its own (the extension, in the background) and stay safe:
--
--   • never twice the same sale: a Vinted sale is kept once in a mirror (vinted_orders, one row per transaction
--     number) and linked to at most one Lefort OS order; the transaction number is also unique on orders;
--   • a sale typed by hand is recognised (by its transaction number, by one of its items, or proposed when it only
--     looks alike) instead of being recorded again;
--   • nothing uncertain is decided alone: unknown items, look-alike sales, conflicts, Vinted cancellations wait for a
--     decision (vinted_orders.issue) with the possible answers (candidates);
--   • nothing is lost: each run reads the recent Vinted sales again; the reconciliation lists what is on Vinted and
--     not in Lefort OS, and the other way round;
--   • everything done is written in a journal (vinted_sync_events) and the sales it recorded can be undone.
--
-- The extension reads Vinted (it has the seller's session); all decisions are taken here, in one transaction per
-- call, under a lock per business so two synchronisations never interleave.

-- ── Settings ────────────────────────────────────────────────────────────────────────────────────────────────────
-- Sales sold before this day are history (already counted before Lefort OS): never recorded without a decision.
-- Empty = nothing is recorded on its own until the date is chosen.
alter table organizations add column if not exists vinted_sync_from date;

-- ── One row per synchronisation ─────────────────────────────────────────────────────────────────────────────────
create table vinted_sync_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.auth_org_id() references organizations(id),
  source text not null check (source in ('auto', 'manual')),
  kind text not null check (kind in ('orders', 'wardrobe', 'full')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'partial', 'error')),
  orders_complete boolean,          -- every Vinted sale since covered_from was read
  covered_from timestamptz,         -- oldest sale date the read covers
  wardrobe_complete boolean,        -- every listing of the wardrobe was read
  summary jsonb not null default '{}',
  error text check (error is null or length(error) <= 2000),
  diagnostic jsonb,
  created_by uuid references auth.users(id) default auth.uid()
);
create index vinted_sync_runs_org_idx on vinted_sync_runs(org_id, started_at desc);

-- ── Mirror of the Vinted sales ──────────────────────────────────────────────────────────────────────────────────
create table vinted_orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  transaction_id text not null check (length(transaction_id) between 1 and 64),
  state text not null check (state in ('pending', 'shipped', 'completed', 'cancelled')),
  sold_at timestamptz,
  shipped_at timestamptz,
  completed_at timestamptz,
  price_cents bigint check (price_cents is null or price_cents >= 0),
  buyer text,
  title text,
  item_ids text[] not null default '{}',   -- Vinted listing ids of the items sold
  items jsonb not null default '[]',       -- [{id, title, brand, size, price_cents}]
  order_id uuid references orders(id),     -- the Lefort OS order it is (kept even if that order is cancelled later)
  match text check (match in ('transaction', 'listing', 'created', 'confirmed')),
  issue text check (issue in ('before_start', 'unknown_items', 'possible_match', 'item_conflict', 'missing_price',
                              'cancelled_on_vinted', 'voided_in_lefort', 'price_diff')),
  issue_since timestamptz,
  candidates jsonb,                        -- possible answers to the issue
  decision text check (decision in ('ignored')),
  decision_note text,
  decided_at timestamptz,
  decided_by uuid references auth.users(id),
  rejected_orders uuid[] not null default '{}',  -- orders it must never be linked to again (a link undone)
  price_ack boolean not null default false,      -- a different price in Lefort OS was accepted
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_run_id uuid references vinted_sync_runs(id) on delete set null,
  unique (org_id, transaction_id)
);
create index vinted_orders_issue_idx on vinted_orders(org_id) where issue is not null and decision is null;
create index vinted_orders_order_idx on vinted_orders(order_id) where order_id is not null;
create index vinted_orders_sold_idx on vinted_orders(org_id, sold_at desc);

-- ── Mirror of the Vinted wardrobe: views, favourites, and the link to the item when it can be proven ────────────
create table vinted_listings (
  org_id uuid not null references organizations(id),
  external_id text not null check (length(external_id) between 1 and 64),
  item_id uuid references items(id),
  state text not null check (state in ('active', 'reserved', 'sold', 'hidden')),
  title text,
  url text,
  photo text,
  price_cents bigint,
  brand text,
  size text,
  sku_hint text,                 -- « Réf. LSH00123 » read in the description
  views int check (views is null or views >= 0),
  favourites int check (favourites is null or favourites >= 0),
  offers int check (offers is null or offers >= 0),
  rejected_items uuid[] not null default '{}',   -- items it must never be linked to again (a link undone)
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_run_id uuid references vinted_sync_runs(id) on delete set null,
  primary key (org_id, external_id)
);
create index vinted_listings_item_idx on vinted_listings(item_id) where item_id is not null;

-- one row per listing and day: how views and favourites grow
create table vinted_listing_stats (
  org_id uuid not null references organizations(id),
  external_id text not null,
  day date not null,
  views int,
  favourites int,
  offers int,
  primary key (org_id, external_id, day)
);

-- ── Journal ─────────────────────────────────────────────────────────────────────────────────────────────────────
create table vinted_sync_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  run_id uuid references vinted_sync_runs(id) on delete set null,
  at timestamptz not null default now(),
  actor_id uuid references auth.users(id) default auth.uid(),
  action text not null check (action in ('order_imported', 'order_linked', 'order_advanced', 'order_cancelled',
                                         'listing_linked', 'ignored', 'unignored', 'price_replaced', 'undone')),
  vinted_order_id uuid references vinted_orders(id) on delete set null,
  order_id uuid references orders(id),
  item_id uuid references items(id),
  transaction_id text,
  external_id text,
  detail jsonb not null default '{}',
  undone_at timestamptz,
  undone_by uuid references auth.users(id)
);
create index vinted_sync_events_org_idx on vinted_sync_events(org_id, at desc);
create index vinted_sync_events_run_idx on vinted_sync_events(run_id);

-- Lefort OS sales on the Vinted channel that are rightly not on Vinted (sold in person, typed on the wrong channel…)
create table vinted_ignored_orders (
  order_id uuid primary key references orders(id),
  org_id uuid not null references organizations(id),
  reason text,
  at timestamptz not null default now(),
  by_id uuid references auth.users(id) default auth.uid()
);

-- Managers read; every write goes through the functions below
do $$
declare t text;
begin
  foreach t in array array['vinted_sync_runs', 'vinted_orders', 'vinted_listings', 'vinted_listing_stats',
                           'vinted_sync_events', 'vinted_ignored_orders'] loop
    execute format('alter table %I enable row level security', t);
    execute format('grant select on %I to authenticated', t);
    execute format('create policy %I on %I for select to authenticated using (org_id = (select public.auth_org_id()) and (select public.is_manager()))', t || '_mgr', t);
  end loop;
end $$;

-- ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────
create function private.vinted_rank(p_state text) returns int language sql immutable as
  $$ select case p_state when 'pending' then 0 when 'shipped' then 1 when 'completed' then 2 else 3 end $$;

create function private.vinted_event(p_org uuid, p_run uuid, p_action text, p_vo uuid, p_order uuid, p_item uuid,
                                     p_tid text, p_ext text, p_detail jsonb default '{}')
returns uuid language sql security definer set search_path = public as $$
  insert into vinted_sync_events(org_id, run_id, action, vinted_order_id, order_id, item_id, transaction_id, external_id, detail)
  values (p_org, p_run, p_action, p_vo, p_order, p_item, p_tid, p_ext, coalesce(p_detail, '{}'))
  returning id
$$;

-- The Lefort OS item behind a Vinted listing: proven by a listing link (made at publication, by the import, or by
-- the SKU written in the description)
create function private.vinted_item_for(p_org uuid, p_ext text) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select li.item_id from listings li
      where li.org_id = p_org and li.channel = 'vinted' and li.external_id = p_ext
      order by li.listed_at desc limit 1),
    (select vl.item_id from vinted_listings vl where vl.org_id = p_org and vl.external_id = p_ext))
$$;

create function private.vinted_set_issue(p_id uuid, p_issue text, p_candidates jsonb default null) returns void
language sql security definer set search_path = public as $$
  update vinted_orders set issue = p_issue, candidates = p_candidates,
         issue_since = case when p_issue is null then null when issue is distinct from p_issue then now() else issue_since end
   where id = p_id
$$;

-- Moves a Lefort OS order forward to the Vinted state (never backwards). Returns the number of steps taken.
create function private.vinted_advance(p_vo uuid, p_run uuid) returns int
language plpgsql security definer set search_path = public as $$
declare m vinted_orders; o orders; v_steps int := 0; v_ship timestamptz;
begin
  select * into m from vinted_orders where id = p_vo;
  select * into o from orders where id = m.order_id;
  if o.id is null or o.status = 'cancelled' or m.state = 'cancelled' then return 0; end if;
  if o.status = 'pending' and m.state in ('shipped', 'completed') then
    v_ship := least(now(), coalesce(m.shipped_at, m.completed_at, now()));
    perform public.ship_order(o.id, null, null);
    update shipments set shipped_at = v_ship where order_id = o.id;
    update items set shipped_at = v_ship where id in (select item_id from order_lines where order_id = o.id and status = 'active');
    perform private.vinted_event(m.org_id, p_run, 'order_advanced', m.id, o.id, null, m.transaction_id, null,
                                 jsonb_build_object('from', 'pending', 'to', 'shipped', 'number', o.number));
    o.status := 'shipped';
    v_steps := v_steps + 1;
  end if;
  if o.status = 'shipped' and m.state = 'completed' then
    perform public.complete_order(o.id, least(now(), coalesce(m.completed_at, now())));
    update items set completed_at = least(now(), coalesce(m.completed_at, now()))
     where id in (select item_id from order_lines where order_id = o.id and status = 'active');
    perform private.vinted_event(m.org_id, p_run, 'order_advanced', m.id, o.id, null, m.transaction_id, null,
                                 jsonb_build_object('from', 'shipped', 'to', 'completed', 'number', o.number,
                                                    'paid_at', least(now(), coalesce(m.completed_at, now()))));
    v_steps := v_steps + 1;
  end if;
  return v_steps;
end $$;

-- Once linked: follow the Vinted state, and flag a price that differs by more than 1 €
create function private.vinted_follow(p_vo uuid, p_run uuid) returns text
language plpgsql security definer set search_path = public as $$
declare m vinted_orders; o orders; v_steps int;
begin
  v_steps := private.vinted_advance(p_vo, p_run);
  select * into m from vinted_orders where id = p_vo;
  select * into o from orders where id = m.order_id;
  if m.price_cents is not null and not m.price_ack and abs(o.gross_cents - m.price_cents) > 100 then
    perform private.vinted_set_issue(m.id, 'price_diff',
      jsonb_build_object('lefort_cents', o.gross_cents, 'vinted_cents', m.price_cents, 'number', o.number));
  else
    perform private.vinted_set_issue(m.id, null);
  end if;
  return case when v_steps > 0 then 'advanced' else 'unchanged' end;
end $$;

create function private.vinted_link(p_vo uuid, p_order uuid, p_match text, p_run uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m vinted_orders; o orders; v_set_ref boolean := false;
begin
  select * into m from vinted_orders where id = p_vo;
  select * into o from orders where id = p_order for update;
  if exists (select 1 from vinted_orders x where x.order_id = p_order and x.id <> p_vo) then
    raise exception using errcode = 'LF409', message = format('La vente V-%s est déjà liée à une autre vente Vinted.', o.number);
  end if;
  if o.external_order_id is not null and o.external_order_id <> m.transaction_id then
    raise exception using errcode = 'LF409', message = format('La vente V-%s porte déjà une autre référence Vinted (%s).', o.number, o.external_order_id);
  end if;
  if o.external_order_id is null then
    update orders set external_order_id = m.transaction_id where id = p_order;
    v_set_ref := true;
  end if;
  update vinted_orders set order_id = p_order, match = p_match, decision = null, decision_note = null where id = p_vo;
  perform private.vinted_event(m.org_id, p_run, 'order_linked', m.id, p_order, null, m.transaction_id, null,
    jsonb_build_object('match', p_match, 'number', o.number, 'set_ref', v_set_ref));
end $$;

-- Records the Vinted sale on Lefort OS items that are for sale, then follows its state
create function private.vinted_record(p_vo uuid, p_items uuid[], p_historical boolean, p_run uuid, p_detail jsonb default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare m vinted_orders; v_order uuid; v_number bigint;
begin
  select * into m from vinted_orders where id = p_vo;
  v_order := public.record_sale(p_items, m.price_cents, least(now(), coalesce(m.sold_at, now())), 'vinted', m.transaction_id,
                                m.buyer, null, 0, 0, 0, 'Synchro Vinted');
  update orders set is_historical = coalesce(p_historical, false) where id = v_order returning number into v_number;
  update vinted_orders set order_id = v_order, match = case when p_detail ? 'manual' then 'confirmed' else 'created' end,
         decision = null, decision_note = null where id = p_vo;
  perform private.vinted_event(m.org_id, p_run, 'order_imported', m.id, v_order, null, m.transaction_id, null,
    jsonb_build_object('number', v_number, 'items', (select jsonb_agg(sku order by sku) from items where id = any(p_items)),
                       'historical', coalesce(p_historical, false), 'price_cents', m.price_cents) || coalesce(p_detail, '{}'));
  perform private.vinted_follow(p_vo, p_run);
  return v_order;
end $$;

-- Sales typed by hand that look like this Vinted sale: within 3 days, and the same price (±1 €) or the same buyer
create function private.vinted_order_candidates(p_vo uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(c order by c->>'rank'), '[]') from (
    select jsonb_build_object('order_id', o.id, 'number', o.number, 'sold_at', o.sold_at, 'gross_cents', o.gross_cents,
             'buyer', o.buyer_handle, 'status', o.status, 'channel', o.channel,
             'skus', (select string_agg(i.sku, ', ' order by i.sku) from order_lines ol join items i on i.id = ol.item_id
                       where ol.order_id = o.id and ol.status <> 'cancelled'),
             'rank', lpad((case when lower(o.buyer_handle) = lower(m.buyer) then 0 else 1 end)::text, 1, '0')
                     || lpad(abs(o.gross_cents - coalesce(m.price_cents, o.gross_cents))::text, 9, '0')) as c
      from vinted_orders m
      join orders o on o.org_id = m.org_id and o.status <> 'cancelled' and o.external_order_id is null
     where m.id = p_vo and m.sold_at is not null
       and not (o.id = any(m.rejected_orders))
       and not exists (select 1 from vinted_orders x where x.order_id = o.id)
       and o.sold_at between m.sold_at - interval '3 days' and m.sold_at + interval '3 days'
       and (abs(o.gross_cents - coalesce(m.price_cents, -1000)) <= 100 or (m.buyer is not null and lower(o.buyer_handle) = lower(m.buyer)))
     limit 5) x
$$;

-- Items for sale in Lefort OS that could be a Vinted item nobody linked: same brand and size, close price
create function private.vinted_item_candidates(p_org uuid, p_item jsonb) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('item_id', id, 'sku', sku, 'title', title, 'brand', brand, 'size', size_label,
                                               'price_cents', list_price_cents, 'status', status) order by score, sku), '[]')
    from (
      select i.id, i.sku, i.title, b.name as brand, i.size_label, i.list_price_cents, i.status,
             (case when nullif(trim(p_item->>'size'), '') is not null and lower(i.size_label) = lower(trim(p_item->>'size')) then 0 else 1 end) * 100000
             + abs(coalesce(i.list_price_cents, 0) - coalesce((p_item->>'price_cents')::bigint, coalesce(i.list_price_cents, 0))) / 100 as score
        from items i left join brands b on b.id = i.brand_id
       where i.org_id = p_org and i.deleted_at is null and i.status in ('listing_ready', 'listed', 'reserved')
         and not exists (select 1 from listings li where li.item_id = i.id and li.channel = 'vinted' and li.status in ('active', 'reserved'))
         and (nullif(trim(p_item->>'brand'), '') is null or lower(b.name) = lower(trim(p_item->>'brand')))
         and (nullif(trim(p_item->>'size'), '') is null or nullif(trim(p_item->>'brand'), '') is not null
              or lower(i.size_label) = lower(trim(p_item->>'size')))
       order by score, i.sku
       limit 5) c
$$;

-- ── The decision for one Vinted sale ────────────────────────────────────────────────────────────────────────────
-- Returns what happened: ignored | unchanged | advanced | linked | imported | issue
create function private.vinted_process(p_vo uuid, p_run uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  m vinted_orders; o orders; v_from date; v_ext text; v_item uuid;
  v_items uuid[] := '{}'; v_unknown text[] := '{}'; v_bad jsonb; v_cands jsonb; v_icands jsonb; v_r text;
begin
  select * into m from vinted_orders where id = p_vo for update;
  select vinted_sync_from into v_from from organizations where id = m.org_id;

  if m.decision = 'ignored' then
    perform private.vinted_set_issue(m.id, null);
    return 'ignored';
  end if;

  -- 1. already linked to an order
  if m.order_id is not null then
    select * into o from orders where id = m.order_id;
    if o.status = 'cancelled' then
      perform private.vinted_set_issue(m.id, case when m.state = 'cancelled' then null else 'voided_in_lefort' end,
                                       jsonb_build_object('number', o.number));
      return case when m.state = 'cancelled' then 'unchanged' else 'issue' end;
    end if;
    if m.state = 'cancelled' then
      perform private.vinted_set_issue(m.id, 'cancelled_on_vinted', jsonb_build_object('number', o.number, 'status', o.status));
      return 'issue';
    end if;
    return private.vinted_follow(m.id, p_run);
  end if;

  -- 2. an order already carries this transaction number (typed with its reference, or imported before)
  select * into o from orders where org_id = m.org_id and channel = 'vinted' and external_order_id = m.transaction_id
   order by (status <> 'cancelled') desc limit 1;
  if o.id is not null and not (o.id = any(m.rejected_orders)) then
    update vinted_orders set order_id = o.id, match = 'transaction' where id = m.id;
    perform private.vinted_event(m.org_id, p_run, 'order_linked', m.id, o.id, null, m.transaction_id, null,
      jsonb_build_object('match', 'transaction', 'number', o.number, 'set_ref', false));
    v_r := private.vinted_process(m.id, p_run);
    return case when v_r in ('unchanged', 'advanced') then 'linked' else v_r end;
  end if;

  if m.state = 'cancelled' then
    perform private.vinted_set_issue(m.id, null);
    return 'unchanged';
  end if;

  -- 3. the Lefort OS items behind the Vinted items
  foreach v_ext in array m.item_ids loop
    v_item := private.vinted_item_for(m.org_id, v_ext);
    if v_item is null then v_unknown := v_unknown || v_ext;
    elsif not (v_item = any(v_items)) then v_items := v_items || v_item;
    end if;
  end loop;

  -- 4. a sale typed by hand for one of these items
  if cardinality(v_items) > 0 then
    select o2.* into o from orders o2
     where o2.org_id = m.org_id and o2.status <> 'cancelled' and o2.external_order_id is null
       and not (o2.id = any(m.rejected_orders))
       and not exists (select 1 from vinted_orders x where x.order_id = o2.id)
       and exists (select 1 from order_lines ol where ol.order_id = o2.id and ol.status <> 'cancelled' and ol.item_id = any(v_items))
     order by o2.sold_at desc limit 1;
    if o.id is not null then
      perform private.vinted_link(m.id, o.id, 'listing', p_run);
      perform private.vinted_follow(m.id, p_run);
      return 'linked';
    end if;
  end if;

  -- 5. before the start date (or no start date chosen): never recorded without a decision
  if v_from is null or m.sold_at is null or (m.sold_at at time zone 'Europe/Paris')::date < v_from then
    perform private.vinted_set_issue(m.id, 'before_start', jsonb_build_object(
      'in_stock', (select coalesce(jsonb_agg(sku order by sku), '[]') from items
                    where id = any(v_items) and deleted_at is null and status in ('listing_ready', 'listed', 'reserved')),
      'unknown', cardinality(v_unknown) + case when cardinality(m.item_ids) = 0 then 1 else 0 end,
      -- a sale typed by hand that looks like it: recording it again would make a duplicate
      'orders', private.vinted_order_candidates(m.id)));
    return 'issue';
  end if;

  -- 6. every item is known: record the sale, if they are all for sale
  if cardinality(v_unknown) = 0 and cardinality(v_items) > 0 then
    select jsonb_agg(jsonb_build_object('item_id', i.id, 'sku', i.sku, 'status', i.status, 'deleted', i.deleted_at is not null,
             'orders', (select coalesce(jsonb_agg(jsonb_build_object('order_id', o3.id, 'number', o3.number, 'ref', o3.external_order_id,
                                                                    'sold_at', o3.sold_at, 'gross_cents', o3.gross_cents) order by o3.sold_at desc), '[]')
                          from orders o3 join order_lines ol on ol.order_id = o3.id
                         where ol.item_id = i.id and ol.status <> 'cancelled' and o3.status <> 'cancelled')))
      into v_bad
      from items i where i.id = any(v_items) and (i.deleted_at is not null or i.status not in ('listing_ready', 'listed', 'reserved'));
    if v_bad is not null then
      perform private.vinted_set_issue(m.id, 'item_conflict', jsonb_build_object('items', v_bad));
      return 'issue';
    end if;
    if m.price_cents is null then
      perform private.vinted_set_issue(m.id, 'missing_price', null);
      return 'issue';
    end if;
    perform private.vinted_record(m.id, v_items, false, p_run);
    return 'imported';
  end if;

  -- 7. an item is unknown: look for a sale typed by hand that looks like it, and for the items
  v_cands := private.vinted_order_candidates(m.id);
  select coalesce(jsonb_agg(jsonb_build_object('external_id', x.ext, 'title', x.it->>'title', 'brand', x.it->>'brand',
                                               'size', x.it->>'size', 'price_cents', (x.it->>'price_cents')::bigint,
                                               'candidates', private.vinted_item_candidates(m.org_id, x.it))), '[]')
    into v_icands
    from (select u.ext, coalesce((select e from jsonb_array_elements(m.items) e where e->>'id' = u.ext limit 1),
                                 jsonb_build_object('id', u.ext)) as it
            from unnest(v_unknown) u(ext)) x;
  perform private.vinted_set_issue(m.id, case when jsonb_array_length(v_cands) > 0 then 'possible_match' else 'unknown_items' end,
    jsonb_build_object('orders', v_cands, 'items', v_icands,
                       'known', (select coalesce(jsonb_agg(jsonb_build_object('item_id', id, 'sku', sku, 'status', status)), '[]')
                                   from items where id = any(v_items)),
                       'no_detail', cardinality(m.item_ids) = 0));
  return 'issue';
end $$;

-- ── Synchronisation calls (the extension) ───────────────────────────────────────────────────────────────────────
create function public.vinted_sync_start(p_source text, p_kind text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_role('manager'); v_id uuid;
begin
  if p_source not in ('auto', 'manual') or p_kind not in ('orders', 'wardrobe', 'full') then
    raise exception using errcode = 'LF422', message = 'Synchronisation inconnue.';
  end if;
  -- a run left open (browser closed mid-way) is closed as interrupted
  update vinted_sync_runs set status = 'error', finished_at = now(), error = 'Interrompue'
   where org_id = v_org and status = 'running' and started_at < now() - interval '30 minutes';
  insert into vinted_sync_runs(org_id, source, kind) values (v_org, p_source, p_kind) returning id into v_id;
  return v_id;
end $$;

create function private.vinted_run(p_run uuid, p_org uuid) returns vinted_sync_runs
language plpgsql security definer set search_path = public as $$
declare r vinted_sync_runs;
begin
  select * into r from vinted_sync_runs where id = p_run and org_id = p_org;
  if r.id is null then raise exception using errcode = 'LF404', message = 'Synchronisation introuvable.'; end if;
  if r.status <> 'running' then raise exception using errcode = 'LF409', message = 'Synchronisation déjà terminée.'; end if;
  return r;
end $$;

-- p_orders: [{ transaction_id, state, sold_at, shipped_at, completed_at, price_cents, buyer, title,
--              item_ids: [vinted listing ids], items: [{ id, title, brand, size, price_cents }] }]
-- A read with less information (no detail fetched) never erases what an earlier read found.
create function public.vinted_reconcile(p_run uuid, p_orders jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := private.require_role('manager'); s jsonb; v_id uuid; v_r text; v_tid text; v_state text;
  v_counts jsonb := '{}'; v_errors jsonb := '[]';
begin
  perform private.vinted_run(p_run, v_org);
  if jsonb_typeof(p_orders) <> 'array' or jsonb_array_length(p_orders) > 500 then
    raise exception using errcode = 'LF422', message = 'Maximum 500 ventes par envoi.';
  end if;
  -- one synchronisation at a time per business
  perform pg_advisory_xact_lock(hashtextextended('vinted_sync:' || v_org::text, 0));

  for s in select * from jsonb_array_elements(p_orders) loop
    v_tid := nullif(trim(s->>'transaction_id'), '');
    continue when v_tid is null;
    v_state := case when s->>'state' in ('pending', 'shipped', 'completed', 'cancelled') then s->>'state' else 'pending' end;
    begin
      insert into vinted_orders as m (org_id, transaction_id, state, sold_at, shipped_at, completed_at, price_cents, buyer, title,
                                      item_ids, items, last_run_id)
      values (v_org, v_tid, v_state, (nullif(s->>'sold_at', ''))::timestamptz, (nullif(s->>'shipped_at', ''))::timestamptz,
              (nullif(s->>'completed_at', ''))::timestamptz, (nullif(s->>'price_cents', ''))::bigint, nullif(trim(s->>'buyer'), ''),
              nullif(trim(s->>'title'), ''),
              coalesce((select array_agg(distinct x) from jsonb_array_elements_text(
                          case when jsonb_typeof(s->'item_ids') = 'array' then s->'item_ids' else '[]' end) x where x <> ''), '{}'),
              case when jsonb_typeof(s->'items') = 'array' then s->'items' else '[]' end, p_run)
      on conflict (org_id, transaction_id) do update set
        -- the furthest state wins; a cancellation always counts
        state = case when excluded.state = 'cancelled' or private.vinted_rank(excluded.state) > private.vinted_rank(m.state)
                     then excluded.state else m.state end,
        sold_at = coalesce(excluded.sold_at, m.sold_at),
        shipped_at = coalesce(excluded.shipped_at, m.shipped_at),
        completed_at = coalesce(excluded.completed_at, m.completed_at),
        price_cents = coalesce(excluded.price_cents, m.price_cents),
        buyer = coalesce(excluded.buyer, m.buyer),
        title = coalesce(excluded.title, m.title),
        item_ids = case when cardinality(excluded.item_ids) > 0 then excluded.item_ids else m.item_ids end,
        items = case when jsonb_array_length(excluded.items) > 0 then excluded.items else m.items end,
        last_seen_at = now(), last_run_id = p_run
      returning id into v_id;
      v_r := private.vinted_process(v_id, p_run);
      v_counts := jsonb_set(v_counts, array[v_r], to_jsonb(coalesce((v_counts->>v_r)::int, 0) + 1));
    exception when others then
      v_errors := v_errors || jsonb_build_object('transaction_id', v_tid, 'error', sqlerrm);
    end;
  end loop;
  return v_counts || jsonb_build_object('errors', v_errors);
end $$;

-- p_listings: [{ external_id, state, title, description, url, photo, price_cents, brand, size, views, favourites, offers, listed_at }]
create function public.vinted_listings_seen(p_run uuid, p_listings jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_role('manager'); l jsonb; v_ext text; v_n int := 0; v_stats int := 0;
        v_day date := (now() at time zone 'Europe/Paris')::date;
begin
  perform private.vinted_run(p_run, v_org);
  if jsonb_typeof(p_listings) <> 'array' or jsonb_array_length(p_listings) > 1000 then
    raise exception using errcode = 'LF422', message = 'Maximum 1000 annonces par envoi.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('vinted_sync:' || v_org::text, 0));
  for l in select * from jsonb_array_elements(p_listings) loop
    v_ext := nullif(trim(l->>'external_id'), '');
    continue when v_ext is null or l->>'state' = 'draft';
    insert into vinted_listings as vl (org_id, external_id, state, title, url, photo, price_cents, brand, size, sku_hint,
                                       views, favourites, offers, last_run_id)
    values (v_org, v_ext,
            case when l->>'state' in ('active', 'reserved', 'sold', 'hidden') then l->>'state' else 'active' end,
            nullif(trim(l->>'title'), ''), nullif(l->>'url', ''), nullif(l->>'photo', ''), (nullif(l->>'price_cents', ''))::bigint,
            nullif(trim(l->>'brand'), ''), nullif(trim(l->>'size'), ''),
            upper(substring(coalesce(l->>'description', '') || ' ' || coalesce(l->>'title', '')
                            from '(?i)r[ée]f(?:[ée]rence)?\.?\s*:?\s*([a-z]{1,6}-?[0-9]{1,8})\M')),
            (nullif(l->>'views', ''))::int, (nullif(l->>'favourites', ''))::int, (nullif(l->>'offers', ''))::int, p_run)
    on conflict (org_id, external_id) do update set
      state = excluded.state, title = coalesce(excluded.title, vl.title), url = coalesce(excluded.url, vl.url),
      photo = coalesce(excluded.photo, vl.photo), price_cents = coalesce(excluded.price_cents, vl.price_cents),
      brand = coalesce(excluded.brand, vl.brand), size = coalesce(excluded.size, vl.size),
      sku_hint = coalesce(excluded.sku_hint, vl.sku_hint),
      views = coalesce(excluded.views, vl.views), favourites = coalesce(excluded.favourites, vl.favourites),
      offers = coalesce(excluded.offers, vl.offers), last_seen_at = now(), last_run_id = p_run;
    if (l->>'views') is not null or (l->>'favourites') is not null then
      insert into vinted_listing_stats(org_id, external_id, day, views, favourites, offers)
      values (v_org, v_ext, v_day, (nullif(l->>'views', ''))::int, (nullif(l->>'favourites', ''))::int, (nullif(l->>'offers', ''))::int)
      on conflict (org_id, external_id, day) do update set views = excluded.views, favourites = excluded.favourites, offers = excluded.offers;
      v_stats := v_stats + 1;
    end if;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('listings', v_n, 'stats', v_stats);
end $$;

-- Links Vinted listings to Lefort OS items when it is proven: a listing link already made, or the SKU of the item
-- written in the description. A listing replacing one that disappeared (deleted then recreated on Vinted) takes its
-- place only when the whole wardrobe was read.
create function private.vinted_link_listings(p_org uuid, p_run uuid, p_complete boolean) returns int
language plpgsql security definer set search_path = public as $$
declare vl vinted_listings; v_item items; v_old listings; v_n int := 0;
begin
  -- links already proven
  update vinted_listings x set item_id = li.item_id
    from listings li
   where x.org_id = p_org and li.org_id = p_org and li.channel = 'vinted' and li.external_id = x.external_id
     and x.item_id is distinct from li.item_id;

  for vl in select * from vinted_listings
             where org_id = p_org and item_id is null and sku_hint is not null and last_run_id = p_run and state <> 'hidden' loop
    select * into v_item from items where org_id = p_org and sku = vl.sku_hint and deleted_at is null;
    continue when v_item.id is null or v_item.id = any(vl.rejected_items);
    -- the item has another live Vinted listing
    select * into v_old from listings where item_id = v_item.id and channel = 'vinted' and status in ('active', 'reserved')
     order by listed_at desc limit 1;
    if v_old.id is not null then
      -- the other one is still on Vinted (two listings for one item): leave it to the seller
      continue when not p_complete or exists (select 1 from vinted_listings o where o.org_id = p_org and o.external_id = v_old.external_id
                                                and o.last_run_id = p_run and o.state in ('active', 'reserved'));
      update listings set status = 'delisted', ended_at = now() where id = v_old.id;
    end if;
    insert into listings(org_id, item_id, channel, external_id, url, title, price_cents, status, listed_at, created_by)
    values (p_org, v_item.id, 'vinted', vl.external_id, vl.url, vl.title, nullif(vl.price_cents, 0),
            case vl.state when 'reserved' then 'reserved' when 'sold' then 'sold' else 'active' end::listing_status,
            vl.first_seen_at, auth.uid());
    update vinted_listings set item_id = v_item.id where org_id = p_org and external_id = vl.external_id;
    perform private.vinted_event(p_org, p_run, 'listing_linked', null, null, v_item.id, null, vl.external_id,
      jsonb_build_object('sku', v_item.sku, 'via', 'sku', 'replaced', v_old.external_id));
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create function public.vinted_sync_finish(p_run uuid, p_status text, p_orders_complete boolean default null,
                                          p_covered_from timestamptz default null, p_wardrobe_complete boolean default null,
                                          p_error text default null, p_diagnostic jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_role('manager'); r vinted_sync_runs; v_links int := 0; v_vo uuid; v_summary jsonb;
begin
  r := private.vinted_run(p_run, v_org);
  if p_status not in ('ok', 'partial', 'error') then
    raise exception using errcode = 'LF422', message = 'État de synchronisation inconnu.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('vinted_sync:' || v_org::text, 0));
  if r.kind in ('wardrobe', 'full') and p_status <> 'error' then
    v_links := private.vinted_link_listings(v_org, p_run, coalesce(p_wardrobe_complete, false));
  end if;
  -- new links or a new start date can settle sales that were waiting
  for v_vo in select id from vinted_orders where org_id = v_org and decision is null
                and (issue in ('unknown_items', 'possible_match', 'item_conflict', 'missing_price')) loop
    perform private.vinted_process(v_vo, p_run);
  end loop;
  select jsonb_object_agg(action, n) into v_summary
    from (select action, count(*) as n from vinted_sync_events where run_id = p_run group by action) x;
  update vinted_sync_runs set status = p_status, finished_at = now(), orders_complete = p_orders_complete,
         covered_from = p_covered_from, wardrobe_complete = p_wardrobe_complete,
         summary = coalesce(v_summary, '{}') || jsonb_build_object(
           'open_issues', (select count(*) from vinted_orders where org_id = v_org and decision is null and issue is not null and issue <> 'before_start'),
           'before_start', (select count(*) from vinted_orders where org_id = v_org and decision is null and issue = 'before_start')),
         error = left(p_error, 2000), diagnostic = p_diagnostic
   where id = p_run
   returning summary into v_summary;
  return v_summary;
end $$;

-- What the extension need not fetch again: sales final on Vinted and settled in Lefort OS (their details are known),
-- and the listings already linked to an item (their description need not be read for a « Réf. »)
create function public.vinted_known(p_since timestamptz default null) returns jsonb
language sql stable security definer set search_path = public as $$
  with o as (select private.require_role('manager') as org)
  select jsonb_build_object(
    'settled', (select coalesce(jsonb_agg(m.transaction_id), '[]')
                  from vinted_orders m join o on m.org_id = o.org left join orders od on od.id = m.order_id
                 where (p_since is null or m.sold_at >= p_since)
                   and m.state in ('completed', 'cancelled') and cardinality(m.item_ids) > 0
                   and (m.decision = 'ignored' or (od.id is not null and (od.status = 'cancelled' or od.status::text = m.state)))),
    'linked', (select coalesce(jsonb_agg(distinct li.external_id), '[]')
                 from listings li join o on li.org_id = o.org
                where li.channel = 'vinted' and li.external_id is not null),
    'sync_from', (select vinted_sync_from from organizations join o on id = o.org))
$$;

-- ── Decisions (the reconciliation page) ─────────────────────────────────────────────────────────────────────────
create function public.vinted_set_sync_from(p_date date) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_role('manager');
begin
  if p_date is not null and (p_date > (now() at time zone 'Europe/Paris')::date + 1 or p_date < date '2015-01-01') then
    raise exception using errcode = 'LF422', message = 'Date de début invalide.';
  end if;
  update organizations set vinted_sync_from = p_date where id = v_org;
  -- sales that were waiting for a start date are looked at again
  perform pg_advisory_xact_lock(hashtextextended('vinted_sync:' || v_org::text, 0));
  perform private.vinted_process(id, null) from vinted_orders
   where org_id = v_org and decision is null and order_id is null and issue = 'before_start';
end $$;

-- p_action:
--   link_order {order_id}       this Vinted sale is that sale typed by hand
--   assign_items {items: [{external_id, item_id}]}   these Lefort OS items are the unknown Vinted items
--   create_items {historical}   the items were never in Lefort OS: create them (sold outside the stock)
--   import {historical}         record a sale from before the start date (items known and for sale)
--   cancel_in_lefort            cancelled on Vinted: cancel the Lefort OS sale (not shipped yet)
--   use_vinted_price            replace the price typed by hand with the Vinted price
--   accept_price                keep the Lefort OS price
--   reimport                    a sale deleted in Lefort OS that is real after all: record it again
--   ignore {note} / unignore
create function public.vinted_resolve(p_id uuid, p_action text, p_args jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := private.require_role('manager'); m vinted_orders; o orders; a jsonb; v_item items; v_ext text;
  v_items uuid[] := '{}'; v_r text; v_order uuid; v_import jsonb; v_lines jsonb; v_created jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('vinted_sync:' || v_org::text, 0));
  select * into m from vinted_orders where id = p_id and org_id = v_org for update;
  if m.id is null then raise exception using errcode = 'LF404', message = 'Vente Vinted introuvable.'; end if;
  p_args := coalesce(p_args, '{}');

  if p_action = 'ignore' then
    update vinted_orders set decision = 'ignored', decision_note = left(nullif(trim(p_args->>'note'), ''), 300),
           decided_at = now(), decided_by = auth.uid(), issue = null, candidates = null where id = m.id;
    perform private.vinted_event(v_org, null, 'ignored', m.id, m.order_id, null, m.transaction_id, null,
                                 jsonb_build_object('note', p_args->>'note', 'issue', m.issue));
    return jsonb_build_object('result', 'ignored');
  end if;
  if p_action = 'unignore' then
    update vinted_orders set decision = null, decision_note = null, decided_at = now(), decided_by = auth.uid() where id = m.id;
    perform private.vinted_event(v_org, null, 'unignored', m.id, m.order_id, null, m.transaction_id, null);
    return jsonb_build_object('result', private.vinted_process(m.id, null));
  end if;
  if m.decision = 'ignored' then
    raise exception using errcode = 'LF409', message = 'Cette vente Vinted est ignorée : rétablissez-la d''abord.';
  end if;

  if p_action = 'link_order' then
    if m.order_id is not null then
      raise exception using errcode = 'LF409', message = 'Cette vente Vinted est déjà liée.';
    end if;
    select * into o from orders where id = (p_args->>'order_id')::uuid and org_id = v_org;
    if o.id is null or o.status = 'cancelled' then
      raise exception using errcode = 'LF404', message = 'Vente Lefort OS introuvable ou annulée.';
    end if;
    perform private.vinted_link(m.id, o.id, 'confirmed', null);
    perform private.vinted_follow(m.id, null);
    return jsonb_build_object('result', 'linked', 'number', o.number);
  end if;

  if p_action = 'assign_items' then
    if m.order_id is not null then
      raise exception using errcode = 'LF409', message = 'Cette vente Vinted est déjà liée.';
    end if;
    for a in select * from jsonb_array_elements(coalesce(p_args->'items', '[]')) loop
      v_ext := a->>'external_id';
      if not (v_ext = any(m.item_ids)) then
        raise exception using errcode = 'LF422', message = 'Article Vinted inconnu dans cette vente.';
      end if;
      select * into v_item from items where id = (a->>'item_id')::uuid and org_id = v_org and deleted_at is null;
      if v_item.id is null then raise exception using errcode = 'LF404', message = 'Article Lefort OS introuvable.'; end if;
      if private.vinted_item_for(v_org, v_ext) is not null and private.vinted_item_for(v_org, v_ext) <> v_item.id then
        raise exception using errcode = 'LF409', message = format('L''annonce Vinted %s est déjà liée à un autre article.', v_ext);
      end if;
      if private.vinted_item_for(v_org, v_ext) is null then
        update listings set status = 'delisted', ended_at = now()
         where item_id = v_item.id and channel = 'vinted' and status in ('active', 'reserved') and external_id is distinct from v_ext;
        insert into listings(org_id, item_id, channel, external_id, url, title, price_cents, status, listed_at, created_by)
        values (v_org, v_item.id, 'vinted', v_ext, 'https://www.vinted.fr/items/' || v_ext,
                (select e->>'title' from jsonb_array_elements(m.items) e where e->>'id' = v_ext limit 1),
                coalesce(v_item.list_price_cents, null), 'active', least(now(), coalesce(v_item.listed_at, now())), auth.uid());
        update vinted_listings set item_id = v_item.id where org_id = v_org and external_id = v_ext;
        perform private.vinted_event(v_org, null, 'listing_linked', m.id, null, v_item.id, m.transaction_id, v_ext,
                                     jsonb_build_object('sku', v_item.sku, 'via', 'decision'));
      end if;
    end loop;
    -- with the items known, the usual rules apply (a sale typed by hand for them is linked, else recorded)
    v_r := private.vinted_process(m.id, null);
    select * into m from vinted_orders where id = m.id;
    return jsonb_build_object('result', v_r, 'issue', m.issue);
  end if;

  if p_action in ('create_items', 'import') then
    if m.order_id is not null then
      raise exception using errcode = 'LF409', message = 'Cette vente Vinted est déjà enregistrée.';
    end if;
    if not coalesce((p_args->>'force')::boolean, false) and jsonb_array_length(private.vinted_order_candidates(m.id)) > 0 then
      raise exception using errcode = 'LF409',
        message = 'Une vente saisie à la main ressemble à celle-ci : liez-la plutôt que d''en créer une deuxième.';
    end if;
    if m.price_cents is null then
      raise exception using errcode = 'LF422', message = 'Prix de vente inconnu : saisissez cette vente à la main dans Ventes.';
    end if;
    foreach v_ext in array m.item_ids loop
      v_items := v_items || private.vinted_item_for(v_org, v_ext);
    end loop;
    if p_action = 'import' then
      if cardinality(m.item_ids) = 0 or array_position(v_items, null) is not null then
        raise exception using errcode = 'LF409', message = 'Des articles de cette vente sont inconnus : choisissez-les ou créez-les.';
      end if;
      perform private.vinted_record(m.id, v_items, coalesce((p_args->>'historical')::boolean, false), null,
                                    jsonb_build_object('manual', true));
      return jsonb_build_object('result', 'imported');
    end if;
    -- create_items: known items are used, unknown ones are created (outside the purchases, cost to fill in)
    if array_position(v_items, null) is null and cardinality(m.item_ids) > 0 then
      raise exception using errcode = 'LF409', message = 'Tous les articles sont connus : utilisez « Enregistrer ».';
    end if;
    select jsonb_agg(jsonb_build_object(
             'sku', (select i.sku from items i where i.id = private.vinted_item_for(v_org, x.ext)),
             'title', coalesce(x.it->>'title', m.title), 'brand', x.it->>'brand', 'size', x.it->>'size',
             'price_cents', x.share,
             'vinted_url', 'https://www.vinted.fr/items/' || x.ext))
      into v_lines
      from (
        select u.ext, u.n, coalesce((select e from jsonb_array_elements(m.items) e where e->>'id' = u.ext limit 1), '{}') as it,
               -- the price shared out evenly; the first line takes the rounding
               (m.price_cents / greatest(cardinality(m.item_ids), 1))
                 + case when u.n = 1 then m.price_cents - (m.price_cents / greatest(cardinality(m.item_ids), 1)) * greatest(cardinality(m.item_ids), 1) else 0 end as share
          from unnest(m.item_ids) with ordinality u(ext, n)) x;
    if v_lines is null then
      -- no detail of the items: one item, named after the sale
      v_lines := jsonb_build_array(jsonb_build_object('title', coalesce(m.title, 'Vente Vinted ' || m.transaction_id), 'price_cents', m.price_cents));
    end if;
    v_import := public.import_sales(jsonb_build_array(jsonb_build_object(
                  'sold_at', m.sold_at, 'paid_at', m.completed_at, 'buyer', m.buyer, 'order_ref', m.transaction_id, 'lines', v_lines)),
                  coalesce((p_args->>'historical')::boolean, false), 'pending');
    if jsonb_array_length(v_import->'errors') > 0 then
      raise exception using errcode = 'LF409', message = v_import->'errors'->0->>'error';
    end if;
    select * into o from orders where org_id = v_org and channel = 'vinted' and external_order_id = m.transaction_id and status <> 'cancelled';
    select jsonb_agg(i.id) into v_created from order_lines ol join items i on i.id = ol.item_id
     where ol.order_id = o.id and i.notes = 'Créé par l''import des ventes';
    update vinted_orders set order_id = o.id, match = 'confirmed' where id = m.id;
    perform private.vinted_event(v_org, null, 'order_imported', m.id, o.id, null, m.transaction_id, null,
      jsonb_build_object('number', o.number, 'created_items', coalesce(v_created, '[]'), 'manual', true,
                         'historical', coalesce((p_args->>'historical')::boolean, false), 'price_cents', m.price_cents,
                         'items', (select jsonb_agg(i.sku order by i.sku) from order_lines ol join items i on i.id = ol.item_id where ol.order_id = o.id)));
    perform private.vinted_follow(m.id, null);
    return jsonb_build_object('result', 'imported', 'number', o.number, 'created', jsonb_array_length(coalesce(v_created, '[]')));
  end if;

  if p_action = 'cancel_in_lefort' then
    select * into o from orders where id = m.order_id;
    if m.state <> 'cancelled' or o.id is null then
      raise exception using errcode = 'LF409', message = 'Cette vente n''est pas annulée sur Vinted.';
    end if;
    if o.status <> 'pending' then
      raise exception using errcode = 'LF409',
        message = format('V-%s est déjà expédiée : enregistrez le retour ou le remboursement depuis Ventes.', o.number);
    end if;
    perform public.cancel_order(o.id, 'Annulée sur Vinted');
    perform private.vinted_event(v_org, null, 'order_cancelled', m.id, o.id, null, m.transaction_id, null, jsonb_build_object('number', o.number));
    perform private.vinted_set_issue(m.id, null);
    return jsonb_build_object('result', 'cancelled', 'number', o.number);
  end if;

  if p_action in ('accept_price', 'use_vinted_price') then
    select * into o from orders where id = m.order_id;
    if m.issue is distinct from 'price_diff' or o.id is null then
      raise exception using errcode = 'LF409', message = 'Pas d''écart de prix sur cette vente.';
    end if;
    if p_action = 'accept_price' then
      update vinted_orders set price_ack = true where id = m.id;
      perform private.vinted_set_issue(m.id, null);
      return jsonb_build_object('result', 'accepted');
    end if;
    if exists (select 1 from refunds where order_id = o.id) then
      raise exception using errcode = 'LF409', message = 'Cette vente a un remboursement : corrigez-la depuis Ventes.';
    end if;
    -- the sale typed by hand is removed and recorded again with the Vinted price, at the same state
    select array_agg(item_id) into v_items from order_lines where order_id = o.id and status <> 'cancelled';
    perform public.void_order(o.id, 'Remplacée par le prix Vinted');
    update vinted_orders set order_id = null, match = null where id = m.id;
    v_order := private.vinted_record(m.id, v_items, o.is_historical, null,
                                     jsonb_build_object('manual', true, 'replaces', o.number, 'old_cents', o.gross_cents));
    perform private.vinted_event(v_org, null, 'price_replaced', m.id, v_order, null, m.transaction_id, null,
      jsonb_build_object('old_number', o.number, 'old_cents', o.gross_cents, 'new_cents', m.price_cents));
    return jsonb_build_object('result', 'replaced');
  end if;

  if p_action = 'reimport' then
    select * into o from orders where id = m.order_id;
    if o.id is null or o.status <> 'cancelled' then
      raise exception using errcode = 'LF409', message = 'Cette vente n''a pas été supprimée dans Lefort OS.';
    end if;
    update vinted_orders set order_id = null, match = null, rejected_orders = array_append(rejected_orders, o.id) where id = m.id;
    v_r := private.vinted_process(m.id, null);
    select * into m from vinted_orders where id = m.id;
    return jsonb_build_object('result', v_r, 'issue', m.issue);
  end if;

  raise exception using errcode = 'LF422', message = 'Action inconnue.';
end $$;

-- Undoes what the synchronisation did: a sale it recorded (the sale is removed, its items go back on sale, items it
-- created are deleted, and the Vinted sale is set aside so the next synchronisation does not record it again), a link
-- it made (it will never be made again), a listing it linked.
create function public.vinted_undo(p_event uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_role('manager'); e vinted_sync_events; o orders; v_created uuid[];
begin
  perform pg_advisory_xact_lock(hashtextextended('vinted_sync:' || v_org::text, 0));
  select * into e from vinted_sync_events where id = p_event and org_id = v_org for update;
  if e.id is null then raise exception using errcode = 'LF404', message = 'Action introuvable.'; end if;
  if e.undone_at is not null then raise exception using errcode = 'LF409', message = 'Déjà annulée.'; end if;

  if e.action = 'order_imported' then
    select * into o from orders where id = e.order_id;
    if o.status <> 'cancelled' then
      if exists (select 1 from refunds where order_id = o.id) then
        raise exception using errcode = 'LF409', message = 'Cette vente a un remboursement : annulez-la depuis Ventes.';
      end if;
      perform public.void_order(o.id, 'Import Vinted annulé');
    end if;
    select array_agg(x::uuid) into v_created from jsonb_array_elements_text(coalesce(e.detail->'created_items', '[]')) x;
    if cardinality(v_created) > 0 then
      perform public.delete_items(v_created, 'Import Vinted annulé', false);
    end if;
    -- set aside: the next synchronisation will not record it again (« Rétablir » does, on a new sale)
    update vinted_orders set decision = 'ignored', decision_note = 'Import annulé', decided_at = now(), decided_by = auth.uid(),
           order_id = null, match = null, rejected_orders = array_append(rejected_orders, o.id),
           issue = null, candidates = null where id = e.vinted_order_id;
  elsif e.action = 'order_linked' then
    select * into o from orders where id = e.order_id;
    -- the link was wrong, so is the Vinted number on that sale (typed by hand or set by the link)
    if o.external_order_id = e.transaction_id then
      update orders set external_order_id = null where id = o.id;
    end if;
    update vinted_orders set order_id = null, match = null, rejected_orders = array_append(rejected_orders, o.id)
     where id = e.vinted_order_id;
    perform private.vinted_process(e.vinted_order_id, null);
  elsif e.action = 'listing_linked' then
    if exists (select 1 from order_lines ol join orders od on od.id = ol.order_id
                where ol.item_id = e.item_id and od.external_order_id is not null and od.status <> 'cancelled'
                  and od.external_order_id in (select transaction_id from vinted_orders where org_id = v_org and e.external_id = any(item_ids))) then
      raise exception using errcode = 'LF409', message = 'Une vente Vinted utilise ce lien : annulez d''abord la vente.';
    end if;
    delete from listings where org_id = v_org and channel = 'vinted' and external_id = e.external_id and item_id = e.item_id;
    update vinted_listings set item_id = null, rejected_items = array_append(rejected_items, e.item_id)
     where org_id = v_org and external_id = e.external_id;
  elsif e.action = 'ignored' then
    update vinted_orders set decision = null, decision_note = null where id = e.vinted_order_id;
    perform private.vinted_process(e.vinted_order_id, null);
  else
    raise exception using errcode = 'LF409', message = 'Cette action ne peut pas être annulée.';
  end if;
  update vinted_sync_events set undone_at = now(), undone_by = auth.uid() where id = e.id;
  perform private.vinted_event(v_org, null, 'undone', e.vinted_order_id, e.order_id, e.item_id, e.transaction_id, e.external_id,
                               jsonb_build_object('event', e.id, 'action', e.action));
  return jsonb_build_object('result', 'undone', 'action', e.action);
end $$;

-- A listing link typed from the page (« Annonces en ligne sans lien Vinted »): a Vinted link or number
create function public.vinted_link_item(p_item_id uuid, p_ref text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_role('manager'); v_ext text; v_item items; v_other uuid; vl vinted_listings;
begin
  v_ext := coalesce(substring(p_ref from 'vinted\.[a-z.]+/items/([0-9]+)'), substring(trim(p_ref) from '^([0-9]{4,20})$'));
  if v_ext is null then raise exception using errcode = 'LF422', message = 'Collez le lien de l''annonce Vinted (vinted.fr/items/…).'; end if;
  select * into v_item from items where id = p_item_id and org_id = v_org and deleted_at is null;
  if v_item.id is null then raise exception using errcode = 'LF404', message = 'Article introuvable.'; end if;
  v_other := private.vinted_item_for(v_org, v_ext);
  if v_other is not null and v_other <> v_item.id then
    raise exception using errcode = 'LF409', message = format('Cette annonce est déjà liée à %s.', (select sku from items where id = v_other));
  end if;
  if v_other is null then
    select * into vl from vinted_listings where org_id = v_org and external_id = v_ext;
    update listings set status = 'delisted', ended_at = now()
     where item_id = v_item.id and channel = 'vinted' and status in ('active', 'reserved');
    insert into listings(org_id, item_id, channel, external_id, url, title, price_cents, status, listed_at, created_by)
    values (v_org, v_item.id, 'vinted', v_ext, coalesce(vl.url, 'https://www.vinted.fr/items/' || v_ext), coalesce(vl.title, v_item.title),
            coalesce(nullif(vl.price_cents, 0), v_item.list_price_cents),
            case vl.state when 'reserved' then 'reserved' when 'sold' then 'sold' else 'active' end::listing_status,
            least(now(), coalesce(v_item.listed_at, now())), auth.uid());
    update vinted_listings set item_id = v_item.id where org_id = v_org and external_id = v_ext;
    perform private.vinted_event(v_org, null, 'listing_linked', null, null, v_item.id, null, v_ext,
                                 jsonb_build_object('sku', v_item.sku, 'via', 'page'));
  end if;
  -- Vinted sales waiting for this listing can now be settled
  perform private.vinted_process(id, null) from vinted_orders
   where org_id = v_org and decision is null and order_id is null and v_ext = any(item_ids);
  return jsonb_build_object('result', 'linked', 'external_id', v_ext);
end $$;

-- A Lefort OS sale on the Vinted channel that is rightly not on Vinted
create function public.vinted_ack_order(p_order_id uuid, p_reason text default null, p_undo boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_role('manager');
begin
  if not exists (select 1 from orders where id = p_order_id and org_id = v_org) then
    raise exception using errcode = 'LF404', message = 'Vente introuvable.';
  end if;
  if p_undo then
    delete from vinted_ignored_orders where order_id = p_order_id and org_id = v_org;
  else
    insert into vinted_ignored_orders(order_id, org_id, reason) values (p_order_id, v_org, left(nullif(trim(p_reason), ''), 300))
    on conflict (order_id) do nothing;
  end if;
end $$;

-- ── What the pages show ─────────────────────────────────────────────────────────────────────────────────────────
-- Small: the dashboard alerts
create function public.vinted_sync_status() returns jsonb
language sql stable security definer set search_path = public as $$
  with o as (select private.require_role('manager') as org)
  select jsonb_build_object(
    'sync_from', (select vinted_sync_from from organizations, o where id = o.org),
    'ever', exists (select 1 from vinted_sync_runs r, o where r.org_id = o.org),
    'last_ok_at', (select max(finished_at) from vinted_sync_runs r, o where r.org_id = o.org and r.status in ('ok', 'partial')),
    'last_run', (select jsonb_build_object('id', id, 'source', source, 'kind', kind, 'started_at', started_at, 'finished_at', finished_at,
                                            'status', status, 'error', error, 'summary', summary)
                   from vinted_sync_runs r, o where r.org_id = o.org order by started_at desc limit 1),
    'open_issues', (select count(*) from vinted_orders m, o where m.org_id = o.org and m.decision is null and m.issue is not null
                      and m.issue <> 'before_start'),
    'before_start', (select count(*) from vinted_orders m, o where m.org_id = o.org and m.decision is null and m.issue = 'before_start'))
$$;

-- The reconciliation page: what needs a decision, what agrees, what is on one side only, listings without a link
create function public.vinted_reconciliation(p_days int default 90) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := private.require_role('manager'); v_since timestamptz := now() - make_interval(days => least(greatest(p_days, 7), 730));
  v_cover timestamptz; r jsonb;
begin
  -- Lefort OS sales can only be called missing on Vinted over a period a complete read covered
  select greatest(covered_from, v_since) into v_cover from vinted_sync_runs
   where org_id = v_org and orders_complete and status in ('ok', 'partial') and covered_from is not null
   order by finished_at desc limit 1;

  with mo as (
    select m.*, o.number, o.status as order_status, o.gross_cents, o.sold_at as order_sold_at, o.is_historical
      from vinted_orders m left join orders o on o.id = m.order_id
     where m.org_id = v_org
  ),
  view_items as (
    -- the Vinted items of a sale, with their Lefort OS item when known
    select mo.id, jsonb_agg(jsonb_build_object('external_id', x.ext,
             'title', coalesce((select e->>'title' from jsonb_array_elements(mo.items) e where e->>'id' = x.ext limit 1), ''),
             'sku', i.sku, 'item_id', i.id, 'status', i.status,
             'photo', (select vl.photo from vinted_listings vl where vl.org_id = v_org and vl.external_id = x.ext)) order by x.n) as items
      from mo cross join lateral unnest(mo.item_ids) with ordinality x(ext, n)
      left join items i on i.id = private.vinted_item_for(v_org, x.ext)
     group by mo.id
  )
  select jsonb_build_object(
    'since', v_since,
    'covered_from', v_cover,
    'issues', coalesce((select jsonb_agg(jsonb_build_object(
        'id', mo.id, 'transaction_id', mo.transaction_id, 'state', mo.state, 'sold_at', mo.sold_at, 'price_cents', mo.price_cents,
        'buyer', mo.buyer, 'title', mo.title, 'issue', mo.issue, 'issue_since', mo.issue_since, 'candidates', mo.candidates,
        'order', case when mo.order_id is null then null else jsonb_build_object('id', mo.order_id, 'number', mo.number,
                   'status', mo.order_status, 'gross_cents', mo.gross_cents) end,
        'items', coalesce(vi.items, '[]')) order by mo.sold_at desc nulls last)
      from mo left join view_items vi on vi.id = mo.id
     where mo.decision is null and mo.issue is not null and mo.issue <> 'before_start'), '[]'),
    'before_start', jsonb_build_object(
      'count', (select count(*) from mo where mo.decision is null and mo.issue = 'before_start'),
      'in_stock', (select count(*) from mo where mo.decision is null and mo.issue = 'before_start'
                     and jsonb_array_length(coalesce(mo.candidates->'in_stock', '[]')) > 0),
      'rows', coalesce((select jsonb_agg(jsonb_build_object('id', mo.id, 'transaction_id', mo.transaction_id, 'state', mo.state,
                 'sold_at', mo.sold_at, 'price_cents', mo.price_cents, 'buyer', mo.buyer, 'title', mo.title,
                 'in_stock', mo.candidates->'in_stock', 'orders', coalesce(mo.candidates->'orders', '[]'),
                 'items', coalesce(vi.items, '[]')) order by mo.sold_at desc nulls last)
          from (select * from mo where mo.decision is null and mo.issue = 'before_start' order by mo.sold_at desc nulls last limit 300) mo
          left join view_items vi on vi.id = mo.id), '[]')),
    'matched', jsonb_build_object(
      'count', (select count(*) from mo where mo.order_id is not null and mo.issue is null and mo.decision is null and mo.sold_at >= v_since),
      'rows', coalesce((select jsonb_agg(jsonb_build_object('id', mo.id, 'transaction_id', mo.transaction_id, 'state', mo.state,
                 'sold_at', mo.sold_at, 'price_cents', mo.price_cents, 'title', mo.title, 'number', mo.number,
                 'order_status', mo.order_status, 'match', mo.match) order by mo.sold_at desc)
          from (select * from mo where mo.order_id is not null and mo.issue is null and mo.decision is null and mo.sold_at >= v_since
                 order by mo.sold_at desc limit 150) mo), '[]')),
    'ignored', coalesce((select jsonb_agg(jsonb_build_object('id', mo.id, 'transaction_id', mo.transaction_id, 'sold_at', mo.sold_at,
                 'price_cents', mo.price_cents, 'title', mo.title, 'note', mo.decision_note, 'decided_at', mo.decided_at) order by mo.decided_at desc)
          from (select * from mo where mo.decision = 'ignored' order by mo.decided_at desc limit 100) mo), '[]'),
    -- in Lefort OS, Vinted channel, over the covered period, and not found on Vinted
    'lefort_only', case when v_cover is null then null else coalesce((select jsonb_agg(jsonb_build_object(
        'order_id', o.id, 'number', o.number, 'sold_at', o.sold_at, 'gross_cents', o.gross_cents, 'status', o.status,
        'buyer', o.buyer_handle, 'ref', o.external_order_id,
        'skus', (select string_agg(i.sku, ', ' order by i.sku) from order_lines ol join items i on i.id = ol.item_id
                  where ol.order_id = o.id and ol.status <> 'cancelled')) order by o.sold_at desc)
      from orders o
     where o.org_id = v_org and o.channel = 'vinted' and o.status <> 'cancelled' and not o.is_historical
       and o.sold_at >= v_cover and o.sold_at < now() - interval '2 hours'
       and not exists (select 1 from vinted_orders m where m.order_id = o.id)
       and not exists (select 1 from vinted_ignored_orders g where g.order_id = o.id)), '[]') end,
    -- listings marked sold on Vinted whose item is still for sale in Lefort OS, and no Vinted sale read for it
    'sold_listings', coalesce((select jsonb_agg(jsonb_build_object('external_id', vl.external_id, 'title', vl.title, 'url', vl.url,
        'photo', vl.photo, 'price_cents', vl.price_cents, 'sku', i.sku, 'item_id', i.id, 'last_seen_at', vl.last_seen_at)
        order by vl.last_seen_at desc)
      from vinted_listings vl join items i on i.id = vl.item_id
     where vl.org_id = v_org and vl.state = 'sold' and i.deleted_at is null and i.status in ('listing_ready', 'listed', 'reserved')
       and not exists (select 1 from vinted_orders m where m.org_id = v_org and vl.external_id = any(m.item_ids))), '[]'),
    -- items on sale in Lefort OS with no live Vinted listing, and the Vinted listings nobody linked that look like them
    'unlinked', coalesce((select jsonb_agg(jsonb_build_object('item_id', i.id, 'sku', i.sku, 'title', i.title, 'brand', b.name,
        'size', i.size_label, 'price_cents', i.list_price_cents, 'listed_at', i.listed_at,
        'suggestions', (select coalesce(jsonb_agg(jsonb_build_object('external_id', vl.external_id, 'title', vl.title, 'url', vl.url,
                                'photo', vl.photo, 'price_cents', vl.price_cents) order by abs(coalesce(vl.price_cents, 0) - coalesce(i.list_price_cents, 0))), '[]')
                          from (select * from vinted_listings vl
                                 where vl.org_id = v_org and vl.item_id is null and vl.state in ('active', 'reserved')
                                   and not (i.id = any(vl.rejected_items))
                                   and (b.name is null or vl.brand is null or lower(vl.brand) = lower(b.name))
                                   and (i.size_label is null or vl.size is null or lower(vl.size) = lower(i.size_label))
                                 order by abs(coalesce(vl.price_cents, 0) - coalesce(i.list_price_cents, 0)) limit 3) vl)) order by i.sku)
      from (select * from items i
             where i.org_id = v_org and i.deleted_at is null and i.status in ('listed', 'reserved')
               and not exists (select 1 from listings li where li.item_id = i.id and li.channel = 'vinted' and li.status in ('active', 'reserved'))
             order by i.sku limit 200) i
      left join brands b on b.id = i.brand_id), '[]'),
    'unlinked_count', (select count(*) from items i where i.org_id = v_org and i.deleted_at is null and i.status in ('listed', 'reserved')
               and not exists (select 1 from listings li where li.item_id = i.id and li.channel = 'vinted' and li.status in ('active', 'reserved'))),
    'vinted_unlinked', (select count(*) from vinted_listings vl where vl.org_id = v_org and vl.item_id is null and vl.state in ('active', 'reserved')),
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'at', e.at, 'action', e.action, 'detail', e.detail,
        'transaction_id', e.transaction_id, 'external_id', e.external_id, 'order_id', e.order_id, 'undone_at', e.undone_at,
        'auto', e.run_id is not null and (select source from vinted_sync_runs r where r.id = e.run_id) = 'auto',
        'sku', (select sku from items where id = e.item_id)) order by e.at desc)
      from (select * from vinted_sync_events where org_id = v_org order by at desc limit 60) e), '[]'),
    'runs', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'source', source, 'kind', kind, 'started_at', started_at,
        'finished_at', finished_at, 'status', status, 'error', error, 'summary', summary) order by started_at desc)
      from (select * from vinted_sync_runs where org_id = v_org order by started_at desc limit 10) x), '[]')
  ) into r;
  -- the status first: its counters must not replace the detailed blocks of the page (before_start)
  return public.vinted_sync_status() || r;
end $$;

-- ── The wardrobe import never creates an item that is already in Lefort OS ─────────────────────────────────────
-- Same function as before, plus: a listing whose description carries the « Réf. » of an existing item (or that the
-- synchronisation linked) is skipped and reported, instead of creating a second item.
create or replace function public.vinted_import(p_listings jsonb, p_cost_cents_each bigint default 0) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := private.require_role('manager');
  v_supplier uuid; v_batch uuid; v_loc uuid; v_item items; v_sku text; s jsonb; v_out jsonb := '[]'; v_n int := 0;
  v_state text; v_when timestamptz; v_skipped jsonb := '[]';
begin
  if p_cost_cents_each < 0 then raise exception using errcode = 'LF422', message = 'Coût invalide.'; end if;

  insert into locations(org_id, code, label, kind, pick_order)
  values (v_org, 'EMP-A-ETIQUETER', 'Importé de Vinted : à étiqueter et ranger', 'staging', 0)
  on conflict (org_id, code) do nothing;
  select id into v_loc from locations where org_id = v_org and code = 'EMP-A-ETIQUETER';

  insert into suppliers(org_id, name, notes) values (v_org, 'Stock existant', 'Articles déjà en ligne avant Lefort OS')
  on conflict (org_id, lower(name)) do nothing;
  select id into v_supplier from suppliers where org_id = v_org and lower(name) = 'stock existant';

  select id into v_batch from batches where org_id = v_org and kind = 'opening_stock' and status = 'open'
   order by created_at desc limit 1;
  if v_batch is null then
    insert into batches(org_id, code, supplier_id, purchased_at, allocation_method, kind, notes, created_by)
    values (v_org, 'LOT-VINTED-' || to_char(now() at time zone 'Europe/Paris', 'YYYYMMDD-HH24MI'), v_supplier,
            current_date, 'equal', 'opening_stock', 'Import du dressing Vinted (coût estimé)', auth.uid())
    returning id into v_batch;
  end if;

  for s in select * from jsonb_array_elements(p_listings) loop
    v_state := s->>'state';
    continue when coalesce(s->>'external_id', '') = '' or v_state not in ('active', 'reserved');
    continue when exists (select 1 from listings where org_id = v_org and channel = 'vinted' and external_id = s->>'external_id');
    -- an item already in Lefort OS (its « Réf. » in the description, or linked by the synchronisation) is never created twice
    if exists (select 1 from vinted_listings vl where vl.org_id = v_org and vl.external_id = s->>'external_id' and vl.item_id is not null)
       or exists (select 1 from items i where i.org_id = v_org and i.deleted_at is null
                     and i.sku = upper(substring(coalesce(s->>'description', '') || ' ' || coalesce(s->>'title', '')
                                                 from '(?i)r[ée]f(?:[ée]rence)?\.?\s*:?\s*([a-z]{1,6}-?[0-9]{1,8})\M'))) then
      v_skipped := v_skipped || to_jsonb(s->>'external_id');
      continue;
    end if;

    select x into v_sku from public.issue_sku_labels(v_batch, 1) x;
    v_when := coalesce((s->>'listed_at')::timestamptz, now());
    insert into items(org_id, sku, batch_id, status, status_changed_at, category_id, brand_id, size_label, condition,
                      title, description, list_price_cents, current_location_id, received_at, listed_at, created_by, notes)
    values (v_org, v_sku, v_batch, case when v_state = 'reserved' then 'reserved' else 'listed' end::item_status, now(),
            private.guess_category(v_org, s->>'title'), private.brand_for(v_org, s->>'brand'),
            nullif(trim(s->>'size'), ''), (nullif(s->>'condition', ''))::item_condition,
            nullif(s->>'title', ''), nullif(s->>'description', ''), nullif((s->>'price_cents')::bigint, 0),
            v_loc, v_when, v_when, auth.uid(), 'Importé de Vinted')
    returning * into v_item;

    insert into listings(org_id, item_id, channel, external_id, url, title, description, price_cents, status, listed_at, created_by)
    values (v_org, v_item.id, 'vinted', s->>'external_id', s->>'url', v_item.title, v_item.description, v_item.list_price_cents,
            case when v_state = 'reserved' then 'reserved' else 'active' end::listing_status, v_when, auth.uid());
    insert into item_location_moves(org_id, item_id, to_location_id, method, moved_by)
    values (v_org, v_item.id, v_loc, 'auto', auth.uid());
    insert into item_events(org_id, item_id, type, to_status, station, actor_id, payload)
    values (v_org, v_item.id, 'imported', v_item.status, 'vinted_import', auth.uid(),
            jsonb_build_object('source', 'vinted', 'external_id', s->>'external_id'));

    v_n := v_n + 1;
    v_out := v_out || jsonb_build_object('external_id', s->>'external_id', 'item_id', v_item.id, 'sku', v_sku,
                                         'photos', coalesce(s->'photos', '[]'));
  end loop;

  -- estimated cost of the imported stock, split equally over the batch
  if v_n > 0 and p_cost_cents_each > 0 then
    insert into batch_cost_lines(org_id, batch_id, kind, amount_cents, description, created_by)
    values (v_org, v_batch, 'goods', p_cost_cents_each * v_n, format('Coût estimé : %s articles importés de Vinted', v_n), auth.uid());
  end if;
  update batches set expected_qty = (select count(*) from items where batch_id = v_batch) where id = v_batch;

  return jsonb_build_object('batch_id', v_batch, 'imported', v_out, 'skipped', v_skipped);
end $$;

-- ── Finance: the items behind a stock figure now carry their Vinted audience (views, favourites, offers) ────────
create or replace function public.finance_items(p_view text, p_min int default null, p_max int default null,
                                     p_sort text default 'cost', p_limit int default 50, p_offset int default 0) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_org uuid := public.auth_org_id();
  o organizations;
  r jsonb;
begin
  if v_org is null or not public.is_manager() then
    raise exception using errcode = 'LF403', message = 'Finance réservée aux responsables.';
  end if;
  select * into o from organizations where id = v_org;
  with s as (
    select e.item_id, e.sku, e.cost_cents, e.status, i.list_price_cents, i.title, i.size_label, b.name as brand, c.name as category,
           lo.code as location,
           floor(extract(epoch from now() - case when o.aging_basis = 'listed' then coalesce(i.listed_at, e.received_at) else e.received_at end) / 86400)::int as age
      from v_item_economics e
      join items i on i.id = e.item_id
      left join brands b on b.id = i.brand_id
      left join categories c on c.id = i.category_id
      left join locations lo on lo.id = i.current_location_id
     where e.org_id = v_org
       and e.status in ('received', 'sorted', 'photographed', 'measured', 'listing_ready', 'listed', 'reserved', 'on_hold', 'returned')
  ),
  f as (
    select * from s where case p_view
      when 'stock' then true
      when 'active' then age <= o.dead_stock_days
      when 'dormant' then age > o.dead_stock_days
      when 'age' then age >= coalesce(p_min, 0) and (p_max is null or age <= p_max)
      when 'unpriced' then list_price_cents is null
      else false end
  ),
  page as (
    select * from f
     order by case when p_sort = 'age' then -age when p_sort = 'price' then -coalesce(list_price_cents, 0) else -cost_cents end, sku
     limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'cost_cents', (select coalesce(sum(cost_cents), 0) from f),
    'price_cents', (select coalesce(sum(list_price_cents), 0) from f),
    'dead_stock_days', o.dead_stock_days,
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', p.item_id, 'sku', p.sku, 'title', p.title, 'brand', p.brand, 'category', p.category,
        'size', p.size_label, 'status', p.status, 'cost_cents', p.cost_cents, 'price_cents', p.list_price_cents, 'age', p.age,
        'location', p.location, 'platform', li.platform, 'url', li.url,
        'views', vs.views, 'favourites', vs.favourites, 'offers', vs.offers, 'stats_at', vs.last_seen_at,
        'suggested_cents', pp.suggested, 'suggest_todo', pp.todo, 'held_by', pp.held_by)
        order by case when p_sort = 'age' then -p.age when p_sort = 'price' then -coalesce(p.list_price_cents, 0) else -p.cost_cents end, p.sku)
      -- platform, link and price suggestion only for the rows of the page, not for the whole stock
      from page p
      left join public.price_plan((select array_agg(item_id) from page)) pp on pp.item_id = p.item_id
      left join lateral (select l.channel as platform, l.url from listings l where l.item_id = p.item_id and l.status = 'active'
                          order by (l.url is not null) desc, l.listed_at desc limit 1) li on true
      -- audience on Vinted, read by the synchronisation
      left join lateral (select vl.views, vl.favourites, vl.offers, vl.last_seen_at from listings l
                           join vinted_listings vl on vl.org_id = l.org_id and vl.external_id = l.external_id
                          where l.item_id = p.item_id and l.channel = 'vinted' and l.status in ('active', 'reserved')
                          order by l.listed_at desc limit 1) vs on true), '[]')
  ) into r;
  return r;
end $$;

-- ── Rights ──────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function private.vinted_rank(text), private.vinted_event(uuid, uuid, text, uuid, uuid, uuid, text, text, jsonb),
  private.vinted_item_for(uuid, text), private.vinted_set_issue(uuid, text, jsonb), private.vinted_advance(uuid, uuid),
  private.vinted_follow(uuid, uuid), private.vinted_link(uuid, uuid, text, uuid), private.vinted_record(uuid, uuid[], boolean, uuid, jsonb),
  private.vinted_order_candidates(uuid), private.vinted_item_candidates(uuid, jsonb), private.vinted_process(uuid, uuid),
  private.vinted_run(uuid, uuid), private.vinted_link_listings(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.vinted_sync_start(text, text), public.vinted_reconcile(uuid, jsonb),
  public.vinted_listings_seen(uuid, jsonb), public.vinted_sync_finish(uuid, text, boolean, timestamptz, boolean, text, jsonb),
  public.vinted_known(timestamptz), public.vinted_set_sync_from(date), public.vinted_resolve(uuid, text, jsonb),
  public.vinted_undo(uuid), public.vinted_link_item(uuid, text), public.vinted_ack_order(uuid, text, boolean),
  public.vinted_sync_status(), public.vinted_reconciliation(int) from public, anon;
grant execute on function public.vinted_sync_start(text, text), public.vinted_reconcile(uuid, jsonb),
  public.vinted_listings_seen(uuid, jsonb), public.vinted_sync_finish(uuid, text, boolean, timestamptz, boolean, text, jsonb),
  public.vinted_known(timestamptz), public.vinted_set_sync_from(date), public.vinted_resolve(uuid, text, jsonb),
  public.vinted_undo(uuid), public.vinted_link_item(uuid, text), public.vinted_ack_order(uuid, text, boolean),
  public.vinted_sync_status(), public.vinted_reconciliation(int) to authenticated;
