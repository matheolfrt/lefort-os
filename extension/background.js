// Background worker: opens the extension page on click, and runs the Vinted synchronisation on its own every hour
// (by default) while the browser is open. The page and the schedule share one runner and one lock (sync.js).
import { refreshBadge, runSync, settings } from "./sync.js";

const ALARM = "vinted-sync";

// The extension works in a full tab (a popup would close mid-import).
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL("app.html");
  const [existing] = await chrome.tabs.query({ url });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
});

/** (Re)plans the automatic synchronisation from the settings */
async function schedule() {
  const s = await settings();
  await chrome.alarms.clear(ALARM);
  if (s.auto) await chrome.alarms.create(ALARM, { delayInMinutes: 2, periodInMinutes: Math.max(15, s.everyMinutes) });
}

const relay = (text) => chrome.runtime.sendMessage({ type: "sync-progress", text }).catch(() => { /* page closed */ });

async function automatic() {
  const s = await settings();
  if (!s.auto) return;
  const { lastWardrobeAt = 0 } = await chrome.storage.local.get("lastWardrobeAt");
  const wardrobe = Date.now() - lastWardrobeAt > s.wardrobeEveryHours * 3_600_000;
  const result = await runSync({ source: "auto", wardrobe, onProgress: relay });
  await refreshBadge();
  chrome.runtime.sendMessage({ type: "sync-done", result }).catch(() => {});
}

chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ALARM) automatic(); });
chrome.runtime.onInstalled.addListener(() => { schedule(); refreshBadge(); });
chrome.runtime.onStartup.addListener(() => { schedule(); refreshBadge(); });

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === "sync-now") {
    runSync({ source: "manual", wardrobe: msg.wardrobe !== false, full: !!msg.full, onProgress: relay })
      .then(async (result) => { await refreshBadge(); reply(result); });
    return true; // answers later
  }
  if (msg?.type === "reschedule") { schedule().then(() => reply({ ok: true })); return true; }
  if (msg?.type === "badge") { refreshBadge().then(reply); return true; }
  return false;
});
