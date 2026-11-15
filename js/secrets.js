// Connector secrets stay in an encrypted vault. Chat state never receives them.

const DB_NAME = 'agona-vault';
const DB_STORE = 'kv';
const MASTER = 'master';

let memory = null;
let keyPromise = null;

export function useMemoryVault() {
  memory = new Map();
  keyPromise = null;
  return memory;
}

function bytesToB64(bytes) {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return btoa(out);
}

function b64ToBytes(text) {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function openDb() {
  if (memory || typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function kvGet(key) {
  if (memory) return memory.get(key);
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    const req = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
}

async function kvSet(key, value) {
  if (memory) {
    memory.set(key, value);
    return;
  }
  const db = await openDb();
  if (!db) throw new Error('This browser cannot store connector secrets.');
  await new Promise((resolve, reject) => {
    const req = db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function kvDelete(key) {
  if (memory) {
    memory.delete(key);
    return;
  }
  const db = await openDb();
  if (!db) return;
  await new Promise((resolve) => {
    const req = db.transaction(DB_STORE, 'readwrite').objectStore(DB_STORE).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
}

async function masterKey() {
  if (!keyPromise) {
    keyPromise = (async () => {
      const existing = await kvGet(MASTER);
      if (existing) return existing;
      const created = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      await kvSet(MASTER, created);
      return created;
    })();
  }
  return keyPromise;
}

export async function saveSecret(id, plaintext) {
  const key = await masterKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(String(plaintext));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded));
  await kvSet(`secret:${id}`, { iv: bytesToB64(iv), ct: bytesToB64(ct) });
}

export async function readSecret(id) {
  const packed = await kvGet(`secret:${id}`);
  if (!packed?.iv || !packed?.ct) return '';
  const key = await masterKey();
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(packed.iv) },
    key,
    b64ToBytes(packed.ct),
  );
  return new TextDecoder().decode(plain);
}

export async function deleteSecret(id) {
  await kvDelete(`secret:${id}`);
}

export async function hasSecret(id) {
  const packed = await kvGet(`secret:${id}`);
  return !!(packed?.iv && packed?.ct);
}

export function scrubSecrets(text, extras = []) {
  let out = String(text ?? '');
  for (const secret of extras) {
    if (secret && String(secret).length > 6) out = out.split(String(secret)).join('••••');
  }
  out = out.replace(/\b(?:ghp_|gho_|github_pat_|sk-|sk-or-v1-|hf_|ntn_|secret_)[A-Za-z0-9_-]{8,}\b/g, '••••');
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer ••••');
  return out;
}
