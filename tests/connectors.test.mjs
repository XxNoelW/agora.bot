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
  assert.equal(connectors.matchConnectorIntent('List my github sites').tool, 'github_list_pages');
  assert.equal(connectors.matchConnectorIntent('List my github websites all of them').tool, 'github_list_pages');
  const follow = connectors.matchConnectorIntent('List them', 'GitHub is connected. Signed in as XxNoelW.\nList my github websites');
  assert.equal(follow.tool, 'github_list_pages');
  assert.equal(connectors.matchConnectorIntent('Is GitHub connected?').tool, '');
  assert.equal(connectors.isConnectionEcho('GitHub is connected. Signed in as XxNoelW.'), true);
  assert.equal(connectors.isConnectionEcho('GitHub Pages sites:\n- a/b — https://a.github.io/b/'), false);
});

test('GitHub Pages sites come from the API, not the connection status', async () => {
  const token = 'github_pat_supersecretvalue';
  const seen = [];
  const text = await connectors.runConnectorAction('github', 'github_list_pages', { all: true }, token, async (url) => {
    seen.push(String(url));
    if (String(url).includes('/user/repos')) {
      return jsonResponse(200, [
        { full_name: 'XxNoelW/agora.bot', name: 'agora.bot', owner: { login: 'XxNoelW' }, html_url: 'https://github.com/XxNoelW/agora.bot', has_pages: true },
        { full_name: 'XxNoelW/notes', name: 'notes', owner: { login: 'XxNoelW' }, html_url: 'https://github.com/XxNoelW/notes', has_pages: false },
      ]);
    }
    if (String(url).endsWith('/pages')) {
      return jsonResponse(200, { html_url: 'https://xxnoelw.github.io/agora.bot/', cname: null });
    }
    return jsonResponse(404, { message: 'nope' });
  });
  assert.equal(seen.some((url) => url.includes('/user/repos')), true);
  assert.equal(seen.some((url) => url.includes('/pages')), true);
  assert.match(text, /https:\/\/xxnoelw\.github\.io\/agora\.bot\//);
  assert.match(text, /XxNoelW\/agora\.bot/);
  assert.equal(text.includes('notes'), false);
  assert.equal(text.includes(token), false);
  assert.equal(text.includes('Signed in as'), false);
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

test('the gallery only offers connectors with a setup link and a real action', () => {
  const ids = connectors.CONNECTORS.map((item) => item.id);
  for (const id of ['gemini', 'openrouter', 'mistral', 'groq', 'huggingface', 'stability', 'elevenlabs', 'gitlab', 'bitbucket', 'discord', 'slack', 'telegram', 'bluesky', 'trello', 'todoist', 'airtable', 'linear', 'asana', 'clickup', 'pexels', 'unsplash', 'openweather', 'stripe', 'spotify', 'dropbox', 'gdrive']) {
    assert.ok(ids.includes(id), id);
  }
  for (const spec of connectors.CONNECTORS) {
    assert.ok(spec.setupUrl, spec.id);
    assert.ok(spec.tools.length >= 1, spec.id);
  }
  assert.ok(connectors.UNAVAILABLE.some((item) => item.name === 'Anthropic'));
  assert.ok(connectors.UNAVAILABLE.some((item) => item.name === 'NewsAPI'));
});

test('unsafe keys are refused before a request, and a GitLab result hides the token', async () => {
  let called = false;
  const live = await connectors.testConnector('stripe', 'sk_live_notallowed123456', async () => { called = true; });
  assert.equal(live.ok, false);
  assert.equal(called, false);
  assert.match(live.detail, /test key/i);

  const discord = await connectors.testConnector('discord', 'https://evil.example/hook', async () => { throw new Error('fetched'); });
  assert.equal(discord.ok, false);
  assert.match(discord.detail, /Discord webhook/);

  const token = 'glpat-supersecretvalue';
  let header = '';
  const listed = await connectors.runConnectorAction('gitlab', 'gitlab_projects', {}, token, async (url, opts = {}) => {
    header = opts.headers?.['PRIVATE-TOKEN'] || '';
    return jsonResponse(200, [{ path_with_namespace: 'acme/app', web_url: 'https://gitlab.com/acme/app' }]);
  });
  assert.equal(header, token);
  assert.match(listed, /acme\/app/);
  assert.equal(listed.includes('supersecret'), false);
});

test('a Bluesky profile does not echo the app password or session token', async () => {
  const password = 'app-password-value';
  const text = await connectors.runConnectorAction('bluesky', 'bluesky_profile', {}, { handle: 'ada.bsky.social', key: password }, async (url) => {
    if (String(url).includes('createSession')) return jsonResponse(200, { handle: 'ada.bsky.social', accessJwt: 'jwt-secret-value' });
    return jsonResponse(200, { handle: 'ada.bsky.social', displayName: 'Ada' });
  });
  assert.match(text, /Ada/);
  assert.equal(text.includes(password), false);
  assert.equal(text.includes('jwt-secret-value'), false);
});

test('Spotify sign-in uses PKCE and does not put a client secret in the URL', async () => {
  let opened = '';
  await oauth.beginPkce('spotify', 'public-client-id', { assign: (url) => { opened = url; } });
  assert.match(opened, /https:\/\/accounts\.spotify\.com\/authorize/);
  assert.match(opened, /code_challenge=/);
  assert.match(opened, /code_challenge_method=S256/);
  assert.equal(opened.includes('client_secret'), false);
  assert.equal(opened.includes('public-client-id'), true);
});
