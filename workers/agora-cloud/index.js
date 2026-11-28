// Account sync for Agora. One module, no build step.
// Bindings: D1 `DB`. Var `ALLOWED_ORIGIN` (default https://xxnoelw.github.io).
// No model key and no scheduled handler.

const DEFAULT_ORIGIN = 'https://xxnoelw.github.io';
const KINDS = new Set(['chats', 'memory', 'settings']);
const MAX_BYTES = 1_000_000;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base64url(bytes) {
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function parseCode(code) {
  const text = String(code || '').trim().replace(/\s+/g, '');
  const dot = text.indexOf('.');
  if (dot < 1) return null;
  const id = text.slice(0, dot).toUpperCase();
  const secret = text.slice(dot + 1);
  if (!/^[A-Z2-7]{26}$/.test(id)) return null;
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
  return { id, secret };
}

export async function hashSecretHex(secret) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(secret)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const text = String(hex || '');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(text.slice(i * 2, i * 2 + 2) || '0', 16) || 0;
  return out;
}

export function timingSafeEqualHex(a, b) {
  const left = hexToBytes(a);
  const right = hexToBytes(b);
  if (left.length === right.length && typeof crypto.subtle.timingSafeEqual === 'function') {
    try { return crypto.subtle.timingSafeEqual(left, right); } catch { /* fall through */ }
  }
  let diff = String(a || '').length ^ String(b || '').length;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

export function originAllowed(origin, allowed = DEFAULT_ORIGIN) {
  if (!origin) return true;
  if (origin === allowed) return true;
  let url;
  try { url = new URL(origin); } catch { return false; }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') return false;
  return url.protocol === 'http:' || url.protocol === 'https:';
}

// `version` is the version the client last read. A different version is stale.
export function syncDecision(serverVersion, clientVersion) {
  const client = Number(clientVersion);
  const server = serverVersion == null ? 0 : Number(serverVersion);
  if (!Number.isInteger(client) || client < 0) return { ok: false, reason: 'version' };
  if (!Number.isInteger(server) || client !== server) return { ok: false, reason: 'stale', version: server };
  return { ok: true, version: server + 1 };
}

function byteLength(text) {
  return new TextEncoder().encode(text).length;
}

function utcDay(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function corsHeaders(origin) {
  const headers = { Vary: 'Origin' };
  if (!origin) return headers;
  headers['Access-Control-Allow-Origin'] = origin;
  headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
  headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
  headers['Access-Control-Max-Age'] = '86400';
  return headers;
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(origin),
    },
  });
}

function changesOf(result) {
  const n = Number(result?.meta?.changes);
  return Number.isFinite(n) ? n : 1;
}

async function readAccount(db, id) {
  return db.prepare('SELECT secret_hash FROM accounts WHERE id = ?').bind(id).first();
}

async function authorize(request, env) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(\S+)\s*$/i);
  if (!match) return null;
  const parsed = parseCode(match[1]);
  if (!parsed) return null;
  const provided = await hashSecretHex(parsed.secret);
  const row = await readAccount(env.DB, parsed.id);
  const stored = row?.secret_hash || '0'.repeat(64);
  const ok = timingSafeEqualHex(provided, stored) && !!row;
  if (!ok) return null;
  try {
    await env.DB.prepare('UPDATE accounts SET last_seen = ? WHERE id = ?').bind(Date.now(), parsed.id).run();
  } catch (err) {
    console.error(JSON.stringify({ op: 'last_seen', message: String(err?.message || err) }));
  }
  return parsed;
}

async function noteUsage(db, accountId) {
  try {
    await db.prepare(
      'INSERT INTO usage (account_id, day, syncs) VALUES (?, ?, 1) ON CONFLICT(account_id, day) DO UPDATE SET syncs = syncs + 1',
    ).bind(accountId, utcDay()).run();
  } catch { /* the usage table is optional */ }
}

async function createAccount(env, origin) {
  const idBytes = new Uint8Array(16);
  const secretBytes = new Uint8Array(32);
  crypto.getRandomValues(idBytes);
  crypto.getRandomValues(secretBytes);
  const id = base32Encode(idBytes);
  const secret = base64url(secretBytes);
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO accounts (id, secret_hash, created, last_seen) VALUES (?, ?, ?, ?)',
  ).bind(id, await hashSecretHex(secret), now, now).run();
  return json({ id, secret, code: `${id}.${secret}` }, 201, origin);
}

async function deleteAccount(env, account, origin) {
  await env.DB.prepare('DELETE FROM sync WHERE account_id = ?').bind(account.id).run();
  try { await env.DB.prepare('DELETE FROM usage WHERE account_id = ?').bind(account.id).run(); } catch { /* optional */ }
  await env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(account.id).run();
  return json({ ok: true }, 200, origin);
}

function syncRow(row) {
  if (!row) return null;
  return {
    data: row.data ?? '',
    version: Number(row.version) || 0,
    updated: Number(row.updated) || 0,
  };
}

async function getSync(env, account, origin) {
  const listed = await env.DB.prepare(
    'SELECT kind, data, version, updated FROM sync WHERE account_id = ?',
  ).bind(account.id).all();
  const out = { chats: null, memory: null, settings: null };
  for (const row of listed?.results || []) {
    if (KINDS.has(row.kind)) out[row.kind] = syncRow(row);
  }
  return json(out, 200, origin);
}

async function putSync(request, env, account, kind, origin) {
  if (!KINDS.has(kind)) return json({ error: 'Unknown sync kind.' }, 400, origin);
  const raw = await request.text();
  if (byteLength(raw) > MAX_BYTES + 10_000) return json({ error: 'Sync data is over 1 MB.' }, 413, origin);
  let body;
  try { body = JSON.parse(raw || '{}'); } catch { return json({ error: 'Send JSON.' }, 400, origin); }
  if (body.data === undefined) return json({ error: 'Missing data.' }, 400, origin);
  const data = typeof body.data === 'string' ? body.data : JSON.stringify(body.data);
  if (byteLength(data) > MAX_BYTES) return json({ error: 'Sync data is over 1 MB.' }, 413, origin);
  const existing = await env.DB.prepare(
    'SELECT data, version, updated FROM sync WHERE account_id = ? AND kind = ?',
  ).bind(account.id, kind).first();
  const decision = syncDecision(existing ? existing.version : null, body.version ?? 0);
  if (!decision.ok && decision.reason === 'version') return json({ error: 'Version must be a whole number.' }, 400, origin);
  if (!decision.ok) {
    return json({
      error: 'stale',
      kind,
      data: existing?.data ?? '',
      version: Number(existing?.version) || 0,
      updated: Number(existing?.updated) || 0,
    }, 409, origin);
  }
  const now = Date.now();
  if (!existing) {
    await env.DB.prepare(
      'INSERT INTO sync (account_id, kind, data, version, updated) VALUES (?, ?, ?, ?, ?)',
    ).bind(account.id, kind, data, decision.version, now).run();
  } else {
    const result = await env.DB.prepare(
      'UPDATE sync SET data = ?, version = ?, updated = ? WHERE account_id = ? AND kind = ? AND version = ?',
    ).bind(data, decision.version, now, account.id, kind, existing.version).run();
    if (changesOf(result) !== 1) {
      const fresh = await env.DB.prepare(
        'SELECT data, version, updated FROM sync WHERE account_id = ? AND kind = ?',
      ).bind(account.id, kind).first();
      return json({
        error: 'stale',
        kind,
        data: fresh?.data ?? '',
        version: Number(fresh?.version) || 0,
        updated: Number(fresh?.updated) || 0,
      }, 409, origin);
    }
  }
  await noteUsage(env.DB, account.id);
  return json({ kind, version: decision.version, updated: now }, 200, origin);
}

export async function handleRequest(request, env) {
  const allowed = String(env?.ALLOWED_ORIGIN || DEFAULT_ORIGIN).trim() || DEFAULT_ORIGIN;
  const requestOrigin = request.headers.get('Origin') || '';
  if (requestOrigin && !originAllowed(requestOrigin, allowed)) {
    return json({ error: 'This origin is not allowed.' }, 403, '');
  }
  const origin = requestOrigin && originAllowed(requestOrigin, allowed) ? requestOrigin : '';
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  try {
    if (!env?.DB && path !== '/' && path !== '/health') {
      return json({ error: 'Storage is not connected.' }, 500, origin);
    }
    if (request.method === 'GET' && (path === '/' || path === '/health')) {
      return json({ ok: true, name: 'agora-cloud' }, 200, origin);
    }
    if (request.method === 'POST' && path === '/account') return createAccount(env, origin);
    const account = await authorize(request, env);
    if (!account) return json({ error: 'That sync code was not accepted.' }, 401, origin);
    if (request.method === 'DELETE' && path === '/account') return deleteAccount(env, account, origin);
    if (request.method === 'GET' && path === '/sync') return getSync(env, account, origin);
    if (request.method === 'PUT' && path.startsWith('/sync/')) {
      return putSync(request, env, account, decodeURIComponent(path.slice('/sync/'.length)), origin);
    }
    return json({ error: 'Not found' }, 404, origin);
  } catch (err) {
    console.error(JSON.stringify({ path, message: String(err?.message || err) }));
    return json({ error: 'The sync service could not finish that.' }, 500, origin);
  }
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};
