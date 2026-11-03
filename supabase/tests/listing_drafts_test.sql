-- Annonces en préparation: drafts find their stock article by SKU, photos move between the pile and drafts, the
-- model is per shop, the context gives the stock's labels, other shops see nothing. Runs on a freshly migrated database.
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
grant usage on schema t to authenticated;
grant execute on all functions in schema t to authenticated;

insert into auth.users values ('00000000-0000-0000-0000-0000000000a1', 'admin@example.com'),
                              ('00000000-0000-0000-0000-0000000000b1', 'op@example.com'),
                              ('00000000-0000-0000-0000-0000000000c1', 'other@example.com');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select public.bootstrap_organization('Lefort Second Hand', 'Mathéo');
select public.add_member('op@example.com', 'operator');
do $$ declare v_batch uuid; r jsonb; begin
  insert into suppliers(org_id, name) values (public.auth_org_id(), 'Grossiste');
  insert into batches(org_id, code, supplier_id, purchased_at, allocation_method, created_by)
  select org_id, 'LOT-A', id, current_date, 'equal', auth.uid() from suppliers limit 1 returning id into v_batch;
  r := public.create_batch_skus(v_batch, 'A-', 1, 3);
end $$;
-- A-1 is described in stock: a brand, a size, a condition, a measurement
do $$ declare v_item uuid; v_def uuid; begin
  select id into v_item from items where sku = 'A-1';
  insert into brands(org_id, name) values (public.auth_org_id(), 'Hugo Boss') on conflict do nothing;
  update items set brand_id = (select id from brands where name = 'Hugo Boss' limit 1), size_label = '50', condition = 'very_good',
    category_id = (select id from categories where measurement_template_id is not null order by name limit 1)
  where id = v_item;
  select md.id into v_def from measurement_definitions md join categories c on c.measurement_template_id = md.template_id
  join items i on i.category_id = c.id where i.id = v_item order by md.sort limit 1;
  insert into item_measurements(item_id, definition_id, org_id, value_mm) values (v_item, v_def, public.auth_org_id(), 540);
end $$;

-- drafts: SKU from stock (any case) and a SKU not in stock
insert into listing_drafts(sku) values (' a-1 '), ('NOUVEAU-7');
do $$ begin
  assert (select item_id from listing_drafts where sku = 'A-1') = (select id from items where sku = 'A-1'), 'found by SKU ignoring case, stock spelling';
  assert (select item_id from listing_drafts where sku = 'NOUVEAU-7') is null, 'not in stock';
end $$;
select t.expect_error($$insert into listing_drafts(sku) values ('a-1')$$, 'duplicate');
select t.expect_error($$insert into listing_drafts(sku) values ('A-1')$$, 'duplicate');
select t.expect_error($$insert into listing_drafts(sku) values ('deux mots')$$, 'check');
-- renaming the SKU looks the article up again
update listing_drafts set sku = 'A-2' where sku = 'NOUVEAU-7';
do $$ begin
  assert (select item_id from listing_drafts where sku = 'A-2') = (select id from items where sku = 'A-2'), 'found after rename';
end $$;

-- the context gives the stock's labels and measurements
do $$ declare c jsonb := public.listing_draft_context((select id from listing_drafts where sku = 'A-1')); begin
  assert c->'item'->>'marque' = 'Hugo Boss' and c->'item'->>'taille' = '50' and c->'item'->>'etat' = 'very_good', c::text;
  assert jsonb_array_length(c->'item'->'mesures') = 1 and (c->'item'->'mesures'->0->>'mm')::int = 540, c::text;
  assert public.listing_draft_context((select id from listing_drafts where sku = 'A-2'))->'item'->>'marque' is null;
end $$;

-- photos: in the pile, then in a draft; deleting the draft puts them back in the pile
insert into draft_photos(storage_path, file_name, position) select public.auth_org_id() || '/brouillons/p' || g || '.jpg', 'IMG_' || g || '.jpg', g
  from generate_series(1, 4) g;
update draft_photos set draft_id = (select id from listing_drafts where sku = 'A-2') where position <= 2;
do $$ begin
  assert (select count(*) from draft_photos where draft_id is null) = 2, 'two left in the pile';
end $$;

-- the operator prepares listings too, and edits the model
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
update listing_drafts set title = 'Blazer Hugo Boss T50', description = 'Très bon état', status = 'genere', generated_by = 'modele' where sku = 'A-1';
insert into listing_templates(description_template) values ('{mesures}');
update listing_templates set instructions = 'Ton simple';
select t.expect_error($$update listing_drafts set org_id = gen_random_uuid()$$, 'permission denied');
select t.expect_error($$insert into listing_drafts(sku, status) values ('X-1', 'publie')$$, 'check');

delete from listing_drafts where sku = 'A-2';
do $$ begin
  assert (select count(*) from draft_photos where draft_id is null) = 4, 'photos back in the pile';
end $$;

-- the AI choice: quality by default, economical allowed, nothing else
do $$ begin assert (select ai_model from listing_templates) = 'qualite'; end $$;
update listing_templates set ai_model = 'economique';
select t.expect_error($$update listing_templates set ai_model = 'gratuit'$$, 'check');

-- measurements imported from a file: into the prepared article, kept for the SKUs not prepared yet, never into a
-- listing marked « prête »; a later article takes them at creation
insert into listing_drafts(sku) values ('A-3');
update listing_drafts set status = 'pret' where sku = 'A-1';
do $$ declare r jsonb := public.import_sku_measures('[{"sku": "a-3", "measures": "Épaules : 44 cm"}, {"sku": "A-1", "measures": "Épaules : 50 cm"},
  {"sku": "LSH-9", "measures": "Longueur : 70 cm"}, {"sku": "A-3", "measures": "doublon"}, {"sku": "", "measures": "rien"}, {"sku": "X-1", "measures": " "}]', 'mesures.xlsx');
begin
  assert r->'applied' = '["A-3"]' and r->'pending' = '["LSH-9"]' and r->'locked' = '["A-1"]', r::text;
  assert (select measures from listing_drafts where sku = 'A-3') = 'Épaules : 44 cm', 'first of duplicates kept';
  assert (select measures from listing_drafts where sku = 'A-1') <> 'Épaules : 50 cm', 'ready listing untouched';
  assert (select count(*) from sku_measures) = 3, 'kept for every SKU read';
end $$;
insert into listing_drafts(sku) values ('lsh-9');
do $$ begin
  assert (select measures from listing_drafts where sku = 'lsh-9') = 'Longueur : 70 cm', 'taken at creation, ignoring case';
end $$;
-- a new import replaces the kept text, even written with another case
select public.import_sku_measures('[{"sku": "LSH-9", "measures": "Longueur : 71 cm"}]');
do $$ begin
  assert (select measures from listing_drafts where sku = 'lsh-9') = 'Longueur : 71 cm';
  assert (select count(*) from sku_measures where upper(sku) = 'LSH-9') = 1;
end $$;
select t.expect_error($$insert into sku_measures(sku, measures) values ('Z', 'x')$$, 'permission denied');
select t.expect_error($$select public.import_sku_measures('{}')$$, 'Liste de mesures attendue');

-- another shop sees nothing and cannot attach its photo to our draft
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select public.bootstrap_organization('Autre boutique', 'Autre');
do $$ begin
  assert (select count(*) from listing_drafts) = 0 and (select count(*) from draft_photos) = 0 and (select count(*) from listing_templates) = 0 and (select count(*) from sku_measures) = 0, 'isolated';
end $$;
reset role;
select set_config('t.draft', (select id::text from listing_drafts where sku = 'A-1'), false);
set role authenticated;
select t.expect_error(format($$insert into draft_photos(storage_path, draft_id) values ('x/brouillons/z.jpg', %L)$$, current_setting('t.draft')), 'Article inconnu');
do $$ begin
  assert public.listing_draft_context(current_setting('t.draft')::uuid) is null, 'no context for another shop';
end $$;
reset role;
select 'listing drafts tests passed';
