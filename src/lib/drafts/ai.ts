import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Title and description written by Claude from the article's photos, the measurements given and the shop's model.
// Only what is visible on the photos or given by the shop is written; what could not be read comes back in to_check.

export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

/** The two choices offered to the shop: the best writing, or about 40 times cheaper */
export type AiChoice = "qualite" | "economique";
export const AI_MODELS: Record<AiChoice, string> = { qualite: "claude-opus-5-5", economique: "claude-haiku-5-5" };

export interface AiInput {
  choice?: AiChoice;
  photos: { data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" }[];
  sku: string;
  measures: string;
  known: Record<string, string>;
  titleTemplate: string;
  descriptionTemplate: string;
  instructions: string;
}
export interface AiOutput { title: string; description: string; to_check: string[] }

const SYSTEM = `Tu rédiges des annonces Vinted en français pour une boutique de vêtements de seconde main.
Règles :
- N'écris que ce que tu vois sur les photos ou ce que la boutique te donne. N'invente jamais une marque, une taille, une matière, une composition ou une mesure.
- Une étiquette lisible sur une photo (marque, taille, composition) peut être reprise. Si elle est floue ou absente, ne la devine pas : ajoute-la à "to_check".
- Les données de la boutique (stock, mesures) priment sur ce que tu crois voir. Si une photo les contredit, garde celles de la boutique et signale-le dans "to_check".
- Reprends les mesures telles qu'elles sont données, sans les modifier ni les convertir.
- Suis le modèle de la boutique : même structure, même ton, mêmes lignes. Une ligne du modèle dont tu ne connais pas le contenu est supprimée, pas inventée.
- Le titre tient sur une ligne, sans emoji ni majuscules partout, 80 caractères au plus.
- Ne mets pas de hashtags sauf si le modèle en contient.`;

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Titre de l'annonce" },
    description: { type: "string", description: "Description complète de l'annonce" },
    to_check: { type: "array", items: { type: "string" }, description: "Ce que la boutique doit vérifier (illisible, incertain, contradictoire)" },
  },
  required: ["title", "description", "to_check"],
  additionalProperties: false,
} as const;

let client: Anthropic | null = null;

export async function writeWithClaude(input: AiInput): Promise<AiOutput> {
  client ??= new Anthropic();
  const known = Object.entries(input.known).filter(([, v]) => v).map(([k, v]) => `- ${k} : ${v}`).join("\n") || "(rien dans le stock pour ce SKU)";
  const text = `SKU : ${input.sku}

Données de la boutique :
${known}

Mesures données par la boutique :
${input.measures.trim() || "(aucune)"}

Modèle de titre :
${input.titleTemplate || "(aucun)"}

Modèle de description (les mots entre accolades sont à remplacer) :
${input.descriptionTemplate || "(aucun)"}
${input.instructions.trim() ? `\nConsignes de la boutique :\n${input.instructions.trim()}\n` : ""}
Les ${input.photos.length} photos de l'article sont jointes. Rédige le titre et la description.`;

  const params = {
    max_tokens: 16000,
    output_config: { effort: "medium" as const, format: { type: "json_schema" as const, schema: SCHEMA } },
    system: SYSTEM,
    messages: [{
      role: "user" as const,
      content: [
        ...input.photos.map((p) => ({ type: "image" as const, source: { type: "base64" as const, media_type: p.mediaType, data: p.data } })),
        { type: "text" as const, text },
      ],
    }],
  };
  // the quality model may hand a declined request to another model; the economical one has no such fallback
  const response = input.choice === "economique"
    ? await client.messages.create({ model: AI_MODELS.economique, ...params })
    : await client.beta.messages.create({ model: AI_MODELS.qualite, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", ...params });
  if (response.stop_reason === "refusal") throw new Error("L'IA a refusé de rédiger cette annonce.");
  if (response.stop_reason === "max_tokens") throw new Error("Réponse de l'IA coupée : réessayez.");
  const out = response.content.find((b) => b.type === "text");
  if (!out || out.type !== "text") throw new Error("Réponse de l'IA vide.");
  const parsed = JSON.parse(out.text) as AiOutput;
  return {
    title: String(parsed.title ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
    description: String(parsed.description ?? "").trim().slice(0, 10000),
    to_check: Array.isArray(parsed.to_check) ? parsed.to_check.map(String).filter(Boolean).slice(0, 10) : [],
  };
}

/** a readable message for an API failure */
export function aiError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "Clé de l'IA refusée : vérifiez ANTHROPIC_API_KEY sur Vercel.";
  if (e instanceof Anthropic.RateLimitError) return "L'IA est saturée : réessayez dans une minute.";
  if (e instanceof Anthropic.BadRequestError) return `Demande refusée par l'IA : ${e.message}`;
  if (e instanceof Anthropic.APIError) return `Erreur de l'IA (${e.status ?? "réseau"}).`;
  return e instanceof Error ? e.message : "Erreur de l'IA.";
}
