// The AI request of « Annonces » against a fake Anthropic API (no real call): what is sent, how the answer is read,
// how failures read. Run: npm run test:drafts-ai
import assert from "node:assert/strict";
import http from "node:http";

let last: Record<string, unknown> | null = null, headers: http.IncomingHttpHeaders = {};
let reply: { status: number; body: unknown } = { status: 200, body: {} };
const server = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    last = JSON.parse(b); headers = req.headers;
    res.writeHead(reply.status, { "content-type": "application/json" }); res.end(JSON.stringify(reply.body));
  });
});
const message = (text: string, stop = "end_turn") => ({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: stop,
  content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 10 } });

(async () => {
  await new Promise<void>((r) => server.listen(0, r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  process.env.ANTHROPIC_API_KEY = "test-key";
  const { writeWithClaude, aiError, aiEnabled } = await import("../src/lib/drafts/ai");
  const input = { photos: [{ data: "AAAA", mediaType: "image/jpeg" as const }, { data: "BBBB", mediaType: "image/jpeg" as const }], sku: "LSH1",
    measures: "Épaules : 46 cm", known: { marque: "Hugo Boss" }, titleTemplate: "{categorie} {marque}", descriptionTemplate: "{mesures}", instructions: "Ton simple" };

  assert.equal(aiEnabled(), true);
  reply = { status: 200, body: message(JSON.stringify({ title: "Costume  Hugo Boss\nT50", description: "Costume\n\nÉpaules : 46 cm", to_check: ["Composition illisible"] })) };
  const out = await writeWithClaude(input);
  assert.deepEqual(out, { title: "Costume Hugo Boss T50", description: "Costume\n\nÉpaules : 46 cm", to_check: ["Composition illisible"] });
  const sent = last as unknown as { model: string; fallbacks: string; output_config: { format: { type: string } }; messages: { content: { type: string; text?: string }[] }[] };
  assert.equal(sent.model, "claude-opus-5-5");
  assert.equal(sent.fallbacks, "default");
  assert.match(String(headers["anthropic-beta"]), /server-side-fallback-2026-07-01/);
  assert.equal(sent.output_config.format.type, "json_schema");
  const content = sent.messages[0].content;
  assert.equal(content.filter((c) => c.type === "image").length, 2, "les photos sont envoyées");
  const text = content.find((c) => c.type === "text")!.text!;
  assert.match(text, /Épaules : 46 cm/); assert.match(text, /marque : Hugo Boss/); assert.match(text, /Ton simple/);
  console.log("ok  requête : modèle, photos, mesures, consignes, réponse JSON lue");

  reply = { status: 200, body: message(JSON.stringify({ title: "Blazer", description: "Blazer", to_check: [] })) };
  await writeWithClaude({ ...input, choice: "economique" });
  const eco = last as unknown as { model: string; fallbacks?: string };
  assert.equal(eco.model, "claude-haiku-5-5");
  assert.equal(eco.fallbacks, undefined, "pas de modèle de secours pour l'économique");
  assert.doesNotMatch(String(headers["anthropic-beta"] ?? ""), /server-side-fallback/);
  console.log("ok  mode économique : Claude Haiku, sans secours");

  reply = { status: 200, body: { ...message(""), content: [], stop_reason: "refusal" } };
  await assert.rejects(writeWithClaude(input), /refusé/);
  console.log("ok  refus de l'IA : message clair");

  reply = { status: 401, body: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } };
  const e = await writeWithClaude(input).catch((x) => x);
  assert.match(aiError(e), /ANTHROPIC_API_KEY/);
  console.log("ok  clé refusée : message clair");
  server.close();
  console.log("\n4 tests réussis");
})().catch((e) => { console.error(e); process.exit(1); });
