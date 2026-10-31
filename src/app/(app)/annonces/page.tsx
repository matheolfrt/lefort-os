import { getContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Empty, PageHeader } from "@/components/ui";
import { aiEnabled } from "@/lib/drafts/ai";
import { DEFAULT_DESCRIPTION, DEFAULT_TITLE } from "@/lib/drafts/text";
import { Studio, type Draft, type PhotoRow } from "./studio";

export const metadata = { title: "Annonces" };
export const maxDuration = 60; // an AI generation reads up to 8 photos

/** « Annonces » : photos added in bulk, grouped by article (SKU), measurements pasted, title and description written */
export default async function Annonces() {
  const ctx = await getContext();
  const supabase = await createClient();
  const [drafts, photos, tpl] = await Promise.all([
    supabase.from("listing_drafts").select("id, sku, item_id, measures, title, description, price_cents, status, generated_by, generated_at, to_check, created_at").order("created_at"),
    supabase.from("draft_photos").select("id, draft_id, storage_path, file_name, position, created_at").order("position").order("created_at").limit(3000),
    supabase.from("listing_templates").select("title_template, description_template, instructions").maybeSingle(),
  ]);
  if (drafts.error) {
    return (
      <>
        <PageHeader title="Annonces" />
        <Empty action={ctx.isManager ? { href: "/parametres/mises-a-jour", label: "Mettre à jour la base" } : undefined}>
          La préparation des annonces a besoin d&apos;une mise à jour de la base de données{ctx.isManager ? "." : " : demandez-la à un responsable."}
        </Empty>
      </>
    );
  }
  // measurements imported for SKUs that have no article yet (null: database update not applied)
  const stored = await supabase.from("sku_measures").select("sku").order("sku").limit(5000);
  const draftSkus = new Set((drafts.data ?? []).map((d) => d.sku.toUpperCase()));
  const waiting = stored.error ? null : (stored.data ?? []).map((r) => r.sku).filter((s) => !draftSkus.has(s.toUpperCase()));
  const rows = photos.data ?? [];
  const paths = rows.map((p) => p.storage_path);
  const urls = new Map<string, string>();
  for (let i = 0; i < paths.length; i += 500) {
    const { data } = await supabase.storage.from("item-photos").createSignedUrls(paths.slice(i, i + 500), 3600);
    for (const s of data ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  const list: PhotoRow[] = rows.map((p) => ({ id: p.id, draft_id: p.draft_id, file_name: p.file_name, position: p.position, url: urls.get(p.storage_path) ?? null }));
  return (
    <>
      <PageHeader title="Annonces"
        subtitle="Ajoutez vos photos, regroupez-les par article avec leur SKU, collez vos mesures : Lefort OS écrit le titre et la description." />
      <Studio orgId={ctx.org.id} skuPrefix={ctx.org.sku_prefix} waiting={waiting} drafts={(drafts.data ?? []) as Draft[]} photos={list} ai={aiEnabled()}
        template={{
          title_template: tpl.data?.title_template ?? DEFAULT_TITLE,
          description_template: tpl.data?.description_template || DEFAULT_DESCRIPTION,
          instructions: tpl.data?.instructions ?? "",
        }} />
    </>
  );
}
