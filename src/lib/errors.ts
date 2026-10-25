/** Database functions raise French messages; surface them as-is, fall back for network issues. */
export function errorMessage(error: unknown): string {
  if (!error) return "Erreur inconnue.";
  if (typeof error === "object" && error && "message" in error) {
    const msg = String((error as { message: unknown }).message);
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return "Connexion perdue. Réessayez.";
    if (/permission denied|row-level security/i.test(msg)) return "Action non autorisée pour votre rôle.";
    return msg;
  }
  return String(error);
}
