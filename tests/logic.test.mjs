import assert from 'node:assert/strict';
import { test } from 'node:test';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};

const tools = await import('../js/tools.js');
const store = await import('../js/store.js');
const orch = await import('../js/orchestrator.js');
const llm = await import('../js/llm.js');

const DDG_SAMPLE = `
1.[How bees make honey](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fhoney&rut=abc)
Bees dry nectar into honey.
example.com/honey

2.[Honey - Wikipedia](https://en.wikipedia.org/wiki/Honey)
A sweet food made by bees.
`;

test('webllm import is pinned to the checked release', () => {
  assert.equal(llm.WEBLLM_VERSION, '0.2.87');
  assert.equal(llm.WEBLLM_URL, 'https://esm.run/@mlc-ai/web-llm@0.2.87');
});

test('default model ids are the verified prebuilt ids', () => {
  for (const id of [store.DEFAULT_MODEL, store.MEDIUM_MODEL, store.FALLBACK_MODEL]) {
    assert.match(id, /-MLC$/);
  }
  assert.equal(store.DEFAULT_MODEL, 'Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC');
  assert.equal(store.FALLBACK_MODEL, 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC');
  assert.equal(store.MODELS[0].id, store.DEFAULT_MODEL);
  assert.ok(store.MODELS.some((m) => m.id === store.FALLBACK_MODEL));
});

test('withTimeout rejects instead of hanging', async () => {
  await assert.rejects(
    llm.withTimeout(new Promise(() => {}), 30, 'Too slow'),
    (err) => err.friendly === 'Too slow' && err.code === 'timeout',
  );
});

test('load progress text is plain language', () => {
  assert.match(llm.friendlyLoadText('Fetching params 10/100', 0.1), /Downloading the helper \(10%\)/);
  assert.match(llm.friendlyLoadText('Loading model from cache', 0.4), /saved helper/);
});

test('legacy default model upgrades once, then a chosen small helper stays', () => {
  const upgraded = store.migrateState({
    settings: { model: store.LEGACY_DEFAULT_MODEL, rounds: 2, temperature: 0.7, maxTokens: 512 },
    agents: [],
    chats: [{ id: 'c', type: 'group', agentIds: [], messages: [{ role: 'agent', pending: true, content: '' }] }],
  });
  assert.equal(upgraded.settings.model, store.DEFAULT_MODEL);
  assert.equal(upgraded.settings.modelMigrated, true);
  assert.equal(upgraded.chats[0].messages[0].pending, false);
  assert.match(upgraded.chats[0].messages[0].content, /interrupted/);

  const kept = store.migrateState({
    settings: { model: store.FALLBACK_MODEL, modelMigrated: true },
    agents: [],
    chats: [],
  });
  assert.equal(kept.settings.model, store.FALLBACK_MODEL);

  const unknown = store.migrateState({
    settings: { model: 'not-a-real-model', modelMigrated: true },
    agents: [],
    chats: [],
  });
  assert.equal(unknown.settings.model, store.DEFAULT_MODEL);
});

test('old demo friend prompts become plain language', () => {
  const next = store.migrateState({
    settings: { modelMigrated: true, model: store.DEFAULT_MODEL },
    agents: [{ id: 'a', name: 'Ada', prompt: 'You are Ada, a thoughtful analyst. You reason carefully, are concise, and like to use tools to check facts.' }],
    chats: [],
  });
  assert.match(next.agents[0].prompt, /kind and careful/);
});

test('parseToolCall accepts the formats small models actually emit', () => {
  const parsed = tools.parseToolCall('TOOL: web_search {"query":"how do bees make honey"}');
  assert.equal(parsed.name, 'web_search');
  assert.equal(parsed.args.query, 'how do bees make honey');

  const bare = tools.parseToolCall('Sure!\nTOOL web_search how do bees make honey');
  assert.equal(bare.name, 'web_search');
  assert.equal(bare.args.query, 'how do bees make honey');

  const quotes = tools.parseToolCall("TOOL: web_search {'query':'bees'}");
  assert.equal(quotes.args.query, 'bees');

  const fenced = tools.parseToolCall('```tool\nTOOL: read_page {"url":"https://en.wikipedia.org/wiki/Bee"}\n```');
  assert.equal(fenced.name, 'read_page');
  assert.equal(fenced.args.url, 'https://en.wikipedia.org/wiki/Bee');

  const fn = tools.parseToolCall('web_search("bees and honey")');
  assert.equal(fn.args.query, 'bees and honey');

  const envelope = tools.parseToolCall('{"name":"web_search","arguments":{"query":"mars"}}');
  assert.equal(envelope.args.query, 'mars');

  const wiki = tools.parseToolCall('TOOL: wiki {"title":"Honey"}');
  assert.equal(wiki.name, 'read_page');
  assert.equal(wiki.args.title, 'Honey');

  assert.equal(tools.parseToolCall('NONE'), null);
  assert.equal(tools.parseToolCall('I can just say hello.'), null);
  assert.equal(tools.parseToolCall('a tool for measuring flour'), null);

  const broken = tools.parseToolCall('TOOL: web_search {query:');
  assert.equal(broken.name, 'web_search');
  assert.equal(broken.args, null);
});

test('duckduckgo reader results keep real links', () => {
  const results = tools.parseDdgLite(DDG_SAMPLE);
  assert.equal(results[0].url, 'https://example.com/honey');
  assert.match(results[0].snippet, /nectar/);
  assert.equal(results[1].url, 'https://en.wikipedia.org/wiki/Honey');
  assert.deepEqual(tools.parseDdgLite('Please complete the following challenge. Select all squares containing a duck'), []);
  const text = tools.formatSources(results);
  assert.match(text, /https:\/\/example.com\/honey/);
});

test('page links stay public http(s)', () => {
  assert.equal(tools.assertPublicHttpUrl('https://en.wikipedia.org/wiki/Bee'), 'https://en.wikipedia.org/wiki/Bee');
  assert.throws(() => tools.assertPublicHttpUrl('http://localhost/secret'), /private/);
  assert.throws(() => tools.assertPublicHttpUrl('http://127.0.0.1/'), /private/);
  assert.throws(() => tools.assertPublicHttpUrl('file:///etc/passwd'), /http/);
  assert.throws(() => tools.assertPublicHttpUrl('http://10.0.0.5/admin'), /private/);
});

test('note paths cannot climb out of the folder', () => {
  assert.equal(tools.normPath('notes.txt'), '/notes.txt');
  assert.equal(tools.normPath('/a/../../b'), '/b');
  assert.equal(tools.normPath('/'), '/');
});

test('greetings skip tools and pass lines are dropped', () => {
  assert.equal(orch.isSmallTalk('hi'), true);
  assert.equal(orch.isSmallTalk('Hello!'), true);
  assert.equal(orch.isSmallTalk('How do bees make honey?'), false);
  assert.equal(orch.isPass('PASS'), true);
  assert.equal(orch.isPass('I agree with Ada.'), false);
  assert.equal(orch.cleanReply('<think>secret</think>Ada: Hello!\nUser: ignored', 'Ada'), 'Hello!');
});

test('a stalled reply does not stay pending', () => {
  const messages = [
    { pending: true, content: '', answered: false },
    { pending: true, content: 'Half a reply', answered: true },
    { pending: false, content: 'Done', answered: true },
  ];
  orch.settlePending(messages, { aborted: true });
  assert.equal(messages[0].pending, false);
  assert.equal(messages[0].content, 'Stopped.');
  assert.equal(messages[1].content, 'Half a reply');
  assert.equal(messages[2].content, 'Done');
});

test('friends in the same wave cannot see each other yet', () => {
  const self = { id: 'self', agentId: 'ada', wave: 'w1', pending: true, role: 'agent' };
  const messages = [
    { role: 'user', content: 'hi', agentId: null },
    self,
    { role: 'agent', agentId: 'max', wave: 'w1', pending: true, content: '' },
    { role: 'tool', agentId: 'max', wave: 'w1', content: 'hidden' },
    { role: 'agent', agentId: 'max', wave: 'w0', content: 'earlier' },
    { role: 'tool', agentId: 'ada', wave: 'w1', content: 'own lookup' },
  ];
  const visible = orch.visibleMessages('ada', messages, self);
  assert.deepEqual(visible.map((m) => m.content), ['hi', 'earlier', 'own lookup']);
});

test('web search returns source links', async () => {
  const text = await tools.webSearch('how do bees make honey');
  assert.match(text, /https?:\/\/\S+/);
  assert.match(text, /bee|honey/i);
});

test('wikipedia pages can be read without a key', async () => {
  const text = await tools.readPage({ url: 'https://en.wikipedia.org/wiki/Honey' });
  assert.match(text, /Title: Honey/);
  assert.match(text, /https:\/\/en\.wikipedia\.org\/wiki\/Honey/);
  assert.match(text, /bee/i);
});
