-- Lefort OS — Vinted orders read by the extension: match them with Lefort OS orders, then catch up their state.
-- A Vinted order is matched by its transaction id (orders.external_order_id), or else by one of its items
-- (a sale typed by hand before the sync existed).

-- p_orders: [{ transaction_id, item_ids: [vinted item ids] }]
create function public.vinted_orders_preview(p_orders jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := private.require_role('manager');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'transaction_id', o.tid,
      'order', (
        select jsonb_build_object('id', ord.id, 'number', ord.number, 'status', ord.status,
                                  'has_ref', ord.external_order_id is not null)
          from orders ord
         where ord.org_id = v_org and ord.status <> 'cancelled'
           and (ord.external_order_id = o.tid
                or (ord.external_order_id is null and exists (
                      select 1 from order_lines ol join listings li on li.item_id = ol.item_id
                       where ol.order_id = ord.id and ol.status <> 'cancelled'
                         and li.org_id = v_org and li.channel = 'vinted' and li.external_id in (select jsonb_array_elements_text(o.items)))))
         order by (ord.external_order_id = o.tid) desc nulls last, ord.sold_at desc
         limit 1),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object('external_id', x.ext, 'sku', i.sku, 'status', i.status,
                                            'deleted', i.deleted_at is not null))
          from jsonb_array_elements_text(o.items) x(ext)
          join lateral (select li.item_id from listings li
                         where li.org_id = v_org and li.channel = 'vinted' and li.external_id = x.ext
                         order by li.listed_at desc limit 1) m on true
          join items i on i.id = m.item_id), '[]')))
      from (select s->>'transaction_id' as tid, coalesce(s->'item_ids', '[]') as items
              from jsonb_array_elements(p_orders) s
             where coalesce(s->>'transaction_id', '') <> '') o
  ), '[]');
end $$;

-- p_updates: [{ order_id, transaction_id, state: 'shipped' | 'completed', shipped_at, paid_at }]
-- Moves Lefort OS orders forward to the Vinted state (never backwards) and records the transaction id.
create function public.vinted_orders_sync(p_updates jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := private.require_role('manager');
  u jsonb; v_order orders; v_shipped int := 0; v_completed int := 0; v_errors jsonb := '[]';
begin
  for u in select * from jsonb_array_elements(p_updates) loop
    begin
      select * into v_order from orders where id = (u->>'order_id')::uuid and org_id = v_org;
      if v_order.id is null then
        raise exception using errcode = 'LF404', message = 'Commande introuvable.';
      end if;
      if v_order.external_order_id is null and nullif(u->>'transaction_id', '') is not null then
        update orders set external_order_id = u->>'transaction_id' where id = v_order.id;
      end if;
      if v_order.status = 'pending' and u->>'state' in ('shipped', 'completed') then
        perform public.ship_order(v_order.id, null, null);
        if (u->>'shipped_at') is not null then
          update shipments set shipped_at = (u->>'shipped_at')::timestamptz where order_id = v_order.id;
        end if;
        v_shipped := v_shipped + 1;
        v_order.status := 'shipped';
      end if;
      if v_order.status = 'shipped' and u->>'state' = 'completed' then
        perform public.complete_order(v_order.id, coalesce((u->>'paid_at')::timestamptz, now()));
        v_completed := v_completed + 1;
      end if;
    exception when others then
      v_errors := v_errors || jsonb_build_object('order_id', u->>'order_id', 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('shipped', v_shipped, 'completed', v_completed, 'errors', v_errors);
end $$;

revoke all on function public.vinted_orders_preview(jsonb), public.vinted_orders_sync(jsonb) from public, anon;
grant execute on function public.vinted_orders_preview(jsonb), public.vinted_orders_sync(jsonb) to authenticated;
