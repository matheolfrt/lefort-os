import { getContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Empty, PageHeader } from "@/components/ui";
import { aiEnabled } from "@/lib/drafts/ai";
import { DEFAULT_DESCRIPTION, DEFAULT_TITLE } from "@/lib/drafts/text";
import { loadSoldRows } from "@/lib/kpi/load";
import { advisePrice, buildGuide } from "@/lib/kpi/price-guide";
import { Studio, type Draft, type PhotoRow } from "./studio";

export const metadata = { title: "Annonces" };
export const maxDuration = 60; // an AI generation reads up to 8 photos

/** « Annonces » : photos added in bulk, grouped by article (SKU), measurements pasted, title and description written */
export default async function Annonces() {
  const ctx = await getContext();
  const supabase = await createClient();
  const [drafts, photos, tpl] = await Promise.all([
    supabase.from("listing_drafts").select("*").order("created_at"),
    supabase.from("draft_photos").select("id, draft_id, storage_path, file_name, position, created_at").order("position").order("created_at").limit(3000),
    supabase.from("listing_templates").select("*").maybeSingle(),
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
  // « Prix conseillé » of each article still to price, from the sales of the last 12 months (none when they cannot be read)
  const advice: Record<string, { price: number; text: string }> = {};
  const open = ((drafts.data ?? []) as Draft[]).filter((d) => d.status !== "envoye");
  if (open.length) {
    try {
      const ids = open.map((d) => d.item_id).filter((x): x is string => !!x);
      const [sold, linked] = await Promise.all([
        loadSoldRows(supabase),
        ids.length ? supabase.from("items").select("id, title, brands(name), categories(name)").in("id", ids.slice(0, 500)) : Promise.resolve({ data: [] }),
      ]);
      const guide = buildGuide(sold);
      const pick = (x: unknown) => (Array.isArray(x) ? x[0]?.name : (x as { name?: string } | null)?.name) ?? null;
      const items = new Map((linked.data ?? []).map((i) => [i.id as string, i]));
      const now = Date.now();
      for (const d of open) {
        const it = d.item_id ? items.get(d.item_id) : undefined;
        const a = advisePrice(guide, { title: d.title || (it?.title as string | null) || null, brand: pick(it?.brands), category: pick(it?.categories) }, now);
        if (a) advice[d.id] = { price: a.price, text: a.text };
      }
    } catch { /* no advice: the page works without it */ }
  }
  return (
    <>
      <PageHeader title="Annonces"
        subtitle="Ajoutez vos photos, regroupez-les par article avec leur SKU, collez vos mesures : Lefort OS écrit le titre et la description." />
      <Studio orgId={ctx.org.id} skuPrefix={ctx.org.sku_prefix} waiting={waiting} drafts={(drafts.data ?? []) as Draft[]} photos={list} ai={aiEnabled()} advice={advice}
        template={{
          title_template: tpl.data?.title_template ?? DEFAULT_TITLE,
          description_template: tpl.data?.description_template || DEFAULT_DESCRIPTION,
          instructions: tpl.data?.instructions ?? "",
          ai_model: tpl.data?.ai_model === "economique" ? "economique" : "qualite",
        }} />
    </>
  );
}
