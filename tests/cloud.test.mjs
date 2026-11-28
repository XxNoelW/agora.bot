import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const mem = new Map();
globalThis.localStorage = {
  getItem: (key) => (mem.has(key) ? mem.get(key) : null),
  setItem: (key, value) => { mem.set(key, String(value)); },
  removeItem: (key) => { mem.delete(key); },
};

const worker = await import('../workers/agora-cloud/index.js');
const qr = await import('../js/qr.js');
const store = await import('../js/plugin-store.js');

function memoryDb() {
  const accounts = new Map();
  const sync = new Map();
  return {
    prepare(sql) {
      const params = [];
      const api = {
        bind(...args) {
          params.splice(0, params.length, ...args);
          return api;
        },
        async first() {
          if (sql.startsWith('SELECT secret_hash')) {
            const row = accounts.get(params[0]);
            return row ? { secret_hash: row.secret_hash } : null;
          }
          if (sql.startsWith('SELECT data, version')) {
            return sync.get(`${params[0]}:${params[1]}`) || null;
          }
          return null;
        },
        async all() {
          const results = [];
          if (sql.includes('FROM sync')) {
            for (const [key, row] of sync) {
              if (key.startsWith(`${params[0]}:`)) results.push(row);
            }
          }
          return { results };
        },
        async run() {
          if (sql.startsWith('INSERT INTO accounts')) {
            accounts.set(params[0], { secret_hash: params[1], created: params[2], last_seen: params[3] });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith('UPDATE accounts')) {
            const row = accounts.get(params[1]);
            if (row) row.last_seen = params[0];
            return { meta: { changes: row ? 1 : 0 } };
          }
          if (sql.startsWith('INSERT INTO sync')) {
            sync.set(`${params[0]}:${params[1]}`, {
              account_id: params[0],
              kind: params[1],
              data: params[2],
              version: params[3],
              updated: params[4],
            });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith('UPDATE sync')) {
            const row = sync.get(`${params[3]}:${params[4]}`);
            if (!row || row.version !== params[5]) return { meta: { changes: 0 } };
            row.data = params[0];
            row.version = params[1];
            row.updated = params[2];
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith('DELETE FROM sync')) {
            for (const key of [...sync.keys()]) if (key.startsWith(`${params[0]}:`)) sync.delete(key);
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith('DELETE FROM usage') || sql.startsWith('INSERT INTO usage')) {
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith('DELETE FROM accounts')) {
            accounts.delete(params[0]);
            return { meta: { changes: 1 } };
          }
          throw new Error(`unexpected sql ${sql}`);
        },
      };
      return api;
    },
  };
}

function call(path, { method = 'GET', origin = 'https://xxnoelw.github.io', body, code, db = memoryDb() } = {}) {
  const headers = { Origin: origin };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (code) headers.Authorization = `Bearer ${code}`;
  return worker.handleRequest(new Request(`https://agora-cloud.example${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { DB: db, ALLOWED_ORIGIN: 'https://xxnoelw.github.io' });
}

test('secret hashing is SHA-256 and the compare does not treat a lookalike as equal', async () => {
  assert.equal(
    await worker.hashSecretHex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  const hash = await worker.hashSecretHex('agora-sync');
  assert.equal(worker.timingSafeEqualHex(hash, hash), true);
  assert.equal(worker.timingSafeEqualHex(hash, await worker.hashSecretHex('agora-sync!')), false);
  assert.equal(worker.timingSafeEqualHex(hash, `${hash.slice(0, -1)}0`), false);
});

test('account ids are 16 bytes of base32 and codes split on the first dot', () => {
  assert.equal(worker.base32Encode(new TextEncoder().encode('foo')), 'MZXW6');
  const id = worker.base32Encode(crypto.getRandomValues(new Uint8Array(16)));
  assert.equal(id.length, 26);
  assert.match(id, /^[A-Z2-7]{26}$/);
  assert.equal(worker.parseCode('not a code'), null);
  assert.equal(worker.parseCode(`${id}.short`), null);
  const secret = 'a'.repeat(43);
  assert.deepEqual(worker.parseCode(` ${id.toLowerCase()}.${secret} `), { id, secret });
});

test('sync writes only when the client names the current version', () => {
  assert.deepEqual(worker.syncDecision(null, 0), { ok: true, version: 1 });
  assert.deepEqual(worker.syncDecision(3, 3), { ok: true, version: 4 });
  assert.equal(worker.syncDecision(3, 2).ok, false);
  assert.equal(worker.syncDecision(3, 4).reason, 'stale');
  assert.equal(worker.syncDecision(0, -1).reason, 'version');
});

test('CORS allows the site and localhost only', () => {
  const allow = 'https://xxnoelw.github.io';
  assert.equal(worker.originAllowed(allow, allow), true);
  assert.equal(worker.originAllowed('http://localhost:8000', allow), true);
  assert.equal(worker.originAllowed('http://127.0.0.1:5173', allow), true);
  assert.equal(worker.originAllowed('https://[::1]:8443', allow), true);
  assert.equal(worker.originAllowed('https://evil.example', allow), false);
  assert.equal(worker.originAllowed('https://xxnoelw.github.io.evil.com', allow), false);
  assert.equal(worker.originAllowed('null', allow), false);
});

test('accounts and sync round-trip, and a stale write returns the server copy', async () => {
  const db = memoryDb();
  const created = await call('/account', { method: 'POST', db });
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.match(body.code, /^[A-Z2-7]{26}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(created.headers.get('Access-Control-Allow-Origin'), 'https://xxnoelw.github.io');

  const denied = await call('/sync', { db });
  assert.equal(denied.status, 401);

  const saved = await call('/sync/chats', {
    method: 'PUT',
    db,
    code: body.code,
    body: { data: { chats: [{ id: 'c1' }] }, version: 0 },
  });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).version, 1);

  const stale = await call('/sync/chats', {
    method: 'PUT',
    db,
    code: body.code,
    body: { data: { chats: [] }, version: 0 },
  });
  assert.equal(stale.status, 409);
  const conflict = await stale.json();
  assert.equal(conflict.error, 'stale');
  assert.equal(conflict.version, 1);
  assert.match(conflict.data, /c1/);

  const next = await call('/sync/chats', {
    method: 'PUT',
    db,
    code: body.code,
    body: { data: { chats: [{ id: 'c1' }, { id: 'c2' }] }, version: 1 },
  });
  assert.equal(next.status, 200);

  const listed = await call('/sync', { db, code: body.code });
  const sync = await listed.json();
  assert.match(sync.chats.data, /c2/);
  assert.equal(sync.memory, null);

  const wrong = await call('/sync', { db, code: `${body.id}.${'b'.repeat(43)}` });
  assert.equal(wrong.status, 401);

  const huge = await call('/sync/settings', {
    method: 'PUT',
    db,
    code: body.code,
    body: { data: 'x'.repeat(1_000_001), version: 0 },
  });
  assert.equal(huge.status, 413);

  const removed = await call('/account', { method: 'DELETE', db, code: body.code });
  assert.equal(removed.status, 200);
  const gone = await call('/sync', { db, code: body.code });
  assert.equal(gone.status, 401);
});

test('a foreign origin is refused and health names no model', async () => {
  const blocked = await call('/health', { origin: 'https://evil.example' });
  assert.equal(blocked.status, 403);
  const health = await call('/health');
  const body = await health.json();
  assert.equal(body.ok, true);
  assert.equal(body.name, 'agora-cloud');
  assert.equal(body.models_available, undefined);
  const preflight = await call('/sync', { method: 'OPTIONS', origin: 'http://localhost:8000' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'http://localhost:8000');
});

test('the worker script has no model key, cron, or routine tables', () => {
  const source = readFileSync(new URL('../workers/agora-cloud/index.js', import.meta.url), 'utf8');
  const schema = readFileSync(new URL('../workers/agora-cloud/schema.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /OPENROUTER|scheduled\s*\(|google\/gemma|nvidia\/nemotron/i);
  assert.doesNotMatch(schema, /routines|routine_runs|OPENROUTER/i);
  assert.match(schema, /CREATE TABLE accounts/);
  assert.match(schema, /CREATE TABLE sync/);
});

test('the connector proxy defaults to the deployed worker', () => {
  store.resetPluginMemory(null);
  mem.delete('agora:plugins');
  assert.equal(store.pluginConfig().workerUrl, 'https://agora-connectors.knoel99-morcik.workers.dev');
  assert.equal(store.setWorkerUrl('https://example.com/proxy/'), 'https://example.com/proxy');
  assert.equal(store.setWorkerUrl(''), 'https://agora-connectors.knoel99-morcik.workers.dev');
  const ui = readFileSync(new URL('../js/plugin-ui.js', import.meta.url), 'utf8');
  assert.match(ui, /https:\/\/agora-connectors\.knoel99-morcik\.workers\.dev/);
  store.resetPluginMemory(null);
});

test('settings offer an account, a sync code, and no cloud chat toggle', async () => {
  const pages = await import('../js/pages.js');
  const html = pages.settingsHTML();
  assert.match(html, /Create account/);
  assert.match(html, /https:\/\/agora-cloud\.knoel99-morcik\.workers\.dev/);
  assert.match(html, /Link another device/);
  assert.doesNotMatch(html, /Cloud mode/);
  assert.doesNotMatch(html, /Run even when Agora is closed/);
  mem.set('agora:voice-lang', 'hu');
  const hungarian = pages.settingsHTML();
  assert.match(hungarian, /Fi\u00f3k l\u00e9trehoz\u00e1sa/);
  mem.delete('agora:voice-lang');
});

test('the sync QR keeps the finder patterns and does not embed the secret as text', () => {
  const matrix = qr.qrMatrix('HELLO');
  assert.equal(matrix.length, 21);
  const on = (row, col, pattern) => pattern.every((bits, r) => bits.every((bit, c) => matrix[row + r][col + c] === bit));
  const finder = [
    [1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 1, 1, 1, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 1, 1, 1, 1, 1, 1],
  ];
  assert.equal(on(0, 0, finder), true);
  assert.equal(on(0, matrix.length - 7, finder), true);
  assert.equal(on(matrix.length - 7, 0, finder), true);
  const svg = qr.qrSvg('HELLO');
  assert.match(svg, /<svg/);
  assert.doesNotMatch(svg, /HELLO/);
  const coded = qr.qrMatrix('A'.repeat(70));
  const digest = createHash('sha256').update(coded.map((row) => row.join('')).join('\n')).digest('hex');
  assert.equal(digest, '38ba71aec59bfaace68eeaa0404d8b78ab36b574355a24f322b699194b01db01');
});

test('the page stores the sync code and stops when the server copy is newer', async () => {
  const cloud = await import('../js/cloud.js');
  const seen = [];
  const fetchImpl = async (url, opts = {}) => {
    const path = new URL(url).pathname;
    seen.push(`${opts.method || 'GET'} ${path}`);
    const send = (data, status = 200) => ({
      ok: status >= 200 && status < 300,
      status,
      async text() { return JSON.stringify(data); },
    });
    if (path === '/account') {
      return send({ code: `${'A'.repeat(26)}.${'b'.repeat(43)}` }, 201);
    }
    if (opts.method === 'PUT' && path === '/sync/chats') {
      const body = JSON.parse(opts.body);
      if (body.version === 0) return send({ error: 'stale', kind: 'chats', data: '{"chats":[]}', version: 4, updated: 9 }, 409);
    }
    if (opts.method === 'PUT') return send({ version: 1, updated: 1 });
    return send({ chats: null, memory: null, settings: null });
  };
  cloud.clearCloudCode();
  const created = await cloud.createAccount('https://agora-cloud.knoel99-morcik.workers.dev', fetchImpl);
  assert.equal(created.ok, true);
  assert.match(cloud.cloudCode(), /^A{26}\.b{43}$/);
  assert.deepEqual(seen.slice(0, 4), ['POST /account', 'PUT /sync/settings', 'PUT /sync/memory', 'PUT /sync/chats']);
  assert.equal(cloud.syncConflict().kind, 'chats');
  assert.equal(cloud.syncConflict().version, 4);
  cloud.clearCloudCode();
});
