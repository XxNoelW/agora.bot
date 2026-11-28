import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};
globalThis.sessionStorage = globalThis.localStorage;

const catalog = JSON.parse(readFileSync(new URL('../data/plugins.json', import.meta.url), 'utf8'));
const { setCatalog } = await import('../js/plugin-catalog.js');
setCatalog(catalog);
const local = await import('../js/plugin-local.js');
const http = await import('../js/plugin-http.js');
const mcp = await import('../js/mcp-client.js');
const run = await import('../js/plugin-run.js');
const allow = await import('../workers/agora-connectors/src/allow.js');
await import('../js/plugin-ui.js');

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    async text() { return JSON.stringify(data); },
    async json() { return data; },
  };
}

test('the catalog is a curated set of real connectors', () => {
  assert.ok(catalog.length >= 80 && catalog.length <= 120, `expected 80-120 plugins, got ${catalog.length}`);
  assert.equal(catalog.some((plugin) => plugin.id === 'wiki-zh'), false);
  assert.equal(catalog.filter((plugin) => plugin.id === 'wikipedia').length, 1);
  const ids = new Set();
  const tools = new Set();
  for (const plugin of catalog) {
    assert.equal(ids.has(plugin.id), false, plugin.id);
    ids.add(plugin.id);
    assert.ok(plugin.name && plugin.summary && plugin.category && plugin.icon, plugin.id);
    assert.ok(plugin.homepage.startsWith('https://'), plugin.id);
    assert.ok(['none', 'key', 'signin', 'proxy'].includes(plugin.needs), plugin.id);
    if (plugin.needs === 'key' || plugin.needs === 'signin') {
      assert.match(plugin.summary, /key|sign-in|token/i, plugin.id);
    }
    for (const tool of plugin.tools || []) {
      assert.equal(tools.has(tool.name), false, tool.name);
      tools.add(tool.name);
    }
    if (plugin.via === 'proxy') {
      const host = new URL(plugin.tools[0].get).host;
      assert.equal(allow.FETCH_HOSTS.has(host), true, host);
    }
    if (plugin.transport === 'mcp') {
      assert.ok(plugin.mcp.startsWith('https://'), plugin.id);
      if (plugin.cors === false) assert.equal(allow.MCP_HOSTS.has(new URL(plugin.mcp).host), true, plugin.mcp);
    }
  }
  assert.equal(JSON.stringify(catalog).includes('github_pat_'), false);
  assert.ok(catalog.some((plugin) => plugin.id === 'weather' && plugin.tools.some((tool) => tool.name === 'weather_now')));
  assert.ok(catalog.some((plugin) => plugin.id === 'wikipedia' && plugin.tools.some((tool) => tool.name === 'wiki_en_search')));
  assert.ok(catalog.some((plugin) => plugin.id === 'mcp-deepwiki' && plugin.needs === 'none'));
  assert.ok(catalog.some((plugin) => plugin.id === 'mcp-github' && plugin.needs === 'signin'));
  assert.ok(catalog.some((plugin) => plugin.id === 'mcp-slack' && plugin.cors === false));
});

test('local calculator, units, and clock do not use the network', async () => {
  assert.equal(await local.LOCAL_TOOLS.calculate({ expression: '(2+3)*4' }), '20');
  assert.equal(await local.LOCAL_TOOLS.calculate({ expression: '2^3' }), '8');
  assert.match(await local.LOCAL_TOOLS.convert_units({ amount: 2, from: 'km', to: 'm' }), /2000/);
  assert.match(await local.LOCAL_TOOLS.time_now(), /\d/);
  await assert.rejects(() => local.LOCAL_TOOLS.calculate({ expression: 'alert(1)' }), /numbers/);
});

test('weather for a city calls geocoding and then the forecast', async () => {
  const plugin = catalog.find((item) => item.id === 'weather');
  const seen = [];
  const text = await http.runHttpTool(plugin, plugin.tools[0], { city: 'Paris' }, {
    fetchImpl: async (url) => {
      seen.push(String(url));
      if (String(url).includes('geocoding-api')) {
        return jsonResponse({ results: [{ latitude: 48.86, longitude: 2.35, name: 'Paris' }] });
      }
      return jsonResponse({ current: { temperature_2m: 12.5, weather_code: 2, wind_speed_10m: 8 }, timezone: 'Europe/Paris' });
    },
  });
  assert.equal(seen.length, 2);
  assert.match(seen[1], /latitude=48\.86/);
  assert.match(text, /12\.5/);
  assert.doesNotMatch(text, /Signed in/);
});

test('a clear weather question selects the weather tool', () => {
  const intent = run.matchPluginIntent('What is the weather in Paris?');
  assert.equal(intent.name, 'weather_now');
  assert.match(intent.args.city, /Paris/);
  assert.equal(run.matchPluginIntent('List my github sites'), null);
  const prompt = run.pluginToolPrompt('weather in Lisbon');
  assert.match(prompt, /TOOL: weather_now/);
});

test('MCP responses can be JSON or an event stream', () => {
  const sse = mcp.parseMcpPayload('event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"ask_question"}]}}\n\n', 'text/event-stream');
  assert.equal(sse.result.tools[0].name, 'ask_question');
  const plain = mcp.parseMcpPayload('{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18"}}', 'application/json');
  assert.equal(plain.result.protocolVersion, '2025-06-18');
});

test('OAuth sign-in uses PKCE and does not put the verifier in the URL', async () => {
  const storage = new Map();
  const bag = {
    getItem: (k) => storage.get(k) || null,
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  };
  let opened = '';
  await mcp.beginMcpOauth({ id: 'mcp-linear', mcp: 'https://mcp.linear.app/mcp' }, {
    storage: bag,
    assign: (url) => { opened = url; },
    fetchImpl: async (url) => {
      const href = String(url);
      if (href.includes('oauth-protected-resource')) {
        return jsonResponse({ authorization_servers: ['https://linear.app'] });
      }
      if (href.includes('oauth-authorization-server')) {
        return jsonResponse({
          authorization_endpoint: 'https://linear.app/oauth/authorize',
          token_endpoint: 'https://linear.app/oauth/token',
          registration_endpoint: 'https://linear.app/oauth/register',
        });
      }
      return jsonResponse({ client_id: 'agora-public' });
    },
  });
  assert.match(opened, /code_challenge=/);
  assert.match(opened, /code_challenge_method=S256/);
  assert.equal(opened.includes('code_verifier'), false);
  assert.match(JSON.parse(bag.getItem('agora:mcp-oauth')).verifier, /./);
});

test('the worker refuses hosts that are not on the list and answers MCP initialize', async () => {
  const worker = await import('../workers/agora-connectors/src/index.js');
  const health = await worker.default.fetch(new Request('https://agora.example/health'));
  assert.equal((await health.json()).ok, true);
  const blocked = await worker.default.fetch(new Request('https://agora.example/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'http://127.0.0.1/secret' }),
  }));
  assert.equal(blocked.status, 403);
  const init = await worker.default.fetch(new Request('https://agora.example/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
  }));
  const body = await init.json();
  assert.equal(body.result.serverInfo.name, 'agora-connectors');
  assert.equal(body.result.protocolVersion, '2025-06-18');
});

test('client connectors answer from the network', async () => {
  const money = catalog.find((item) => item.id === 'currency');
  const rate = await http.runHttpTool(money, money.tools[0], { from: 'USD', to: 'EUR' });
  assert.match(rate, /EUR/);

  const weather = catalog.find((item) => item.id === 'weather');
  const sky = await http.runHttpTool(weather, weather.tools[0], { city: 'Lisbon' });
  assert.match(sky, /Weather/);
});

test('DeepWiki lists tools over Streamable HTTP', async () => {
  const plugin = catalog.find((item) => item.id === 'mcp-deepwiki');
  const connected = await run.connectPlugin(plugin);
  assert.ok(connected.tools.some((tool) => /question|wiki|ask/i.test(`${tool.name} ${tool.description}`)));
});
