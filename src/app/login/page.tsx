"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { btn, Field, input } from "@/components/ui";
import { errorMessage } from "@/lib/errors";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = supabaseBrowser();
    const { data, error } =
      mode === "signin"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (error) return setError(errorMessage(error));
    if (mode === "signup" && !data.session) return setInfo("Compte créé : confirmez votre adresse via l'e-mail reçu.");
    router.replace("/");
    router.refresh();
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-panel/80 p-6 shadow-2xl backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-accent font-mono text-xl font-bold text-accent-fg shadow-[0_0_28px_-6px_var(--accent)]">L</span>
          <div>
            <div className="eyebrow text-highlight">Lefort Second Hand</div>
            <div className="text-2xl font-bold tracking-[-0.03em]">Lefort OS</div>
          </div>
        </div>
        <Field label="E-mail">
          <input className={input} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Mot de passe">
          <input
            className={input}
            type="password"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            minLength={mode === "signup" ? 8 : undefined}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error && <p className="rounded-xl bg-red-500/15 p-2.5 text-sm text-red-200 ring-1 ring-inset ring-red-400/30">{error}</p>}
        {info && <p className="rounded-xl bg-emerald-500/15 p-2.5 text-sm text-emerald-200 ring-1 ring-inset ring-emerald-400/30">{info}</p>}
        <button className={`${btn.primary} w-full`} disabled={busy}>
          {mode === "signin" ? "Se connecter" : "Créer mon compte"}
        </button>
        <button type="button" className="w-full text-sm text-muted underline" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
          {mode === "signin" ? "Pas encore de compte ? Créer un compte" : "J'ai déjà un compte"}
        </button>
      </form>
    </div>
  );
}
