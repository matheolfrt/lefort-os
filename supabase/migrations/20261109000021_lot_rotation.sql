-- Lefort OS — rotation of a lot: how fast it goes online, how fast each item sells, how long the whole lot takes to
-- turn into cash. Everything is computed from the dates already kept:
--   items.listed_at  first time the item went on sale (set once, never moved by a later listing)
--   items.sold_at    date of its sale (cleared if the sale is cancelled or deleted)
-- plus one new date on the lot, set by the seller: the official start of its listing.

alter table batches add column if not exists listing_started_at timestamptz;      -- « 🚀 Premier article mis en ligne »
alter table batches add column if not exists listing_started_by uuid references auth.users(id);
alter table batches add column if not exists listing_started_edited_at timestamptz; -- last time a manager changed it
-- only through set_listing_started (never by a plain update, never automatically)
revoke update (listing_started_at, listing_started_by, listing_started_edited_at) on batches from authenticated;

-- ── One row per lot: the counts and dates the three KPI are computed from ────────────────────────────────────────
-- total     items of the lot (deleted ones excluded)
-- rejected  written off: they will never sell, so they are not waited for
-- listed    items that went on sale at least once (an item sold has necessarily been for sale)
-- sold      items sold (a cancelled, deleted or returned sale does not count)
-- avg_days_to_sell  each sold item from ITS OWN listing date, never from the lot's first listing
-- Built on items (readable by the whole team), not on the economics view (costs are for managers).
create view v_lot_rotation with (security_invoker = true) as
with i as (
  select it.batch_id, it.status, it.listed_at,
         it.status in ('sold', 'shipped', 'completed') as is_sold,
         case when it.status in ('sold', 'shipped', 'completed') then it.sold_at end as sold_at
    from items it where it.deleted_at is null
)
select b.id as batch_id, b.org_id, b.code, b.status, b.kind, b.purchased_at, b.received_at, b.created_at,
       b.listing_started_at, b.listing_started_edited_at,
       count(i.batch_id)::int as total,
       count(i.batch_id) filter (where i.status = 'rejected')::int as rejected,
       count(i.batch_id) filter (where i.status <> 'rejected' and (i.listed_at is not null or i.is_sold))::int as listed,
       count(i.batch_id) filter (where i.is_sold)::int as sold,
       min(i.listed_at) filter (where i.status <> 'rejected') as first_listed_at,
       max(i.listed_at) filter (where i.status <> 'rejected') as last_listed_at,
       min(i.sold_at) filter (where i.is_sold) as first_sold_at,
       max(i.sold_at) filter (where i.is_sold) as last_sold_at,
       round((avg(extract(epoch from i.sold_at - i.listed_at) / 86400)
              filter (where i.is_sold and i.listed_at is not null and i.sold_at >= i.listed_at))::numeric, 2) as avg_days_to_sell,
       count(i.batch_id) filter (where i.is_sold and i.listed_at is not null and i.sold_at >= i.listed_at)::int as timed
  from batches b
  left join i on i.batch_id = b.id
 group by b.id;
grant select on v_lot_rotation to authenticated;

-- ── The official start of the listing ────────────────────────────────────────────────────────────────────────────
-- The first click (anyone who publishes) records now; it is refused once set. Changing it afterwards is a manager
-- action, explicit (p_edit), and kept as « modifiée le ». A date is never guessed: p_at is what the seller chose.
create function public.set_listing_started(p_batch_id uuid, p_at timestamptz default null, p_edit boolean default false)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_org uuid := private.require_role('manager', 'operator', 'listing_operator'); b batches; v_at timestamptz;
begin
  select * into b from batches where id = p_batch_id and org_id = v_org for update;
  if b.id is null then raise exception using errcode = 'LF404', message = 'Lot introuvable.'; end if;
  v_at := coalesce(p_at, now());
  if v_at > now() + interval '5 minutes' then
    raise exception using errcode = 'LF422', message = 'La date de début ne peut pas être dans le futur.';
  end if;
  if b.listing_started_at is not null then
    if not p_edit then
      raise exception using errcode = 'LF409', message = 'La mise en ligne de ce lot a déjà commencé.';
    end if;
    perform private.require_role('manager');
    update batches set listing_started_at = v_at, listing_started_edited_at = now() where id = b.id;
  else
    -- the first time, a chosen date (items listed before the button existed) is not a « modification »
    update batches set listing_started_at = v_at, listing_started_by = auth.uid() where id = b.id;
  end if;
  return v_at;
end $$;
revoke all on function public.set_listing_started(uuid, timestamptz, boolean) from public, anon;
grant execute on function public.set_listing_started(uuid, timestamptz, boolean) to authenticated;
