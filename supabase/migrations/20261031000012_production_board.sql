-- Lefort OS — production board (Kanban "Postes → Production").
-- Builds on what exists: items.status is the column, private.transition / item_transitions are the rules,
-- item_events is the history (who, when, from → to) and claims (claimed_by/claimed_until) are "en cours".
-- Adds priority, blocking and assignment on items, plus the board, next-task and productivity functions.

create type item_block_reason as enum (
  'missing_photos', 'missing_measurements', 'defect_check', 'wrong_sku', 'missing_info', 'quality', 'other'
);

alter table items
  add column priority smallint not null default 1 check (priority between 0 and 3), -- 0 basse · 1 normale · 2 haute · 3 urgente
  add column assigned_to uuid references auth.users(id),
  add column blocked_reason item_block_reason,
  add column blocked_note text,
  add column blocked_at timestamptz,
  add column blocked_by uuid references auth.users(id);

create index items_board_idx on items(org_id, status, priority desc, status_changed_at) where deleted_at is null;
create index items_assigned_idx on items(org_id, assigned_to) where assigned_to is not null and deleted_at is null;
create index item_events_actor_idx on item_events(org_id, actor_id, created_at);

-- Priority, assignment and blocking are work organisation, not item data: they must not bump `version`
-- (a station holding the item would otherwise get "modifié entre-temps").
create or replace function private.items_before_update() returns trigger language plpgsql as $$
declare v_noise text[] := array['claimed_by', 'claimed_until', 'photo_count', 'updated_at', 'updated_by', 'version',
                                'priority', 'assigned_to', 'blocked_reason', 'blocked_note', 'blocked_at', 'blocked_by'];
begin
  if (to_jsonb(new) - v_noise) is distinct from (to_jsonb(old) - v_noise) then
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    new.version := old.version + 1;
  end if;
  return new;
end $$;

-- ───────────────────────── Columns ─────────────────────────
-- The nine columns, in order. An item on hold stays in the column it was in; a returned item goes back to Réception.
create function private.board_columns() returns item_status[] language sql immutable as $$
  select array['received', 'sorted', 'photographed', 'measured', 'listing_ready',
               'listed', 'reserved', 'sold', 'shipped']::item_status[]
$$;

create function private.board_column(p_status item_status, p_before_hold item_status) returns item_status
language sql immutable as $$
  select case
    when p_status = 'on_hold' then (case when p_before_hold = 'returned' then 'received' else p_before_hold end)
    when p_status = 'returned' then 'received'
    else p_status end
$$;

-- The usual next column: every other move is a manual correction (managers only, confirmed in the app)
create function private.board_next(p_col item_status) returns item_status language sql immutable as $$
  select case p_col
    when 'received' then 'sorted' when 'sorted' then 'photographed' when 'photographed' then 'measured'
    when 'measured' then 'listing_ready' when 'listing_ready' then 'listed' when 'listed' then 'reserved'
    when 'reserved' then 'sold' when 'sold' then 'shipped' end::item_status
$$;

-- Columns where someone has work to do (the task moves the item to the next column)
create function private.task_columns() returns item_status[] language sql immutable as $$
  select array['received', 'sorted', 'photographed', 'measured', 'listing_ready', 'sold']::item_status[]
$$;

-- Default steps for a role (the employee view and "prochaine tâche")
create function private.role_columns(p_role app_role) returns item_status[] language sql immutable as $$
  select case p_role
    when 'reception' then array['received']::item_status[]
    when 'photographer' then array['sorted', 'photographed']::item_status[]
    when 'warehouse' then array['measured']::item_status[]
    when 'listing_operator' then array['listing_ready']::item_status[]
    when 'shipping' then array['sold']::item_status[]
    else private.task_columns() end
$$;

-- ───────────────────────── Card ─────────────────────────
-- Everything a card or the item panel shows. Purchase cost and margin only for managers (as everywhere else).
create function private.board_card(p_item_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', i.id, 'sku', i.sku, 'title', i.title, 'version', i.version,
    'status', i.status, 'col', private.board_column(i.status, i.status_before_hold),
    'hold_reason', i.hold_reason, 'status_before_hold', i.status_before_hold,
    'brand', b.name, 'category', c.name, 'size', i.size_label,
    'batch_id', i.batch_id, 'batch', bt.code, 'supplier', s.name,
    'location', l.code, 'location_label', l.label,
    'price_cents', i.list_price_cents,
    'cost_cents', case when public.is_manager() then ic.allocated_cost_cents end,
    'priority', i.priority,
    'blocked_reason', i.blocked_reason, 'blocked_note', i.blocked_note, 'blocked_at', i.blocked_at,
    'assigned_to', i.assigned_to, 'assignee', ap.full_name,
    'claimed_by', case when i.claimed_until >= now() then i.claimed_by end,
    'claimer', case when i.claimed_until >= now() then cp.full_name end,
    'status_changed_at', i.status_changed_at, 'received_at', i.received_at,
    'photo_count', i.photo_count,
    'photo_path', (select p.storage_path from item_photos p where p.item_id = i.id order by p.position, p.created_at limit 1),
    'listing_url', (select li.url from listings li where li.item_id = i.id and li.status in ('active', 'reserved')
                     order by li.listed_at desc limit 1),
    'order_id', (select ol.order_id from order_lines ol join orders o on o.id = ol.order_id
                  where ol.item_id = i.id and ol.status = 'active' and o.status <> 'cancelled'
                  order by o.sold_at desc limit 1)
  )
  from items i
  left join brands b on b.id = i.brand_id
  left join categories c on c.id = i.category_id
  left join batches bt on bt.id = i.batch_id
  left join suppliers s on s.id = bt.supplier_id
  left join locations l on l.id = i.current_location_id
  left join item_costs ic on ic.item_id = i.id
  left join profiles ap on ap.id = i.assigned_to
  left join profiles cp on cp.id = i.claimed_by
  where i.id = p_item_id
$$;

create function public.production_card(p_item_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := private.require_operator();
begin
  if not exists (select 1 from items where id = p_item_id and org_id = v_org and deleted_at is null) then
    raise exception using errcode = 'LF404', message = 'Article introuvable.';
  end if;
  return private.board_card(p_item_id);
end $$;

-- ───────────────────────── Board ─────────────────────────
-- p_filters: q, brand_id, category_id, supplier_id, batch_id, size, assigned ('me' | 'none' | uuid),
--            age_min / age_max (days since reception), cost_min / cost_max, price_min / price_max (cents),
--            blocked (true: blocked or on hold only), columns (array of statuses to load)
-- p_sorts:   {"<column>": "priority" | "oldest" | "newest" | "brand" | "price" | "margin" | "sku"}
-- Returns the totals of every column and the first p_limit cards of each (or of p_column only, from p_offset).
create function public.production_board(
  p_filters jsonb default '{}', p_sorts jsonb default '{}', p_limit int default 30,
  p_column item_status default null, p_offset int default 0
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := private.require_operator();
  v_mgr boolean := public.is_manager();
  f jsonb := coalesce(p_filters, '{}');
  v_cols item_status[] := private.board_columns();
  v_words text[];
  v_result jsonb;
begin
  if jsonb_typeof(f->'columns') = 'array' and jsonb_array_length(f->'columns') > 0 then
    select array_agg(c::item_status) into v_cols
      from jsonb_array_elements_text(f->'columns') c where c::item_status = any(private.board_columns());
  end if;
  if p_column is not null then v_cols := array[p_column]; end if;
  v_words := array_remove(regexp_split_to_array(lower(trim(coalesce(f->>'q', ''))), '\s+'), '');
  p_limit := least(greatest(coalesce(p_limit, 30), 1), 200);

  with base as (
    select i.id, i.sku, i.priority, i.status_changed_at, i.list_price_cents, i.claimed_by, i.claimed_until,
           i.blocked_reason, i.status, b.name as brand,
           case when v_mgr then ic.allocated_cost_cents end as cost,
           private.board_column(i.status, i.status_before_hold) as col
      from items i
      left join brands b on b.id = i.brand_id
      left join batches bt on bt.id = i.batch_id
      left join item_costs ic on ic.item_id = i.id
     where i.org_id = v_org and i.deleted_at is null
       and i.status in ('received', 'sorted', 'photographed', 'measured', 'listing_ready', 'listed', 'reserved',
                        'sold', 'shipped', 'on_hold', 'returned')
       and (f->>'brand_id' is null or i.brand_id = (f->>'brand_id')::uuid)
       and (f->>'category_id' is null or i.category_id = (f->>'category_id')::uuid)
       and (f->>'batch_id' is null or i.batch_id = (f->>'batch_id')::uuid)
       and (f->>'supplier_id' is null or bt.supplier_id = (f->>'supplier_id')::uuid)
       and (coalesce(f->>'size', '') = '' or lower(i.size_label) = lower(trim(f->>'size')))
       and (f->>'assigned' is null
            or (f->>'assigned' = 'me' and i.assigned_to = auth.uid())
            or (f->>'assigned' = 'none' and i.assigned_to is null)
            or (f->>'assigned' not in ('me', 'none') and i.assigned_to::text = f->>'assigned'))
       and (f->>'age_min' is null or i.received_at <= now() - make_interval(days => (f->>'age_min')::int))
       and (f->>'age_max' is null or i.received_at >= now() - make_interval(days => (f->>'age_max')::int))
       and (f->>'price_min' is null or i.list_price_cents >= (f->>'price_min')::bigint)
       and (f->>'price_max' is null or i.list_price_cents <= (f->>'price_max')::bigint)
       and (not v_mgr or f->>'cost_min' is null or ic.allocated_cost_cents >= (f->>'cost_min')::bigint)
       and (not v_mgr or f->>'cost_max' is null or ic.allocated_cost_cents <= (f->>'cost_max')::bigint)
       and (coalesce((f->>'blocked')::boolean, false) = false or i.blocked_reason is not null or i.status = 'on_hold')
       and (cardinality(v_words) = 0 or not exists (
             select 1 from unnest(v_words) w
              where not (i.sku ilike '%' || w || '%' or coalesce(i.title, '') ilike '%' || w || '%'
                         or coalesce(b.name, '') ilike '%' || w || '%' or lower(coalesce(i.size_label, '')) = w)))
  ),
  inboard as (select * from base where col = any(v_cols)),
  totals as (
    select col, count(*)::int as n,
           count(*) filter (where claimed_by is not null and claimed_until >= now())::int as in_progress,
           count(*) filter (where blocked_reason is not null or status = 'on_hold')::int as blocked,
           coalesce(sum(list_price_cents), 0)::bigint as value_cents,
           sum(cost)::bigint as cost_cents
      from inboard group by col
  ),
  ranked as (
    select id, col, row_number() over (
             partition by col order by
               case coalesce(p_sorts->>col::text, 'priority') when 'priority' then -priority end,
               case coalesce(p_sorts->>col::text, 'priority')
                 when 'oldest' then extract(epoch from status_changed_at)
                 when 'newest' then -extract(epoch from status_changed_at)
                 when 'price' then -coalesce(list_price_cents, 0)
                 when 'margin' then -(coalesce(list_price_cents, 0) - coalesce(cost, 0)) end,
               case coalesce(p_sorts->>col::text, 'priority')
                 when 'brand' then lower(coalesce(brand, 'zzz')) when 'sku' then regexp_replace(sku, '\d+$', '') end,
               case coalesce(p_sorts->>col::text, 'priority')
                 when 'sku' then nullif(substring(sku from '(\d+)$'), '')::numeric end,
               status_changed_at, sku) as rn
      from inboard
  )
  select jsonb_build_object(
    'columns', (select jsonb_agg(jsonb_build_object(
                  'status', c, 'count', coalesce(t.n, 0), 'in_progress', coalesce(t.in_progress, 0),
                  'blocked', coalesce(t.blocked, 0), 'value_cents', coalesce(t.value_cents, 0),
                  'cost_cents', t.cost_cents) order by o)
                  from unnest(v_cols) with ordinality u(c, o) left join totals t on t.col = u.c),
    'items', coalesce((select jsonb_agg(private.board_card(r.id) || jsonb_build_object('rn', r.rn) order by r.col, r.rn)
                         from ranked r where r.rn > coalesce(p_offset, 0) and r.rn <= coalesce(p_offset, 0) + p_limit), '[]'),
    'is_manager', v_mgr
  ) into v_result;
  return v_result;
end $$;

-- ───────────────────────── Moves ─────────────────────────
-- Keeps the channel listings in step with a status change made from the board
create function private.board_sync_listings(p_item_id uuid, p_from item_status, p_to item_status) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_to in ('received', 'sorted', 'photographed', 'measured', 'listing_ready') and p_from in ('listed', 'reserved') then
    update listings set status = 'delisted', ended_at = now()
     where item_id = p_item_id and status in ('draft', 'active', 'reserved');
  elsif p_to = 'reserved' then
    update listings set status = 'reserved' where item_id = p_item_id and status = 'active';
  elsif p_to = 'listed' and p_from = 'reserved' then
    update listings set status = 'active' where item_id = p_item_id and status = 'reserved';
  end if;
end $$;

-- A manager's manual correction: straight to the column, without the step rules; recorded as forced
create function private.board_force(p_item_id uuid, p_to item_status, p_payload jsonb, p_forced boolean default true)
returns items
language plpgsql security definer set search_path = public as $$
declare v_item items; v_from item_status;
begin
  select * into v_item from items where id = p_item_id for update;
  v_from := v_item.status;
  perform private.board_sync_listings(p_item_id, v_from, p_to);
  update items set
    status = p_to, status_changed_at = now(), status_before_hold = null, hold_reason = null,
    listed_at = case when p_to in ('listed', 'reserved') then coalesce(listed_at, now())
                     when p_to in ('received', 'sorted', 'photographed', 'measured', 'listing_ready') then null
                     else listed_at end,
    claimed_by = null, claimed_until = null
  where id = p_item_id returning * into v_item;
  insert into item_events(org_id, item_id, type, from_status, to_status, station, actor_id, payload)
  values (v_item.org_id, v_item.id, 'status', v_from, p_to, 'production', auth.uid(),
          coalesce(p_payload, '{}') || jsonb_build_object('forced', p_forced));
  return v_item;
end $$;

-- Moves a card to another column.
-- The usual next step goes through the state machine and its checks (photos, measures, storage, price…).
-- Any other move is a manual correction: managers only, sent with p_force once confirmed in the app.
-- Vendu and Expédié are reached through a sale and a shipment (Ventes / Expédition), never by a plain move.
create function public.kanban_move(
  p_item_id uuid, p_to item_status, p_expected_version int default null, p_force boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := private.require_operator(); v_item items; v_col item_status; v_usual boolean;
  v_payload jsonb := '{"board": true}';
begin
  select * into v_item from items where id = p_item_id and org_id = v_org and deleted_at is null for update;
  if v_item.id is null then raise exception using errcode = 'LF404', message = 'Article introuvable.'; end if;
  if p_expected_version is not null and v_item.version <> p_expected_version then
    raise exception using errcode = 'LF412', message = 'Article modifié entre-temps par quelqu''un d''autre. Rechargez.';
  end if;
  if not (p_to = any(private.board_columns())) then
    raise exception using errcode = 'LF422', message = 'Étape inconnue.';
  end if;
  v_col := private.board_column(v_item.status, v_item.status_before_hold);
  if v_col = p_to and v_item.status <> 'on_hold' then return private.board_card(p_item_id); end if;

  if p_to in ('sold', 'shipped') then
    raise exception using errcode = 'LF409',
      message = case p_to when 'sold' then 'Une vente s''enregistre depuis Ventes (prix, frais, acheteur).'
                     else 'L''expédition se valide au poste Expédition (transporteur, suivi).' end;
  end if;
  if v_item.status in ('sold', 'shipped', 'completed') then
    raise exception using errcode = 'LF409', message = 'Article vendu : annulation ou retour depuis l''écran Ventes.';
  end if;
  if v_item.blocked_reason is not null and not p_force then
    raise exception using errcode = 'LF423', message = 'Article bloqué : levez le blocage avant de le faire avancer.';
  end if;

  v_usual := private.board_next(v_col) = p_to or (v_item.status = 'on_hold' and v_col = p_to);
  if not v_usual and not public.is_manager() then
    raise exception using errcode = 'LF403',
      message = 'Seul un responsable peut faire sauter une étape ou revenir en arrière.';
  end if;
  if not v_usual and not p_force then
    raise exception using errcode = 'LF428', message = 'Déplacement inhabituel : confirmation nécessaire.';
  end if;

  if p_force then
    if not public.is_manager() then
      raise exception using errcode = 'LF403', message = 'Seul un responsable peut forcer un déplacement.';
    end if;
    update items set blocked_reason = null, blocked_note = null, blocked_at = null, blocked_by = null
     where id = p_item_id and blocked_reason is not null;
    perform private.board_force(p_item_id, p_to, v_payload || jsonb_build_object('from_column', v_col));
    return private.board_card(p_item_id);
  end if;

  -- an item on hold first resumes the step it was at
  if v_item.status = 'on_hold' then
    v_item := private.transition(p_item_id, v_item.status_before_hold, 'production', v_payload);
    if v_item.status = p_to then return private.board_card(p_item_id); end if;
  end if;

  if p_to = 'listed' and v_item.list_price_cents is not null
     and not exists (select 1 from listings where item_id = p_item_id and status in ('active', 'reserved')) then
    -- published by hand on Vinted (no link recorded yet): same as "Mettre en vente" from the stock list
    perform private.board_force(p_item_id, 'listed', v_payload || '{"put_on_sale": true}', false);
    return private.board_card(p_item_id);
  end if;

  perform private.board_sync_listings(p_item_id, v_item.status, p_to);
  perform private.transition(p_item_id, p_to, 'production', v_payload);
  return private.board_card(p_item_id);
end $$;

-- ───────────────────────── Priority, blocking, assignment ─────────────────────────
create function public.set_item_priority(p_item_ids uuid[], p_priority int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_operator(); v_n int;
begin
  if p_priority is null or p_priority not between 0 and 3 then
    raise exception using errcode = 'LF422', message = 'Priorité invalide.';
  end if;
  if cardinality(p_item_ids) > 500 then
    raise exception using errcode = 'LF422', message = 'Maximum 500 articles à la fois.';
  end if;
  with changed as (
    update items i set priority = p_priority
      from (select id, priority as old from items where id = any(p_item_ids) and org_id = v_org and deleted_at is null) o
     where i.id = o.id and o.old <> p_priority
    returning i.id, i.org_id, i.status, o.old
  ), ev as (
    insert into item_events(org_id, item_id, type, from_status, to_status, station, actor_id, payload)
    select org_id, id, 'priority', status, status, 'production', auth.uid(), jsonb_build_object('from', old, 'to', p_priority)
      from changed returning 1
  )
  select count(*) into v_n from ev;
  return jsonb_build_object('updated', v_n);
end $$;

-- p_reason = null lifts the block
create function public.set_item_block(p_item_id uuid, p_reason item_block_reason default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_operator(); v_item items;
begin
  select * into v_item from items where id = p_item_id and org_id = v_org and deleted_at is null for update;
  if v_item.id is null then raise exception using errcode = 'LF404', message = 'Article introuvable.'; end if;
  if p_reason = 'other' and coalesce(trim(p_note), '') = '' then
    raise exception using errcode = 'LF422', message = 'Précisez la raison du blocage.';
  end if;
  update items set blocked_reason = p_reason,
         blocked_note = case when p_reason is null then null else nullif(trim(p_note), '') end,
         blocked_at = case when p_reason is null then null else now() end,
         blocked_by = case when p_reason is null then null else auth.uid() end
   where id = p_item_id;
  insert into item_events(org_id, item_id, type, from_status, to_status, station, actor_id, payload)
  values (v_org, p_item_id, case when p_reason is null then 'unblock' else 'block' end, v_item.status, v_item.status,
          'production', auth.uid(),
          case when p_reason is null then jsonb_build_object('was', v_item.blocked_reason)
               else jsonb_build_object('reason', p_reason, 'note', nullif(trim(p_note), '')) end);
  return private.board_card(p_item_id);
end $$;

-- Managers assign to anyone; an employee takes an item for themself or gives back their own
create function public.assign_items(p_item_ids uuid[], p_user_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_operator(); v_mgr boolean := public.is_manager(); v_n int;
begin
  if cardinality(p_item_ids) > 500 then
    raise exception using errcode = 'LF422', message = 'Maximum 500 articles à la fois.';
  end if;
  if p_user_id is not null and not exists (select 1 from memberships where org_id = v_org and user_id = p_user_id and active) then
    raise exception using errcode = 'LF404', message = 'Employé introuvable.';
  end if;
  if not v_mgr and p_user_id is distinct from auth.uid() and p_user_id is not null then
    raise exception using errcode = 'LF403', message = 'Seul un responsable peut attribuer un article à quelqu''un d''autre.';
  end if;
  with changed as (
    update items i set assigned_to = p_user_id
      from (select id, assigned_to as old from items where id = any(p_item_ids) and org_id = v_org and deleted_at is null) o
     where i.id = o.id and o.old is distinct from p_user_id
       and (v_mgr or o.old is null or o.old = auth.uid())
    returning i.id, i.org_id, i.status, o.old
  ), ev as (
    insert into item_events(org_id, item_id, type, from_status, to_status, station, actor_id, payload)
    select org_id, id, 'assign', status, status, 'production', auth.uid(), jsonb_build_object('from', old, 'to', p_user_id)
      from changed returning 1
  )
  select count(*) into v_n from ev;
  return jsonb_build_object('updated', v_n);
end $$;

-- ───────────────────────── Tasks ─────────────────────────
-- Opens a task: takes the item (10 min lease, renewed by the stations) and notes the start time for productivity
create function public.start_task(p_item_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_operator(); v_item items;
begin
  v_item := public.claim_item(p_item_id);
  if not exists (select 1 from item_events where item_id = p_item_id and type = 'start' and actor_id = auth.uid()
                   and from_status = v_item.status and created_at > now() - interval '10 minutes') then
    insert into item_events(org_id, item_id, type, from_status, to_status, station, actor_id)
    values (v_org, p_item_id, 'start', v_item.status, v_item.status, 'production', auth.uid());
  end if;
  return private.board_card(p_item_id);
end $$;

-- The item the employee should handle now: the one already in their hands, then assigned to them,
-- then the most urgent and the oldest in the step. Blocked, on-hold and items taken by someone else are skipped.
create function public.next_task(p_columns item_status[] default null, p_skip uuid[] default '{}') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := private.require_operator(); v_cols item_status[]; v_id uuid;
begin
  v_cols := coalesce(nullif(p_columns, '{}'), private.role_columns(public.auth_role()));
  select array_agg(c) into v_cols from unnest(v_cols) c where c = any(private.task_columns());
  if 'received' = any(v_cols) then v_cols := v_cols || 'returned'::item_status; end if;
  select i.id into v_id from items i
   where i.org_id = v_org and i.deleted_at is null and i.status = any(v_cols)
     and i.blocked_reason is null
     and (i.assigned_to is null or i.assigned_to = auth.uid())
     and (i.claimed_by is null or i.claimed_until < now() or i.claimed_by = auth.uid())
     and not (i.id = any(coalesce(p_skip, '{}')))
   order by (i.claimed_by = auth.uid() and i.claimed_until >= now()) desc nulls last,
            (i.assigned_to = auth.uid()) desc nulls last,
            i.priority desc, i.status_changed_at, i.sku
   limit 1;
  if v_id is null then return null; end if;
  return private.board_card(v_id);
end $$;

-- ───────────────────────── Employee view ─────────────────────────
create function public.production_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := private.require_operator();
  v_tz text; v_day timestamptz; v_cols item_status[] := private.role_columns(public.auth_role()); v_result jsonb;
begin
  select timezone into v_tz from organizations where id = v_org;
  v_day := date_trunc('day', now() at time zone v_tz) at time zone v_tz;
  with avail as (
    select private.board_column(i.status, null) as col, i.priority
      from items i
     where i.org_id = v_org and i.deleted_at is null
       and i.status in ('received', 'returned', 'sorted', 'photographed', 'measured', 'listing_ready', 'sold')
       and i.blocked_reason is null
       and (i.assigned_to is null or i.assigned_to = auth.uid())
       and (i.claimed_by is null or i.claimed_until < now() or i.claimed_by = auth.uid())
  )
  select jsonb_build_object(
    'name', (select full_name from profiles where id = auth.uid()),
    'role', public.auth_role(),
    'columns', to_jsonb(v_cols),
    'priorities', (select jsonb_build_object(
                     'urgent', count(*) filter (where priority = 3), 'high', count(*) filter (where priority = 2),
                     'normal', count(*) filter (where priority = 1), 'low', count(*) filter (where priority = 0))
                     from avail where col = any(v_cols)),
    'by_column', (select coalesce(jsonb_object_agg(col, n), '{}') from (select col, count(*) n from avail group by col) x),
    'assigned_to_me', (select count(*) from items where org_id = v_org and deleted_at is null and assigned_to = auth.uid()
                         and status in ('received', 'returned', 'sorted', 'photographed', 'measured', 'listing_ready', 'sold', 'on_hold')),
    'done_today', (select count(*) from item_events e
                    where e.org_id = v_org and e.actor_id = auth.uid() and e.type = 'status' and e.created_at >= v_day
                      and e.to_status = private.board_next(private.board_column(e.from_status, null))
                      and not coalesce((e.payload->>'forced')::boolean, false))
  ) into v_result;
  return v_result;
end $$;

-- ───────────────────────── Productivity ─────────────────────────
-- A task is done when the item moves on to the next column (forward, not forced, by a person).
-- Time spent = from "Commencer" on that item when there is one, otherwise the gap since the person's previous
-- action if it is under 20 minutes (a longer gap is a break, not work). Bulk changes and syncs are not counted.
create function public.production_stats(p_from timestamptz, p_to timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := private.require_operator(); v_mgr boolean := public.is_manager(); v_result jsonb;
begin
  with ev as (
    select e.id, e.item_id, e.actor_id, e.type, e.from_status, e.to_status, e.created_at, e.station, e.payload,
           lag(e.created_at) over (partition by e.actor_id order by e.created_at, e.id) as prev_at
      from item_events e
     where e.org_id = v_org and e.actor_id is not null and e.type in ('status', 'start')
       and e.created_at >= p_from - interval '3 hours' and e.created_at <= p_to
       and (v_mgr or e.actor_id = auth.uid())
  ),
  done0 as (
    select e.actor_id, private.board_column(e.from_status, null) as step, e.created_at,
           coalesce(
             (select case when extract(epoch from e.created_at - s.created_at) <= 3600 then extract(epoch from e.created_at - s.created_at) end
                from item_events s
               where s.item_id = e.item_id and s.type = 'start' and s.actor_id = e.actor_id and s.from_status = e.from_status
                 and s.created_at <= e.created_at and s.created_at > e.created_at - interval '3 hours'
               order by s.created_at desc limit 1),
             case when extract(epoch from e.created_at - e.prev_at) <= 1200 then extract(epoch from e.created_at - e.prev_at) end
           ) as secs0
      from ev e
     where e.type = 'status' and e.created_at >= p_from
       and e.to_status = private.board_next(private.board_column(e.from_status, null))
       and coalesce(e.station, '') not in ('vinted_sync', 'stock', 'import')
       and not coalesce((e.payload->>'forced')::boolean, false)
  ),
  -- under 3 seconds is a scripted or repeated click, not a measured piece of work
  done as (select d0.*, case when d0.secs0 >= 3 then d0.secs0 end as secs from done0 d0),
  per_step as (
    select step, count(*)::int as n, count(secs)::int as timed, coalesce(sum(secs), 0)::numeric as secs
      from done group by step
  ),
  per_person as (
    select actor_id, sum(k)::int as n, sum(t)::int as timed, sum(secs)::numeric as secs, jsonb_object_agg(step, k) as by_step
      from (select actor_id, step, count(*) as k, count(secs) as t, coalesce(sum(secs), 0) as secs
              from done group by actor_id, step) d
     group by actor_id
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'total', (select jsonb_build_object('n', coalesce(sum(n), 0), 'timed', coalesce(sum(timed), 0), 'secs', coalesce(sum(secs), 0)) from per_step),
    'steps', coalesce((select jsonb_agg(jsonb_build_object('step', step, 'n', n, 'timed', timed, 'secs', round(secs))
                                        order by array_position(private.board_columns(), step)) from per_step), '[]'),
    'people', coalesce((select jsonb_agg(jsonb_build_object('user_id', p.actor_id, 'name', coalesce(nullif(pr.full_name, ''), 'Sans nom'),
                                                           'n', p.n, 'timed', p.timed, 'secs', round(p.secs), 'by_step', p.by_step)
                                         order by p.n desc)
                          from per_person p left join profiles pr on pr.id = p.actor_id), '[]')
  ) into v_result;

  if v_mgr then
    v_result := v_result || (
      with cols as (
        select c as col, o from unnest(private.task_columns()) with ordinality u(c, o)
      ),
      now_in as (
        select private.board_column(i.status, i.status_before_hold) as col, count(*)::int as n,
               avg(extract(epoch from now() - i.status_changed_at)) as wait
          from items i
         where i.org_id = v_org and i.deleted_at is null
           and i.status in ('received', 'returned', 'sorted', 'photographed', 'measured', 'listing_ready', 'sold', 'on_hold')
         group by 1
      ),
      flow as (
        select private.board_column(e.from_status, null) as col, count(*)::int as n7
          from item_events e
         where e.org_id = v_org and e.type = 'status' and e.created_at >= now() - interval '7 days'
           and e.to_status = private.board_next(private.board_column(e.from_status, null))
         group by 1
      ),
      board as (
        select c.col, c.o, coalesce(n.n, 0) as n, n.wait, coalesce(f.n7, 0) as n7,
               case when coalesce(f.n7, 0) > 0 then coalesce(n.n, 0) / (f.n7 / 7.0) end as backlog_days
          from cols c left join now_in n on n.col = c.col left join flow f on f.col = c.col
      )
      select jsonb_build_object(
        'pending', (select coalesce(sum(n), 0) from board),
        'blocked', (select count(*) from items where org_id = v_org and deleted_at is null
                      and (blocked_reason is not null or status = 'on_hold')
                      and status not in ('completed', 'rejected')),
        'cycle_secs', (select round(avg(extract(epoch from listed_at - received_at))) from items
                        where org_id = v_org and deleted_at is null and listed_at >= now() - interval '30 days'
                          and listed_at > received_at + interval '1 minute'),
        'columns', (select jsonb_agg(jsonb_build_object('col', col, 'n', n, 'wait_secs', round(wait), 'per_day', round(n7 / 7.0, 1),
                                                        'backlog_days', round(backlog_days, 1)) order by o) from board),
        'bottleneck', (select jsonb_build_object('col', col, 'n', n, 'backlog_days', round(backlog_days, 1)) from board
                        where n > 0
                        order by (n7 = 0) desc, backlog_days desc nulls last, n desc limit 1)
      ));
  end if;
  return v_result;
end $$;

revoke all on function private.board_columns(), private.board_column(item_status, item_status), private.board_next(item_status),
  private.task_columns(), private.role_columns(app_role), private.board_card(uuid),
  private.board_sync_listings(uuid, item_status, item_status), private.board_force(uuid, item_status, jsonb, boolean)
  from public, anon, authenticated;
revoke all on function public.production_card(uuid), public.production_board(jsonb, jsonb, int, item_status, int),
  public.kanban_move(uuid, item_status, int, boolean), public.set_item_priority(uuid[], int),
  public.set_item_block(uuid, item_block_reason, text), public.assign_items(uuid[], uuid), public.start_task(uuid),
  public.next_task(item_status[], uuid[]), public.production_overview(), public.production_stats(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.production_card(uuid), public.production_board(jsonb, jsonb, int, item_status, int),
  public.kanban_move(uuid, item_status, int, boolean), public.set_item_priority(uuid[], int),
  public.set_item_block(uuid, item_block_reason, text), public.assign_items(uuid[], uuid), public.start_task(uuid),
  public.next_task(item_status[], uuid[]), public.production_overview(), public.production_stats(timestamptz, timestamptz)
  to authenticated;
