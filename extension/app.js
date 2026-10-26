import { LefortError, insert, loadConfig, rpc, signIn, signOut, uploadPhoto } from "./lefort.js";
import { readWardrobe } from "./vinted.js";

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
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "vinted-progress") {
    $("progress").textContent = msg.text;
    show("progress");
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

refreshSession();
