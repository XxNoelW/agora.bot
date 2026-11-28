// Offline shell, model cache, and the sync queue. Weights use a separate runtime cache.
import { voiceLang } from './voice.js';
import { RUNTIME_CACHE, shouldRuntimeCache } from './shell-cache.js';

export { RUNTIME_CACHE, shouldRuntimeCache };
export const OFFLINE_FLAG = 'agora:offline-ready';
export const SYNC_PENDING_KEY = 'agora:sync-pending';

const NETWORK_TOOLS = new Set(['web_search', 'read_page', 'fetch_wikipedia_page']);

function t(en, hu) {
  return voiceLang() === 'hu' ? hu : en;
}

export function isOnline(nav = globalThis.navigator) {
  if (!nav || typeof nav.onLine !== 'boolean') return true;
  return nav.onLine;
}

export function blockNetworkTool(name, online = isOnline()) {
  if (online || !NETWORK_TOOLS.has(name)) return '';
  return t(
    'Web tools are paused while you are offline.',
    'A webes eszk\u00f6z\u00f6k sz\u00fcnetelnek, am\u00edg nincs internet.',
  );
}

export function offlineConnectorMessage(online = isOnline()) {
  if (online) return '';
  return t(
    'This connector needs the internet. It will work again when you are back online.',
    'Ehhez a csatlakoz\u00f3hoz internet kell. \u00dajra m\u0171k\u00f6dik, ha online vagy.',
  );
}

export function offlineBanner(online = isOnline()) {
  if (online) return '';
  return t(
    'You are offline. Web search and connectors wait. Agora 1.0 still answers if it is saved on this device.',
    'Nincs internet. A webes keres\u00e9s \u00e9s a csatlakoz\u00f3k v\u00e1rnak. Az Agora 1.0 v\u00e1laszol, ha ezen az eszk\u00f6z\u00f6n megvan.',
  );
}

export function readOfflineFlag(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(OFFLINE_FLAG) || '{}');
    return {
      shell: !!parsed.shell,
      model: !!parsed.model,
      vision: !!parsed.vision,
      at: Number(parsed.at) || 0,
    };
  } catch {
    return { shell: false, model: false, vision: false, at: 0 };
  }
}

export function writeOfflineFlag(patch, storage = globalThis.localStorage) {
  const next = { ...readOfflineFlag(storage), ...patch };
  try { storage?.setItem(OFFLINE_FLAG, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}

export function offlineBadge({ online = true, shell = false, model = false } = {}, lang = voiceLang()) {
  const hu = lang === 'hu';
  if (shell && model) {
    return {
      ready: true,
      text: online ? (hu ? 'Offline is el\u00e9rhet\u0151' : 'Available offline') : (hu ? 'Offline' : 'Offline'),
    };
  }
  if (!online) {
    return {
      ready: false,
      text: hu ? 'Offline · a modell nincs let\u00f6ltve' : 'Offline · model not saved',
    };
  }
  return { ready: false, text: '' };
}

export function markSyncPending(storage = globalThis.localStorage) {
  try { storage?.setItem(SYNC_PENDING_KEY, '1'); } catch { /* private mode */ }
}

export function syncPending(storage = globalThis.localStorage) {
  try { return storage?.getItem(SYNC_PENDING_KEY) === '1'; }
  catch { return false; }
}

export function clearSyncPending(storage = globalThis.localStorage) {
  try { storage?.removeItem(SYNC_PENDING_KEY); } catch { /* private mode */ }
}
