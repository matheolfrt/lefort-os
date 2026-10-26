import { LefortError, insert, loadConfig, rpc, select, signIn, signOut, uploadPhoto } from "./lefort.js";
import { readSales, readWardrobe } from "./vinted.js";

const $ = (id) => document.getElementById(id);
const show = (id, on = true) => { $(id).hidden = !on; };
const euros = (cents) => (cents == null ? "—" : (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" }));
const parseEuros = (s) => {
  const n = Number(String(s).replace(/\s|€/g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

let toastTimer;
function toast(text, tone = "") {
  const t = $("toast");
  t.textContent = text;
  t.className = `toast ${tone}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, tone === "err" ? 8000 : 3000);
}

let snapshot = null; // last wardrobe read
let lefortUrl = "";

// ── Session ──────────────────────────────────────────────
async function refreshSession() {
  const cfg = await loadConfig();
  lefortUrl = cfg.lefortUrl ?? "";
  const signedIn = Boolean(cfg.session);
  show("login", !signedIn);
  show("sync", signedIn);
  show("who", signedIn);
  if (signedIn) $("who-email").textContent = cfg.session.email ?? "";
  if (cfg.lefortUrl) $("login-url").value = cfg.lefortUrl;
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  show("login-error", false);
  try {
    await signIn($("login-url").value.trim(), $("login-email").value.trim(), $("login-password").value);
    $("login-password").value = "";
    await refreshSession();
  } catch (err) {
    $("login-error").textContent = err.message;
    show("login-error");
  }
});

$("logout").addEventListener("click", async () => {
  await signOut();
  await refreshSession();
});

// ── Read the wardrobe from the open Vinted tab ───────────
let progressTarget = "progress";
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "vinted-progress") {
    $(progressTarget).textContent = msg.text;
    show(progressTarget);
  }
});

async function findVintedTab() {
  const tabs = await chrome.tabs.query({ url: "https://www.vinted.fr/*" });
  return tabs.find((t) => /\/member\/\d+/.test(t.url ?? "")) ?? tabs.find((t) => t.active) ?? tabs[0];
}

$("read").addEventListener("click", async () => {
  show("read-error", false);
  show("results", false);
  const tab = await findVintedTab();
  if (!tab) {
    $("read-error").textContent = "Aucun onglet vinted.fr ouvert. Ouvrez votre profil Vinted dans un autre onglet.";
    show("read-error");
    return;
  }
  $("read").disabled = true;
  progressTarget = "progress";
  $("progress").textContent = "Lecture du dressing…";
  show("progress");
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: readWardrobe,
      args: [{ descriptions: $("opt-descriptions").checked }],
    });
    if (!result || result.error) throw new LefortError(result?.error ?? "Lecture impossible.");
    snapshot = result;
    await analyse();
  } catch (err) {
    $("read-error").textContent = err.message;
    show("read-error");
  } finally {
    $("read").disabled = false;
    show("progress", false);
  }
});

// ── Compare with Lefort OS ───────────────────────────────
let preview = null;

async function analyse() {
  preview = await rpc("vinted_sync_preview", { p_listings: snapshot.listings, p_complete: snapshot.complete });
  const byId = new Map(snapshot.listings.map((l) => [l.external_id, l]));
  const counts = {
    active: snapshot.listings.filter((l) => l.state === "active" || l.state === "reserved").length,
    sold: snapshot.listings.filter((l) => l.state === "sold").length,
  };

  $("summary").innerHTML = [
    ["Annonces en ligne", counts.active],
    ["Déjà dans Lefort OS", preview.already_known],
    ["À importer", preview.new.length],
    ["Ventes à saisir", preview.sold_on_vinted.length],
  ].map(([label, n]) => `<div class="stat"><b>${n}</b><span>${label}</span></div>`).join("");

  // new
  $("new-count").textContent = preview.new.length;
  $("import").textContent = `Importer ${preview.new.length} article${preview.new.length > 1 ? "s" : ""}`;
  show("block-new", preview.new.length > 0);
  $("import").hidden = false;
  show("labels", false);
  show("import-status", false);
  show("import-progress", false);

  // updates
  const updates = [
    ...preview.price_changes.map((p) => `${p.sku} : prix ${euros(p.old_cents)} → <b>${euros(p.new_cents)}</b>`),
    ...preview.reservation_changes.map((r) => `${r.sku} : ${r.to === "reserved" ? "réservé sur Vinted" : "n'est plus réservé"}`),
    ...(preview.date_fixes?.length
      ? [`${preview.date_fixes.length} article(s) importé(s) : date de mise en ligne corrigée (âge du stock)`]
      : []),
  ];
  $("updates-count").textContent = updates.length;
  $("updates-list").innerHTML = updates.map((u) => `<li>${u}</li>`).join("");
  show("block-updates", updates.length > 0);

  // sold
  $("sold-count").textContent = preview.sold_on_vinted.length;
  $("sold-list").innerHTML = preview.sold_on_vinted.map((s) => `
    <tr>
      <td><input type="checkbox" data-item="${s.item_id}" checked></td>
      <td><a class="sku" href="${esc(lefortUrl)}/stock/${esc(s.sku)}" target="_blank">${esc(s.sku)}</a></td>
      <td>${esc(s.title ?? byId.get(s.external_id)?.title ?? "")}</td>
      <td><input type="text" inputmode="decimal" data-price="${s.item_id}" value="${s.price_cents ? (s.price_cents / 100).toFixed(2).replace(".", ",") : ""}"> €</td>
    </tr>`).join("");
  show("block-sold", preview.sold_on_vinted.length > 0);

  // missing
  $("missing-count").textContent = preview.missing_on_vinted.length;
  $("missing-list").innerHTML = preview.missing_on_vinted.map((m) => `
    <tr>
      <td><input type="checkbox" data-item="${m.item_id}"></td>
      <td><a class="sku" href="${esc(lefortUrl)}/stock/${esc(m.sku)}" target="_blank">${esc(m.sku)}</a></td>
      <td class="muted">annonce ${esc(m.external_id)}</td>
    </tr>`).join("");
  show("block-missing", preview.missing_on_vinted.length > 0);

  $("diag").textContent = JSON.stringify({
    endpoint: snapshot.endpoint,
    complete: snapshot.complete,
    listings: snapshot.listings.length,
    states: snapshot.listings.reduce((a, l) => ({ ...a, [l.state]: (a[l.state] ?? 0) + 1 }), {}),
    missing_fields: ["title", "price_cents", "brand", "size", "condition", "description", "listed_at"].map((f) =>
      `${f}: ${snapshot.listings.filter((l) => l[f] == null).length}`),
    vinted_fields: snapshot.sampleKeys,
  }, null, 2);
  show("results");
  if (!snapshot.complete) toast("Lecture partielle du dressing : les annonces disparues ne sont pas signalées.", "err");
}

// ── Import new listings + their photos ───────────────────
$("import").addEventListener("click", async () => {
  const cost = parseEuros($("cost-each").value);
  if (cost == null) return toast("Coût invalide", "err");
  const newIds = new Set(preview.new);
  const toImport = snapshot.listings.filter((l) => newIds.has(l.external_id));
  $("import").disabled = true;
  try {
    const result = await rpc("vinted_import", { p_listings: toImport, p_cost_cents_each: cost });
    const imported = result.imported ?? [];
    $("import-status").textContent = `${imported.length} articles créés. Copie des photos…`;
    show("import-status");
    await copyPhotos(imported);
    $("import-status").textContent = `${imported.length} articles importés avec leurs photos.`;
    $("labels-link").href = `${lefortUrl}/etiquettes/articles?skus=${imported.map((i) => i.sku).join(",")}`;
    show("labels", imported.length > 0);
    toast(`${imported.length} articles importés`, "ok");
    preview.new = [];
    $("import").hidden = true;
  } catch (err) {
    toast(err.message, "err");
  } finally {
    $("import").disabled = false;
  }
});

async function copyPhotos(imported) {
  const orgId = await rpc("auth_org_id");
  const jobs = imported.flatMap((it) => (it.photos ?? []).map((url, i) => ({ it, url, i })));
  let done = 0;
  let failed = 0;
  const bar = $("import-progress");
  show("import-progress");
  const step = () => {
    bar.firstElementChild.style.width = `${jobs.length ? (done / jobs.length) * 100 : 100}%`;
    $("import-status").textContent = `Photos : ${done} / ${jobs.length}${failed ? ` (${failed} échecs)` : ""}`;
  };
  step();

  const worker = async () => {
    while (jobs.length) {
      const { it, url, i } = jobs.shift();
      try {
        const blob = await (await fetch(url)).blob();
        const path = `${orgId}/${it.item_id}/vinted-${i + 1}-${crypto.randomUUID().slice(0, 8)}.jpg`;
        await uploadPhoto(path, blob);
        await insert("item_photos", {
          org_id: orgId, item_id: it.item_id, storage_path: path, position: i,
          shot_key: i === 0 ? "front" : null, bytes: blob.size,
        });
      } catch {
        failed++;
      }
      done++;
      step();
    }
  };
  const total = jobs.length;
  await Promise.all([worker(), worker(), worker()]);
  if (failed) toast(`${failed} photo(s) sur ${total} n'ont pas pu être copiées`, "err");
}

// ── Prices & reservations ────────────────────────────────
$("apply-updates").addEventListener("click", async () => {
  $("apply-updates").disabled = true;
  try {
    const r = await rpc("vinted_apply_updates", { p_listings: snapshot.listings });
    toast(`${r.prices_updated} prix, ${r.reservations_updated} réservations et ${r.dates_updated ?? 0} dates mis à jour`, "ok");
    await analyse();
  } catch (err) {
    toast(err.message, "err");
  } finally {
    $("apply-updates").disabled = false;
  }
});

// ── Sales made on Vinted ─────────────────────────────────
$("record-sales").addEventListener("click", async () => {
  const rows = [...document.querySelectorAll("#sold-list input[type=checkbox]:checked")];
  if (!rows.length) return;
  $("record-sales").disabled = true;
  let ok = 0;
  for (const box of rows) {
    const id = box.dataset.item;
    const cents = parseEuros(document.querySelector(`input[data-price="${id}"]`).value);
    if (cents == null) { toast("Prix invalide", "err"); continue; }
    try {
      await rpc("record_sale", { p_item_ids: [id], p_gross_cents: cents, p_channel: "vinted" });
      ok++;
    } catch (err) {
      toast(err.message, "err");
    }
  }
  toast(`${ok} vente(s) enregistrée(s) : à expédier dans Lefort OS`, "ok");
  $("record-sales").disabled = false;
  await analyse();
});

// ── Listings gone from Vinted ────────────────────────────
$("unpublish").addEventListener("click", async () => {
  const rows = [...document.querySelectorAll("#missing-list input[type=checkbox]:checked")];
  if (!rows.length) return;
  $("unpublish").disabled = true;
  for (const box of rows) {
    try {
      await rpc("unpublish_item", { p_item_id: box.dataset.item, p_reason: "Annonce absente de Vinted" });
    } catch (err) {
      toast(err.message, "err");
    }
  }
  $("unpublish").disabled = false;
  await analyse();
});

$("copy-diag").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("diag").textContent);
    toast("Diagnostic copié", "ok");
  } catch {
    toast("Copie impossible : sélectionnez le texte", "err");
  }
});

// ── Vinted orders ────────────────────────────────────────
const SELLABLE = ["listing_ready", "listed", "reserved"];
const RANK = { pending: 0, shipped: 1, completed: 2 };
const STATE_LABEL = { pending: "à expédier", shipped: "expédiée", completed: "terminée", cancelled: "annulée" };
const ORDER_LABEL = { pending: "à expédier", shipped: "expédiée", completed: "terminée" };
const day = (iso) => (iso ? new Date(iso).toLocaleDateString("fr-FR") : "—");
let salesSnapshot = null;
let salesPlan = null;

// default cut-off: past months are already declared
{
  const d = new Date();
  $("acct-date").value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

$("read-sales").addEventListener("click", async () => {
  show("sales-error", false);
  show("sales-results", false);
  const tab = await findVintedTab();
  if (!tab) {
    $("sales-error").textContent = "Aucun onglet vinted.fr ouvert. Ouvrez vinted.fr (connecté) dans un autre onglet.";
    show("sales-error");
    return;
  }
  $("read-sales").disabled = true;
  progressTarget = "sales-progress";
  $("sales-progress").textContent = "Lecture des ventes…";
  show("sales-progress");
  try {
    // orders already finished in Lefort OS: no need to open them again on Vinted
    const done = await select("orders", "select=external_order_id&channel=eq.vinted&external_order_id=not.is.null&status=in.(completed,cancelled)");
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: readSales,
      args: [{ skip: done.map((o) => o.external_order_id) }],
    });
    if (!result || result.error) {
      if (result?.tried) $("sales-diag").textContent = JSON.stringify({ tried: result.tried }, null, 2);
      throw new LefortError(result?.error ?? "Lecture impossible.");
    }
    salesSnapshot = result;
    $("sales-diag").textContent = JSON.stringify(result.diagnostic, null, 2);
    await planSales();
  } catch (err) {
    $("sales-error").textContent = err.message;
    show("sales-error");
  } finally {
    $("read-sales").disabled = false;
    show("sales-progress", false);
  }
});

async function planSales() {
  const sales = salesSnapshot.sales;
  const preview = await rpc("vinted_orders_preview", {
    p_orders: sales.map((s) => ({ transaction_id: s.transaction_id, item_ids: s.item_ids })),
  });
  const byTid = new Map(preview.map((p) => [p.transaction_id, p]));
  const plan = { toImport: [], updates: [], check: [], upToDate: 0, cancelled: 0 };
  for (const sale of sales) {
    const p = byTid.get(sale.transaction_id) ?? { order: null, items: [] };
    const name = sale.title || `commande ${sale.transaction_id}`;
    if (p.order) {
      if (sale.state === "cancelled") {
        if (p.order.status === "pending") plan.check.push(`${name} : annulée sur Vinted, V-${p.order.number} est encore « à expédier » dans Lefort OS (annulez-la dans Ventes).`);
        else plan.upToDate++;
      } else if (RANK[sale.state] > RANK[p.order.status] || !p.order.has_ref) {
        plan.updates.push({ sale, order: p.order, moves: RANK[sale.state] > RANK[p.order.status] });
      } else {
        plan.upToDate++;
      }
      continue;
    }
    if (sale.state === "cancelled") { plan.cancelled++; continue; }
    const bad = p.items.find((i) => i.deleted || !SELLABLE.includes(i.status));
    if (bad) {
      plan.check.push(`${name} : ${bad.sku} est ${bad.deleted ? "dans la corbeille" : `« ${bad.status} »`} sans commande Vinted liée. Vérifiez-le dans Lefort OS.`);
    } else if (sale.price_cents == null) {
      plan.check.push(`${name} : prix illisible, à saisir à la main.`);
    } else {
      plan.toImport.push({ sale, known: p.items.map((i) => i.sku) });
    }
  }
  salesPlan = plan;
  renderSales();
}

function renderSales() {
  const plan = salesPlan;
  $("sales-summary").innerHTML = [
    ["Ventes Vinted lues", salesSnapshot.sales.length],
    ["Déjà à jour", plan.upToDate],
    ["À enregistrer", plan.toImport.length],
    ["À faire avancer", plan.updates.filter((u) => u.moves).length],
  ].map(([label, n]) => `<div class="stat"><b>${n}</b><span>${label}</span></div>`).join("");

  $("sales-new-count").textContent = plan.toImport.length;
  $("sales-new-list").innerHTML = plan.toImport.slice(0, 150).map(({ sale, known }) => `
    <tr>
      <td>${day(sale.sold_at)}</td>
      <td>${esc(sale.title || "—")}${known.length ? ` <span class="sku">${known.map(esc).join(" + ")}</span>` : ' <span class="tag">nouvel article</span>'}</td>
      <td>${esc(sale.buyer ?? "")}</td>
      <td>${STATE_LABEL[sale.state]}</td>
      <td style="text-align:right">${euros(sale.price_cents)}</td>
    </tr>`).join("");
  $("sales-new-more").textContent = plan.toImport.length > 150 ? `… et ${plan.toImport.length - 150} autres` : "";
  show("sales-new-more", plan.toImport.length > 150);
  $("import-sales").textContent = `Enregistrer ${plan.toImport.length} vente${plan.toImport.length > 1 ? "s" : ""}`;
  show("import-sales-status", false);
  show("import-sales-progress", false);
  show("block-sales-new", plan.toImport.length > 0);

  const moving = plan.updates.filter((u) => u.moves);
  $("sales-updates-count").textContent = moving.length;
  $("sales-updates-list").innerHTML = moving.map(({ sale, order }) =>
    `<li>V-${order.number} ${esc(sale.title)} : ${ORDER_LABEL[order.status]} → <b>${STATE_LABEL[sale.state]}</b>${sale.state === "completed" && sale.completed_at ? ` (encaissée le ${day(sale.completed_at)})` : ""}</li>`).join("");
  show("block-sales-updates", plan.updates.length > 0);
  if (!moving.length) $("sales-updates-list").innerHTML = "<li>Liaison des commandes saisies à la main avec Vinted.</li>";

  $("sales-check-count").textContent = plan.check.length;
  $("sales-check-list").innerHTML = plan.check.map((c) => `<li>${esc(c)}</li>`).join("");
  show("block-sales-check", plan.check.length > 0);
  show("sales-results");
}

/** One line per item; a bundle's price is shared by the items' Vinted prices (evenly when unknown) */
function linesOf(sale) {
  const items = sale.items.length ? sale.items : sale.item_ids.map((id) => ({ id, title: "", price_cents: null }));
  if (!items.length) return [{ sku: "", title: sale.title, price_cents: sale.price_cents }];
  const weights = items.map((i) => (items.every((x) => x.price_cents > 0) ? i.price_cents : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const shares = weights.map((w) => Math.floor((sale.price_cents * w) / total));
  shares[0] += sale.price_cents - shares.reduce((a, b) => a + b, 0);
  return items.map((it, i) => ({
    sku: "",
    title: it.title || (items.length === 1 ? sale.title : `${sale.title} (${i + 1}/${items.length})`),
    brand: it.brand || null,
    size: it.size || null,
    price_cents: shares[i],
    vinted_url: it.id ? `https://www.vinted.fr/items/${it.id}` : null,
  }));
}

$("import-sales").addEventListener("click", async () => {
  const mode = document.querySelector("input[name=acct]:checked").value;
  const cutoff = $("acct-date").value ? new Date(`${$("acct-date").value}T00:00:00`).toISOString() : null;
  if (mode === "before" && !cutoff) return toast("Choisissez la date", "err");
  const historical = (s) => mode === "all" || (mode === "before" && (s.completed_at ?? s.sold_at ?? "") < cutoff);

  // one call per (state, historical) group, in chunks
  const groups = new Map();
  for (const { sale } of salesPlan.toImport) {
    const key = `${sale.state}|${historical(sale)}`;
    groups.set(key, [...(groups.get(key) ?? []), sale]);
  }
  const total = salesPlan.toImport.length;
  let done = 0, orders = 0, created = 0;
  const errors = [];
  $("import-sales").disabled = true;
  show("import-sales-progress");
  const step = () => {
    $("import-sales-progress").firstElementChild.style.width = `${total ? (done / total) * 100 : 100}%`;
    $("import-sales-status").textContent = `Enregistrement : ${done} / ${total}…`;
    show("import-sales-status");
  };
  step();
  for (const [key, list] of groups) {
    const [state, hist] = key.split("|");
    for (let i = 0; i < list.length; i += 100) {
      const chunk = list.slice(i, i + 100);
      try {
        const r = await rpc("import_sales", {
          p_sales: chunk.map((s) => ({
            sold_at: s.sold_at, paid_at: s.completed_at, buyer: s.buyer, order_ref: s.transaction_id,
            shipping_cents: 0, packaging_cents: 0, platform_fee_cents: null, lines: linesOf(s),
          })),
          p_historical: hist === "true",
          p_state: state,
        });
        orders += r.orders;
        created += r.items_created;
        r.errors.forEach((e) => errors.push(`${chunk[e.sale - 1].title || chunk[e.sale - 1].transaction_id} : ${e.error}`));
      } catch (err) {
        errors.push(err.message);
      }
      done += chunk.length;
      step();
    }
  }
  $("import-sales").disabled = false;
  toast(`${orders} vente(s) enregistrée(s), ${created} article(s) créé(s)${errors.length ? `, ${errors.length} erreur(s)` : ""}`, errors.length ? "err" : "ok");
  await planSales();
  salesPlan.check.push(...errors);
  renderSales();
  $("import-sales-status").textContent = `${orders} vente(s) enregistrée(s), ${created} article(s) créé(s).`;
  show("import-sales-status");
});

$("apply-sales-updates").addEventListener("click", async () => {
  $("apply-sales-updates").disabled = true;
  try {
    const r = await rpc("vinted_orders_sync", {
      p_updates: salesPlan.updates.map(({ sale, order }) => ({
        order_id: order.id, transaction_id: sale.transaction_id, state: sale.state,
        shipped_at: sale.shipped_at, paid_at: sale.completed_at,
      })),
    });
    toast(`${r.shipped} expédiée(s), ${r.completed} terminée(s)${r.errors.length ? `, ${r.errors.length} erreur(s)` : ""}`, r.errors.length ? "err" : "ok");
    await planSales();
    salesPlan.check.push(...r.errors.map((e) => e.error));
    renderSales();
  } catch (err) {
    toast(err.message, "err");
  } finally {
    $("apply-sales-updates").disabled = false;
  }
});

$("copy-sales-diag").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("sales-diag").textContent);
    toast("Diagnostic copié", "ok");
  } catch {
    toast("Copie impossible : sélectionnez le texte", "err");
  }
});

refreshSession();
