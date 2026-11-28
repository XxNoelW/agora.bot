// WebLLM stores weights in the Cache API (and shader bits in IndexedDB).
// The app shell service worker does not cache those files. persist() asks
// the browser to keep that origin storage instead of evicting it.

const FLAG = 'agora:weights-cached';

export function cachedModelId(storage = globalThis.localStorage) {
  try { return storage?.getItem(FLAG) || ''; }
  catch { return ''; }
}

export function rememberCachedModel(modelId, storage = globalThis.localStorage) {
  try { storage?.setItem(FLAG, String(modelId || '')); } catch { /* private mode */ }
}

export async function requestPersistentStorage(nav = globalThis.navigator) {
  try {
    if (nav?.storage?.persist) return !!(await nav.storage.persist());
  } catch { /* the browser may ignore the request */ }
  return false;
}
