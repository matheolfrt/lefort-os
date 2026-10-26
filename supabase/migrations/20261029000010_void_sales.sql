-- Lefort OS — delete a sale entered by mistake (duplicate import, wrong item), and delete sold items with their sale.
-- Nothing is physically deleted: the order is cancelled (audited, out of every total and of the livre des recettes),
-- its items go back on sale, or to the trash when they are deleted with it.

-- Refunds of a cancelled order leave the livre des recettes with it
create or replace view v_livre_recettes with (security_invoker = true) as
select o.org_id, (o.paid_at at time zone 'Europe/Paris')::date as date_encaissement, 'V-' || o.number as reference,
       o.channel, o.buyer_handle as client,
       (select string_agg(i.sku, ', ' order by i.sku) from order_lines ol join items i on i.id = ol.item_id
         where ol.order_id = o.id and ol.status <> 'cancelled') as nature,
       o.gross_cents as montant_cents, o.payment_method as mode_reglement
  from orders o
 where o.paid_at is not null and o.status <> 'cancelled' and not o.is_historical
union all
select r.org_id, (r.refunded_at at time zone 'Europe/Paris')::date, 'R-' || o.number, o.channel, o.buyer_handle,
       'Remboursement : ' || r.reason, -r.amount_cents, o.payment_method
  from refunds r join orders o on o.id = r.order_id
 where o.paid_at is not null and o.status <> 'cancelled' and not o.is_historical;

-- Cancels a sale whatever its state. Its items go back to "prêt à publier" (their Vinted listing is closed).
-- The Vinted transaction id is released so the sale can be imported again correctly.
create function public.void_order(p_order_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := private.require_role('manager'); v_order orders; r record; v_n int := 0;
  v_reason text := coalesce(nullif(trim(p_reason), ''), 'Vente supprimée');
begin
  select * into v_order from orders where id = p_order_id and org_id = v_org for update;
  if v_order.id is null then
    raise exception using errcode = 'LF404', message = 'Commande introuvable.';
  end if;
  if v_order.status = 'cancelled' then
    raise exception using errcode = 'LF409', message = 'Cette vente est déjà annulée.';
  end if;
  update orders set status = 'cancelled', external_order_id = null,
         notes = concat_ws(E'\n', notes, format('Supprimée : %s%s', v_reason,
                 case when v_order.external_order_id is not null then format(' (réf. %s)', v_order.external_order_id) else '' end))
   where id = v_order.id;
  for r in select ol.id, ol.item_id, i.status, i.deleted_at from order_lines ol join items i on i.id = ol.item_id
            where ol.order_id = v_order.id and ol.status <> 'cancelled' loop
    update order_lines set status = 'cancelled' where id = r.id;
    if r.status in ('sold', 'shipped', 'completed') then
      update listings set status = 'delisted', ended_at = coalesce(ended_at, now())
       where item_id = r.item_id and status in ('sold', 'active', 'reserved');
      update items set status = 'listing_ready', status_changed_at = now(), sold_at = null, shipped_at = null, completed_at = null
       where id = r.item_id;
      insert into item_events(org_id, item_id, type, from_status, to_status, station, actor_id, payload)
      values (v_org, r.item_id, 'sale_voided', r.status, 'listing_ready', 'sales', auth.uid(),
              jsonb_build_object('order_id', v_order.id, 'reason', v_reason));
    end if;
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('order_number', v_order.number, 'items', v_n);
end $$;

-- delete_items gains p_with_sales: sold items are deleted together with their sale (the whole order is cancelled;
-- the other items of a bundle go back on sale). Without it, sold items are still refused.
drop function public.delete_items(uuid[], text);
create function public.delete_items(p_item_ids uuid[], p_reason text default null, p_with_sales boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_role('manager'); v_item items; v_id uuid; v_ok int := 0; v_errors jsonb := '[]'; o record;
begin
  if cardinality(p_item_ids) > 500 then
    raise exception using errcode = 'LF422', message = 'Maximum 500 articles à la fois.';
  end if;
  foreach v_id in array p_item_ids loop
    select * into v_item from items where id = v_id and org_id = v_org and deleted_at is null;
    continue when v_item.id is null;
    begin
      if exists (select 1 from order_lines where item_id = v_id and status <> 'cancelled') then
        if not p_with_sales then
          raise exception using errcode = 'LF409', message = 'Article vendu : cochez « supprimer aussi la vente » pour le supprimer.';
        end if;
        for o in select distinct ol.order_id from order_lines ol join orders od on od.id = ol.order_id
                  where ol.item_id = v_id and ol.status <> 'cancelled' and od.status <> 'cancelled' loop
          perform public.void_order(o.order_id, coalesce(nullif(trim(p_reason), ''), 'Article supprimé'));
        end loop;
        select * into v_item from items where id = v_id;
      end if;
      update listings set status = 'delisted', ended_at = now()
       where item_id = v_id and status in ('draft', 'active', 'reserved');
      update items set deleted_at = now(), claimed_by = null, claimed_until = null where id = v_id;
      insert into item_events(org_id, item_id, type, from_status, to_status, station, actor_id, payload)
      values (v_org, v_id, 'deleted', v_item.status, v_item.status, 'stock', auth.uid(),
              jsonb_build_object('reason', nullif(trim(coalesce(p_reason, '')), ''), 'with_sale', p_with_sales));
      v_ok := v_ok + 1;
    exception when others then
      v_errors := v_errors || jsonb_build_object('sku', v_item.sku, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('updated', v_ok, 'errors', v_errors);
end $$;

revoke all on function public.void_order(uuid, text), public.delete_items(uuid[], text, boolean) from public, anon;
grant execute on function public.void_order(uuid, text), public.delete_items(uuid[], text, boolean) to authenticated;
