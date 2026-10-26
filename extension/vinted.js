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

  const oldestPhoto = (it) => {
    const stamps = (it.photos ?? (it.photo ? [it.photo] : []))
      .map((p) => Number(p?.high_resolution?.timestamp ?? p?.timestamp))
      .filter((n) => Number.isFinite(n) && n > 0);
    return stamps.length ? Math.min(...stamps) : null;
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
      // The wardrobe list has no creation date: the oldest photo upload is the closest proxy
      listed_at: toIso(it.created_at_ts ?? it.created_at ?? oldestPhoto(it)),
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

// Reads the seller's Vinted orders (sales). Injected into the vinted.fr tab like readWardrobe, so self-contained.
// options.skip: transaction ids already up to date in Lefort OS — their details are not fetched again.
export async function readSales(options) {
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
  const text = (v) => (v == null ? "" : typeof v === "object" ? v.title ?? v.name ?? v.text ?? "" : String(v));
  // Field names (and the names inside nested objects), never values: for the diagnostic
  const shape = (o) => (o && typeof o === "object"
    ? Object.keys(o).sort().map((k) => (o[k] && typeof o[k] === "object" && !Array.isArray(o[k])
      ? `${k}{${Object.keys(o[k]).sort().join(",")}}` : Array.isArray(o[k]) ? `${k}[]` : k))
    : []);

  // ── List of sold orders
  const listEndpoints = [
    (p) => `/api/v2/my_orders?type=sold&status=all&page=${p}&per_page=100`,
    (p) => `/api/v2/my_orders?type=sold&page=${p}&per_page=100`,
    (p) => `/api/v2/transactions?type=sold&page=${p}&per_page=100`,
  ];
  let raw = [];
  let listEndpoint = null;
  let complete = false;
  const tried = [];
  for (const build of listEndpoints) {
    raw = [];
    try {
      for (let page = 1; page <= 50; page++) {
        const j = await getJson(build(page));
        const rows = j.my_orders ?? j.orders ?? j.transactions ?? [];
        if (!Array.isArray(rows)) throw new Error("format inconnu");
        raw.push(...rows);
        progress(`Lecture des ventes : ${raw.length}…`);
        const totalPages = j.pagination?.total_pages;
        if (!rows.length || (totalPages && page >= totalPages)) { complete = true; break; }
        await sleep(900);
      }
      if (raw.length || complete) { listEndpoint = build(1).split("?")[0]; break; }
    } catch (e) {
      tried.push(e.message);
    }
  }
  if (!listEndpoint) {
    return { error: `Impossible de lire vos ventes Vinted (${tried.join(" ; ")}). Vérifiez que vous êtes connecté à Vinted.`, tried };
  }

  // Vinted states, in words: keep the furthest step reached
  const stateOf = (...labels) => {
    const s = labels.map(text).join(" ").toLowerCase();
    if (/annul|cancel|rembours|refund|fail|échou|echou|expir/.test(s)) return "cancelled";
    if (/termin|complet|finalis|confirm/.test(s)) return "completed";
    if (/livr|deliver|envoy|expédi|expedi|shipped|transit|en route|point relais|pick/.test(s)) return "shipped";
    return "pending";
  };

  const skip = new Set((options?.skip ?? []).map(String));
  const sales = [];
  const statusWords = {};
  let detailEndpoint = null;
  let detailShape = [];
  const detailErrors = [];
  for (let i = 0; i < raw.length; i++) {
    const o = raw[i];
    const tid = String(o.transaction_id ?? o.transaction?.id ?? o.id ?? "");
    if (!tid) continue;
    const listState = stateOf(o.status, o.transaction_user_status, o.status_title);
    const word = [text(o.status), text(o.transaction_user_status)].filter(Boolean).join(" / ") || "?";
    statusWords[word] = (statusWords[word] ?? 0) + 1;
    const sale = {
      transaction_id: tid,
      title: text(o.title ?? o.item_title),
      price_cents: cents(o.price ?? o.item_price ?? o.total_item_price ?? o.amount),
      sold_at: toIso(o.date ?? o.created_at ?? o.created_at_ts),
      state: listState,
      item_ids: [],
      items: [],
      buyer: null,
      shipped_at: null,
      completed_at: listState === "completed" ? toIso(o.status_updated_at ?? o.updated_at) : null,
    };
    if (!skip.has(tid)) {
      progress(`Détail des ventes : ${i + 1} / ${raw.length}…`);
      const paths = [`/api/v2/transactions/${tid}`];
      if (o.conversation_id) paths.push(`/api/v2/conversations/${o.conversation_id}`);
      for (const path of paths) {
        try {
          const j = await getJson(path);
          const t = j.transaction ?? j.conversation?.transaction ?? null;
          if (!t) continue;
          detailEndpoint ??= path.replace(/\d+$/, "{id}");
          if (!detailShape.length) detailShape = shape(t);
          const items = t.items ?? t.order?.items ?? (t.item ? [t.item] : []);
          sale.item_ids = [...new Set([
            ...(Array.isArray(t.item_ids) ? t.item_ids : []),
            ...items.map((it) => it?.id ?? it?.item_id),
            t.item_id,
          ].filter(Boolean).map(String))];
          sale.items = items.map((it) => ({
            id: String(it?.id ?? it?.item_id ?? ""),
            title: text(it?.title),
            price_cents: cents(it?.price ?? it?.item_price),
            brand: text(it?.brand_title ?? it?.brand),
            size: text(it?.size_title ?? it?.size),
          }));
          sale.title ||= text(t.item_title ?? t.title ?? items[0]?.title);
          sale.price_cents = cents(t.offer?.price ?? t.offer_price ?? t.item_price ?? t.total_item_price) ?? sale.price_cents;
          sale.buyer = text(t.buyer?.login ?? t.buyer_login ?? t.opposite_user?.login ?? o.opposite_user?.login) || null;
          sale.sold_at = toIso(t.created_at ?? t.created_at_ts) ?? sale.sold_at;
          const detailState = stateOf(t.status_title, t.status_text, t.transaction_user_status, t.status_message,
            typeof t.status === "string" ? t.status : "");
          const rank = { pending: 0, shipped: 1, completed: 2, cancelled: 3 };
          sale.state = rank[detailState] > rank[sale.state] ? detailState : sale.state;
          const sh = t.shipment ?? {};
          sale.shipped_at = toIso(sh.shipped_at ?? sh.sent_at ?? sh.status_updated_at) ?? null;
          if (sale.state === "completed") {
            sale.completed_at = toIso(t.completed_at ?? t.status_updated_at ?? sh.delivered_at) ?? sale.completed_at;
          }
          break;
        } catch (e) {
          if (detailErrors.length < 3) detailErrors.push(e.message);
        }
      }
      await sleep(700);
    }
    sales.push(sale);
  }

  return {
    listEndpoint,
    detailEndpoint,
    complete,
    sales,
    diagnostic: {
      list_endpoint: listEndpoint,
      detail_endpoint: detailEndpoint,
      complete,
      orders: raw.length,
      states: sales.reduce((a, s) => ({ ...a, [s.state]: (a[s.state] ?? 0) + 1 }), {}),
      vinted_status_words: statusWords,
      without_items: sales.filter((s) => !skip.has(s.transaction_id) && !s.item_ids.length).length,
      without_price: sales.filter((s) => s.price_cents == null).length,
      without_date: sales.filter((s) => !s.sold_at).length,
      detail_errors: detailErrors,
      list_fields: shape(raw[0]),
      detail_fields: detailShape,
    },
  };
}
