import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const worker = await import('../workers/agora-cloud/index.js');

function publicDb() {
  const usage = new Map();
  const shares = new Map();
  const stats = new Map();
  const feedback = new Map();
  return {
    prepare(sql) {
      const params = [];
      const api = {
        bind(...args) {
          params.splice(0, params.length, ...args);
          return api;
        },
        async first() {
          if (sql.startsWith('SELECT syncs FROM usage')) return usage.get(`${params[0]}:${params[1]}`) || null;
          if (sql.startsWith('SELECT id, data, created FROM shares')) return shares.get(params[0]) || null;
          return null;
        },
        async all() {
          if (sql.includes('FROM stats')) {
            const results = [...stats.values()].filter((row) => row.day >= params[0]);
            results.sort((a, b) => a.day.localeCompare(b.day) || a.type.localeCompare(b.type));
            return { results };
          }
          if (sql.includes('FROM feedback')) {
            const results = [...feedback.values()].filter((row) => Number(row.created) >= Number(params[0]));
            results.sort((a, b) => a.created - b.created);
            return { results };
          }
          return { results: [] };
        },
        async run() {
          if (sql.startsWith('INSERT INTO usage')) {
            const key = `${params[0]}:${params[1]}`;
            const row = usage.get(key) || { account_id: params[0], day: params[1], syncs: 0 };
            row.syncs += 1;
            usage.set(key, row);
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith('INSERT INTO shares')) {
            shares.set(params[0], { id: params[0], data: params[1], created: params[2] });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith('INSERT INTO stats')) {
            const key = `${params[0]}:${params[1]}:${params[2]}`;
            const row = stats.get(key) || { day: params[0], type: params[1], key: params[2], count: 0 };
            row.count += 1;
            stats.set(key, row);
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith('INSERT INTO feedback')) {
            feedback.set(params[0], {
              id: params[0],
              created: params[1],
              rating: params[2],
              lang: params[3],
              data: params[4],
              used: 0,
            });
            return { meta: { changes: 1 } };
          }
          throw new Error(`unexpected sql ${sql}`);
        },
      };
      return api;
    },
  };
}

test('a share round-trips without an account and stays under the cap', async () => {
  const db = publicDb();
  const env = { DB: db, ALLOWED_ORIGIN: 'https://xxnoelw.github.io' };
  const created = await worker.handleRequest(new Request('https://agora-cloud.example/share', {
    method: 'POST',
    headers: { Origin: 'https://xxnoelw.github.io', 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.8' },
    body: JSON.stringify({
      title: 'Bees',
      messages: [{ role: 'user', content: 'How do bees make honey?' }, { role: 'assistant', name: 'Ada', content: 'They dry nectar.' }],
    }),
  }), env);
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.match(body.id, /^[A-Z2-7]{16}$/);
  const loaded = await worker.handleRequest(new Request(`https://agora-cloud.example/share/${body.id.toLowerCase()}`, {
    headers: { Origin: 'http://localhost:8000' },
  }), env);
  assert.equal(loaded.status, 200);
  const snap = await loaded.json();
  assert.equal(snap.title, 'Bees');
  assert.equal(snap.messages[1].content, 'They dry nectar.');
  assert.equal(snap.ip, undefined);
  const missing = await worker.handleRequest(new Request('https://agora-cloud.example/share/AAAAAAAAAAAAAAAA', {
    headers: { Origin: 'https://xxnoelw.github.io' },
  }), env);
  assert.equal(missing.status, 404);
});

test('shares are limited per network and an empty chat is refused', async () => {
  const db = publicDb();
  const env = { DB: db, ALLOWED_ORIGIN: 'https://xxnoelw.github.io' };
  const post = (ip) => worker.handleRequest(new Request('https://agora-cloud.example/share', {
    method: 'POST',
    headers: { Origin: 'https://xxnoelw.github.io', 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify({ title: 'Chat', messages: [{ role: 'user', content: 'Hello' }] }),
  }), env);
  for (let i = 0; i < worker.SHARE_DAILY_LIMIT; i += 1) assert.equal((await post('198.51.100.4')).status, 201);
  assert.equal((await post('198.51.100.4')).status, 429);
  assert.equal((await post('198.51.100.5')).status, 201);
  const empty = await worker.handleRequest(new Request('https://agora-cloud.example/share', {
    method: 'POST',
    headers: { Origin: 'https://xxnoelw.github.io', 'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.9' },
    body: JSON.stringify({ title: 'Empty', messages: [] }),
  }), env);
  assert.equal(empty.status, 400);
  const huge = worker.fitShare({ title: 'Big', messages: [{ role: 'user', content: 'x'.repeat(300_000) }] });
  assert.ok(huge.bytes <= worker.SHARE_MAX_BYTES);
});

test('events become 30-day aggregates and do not keep an address', async () => {
  const db = publicDb();
  const env = { DB: db, ALLOWED_ORIGIN: 'https://xxnoelw.github.io' };
  const send = (body) => worker.handleRequest(new Request('https://agora-cloud.example/event', {
    method: 'POST',
    headers: { Origin: 'https://xxnoelw.github.io', 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.20' },
    body: JSON.stringify(body),
  }), env);
  assert.equal((await send({ type: 'visit' })).status, 202);
  assert.equal((await send({ type: 'visit' })).status, 202);
  assert.equal((await send({ type: 'tool', tool: 'web_search' })).status, 202);
  assert.equal((await send({ type: 'tool', tool: 'not a tool' })).status, 202);
  assert.equal((await send({ type: 'nope' })).status, 400);
  const stats = await worker.handleRequest(new Request('https://agora-cloud.example/stats', {
    headers: { Origin: 'https://xxnoelw.github.io' },
  }), env);
  const body = await stats.json();
  assert.equal(body.days, 30);
  assert.equal(body.totals.visit, 2);
  assert.equal(body.totals.tool, 2);
  const search = body.rows.find((row) => row.key === 'web_search');
  assert.equal(search.count, 1);
  assert.equal(body.rows.some((row) => row.key === 'other'), true);
  assert.doesNotMatch(JSON.stringify(body), /203\.0\.113|cookie|ip/i);
});

test('training notes drop emails and phones, and export needs the secret', async () => {
  const db = publicDb();
  const base = { DB: db, ALLOWED_ORIGIN: 'https://xxnoelw.github.io' };
  const saved = await worker.handleRequest(new Request('https://agora-cloud.example/feedback', {
    method: 'POST',
    headers: { Origin: 'https://xxnoelw.github.io', 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.30' },
    body: JSON.stringify({
      rating: 'down',
      lang: 'hu',
      messages: [
        { role: 'user', content: 'Email ada@example.com or call +36 30 123 4567 on 2026-11-28' },
        { role: 'assistant', content: 'I will not repeat that.' },
      ],
    }),
  }), base);
  assert.equal(saved.status, 201);
  const locked = await worker.handleRequest(new Request('https://agora-cloud.example/feedback/export', {
    headers: { Origin: 'https://xxnoelw.github.io' },
  }), base);
  assert.equal(locked.status, 403);
  const wrong = await worker.handleRequest(new Request('https://agora-cloud.example/feedback/export', {
    headers: { Origin: 'https://xxnoelw.github.io', 'x-export-key': 'nope' },
  }), { ...base, EXPORT_KEY: 'correct-horse' });
  assert.equal(wrong.status, 403);
  const opened = await worker.handleRequest(new Request('https://agora-cloud.example/feedback/export?since=1', {
    headers: { Origin: 'https://xxnoelw.github.io', 'x-export-key': 'correct-horse' },
  }), { ...base, EXPORT_KEY: 'correct-horse' });
  assert.equal(opened.status, 200);
  const body = await opened.json();
  assert.equal(body.rows.length, 1);
  assert.equal(body.rows[0].rating, -1);
  assert.equal(body.rows[0].lang, 'hu');
  assert.match(body.rows[0].messages[0].content, /\[email\]/);
  assert.match(body.rows[0].messages[0].content, /\[phone\]/);
  assert.match(body.rows[0].messages[0].content, /2026-11-28/);
  assert.doesNotMatch(JSON.stringify(body), /ada@example\.com|\+36 30/);
});

test('the schema and migration add the public tables without a secret', () => {
  const schema = readFileSync(new URL('../workers/agora-cloud/schema.sql', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../workers/agora-cloud/migrations/002_shares_stats_feedback.sql', import.meta.url), 'utf8');
  for (const file of [schema, migration]) {
    assert.match(file, /CREATE TABLE IF NOT EXISTS shares/);
    assert.match(file, /CREATE TABLE IF NOT EXISTS stats/);
    assert.match(file, /CREATE TABLE IF NOT EXISTS feedback/);
  }
  assert.doesNotMatch(schema, /EXPORT_KEY|STATS_KEY|sk-/);
  assert.doesNotMatch(readFileSync(new URL('../workers/agora-cloud/index.js', import.meta.url), 'utf8'), /EXPORT_KEY\s*=\s*['"][^'"]+['"]/);
});
