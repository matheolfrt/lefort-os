import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { btn, Field, input } from "@/components/ui";

async function bootstrap(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const { error } = await supabase.rpc("bootstrap_organization", {
    p_trade_name: String(formData.get("trade_name") ?? ""),
    p_full_name: String(formData.get("full_name") ?? ""),
  });
  if (error) redirect(`/onboarding?error=${encodeURIComponent(error.message)}`);
  redirect("/");
}

export default async function Onboarding({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <form action={bootstrap} className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-panel/80 p-6 shadow-2xl backdrop-blur">
        <h1 className="text-xl font-bold">Bienvenue</h1>
        <p className="text-sm text-muted">
          Création de votre espace : catégories, gabarits de mesures, emplacements et taux URSSAF sont préremplis et modifiables.
        </p>
        <Field label="Nom de l'entreprise">
          <input className={input} name="trade_name" defaultValue="Lefort Second Hand" required />
        </Field>
        <Field label="Votre nom">
          <input className={input} name="full_name" required />
        </Field>
        {error && <p className="rounded-xl bg-red-500/15 p-2.5 text-sm text-red-200 ring-1 ring-inset ring-red-400/30">{error}</p>}
        <button className={`${btn.primary} w-full`}>Créer l&apos;espace</button>
      </form>
    </div>
  );
}
