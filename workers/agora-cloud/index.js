// Account sync, shared chats, anonymous counts, and opt-in training notes.
// One module, no build step.
// Bindings: D1 `DB`. Var `ALLOWED_ORIGIN` (default https://xxnoelw.github.io).
// Secret `EXPORT_KEY` only for GET /feedback/export. If it is unset, that route is 403.
// No model key and no scheduled handler. Stats rows do not store an IP or a cookie.

const DEFAULT_ORIGIN = 'https://xxnoelw.github.io';
const KINDS = new Set(['chats', 'memory', 'settings']);
const MAX_BYTES = 1_000_000;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const SHARE_MAX_BYTES = 256 * 1024;
export const FEEDBACK_MAX_BYTES = 8 * 1024;
export const SHARE_DAILY_LIMIT = 30;
export const FEEDBACK_DAILY_LIMIT = 40;
export const EVENT_DAILY_LIMIT = 200;
const EVENT_TYPES = new Set(['visit', 'chat', 'tool', 'share', 'feedback']);

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
  headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, x-export-key';
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

export function stripPii(text) {
  const input = String(text ?? '');
  const noEmail = input.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]');
  return noEmail.replace(
    /(?:\+\d{1,3}|00\d{1,3}|06)(?:[\s.-]*\d){7,14}|\(\d{3}\)[\s.-]?\d{3}[\s.-]?\d{4}|\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b/g,
    (match) => {
      const digits = match.replace(/\D/g, '');
      if (digits.length < 8 || digits.length > 15) return match;
      if (/^\d{4}-\d{2}-\d{2}$/.test(match.trim())) return match;
      return '[phone]';
    },
  );
}

export async function keysMatch(provided, expected) {
  if (!expected) return false;
  const left = await hashSecretHex(String(provided ?? ''));
  const right = await hashSecretHex(String(expected));
  return timingSafeEqualHex(left, right);
}

function newPublicId() {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

async function readJson(request, maxBytes, origin) {
  const raw = await request.text();
  if (byteLength(raw) > maxBytes) return { error: json({ error: 'That is too large.' }, 413, origin) };
  try {
    return { body: raw ? JSON.parse(raw) : {} };
  } catch {
    return { error: json({ error: 'Send JSON.' }, 400, origin) };
  }
}

async function clientBucket(request, bucket) {
  const ip = request.headers.get('CF-Connecting-IP')
    || String(request.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    || '0';
  const day = utcDay();
  const hash = await hashSecretHex(`${bucket}:${day}:${ip}`);
  return `rl:${bucket}:${hash.slice(0, 24)}`;
}

async function withinDailyLimit(db, accountId, limit) {
  try {
    await db.prepare(
      'INSERT INTO usage (account_id, day, syncs) VALUES (?, ?, 1) ON CONFLICT(account_id, day) DO UPDATE SET syncs = syncs + 1',
    ).bind(accountId, utcDay()).run();
    const row = await db.prepare(
      'SELECT syncs FROM usage WHERE account_id = ? AND day = ?',
    ).bind(accountId, utcDay()).first();
    return (Number(row?.syncs) || 1) <= limit;
  } catch (err) {
    console.error(JSON.stringify({ op: 'rate_limit', message: String(err?.message || err) }));
    return true;
  }
}

function cleanShareMessage(message) {
  if (!message || typeof message !== 'object') return null;
  const role = message.role === 'assistant' ? 'assistant' : (message.role === 'user' ? 'user' : '');
  const content = stripControl(String(message.content || ''));
  if (!role || !content.trim()) return null;
  return {
    role,
    name: role === 'assistant' ? String(message.name || '').replace(/\s+/g, ' ').trim().slice(0, 40) : '',
    content,
  };
}

function stripControl(text) {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

export const AGENT_HIDE_AFTER = 3;

export function prepareAgent(body) {
  const name = String(body?.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  const instructions = String(body?.instructions || '').replace(/[\u0000-\u0008]/g, '').trim().slice(0, 4000);
  const description = String(body?.description || '').replace(/\s+/g, ' ').trim().slice(0, 180);
  const emoji = String(body?.emoji || '').replace(/[<>&"']/g, '').trim().slice(0, 8);
  const lang = body?.lang === 'hu' ? 'hu' : 'en';
  const tools = Array.isArray(body?.tools) ? body.tools.map((item) => String(item).slice(0, 40)).filter(Boolean).slice(0, 24) : [];
  const examples = Array.isArray(body?.examples)
    ? body.examples.map((item) => String(item).replace(/\s+/g, ' ').trim().slice(0, 180)).filter(Boolean).slice(0, 6)
    : [];
  if (!name || !instructions) return { ok: false, error: 'Name and instructions are required.' };
  const blob = `${name}\n${description}\n${instructions}\n${examples.join('\n')}`;
  if ((blob.match(/https?:\/\//gi) || []).length > 4) return { ok: false, error: 'Too many links.' };
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(blob)) return { ok: false, error: 'Remove email addresses before publishing.' };
  return { ok: true, agent: { name, emoji, description, instructions, lang, tools, examples } };
}

export function visibleAgents(rows, { q = '', sort = 'popular' } = {}) {
  const query = String(q || '').trim().toLowerCase();
  let list = (rows || []).filter((row) => !row.hidden && Number(row.reports || 0) < AGENT_HIDE_AFTER);
  if (query) {
    list = list.filter((row) => `${row.name || ''} ${row.description || ''} ${row.instructions || ''}`.toLowerCase().includes(query));
  }
  list.sort((a, b) => (sort === 'new'
    ? Number(b.created || 0) - Number(a.created || 0)
    : (Number(b.installs || 0) - Number(a.installs || 0)) || (Number(b.created || 0) - Number(a.created || 0))));
  return list.slice(0, 40).map(publicAgentRow);
}

function publicAgentRow(row) {
  let tools = [];
  let examples = [];
  try { tools = JSON.parse(row.tools || '[]'); } catch { tools = []; }
  try { examples = JSON.parse(row.examples || '[]'); } catch { examples = []; }
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji || '',
    description: row.description || '',
    instructions: row.instructions || '',
    lang: row.lang || 'en',
    tools: Array.isArray(tools) ? tools : [],
    examples: Array.isArray(examples) ? examples : [],
    installs: Number(row.installs) || 0,
    created: Number(row.created) || 0,
  };
}

export function fitShare(body, maxBytes = SHARE_MAX_BYTES) {
  const title = String(body?.title || 'Chat').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Chat';
  let messages = Array.isArray(body?.messages) ? body.messages.map(cleanShareMessage).filter(Boolean) : [];
  if (messages.length > 200) messages = messages.slice(-200);
  let trimmed = false;
  const packed = () => JSON.stringify({ title, messages });
  while (messages.length > 1 && byteLength(packed()) > maxBytes) {
    messages.shift();
    trimmed = true;
  }
  if (messages.length === 1 && byteLength(packed()) > maxBytes) {
    const overhead = byteLength(packed()) - byteLength(messages[0].content);
    const room = Math.max(0, maxBytes - overhead - 16);
    messages[0] = { ...messages[0], content: messages[0].content.slice(0, room) };
    trimmed = true;
  }
  return { title, messages, trimmed, bytes: byteLength(packed()) };
}

async function createShare(request, env, origin) {
  const bucket = await clientBucket(request, 'share');
  if (!(await withinDailyLimit(env.DB, bucket, SHARE_DAILY_LIMIT))) {
    return json({ error: 'Too many shared chats from this network today.' }, 429, origin);
  }
  const read = await readJson(request, SHARE_MAX_BYTES + 8192, origin);
  if (read.error) return read.error;
  if (read.body?.kind === 'page') {
    const title = String(read.body.title || 'Page').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Page';
    const html = String(read.body.html || '').slice(0, 20000);
    if (!html.trim()) return json({ error: 'That page is empty.' }, 400, origin);
    const id = newPublicId();
    const now = Date.now();
    await env.DB.prepare(
      'INSERT INTO shares (id, data, created) VALUES (?, ?, ?)',
    ).bind(id, JSON.stringify({ kind: 'page', title, html }), now).run();
    return json({ id, kind: 'page', created: now }, 201, origin);
  }
  const fit = fitShare(read.body);
  if (!fit.messages.length) return json({ error: 'There is nothing to share.' }, 400, origin);
  if (fit.bytes > SHARE_MAX_BYTES) return json({ error: 'That chat is over 256 KB.' }, 413, origin);
  const id = newPublicId();
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO shares (id, data, created) VALUES (?, ?, ?)',
  ).bind(id, JSON.stringify({ title: fit.title, messages: fit.messages }), now).run();
  return json({ id, created: now, trimmed: fit.trimmed }, 201, origin);
}

async function readShare(env, id, origin) {
  const clean = String(id || '').toUpperCase();
  if (!/^[A-Z2-7]{16}$/.test(clean)) return json({ error: 'That share was not found.' }, 404, origin);
  const row = await env.DB.prepare(
    'SELECT id, data, created FROM shares WHERE id = ?',
  ).bind(clean).first();
  if (!row) return json({ error: 'That share was not found.' }, 404, origin);
  let data = {};
  try { data = JSON.parse(row.data || '{}'); } catch { data = {}; }
  return json({
    id: row.id,
    created: Number(row.created) || 0,
    kind: data.kind === 'page' ? 'page' : 'chat',
    title: String(data.title || 'Chat'),
    html: data.kind === 'page' ? String(data.html || '') : '',
    messages: Array.isArray(data.messages) ? data.messages : [],
  }, 200, origin);
}

async function listAgentsRoute(env, url, origin) {
  const listed = await env.DB.prepare(
    'SELECT id, name, emoji, description, instructions, lang, tools, examples, installs, created, reports, hidden FROM agents',
  ).all();
  const agents = visibleAgents(listed?.results || [], {
    q: url.searchParams.get('q') || '',
    sort: url.searchParams.get('sort') === 'new' ? 'new' : 'popular',
  });
  return json({ agents }, 200, origin);
}

async function publishAgentRoute(request, env, origin) {
  const read = await readJson(request, 20000, origin);
  if (read.error) return read.error;
  const prepared = prepareAgent(read.body);
  if (!prepared.ok) return json({ error: prepared.error }, 400, origin);
  const id = newPublicId();
  const now = Date.now();
  const agent = prepared.agent;
  await env.DB.prepare(
    'INSERT INTO agents (id, name, emoji, description, instructions, lang, tools, examples, installs, created, reports, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 0)',
  ).bind(id, agent.name, agent.emoji, agent.description, agent.instructions, agent.lang, JSON.stringify(agent.tools), JSON.stringify(agent.examples), now).run();
  return json({ id, created: now }, 201, origin);
}

async function bumpAgent(env, id, field, origin) {
  const clean = String(id || '').toUpperCase();
  if (!/^[A-Z2-7]{16}$/.test(clean)) return json({ error: 'That agent was not found.' }, 404, origin);
  const column = field === 'reports' ? 'reports' : 'installs';
  const result = await env.DB.prepare(
    `UPDATE agents SET ${column} = ${column} + 1 WHERE id = ?`,
  ).bind(clean).run();
  if (changesOf(result) !== 1) return json({ error: 'That agent was not found.' }, 404, origin);
  if (field === 'reports') {
    await env.DB.prepare(
      'UPDATE agents SET hidden = 1 WHERE id = ? AND reports >= ?',
    ).bind(clean, AGENT_HIDE_AFTER).run();
  }
  return json({ ok: true }, 200, origin);
}

function eventKey(type, tool) {
  if (type !== 'tool') return '';
  const name = String(tool || '').trim();
  if (!/^[A-Za-z0-9_]{1,40}$/.test(name)) return 'other';
  return name;
}

async function recordEvent(request, env, origin) {
  const bucket = await clientBucket(request, 'event');
  if (!(await withinDailyLimit(env.DB, bucket, EVENT_DAILY_LIMIT))) {
    return json({ error: 'Too many counts from this network today.' }, 429, origin);
  }
  const read = await readJson(request, 2048, origin);
  if (read.error) return read.error;
  const type = String(read.body?.type || '');
  if (!EVENT_TYPES.has(type)) return json({ error: 'Unknown event.' }, 400, origin);
  const key = eventKey(type, read.body?.tool);
  await env.DB.prepare(
    'INSERT INTO stats (day, type, key, count) VALUES (?, ?, ?, 1) ON CONFLICT(day, type, key) DO UPDATE SET count = count + 1',
  ).bind(utcDay(), type, key).run();
  return json({ ok: true }, 202, origin);
}

function statsSince(now = Date.now()) {
  return new Date(now - 29 * 86400000).toISOString().slice(0, 10);
}

async function readStats(env, origin) {
  const listed = await env.DB.prepare(
    'SELECT day, type, key, count FROM stats WHERE day >= ? ORDER BY day ASC',
  ).bind(statsSince()).all();
  const rows = (listed?.results || []).map((row) => ({
    day: String(row.day || ''),
    type: String(row.type || ''),
    key: String(row.key || ''),
    count: Number(row.count) || 0,
  }));
  const totals = {};
  for (const row of rows) totals[row.type] = (totals[row.type] || 0) + row.count;
  return json({ days: 30, rows, totals }, 200, origin);
}

export function fitFeedback(body, maxBytes = FEEDBACK_MAX_BYTES) {
  const ratingRaw = body?.rating;
  const rating = ratingRaw === 1 || ratingRaw === 'up' || ratingRaw === '1'
    ? 1
    : (ratingRaw === -1 || ratingRaw === 'down' || ratingRaw === '-1' ? -1 : 0);
  const lang = body?.lang === 'hu' ? 'hu' : 'en';
  let messages = Array.isArray(body?.messages) ? body.messages.slice(-2) : [];
  messages = messages.map((message) => ({
    role: message?.role === 'assistant' ? 'assistant' : 'user',
    content: stripPii(String(message?.content || '')),
  })).filter((message) => message.content.trim());
  while (messages.length && byteLength(JSON.stringify(messages)) > maxBytes) {
    const last = messages[messages.length - 1];
    if (last.content.length > 40) last.content = last.content.slice(0, Math.floor(last.content.length * 0.7));
    else if (messages.length > 1) messages.shift();
    else last.content = last.content.slice(0, 200);
  }
  return { rating, lang, messages, bytes: byteLength(JSON.stringify(messages)) };
}

async function saveTraining(request, env, origin) {
  const bucket = await clientBucket(request, 'feedback');
  if (!(await withinDailyLimit(env.DB, bucket, FEEDBACK_DAILY_LIMIT))) {
    return json({ error: 'Too many notes from this network today.' }, 429, origin);
  }
  const read = await readJson(request, FEEDBACK_MAX_BYTES + 4096, origin);
  if (read.error) return read.error;
  const fit = fitFeedback(read.body);
  if (!fit.rating) return json({ error: 'Rating must be up or down.' }, 400, origin);
  if (!fit.messages.length) return json({ error: 'Missing the last turn.' }, 400, origin);
  if (fit.bytes > FEEDBACK_MAX_BYTES) return json({ error: 'That note is over 8 KB.' }, 413, origin);
  const id = newPublicId();
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO feedback (id, created, rating, lang, data, used) VALUES (?, ?, ?, ?, ?, 0)',
  ).bind(id, now, fit.rating, fit.lang, JSON.stringify(fit.messages)).run();
  return json({ id, created: now }, 201, origin);
}

async function exportTraining(request, env, origin, url) {
  const expected = String(env?.EXPORT_KEY || '').trim();
  if (!expected) return json({ error: 'Export is not configured.' }, 403, origin);
  const provided = request.headers.get('x-export-key') || '';
  if (!(await keysMatch(provided, expected))) return json({ error: 'Export is not configured.' }, 403, origin);
  if (!env?.DB) return json({ error: 'Storage is not connected.' }, 500, origin);
  const sinceRaw = Number(url.searchParams.get('since') || 0);
  const since = Number.isFinite(sinceRaw) && sinceRaw > 0 ? sinceRaw : 0;
  const listed = await env.DB.prepare(
    'SELECT id, created, rating, lang, data, used FROM feedback WHERE created >= ? ORDER BY created ASC LIMIT 500',
  ).bind(since).all();
  const rows = (listed?.results || []).map((row) => {
    let messages = [];
    try { messages = JSON.parse(row.data || '[]'); } catch { messages = []; }
    return {
      id: row.id,
      created: Number(row.created) || 0,
      rating: Number(row.rating) || 0,
      lang: row.lang === 'hu' ? 'hu' : 'en',
      messages: Array.isArray(messages) ? messages : [],
      used: Number(row.used) || 0,
    };
  });
  return json({ rows }, 200, origin);
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
    if (request.method === 'GET' && path === '/feedback/export') {
      return exportTraining(request, env, origin, url);
    }
    if (!env?.DB && path !== '/' && path !== '/health') {
      return json({ error: 'Storage is not connected.' }, 500, origin);
    }
    if (request.method === 'GET' && (path === '/' || path === '/health')) {
      return json({ ok: true, name: 'agora-cloud' }, 200, origin);
    }
    if (request.method === 'GET' && path === '/agents') return listAgentsRoute(env, url, origin);
    const agentAct = path.match(/^\/agents\/([^/]+)\/(install|report)$/);
    if (agentAct && request.method === 'POST') {
      return bumpAgent(env, decodeURIComponent(agentAct[1]), agentAct[2] === 'report' ? 'reports' : 'installs', origin);
    }
    if (request.method === 'POST' && path === '/share') return createShare(request, env, origin);
    if (path.startsWith('/share/')) {
      if (request.method !== 'GET') return json({ error: 'Not found' }, 404, origin);
      return readShare(env, decodeURIComponent(path.slice('/share/'.length)), origin);
    }
    if (path === '/event') {
      if (request.method !== 'POST') return json({ error: 'Not found' }, 404, origin);
      return recordEvent(request, env, origin);
    }
    if (path === '/stats') {
      if (request.method !== 'GET') return json({ error: 'Not found' }, 404, origin);
      return readStats(env, origin);
    }
    if (path === '/feedback') {
      if (request.method !== 'POST') return json({ error: 'Not found' }, 404, origin);
      return saveTraining(request, env, origin);
    }
    if (request.method === 'POST' && path === '/account') return createAccount(env, origin);
    if (request.method === 'POST' && path === '/agents') {
      const publisher = await authorize(request, env);
      if (!publisher) return json({ error: 'That sync code was not accepted.' }, 401, origin);
      return publishAgentRoute(request, env, origin);
    }
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
