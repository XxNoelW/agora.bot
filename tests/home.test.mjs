import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};

const memory = await import('../js/memory.js');
const routines = await import('../js/routines.js');
const feedback = await import('../js/feedback.js');
const files = await import('../js/attachments.js');
const shell = await import('../js/shell-cache.js');

test('remember and forget keep a short prompt', async () => {
  const named = memory.parseMemoryCommand('My name is Kiss');
  assert.equal(named.kind, 'name');
  assert.equal(named.text, 'Kiss');
  let list = memory.upsertMemory([], named);
  list = memory.upsertMemory(list, { text: 'likes short answers', kind: 'fact' });
  list = memory.upsertMemory(list, { text: 'lives in Budapest', kind: 'fact' });
  const block = memory.memoryBlock('What should I know about Budapest?', list, true);
  assert.match(block, /Kiss/);
  assert.match(block, /Budapest/);
  assert.ok(block.length < 500);
  assert.equal(memory.memoryBlock('hello', list, false), '');

  const gone = memory.forgetMemories(list, 'Budapest');
  assert.equal(gone.removed.length, 1);
  assert.equal(memory.forgetMemories(list, 'everything').list.length, 0);

  const hu = memory.parseMemoryCommand('Emlékezz arra, hogy szeretem a teát');
  assert.equal(hu.lang, 'hu');
  assert.match(hu.text, /teát/);
  const saved = await memory.applyMemoryCommand(hu);
  assert.match(saved, /Megjegyeztem/);
});

test('routines parse English and Hungarian and catch up once', () => {
  const daily = routines.parseRoutine('every morning at 8 tell me the weather');
  assert.equal(daily.kind, 'daily');
  assert.equal(daily.hour, 8);
  assert.match(daily.text, /weather/);
  const after = new Date(2026, 0, 1, 9, 0, 0).getTime();
  const next = routines.nextRun(daily, after);
  assert.equal(new Date(next).getDate(), 2);
  assert.equal(new Date(next).getHours(), 8);
  const before = new Date(2026, 0, 1, 7, 0, 0).getTime();
  assert.equal(new Date(routines.nextRun(daily, before)).getDate(), 1);

  const weekly = routines.parseRoutine('remind me Friday 5pm to stretch');
  assert.equal(weekly.kind, 'weekly');
  assert.equal(weekly.weekday, 5);
  assert.equal(weekly.hour, 17);
  assert.match(weekly.text, /stretch/);

  const hu = routines.parseRoutine('emlékeztess pénteken 17:00-kor hívjam fel Annát');
  assert.equal(hu.kind, 'weekly');
  assert.equal(hu.weekday, 5);
  assert.equal(hu.hour, 17);
  assert.equal(hu.lang, 'hu');

  const morning = routines.parseRoutine('minden reggel 8-kor mondd meg az időjárást');
  assert.equal(morning.kind, 'daily');
  assert.equal(morning.hour, 8);
  assert.match(morning.text, /időjárást/);

  const late = routines.dueRoutines(after, [{ id: 'a', enabled: true, nextAt: before, text: 'stretch', kind: 'daily', hour: 8, minute: 0 }]);
  assert.equal(late.length, 1);
});

test('feedback export is local JSONL and does not include a destination', () => {
  const chat = {
    id: 'c1',
    messages: [
      { id: 'u1', role: 'user', content: 'How do bees make honey?' },
      { id: 'a1', role: 'agent', content: 'Bees dry nectar into honey.' },
    ],
  };
  const record = feedback.feedbackRecord(chat, chat.messages[1], 'up', 'clear');
  const line = feedback.toJSONL([record]).trim();
  const parsed = JSON.parse(line);
  assert.equal(parsed.rating, 'up');
  assert.equal(parsed.comment, 'clear');
  assert.equal(parsed.answer, 'Bees dry nectar into honey.');
  assert.equal(parsed.messages[0].role, 'user');
  assert.equal(parsed.messages[0].content, 'How do bees make honey?');
  assert.doesNotMatch(line, /https?:\/\//);
});

test('simple PDF text can be read and the shell cache ignores model hosts', async () => {
  const bytes = new TextEncoder().encode('BT /F1 12 Tf (Hello Agora) Tj ET');
  assert.match(files.textFromPdfBytes(bytes), /Hello Agora/);
  const origin = 'https://xxnoelw.github.io';
  assert.equal(shell.shouldCache(`${origin}/agora.bot/css/style.css`, origin), true);
  assert.equal(shell.shouldCache(`${origin}/agora.bot/`, origin), true);
  assert.equal(shell.shouldCache('https://huggingface.co/XxNoelW/Agora-1.0/resolve/main/mlc-chat-config.json', origin), false);
  assert.equal(shell.shouldCache('https://esm.run/@mlc-ai/web-llm@0.2.87', origin), false);
  assert.equal(shell.shouldCache('https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/lib.wasm', origin), false);
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /agora-shell-/);
  assert.match(sw, /shouldCache/);
});
