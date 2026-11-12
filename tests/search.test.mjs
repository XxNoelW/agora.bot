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
  assert.match(tools.ensureCited('Bees dry nectar.', parsed), /Sources:/);
  assert.match(tools.ensureCited('See https://example.com/honey', [parsed[0]]), /See https:\/\/example.com\/honey/);
  assert.doesNotMatch(tools.ensureCited('See https://example.com/honey', [parsed[0]]), /Sources:/);
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
