import assert from 'node:assert/strict';
import { test } from 'node:test';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
};
globalThis.sessionStorage = {
  getItem: (k) => (mem.has('s:' + k) ? mem.get('s:' + k) : null),
  setItem: (k, v) => { mem.set('s:' + k, String(v)); },
  removeItem: (k) => { mem.delete('s:' + k); },
};

const secrets = await import('../js/secrets.js');
const connectors = await import('../js/connectors.js');
const oauth = await import('../js/oauth.js');

const KEY = 'github_pat_supersecretvalue';

function jsonResponse(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(data); },
    async json() { return data; },
  };
}

test('secrets round-trip in the vault and are not stored as plaintext', async () => {
  const vault = secrets.useMemoryVault();
  await secrets.saveSecret('github', KEY);
  assert.equal(await secrets.readSecret('github'), KEY);
  assert.equal(JSON.stringify(vault.get('secret:github')).includes(KEY), false);
  await secrets.deleteSecret('github');
  assert.equal(await secrets.readSecret('github'), '');
});

test('a GitHub test and repo list use the key but never return it', async () => {
  secrets.useMemoryVault();
  let auth = '';
  const fetchImpl = async (url, opts = {}) => {
    auth = opts.headers?.Authorization || '';
    if (String(url).endsWith('/user')) return jsonResponse(200, { login: 'octocat' });
    if (String(url).includes('/user/repos')) {
      return jsonResponse(200, [{ full_name: 'octocat/hello', html_url: 'https://github.com/octocat/hello' }]);
    }
    return jsonResponse(401, { message: `bad ${KEY}` });
  };
  const ok = await connectors.testConnector('github', KEY, fetchImpl);
  assert.equal(ok.ok, true);
  assert.match(ok.detail, /octocat/);
  assert.equal(ok.detail.includes(KEY), false);
  assert.match(auth, /Bearer/);

  const listed = await connectors.runConnectorAction('github', 'github_list_repos', {}, KEY, fetchImpl);
  assert.match(listed, /octocat\/hello/);
  assert.match(listed, /https:\/\/github.com\/octocat\/hello/);
  assert.equal(listed.includes(KEY), false);

  const rejected = await connectors.testConnector('github', KEY, async () => jsonResponse(401, { message: `nope ${KEY}` }));
  assert.equal(rejected.ok, false);
  assert.match(rejected.detail, /401/);
  assert.equal(rejected.detail.includes(KEY), false);
});

test('the model status line never includes a saved key', async () => {
  secrets.useMemoryVault();
  await secrets.saveSecret('github', KEY);
  connectors.writeConnectorMeta('github', { state: 'connected', detail: `Signed in as octocat ${KEY}` });
  const line = connectors.connectorPrompt({ name: 'Nova', connectors: ['github'] });
  assert.match(line, /GitHub is connected/);
  assert.equal(line.includes(KEY), false);
  assert.equal(line.includes('supersecret'), false);
  const meta = JSON.parse(localStorage.getItem('agona:connector-meta'));
  assert.equal(JSON.stringify(meta).includes(KEY), false);
});

test('connector intent asks for repos without putting a key in the plan', () => {
  const intent = connectors.matchConnectorIntent('List my GitHub repos');
  assert.equal(intent.id, 'github');
  assert.equal(intent.tool, 'github_list_repos');
  assert.equal(connectors.matchConnectorIntent('What is the date?'), null);
});

test('Mastodon sign-in builds an authorize URL and stores the token off to the side', async () => {
  secrets.useMemoryVault();
  let opened = '';
  await oauth.beginMastodonLogin('mastodon.social', {
    fetchImpl: async () => jsonResponse(200, { client_id: 'public-client', client_secret: 'app-secret-value' }),
    assign: (url) => { opened = url; },
  });
  assert.match(opened, /https:\/\/mastodon.social\/oauth\/authorize/);
  assert.match(opened, /client_id=public-client/);
  assert.equal(opened.includes('app-secret-value'), false);
  const stored = await secrets.readSecret('mastodon-app:mastodon.social');
  assert.match(stored, /app-secret-value/);

  await oauth.finishMastodonLogin('auth-code', {
    fetchImpl: async (url) => {
      if (String(url).endsWith('/oauth/token')) return jsonResponse(200, { access_token: 'masto-token-value' });
      return jsonResponse(200, { acct: 'ada', username: 'ada' });
    },
  });
  assert.equal(await secrets.readSecret('mastodon'), 'masto-token-value');
  const view = connectors.loadConnectorMeta();
  assert.equal(view.mastodon.state, 'connected');
  assert.match(view.mastodon.detail, /@ada/);
  assert.equal(view.mastodon.detail.includes('masto-token-value'), false);
  assert.match(oauth.GITHUB_OAUTH_NOTE, /personal access token/);
});
