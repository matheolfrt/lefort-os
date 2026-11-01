-- Lefort OS — prix d'achat de plusieurs articles à la fois, depuis le Stock. The chosen items take the new price;
-- the other items of their lots keep theirs: each lot's total cost moves by the difference, through a cost adjustment
-- (the lot's history keeps why). Items already sold carry the new price in their sale (margins follow), except those of
-- a closed lot: that sale's cost is frozen for the accounts, they are refused.

-- A lot's cost to share = its lines + its adjustments (adjustments were only made on closed lots until now, which this
-- function never reallocates; a reopened lot now keeps them)
create or replace function private.allocate_batch_costs(p_batch_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_batch batches; v_total bigint; v_manual bigint; v_ids uuid[]; v_w numeric[]; v_amt bigint[]; i int;
begin
  select * into v_batch from batches where id = p_batch_id;
  if v_batch.status = 'closed' then return; end if;

  select coalesce((select sum(amount_cents) from batch_cost_lines where batch_id = p_batch_id), 0)
       + coalesce((select sum(amount_cents) from batch_cost_adjustments where batch_id = p_batch_id), 0) into v_total;
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

  if v_ids is not null then
    v_amt := private.allocate_cents(greatest(v_total - v_manual, 0), v_w);
    for i in 1..array_length(v_ids, 1) loop
      update item_costs set allocated_cost_cents = v_amt[i], updated_at = now()
       where item_id = v_ids[i] and allocated_cost_cents <> v_amt[i];
    end loop;
  end if;

  update order_lines ol set cost_snapshot_cents = ic.allocated_cost_cents
    from item_costs ic join items it on it.id = ic.item_id
   where ol.item_id = ic.item_id and it.batch_id = p_batch_id and ol.status <> 'cancelled'
     and ol.cost_snapshot_cents <> ic.allocated_cost_cents;
end $$;

/**
 * p_items: [{id, cost_cents}] — each item's purchase price (the same for all, or each its own for an « Annuler »).
 * Returns {updated, errors: [{sku, error}]}.
 */
create function public.bulk_set_item_cost(p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := private.require_role('manager');
  e jsonb; v_item items; v_cost bigint; v_old bigint;
  v_updated int := 0; v_errors jsonb := '[]';
  v_delta jsonb := '{}'; v_count jsonb := '{}'; b record;
begin
  if jsonb_typeof(p_items) <> 'array' then raise exception 'Liste d''articles attendue'; end if;
  if jsonb_array_length(p_items) > 2000 then raise exception 'Trop d''articles à la fois (2 000 au plus)'; end if;
  for e in select * from jsonb_array_elements(p_items) loop
    select * into v_item from items where id = (e->>'id')::uuid and org_id = v_org;
    v_cost := (e->>'cost_cents')::bigint;
    if v_item.id is null then continue; end if;
    if v_item.deleted_at is not null then
      v_errors := v_errors || jsonb_build_object('sku', v_item.sku, 'error', 'dans la corbeille'); continue;
    end if;
    if v_cost is null or v_cost < 0 or v_cost > 100000000 then
      v_errors := v_errors || jsonb_build_object('sku', v_item.sku, 'error', 'prix invalide'); continue;
    end if;
    if exists (select 1 from order_lines ol join batches bt on bt.id = v_item.batch_id
                where ol.item_id = v_item.id and ol.status <> 'cancelled' and bt.status = 'closed') then
      v_errors := v_errors || jsonb_build_object('sku', v_item.sku, 'error', 'vendu dans un lot clôturé : le coût de la vente est figé'); continue;
    end if;
    select allocated_cost_cents into v_old from item_costs where item_id = v_item.id;
    if v_old is null then
      insert into item_costs(item_id, org_id, allocated_cost_cents, manual) values (v_item.id, v_org, v_cost, true);
      v_old := 0;
    else
      update item_costs set allocated_cost_cents = v_cost, manual = true, updated_at = now() where item_id = v_item.id;
    end if;
    -- a sale keeps the cost it was made with: the new one, so its margin is right
    update order_lines set cost_snapshot_cents = v_cost where item_id = v_item.id and status <> 'cancelled' and cost_snapshot_cents <> v_cost;
    v_updated := v_updated + 1;
    if v_cost <> v_old then
      v_delta := jsonb_set(v_delta, array[v_item.batch_id::text], to_jsonb(coalesce((v_delta->>v_item.batch_id::text)::bigint, 0) + v_cost - v_old));
      v_count := jsonb_set(v_count, array[v_item.batch_id::text], to_jsonb(coalesce((v_count->>v_item.batch_id::text)::int, 0) + 1));
    end if;
  end loop;
  -- each lot's cost moves by the difference: its other items keep their price
  for b in select key::uuid as batch_id, value::bigint as delta from jsonb_each_text(v_delta) loop
    if b.delta <> 0 then
      insert into batch_cost_adjustments(org_id, batch_id, amount_cents, reason, created_by)
      values (v_org, b.batch_id, b.delta,
              format('Prix d''achat modifié depuis le stock (%s article%s)', v_count->>b.batch_id::text, case when (v_count->>b.batch_id::text)::int > 1 then 's' else '' end),
              auth.uid());
    end if;
    perform private.allocate_batch_costs(b.batch_id);
  end loop;
  return jsonb_build_object('updated', v_updated, 'errors', v_errors);
end $$;
revoke all on function public.bulk_set_item_cost(jsonb) from public, anon;
grant execute on function public.bulk_set_item_cost(jsonb) to authenticated;

-- detects that this update is installed
create function public.bulk_item_cost_ready() returns boolean language sql stable as $$ select true $$;
revoke all on function public.bulk_item_cost_ready() from public, anon;
grant execute on function public.bulk_item_cost_ready() to authenticated;
