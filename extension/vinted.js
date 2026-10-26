// Reads the signed-in seller's own wardrobe. This function is injected into the open vinted.fr tab
// (chrome.scripting.executeScript), so it runs with the seller's session and must be self-contained.
// It only reads, one page at a time with pauses, and only when the seller clicks.
export async function readWardrobe(options) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const progress = (text) => {
    try { chrome.runtime.sendMessage({ type: "vinted-progress", text }); } catch { /* app tab closed */ }
  };
  const csrf = document.querySelector('meta[name="csrf-token"]')?.content;
  const headers = { Accept: "application/json", ...(csrf ? { "X-CSRF-Token": csrf } : {}) };
  const getJson = async (path) => {
    const res = await fetch(path, { credentials: "include", headers });
    if (!res.ok) throw new Error(`${res.status} sur ${path.split("?")[0]}`);
    return res.json();
  };

  // ── Who is the seller? Their profile page URL carries the id: /member/12345678-pseudo
  let userId = location.pathname.match(/\/member\/(\d+)/)?.[1];
  if (!userId) {
    for (const path of ["/api/v2/users/current", "/api/v2/users/me"]) {
      try {
        const j = await getJson(path);
        userId = String(j?.user?.id ?? j?.id ?? "");
        if (userId) break;
      } catch { /* try next */ }
    }
  }
  if (!userId) {
    return { error: "Ouvrez votre profil Vinted (cliquez sur votre photo puis « Mon profil »), puis relancez." };
  }

  // ── Wardrobe pages
  const endpoints = [
    (p) => `/api/v2/wardrobe/${userId}/items?page=${p}&per_page=96&order=newest_first`,
    (p) => `/api/v2/users/${userId}/items?page=${p}&per_page=96`,
  ];
  let endpoint = null;
  let raw = [];
  let complete = false;
  let lastError = null;
  for (const build of endpoints) {
    raw = [];
    try {
      for (let page = 1; page <= 60; page++) {
        const j = await getJson(build(page));
        const items = j.items ?? j.user_items ?? [];
        raw.push(...items);
        progress(`Lecture du dressing : ${raw.length} annonces…`);
        const totalPages = j.pagination?.total_pages;
        if (!items.length || (totalPages && page >= totalPages)) { complete = true; break; }
        await sleep(900);
      }
      endpoint = build(1).split("?")[0];
      break;
    } catch (e) {
      lastError = e.message;
    }
  }
  if (!endpoint) {
    return { error: `Impossible de lire le dressing (${lastError}). Vérifiez que vous êtes connecté à Vinted.` };
  }

  // ── Normalise
  const CONDITIONS = {
    "neuf avec étiquette": "new_with_tags", "neuf avec etiquette": "new_with_tags",
    "neuf sans étiquette": "new_without_tags", "neuf sans etiquette": "new_without_tags",
    "très bon état": "very_good", "tres bon etat": "very_good",
    "bon état": "good", "bon etat": "good", "satisfaisant": "satisfactory",
  };
  const CONDITION_IDS = { 6: "new_with_tags", 1: "new_without_tags", 2: "very_good", 3: "good", 4: "satisfactory" };
  const text = (v) => (v == null ? null : typeof v === "object" ? v.title ?? v.name ?? null : String(v));
  const cents = (p) => {
    const v = p?.amount ?? p;
    const n = parseFloat(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  };
  const toIso = (v) => {
    if (v == null || v === "") return null;
    const d = typeof v === "number" ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };

  const normalise = (it) => {
    const photos = (it.photos ?? (it.photo ? [it.photo] : []))
      .map((p) => p?.full_size_url ?? p?.high_resolution?.url ?? p?.url)
      .filter(Boolean);
    const sold = Boolean(it.is_sold || it.item_closing_action === "sold" || it.closing_action === "sold" ||
      (it.is_closed && !it.is_hidden && !it.is_draft));
    const condText = text(it.status ?? it.item_condition ?? it.condition)?.toLowerCase().trim();
    return {
      external_id: String(it.id),
      url: it.url?.startsWith("http") ? it.url : `${location.origin}${it.path ?? `/items/${it.id}`}`,
      title: text(it.title),
      description: text(it.description),
      price_cents: cents(it.price ?? it.price_numeric),
      brand: text(it.brand_title ?? it.brand ?? it.brand_dto),
      size: text(it.size_title ?? it.size),
      condition: CONDITIONS[condText] ?? CONDITION_IDS[it.status_id] ?? null,
      state: it.is_draft ? "draft" : sold ? "sold" : it.is_reserved ? "reserved" : it.is_hidden ? "hidden" : "active",
      listed_at: toIso(it.created_at_ts ?? it.created_at ?? it.photo?.high_resolution?.timestamp),
      photos,
    };
  };
  let listings = raw.map(normalise).filter((l) => l.state !== "draft");

  // ── Optional: descriptions are not always in the wardrobe list
  if (options?.descriptions) {
    const missing = listings.filter((l) => !l.description && l.state !== "sold");
    for (let i = 0; i < missing.length; i++) {
      progress(`Descriptions : ${i + 1} / ${missing.length}…`);
      for (const path of [`/api/v2/items/${missing[i].external_id}/details`, `/api/v2/items/${missing[i].external_id}`]) {
        try {
          const j = await getJson(path);
          const d = j?.item?.description ?? j?.description;
          if (d) { missing[i].description = d; break; }
        } catch { /* try next */ }
      }
      await sleep(450);
    }
  }

  return {
    userId,
    endpoint,
    complete,
    listings,
    // Field names only (no values): lets support adapt the reader if Vinted changes its format
    sampleKeys: raw[0] ? Object.keys(raw[0]).sort() : [],
  };
}
