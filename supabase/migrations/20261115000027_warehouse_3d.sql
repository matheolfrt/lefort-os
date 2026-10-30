-- Lefort OS — « Entrepôt 3D » : the physical shop as a digital twin, on the data that already exists.
-- No second stock database: a level of a shelf IS a storage location (locations), an item's place IS its current
-- location (items.current_location_id) plus a slot on that level, every move IS an item_location_moves row.
--
--   warehouses            the configuration of a building: room, racks, shelf size, levels, capacity, aisles, zones
--   locations             + warehouse_id, rack, shelf_no, level_no: rack B, shelf B-07, level L3 = EMP-B-07-L3
--   items                 + location_position: the slot on its level (1 … capacity), kept by a trigger
--   EMP-PREPARATION       a staging location where picked items wait to be packed
--
-- Functions: warehouse_sync (creates the level locations of a configuration, adopting the existing ones),
-- warehouse_snapshot (everything the 3D view draws, compact), warehouse_heat (performance by location),
-- warehouse_item (the item card), pick_item (picking: an item taken off its shelf).

-- ── Buildings ─────────────────────────────────────────────────────────────────────────────────────────────────────
create table warehouses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.auth_org_id() references organizations(id),
  name text not null default 'Entrepôt' check (length(trim(name)) between 1 and 100),
  -- room, racks, shelf, aisle, zones, colours: see src/lib/warehouse3d/config.ts (validated there and in warehouse_sync)
  config jsonb not null default '{}'::jsonb check (pg_column_size(config) <= 500000),
  is_default boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index warehouses_name_uq on warehouses(org_id, lower(name));
create unique index warehouses_default_uq on warehouses(org_id) where is_default;
create trigger warehouses_touch before update on warehouses for each row execute function private.touch_updated_at();
alter table warehouses enable row level security;
grant select, insert, delete on warehouses to authenticated;
grant update (name, config, is_default) on warehouses to authenticated;
create policy warehouses_read on warehouses for select to authenticated using (org_id = (select public.auth_org_id()));
create policy warehouses_write on warehouses for insert to authenticated
  with check (org_id = (select public.auth_org_id()) and (select public.is_manager()));
create policy warehouses_update on warehouses for update to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_manager())) with check (org_id = (select public.auth_org_id()));
create policy warehouses_delete on warehouses for delete to authenticated
  using (org_id = (select public.auth_org_id()) and (select public.is_manager()));

-- ── Locations know where they stand ───────────────────────────────────────────────────────────────────────────────
alter table locations add column if not exists warehouse_id uuid references warehouses(id) on delete set null;
alter table locations add column if not exists rack text check (rack is null or rack ~ '^[A-Z]{1,3}$');
alter table locations add column if not exists shelf_no int check (shelf_no is null or shelf_no between 1 and 999);
alter table locations add column if not exists level_no int check (level_no is null or level_no between 1 and 50);
create unique index if not exists locations_slot_uq on locations(warehouse_id, rack, shelf_no, level_no) where warehouse_id is not null and rack is not null;

-- ── An item's slot on its level ───────────────────────────────────────────────────────────────────────────────────
alter table items add column if not exists location_position int check (location_position is null or location_position >= 1);

-- First free slot of a level, or the next one after the last when it is full (nothing is refused: a full shelf is a
-- fact to show, not a reason to lose track of an item)
create function private.free_position(p_location_id uuid, p_item_id uuid) returns int
language sql stable security definer set search_path = public as $$
  with used as (
    select location_position as p from items
     where current_location_id = p_location_id and id <> p_item_id and deleted_at is null
       and status not in ('shipped', 'completed') and location_position is not null
  )
  select coalesce(
    (select min(g) from generate_series(1, coalesce((select capacity from locations where id = p_location_id), 0)) g
      where g not in (select p from used)),
    coalesce((select max(p) from used), 0) + 1)
$$;

create function private.items_location_position() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.current_location_id is distinct from old.current_location_id
     or (tg_op = 'INSERT' and new.current_location_id is not null) then
    -- a slot only on the levels of a shelf; staging racks and zones are piles, not slots
    if exists (select 1 from locations where id = new.current_location_id and kind = 'storage' and level_no is not null) then
      new.location_position := private.free_position(new.current_location_id, new.id);
    else
      new.location_position := null;
    end if;
  end if;
  return new;
end $$;
create trigger items_location_position before insert or update of current_location_id on items
  for each row execute function private.items_location_position();

-- ── Configuration → level locations ───────────────────────────────────────────────────────────────────────────────
-- Every level of every shelf of the configuration gets its location: EMP-<rack>-<shelf>-L<level>. A location that
-- already exists with the old naming (EMP-A-01-03 = rack A, shelf 01, level 3) is adopted, with its items, rather
-- than duplicated. Levels no longer in the configuration are archived when empty, kept (and reported) otherwise.
create function public.warehouse_sync(p_warehouse_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := private.require_role('manager'); w warehouses; r jsonb; v_levels int; v_cap int;
  v_rack text; v_shelves int; s int; l int; v_code text; v_legacy text; v_id uuid;
  v_created int := 0; v_adopted int := 0; v_kept text[] := '{}'; v_archived int := 0; v_rack_i int := 0;
  v_keep uuid[] := '{}';
begin
  select * into w from warehouses where id = p_warehouse_id and org_id = v_org for update;
  if w.id is null then raise exception using errcode = 'LF404', message = 'Entrepôt introuvable.'; end if;
  v_levels := coalesce((w.config->'shelf'->>'levels')::int, 0);
  v_cap := coalesce((w.config->'shelf'->>'perLevel')::int, 0);
  if v_levels not between 1 and 50 or v_cap not between 1 and 1000 then
    raise exception using errcode = 'LF422', message = 'Configuration invalide : niveaux (1 à 50) et capacité par niveau (1 à 1000).';
  end if;
  if jsonb_array_length(coalesce(w.config->'racks', '[]')) > 200 then
    raise exception using errcode = 'LF422', message = 'Trop de racks (200 au plus).';
  end if;

  for r in select * from jsonb_array_elements(coalesce(w.config->'racks', '[]')) loop
    v_rack_i := v_rack_i + 1;
    v_rack := upper(r->>'code');
    v_shelves := coalesce((r->>'shelves')::int, 0);
    if v_rack !~ '^[A-Z]{1,3}$' or v_shelves not between 1 and 999 then
      raise exception using errcode = 'LF422', message = format('Rack %s invalide (lettres A à ZZZ, 1 à 999 étagères).', coalesce(r->>'code', '?'));
    end if;
    for s in 1..v_shelves loop
      for l in 1..v_levels loop
        v_code := format('EMP-%s-%s-L%s', v_rack, lpad(s::text, 2, '0'), l);
        v_legacy := format('EMP-%s-%s-%s', v_rack, lpad(s::text, 2, '0'), lpad(l::text, 2, '0'));
        select id into v_id from locations where org_id = v_org and (code = v_code or (code = v_legacy and kind = 'storage'))
         order by (code = v_code) desc limit 1;
        -- rack letters are unique in the shop: rack A cannot stand in two buildings
        if v_id is not null and exists (select 1 from locations lo join warehouses ow on ow.id = lo.warehouse_id
                                          where lo.id = v_id and lo.warehouse_id <> w.id and lo.active) then
          raise exception using errcode = 'LF409', message = format('Le rack %s existe déjà dans un autre entrepôt : choisissez une autre lettre.', v_rack);
        end if;
        if v_id is null then
          insert into locations(org_id, code, label, kind, capacity, pick_order, warehouse_id, rack, shelf_no, level_no)
          values (v_org, v_code, format('%s-%s-L%s', v_rack, lpad(s::text, 2, '0'), l), 'storage', v_cap,
                  v_rack_i * 100000 + s * 100 + l, w.id, v_rack, s, l)
          returning id into v_id;
          v_created := v_created + 1;
        else
          -- the slot may have been held by another location of this building: free it first
          update locations set rack = null, shelf_no = null, level_no = null
           where warehouse_id = w.id and rack = v_rack and shelf_no = s and level_no = l and id <> v_id;
          update locations set warehouse_id = w.id, rack = v_rack, shelf_no = s, level_no = l, capacity = v_cap, active = true,
                 label = coalesce(label, format('%s-%s-L%s', v_rack, lpad(s::text, 2, '0'), l)), pick_order = v_rack_i * 100000 + s * 100 + l
           where id = v_id
             and (warehouse_id is distinct from w.id or rack is distinct from v_rack or shelf_no is distinct from s
                  or level_no is distinct from l or capacity is distinct from v_cap or not active);
          if found then v_adopted := v_adopted + 1; end if;
        end if;
        v_keep := v_keep || v_id;
      end loop;
    end loop;
  end loop;

  -- levels of this building that are not in the configuration any more
  for v_id, v_code in select id, code from locations where warehouse_id = w.id and level_no is not null and active and not (id = any(v_keep)) loop
    if exists (select 1 from items where current_location_id = v_id and deleted_at is null and status not in ('shipped', 'completed')) then
      v_kept := v_kept || v_code;
    else
      update locations set active = false where id = v_id;
      v_archived := v_archived + 1;
    end if;
  end loop;

  -- slots of the items already on these levels (adopted locations), in the order they arrived
  update items i set location_position = x.pos
    from (select it.id, row_number() over (partition by it.current_location_id order by it.status_changed_at, it.sku) as pos
            from items it join locations lo on lo.id = it.current_location_id
           where lo.warehouse_id = w.id and lo.level_no is not null and it.deleted_at is null
             and it.status not in ('shipped', 'completed') and it.location_position is null) x
   where i.id = x.id;

  return jsonb_build_object('created', v_created, 'adopted', v_adopted, 'archived', v_archived, 'kept_not_empty', to_jsonb(v_kept),
                            'levels', cardinality(v_keep));
end $$;

-- ── Everything the 3D view draws ─────────────────────────────────────────────────────────────────────────────────
-- Compact on purpose (arrays, not objects): several thousand items load in one small answer.
--   levels  [location_id, rack, shelf_no, level_no, capacity, code]
--   staging [location_id, code, label, auto_for_status]
--   items   [item_id, sku, status, location_id, position, received_at, listed_at, list_price_cents, cost_cents|null, brand, size]
create function public.warehouse_snapshot(p_warehouse_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := private.require_operator(); v_mgr boolean := public.is_manager(); w warehouses; r jsonb;
begin
  select * into w from warehouses where id = p_warehouse_id and org_id = v_org;
  if w.id is null then raise exception using errcode = 'LF404', message = 'Entrepôt introuvable.'; end if;
  select jsonb_build_object(
    'warehouse', jsonb_build_object('id', w.id, 'name', w.name, 'config', w.config, 'updated_at', w.updated_at),
    'manager', v_mgr,
    'dead_stock_days', (select dead_stock_days from organizations where id = v_org),
    'levels', coalesce((select jsonb_agg(jsonb_build_array(id, rack, shelf_no, level_no, capacity, code) order by rack, shelf_no, level_no)
                          from locations where warehouse_id = w.id and level_no is not null and active), '[]'),
    'staging', coalesce((select jsonb_agg(jsonb_build_array(id, code, label, auto_for_status) order by code)
                           from locations where org_id = v_org and kind = 'staging' and active), '[]'),
    'items', coalesce((select jsonb_agg(jsonb_build_array(i.id, i.sku, i.status, i.current_location_id, i.location_position,
                              i.received_at, i.listed_at, i.list_price_cents, case when v_mgr then ic.allocated_cost_cents end,
                              b.name, i.size_label) order by i.sku)
                         from items i
                         left join item_costs ic on ic.item_id = i.id
                         left join brands b on b.id = i.brand_id
                        where i.org_id = v_org and i.deleted_at is null and i.status not in ('shipped', 'completed')), '[]'),
    -- median time to sell (listing → sale) over the last 90 days, the « rotation moyenne »
    'rotation_days', (select percentile_cont(0.5) within group (order by extract(epoch from i.sold_at - i.listed_at) / 86400)
                        from items i where i.org_id = v_org and i.deleted_at is null and i.sold_at >= now() - interval '90 days'
                         and i.listed_at is not null and i.sold_at >= i.listed_at and i.status in ('sold', 'shipped', 'completed')),
    'to_ship', (select count(distinct o.id) from orders o where o.org_id = v_org and o.status = 'pending')
  ) into r;
  return r;
end $$;

-- ── Performance, location by location ────────────────────────────────────────────────────────────────────────────
-- For each storage level: what is on it now (count, value at cost, average age, dormant items) and what was sold from
-- it over the period (revenue, margin, average days to sell) — « sold from » = the last storage level the item stood
-- on before its sale (item_location_moves). Money for managers only.
create function public.warehouse_heat(p_warehouse_id uuid, p_days int default 365) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := private.require_operator(); v_mgr boolean := public.is_manager(); v_dead int; r jsonb;
begin
  if not exists (select 1 from warehouses where id = p_warehouse_id and org_id = v_org) then
    raise exception using errcode = 'LF404', message = 'Entrepôt introuvable.';
  end if;
  select dead_stock_days into v_dead from organizations where id = v_org;
  with lv as (select id from locations where warehouse_id = p_warehouse_id and level_no is not null),
  now_on as (
    select i.current_location_id as loc, count(*) as n,
           sum(ic.allocated_cost_cents) as value_cents,
           avg(extract(epoch from now() - coalesce(i.listed_at, i.received_at)) / 86400) as avg_age,
           count(*) filter (where coalesce(i.listed_at, i.received_at) < now() - make_interval(days => v_dead)) as dormant
      from items i left join item_costs ic on ic.item_id = i.id
     where i.org_id = v_org and i.deleted_at is null and i.status not in ('shipped', 'completed', 'sold')
       and i.current_location_id in (select id from lv)
     group by 1
  ),
  sold as (
    select e.item_id, e.revenue_cents, e.gross_profit_cents, e.days_to_sell,
           (select m.to_location_id from item_location_moves m
             where m.item_id = e.item_id and m.to_location_id in (select id from lv) and m.moved_at <= e.sold_at
             order by m.moved_at desc limit 1) as loc
      from v_item_economics e
     where e.org_id = v_org and e.is_sold and e.sold_at >= now() - make_interval(days => p_days)
  ),
  sold_by as (
    select loc, count(*) as sold, sum(revenue_cents) as revenue_cents, sum(gross_profit_cents) as margin_cents,
           avg(days_to_sell) filter (where days_to_sell >= 0) as days_to_sell
      from sold where loc is not null group by loc
  )
  select coalesce(jsonb_agg(jsonb_build_array(lv.id, coalesce(n.n, 0),
           case when v_mgr then coalesce(n.value_cents, 0) end, round(n.avg_age::numeric, 1), coalesce(n.dormant, 0),
           coalesce(s.sold, 0), case when v_mgr then coalesce(s.revenue_cents, 0) end, case when v_mgr then coalesce(s.margin_cents, 0) end,
           round(s.days_to_sell::numeric, 1))), '[]')
    into r
    from lv left join now_on n on n.loc = lv.id left join sold_by s on s.loc = lv.id;
  -- [location_id, items, value_cents, avg_age_days, dormant, sold, revenue_cents, margin_cents, days_to_sell]
  return jsonb_build_object('days', p_days, 'dead_stock_days', v_dead, 'manager', v_mgr, 'levels', r);
end $$;

-- ── The item card ────────────────────────────────────────────────────────────────────────────────────────────────
create function public.warehouse_item(p_item_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := private.require_operator(); v_mgr boolean := public.is_manager(); i items; r jsonb;
begin
  select * into i from items where id = p_item_id and org_id = v_org and deleted_at is null;
  if i.id is null then raise exception using errcode = 'LF404', message = 'Article introuvable.'; end if;
  select jsonb_build_object(
    'id', i.id, 'sku', i.sku, 'title', i.title, 'status', i.status, 'version', i.version,
    'brand', (select name from brands where id = i.brand_id),
    'category', (select name from categories where id = i.category_id),
    'size', i.size_label, 'color', (select value from attribute_values where id = i.color_id),
    'cost_cents', case when v_mgr then (select allocated_cost_cents from item_costs where item_id = i.id) end,
    'price_cents', i.list_price_cents,
    'sold_cents', (select ol.sale_price_cents from order_lines ol where ol.item_id = i.id and ol.status = 'active' limit 1),
    'received_at', i.received_at, 'listed_at', i.listed_at, 'sold_at', i.sold_at,
    'photo', (select storage_path from item_photos where item_id = i.id order by position limit 1),
    'platform', coalesce((select channel from listings where item_id = i.id and status in ('active', 'reserved', 'sold') order by listed_at desc limit 1),
                         case when exists (select 1 from vinted_listings where item_id = i.id) then 'vinted' end),
    'views', (select max(views) from vinted_listings where item_id = i.id),
    'favourites', (select max(favourites) from vinted_listings where item_id = i.id),
    'location', (select jsonb_build_object('id', l.id, 'code', l.code, 'label', l.label, 'kind', l.kind, 'rack', l.rack,
                         'shelf_no', l.shelf_no, 'level_no', l.level_no, 'position', i.location_position, 'warehouse_id', l.warehouse_id)
                   from locations l where l.id = i.current_location_id),
    -- statuses and moves, most recent first (the last 60)
    'history', coalesce((select jsonb_agg(x.h order by x.at desc) from (
        select e.created_at as at, jsonb_build_object('at', e.created_at, 'kind', 'status', 'from', e.from_status, 'to', e.to_status, 'type', e.type,
                                  'by', (select full_name from profiles where id = e.actor_id)) as h
          from item_events e where e.item_id = i.id
        union all
        select m.moved_at, jsonb_build_object('at', m.moved_at, 'kind', 'move', 'from', fl.code, 'to', tl.code, 'type', m.method,
                                  'by', (select full_name from profiles where id = m.moved_by))
          from item_location_moves m left join locations fl on fl.id = m.from_location_id join locations tl on tl.id = m.to_location_id
         where m.item_id = i.id
        order by 1 desc limit 60) x), '[]')
  ) into r;
  return r;
end $$;

-- ── Picking: an item of a sale taken off its shelf ───────────────────────────────────────────────────────────────
-- Moves it to the preparation table (EMP-PREPARATION, created on first use) and writes it in its history. Only items
-- of a sale waiting to be shipped; picking twice is harmless.
create function public.pick_item(p_item_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_operator(); i items; v_prep uuid; v_from text;
begin
  select * into i from items where id = p_item_id and org_id = v_org and deleted_at is null for update;
  if i.id is null then raise exception using errcode = 'LF404', message = 'Article introuvable.'; end if;
  if i.status <> 'sold' then
    raise exception using errcode = 'LF409', message = format('%s n''est pas une vente à préparer (statut : %s).', i.sku, i.status);
  end if;
  insert into locations(org_id, code, label, kind, pick_order) values (v_org, 'EMP-PREPARATION', 'Préparation des commandes', 'staging', 0)
  on conflict (org_id, code) do nothing;
  select id into v_prep from locations where org_id = v_org and code = 'EMP-PREPARATION';
  if i.current_location_id = v_prep then
    return jsonb_build_object('sku', i.sku, 'already', true);
  end if;
  select code into v_from from locations where id = i.current_location_id;
  perform private.move(i.id, v_prep, 'scan');
  insert into item_events(org_id, item_id, type, from_status, to_status, station, actor_id, payload)
  values (v_org, i.id, 'picked', i.status, i.status, 'picking', auth.uid(), jsonb_build_object('from', v_from));
  return jsonb_build_object('sku', i.sku, 'from', v_from, 'already', false);
end $$;

revoke all on function public.warehouse_sync(uuid), public.warehouse_snapshot(uuid), public.warehouse_heat(uuid, int),
  public.warehouse_item(uuid), public.pick_item(uuid) from public, anon;
grant execute on function public.warehouse_sync(uuid), public.warehouse_snapshot(uuid), public.warehouse_heat(uuid, int),
  public.warehouse_item(uuid), public.pick_item(uuid) to authenticated;
