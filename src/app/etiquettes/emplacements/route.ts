import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { locationLabelsPdf } from "@/lib/labels";

// GET /etiquettes/emplacements?codes=EMP-A-01-01,EMP-A-01-02  (no codes = all storage locations)
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const codesParam = request.nextUrl.searchParams.get("codes");
  let query = supabase.from("locations").select("code").eq("active", true).order("pick_order").order("code");
  query = codesParam ? query.in("code", codesParam.split(",")) : query.eq("kind", "storage");
  const { data } = await query;
  const codes = (data ?? []).map((l) => l.code);
  if (!codes.length) return NextResponse.json({ error: "Aucun emplacement" }, { status: 404 });
  const pdf = await locationLabelsPdf(codes);
  return new NextResponse(Buffer.from(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="emplacements.pdf"` },
  });
}
