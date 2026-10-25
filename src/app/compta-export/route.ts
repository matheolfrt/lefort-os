import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const euros = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

// CSV for the accountant / tax checks. Semicolon-separated, UTF-8 BOM: opens correctly in French Excel.
export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get("type");
  const year = Number(request.nextUrl.searchParams.get("year")) || new Date().getFullYear();
  const supabase = await createClient();
  let rows: string[][] = [];

  if (type === "recettes") {
    const { data, error } = await supabase.from("v_livre_recettes").select("*")
      .gte("date_encaissement", `${year}-01-01`).lte("date_encaissement", `${year}-12-31`).order("date_encaissement");
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
    rows = [["Date d'encaissement", "Référence", "Client", "Nature", "Montant (€)", "Mode de règlement"],
      ...(data ?? []).map((r) => [r.date_encaissement, r.reference, r.client, r.nature, euros(r.montant_cents), r.mode_reglement])];
  } else if (type === "achats") {
    const { data, error } = await supabase.from("v_registre_achats").select("*")
      .gte("date_achat", `${year}-01-01`).lte("date_achat", `${year}-12-31`).order("date_achat");
    if (error) return NextResponse.json({ error: error.message }, { status: 403 });
    rows = [["Date", "Fournisseur", "Référence facture", "Nature", "Montant (€)", "Mode de règlement"],
      ...(data ?? []).map((r) => [r.date_achat, r.fournisseur, r.reference_facture, r.nature, euros(r.montant_cents), r.mode_reglement])];
  } else {
    return NextResponse.json({ error: "type inconnu" }, { status: 400 });
  }

  const csv = "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${type === "recettes" ? "livre-des-recettes" : "registre-des-achats"}-${year}.csv"`,
    },
  });
}
