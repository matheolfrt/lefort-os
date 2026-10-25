-- Lefort OS — domain logic
-- All state changes go through these functions. `private` is not exposed by the API;
-- public RPCs are SECURITY DEFINER and check membership + role themselves.

create schema if not exists private;

-- ───────────────────────── Auth helpers ─────────────────────────
create function public.auth_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from memberships where user_id = auth.uid() and active
$$;

create function public.auth_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from memberships where user_id = auth.uid() and active
$$;

create function public.has_role(variadic roles app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = any(roles) or role = 'admin'
                   from memberships where user_id = auth.uid() and active), false)
$$;

create function public.is_manager() returns boolean
language sql stable as $$ select public.has_role('manager') $$;

-- Raises unless the caller is an active member with one of the roles (admin always passes)
create function private.require_role(variadic roles app_role[]) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid; v_role app_role;
begin
  select org_id, role into v_org, v_role from memberships where user_id = auth.uid() and active;
  if v_org is null then
    raise exception using errcode = 'LF401', message = 'Accès refusé : aucun compte actif.';
  end if;
  if v_role <> 'admin' and not (v_role = any(roles)) then
    raise exception using errcode = 'LF403', message = 'Action non autorisée pour votre rôle.';
  end if;
  return v_org;
end $$;

-- Station roles: who may operate the production line
create function private.require_operator() returns uuid
language sql stable as $$
  select private.require_role('manager', 'operator', 'reception', 'photographer',
                              'listing_operator', 'warehouse', 'shipping')
$$;

-- ───────────────────────── Generic triggers ─────────────────────────
create function private.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger organizations_touch before update on organizations for each row execute function private.touch_updated_at();
create trigger suppliers_touch before update on suppliers for each row execute function private.touch_updated_at();
create trigger batches_touch before update on batches for each row execute function private.touch_updated_at();
create trigger orders_touch before update on orders for each row execute function private.touch_updated_at();

-- version only moves on meaningful edits (not claims or photo counters) so stations don't conflict with themselves
create function private.items_before_update() returns trigger language plpgsql as $$
declare v_noise text[] := array['claimed_by', 'claimed_until', 'photo_count', 'updated_at', 'updated_by', 'version'];
begin
  if (to_jsonb(new) - v_noise) is distinct from (to_jsonb(old) - v_noise) then
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.updated_by);
    new.version := old.version + 1;
  end if;
  return new;
end $$;
create trigger items_before_update before update on items for each row execute function private.items_before_update();

create function private.items_price_history() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.list_price_cents is distinct from old.list_price_cents then
    insert into price_changes(org_id, item_id, field, old_cents, new_cents, changed_by)
    values (new.org_id, new.id, 'list_price', old.list_price_cents, new.list_price_cents, auth.uid());
  end if;
  if new.min_price_cents is distinct from old.min_price_cents then
    insert into price_changes(org_id, item_id, field, old_cents, new_cents, changed_by)
    values (new.org_id, new.id, 'min_price', old.min_price_cents, new.min_price_cents, auth.uid());
  end if;
  return new;
end $$;
create trigger items_price_history after update of list_price_cents, min_price_cents on items
  for each row execute function private.items_price_history();

create function private.audit() returns trigger language plpgsql security definer set search_path = public as $$
declare v_row jsonb := to_jsonb(coalesce(new, old));
begin
  insert into audit_log(org_id, table_name, row_id, action, old_row, new_row, actor_id)
  values ((v_row->>'org_id')::uuid, tg_table_name,
          coalesce(v_row->>'id', v_row->>'item_id'), tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end,
          auth.uid());
  return coalesce(new, old);
end $$;
create trigger audit_batches after insert or update or delete on batches for each row execute function private.audit();
create trigger audit_batch_cost_lines after insert or update or delete on batch_cost_lines for each row execute function private.audit();
create trigger audit_batch_cost_adjustments after insert or update or delete on batch_cost_adjustments for each row execute function private.audit();
create trigger audit_item_costs after update or delete on item_costs for each row execute function private.audit();
create trigger audit_orders after insert or update or delete on orders for each row execute function private.audit();
create trigger audit_order_lines after insert or update or delete on order_lines for each row execute function private.audit();
create trigger audit_refunds after insert or update or delete on refunds for each row execute function private.audit();
create trigger audit_expenses after insert or update or delete on expenses for each row execute function private.audit();
create trigger audit_organizations after update on organizations for each row execute function private.audit();

create function private.photo_count_trigger() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update items set photo_count = (select count(*) from item_photos where item_id = coalesce(new.item_id, old.item_id))
   where id = coalesce(new.item_id, old.item_id);
  return null;
end $$;
create trigger item_photos_count after insert or delete on item_photos for each row execute function private.photo_count_trigger();

-- ───────────────────────── Financial immutability ─────────────────────────
create function private.forbid() returns trigger language plpgsql as $$
begin
  raise exception using errcode = 'LF409',
    message = format('Historique protégé : %s interdit sur %s.', tg_op, tg_table_name);
end $$;
create trigger order_lines_no_delete before delete on order_lines for each row execute function private.forbid();
create trigger orders_no_delete before delete on orders for each row execute function private.forbid();
create trigger refunds_no_change before update or delete on refunds for each row execute function private.forbid();
create trigger item_events_no_change before update or delete on item_events for each row execute function private.forbid();
create trigger moves_no_change before update or delete on item_location_moves for each row execute function private.forbid();
create trigger price_changes_no_change before update or delete on price_changes for each row execute function private.forbid();
create trigger audit_log_no_change before update or delete on audit_log for each row execute function private.forbid();
create trigger adjustments_no_change before update or delete on batch_cost_adjustments for each row execute function private.forbid();

create function private.order_lines_guard() returns trigger language plpgsql as $$
begin
  if new.item_id <> old.item_id or new.order_id <> old.order_id
     or new.sale_price_cents <> old.sale_price_cents
     or new.cost_snapshot_cents <> old.cost_snapshot_cents then
    raise exception using errcode = 'LF409', message = 'Historique protégé : le prix de vente et le coût d''une vente ne peuvent pas être modifiés.';
  end if;
  return new;
end $$;
create trigger order_lines_guard before update on order_lines for each row execute function private.order_lines_guard();

-- Order money can be corrected until the order is completed (every change is audited)
create function private.orders_guard() returns trigger language plpgsql as $$
begin
  if old.status in ('completed', 'cancelled') and (
       new.gross_cents <> old.gross_cents or new.platform_fee_cents <> old.platform_fee_cents
    or new.promotion_fee_cents <> old.promotion_fee_cents or new.shipping_cost_cents <> old.shipping_cost_cents
    or new.packaging_cost_cents <> old.packaging_cost_cents or new.tax_cents <> old.tax_cents
    or new.sold_at <> old.sold_at or new.paid_at is distinct from old.paid_at) then
    raise exception using errcode = 'LF409', message = 'Commande clôturée : montants et dates verrouillés.';
  end if;
  if new.gross_cents <> old.gross_cents then
    raise exception using errcode = 'LF409', message = 'Le montant de la vente est figé ; annulez et ressaisissez la vente.';
  end if;
  return new;
end $$;
create trigger orders_guard before update on orders for each row execute function private.orders_guard();

create function private.cost_lines_guard() returns trigger language plpgsql as $$
declare v_status batch_status;
begin
  select status into v_status from batches where id = coalesce(new.batch_id, old.batch_id);
  if v_status = 'closed' then
    raise exception using errcode = 'LF409', message = 'Lot clôturé : utilisez un ajustement de coût.';
  end if;
  return coalesce(new, old);
end $$;
create trigger cost_lines_guard before insert or update or delete on batch_cost_lines
  for each row execute function private.cost_lines_guard();

-- ───────────────────────── Money allocation ─────────────────────────
-- Splits `total` across `weights` exactly (largest remainder, ties by position)
create function private.allocate_cents(total bigint, weights numeric[]) returns bigint[]
language plpgsql immutable as $$
declare
  n int := coalesce(array_length(weights, 1), 0);
  sw numeric := 0; exact numeric; base bigint[] := '{}'; frac numeric[] := '{}';
  rem bigint; i int; w numeric[];
begin
  if n = 0 then return '{}'; end if;
  w := weights;
  for i in 1..n loop sw := sw + greatest(w[i], 0); end loop;
  if sw = 0 then w := array_fill(1::numeric, array[n]); sw := n; end if;
  for i in 1..n loop
    exact := total * greatest(w[i], 0) / sw;
    base := base || floor(exact)::bigint;
    frac := frac || (exact - floor(exact));
  end loop;
  rem := total - (select sum(x) from unnest(base) x);
  for i in (select ord from unnest(frac) with ordinality f(v, ord) order by v desc, ord limit rem) loop
    base[i] := base[i] + 1;
  end loop;
  return base;
end $$;

create function private.allocate_batch_costs(p_batch_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_batch batches; v_total bigint; v_manual bigint; v_ids uuid[]; v_w numeric[]; v_amt bigint[]; i int;
begin
  select * into v_batch from batches where id = p_batch_id;
  if v_batch.status = 'closed' then return; end if;

  select coalesce(sum(amount_cents), 0) into v_total from batch_cost_lines where batch_id = p_batch_id;
  select coalesce(sum(ic.allocated_cost_cents), 0) into v_manual
    from item_costs ic join items it on it.id = ic.item_id
   where it.batch_id = p_batch_id and ic.manual and it.deleted_at is null;

  update item_costs ic set allocated_cost_cents = 0, updated_at = now()
    from items it where it.id = ic.item_id and it.batch_id = p_batch_id
     and it.deleted_at is not null and ic.allocated_cost_cents <> 0;

  select array_agg(it.id order by it.sku),
         array_agg(case when v_batch.allocation_method = 'weighted' then coalesce(c.cost_weight, 1) else 1 end order by it.sku)
    into v_ids, v_w
    from items it join item_costs ic on ic.item_id = it.id
    left join categories c on c.id = it.category_id
   where it.batch_id = p_batch_id and it.deleted_at is null and not ic.manual;

  if v_ids is null then return; end if;
  v_amt := private.allocate_cents(greatest(v_total - v_manual, 0), v_w);
  for i in 1..array_length(v_ids, 1) loop
    update item_costs set allocated_cost_cents = v_amt[i], updated_at = now()
     where item_id = v_ids[i] and allocated_cost_cents <> v_amt[i];
  end loop;
end $$;

create function private.items_cost_trigger() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into item_costs(item_id, org_id) values (new.id, new.org_id);
  end if;
  perform private.allocate_batch_costs(new.batch_id);
  return new;
end $$;
create trigger items_cost_insert after insert on items for each row execute function private.items_cost_trigger();
create trigger items_cost_update after update of category_id, deleted_at on items
  for each row execute function private.items_cost_trigger();

create function private.cost_lines_alloc_trigger() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform private.allocate_batch_costs(coalesce(new.batch_id, old.batch_id));
  return null;
end $$;
create trigger cost_lines_alloc after insert or update or delete on batch_cost_lines
  for each row execute function private.cost_lines_alloc_trigger();

create function private.batches_alloc_trigger() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform private.allocate_batch_costs(new.id);
  return null;
end $$;
create trigger batches_alloc after update of allocation_method on batches
  for each row execute function private.batches_alloc_trigger();

-- ───────────────────────── SKU ─────────────────────────
create function private.format_sku(prefix text, n bigint) returns text
language sql immutable as $$
  select prefix || case when n < 100000 then lpad(n::text, 5, '0') else n::text end
$$;

-- Reserves `p_qty` consecutive SKUs for a batch (labels printed in advance)
create function public.issue_sku_labels(p_batch_id uuid, p_qty int) returns setof text
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_operator(); v_first bigint; v_prefix text;
begin
  if p_qty < 1 or p_qty > 1000 then
    raise exception using errcode = 'LF422', message = 'Quantité d''étiquettes invalide (1 à 1000).';
  end if;
  if not exists (select 1 from batches where id = p_batch_id and org_id = v_org and status = 'open') then
    raise exception using errcode = 'LF404', message = 'Lot introuvable ou clôturé.';
  end if;
  update organizations set sku_next = sku_next + p_qty where id = v_org
    returning sku_next - p_qty, sku_prefix into v_first, v_prefix;
  return query
    insert into sku_labels(sku, org_id, batch_id, issued_by)
    select private.format_sku(v_prefix, v_first + g), v_org, p_batch_id, auth.uid()
      from generate_series(0, p_qty - 1) g
    returning sku;
end $$;

-- ───────────────────────── State machine ─────────────────────────
create table private.item_transitions (
  from_status item_status not null,
  to_status item_status not null,
  manager_only boolean not null default false,
  primary key (from_status, to_status)
);
insert into private.item_transitions(from_status, to_status, manager_only) values
  ('received', 'sorted', false),
  ('sorted', 'photographed', false),
  ('sorted', 'measured', false),            -- combined photo+measure station
  ('photographed', 'measured', false),
  ('measured', 'listing_ready', false),
  ('listing_ready', 'listed', false),
  ('listed', 'reserved', false),
  ('reserved', 'listed', false),
  ('listed', 'listing_ready', false),       -- delisted
  ('reserved', 'listing_ready', false),
  ('listed', 'sold', false),
  ('reserved', 'sold', false),
  ('listing_ready', 'sold', false),         -- sold before being marked listed / direct sale
  ('sold', 'shipped', false),
  ('sold', 'listed', false),                -- order cancelled
  ('sold', 'listing_ready', false),
  ('shipped', 'completed', false),
  ('shipped', 'returned', false),
  ('completed', 'returned', false),
  ('returned', 'listing_ready', false),
  ('returned', 'sorted', false),            -- needs new photos
  -- hold / reject from any pre-sale state
  ('received', 'on_hold', false), ('sorted', 'on_hold', false), ('photographed', 'on_hold', false),
  ('measured', 'on_hold', false), ('listing_ready', 'on_hold', false), ('returned', 'on_hold', false),
  ('received', 'rejected', false), ('sorted', 'rejected', false), ('photographed', 'rejected', false),
  ('measured', 'rejected', false), ('listing_ready', 'rejected', false), ('returned', 'rejected', false),
  ('on_hold', 'rejected', false),
  -- release from hold (target must equal status_before_hold unless manager)
  ('on_hold', 'received', false), ('on_hold', 'sorted', false), ('on_hold', 'photographed', false),
  ('on_hold', 'measured', false), ('on_hold', 'listing_ready', false), ('on_hold', 'returned', false),
  -- corrections
  ('photographed', 'sorted', true), ('measured', 'photographed', true), ('measured', 'sorted', true),
  ('listing_ready', 'measured', true), ('rejected', 'sorted', true), ('rejected', 'received', true);

-- Statuses that only dedicated functions may set
create function private.internal_only(s item_status) returns boolean language sql immutable as $$
  select s in ('sold', 'shipped', 'completed', 'returned')
$$;

-- Returns null when the item may enter `p_to`, otherwise a message for the operator
create function private.guard(p_item items, p_to item_status) returns text
language plpgsql stable security definer set search_path = public as $$
declare v_org organizations; v_missing text; v_count int; v_kind location_kind;
begin
  select * into v_org from organizations where id = p_item.org_id;

  if p_to = 'sorted' and p_item.category_id is null then
    return 'Catégorie obligatoire.';
  end if;

  if p_to in ('photographed', 'measured') and p_item.status in ('sorted', 'returned', 'received') then
    select count(*) into v_count from item_photos where item_id = p_item.id;
    if v_count < v_org.min_photos then
      return format('Au moins %s photos requises (%s actuellement).', v_org.min_photos, v_count);
    end if;
    select string_agg(s->>'label', ', ') into v_missing
      from categories c, jsonb_array_elements(
             coalesce((select shots from shot_lists where id = c.shot_list_id), '[]')) s
     where c.id = p_item.category_id and (s->>'required')::boolean
       and not exists (select 1 from item_photos p where p.item_id = p_item.id and p.shot_key = s->>'key');
    if v_missing is not null then return 'Photos manquantes : ' || v_missing || '.'; end if;
  end if;

  if p_to = 'measured' then
    if p_item.category_id is null then return 'Catégorie obligatoire.'; end if;
    select string_agg(d.label, ', ' order by d.sort) into v_missing
      from categories c join measurement_definitions d on d.template_id = c.measurement_template_id
     where c.id = p_item.category_id and d.required
       and not exists (select 1 from item_measurements m where m.item_id = p_item.id and m.definition_id = d.id);
    if v_missing is not null then return 'Mesures manquantes : ' || v_missing || '.'; end if;
  end if;

  if p_to = 'listing_ready' then
    if p_item.category_id is null or p_item.size_label is null or p_item.condition is null then
      return 'Catégorie, taille et état obligatoires.';
    end if;
    select kind into v_kind from locations where id = p_item.current_location_id;
    if v_kind is distinct from 'storage' then
      return 'L''article doit d''abord être rangé dans un emplacement de stockage.';
    end if;
  end if;

  if p_to = 'listed' then
    if p_item.list_price_cents is null then return 'Prix de vente obligatoire.'; end if;
    if not exists (select 1 from listings where item_id = p_item.id and status in ('active', 'reserved')) then
      return 'Aucune annonce active.';
    end if;
  end if;

  if p_to = 'on_hold' and p_item.status = 'on_hold' then return 'Déjà en attente.'; end if;
  return null;
end $$;

-- Core transition. Callers have already checked auth. Applies guard, milestones, auto-location, event.
create function private.transition(
  p_item_id uuid, p_to item_status, p_station text default null,
  p_payload jsonb default '{}', p_force_guard boolean default false
) returns items
language plpgsql security definer set search_path = public as $$
declare
  v_item items; v_rule private.item_transitions; v_msg text; v_loc locations; v_from item_status;
begin
  select * into v_item from items where id = p_item_id and deleted_at is null for update;
  if v_item.id is null then
    raise exception using errcode = 'LF404', message = 'Article introuvable.';
  end if;
  v_from := v_item.status;
  if v_from = p_to then return v_item; end if;

  select * into v_rule from private.item_transitions where from_status = v_from and to_status = p_to;
  if v_rule.from_status is null then
    raise exception using errcode = 'LF409',
      message = format('Transition impossible : %s → %s.', v_from, p_to);
  end if;
  if v_rule.manager_only and not public.is_manager() then
    raise exception using errcode = 'LF403', message = 'Correction réservée aux responsables.';
  end if;
  if v_from = 'on_hold' and p_to <> 'rejected' and p_to <> v_item.status_before_hold and not public.is_manager() then
    raise exception using errcode = 'LF409',
      message = format('Cet article doit reprendre à l''étape %s.', v_item.status_before_hold);
  end if;

  if not p_force_guard then
    v_msg := private.guard(v_item, p_to);
    if v_msg is not null then
      raise exception using errcode = 'LF422', message = v_msg;
    end if;
  end if;

  update items set
    status = p_to,
    status_changed_at = now(),
    status_before_hold = case when p_to = 'on_hold' then v_from end,
    hold_reason = case when p_to = 'on_hold' then coalesce((p_payload->>'hold_reason')::hold_reason, 'other') end,
    listed_at = case when p_to = 'listed' then coalesce(listed_at, now()) else listed_at end,
    sold_at = case when p_to = 'sold' then coalesce((p_payload->>'sold_at')::timestamptz, now())
                   when v_from = 'sold' and p_to in ('listed', 'listing_ready') then null else sold_at end,
    shipped_at = case when p_to = 'shipped' then now() else shipped_at end,
    completed_at = case when p_to = 'completed' then now() else completed_at end,
    claimed_by = null, claimed_until = null
  where id = p_item_id
  returning * into v_item;

  insert into item_events(org_id, item_id, type, from_status, to_status, station, actor_id, payload)
  values (v_item.org_id, v_item.id, 'status', v_from, p_to, p_station, auth.uid(), coalesce(p_payload, '{}'));

  -- Follow the item physically: staging racks move with the workflow; leaving/returning always moves
  select l.* into v_loc from locations l where l.org_id = v_item.org_id and l.auto_for_status = p_to and l.active;
  if v_loc.id is not null and v_loc.id is distinct from v_item.current_location_id and (
       p_to in ('shipped', 'returned')
       or not exists (select 1 from locations where id = v_item.current_location_id and kind = 'storage')) then
    perform private.move(v_item.id, v_loc.id, 'auto');
    select * into v_item from items where id = p_item_id;
  end if;
  return v_item;
end $$;

create function private.move(p_item_id uuid, p_location_id uuid, p_method text) returns void
language plpgsql security definer set search_path = public as $$
declare v_from uuid; v_org uuid;
begin
  select current_location_id, org_id into v_from, v_org from items where id = p_item_id;
  if v_from is not distinct from p_location_id then return; end if;
  update items set current_location_id = p_location_id where id = p_item_id;
  insert into item_location_moves(org_id, item_id, from_location_id, to_location_id, method, moved_by)
  values (v_org, p_item_id, v_from, p_location_id, p_method, auth.uid());
end $$;

-- Public transition for stations. Optimistic locking via p_expected_version.
create function public.transition_item(
  p_item_id uuid, p_to item_status, p_expected_version int default null,
  p_station text default null, p_payload jsonb default '{}'
) returns items
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_operator(); v_item items;
begin
  select * into v_item from items where id = p_item_id and org_id = v_org;
  if v_item.id is null then raise exception using errcode = 'LF404', message = 'Article introuvable.'; end if;
  if p_expected_version is not null and v_item.version <> p_expected_version then
    raise exception using errcode = 'LF412', message = 'Article modifié entre-temps par quelqu''un d''autre. Rechargez.';
  end if;
  if private.internal_only(p_to) then
    raise exception using errcode = 'LF409', message = 'Utilisez l''écran Ventes / Expédition pour ce changement.';
  end if;
  return private.transition(p_item_id, p_to, p_station, p_payload);
end $$;

-- ───────────────────────── Reception ─────────────────────────
-- Scans a pre-printed label (or generates a SKU when p_sku is null) and registers the item.
-- p_next optionally sorts / holds / rejects it in the same call (combined reception+sort station).
create function public.receive_item(
  p_batch_id uuid, p_sku text, p_attrs jsonb default '{}',
  p_next item_status default null, p_payload jsonb default '{}'
) returns items
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := private.require_operator(); v_sku text := upper(trim(p_sku));
  v_item items; v_loc uuid;
begin
  if not exists (select 1 from batches where id = p_batch_id and org_id = v_org and status = 'open') then
    raise exception using errcode = 'LF404', message = 'Lot introuvable ou clôturé.';
  end if;
  if v_sku is null or v_sku = '' then
    select s into v_sku from public.issue_sku_labels(p_batch_id, 1) s;
  else
    if not exists (select 1 from sku_labels where sku = v_sku and org_id = v_org) then
      raise exception using errcode = 'LF404', message = format('Étiquette %s inconnue : imprimez-la depuis le lot.', v_sku);
    end if;
    if exists (select 1 from items where sku = v_sku and org_id = v_org) then
      raise exception using errcode = 'LF409', message = format('L''étiquette %s est déjà utilisée.', v_sku);
    end if;
  end if;

  select id into v_loc from locations where org_id = v_org and auto_for_status = 'received' and active;

  insert into items(org_id, sku, batch_id, created_by, current_location_id,
                    category_id, brand_id, gender, size_label, trouser_size_label,
                    color_id, pattern_id, material_id, condition, defects, notes)
  values (v_org, v_sku, p_batch_id, auth.uid(), v_loc,
          (p_attrs->>'category_id')::uuid, (p_attrs->>'brand_id')::uuid,
          coalesce(p_attrs->>'gender', 'men'), nullif(p_attrs->>'size_label', ''),
          nullif(p_attrs->>'trouser_size_label', ''),
          (p_attrs->>'color_id')::uuid, (p_attrs->>'pattern_id')::uuid, (p_attrs->>'material_id')::uuid,
          (p_attrs->>'condition')::item_condition, nullif(p_attrs->>'defects', ''), nullif(p_attrs->>'notes', ''))
  returning * into v_item;

  if v_loc is not null then
    insert into item_location_moves(org_id, item_id, to_location_id, method, moved_by)
    values (v_org, v_item.id, v_loc, 'auto', auth.uid());
  end if;
  insert into item_events(org_id, item_id, type, to_status, station, actor_id)
  values (v_org, v_item.id, 'status', 'received', 'reception', auth.uid());

  update batches set received_at = coalesce(received_at, current_date) where id = p_batch_id;

  if p_next is not null then
    v_item := private.transition(v_item.id, p_next, 'reception', p_payload);
  end if;
  return v_item;
end $$;

-- ───────────────────────── Station queue / claims ─────────────────────────
create function private.station_statuses(p_station text) returns item_status[]
language sql immutable as $$
  select case p_station
    when 'sort' then array['received']::item_status[]
    when 'photo' then array['sorted']::item_status[]
    when 'measure' then array['photographed']::item_status[]
    when 'photo_measure' then array['sorted', 'photographed']::item_status[]
    when 'storage' then array['measured', 'returned']::item_status[]
    when 'listing' then array['listing_ready']::item_status[]
    when 'shipping' then array['sold']::item_status[]
  end
$$;

-- Hands the operator the next item for a station and leases it for 10 minutes
create function public.claim_next_item(p_station text, p_batch_id uuid default null, p_skip uuid[] default '{}')
returns items
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_operator(); v_item items; v_statuses item_status[] := private.station_statuses(p_station);
begin
  if v_statuses is null then raise exception using errcode = 'LF422', message = 'Poste inconnu.'; end if;
  select * into v_item from items
   where org_id = v_org and deleted_at is null and status = any(v_statuses)
     and (p_batch_id is null or batch_id = p_batch_id)
     and not (id = any(p_skip))
     and (claimed_by is null or claimed_until < now() or claimed_by = auth.uid())
   order by (claimed_by = auth.uid() and claimed_until >= now()) desc nulls last, received_at, sku
   limit 1
   for update skip locked;
  if v_item.id is null then return null; end if;
  update items set claimed_by = auth.uid(), claimed_until = now() + interval '10 minutes'
   where id = v_item.id returning * into v_item;
  return v_item;
end $$;

-- Opens a specific (scanned) item at a station
create function public.claim_item(p_item_id uuid, p_force boolean default false) returns items
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_operator(); v_item items; v_name text;
begin
  select * into v_item from items where id = p_item_id and org_id = v_org and deleted_at is null for update;
  if v_item.id is null then raise exception using errcode = 'LF404', message = 'Article introuvable.'; end if;
  if v_item.claimed_by is not null and v_item.claimed_by <> auth.uid() and v_item.claimed_until >= now()
     and not (p_force and public.is_manager()) then
    select full_name into v_name from profiles where id = v_item.claimed_by;
    raise exception using errcode = 'LF423',
      message = format('Article en cours de traitement par %s.', coalesce(nullif(v_name, ''), 'un autre opérateur'));
  end if;
  update items set claimed_by = auth.uid(), claimed_until = now() + interval '10 minutes'
   where id = p_item_id returning * into v_item;
  return v_item;
end $$;

create function public.release_item(p_item_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_operator();
begin
  update items set claimed_by = null, claimed_until = null
   where id = p_item_id and org_id = v_org and claimed_by = auth.uid();
end $$;

-- Resolves a scanned code to an item (SKU) — used by the global scan router
create function public.find_item_by_sku(p_sku text) returns items
language sql stable security definer set search_path = public as $$
  select i.* from items i
   where i.org_id = public.auth_org_id() and i.sku = upper(trim(p_sku)) and i.deleted_at is null
$$;

-- ───────────────────────── Warehouse ─────────────────────────
-- Moves an item to a scanned location. A measured/returned item that lands in storage
-- is promoted to LISTING_READY automatically when its data is complete.
create function public.move_item(p_item_id uuid, p_location_code text, p_method text default 'scan')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := private.require_operator(); v_item items; v_loc locations; v_msg text;
  v_promoted boolean := false; v_count int;
begin
  select * into v_item from items where id = p_item_id and org_id = v_org and deleted_at is null for update;
  if v_item.id is null then raise exception using errcode = 'LF404', message = 'Article introuvable.'; end if;
  if v_item.status in ('shipped', 'completed') then
    raise exception using errcode = 'LF409', message = 'Article déjà expédié.';
  end if;
  select * into v_loc from locations where org_id = v_org and code = upper(trim(p_location_code)) and active;
  if v_loc.id is null then
    raise exception using errcode = 'LF404', message = format('Emplacement %s inconnu.', upper(trim(p_location_code)));
  end if;

  perform private.move(p_item_id, v_loc.id, p_method);
  select * into v_item from items where id = p_item_id;

  if v_loc.kind = 'storage' and v_item.status in ('measured', 'returned') then
    v_msg := private.guard(v_item, 'listing_ready');
    if v_msg is null then
      perform private.transition(p_item_id, 'listing_ready', 'storage');
      v_promoted := true;
    end if;
  end if;

  select count(*) into v_count from items where current_location_id = v_loc.id and deleted_at is null;
  return jsonb_build_object(
    'location_code', v_loc.code, 'promoted', v_promoted, 'pending_reason', v_msg,
    'occupancy', v_count, 'capacity', v_loc.capacity);
end $$;

-- Creates a grid of storage locations, e.g. zone A, 3 shelves × 5 bins → EMP-A-01-01 … EMP-A-03-05
create function public.create_location_range(p_zone text, p_shelves int, p_bins int, p_capacity int default null)
returns int
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_role('manager'); v_n int;
begin
  if p_zone !~ '^[A-Z0-9]{1,3}$' or p_shelves not between 1 and 99 or p_bins not between 1 and 99 then
    raise exception using errcode = 'LF422', message = 'Paramètres d''emplacements invalides.';
  end if;
  insert into locations(org_id, code, kind, pick_order, capacity)
  select v_org, format('EMP-%s-%s-%s', p_zone, lpad(s::text, 2, '0'), lpad(b::text, 2, '0')), 'storage',
         s * 100 + b, p_capacity
    from generate_series(1, p_shelves) s, generate_series(1, p_bins) b
  on conflict (org_id, code) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ───────────────────────── Listing ─────────────────────────
create function public.publish_item(
  p_item_id uuid, p_url text, p_price_cents bigint,
  p_title text default null, p_description text default null,
  p_channel text default 'vinted', p_external_id text default null
) returns items
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_role('manager', 'operator', 'listing_operator'); v_item items;
begin
  select * into v_item from items where id = p_item_id and org_id = v_org and deleted_at is null for update;
  if v_item.id is null then raise exception using errcode = 'LF404', message = 'Article introuvable.'; end if;
  if p_price_cents is null or p_price_cents <= 0 then
    raise exception using errcode = 'LF422', message = 'Prix de vente obligatoire.';
  end if;
  if v_item.min_price_cents is not null and p_price_cents < v_item.min_price_cents then
    raise exception using errcode = 'LF422', message = 'Le prix est inférieur au prix minimum.';
  end if;

  update items set list_price_cents = p_price_cents,
                   title = coalesce(p_title, title), description = coalesce(p_description, description)
   where id = p_item_id;

  update listings set status = 'delisted', ended_at = now()
   where item_id = p_item_id and channel = p_channel and status in ('draft', 'active', 'reserved');
  insert into listings(org_id, item_id, channel, external_id, url, title, description, price_cents, created_by)
  values (v_org, p_item_id, p_channel, nullif(p_external_id, ''), nullif(p_url, ''),
          coalesce(p_title, v_item.title), coalesce(p_description, v_item.description), p_price_cents, auth.uid());

  return private.transition(p_item_id, 'listed', 'listing', jsonb_build_object('channel', p_channel, 'url', p_url));
end $$;

create function public.unpublish_item(p_item_id uuid, p_reason text default null) returns items
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_role('manager', 'operator', 'listing_operator');
begin
  if not exists (select 1 from items where id = p_item_id and org_id = v_org) then
    raise exception using errcode = 'LF404', message = 'Article introuvable.';
  end if;
  update listings set status = 'delisted', ended_at = now()
   where item_id = p_item_id and status in ('draft', 'active', 'reserved');
  return private.transition(p_item_id, 'listing_ready', 'listing', jsonb_build_object('reason', p_reason));
end $$;

-- ───────────────────────── Sales ─────────────────────────
-- Records a sale of one or more items (bundle). Gross is split across items by list price;
-- the item cost is snapshotted so later cost or price edits never rewrite history.
create function public.record_sale(
  p_item_ids uuid[], p_gross_cents bigint,
  p_sold_at timestamptz default now(), p_channel text default 'vinted',
  p_external_order_id text default null, p_buyer text default null,
  p_platform_fee_cents bigint default null, p_promotion_fee_cents bigint default 0,
  p_shipping_cost_cents bigint default 0, p_packaging_cost_cents bigint default 0,
  p_notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org_id uuid := private.require_role('manager', 'operator', 'listing_operator');
  v_org organizations; v_order uuid; v_ids uuid[]; v_w numeric[]; v_costs bigint[];
  v_alloc bigint[]; v_tax bigint := 0; v_fee bigint; i int; v_bad text;
begin
  if p_item_ids is null or cardinality(p_item_ids) = 0 then
    raise exception using errcode = 'LF422', message = 'Aucun article sélectionné.';
  end if;
  if p_gross_cents is null or p_gross_cents < 0 then
    raise exception using errcode = 'LF422', message = 'Montant de vente invalide.';
  end if;
  select * into v_org from organizations where id = v_org_id;

  perform 1 from items where id = any(p_item_ids) and org_id = v_org_id order by id for update;
  select string_agg(sku || ' (' || status || ')', ', ') into v_bad from items
   where id = any(p_item_ids) and (org_id <> v_org_id or deleted_at is not null
         or status not in ('listing_ready', 'listed', 'reserved'));
  if v_bad is not null then
    raise exception using errcode = 'LF409', message = 'Articles non vendables : ' || v_bad || '.';
  end if;
  if (select count(*) from items where id = any(p_item_ids) and org_id = v_org_id) <> cardinality(array(select distinct unnest(p_item_ids))) then
    raise exception using errcode = 'LF404', message = 'Article introuvable.';
  end if;

  select array_agg(it.id order by it.sku), array_agg(coalesce(it.list_price_cents, 1)::numeric order by it.sku),
         array_agg(coalesce(ic.allocated_cost_cents, 0) order by it.sku)
    into v_ids, v_w, v_costs
    from items it left join item_costs ic on ic.item_id = it.id
   where it.id = any(p_item_ids);
  v_alloc := private.allocate_cents(p_gross_cents, v_w);

  if v_org.vat_regime = 'margin_scheme' then
    for i in 1..array_length(v_ids, 1) loop
      v_tax := v_tax + greatest(round((v_alloc[i] - v_costs[i]) * 20.0 / 120.0), 0)::bigint;
    end loop;
  end if;
  v_fee := coalesce(p_platform_fee_cents,
            case when p_channel = 'vinted'
                 then round(p_gross_cents * v_org.vinted_fee_pct / 100)::bigint + v_org.vinted_fee_fixed_cents
                 else 0 end);

  insert into orders(org_id, channel, external_order_id, buyer_handle, sold_at, gross_cents,
                     platform_fee_cents, promotion_fee_cents, shipping_cost_cents, packaging_cost_cents,
                     tax_cents, vat_regime_at_sale, notes, created_by)
  values (v_org_id, p_channel, nullif(p_external_order_id, ''), nullif(p_buyer, ''), p_sold_at, p_gross_cents,
          v_fee, coalesce(p_promotion_fee_cents, 0), coalesce(p_shipping_cost_cents, 0),
          coalesce(p_packaging_cost_cents, 0), v_tax, v_org.vat_regime, p_notes, auth.uid())
  returning id into v_order;

  for i in 1..array_length(v_ids, 1) loop
    insert into order_lines(org_id, order_id, item_id, sale_price_cents, cost_snapshot_cents)
    values (v_org_id, v_order, v_ids[i], v_alloc[i], v_costs[i]);
    update listings set status = 'sold', ended_at = p_sold_at
     where item_id = v_ids[i] and status in ('active', 'reserved') and channel = p_channel;
    update listings set status = 'delisted', ended_at = now()
     where item_id = v_ids[i] and status in ('draft', 'active', 'reserved');
    perform private.transition(v_ids[i], 'sold', 'sales',
              jsonb_build_object('order_id', v_order, 'sold_at', p_sold_at));
  end loop;
  return v_order;
end $$;

create function public.ship_order(p_order_id uuid, p_carrier text default null, p_tracking text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_role('manager', 'operator', 'warehouse', 'shipping'); r record;
begin
  if not exists (select 1 from orders where id = p_order_id and org_id = v_org and status = 'pending') then
    raise exception using errcode = 'LF409', message = 'Commande introuvable ou déjà expédiée.';
  end if;
  insert into shipments(org_id, order_id, carrier, tracking_number, created_by)
  values (v_org, p_order_id, nullif(p_carrier, ''), nullif(p_tracking, ''), auth.uid());
  update orders set status = 'shipped' where id = p_order_id;
  for r in select item_id from order_lines where order_id = p_order_id and status = 'active' loop
    perform private.transition(r.item_id, 'shipped', 'shipping', jsonb_build_object('order_id', p_order_id));
  end loop;
end $$;

-- Buyer confirmed / money released to the wallet: this date counts for the livre des recettes
create function public.complete_order(p_order_id uuid, p_paid_at timestamptz default now()) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_role('manager', 'operator'); r record;
begin
  if not exists (select 1 from orders where id = p_order_id and org_id = v_org and status = 'shipped') then
    raise exception using errcode = 'LF409', message = 'Seule une commande expédiée peut être clôturée.';
  end if;
  update orders set status = 'completed', paid_at = coalesce(p_paid_at, now()) where id = p_order_id;
  for r in select item_id from order_lines where order_id = p_order_id and status = 'active' loop
    perform private.transition(r.item_id, 'completed', 'sales', jsonb_build_object('order_id', p_order_id));
  end loop;
end $$;

-- Cancelled before shipping: items go back on sale
create function public.cancel_order(p_order_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_role('manager', 'operator'); r record; v_listing uuid; v_channel text;
begin
  select channel into v_channel from orders where id = p_order_id and org_id = v_org and status = 'pending';
  if v_channel is null then
    raise exception using errcode = 'LF409', message = 'Seule une commande non expédiée peut être annulée.';
  end if;
  update orders set status = 'cancelled', notes = concat_ws(E'\n', notes, 'Annulée : ' || p_reason) where id = p_order_id;
  for r in select id, item_id from order_lines where order_id = p_order_id and status = 'active' loop
    update order_lines set status = 'cancelled' where id = r.id;
    select id into v_listing from listings where item_id = r.item_id and channel = v_channel and status = 'sold'
     order by listed_at desc limit 1;
    if v_listing is not null then
      update listings set status = 'active', ended_at = null where id = v_listing;
      perform private.transition(r.item_id, 'listed', 'sales', jsonb_build_object('order_id', p_order_id, 'reason', p_reason));
    else
      perform private.transition(r.item_id, 'listing_ready', 'sales', jsonb_build_object('order_id', p_order_id, 'reason', p_reason));
    end if;
  end loop;
end $$;

-- Refund (partial or full). When items come back (rétractation), they return to inspection.
create function public.record_refund(
  p_order_id uuid, p_amount_cents bigint, p_reason text,
  p_returned_item_ids uuid[] default '{}', p_refunded_at timestamptz default now()
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := private.require_role('manager'); v_lines uuid[]; v_items uuid[]; v_w numeric[];
  v_alloc bigint[]; i int;
begin
  if not exists (select 1 from orders where id = p_order_id and org_id = v_org and status in ('shipped', 'completed')) then
    raise exception using errcode = 'LF409', message = 'Remboursement possible uniquement sur une commande expédiée.';
  end if;
  if p_amount_cents < 0 then raise exception using errcode = 'LF422', message = 'Montant invalide.'; end if;

  if coalesce(cardinality(p_returned_item_ids), 0) = 0 then
    insert into refunds(org_id, order_id, amount_cents, reason, refunded_at, created_by)
    values (v_org, p_order_id, p_amount_cents, p_reason, p_refunded_at, auth.uid());
    return;
  end if;

  select array_agg(id order by id), array_agg(item_id order by id), array_agg(sale_price_cents::numeric order by id)
    into v_lines, v_items, v_w
    from order_lines where order_id = p_order_id and status = 'active' and item_id = any(p_returned_item_ids);
  if v_lines is null or array_length(v_lines, 1) <> cardinality(p_returned_item_ids) then
    raise exception using errcode = 'LF422', message = 'Articles retournés invalides pour cette commande.';
  end if;
  v_alloc := private.allocate_cents(p_amount_cents, v_w);
  for i in 1..array_length(v_lines, 1) loop
    insert into refunds(org_id, order_id, order_line_id, amount_cents, item_returned, reason, refunded_at, created_by)
    values (v_org, p_order_id, v_lines[i], v_alloc[i], true, p_reason, p_refunded_at, auth.uid());
    update order_lines set status = 'returned' where id = v_lines[i];
    perform private.transition(v_items[i], 'returned', 'sales', jsonb_build_object('order_id', p_order_id, 'reason', p_reason));
  end loop;
end $$;

-- Operators see what to ship without seeing money
create function public.shipping_queue() returns table (
  order_id uuid, order_number bigint, channel text, buyer_handle text, sold_at timestamptz,
  item_id uuid, sku text, title text, size_label text, location_code text, pick_order int, item_status item_status
)
language sql stable security definer set search_path = public as $$
  select o.id, o.number, o.channel, o.buyer_handle, o.sold_at, i.id, i.sku, i.title, i.size_label,
         l.code, l.pick_order, i.status
    from orders o
    join order_lines ol on ol.order_id = o.id and ol.status = 'active'
    join items i on i.id = ol.item_id
    left join locations l on l.id = i.current_location_id
   where o.org_id = public.auth_org_id() and o.status = 'pending'
   order by o.sold_at, l.pick_order, i.sku
$$;

-- ───────────────────────── Batches ─────────────────────────
create function public.close_batch(p_batch_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_role('manager');
begin
  perform private.allocate_batch_costs(p_batch_id);
  update batches set status = 'closed', closed_at = now(), closed_by = auth.uid()
   where id = p_batch_id and org_id = v_org and status = 'open';
  if not found then raise exception using errcode = 'LF409', message = 'Lot introuvable ou déjà clôturé.'; end if;
end $$;

create function public.reopen_batch(p_batch_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_role('admin');
begin
  update batches set status = 'open', closed_at = null, closed_by = null
   where id = p_batch_id and org_id = v_org and status = 'closed';
  if not found then raise exception using errcode = 'LF409', message = 'Lot introuvable ou déjà ouvert.'; end if;
  perform private.allocate_batch_costs(p_batch_id);
end $$;

-- Manual cost for one item (null = back to automatic allocation)
create function public.set_item_cost(p_item_id uuid, p_cost_cents bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_role('manager'); v_batch uuid;
begin
  select i.batch_id into v_batch from items i join batches b on b.id = i.batch_id
   where i.id = p_item_id and i.org_id = v_org and b.status = 'open';
  if v_batch is null then raise exception using errcode = 'LF409', message = 'Article introuvable ou lot clôturé.'; end if;
  update item_costs set manual = p_cost_cents is not null,
                        allocated_cost_cents = coalesce(p_cost_cents, allocated_cost_cents), updated_at = now()
   where item_id = p_item_id;
  perform private.allocate_batch_costs(v_batch);
end $$;

-- ───────────────────────── Organization bootstrap ─────────────────────────
create function private.seed_org_defaults(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  t_blazer uuid; t_suit uuid; t_trousers uuid; t_coat uuid; t_waistcoat uuid; t_shirt uuid;
  s_jacket uuid; s_suit uuid; s_simple uuid;
begin
  insert into locations(org_id, code, label, kind, auto_for_status, pick_order) values
    (p_org, 'EMP-RECEPTION', 'Réception', 'staging', 'received', 0),
    (p_org, 'EMP-ATTENTE-PHOTO', 'Portant photo', 'staging', 'sorted', 0),
    (p_org, 'EMP-ATTENTE-MESURES', 'Portant mesures', 'staging', 'photographed', 0),
    (p_org, 'EMP-A-RANGER', 'À ranger', 'staging', 'measured', 0),
    (p_org, 'EMP-RETOUCHES', 'Retouches / attente', 'staging', 'on_hold', 0),
    (p_org, 'EMP-ECARTS', 'Écarts', 'staging', 'rejected', 0),
    (p_org, 'EMP-RETOURS', 'Retours clients', 'staging', 'returned', 0),
    (p_org, 'EMP-EXPEDIE', 'Expédié', 'virtual', 'shipped', 0);
  insert into locations(org_id, code, kind, pick_order)
  select p_org, format('EMP-A-01-%s', lpad(b::text, 2, '0')), 'storage', 100 + b from generate_series(1, 5) b;

  insert into measurement_templates(org_id, name) values (p_org, 'Veste / Blazer') returning id into t_blazer;
  insert into measurement_templates(org_id, name) values (p_org, 'Costume') returning id into t_suit;
  insert into measurement_templates(org_id, name) values (p_org, 'Pantalon') returning id into t_trousers;
  insert into measurement_templates(org_id, name) values (p_org, 'Manteau') returning id into t_coat;
  insert into measurement_templates(org_id, name) values (p_org, 'Gilet') returning id into t_waistcoat;
  insert into measurement_templates(org_id, name) values (p_org, 'Chemise') returning id into t_shirt;

  insert into measurement_definitions(template_id, key, label, min_mm, max_mm, required, sort)
  select t, k, l, mn, mx, r, s from (values
    (t_blazer, 'pit_to_pit', 'Aisselle à aisselle', 400, 800, true, 1),
    (t_blazer, 'shoulders', 'Épaules', 350, 600, true, 2),
    (t_blazer, 'sleeve', 'Manche', 500, 750, true, 3),
    (t_blazer, 'back_length', 'Longueur dos', 600, 900, true, 4),
    (t_suit, 'pit_to_pit', 'Veste — aisselle à aisselle', 400, 800, true, 1),
    (t_suit, 'shoulders', 'Veste — épaules', 350, 600, true, 2),
    (t_suit, 'sleeve', 'Veste — manche', 500, 750, true, 3),
    (t_suit, 'back_length', 'Veste — longueur dos', 600, 900, true, 4),
    (t_suit, 'waist', 'Pantalon — tour de taille à plat', 300, 650, true, 5),
    (t_suit, 'inseam', 'Pantalon — entrejambe', 600, 950, true, 6),
    (t_suit, 'outseam', 'Pantalon — longueur extérieure', 850, 1200, true, 7),
    (t_suit, 'rise', 'Pantalon — fourche', 200, 350, false, 8),
    (t_suit, 'leg_opening', 'Pantalon — bas de jambe à plat', 150, 300, false, 9),
    (t_trousers, 'waist', 'Tour de taille à plat', 300, 650, true, 1),
    (t_trousers, 'inseam', 'Entrejambe', 600, 950, true, 2),
    (t_trousers, 'outseam', 'Longueur extérieure', 850, 1200, true, 3),
    (t_trousers, 'rise', 'Fourche', 200, 350, false, 4),
    (t_trousers, 'leg_opening', 'Bas de jambe à plat', 150, 300, false, 5),
    (t_coat, 'pit_to_pit', 'Aisselle à aisselle', 450, 850, true, 1),
    (t_coat, 'shoulders', 'Épaules', 350, 650, true, 2),
    (t_coat, 'sleeve', 'Manche', 500, 800, true, 3),
    (t_coat, 'back_length', 'Longueur dos', 700, 1300, true, 4),
    (t_waistcoat, 'pit_to_pit', 'Aisselle à aisselle', 380, 750, true, 1),
    (t_waistcoat, 'length', 'Longueur', 450, 800, true, 2),
    (t_shirt, 'pit_to_pit', 'Aisselle à aisselle', 400, 750, true, 1),
    (t_shirt, 'shoulders', 'Épaules', 350, 600, true, 2),
    (t_shirt, 'sleeve', 'Manche', 500, 750, true, 3),
    (t_shirt, 'back_length', 'Longueur dos', 650, 950, true, 4)
  ) v(t, k, l, mn, mx, r, s);

  insert into shot_lists(org_id, name, shots) values (p_org, 'Veste', '[
    {"key":"front","label":"Face","required":true},
    {"key":"back","label":"Dos","required":true},
    {"key":"label","label":"Étiquette marque","required":true},
    {"key":"composition","label":"Étiquette composition","required":false},
    {"key":"detail","label":"Détail","required":false},
    {"key":"defect","label":"Défaut","required":false}]') returning id into s_jacket;
  insert into shot_lists(org_id, name, shots) values (p_org, 'Costume', '[
    {"key":"front","label":"Ensemble face","required":true},
    {"key":"back","label":"Ensemble dos","required":true},
    {"key":"trousers","label":"Pantalon","required":true},
    {"key":"label","label":"Étiquette marque","required":true},
    {"key":"composition","label":"Étiquette composition","required":false},
    {"key":"detail","label":"Détail","required":false},
    {"key":"defect","label":"Défaut","required":false}]') returning id into s_suit;
  insert into shot_lists(org_id, name, shots) values (p_org, 'Simple', '[
    {"key":"front","label":"Face","required":true},
    {"key":"back","label":"Dos","required":false},
    {"key":"label","label":"Étiquette marque","required":false},
    {"key":"defect","label":"Défaut","required":false}]') returning id into s_simple;

  insert into categories(org_id, name, hotkey, cost_weight, measurement_template_id, shot_list_id) values
    (p_org, 'Blazer', 1, 1.0, t_blazer, s_jacket),
    (p_org, 'Costume', 2, 1.8, t_suit, s_suit),
    (p_org, 'Pantalon', 3, 0.5, t_trousers, s_simple),
    (p_org, 'Manteau', 4, 1.5, t_coat, s_jacket),
    (p_org, 'Gilet', 5, 0.4, t_waistcoat, s_simple),
    (p_org, 'Chemise', 6, 0.4, t_shirt, s_simple),
    (p_org, 'Cravate / accessoire', 7, 0.2, null, s_simple),
    (p_org, 'Autre', 9, 1.0, null, s_simple);

  insert into attribute_values(org_id, kind, value, sort)
  select p_org, k::attr_kind, v, o from (
    select 'color' k, v, o from unnest(array['Bleu marine','Bleu','Gris','Gris anthracite','Noir','Beige','Camel',
      'Marron','Vert','Bordeaux','Blanc','Écru','Multicolore']) with ordinality t(v, o)
    union all
    select 'pattern', v, o from unnest(array['Uni','Rayures tennis','Carreaux','Prince de Galles','Pied-de-poule',
      'Chevrons','Œil-de-perdrix','Texturé']) with ordinality t(v, o)
    union all
    select 'material', v, o from unnest(array['Laine','Laine vierge','Flanelle','Cachemire','Tweed','Lin','Coton',
      'Velours','Soie','Mélange laine','Polyester']) with ordinality t(v, o)
    union all
    select 'fit', v, o from unnest(array['Slim','Ajustée','Classique','Ample']) with ordinality t(v, o)
  ) s;

  insert into brands(org_id, name, tier)
  select p_org, n, t::brand_tier from (values
    ('Sans marque', 'unknown'),
    ('Ermenegildo Zegna', 'premium'), ('Canali', 'premium'), ('Brioni', 'premium'), ('Corneliani', 'premium'),
    ('Lardini', 'premium'), ('Boglioli', 'premium'), ('Giorgio Armani', 'premium'), ('Yves Saint Laurent', 'premium'),
    ('Dior', 'premium'), ('Lanvin', 'premium'), ('Cerruti 1881', 'premium'), ('Pal Zileri', 'premium'),
    ('Hugo Boss', 'mid'), ('Ralph Lauren', 'mid'), ('Suitsupply', 'mid'), ('Hackett', 'mid'),
    ('Emporio Armani', 'mid'), ('Façonnable', 'mid'), ('Tommy Hilfiger', 'mid'), ('Massimo Dutti', 'mid'),
    ('Lacoste', 'mid'), ('Ted Baker', 'mid'), ('Paul Smith', 'mid'), ('Galeries Lafayette', 'mid'),
    ('Zara', 'mass'), ('H&M', 'mass'), ('Mango', 'mass'), ('Celio', 'mass'), ('Jules', 'mass'),
    ('Brice', 'mass'), ('Kiabi', 'mass'), ('C&A', 'mass')
  ) v(n, t);

  -- Micro-entreprise rates (vente de marchandises). Verify current values on urssaf.fr.
  insert into tax_rates(org_id, kind, rate_pct, valid_from) values
    (p_org, 'urssaf_bic_vente', 12.3, '2022-10-01'),
    (p_org, 'versement_liberatoire', 1.0, '2009-01-01'),
    (p_org, 'cfp', 0.1, '2018-01-01');
end $$;

-- First login: creates the organization and makes the caller its admin
create function public.bootstrap_organization(p_trade_name text, p_full_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if auth.uid() is null then raise exception using errcode = 'LF401', message = 'Non connecté.'; end if;
  if exists (select 1 from memberships where user_id = auth.uid()) then
    raise exception using errcode = 'LF409', message = 'Ce compte appartient déjà à une organisation.';
  end if;
  insert into organizations(trade_name) values (coalesce(nullif(trim(p_trade_name), ''), 'Lefort Second Hand'))
    returning id into v_org;
  insert into profiles(id, full_name) values (auth.uid(), coalesce(p_full_name, ''))
    on conflict (id) do update set full_name = excluded.full_name;
  insert into memberships(org_id, user_id, role) values (v_org, auth.uid(), 'admin');
  perform private.seed_org_defaults(v_org);
  return v_org;
end $$;

-- Adds an already signed-up user to the caller's organization
create function public.add_member(p_email text, p_role app_role, p_full_name text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_role('admin'); v_user uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception using errcode = 'LF404', message = 'Aucun compte avec cet e-mail : la personne doit d''abord créer son compte.';
  end if;
  insert into profiles(id, full_name) values (v_user, coalesce(p_full_name, ''))
    on conflict (id) do update set full_name = coalesce(nullif(excluded.full_name, ''), profiles.full_name);
  insert into memberships(org_id, user_id, role) values (v_org, v_user, p_role)
    on conflict (org_id, user_id) do update set role = excluded.role, active = true;
  return v_user;
end $$;

create function public.set_member(p_user_id uuid, p_role app_role, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_role('admin');
begin
  if p_user_id = auth.uid() and (p_role <> 'admin' or not p_active) then
    raise exception using errcode = 'LF409', message = 'Vous ne pouvez pas retirer vos propres droits administrateur.';
  end if;
  update memberships set role = p_role, active = p_active where org_id = v_org and user_id = p_user_id;
end $$;
