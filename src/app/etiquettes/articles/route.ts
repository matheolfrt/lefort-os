import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { itemLabelsPdf, LABEL_FORMATS, type LabelFormat } from "@/lib/labels";

// GET /etiquettes/articles?batch=<id>&scope=unused|all&format=57x32  or  ?skus=LSH00001,LSH00002
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const format = (p.get("format") ?? "57x32") as LabelFormat;
  if (!LABEL_FORMATS[format]) return NextResponse.json({ error: "Format inconnu" }, { status: 400 });
  const supabase = await createClient();

  let skus: string[] = [];
  if (p.get("skus")) {
    skus = p.get("skus")!.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  } else if (p.get("batch")) {
    const { data } = await supabase.from("sku_labels").select("sku").eq("batch_id", p.get("batch")!).order("sku");
    skus = (data ?? []).map((r) => r.sku);
    if (p.get("scope") !== "all") {
      const { data: used } = await supabase.from("items").select("sku").eq("batch_id", p.get("batch")!);
      const usedSet = new Set((used ?? []).map((r) => r.sku));
      skus = skus.filter((s) => !usedSet.has(s));
    }
  }
  if (!skus.length) return NextResponse.json({ error: "Aucune étiquette à imprimer" }, { status: 404 });

  const [{ data: items }, { data: org }] = await Promise.all([
    supabase.from("items").select("sku, size_label, brands(name)").in("sku", skus),
    supabase.from("organizations").select("trade_name").single(),
  ]);
  const info = new Map((items ?? []).map((i) => [i.sku, i]));
  const labels = skus.map((sku) => {
    const it = info.get(sku) as { size_label: string | null; brands: { name: string } | null } | undefined;
    const line = it ? [it.brands?.name, it.size_label && `T${it.size_label}`].filter(Boolean).join(" · ") : undefined;
    return { sku, line: line || undefined };
  });
  const pdf = await itemLabelsPdf(labels, format, org?.trade_name ?? "Lefort Second Hand");
  return new NextResponse(Buffer.from(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="etiquettes-${skus[0]}.pdf"` },
  });
}
