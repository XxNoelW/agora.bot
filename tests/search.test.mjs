import assert from 'node:assert/strict';
import { test } from 'node:test';

const mem = new Map();
globalThis.localStorage ??= {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};

const tools = await import('../js/tools.js');
const orch = await import('../js/orchestrator.js');

const DDG_SAMPLE = `
1.[How bees make honey](https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fhoney&rut=abc)
Bees dry nectar into honey.
example.com/honey

2.[Honey - Wikipedia](https://en.wikipedia.org/wiki/Honey)
A sweet food made by bees.
`;

test('questions ask for the web and greetings do not', () => {
  assert.equal(tools.needsWebSearch('hi'), false);
  assert.equal(tools.needsWebSearch('thanks'), false);
  assert.equal(tools.needsWebSearch('How do bees make honey?'), true);
  assert.equal(tools.needsWebSearch('What is the capital of France?'), true);
  assert.equal(tools.needsWebSearch('look up the height of Mount Everest'), true);
  assert.equal(tools.needsWebSearch('Write a short note'), false);
  assert.equal(tools.needsWebSearch('What is the date?'), false);
  assert.equal(tools.needsWebSearch('What time is it?'), false);
  assert.equal(tools.needsWebSearch('What is love?'), false);
  assert.equal(tools.needsWebSearch('What is 2+2?'), false);
});

test('the date comes from the visitor clock, not a web search', () => {
  const now = new Date('2026-11-12T18:59:00Z');
  const date = tools.localDateAnswer('What is the date?', now, 'UTC');
  assert.match(date, /Thursday, November 12, 2026/);
  assert.doesNotMatch(date, /not provided/i);
  const time = tools.localDateAnswer('What time is it?', now, 'UTC');
  assert.match(time, /6:59/);
  assert.match(time, /UTC/);
  assert.equal(tools.localDateAnswer('How do bees make honey?', now, 'UTC'), '');
  assert.equal(tools.isDateTimeQuestion('What is the date of the French Revolution?'), false);
});

test('search queries drop question words and irrelevant pages', () => {
  assert.equal(tools.searchQuery('How do bees make honey?'), 'How do bees make honey');
  assert.equal(tools.searchQuery('What is the capital of France?'), 'capital of France');
  const junk = [
    { title: 'What Is the What', url: 'https://en.wikipedia.org/wiki/What_Is_the_What', snippet: 'A novel by Dave Eggers.' },
    { title: 'What Is Life?', url: 'https://en.wikipedia.org/wiki/What_Is_Life', snippet: 'A science book.' },
    { title: 'What Is Love', url: 'https://en.wikipedia.org/wiki/What_Is_Love', snippet: 'A song.' },
    { title: 'Dating', url: 'https://en.wikipedia.org/wiki/Dating', snippet: 'Romantic dating.' },
    { title: 'Time and Date', url: 'https://www.timeanddate.com/', snippet: 'Clock and calendar tools.' },
  ];
  assert.deepEqual(tools.relevantSources('bees make honey', junk), []);
  const honey = [
    { title: 'Honey', url: 'https://en.wikipedia.org/wiki/Honey', snippet: 'Bees make honey from nectar.' },
    { title: 'What Is Life?', url: 'https://en.wikipedia.org/wiki/What_Is_Life', snippet: 'A science book.' },
  ];
  assert.deepEqual(tools.relevantSources('How do bees make honey?', honey).map((item) => item.title), ['Honey']);
  const france = [
    { title: 'Paris', url: 'https://en.wikipedia.org/wiki/Paris', snippet: 'Paris is the capital of France.' },
    { title: 'What Is the What', url: 'https://en.wikipedia.org/wiki/What_Is_the_What', snippet: 'A novel.' },
  ];
  assert.deepEqual(tools.relevantSources('What is the capital of France?', france).map((item) => item.title), ['Paris']);
  const wrongCapital = [
    { title: 'List of capitals of France', url: 'https://en.wikipedia.org/wiki/List_of_capitals_of_France', snippet: 'The capital of France has been Paris since 1944.' },
    { title: 'Capital punishment in France', url: 'https://en.wikipedia.org/wiki/Capital_punishment_in_France', snippet: 'Capital punishment in France is banned.' },
    { title: 'Capital (French magazine)', url: 'https://en.wikipedia.org/wiki/Capital_(French_magazine)', snippet: 'Capital is a monthly French economics magazine published in Paris, France.' },
    { title: 'Bees Make Honey', url: 'https://en.wikipedia.org/wiki/Bees_Make_Honey', snippet: 'Bees Make Honey may refer to a band or a film.' },
  ];
  assert.deepEqual(tools.relevantSources('What is the capital of France?', wrongCapital).map((item) => item.title), ['List of capitals of France']);
  assert.deepEqual(tools.relevantSources('How do bees make honey?', wrongCapital), []);
});

test('only sources named in the answer are kept', () => {
  const pages = [
    { title: 'Honey', url: 'https://en.wikipedia.org/wiki/Honey', snippet: 'Bees make honey.' },
    { title: 'Dating', url: 'https://en.wikipedia.org/wiki/Dating', snippet: 'Romance.' },
  ];
  assert.deepEqual(tools.sourcesUsed('Bees make honey.', pages), []);
  assert.equal(tools.ensureCited('Bees make honey.', pages), 'Bees make honey.');
  const used = tools.sourcesUsed('See [Honey](https://en.wikipedia.org/wiki/Honey).', pages);
  assert.deepEqual(used.map((item) => item.title), ['Honey']);
});

test('the answer prompt includes the visitor clock', () => {
  const agent = { id: 'ada', name: 'Ada', prompt: 'You are Ada, a helper.', tools: ['web_search'] };
  const conv = { agentIds: ['ada'], messages: [{ role: 'user', content: 'What is the date?' }] };
  const line = tools.clockPrompt(new Date('2026-11-12T18:59:00Z'), 'UTC');
  const messages = orch.buildMessages(agent, conv, { clockLine: line });
  assert.match(messages[0].content, /November 12, 2026/);
  assert.match(messages[0].content, /not provided/);
  assert.match(messages[0].content, /stay on that topic/i);
});

test('a failed reply can be tried again, and a stop cannot', () => {
  assert.equal(orch.shouldRetry({ code: 'timeout' }), true);
  assert.equal(orch.shouldRetry({ code: 'network' }), true);
  assert.equal(orch.shouldRetry({ code: 'abort' }), false);
  assert.equal(orch.shouldRetry({ code: 'limit' }), false);
  assert.equal(orch.shouldRetry({ name: 'AbortError' }), false);
});

test('search text keeps real links for the answer', () => {
  const parsed = tools.parseDdgLite(DDG_SAMPLE);
  const text = tools.formatSources(parsed);
  const sources = tools.extractSources(text);
  assert.equal(sources[0].url, 'https://example.com/honey');
  assert.match(tools.answerFromSources(parsed), /https:\/\/example\.com\/honey/);
  assert.equal(tools.ensureCited('Bees dry nectar.', parsed), 'Bees dry nectar.');
  assert.equal(tools.sourcesUsed('See https://example.com/honey', [parsed[0]]).length, 1);
});

test('gatherSources reads Wikipedia and DuckDuckGo payloads', async () => {
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes('rest.php')) {
      return { ok: true, text: async () => JSON.stringify({ pages: [{ title: 'Honey', key: 'Honey', excerpt: 'Bees make honey from nectar.' }] }) };
    }
    if (target.includes('api.duckduckgo.com')) {
      return {
        ok: true,
        text: async () => JSON.stringify({
          Heading: 'Honey',
          AbstractText: 'Honey is made by bees.',
          AbstractURL: 'https://en.wikipedia.org/wiki/Honey',
          AbstractSource: 'Wikipedia',
          RelatedTopics: [],
        }),
      };
    }
    if (target.includes('r.jina.ai')) return { ok: true, text: async () => DDG_SAMPLE };
    return { ok: true, text: async () => JSON.stringify({ query: { pages: {} } }) };
  };
  const found = await tools.gatherSources('how do bees make honey', { fetch: fetchImpl });
  assert.ok(found.results.length >= 2);
  assert.ok(found.results.every((item) => /^https?:\/\//.test(item.url) && item.title));
  assert.match(tools.answerFromSources(found.results), /https:\/\/en\.wikipedia\.org\/wiki\/Honey/);
  assert.match(await tools.webSearch('bees', { fetch: fetchImpl }), /https?:\/\/\S+/);
});

test('a live web search returns real pages and links', { timeout: 40000 }, async () => {
  const found = await tools.gatherSources('how do bees make honey');
  assert.ok(found.results.length >= 1);
  for (const item of found.results) {
    assert.match(item.url, /^https?:\/\//);
    assert.ok(item.title);
  }
  const text = tools.formatSources(found.results, found.note);
  assert.match(text, /https?:\/\/\S+/);
  assert.match(text, /honey|bee/i);
});
