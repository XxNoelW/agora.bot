// Anonymous counts. No cookies. A Do Not Track signal or the settings toggle skips the send.
import { cloudUrl } from './cloud.js';

const STATE_KEY = 'agona:v1';
const DEFAULT_URL = 'https://agora-cloud.knoel99-morcik.workers.dev';

export function doNotTrack(nav = globalThis.navigator) {
  const value = nav?.doNotTrack ?? globalThis.doNotTrack ?? nav?.msDoNotTrack;
  return value === '1' || value === 'yes';
}

export function usageCountsEnabled(storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage?.getItem(STATE_KEY) || 'null');
    return saved?.settings?.usageCounts !== false;
  } catch {
    return true;
  }
}

export function trackingAllowed(nav = globalThis.navigator, storage = globalThis.localStorage) {
  if (doNotTrack(nav)) return false;
  return usageCountsEnabled(storage);
}

let visitSent = false;

export async function postEvent(type, extra = {}, deps = {}) {
  const nav = deps.nav || globalThis.navigator;
  const storage = deps.storage || globalThis.localStorage;
  if (deps.force !== true && !trackingAllowed(nav, storage)) return { ok: false, skipped: true };
  if (type === 'visit') {
    if (visitSent && !deps.allowRepeat) return { ok: false, skipped: true };
    visitSent = true;
  }
  const tool = type === 'tool' && /^[A-Za-z0-9_]{1,40}$/.test(String(extra.tool || '')) ? extra.tool : undefined;
  const fetchImpl = deps.fetchImpl || fetch;
  const base = deps.base || cloudUrl(storage) || DEFAULT_URL;
  try {
    const res = await fetchImpl(`${base}/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, ...(tool ? { tool } : {}) }),
    });
    return { ok: res.ok, status: res.status, skipped: false };
  } catch {
    return { ok: false, skipped: false };
  }
}

export function noteEvent(type, extra) {
  postEvent(type, extra).catch(() => {});
}
