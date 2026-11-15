// Account connectors. The model sees names and status, never keys.
import { deleteSecret, hasSecret, readSecret, saveSecret, scrubSecrets } from './secrets.js';

export const CONNECTOR_IDS = ['github', 'openai', 'notion', 'mastodon'];

const META_KEY = 'agona:connector-meta';

export const CONNECTORS = [
  {
    id: 'github',
    name: 'GitHub',
    auth: 'token',
    hint: 'Paste a personal access token. It stays encrypted in this browser. Agora AI never sees it.',
    placeholder: 'github_pat_… or ghp_…',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    auth: 'token',
    hint: 'Paste an OpenAI API key. A test lists models. The key is not sent to the chat model.',
    placeholder: 'sk-…',
  },
  {
    id: 'notion',
    name: 'Notion',
    auth: 'token',
    hint: 'Paste a Notion integration token. Share a page with the integration before search will see it.',
    placeholder: 'ntn_… or secret_…',
  },
  {
    id: 'mastodon',
    name: 'Mastodon',
    auth: 'oauth',
    hint: 'Sign in on your Mastodon server. This page registers its own app there. No key is stored in the project.',
    placeholder: '',
  },
];

export const connectorView = {};

export function connectorById(id) {
  return CONNECTORS.find((item) => item.id === id) || null;
}

export function loadConnectorMeta(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(META_KEY) || '{}');
    for (const id of CONNECTOR_IDS) {
      const row = parsed[id] && typeof parsed[id] === 'object' ? parsed[id] : {};
      connectorView[id] = {
        state: row.state === 'connected' || row.state === 'failed' ? row.state : 'unknown',
        detail: scrubSecrets(row.detail || ''),
      };
    }
  } catch {
    for (const id of CONNECTOR_IDS) connectorView[id] = { state: 'unknown', detail: '' };
  }
  return connectorView;
}

export function writeConnectorMeta(id, patch, storage = globalThis.localStorage) {
  const current = loadConnectorMeta(storage);
  current[id] = {
    state: patch.state || 'unknown',
    detail: scrubSecrets(patch.detail || '').slice(0, 180),
  };
  const saved = {};
  for (const key of CONNECTOR_IDS) saved[key] = current[key];
  try { storage?.setItem(META_KEY, JSON.stringify(saved)); } catch { /* private mode */ }
  return current[id];
}

function cleanHost(host) {
  const name = String(host || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(name)) throw new Error('Enter a Mastodon server name, like mastodon.social.');
  if (name === 'localhost' || name.endsWith('.local') || name.endsWith('.localhost')) throw new Error('That server name is not allowed.');
  return name;
}

async function readJson(res, secret) {
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = {}; }
  if (!res.ok) {
    const message = data.message || data.error_description || data.error || `The service answered ${res.status}.`;
    const err = new Error(scrubSecrets(message, [secret]));
    err.status = res.status;
    throw err;
  }
  return data;
}

async function github(key, path, { method = 'GET', body, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${key}`,
      'User-Agent': 'Agona',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return readJson(res, key);
}

export async function testConnector(id, key, fetchImpl = fetch) {
  const secret = String(key || '').trim();
  if (!secret) return { ok: false, detail: 'Paste a key first.' };
  try {
    if (id === 'github') {
      const user = await github(secret, '/user', { fetchImpl });
      return { ok: true, detail: `Signed in as ${user.login || 'a GitHub user'}.` };
    }
    if (id === 'openai') {
      const res = await fetchImpl('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${secret}` },
      });
      const data = await readJson(res, secret);
      const count = Array.isArray(data.data) ? data.data.length : 0;
      return { ok: true, detail: `OpenAI key works. ${count} models listed.` };
    }
    if (id === 'notion') {
      const res = await fetchImpl('https://api.notion.com/v1/users/me', {
        headers: { Authorization: `Bearer ${secret}`, 'Notion-Version': '2022-06-28' },
      });
      const data = await readJson(res, secret);
      const name = data.name || data.bot?.owner?.user?.name || 'Notion integration';
      return { ok: true, detail: `Notion key works for ${name}.` };
    }
    return { ok: false, detail: 'That connector does not take a pasted key.' };
  } catch (err) {
    const who = id === 'github' ? 'GitHub' : id === 'openai' ? 'OpenAI' : id === 'notion' ? 'Notion' : 'The service';
    const status = err.status === 401
      ? `${who} rejected that token (401).`
      : scrubSecrets(err.message || 'The test failed.', [secret]);
    return { ok: false, detail: status };
  }
}

function gistArgs(args) {
  const content = String(args?.content || args?.text || '').slice(0, 20000);
  const filename = String(args?.filename || args?.name || 'note.md').replace(/[^\w.\- ]/g, '').slice(0, 80) || 'note.md';
  const description = String(args?.description || 'Note from Agona').slice(0, 200);
  if (!content.trim()) {
    const err = new Error('Say what the gist should contain.');
    throw err;
  }
  return { description, public: false, files: { [filename]: { content } } };
}

function notionTitle(item) {
  const props = item?.properties || {};
  for (const value of Object.values(props)) {
    if (Array.isArray(value?.title)) return value.title.map((part) => part.plain_text || '').join('') || item.url;
  }
  return item?.url || item?.id || 'Untitled';
}

export async function runConnectorAction(id, tool, args = {}, key, fetchImpl = fetch) {
  const secret = String(key || '').trim();
  if (!secret) return 'That account is not connected.';
  try {
    if (tool === 'github_list_repos') {
      const repos = await github(secret, '/user/repos?per_page=8&sort=updated&affiliation=owner', { fetchImpl });
      const lines = (Array.isArray(repos) ? repos : []).slice(0, 8).map((repo) => `- ${repo.full_name} — ${repo.html_url}`);
      return lines.length ? `GitHub repos:\n${lines.join('\n')}` : 'No repositories were returned.';
    }
    if (tool === 'github_create_gist') {
      const created = await github(secret, '/gists', { method: 'POST', body: gistArgs(args), fetchImpl });
      return `Gist created: ${created.html_url}`;
    }
    if (tool === 'openai_list_models') {
      const res = await fetchImpl('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${secret}` } });
      const data = await readJson(res, secret);
      const ids = (data.data || []).map((item) => item.id).filter(Boolean).slice(0, 8);
      return ids.length ? `OpenAI models:\n${ids.map((item) => `- ${item}`).join('\n')}` : 'OpenAI returned no model ids.';
    }
    if (tool === 'notion_search') {
      const query = String(args.query || args.q || '').slice(0, 200);
      const res = await fetchImpl('https://api.notion.com/v1/search', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, page_size: 5 }),
      });
      const data = await readJson(res, secret);
      const lines = (data.results || []).slice(0, 5).map((item) => `- ${notionTitle(item)}${item.url ? ` — ${item.url}` : ''}`);
      return lines.length ? `Notion results:\n${lines.join('\n')}` : 'Notion search returned no pages.';
    }
    if (tool === 'mastodon_profile') {
      const host = cleanHost(args.host || 'mastodon.social');
      const res = await fetchImpl(`https://${host}/api/v1/accounts/verify_credentials`, {
        headers: { Authorization: `Bearer ${secret}` },
      });
      const data = await readJson(res, secret);
      return `Mastodon account: @${data.acct || data.username} on ${host}.`;
    }
    return 'That account action is not available.';
  } catch (err) {
    return scrubSecrets(err.message || 'The account action failed.', [secret]);
  }
}

export function isConnectorTool(name) {
  return ['github_list_repos', 'github_create_gist', 'openai_list_models', 'notion_search', 'mastodon_profile'].includes(name);
}

export function toolConnector(name) {
  if (String(name).startsWith('github_')) return 'github';
  if (String(name).startsWith('openai_')) return 'openai';
  if (String(name).startsWith('notion_')) return 'notion';
  if (String(name).startsWith('mastodon_')) return 'mastodon';
  return '';
}

export function agentAllows(agent, id) {
  return Array.isArray(agent?.connectors) && agent.connectors.includes(id);
}

export function matchConnectorIntent(text) {
  const raw = String(text || '').trim();
  const s = raw.toLowerCase();
  if (/\bgithub\b/.test(s) && /\bgist\b/.test(s) && /\b(create|make|new|save)\b/.test(s)) {
    const content = raw.replace(/^[\s\S]*?\bgist\b[:\s-]*/i, '').trim().slice(0, 4000);
    return { id: 'github', tool: 'github_create_gist', args: { content, filename: 'note.md', description: 'Note from Agona' } };
  }
  if (/\bgithub\b/.test(s) && /\b(repo|repos|repositor)/.test(s)) return { id: 'github', tool: 'github_list_repos', args: {} };
  if (/\bgithub\b/.test(s) && /\b(connect|token|account|sign in)\b/.test(s)) return { id: 'github', tool: '', args: {} };
  if (/\bnotion\b/.test(s) && /\b(search|find|page|pages|connect|token)\b/.test(s)) {
    const query = raw.replace(/\bnotion\b/ig, '').replace(/\b(search|find|look up|pages?|connect|token)\b/ig, '').trim().slice(0, 200);
    return { id: 'notion', tool: 'notion_search', args: { query } };
  }
  if (/\bopenai\b/.test(s) && /\b(model|models|key|connect|token)\b/.test(s)) return { id: 'openai', tool: 'openai_list_models', args: {} };
  if (/\bmastodon\b/.test(s) && /\b(profile|account|connect|sign in|who)\b/.test(s)) return { id: 'mastodon', tool: 'mastodon_profile', args: {} };
  return null;
}

export function connectorPrompt(agent) {
  const allowed = (agent?.connectors || []).filter((id) => connectorById(id));
  if (!allowed.length) return 'This agent cannot use outside accounts. Never ask for an API key in the chat.';
  const bits = allowed.map((id) => {
    const view = connectorView[id] || { state: 'unknown' };
    const name = connectorById(id).name;
    return `${name} is ${view.state === 'connected' ? 'connected' : 'not connected'}.`;
  });
  return `${bits.join(' ')} Never ask the user to paste a token into the chat. You only know the connector name and whether it is connected.`;
}

export function connectorDecidePrompt(agent) {
  const lines = [];
  if (agentAllows(agent, 'github') && connectorView.github?.state === 'connected') {
    lines.push('TOOL: github_list_repos {}');
    lines.push('TOOL: github_create_gist {"filename":"note.md","content":"hello","description":"Note"}');
  }
  if (agentAllows(agent, 'notion') && connectorView.notion?.state === 'connected') {
    lines.push('TOOL: notion_search {"query":"notes"}');
  }
  if (agentAllows(agent, 'openai') && connectorView.openai?.state === 'connected') {
    lines.push('TOOL: openai_list_models {}');
  }
  if (agentAllows(agent, 'mastodon') && connectorView.mastodon?.state === 'connected') {
    lines.push('TOOL: mastodon_profile {}');
  }
  return lines.join('\n');
}

export async function executeConnectorTool(agent, name, args = {}, fetchImpl = fetch) {
  const id = toolConnector(name);
  const label = connectorById(id)?.name || 'That account';
  if (!agentAllows(agent, id)) {
    return { text: `${label} is not enabled for this agent.`, connect: '' };
  }
  if (!(await hasSecret(id))) {
    return { text: `${label} is not connected. A connect card is on the page. Do not ask for the key.`, connect: id };
  }
  const key = await readSecret(id);
  let host = '';
  if (id === 'mastodon') host = (await readSecret('mastodon-host')) || 'mastodon.social';
  const text = await runConnectorAction(id, name, { ...args, host }, key, fetchImpl);
  return { text: scrubSecrets(text, [key]), connect: '' };
}

export async function fulfillConnectorIntent(agent, intent, fetchImpl = fetch) {
  const label = connectorById(intent.id)?.name || 'That account';
  if (!agentAllows(agent, intent.id)) {
    return { text: `${label} is not enabled for ${agent.name}. Turn it on in Connectors.`, connect: intent.id, ran: false };
  }
  if (intent.id !== 'mastodon' && !(await hasSecret(intent.id))) {
    return { text: `${label} is not connected yet. Use the card below. I cannot see the key.`, connect: intent.id, ran: false };
  }
  if (intent.id === 'mastodon' && !(await hasSecret('mastodon'))) {
    return { text: 'Mastodon is not signed in. Use the sign-in button in Connectors.', connect: 'mastodon', ran: false };
  }
  if (!intent.tool) {
    const view = connectorView[intent.id];
    return { text: `${label} is ${view?.state === 'connected' ? 'connected' : 'available'}. ${view?.detail || ''}`.trim(), connect: '', ran: false };
  }
  const outcome = await executeConnectorTool(agent, intent.tool, intent.args, fetchImpl);
  return { ...outcome, ran: !outcome.connect };
}

loadConnectorMeta();
