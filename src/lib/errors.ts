/** Database functions raise French messages; surface them as-is, fall back for network issues. */
export function errorMessage(error: unknown): string {
  if (!error) return "Erreur inconnue.";
  if (typeof error === "object" && error && "message" in error) {
    const msg = String((error as { message: unknown }).message);
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return "Connexion perdue. Réessayez.";
    if (/permission denied|row-level security/i.test(msg)) return "Action non autorisée pour votre rôle.";
    // sign-in and sign-up messages come from Supabase in English
    if (/Invalid login credentials/i.test(msg)) return "E-mail ou mot de passe incorrect.";
    if (/Email not confirmed/i.test(msg)) return "Adresse e-mail pas encore confirmée : ouvrez le lien reçu par e-mail.";
    if (/User already registered/i.test(msg)) return "Un compte existe déjà avec cette adresse : connectez-vous.";
    if (/Password should be at least/i.test(msg)) return "Le mot de passe doit faire au moins 8 caractères.";
    if (/rate limit|too many requests/i.test(msg)) return "Trop de tentatives : patientez une minute puis réessayez.";
    if (/Signups not allowed|signup is disabled/i.test(msg)) return "La création de compte est désactivée : demandez à l'administrateur.";
    if (/JWT expired|session.*(missing|expired)/i.test(msg)) return "Session expirée : reconnectez-vous.";
    if (/duplicate key value/i.test(msg)) return "Cet élément existe déjà.";
    return msg;
  }
  return String(error);
}
