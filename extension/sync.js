// The synchronisation itself, used by the background worker (every hour) and by the « Synchroniser maintenant »
// button. It reads Vinted from a vinted.fr tab (the seller's own session), then hands everything to Lefort OS, which
// decides: what is certain is recorded, what is uncertain waits for the seller. Nothing here decides alone.
//
// Safety:
//   • one synchronisation at a time (a lock in chrome.storage.session, released even after an error);
//   • the Vinted pages are read slowly (pauses between pages), only the seller's own data;
//   • each step is recorded in Lefort OS (vinted_sync_runs): an interrupted run shows as interrupted, never as « ok ».

import { LefortError, loadConfig, rpc } from "./lefort.js";
import { readSales, readWardrobe } from "./vinted.js";

export const DEFAULTS = { auto: true, everyMinutes: 60, openTab: true, wardrobeEveryHours: 6 };
const WINDOW_DAYS = 90;          // sales read again at each run: a sale missed one day is caught the next
const LOCK_MINUTES = 20;         // a lock older than this is a run that died with the browser
const CHUNK = 200;

export async function settings() {
  const { syncSettings } = await chrome.storage.local.get("syncSettings");
  return { ...DEFAULTS, ...(syncSettings ?? {}) };
}

export async function saveSettings(patch) {
  const next = { ...(await settings()), ...patch };
  await chrome.storage.local.set({ syncSettings: next });
  return next;
}

// Two guards: a flag set without waiting (two calls in the same worker cannot both pass it), and a lock in
// chrome.storage.session for any other context
let running = false;
async function takeLock() {
  if (running) return false;
  running = true;
  const { syncLock } = await chrome.storage.session.get("syncLock");
  if (syncLock && Date.now() - syncLock < LOCK_MINUTES * 60_000) { running = false; return false; }
  await chrome.storage.session.set({ syncLock: Date.now() });
  return true;
}
const releaseLock = async () => { await chrome.storage.session.remove("syncLock"); running = false; };

/** A vinted.fr tab to read from: an open one, or (if allowed) one opened in the background and closed afterwards */
async function vintedTab(allowOpen, progress) {
  const tabs = await chrome.tabs.query({ url: "https://www.vinted.fr/*" });
  const ready = tabs.find((t) => t.status === "complete" && /\/member\/\d+/.test(t.url ?? ""))
    ?? tabs.find((t) => t.status === "complete") ?? tabs[0];
  if (ready) return { tab: ready, opened: false };
  if (!allowOpen) return { tab: null, opened: false };
  progress("Ouverture de Vinted en arrière-plan…");
  const tab = await chrome.tabs.create({ url: "https://www.vinted.fr/", active: false });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listen); reject(new LefortError("Vinted ne répond pas.")); }, 45_000);
    function listen(id, info) {
      if (id === tab.id && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listen);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listen);
  });
  return { tab, opened: true };
}

async function inTab(tab, func, args) {
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args: [args] });
  return result;
}

const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
const add = (a, b) => { for (const [k, v] of Object.entries(b ?? {})) if (typeof v === "number") a[k] = (a[k] ?? 0) + v; return a; };

/**
 * One synchronisation.
 *   source: "auto" | "manual"
 *   wardrobe: also read the wardrobe (views, favourites, listings to link); auto runs do it every few hours
 *   full: read every Vinted sale, not only the last 90 days
 * Returns { status, counts, summary, error } or { skipped: reason }.
 */
export async function runSync({ source = "manual", wardrobe = false, full = false, onProgress = () => {} } = {}) {
  const cfg = await loadConfig();
  if (!cfg.session) return { skipped: "Connectez l'extension à Lefort OS." };
  if (!(await takeLock())) return { skipped: "Une synchronisation est déjà en cours." };
  const progress = (text) => { try { onProgress(text); } catch { /* page closed */ } };
  const opts = await settings();
  let run = null, opened = null, tab = null;
  const counts = {}, errors = [];
  const diagnostic = {};
  try {
    ({ tab, opened } = await vintedTab(source === "manual" || opts.openTab, progress));
    if (!tab) return { skipped: "Aucun onglet vinted.fr ouvert." };
    if (opened) opened = tab;
    run = await rpc("vinted_sync_start", { p_source: source, p_kind: wardrobe ? "full" : "orders" });

    // ── Sales
    const since = full ? null : new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
    const known = await rpc("vinted_known", { p_since: since });
    progress("Lecture des ventes Vinted…");
    const sales = await inTab(tab, readSales, { skip: known.settled, since });
    if (!sales || sales.error) throw new LefortError(sales?.error ?? "Lecture des ventes impossible.");
    diagnostic.sales = sales.diagnostic;
    let done = 0;
    for (const part of chunks(sales.sales, CHUNK)) {
      const r = await rpc("vinted_reconcile", { p_run: run, p_orders: part });
      add(counts, r);
      errors.push(...(r.errors ?? []).map((e) => `${e.transaction_id} : ${e.error}`));
      done += part.length;
      progress(`Rapprochement : ${done} / ${sales.sales.length} ventes…`);
    }

    // ── Wardrobe: audience of each listing, and listings that a « Réf. » links to an item
    let wardrobeComplete = null;
    if (wardrobe) {
      progress("Lecture du dressing…");
      const linked = new Set(known.linked ?? []);
      // descriptions are read only for listings not linked yet (they may carry a « Réf. »), a few per run
      // listings read in earlier runs are not read again (the oldest ones are forgotten after 30 days)
      const { detailedIds = {} } = await chrome.storage.local.get("detailedIds");
      const fresh = Object.fromEntries(Object.entries(detailedIds).filter(([, at]) => Date.now() - at < 30 * 86_400_000));
      const read = await inTab(tab, readWardrobe, { detailsExcept: [...linked, ...Object.keys(fresh)], maxDetails: 60 });
      if (!read || read.error) throw new LefortError(read?.error ?? "Lecture du dressing impossible.");
      const listings = read.listings;
      wardrobeComplete = read.complete;
      diagnostic.wardrobe = { endpoint: read.endpoint, listings: listings.length, complete: read.complete, stats: read.stats,
                              fields: read.sampleKeys, details_read: read.detailedIds?.length ?? 0 };
      for (const id of read.detailedIds ?? []) fresh[id] = Date.now();
      await chrome.storage.local.set({ detailedIds: fresh });
      for (const part of chunks(listings.map((l) => ({ ...l, photos: undefined })), 500)) {
        add(counts, await rpc("vinted_listings_seen", { p_run: run, p_listings: part }));
      }
    }

    const status = errors.length ? "partial" : "ok";
    const summary = await rpc("vinted_sync_finish", {
      p_run: run, p_status: status, p_orders_complete: sales.complete, p_covered_from: sales.coveredFrom,
      p_wardrobe_complete: wardrobeComplete, p_error: errors.length ? errors.slice(0, 20).join("\n") : null, p_diagnostic: diagnostic,
    });
    const result = { status, counts, summary, errors, at: new Date().toISOString(), source };
    await chrome.storage.local.set({ lastSync: result, ...(wardrobe ? { lastWardrobeAt: Date.now() } : {}) });
    return result;
  } catch (err) {
    const message = err?.message ?? String(err);
    if (run) {
      try {
        await rpc("vinted_sync_finish", { p_run: run, p_status: "error", p_error: message, p_diagnostic: diagnostic });
      } catch { /* the run will show as interrupted */ }
    }
    const result = { status: "error", error: message, counts, at: new Date().toISOString(), source };
    await chrome.storage.local.set({ lastSync: result });
    return result;
  } finally {
    if (opened) { try { await chrome.tabs.remove(opened.id); } catch { /* already closed */ } }
    await releaseLock();
  }
}

/** Number shown on the extension icon: sales waiting for a decision in Lefort OS */
export async function refreshBadge() {
  try {
    const cfg = await loadConfig();
    if (!cfg.session) { await chrome.action.setBadgeText({ text: "" }); return null; }
    const s = await rpc("vinted_sync_status");
    const n = Number(s.open_issues ?? 0);
    await chrome.action.setBadgeBackgroundColor({ color: n ? "#d95926" : "#199e70" });
    await chrome.action.setBadgeText({ text: n ? String(n > 99 ? "99+" : n) : "" });
    return s;
  } catch {
    return null;
  }
}
