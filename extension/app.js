import { LefortError, insert, loadConfig, rpc, signIn, signOut, uploadPhoto } from "./lefort.js";
import { readWardrobe } from "./vinted.js";
import { saveSettings, settings } from "./sync.js";

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
  if (signedIn) await refreshAuto();
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
  if (msg?.type === "vinted-progress" || msg?.type === "sync-progress") {
    const target = syncing || msg.type === "sync-progress" ? "sync-progress" : progressTarget;
    $(target).textContent = msg.text;
    show(target);
  }
  if (msg?.type === "sync-done") refreshAuto();
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
    // first, listings that carry the « Réf. » of an item are linked to it (and views/favourites recorded):
    // they are then known, never imported as new items
    $("progress").textContent = "Liaison des annonces aux articles…";
    const run = await rpc("vinted_sync_start", { p_source: "manual", p_kind: "wardrobe" });
    try {
      for (let i = 0; i < result.listings.length; i += 500) {
        await rpc("vinted_listings_seen", { p_run: run, p_listings: result.listings.slice(i, i + 500).map((l) => ({ ...l, photos: undefined })) });
      }
      await rpc("vinted_sync_finish", { p_run: run, p_status: "ok", p_wardrobe_complete: result.complete });
    } catch (err) {
      await rpc("vinted_sync_finish", { p_run: run, p_status: "error", p_error: err.message }).catch(() => {});
      throw err;
    }
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
  const counts = {
    active: snapshot.listings.filter((l) => l.state === "active" || l.state === "reserved").length,
    sold: snapshot.listings.filter((l) => l.state === "sold").length,
  };

  $("summary").innerHTML = [
    ["Annonces en ligne", counts.active],
    ["Déjà dans Lefort OS", preview.already_known],
    ["À importer", preview.new.length],
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
    if (result.skipped?.length) toast(`${result.skipped.length} annonce(s) déjà dans Lefort OS (réf. dans la description) : non importée(s)`, "ok");
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

// ── Automatic synchronisation of the sales ───────────────
let syncing = false;
const ago = (iso) => {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return min < 1 ? "à l'instant" : min < 60 ? `il y a ${min} min` : min < 1440 ? `il y a ${Math.round(min / 60)} h` : `il y a ${Math.round(min / 1440)} j`;
};
const COUNT_LABEL = {
  imported: "ventes enregistrées", linked: "ventes reconnues (saisies à la main)", advanced: "ventes mises à jour",
  issue: "à vérifier dans Lefort OS", unchanged: "déjà à jour", ignored: "ignorées", listings: "annonces lues",
};

async function refreshAuto() {
  const s = await settings();
  $("auto-on").checked = s.auto;
  $("auto-every").value = String(s.everyMinutes);
  $("auto-open").checked = s.openTab;
  const page = `${lefortUrl}/ventes/vinted`;
  $("auto-issues-link").href = page;
  $("auto-start-link").href = page;
  const { lastSync } = await chrome.storage.local.get("lastSync");
  let status = null;
  try { status = await chrome.runtime.sendMessage({ type: "badge" }); } catch { /* worker asleep */ }
  if (!status) { try { status = await rpc("vinted_sync_status"); } catch { /* offline */ } }
  show("auto-start", !!status && !status.sync_from);
  const open = Number(status?.open_issues ?? 0);
  $("auto-issues-link").textContent = `${open} vente${open > 1 ? "s" : ""} à vérifier dans Lefort OS →`;
  show("auto-issues", open > 0);
  const last = status?.last_run;
  $("auto-status").textContent = last
    ? `Dernière synchronisation ${last.source === "auto" ? "automatique" : "manuelle"} ${ago(last.started_at)} : ${
        { ok: "réussie", partial: "terminée avec des erreurs", error: `échec (${last.error ?? "erreur"})`, running: "en cours" }[last.status]}.`
    : "Jamais synchronisé pour l'instant.";
  const c = lastSync?.counts ?? {};
  $("auto-summary").innerHTML = lastSync && lastSync.status !== "error"
    ? Object.entries(COUNT_LABEL).filter(([k]) => c[k]).map(([k, label]) => `<div class="stat"><b>${c[k]}</b><span>${label}</span></div>`).join("")
    : "";
}

async function syncNow(full) {
  show("sync-error", false);
  syncing = true;
  $("sync-now").disabled = $("sync-full").disabled = true;
  $("sync-progress").textContent = "Synchronisation…";
  show("sync-progress");
  try {
    const result = await chrome.runtime.sendMessage({ type: "sync-now", full, wardrobe: true });
    if (result?.skipped) throw new LefortError(result.skipped);
    if (result?.status === "error") throw new LefortError(result.error);
    toast(result.status === "partial" ? "Synchronisation terminée avec des erreurs : voir Lefort OS" : "Synchronisation terminée",
      result.status === "partial" ? "err" : "ok");
  } catch (err) {
    $("sync-error").textContent = err.message;
    show("sync-error");
  } finally {
    syncing = false;
    $("sync-now").disabled = $("sync-full").disabled = false;
    show("sync-progress", false);
    await refreshAuto();
  }
}
$("sync-now").addEventListener("click", () => syncNow(false));
$("sync-full").addEventListener("click", () => syncNow(true));
const saveAuto = async () => {
  await saveSettings({ auto: $("auto-on").checked, everyMinutes: Number($("auto-every").value), openTab: $("auto-open").checked });
  await chrome.runtime.sendMessage({ type: "reschedule" });
  toast("Réglage enregistré", "ok");
};
for (const id of ["auto-on", "auto-every", "auto-open"]) $(id).addEventListener("change", saveAuto);

refreshSession();
