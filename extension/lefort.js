// Minimal Lefort OS client: Supabase auth (same account as the app), database functions and photo storage.
// Only session tokens are kept (chrome.storage.local); the password is never stored.

const store = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (values) => chrome.storage.local.set(values),
  remove: (keys) => chrome.storage.local.remove(keys),
};

export class LefortError extends Error {}

export async function loadConfig() {
  return store.get(["lefortUrl", "supabaseUrl", "anonKey", "session"]);
}

export async function signIn(lefortUrl, email, password) {
  const base = lefortUrl.replace(/\/+$/, "");
  let cfg;
  try {
    cfg = await (await fetch(`${base}/api/extension/config`)).json();
  } catch {
    throw new LefortError("Adresse Lefort OS injoignable. Vérifiez l'adresse (ex. https://lefort-os.vercel.app).");
  }
  if (cfg.app !== "lefort-os") throw new LefortError("Cette adresse n'est pas une installation Lefort OS.");
  const res = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: cfg.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new LefortError("E-mail ou mot de passe incorrect.");
  await store.set({ lefortUrl: base, supabaseUrl: cfg.supabaseUrl, anonKey: cfg.anonKey, session: sessionOf(body) });
  return body.user?.email;
}

export async function signOut() {
  await store.remove(["session"]);
}

const sessionOf = (b) => ({
  access_token: b.access_token,
  refresh_token: b.refresh_token,
  expires_at: b.expires_at ?? Math.floor(Date.now() / 1000) + (b.expires_in ?? 3600),
  email: b.user?.email,
});

async function accessToken() {
  const { supabaseUrl, anonKey, session } = await loadConfig();
  if (!session) throw new LefortError("Session expirée : reconnectez-vous.");
  if (session.expires_at - 60 > Date.now() / 1000) return session.access_token;
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  if (!res.ok) {
    await signOut();
    throw new LefortError("Session expirée : reconnectez-vous.");
  }
  const next = sessionOf(await res.json());
  await store.set({ session: next });
  return next.access_token;
}

async function call(path, init = {}) {
  const { supabaseUrl, anonKey } = await loadConfig();
  const res = await fetch(`${supabaseUrl}${path}`, {
    ...init,
    headers: { apikey: anonKey, Authorization: `Bearer ${await accessToken()}`, ...init.headers },
  });
  const textBody = await res.text();
  const data = textBody ? JSON.parse(textBody) : null;
  if (!res.ok) throw new LefortError(data?.message ?? data?.error ?? `Erreur ${res.status}`);
  return data;
}

/** Calls a Lefort OS database function; errors carry the French message written in the database */
export const rpc = (name, args = {}) =>
  call(`/rest/v1/rpc/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args) });

export const select = (table, query) => call(`/rest/v1/${table}?${query}`);

export const insert = (table, rows) =>
  call(`/rest/v1/${table}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(rows),
  });

export const uploadPhoto = (path, blob) =>
  call(`/storage/v1/object/item-photos/${path}`, {
    method: "POST",
    headers: { "Content-Type": blob.type || "image/jpeg", "x-upsert": "true" },
    body: blob,
  });
