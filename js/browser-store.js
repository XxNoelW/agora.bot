// Small lists (memories, feedback, routines) live in IndexedDB, with localStorage if IndexedDB is missing.
const DB_NAME = 'agona-app';
const DB_VERSION = 1;
const NAMES = ['memories', 'feedback', 'routines'];

function localKey(name) {
  return `agora:store:${name}`;
}

function readLocal(name) {
  try { return JSON.parse(localStorage.getItem(localKey(name)) || '[]'); }
  catch { return []; }
}

function writeLocal(name, rows) {
  try { localStorage.setItem(localKey(name), JSON.stringify(rows)); }
  catch { /* private mode or a full disk */ }
}

let dbPromise = null;

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of NAMES) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
  }
  return dbPromise;
}

async function idbAll(name) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const req = db.transaction(name, 'readonly').objectStore(name).getAll();
    req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
    req.onerror = () => resolve([]);
  });
}

async function idbPut(name, row) {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    const req = db.transaction(name, 'readwrite').objectStore(name).put(row);
    req.onsuccess = () => resolve(true);
    req.onerror = () => resolve(false);
  });
}

async function idbDelete(name, id) {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    const req = db.transaction(name, 'readwrite').objectStore(name).delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => resolve(false);
  });
}

export async function listRows(name) {
  const rows = await idbAll(name);
  if (rows) return rows;
  return readLocal(name);
}

export async function saveRow(name, row) {
  const ok = await idbPut(name, row);
  if (ok) return row;
  const rows = readLocal(name).filter((item) => item.id !== row.id);
  rows.push(row);
  writeLocal(name, rows);
  return row;
}

export async function removeRow(name, id) {
  const ok = await idbDelete(name, id);
  if (ok) return;
  writeLocal(name, readLocal(name).filter((item) => item.id !== id));
}

export async function replaceRows(name, rows) {
  const db = await openDb();
  if (!db) {
    writeLocal(name, rows);
    return;
  }
  await new Promise((resolve) => {
    const tx = db.transaction(name, 'readwrite');
    const store = tx.objectStore(name);
    store.clear();
    for (const row of rows) store.put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
