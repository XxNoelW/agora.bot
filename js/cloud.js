// Optional account sync. The code stays in this browser. The Worker stores only a hash.
import { state, save, migrateState } from './store.js';
import { cachedMemories, memoryEnabled, setMemoryEnabled, replaceMemories } from './memory.js';
import { voiceLang } from './voice.js';

export const DEFAULT_CLOUD_URL = 'https://agora-cloud.knoel99-morcik.workers.dev';
export const SYNC_CAP = 1_000_000;

const URL_KEY = 'agora:cloud-url';
const CODE_KEY = 'agora:cloud-code';
const VER_KEY = 'agora:sync-versions';
const KINDS = ['settings', 'memory', 'chats'];

let conflict = null;

export function ui(en, hu) {
  return voiceLang() === 'hu' ? hu : en;
}

export function cleanCloudUrl(value) {
  const text = String(value || '').trim();
  if (!text) return DEFAULT_CLOUD_URL;
  try {
    const url = new URL(text);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return DEFAULT_CLOUD_URL;
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return DEFAULT_CLOUD_URL;
  }
}

export function cloudUrl(storage = globalThis.localStorage) {
  try { return cleanCloudUrl(storage?.getItem(URL_KEY) || ''); }
  catch { return DEFAULT_CLOUD_URL; }
}

export function setCloudUrl(value, storage = globalThis.localStorage) {
  const next = cleanCloudUrl(value);
  try { storage?.setItem(URL_KEY, next); } catch { /* private mode */ }
  return next;
}

export function cloudCode(storage = globalThis.localStorage) {
  try { return storage?.getItem(CODE_KEY) || ''; }
  catch { return ''; }
}

export function setCloudCode(code, storage = globalThis.localStorage) {
  const next = String(code || '').trim().replace(/\s+/g, '');
  try {
    if (next) storage?.setItem(CODE_KEY, next);
    else storage?.removeItem(CODE_KEY);
  } catch { /* private mode */ }
  return next;
}

export function clearCloudCode(storage = globalThis.localStorage) {
  conflict = null;
  try {
    storage?.removeItem(CODE_KEY);
    storage?.removeItem(VER_KEY);
  } catch { /* private mode */ }
}

export function syncVersions(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(VER_KEY) || '{}');
    return {
      chats: Number(parsed.chats) || 0,
      memory: Number(parsed.memory) || 0,
      settings: Number(parsed.settings) || 0,
    };
  } catch {
    return { chats: 0, memory: 0, settings: 0 };
  }
}

function writeVersions(versions, storage = globalThis.localStorage) {
  try { storage?.setItem(VER_KEY, JSON.stringify(versions)); } catch { /* private mode */ }
}

export function syncConflict() {
  return conflict;
}

export function clearSyncConflict() {
  conflict = null;
}

function kindLabel(kind) {
  if (kind === 'chats') return ui('chats', 'cseveg\u00e9sek');
  if (kind === 'memory') return ui('memory', 'mem\u00f3ria');
  return ui('settings', 'be\u00e1ll\u00edt\u00e1sok');
}

export function encodedSize(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return new TextEncoder().encode(text).length;
}

function withoutPictures(bundle) {
  const chats = (bundle.chats || []).map((chat) => ({
    ...chat,
    messages: (chat.messages || []).map((message) => {
      if (!message || !message.image) return message;
      const { image, ...rest } = message;
      void image;
      return rest;
    }),
  }));
  const agents = (bundle.agents || []).map((agent) => {
    if (agent?.icon?.type !== 'photo') return agent;
    return { ...agent, icon: { type: 'shape', shape: agent.icon.shape || 'robot', color: agent.icon.color || agent.color } };
  });
  return { chats, agents };
}

export function bundleChats() {
  const full = { chats: state.chats || [], agents: state.agents || [] };
  if (encodedSize(full) <= SYNC_CAP) return { data: full, trimmed: false };
  return { data: withoutPictures(full), trimmed: true };
}

export function bundleMemory() {
  return { notes: cachedMemories(), enabled: memoryEnabled() };
}

export function bundleSettings() {
  const copy = { ...(state.settings || {}) };
  delete copy.openrouterKey;
  delete copy.apiKey;
  return copy;
}

function bundleFor(kind) {
  if (kind === 'chats') return bundleChats().data;
  if (kind === 'memory') return bundleMemory();
  return bundleSettings();
}

export async function applyBundle(kind, raw) {
  const data = typeof raw === 'string' && raw ? JSON.parse(raw) : raw;
  if (kind === 'chats') {
    const chats = Array.isArray(data) ? data : (data?.chats || []);
    const agents = Array.isArray(data) ? null : data?.agents;
    const next = migrateState({
      ...state,
      chats,
      agents: Array.isArray(agents) ? agents : state.agents,
    });
    state.agents = next.agents;
    state.chats = next.chats;
    save();
    return;
  }
  if (kind === 'memory') {
    const notes = Array.isArray(data) ? data : (data?.notes || []);
    if (data && typeof data.enabled === 'boolean') setMemoryEnabled(data.enabled);
    await replaceMemories(notes);
    return;
  }
  const incoming = data && typeof data === 'object' && !Array.isArray(data) ? { ...data } : {};
  delete incoming.openrouterKey;
  delete incoming.apiKey;
  const next = migrateState({ ...state, settings: { ...state.settings, ...incoming } });
  state.settings = next.settings;
  save();
}

async function callApi(url, path, { method = 'GET', body, code, fetchImpl = fetch } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (code) headers.Authorization = `Bearer ${code}`;
  let res;
  try {
    res = await fetchImpl(`${url}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, data: { error: 'offline' } };
  }
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: 'bad' }; }
  return { ok: res.ok, status: res.status, data };
}

function failMessage(status) {
  if (status === 0) return ui('The sync service did not answer. Check the backend URL.', 'A szinkron szolg\u00e1ltat\u00e1s nem v\u00e1laszolt. Ellen\u0151rizd a kiszolg\u00e1l\u00f3 c\u00edm\u00e9t.');
  if (status === 401) return ui('That sync code was not accepted.', 'Ezt a szinkronk\u00f3dot nem fogadtuk el.');
  if (status === 413) return ui('Chats are over the 1 MB sync limit.', 'A cseveg\u00e9sek t\u00fal nagyok az 1 MB-os hat\u00e1rhoz.');
  if (status === 403) return ui('This page is not allowed to call that backend.', 'Ez az oldal nem h\u00edvhatja azt a kiszolg\u00e1l\u00f3t.');
  return ui('Sync did not finish.', 'A szinkron nem fejez\u0151d\u00f6tt be.');
}

async function pushKind(url, code, kind, version, fetchImpl) {
  const data = bundleFor(kind);
  if (encodedSize(data) > SYNC_CAP) {
    return { ok: false, status: 413, data: { error: 'size' } };
  }
  return callApi(url, `/sync/${kind}`, {
    method: 'PUT',
    body: { data, version },
    code,
    fetchImpl,
  });
}

export async function syncNow(fetchImpl = fetch) {
  const code = cloudCode();
  if (!code) {
    return { ok: false, message: ui('Create an account or paste a sync code first.', 'El\u0151bb hozz l\u00e9tre fi\u00f3kot, vagy illessz be egy szinkronk\u00f3dot.') };
  }
  const url = cloudUrl();
  const versions = syncVersions();
  for (const kind of KINDS) {
    const result = await pushKind(url, code, kind, versions[kind] || 0, fetchImpl);
    if (result.status === 409 && result.data?.error === 'stale') {
      conflict = { kind, version: Number(result.data.version) || 0, data: result.data.data ?? '' };
      return {
        ok: false,
        conflict: true,
        message: ui(
          `This device and the other one both changed ${kindLabel(kind)}.`,
          `Ez az eszk\u00f6z \u00e9s a m\u00e1sik is megv\u00e1ltoztatta: ${kindLabel(kind)}.`,
        ),
      };
    }
    if (!result.ok) return { ok: false, message: failMessage(result.status) };
    versions[kind] = Number(result.data.version) || versions[kind];
    writeVersions(versions);
  }
  conflict = null;
  const trimmed = bundleChats().trimmed;
  const extra = trimmed
    ? ui(' Pictures stayed on this device.', ' A k\u00e9pek ezen az eszk\u00f6z\u00f6n maradtak.')
    : '';
  return {
    ok: true,
    message: ui('Synced chats, memory, and settings.', 'Szinkron k\u00e9sz: cseveg\u00e9sek, mem\u00f3ria \u00e9s be\u00e1ll\u00edt\u00e1sok.') + extra,
  };
}

export async function resolveConflict(choice, fetchImpl = fetch) {
  if (!conflict) return syncNow(fetchImpl);
  const current = conflict;
  const versions = syncVersions();
  if (choice === 'server') {
    await applyBundle(current.kind, current.data);
    versions[current.kind] = current.version;
    writeVersions(versions);
    conflict = null;
    return syncNow(fetchImpl);
  }
  const result = await pushKind(cloudUrl(), cloudCode(), current.kind, current.version, fetchImpl);
  if (result.status === 409 && result.data?.error === 'stale') {
    conflict = { kind: current.kind, version: Number(result.data.version) || 0, data: result.data.data ?? '' };
    return {
      ok: false,
      conflict: true,
      message: ui(
        `This device and the other one both changed ${kindLabel(current.kind)}.`,
        `Ez az eszk\u00f6z \u00e9s a m\u00e1sik is megv\u00e1ltoztatta: ${kindLabel(current.kind)}.`,
      ),
    };
  }
  if (!result.ok) return { ok: false, message: failMessage(result.status) };
  versions[current.kind] = Number(result.data.version) || current.version;
  writeVersions(versions);
  conflict = null;
  return syncNow(fetchImpl);
}

export async function createAccount(url, fetchImpl = fetch) {
  const base = setCloudUrl(url);
  const created = await callApi(base, '/account', { method: 'POST', fetchImpl });
  if (!created.ok || !created.data?.code) return { ok: false, message: failMessage(created.status) };
  setCloudCode(created.data.code);
  writeVersions({ chats: 0, memory: 0, settings: 0 });
  conflict = null;
  const pushed = await syncNow(fetchImpl);
  if (!pushed.ok) {
    return {
      ok: true,
      message: ui(
        'Account created. The sync code is below. Sync did not finish yet.',
        'A fi\u00f3k elk\u00e9sz\u00fclt. A szinkronk\u00f3d alul van. A szinkron m\u00e9g nem fejez\u0151d\u00f6tt be.',
      ),
    };
  }
  return {
    ok: true,
    message: ui(
      'Account created. Copy the sync code onto the other device.',
      'A fi\u00f3k elk\u00e9sz\u00fclt. M\u00e1sold a szinkronk\u00f3dot a m\u00e1sik eszk\u00f6zre.',
    ),
  };
}

export async function linkAccount(url, code, fetchImpl = fetch) {
  const base = setCloudUrl(url);
  const next = String(code || '').trim().replace(/\s+/g, '');
  if (!next.includes('.')) {
    return { ok: false, message: ui('Paste the whole sync code, including the dot.', 'Illeszd be a teljes szinkronk\u00f3dot, a ponttal egy\u00fctt.') };
  }
  const pulled = await callApi(base, '/sync', { code: next, fetchImpl });
  if (!pulled.ok) return { ok: false, message: failMessage(pulled.status) };
  setCloudCode(next);
  const versions = { chats: 0, memory: 0, settings: 0 };
  let any = false;
  for (const kind of KINDS) {
    const row = pulled.data?.[kind];
    if (!row) continue;
    any = true;
    await applyBundle(kind, row.data);
    versions[kind] = Number(row.version) || 0;
  }
  writeVersions(versions);
  conflict = null;
  if (!any) {
    return {
      ok: true,
      message: ui('Linked. Nothing is saved on that account yet.', 'Csatolva. Ezen a fi\u00f3kon m\u00e9g nincs mentett adat.'),
    };
  }
  return {
    ok: true,
    message: ui('Linked. Chats, memory, and settings were copied here.', 'Csatolva. A cseveg\u00e9sek, a mem\u00f3ria \u00e9s a be\u00e1ll\u00edt\u00e1sok \u00e1tm\u00e1sol\u00f3dtak.'),
  };
}

export async function removeAccount(fetchImpl = fetch) {
  const code = cloudCode();
  const url = cloudUrl();
  if (!code) {
    clearCloudCode();
    return { ok: true, message: ui('Removed from this device.', 'Elt\u00e1vol\u00edtva err\u0151l az eszk\u00f6zr\u0151l.') };
  }
  const result = await callApi(url, '/account', { method: 'DELETE', code, fetchImpl });
  if (!result.ok && result.status !== 401) return { ok: false, message: failMessage(result.status) };
  clearCloudCode();
  return { ok: true, message: ui('The account was deleted.', 'A fi\u00f3k t\u00f6r\u00f6lve.') };
}
