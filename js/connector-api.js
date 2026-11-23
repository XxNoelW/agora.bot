// Browser calls for connectors. Every host here answered a CORS check.
import { scrubSecrets } from './secrets.js';

export function asCred(value) {
  if (value && typeof value === 'object') {
    const cred = { ...value };
    cred.key = String(value.key || '').trim();
    return cred;
  }
  const text = String(value || '').trim();
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') return asCred(parsed);
    } catch { /* a raw token */ }
  }
  return { key: text };
}

export function secretValues(cred) {
  const source = asCred(cred);
  return [source.key, source.token, source.password, source.webhook].filter((item) => item && String(item).length > 6);
}

export function packCred(cred) {
  if (typeof cred === 'string') return cred.trim();
  const key = String(cred?.key || '').trim();
  const extra = {};
  for (const [name, value] of Object.entries(cred || {})) {
    if (name === 'key') continue;
    const text = String(value || '').trim();
    if (text) extra[name] = text;
  }
  if (!Object.keys(extra).length) return key;
  return JSON.stringify({ key, ...extra });
}

function clip(value, max = 200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function lines(items) {
  return items.filter(Boolean).slice(0, 8);
}

async function call(url, { method = 'GET', headers = {}, body, secret = '', fetchImpl = fetch, form = false } = {}) {
  const res = await fetchImpl(url, {
    method,
    headers,
    body: body == null ? undefined : (form || typeof body === 'string' || body instanceof URLSearchParams ? body : JSON.stringify(body)),
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text.slice(0, 180) }; }
  if (!res.ok) {
    const raw = data.message || data.error?.message || data.err || data.error_description || data.description || data.detail?.message || data.detail || data.error || `The service answered ${res.status}.`;
    const message = scrubSecrets(typeof raw === 'string' ? raw : JSON.stringify(raw), [secret]);
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

function bearer(key) {
  return { Authorization: `Bearer ${key}`, Accept: 'application/json' };
}

function httpsOnly(value, prefix, label) {
  let url;
  try { url = new URL(String(value || '').trim()); }
  catch { throw new Error(`Paste the full ${label} URL.`); }
  if (url.protocol !== 'https:' || !url.href.startsWith(prefix)) throw new Error(`That is not a ${label} URL.`);
  return url.href;
}

function cityFrom(raw) {
  return clip(String(raw || '').replace(/\b(openweather|weather|forecast|what|is|the|in|for|today)\b/ig, ''), 80);
}

function queryFrom(raw, words) {
  return clip(String(raw || '').replace(words, ''), 120);
}

const keyField = (placeholder, label = 'Key') => ({ id: 'key', secret: true, label, placeholder });

export const UNAVAILABLE = [
  { name: 'Anthropic', why: 'api.anthropic.com does not allow a browser to read the response.' },
  { name: 'Replicate', why: 'api.replicate.com does not send CORS headers.' },
  { name: 'NewsAPI', why: 'The headlines response does not allow a browser to read it.' },
  { name: 'Reddit', why: 'oauth.reddit.com blocks browser calls.' },
  { name: 'Supabase', why: 'Each project has its own address, so this page cannot check a pasted key.' },
  { name: 'Firebase', why: 'A Firebase key only works against that project’s own address.' },
];

export const CONNECTOR_SPECS = [
  {
    id: 'github', name: 'GitHub', group: 'Code', auth: 'token',
    hint: 'Paste a personal access token. It stays encrypted in this browser. Agora AI never sees it.',
    setup: 'Create a GitHub token with repo and gist access.',
    setupUrl: 'https://github.com/settings/tokens',
    placeholder: 'github_pat_… or ghp_…',
    fields: [keyField('github_pat_… or ghp_…', 'Personal access token')],
    aliases: ['github'],
    tools: [
      { name: 'github_list_repos', sig: '{}', desc: 'list repos on the connected GitHub account' },
      { name: 'github_create_gist', sig: '{"filename":"note.md","content":"hello"}', desc: 'create a private gist' },
    ],
    async test(cred, fetchImpl) {
      const user = await call('https://api.github.com/user', { headers: { ...bearer(cred.key), 'User-Agent': 'Agona', 'X-GitHub-Api-Version': '2022-11-28' }, secret: cred.key, fetchImpl });
      return { ok: true, detail: `Signed in as ${user.login || 'a GitHub user'}.` };
    },
    async run(tool, args, cred, fetchImpl) {
      const headers = { ...bearer(cred.key), 'User-Agent': 'Agona', 'X-GitHub-Api-Version': '2022-11-28' };
      if (tool === 'github_list_repos') {
        const repos = await call('https://api.github.com/user/repos?per_page=8&sort=updated&affiliation=owner', { headers, secret: cred.key, fetchImpl });
        const list = lines((Array.isArray(repos) ? repos : []).map((repo) => `- ${repo.full_name} — ${repo.html_url}`));
        return list.length ? `GitHub repos:\n${list.join('\n')}` : 'No repositories were returned.';
      }
      const content = String(args.content || args.text || '').slice(0, 20000);
      if (!content.trim()) throw new Error('Say what the gist should contain.');
      const filename = String(args.filename || args.name || 'note.md').replace(/[^\w.\- ]/g, '').slice(0, 80) || 'note.md';
      const created = await call('https://api.github.com/gists', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, secret: cred.key, fetchImpl,
        body: { description: clip(args.description || 'Note from Agora', 200), public: false, files: { [filename]: { content } } },
      });
      return `Gist created: ${created.html_url}`;
    },
  },
  {
    id: 'gitlab', name: 'GitLab', group: 'Code', auth: 'token',
    hint: 'Paste a GitLab personal access token with read_api. The token stays in this browser.',
    setup: 'Create a GitLab personal access token.',
    setupUrl: 'https://gitlab.com/-/user_settings/personal_access_tokens',
    placeholder: 'glpat-…',
    fields: [keyField('glpat-…', 'Personal access token')],
    aliases: ['gitlab'],
    tools: [
      { name: 'gitlab_user', sig: '{}', desc: 'read the connected GitLab user' },
      { name: 'gitlab_projects', sig: '{}', desc: 'list GitLab projects for the connected user' },
    ],
    async test(cred, fetchImpl) {
      const user = await call('https://gitlab.com/api/v4/user', { headers: { 'PRIVATE-TOKEN': cred.key }, secret: cred.key, fetchImpl });
      return { ok: true, detail: `Signed in to GitLab as ${user.username || user.name}.` };
    },
    async run(tool, args, cred, fetchImpl) {
      const headers = { 'PRIVATE-TOKEN': cred.key };
      if (tool === 'gitlab_user') {
        const user = await call('https://gitlab.com/api/v4/user', { headers, secret: cred.key, fetchImpl });
        return `GitLab user: ${user.name || user.username} (@${user.username}).`;
      }
      const projects = await call('https://gitlab.com/api/v4/projects?membership=true&simple=true&per_page=8', { headers, secret: cred.key, fetchImpl });
      const list = lines((Array.isArray(projects) ? projects : []).map((item) => `- ${item.path_with_namespace} — ${item.web_url}`));
      return list.length ? `GitLab projects:\n${list.join('\n')}` : 'No GitLab projects were returned.';
    },
  },
  {
    id: 'bitbucket', name: 'Bitbucket', group: 'Code', auth: 'token',
    hint: 'Use an app password, not your account password. Both values stay encrypted here.',
    setup: 'Create a Bitbucket app password with account and repository read.',
    setupUrl: 'https://support.atlassian.com/bitbucket-cloud/docs/create-an-app-password/',
    placeholder: 'app password',
    fields: [
      { id: 'username', secret: false, label: 'Username', placeholder: 'Bitbucket username' },
      keyField('App password', 'App password'),
    ],
    aliases: ['bitbucket'],
    tools: [
      { name: 'bitbucket_user', sig: '{}', desc: 'read the connected Bitbucket user' },
      { name: 'bitbucket_repos', sig: '{}', desc: 'list Bitbucket repositories' },
    ],
    async test(cred, fetchImpl) {
      if (!cred.username || !cred.key) return { ok: false, detail: 'Enter the Bitbucket username and app password.' };
      const user = await call('https://api.bitbucket.org/2.0/user', { headers: { Authorization: `Basic ${btoa(`${cred.username}:${cred.key}`)}` }, secret: cred.key, fetchImpl });
      return { ok: true, detail: `Signed in to Bitbucket as ${user.display_name || user.username}.` };
    },
    async run(tool, args, cred, fetchImpl) {
      const headers = { Authorization: `Basic ${btoa(`${cred.username}:${cred.key}`)}` };
      if (tool === 'bitbucket_user') {
        const user = await call('https://api.bitbucket.org/2.0/user', { headers, secret: cred.key, fetchImpl });
        return `Bitbucket user: ${user.display_name || user.username}.`;
      }
      const data = await call('https://api.bitbucket.org/2.0/repositories?role=member&pagelen=8', { headers, secret: cred.key, fetchImpl });
      const list = lines((data.values || []).map((repo) => `- ${repo.full_name} — ${repo.links?.html?.href || ''}`));
      return list.length ? `Bitbucket repos:\n${list.join('\n')}` : 'No Bitbucket repositories were returned.';
    },
  },
  {
    id: 'openai', name: 'OpenAI', group: 'Models', auth: 'token',
    hint: 'Paste an OpenAI API key. A test lists models. The key is not sent to the chat model.',
    setup: 'Create an OpenAI API key.',
    setupUrl: 'https://platform.openai.com/api-keys',
    placeholder: 'sk-…',
    fields: [keyField('sk-…', 'API key')],
    aliases: ['openai'],
    tools: [{ name: 'openai_list_models', sig: '{}', desc: 'list model ids on the connected OpenAI account' }],
    async test(cred, fetchImpl) {
      const data = await call('https://api.openai.com/v1/models', { headers: bearer(cred.key), secret: cred.key, fetchImpl });
      return { ok: true, detail: `OpenAI key works. ${Array.isArray(data.data) ? data.data.length : 0} models listed.` };
    },
    async run(tool, args, cred, fetchImpl) {
      const data = await call('https://api.openai.com/v1/models', { headers: bearer(cred.key), secret: cred.key, fetchImpl });
      const ids = lines((data.data || []).map((item) => item.id).filter(Boolean).map((id) => `- ${id}`));
      return ids.length ? `OpenAI models:\n${ids.join('\n')}` : 'OpenAI returned no model ids.';
    },
  },
  {
    id: 'gemini', name: 'Google Gemini', group: 'Models', auth: 'token',
    hint: 'Paste a Gemini API key. It is used only for Gemini actions, not as the Agora AI chat model.',
    setup: 'Create a Gemini API key in Google AI Studio.',
    setupUrl: 'https://aistudio.google.com/apikey',
    placeholder: 'AIza…',
    fields: [keyField('AIza…', 'API key')],
    aliases: ['gemini'],
    tools: [
      { name: 'gemini_list_models', sig: '{}', desc: 'list Gemini models for the connected key' },
      { name: 'gemini_model', sig: '{"name":"models/gemini-2.0-flash"}', desc: 'read one Gemini model description' },
    ],
    async test(cred, fetchImpl) {
      const data = await call('https://generativelanguage.googleapis.com/v1beta/models', { headers: { 'x-goog-api-key': cred.key }, secret: cred.key, fetchImpl });
      return { ok: true, detail: `Gemini key works. ${Array.isArray(data.models) ? data.models.length : 0} models listed.` };
    },
    async run(tool, args, cred, fetchImpl) {
      const headers = { 'x-goog-api-key': cred.key };
      if (tool === 'gemini_model') {
        const name = String(args.name || args.model || '').replace(/^models\//, '');
        if (!name) throw new Error('Name the Gemini model to look up.');
        const data = await call(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(name)}`, { headers, secret: cred.key, fetchImpl });
        return `Gemini model: ${data.displayName || data.name}. ${clip(data.description, 240)}`;
      }
      const data = await call('https://generativelanguage.googleapis.com/v1beta/models', { headers, secret: cred.key, fetchImpl });
      const list = lines((data.models || []).map((item) => `- ${item.displayName || item.name}`));
      return list.length ? `Gemini models:\n${list.join('\n')}` : 'Gemini returned no models.';
    },
  },
  {
    id: 'openrouter', name: 'OpenRouter', group: 'Models', auth: 'token',
    hint: 'This key is for OpenRouter actions. It is separate from the optional chat key in Settings, and it is not shown to the model.',
    setup: 'Create an OpenRouter key.',
    setupUrl: 'https://openrouter.ai/keys',
    placeholder: 'sk-or-v1-…',
    fields: [keyField('sk-or-v1-…', 'API key')],
    aliases: ['openrouter'],
    tools: [
      { name: 'openrouter_credits', sig: '{}', desc: 'read OpenRouter key usage' },
      { name: 'openrouter_models', sig: '{}', desc: 'list some OpenRouter model ids' },
    ],
    async test(cred, fetchImpl) {
      const data = await call('https://openrouter.ai/api/v1/key', { headers: bearer(cred.key), secret: cred.key, fetchImpl });
      const info = data.data || data;
      return { ok: true, detail: `OpenRouter key works${info.label ? ` (${info.label})` : ''}.` };
    },
    async run(tool, args, cred, fetchImpl) {
      if (tool === 'openrouter_credits') {
        const data = await call('https://openrouter.ai/api/v1/key', { headers: bearer(cred.key), secret: cred.key, fetchImpl });
        const info = data.data || data;
        return `OpenRouter usage: ${info.usage ?? 0}. Remaining limit: ${info.limit_remaining ?? 'not set'}.`;
      }
      const data = await call('https://openrouter.ai/api/v1/models', { headers: bearer(cred.key), secret: cred.key, fetchImpl });
      const list = lines((data.data || []).map((item) => item.id).filter(Boolean).map((id) => `- ${id}`));
      return list.length ? `OpenRouter models:\n${list.join('\n')}` : 'OpenRouter returned no models.';
    },
  },
  {
    id: 'mistral', name: 'Mistral', group: 'Models', auth: 'token',
    hint: 'Paste a Mistral API key. The test lists models. The key never enters the chat.',
    setup: 'Create a Mistral API key.',
    setupUrl: 'https://console.mistral.ai/api-keys',
    placeholder: 'Mistral key',
    fields: [keyField('Mistral key', 'API key')],
    aliases: ['mistral'],
    tools: [{ name: 'mistral_list_models', sig: '{}', desc: 'list Mistral model ids' }],
    async test(cred, fetchImpl) {
      const data = await call('https://api.mistral.ai/v1/models', { headers: bearer(cred.key), secret: cred.key, fetchImpl });
      return { ok: true, detail: `Mistral key works. ${Array.isArray(data.data) ? data.data.length : 0} models listed.` };
    },
    async run(tool, args, cred, fetchImpl) {
      const data = await call('https://api.mistral.ai/v1/models', { headers: bearer(cred.key), secret: cred.key, fetchImpl });
      const list = lines((data.data || []).map((item) => `- ${item.id}`));
      return list.length ? `Mistral models:\n${list.join('\n')}` : 'Mistral returned no models.';
    },
  },
  {
    id: 'groq', name: 'Groq', group: 'Models', auth: 'token',
    hint: 'Paste a Groq API key. The test lists models. The key never enters the chat.',
    setup: 'Create a Groq API key.',
    setupUrl: 'https://console.groq.com/keys',
    placeholder: 'gsk_…',
    fields: [keyField('gsk_…', 'API key')],
    aliases: ['groq'],
    tools: [{ name: 'groq_list_models', sig: '{}', desc: 'list Groq model ids' }],
    async test(cred, fetchImpl) {
      const data = await call('https://api.groq.com/openai/v1/models', { headers: bearer(cred.key), secret: cred.key, fetchImpl });
      return { ok: true, detail: `Groq key works. ${Array.isArray(data.data) ? data.data.length : 0} models listed.` };
    },
    async run(tool, args, cred, fetchImpl) {
      const data = await call('https://api.groq.com/openai/v1/models', { headers: bearer(cred.key), secret: cred.key, fetchImpl });
      const list = lines((data.data || []).map((item) => `- ${item.id}`));
      return list.length ? `Groq models:\n${list.join('\n')}` : 'Groq returned no models.';
    },
  },
  {
    id: 'huggingface', name: 'Hugging Face', group: 'Models', auth: 'token',
    hint: 'Paste a Hugging Face token with read access. The test checks who you are.',
    setup: 'Create a Hugging Face access token.',
    setupUrl: 'https://huggingface.co/settings/tokens',
    placeholder: 'hf_…',
    fields: [keyField('hf_…', 'Access token')],
    aliases: ['hugging face', 'huggingface'],
    tools: [
      { name: 'huggingface_who', sig: '{}', desc: 'read the connected Hugging Face username' },
      { name: 'huggingface_models', sig: '{}', desc: 'list models owned by the connected Hugging Face user' },
    ],
    async test(cred, fetchImpl) {
      const who = await call('https://huggingface.co/api/whoami-v2', { headers: bearer(cred.key), secret: cred.key, fetchImpl });
      return { ok: true, detail: `Signed in to Hugging Face as ${who.name || 'that account'}.` };
    },
    async run(tool, args, cred, fetchImpl) {
      const who = await call('https://huggingface.co/api/whoami-v2', { headers: bearer(cred.key), secret: cred.key, fetchImpl });
      if (tool === 'huggingface_who') return `Hugging Face user: ${who.name || 'unknown'}.`;
      const models = await call(`https://huggingface.co/api/models?author=${encodeURIComponent(who.name || '')}&limit=8`, { headers: bearer(cred.key), secret: cred.key, fetchImpl });
      const list = lines((Array.isArray(models) ? models : []).map((item) => `- ${item.id}`));
      return list.length ? `Hugging Face models:\n${list.join('\n')}` : 'No models were listed for that user.';
    },
  },
  {
    id: 'stability', name: 'Stability', group: 'Models', auth: 'token',
    hint: 'Paste a Stability API key. The test checks the account. The key is not shown to the model.',
    setup: 'Create a Stability API key.',
    setupUrl: 'https://platform.stability.ai/account/keys',
    placeholder: 'sk-…',
    fields: [keyField('sk-…', 'API key')],
    aliases: ['stability'],
    tools: [
      { name: 'stability_account', sig: '{}', desc: 'read the connected Stability account' },
      { name: 'stability_engines', sig: '{}', desc: 'list Stability engines' },
    ],
    async test(cred, fetchImpl) {
      await call('https://api.stability.ai/v1/user/account', { headers: bearer(cred.key), secret: cred.key, fetchImpl });
      return { ok: true, detail: 'Stability key works.' };
    },
    async run(tool, args, cred, fetchImpl) {
      if (tool === 'stability_account') {
        const data = await call('https://api.stability.ai/v1/user/account', { headers: bearer(cred.key), secret: cred.key, fetchImpl });
        const org = data.organizations?.[0]?.name;
        return `Stability account${data.email ? ` ${data.email}` : ''}${org ? ` in ${org}` : ''}.`;
      }
      const data = await call('https://api.stability.ai/v1/engines/list', { headers: bearer(cred.key), secret: cred.key, fetchImpl });
      const engines = Array.isArray(data) ? data : (data.engines || []);
      const list = lines(engines.map((item) => `- ${item.name || item.id}`));
      return list.length ? `Stability engines:\n${list.join('\n')}` : 'No Stability engines were returned.';
    },
  },
  {
    id: 'elevenlabs', name: 'ElevenLabs', group: 'Models', auth: 'token',
    hint: 'Paste an ElevenLabs API key. The test checks the account and the agent can list voices.',
    setup: 'Create an ElevenLabs API key.',
    setupUrl: 'https://elevenlabs.io/app/settings/api-keys',
    placeholder: 'xi-…',
    fields: [keyField('ElevenLabs key', 'API key')],
    aliases: ['elevenlabs', 'eleven labs'],
    tools: [
      { name: 'elevenlabs_account', sig: '{}', desc: 'read the connected ElevenLabs subscription' },
      { name: 'elevenlabs_voices', sig: '{}', desc: 'list ElevenLabs voices' },
    ],
    async test(cred, fetchImpl) {
      const data = await call('https://api.elevenlabs.io/v1/user', { headers: { 'xi-api-key': cred.key }, secret: cred.key, fetchImpl });
      return { ok: true, detail: `ElevenLabs key works${data.subscription?.tier ? ` (${data.subscription.tier})` : ''}.` };
    },
    async run(tool, args, cred, fetchImpl) {
      const headers = { 'xi-api-key': cred.key };
      if (tool === 'elevenlabs_account') {
        const data = await call('https://api.elevenlabs.io/v1/user', { headers, secret: cred.key, fetchImpl });
        const sub = data.subscription || {};
        return `ElevenLabs plan: ${sub.tier || 'unknown'}. Characters used: ${sub.character_count ?? 0} of ${sub.character_limit ?? 0}.`;
      }
      const data = await call('https://api.elevenlabs.io/v1/voices', { headers, secret: cred.key, fetchImpl });
      const list = lines((data.voices || []).map((voice) => `- ${voice.name}`));
      return list.length ? `ElevenLabs voices:\n${list.join('\n')}` : 'No voices were returned.';
    },
  },
  {
    id: 'notion', name: 'Notion', group: 'Work', auth: 'token',
    hint: 'Paste a Notion integration token. Share a page with the integration before search will see it.',
    setup: 'Create a Notion integration and share pages with it.',
    setupUrl: 'https://www.notion.so/my-integrations',
    placeholder: 'ntn_… or secret_…',
    fields: [keyField('ntn_… or secret_…', 'Integration token')],
    aliases: ['notion'],
    tools: [{ name: 'notion_search', sig: '{"query":"notes"}', desc: 'search the connected Notion workspace' }],
    async test(cred, fetchImpl) {
      const data = await call('https://api.notion.com/v1/users/me', { headers: { ...bearer(cred.key), 'Notion-Version': '2022-06-28' }, secret: cred.key, fetchImpl });
      return { ok: true, detail: `Notion key works for ${data.name || 'the integration'}.` };
    },
    async run(tool, args, cred, fetchImpl) {
      const data = await call('https://api.notion.com/v1/search', {
        method: 'POST', secret: cred.key, fetchImpl,
        headers: { ...bearer(cred.key), 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
        body: { query: clip(args.query || args.q, 200), page_size: 5 },
      });
      const list = lines((data.results || []).map((item) => {
        let title = item.url || item.id;
        for (const value of Object.values(item.properties || {})) {
          if (Array.isArray(value?.title)) title = value.title.map((part) => part.plain_text || '').join('') || title;
        }
        return `- ${title}${item.url ? ` — ${item.url}` : ''}`;
      }));
      return list.length ? `Notion results:\n${list.join('\n')}` : 'Notion search returned no pages.';
    },
  },
  {
    id: 'trello', name: 'Trello', group: 'Work', auth: 'token',
    hint: 'Paste both the API key and a user token. They stay encrypted in this browser.',
    setup: 'Get a Trello API key, then create a user token from that page.',
    setupUrl: 'https://trello.com/power-ups/admin',
    placeholder: 'token',
    fields: [keyField('API key', 'API key'), { id: 'token', secret: true, label: 'User token', placeholder: 'User token' }],
    aliases: ['trello'],
    tools: [
      { name: 'trello_me', sig: '{}', desc: 'read the connected Trello member' },
      { name: 'trello_boards', sig: '{}', desc: 'list Trello boards' },
    ],
    async test(cred, fetchImpl) {
      if (!cred.key || !cred.token) return { ok: false, detail: 'Enter both the Trello API key and the user token.' };
      const me = await call(`https://api.trello.com/1/members/me?key=${encodeURIComponent(cred.key)}&token=${encodeURIComponent(cred.token)}`, { secret: cred.key, fetchImpl });
      return { ok: true, detail: `Signed in to Trello as ${me.fullName || me.username}.` };
    },
    async run(tool, args, cred, fetchImpl) {
      const q = `key=${encodeURIComponent(cred.key)}&token=${encodeURIComponent(cred.token)}`;
      if (tool === 'trello_me') {
        const me = await call(`https://api.trello.com/1/members/me?${q}`, { secret: cred.key, fetchImpl });
        return `Trello member: ${me.fullName || me.username}.`;
      }
      const boards = await call(`https://api.trello.com/1/members/me/boards?${q}&fields=name,url`, { secret: cred.key, fetchImpl });
      const list = lines((Array.isArray(boards) ? boards : []).map((board) => `- ${board.name} — ${board.url}`));
      return list.length ? `Trello boards:\n${list.join('\n')}` : 'No Trello boards were returned.';
    },
  },
  {
    id: 'todoist', name: 'Todoist', group: 'Work', auth: 'token',
    hint: 'Paste a Todoist API token. The test lists projects.',
    setup: 'Copy the Todoist API token from the developer settings.',
    setupUrl: 'https://app.todoist.com/app/settings/integrations/developer',
    placeholder: 'Todoist token',
    fields: [keyField('Todoist token', 'API token')],
    aliases: ['todoist'],
    tools: [
      { name: 'todoist_projects', sig: '{}', desc: 'list Todoist projects' },
      { name: 'todoist_tasks', sig: '{}', desc: 'list Todoist tasks' },
    ],
    async test(cred, fetchImpl) {
      const data = await call('https://api.todoist.com/api/v1/projects', { headers: bearer(cred.key), secret: cred.key, fetchImpl });
      const count = (Array.isArray(data) ? data : (data.results || [])).length;
      return { ok: true, detail: `Todoist key works. ${count} projects listed.` };
    },
    async run(tool, args, cred, fetchImpl) {
      const path = tool === 'todoist_tasks' ? 'tasks' : 'projects';
      const data = await call(`https://api.todoist.com/api/v1/${path}`, { headers: bearer(cred.key), secret: cred.key, fetchImpl });
      const rows = Array.isArray(data) ? data : (data.results || []);
      const list = lines(rows.map((item) => `- ${item.name || item.content}`));
      return list.length ? `Todoist ${path}:\n${list.join('\n')}` : `No Todoist ${path} were returned.`;
    },
  },
  {
    id: 'airtable', name: 'Airtable', group: 'Work', auth: 'token',
    hint: 'Paste an Airtable personal access token with the schema.bases scope.',
    setup: 'Create an Airtable personal access token.',
    setupUrl: 'https://airtable.com/create/tokens',
    placeholder: 'pat…',
    fields: [keyField('pat…', 'Personal access token')],
    aliases: ['airtable'],
    tools: [
      { name: 'airtable_who', sig: '{}', desc: 'read the connected Airtable user id' },
      { name: 'airtable_bases', sig: '{}', desc: 'list Airtable bases the token can see' },
    ],
    async test(cred, fetchImpl) {
      const data = await call('https://api.airtable.com/v0/meta/whoami', { headers: bearer(cred.key), secret: cred.key, fetchImpl });
      return { ok: true, detail: `Airtable token works${data.id ? ` (${data.id})` : ''}.` };
    },
    async run(tool, args, cred, fetchImpl) {
      if (tool === 'airtable_who') {
        const data = await call('https://api.airtable.com/v0/meta/whoami', { headers: bearer(cred.key), secret: cred.key, fetchImpl });
        return `Airtable user id: ${data.id || 'unknown'}.`;
      }
      const data = await call('https://api.airtable.com/v0/meta/bases', { headers: bearer(cred.key), secret: cred.key, fetchImpl });
      const list = lines((data.bases || []).map((base) => `- ${base.name}`));
      return list.length ? `Airtable bases:\n${list.join('\n')}` : 'No Airtable bases were returned.';
    },
  },
  {
    id: 'linear', name: 'Linear', group: 'Work', auth: 'token',
    hint: 'Paste a Linear personal API key. The test reads your name.',
    setup: 'Create a Linear personal API key.',
    setupUrl: 'https://linear.app/settings/api',
    placeholder: 'lin_api_…',
    fields: [keyField('lin_api_…', 'Personal API key')],
    aliases: ['linear'],
    tools: [
      { name: 'linear_me', sig: '{}', desc: 'read the connected Linear user' },
      { name: 'linear_issues', sig: '{}', desc: 'list recent Linear issues' },
    ],
    async test(cred, fetchImpl) {
      const data = await linearQuery(cred, '{ viewer { name } }', fetchImpl);
      return { ok: true, detail: `Signed in to Linear as ${data.data?.viewer?.name || 'that account'}.` };
    },
    async run(tool, args, cred, fetchImpl) {
      if (tool === 'linear_me') {
        const data = await linearQuery(cred, '{ viewer { name } }', fetchImpl);
        return `Linear user: ${data.data?.viewer?.name || 'unknown'}.`;
      }
      const data = await linearQuery(cred, '{ issues(first: 5) { nodes { identifier title url } } }', fetchImpl);
      const list = lines((data.data?.issues?.nodes || []).map((item) => `- ${item.identifier} ${item.title} — ${item.url}`));
      return list.length ? `Linear issues:\n${list.join('\n')}` : 'No Linear issues were returned.';
    },
  },
  {
    id: 'asana', name: 'Asana', group: 'Work', auth: 'token',
    hint: 'Paste an Asana personal access token. The test reads your name.',
    setup: 'Create an Asana personal access token.',
    setupUrl: 'https://app.asana.com/0/my-apps',
    placeholder: 'Asana token',
    fields: [keyField('Asana token', 'Personal access token')],
    aliases: ['asana'],
    tools: [
      { name: 'asana_me', sig: '{}', desc: 'read the connected Asana user' },
      { name: 'asana_workspaces', sig: '{}', desc: 'list Asana workspaces' },
    ],
    async test(cred, fetchImpl) {
      const data = await call('https://app.asana.com/api/1.0/users/me', { headers: bearer(cred.key), secret: cred.key, fetchImpl });
      return { ok: true, detail: `Signed in to Asana as ${data.data?.name || 'that account'}.` };
    },
    async run(tool, args, cred, fetchImpl) {
      if (tool === 'asana_me') {
        const data = await call('https://app.asana.com/api/1.0/users/me', { headers: bearer(cred.key), secret: cred.key, fetchImpl });
        return `Asana user: ${data.data?.name || 'unknown'}.`;
      }
      const data = await call('https://app.asana.com/api/1.0/workspaces', { headers: bearer(cred.key), secret: cred.key, fetchImpl });
      const list = lines((data.data || []).map((item) => `- ${item.name}`));
      return list.length ? `Asana workspaces:\n${list.join('\n')}` : 'No Asana workspaces were returned.';
    },
  },
  {
    id: 'clickup', name: 'ClickUp', group: 'Work', auth: 'token',
    hint: 'Paste a ClickUp personal API token. The test reads your user.',
    setup: 'Copy a ClickUp API token from settings.',
    setupUrl: 'https://app.clickup.com/settings/apps',
    placeholder: 'pk_…',
    fields: [keyField('pk_…', 'API token')],
    aliases: ['clickup', 'click up'],
    tools: [
      { name: 'clickup_user', sig: '{}', desc: 'read the connected ClickUp user' },
      { name: 'clickup_teams', sig: '{}', desc: 'list ClickUp workspaces' },
    ],
    async test(cred, fetchImpl) {
      const data = await call('https://api.clickup.com/api/v2/user', { headers: { Authorization: cred.key }, secret: cred.key, fetchImpl });
      return { ok: true, detail: `Signed in to ClickUp as ${data.user?.username || 'that account'}.` };
    },
    async run(tool, args, cred, fetchImpl) {
      const headers = { Authorization: cred.key };
      if (tool === 'clickup_user') {
        const data = await call('https://api.clickup.com/api/v2/user', { headers, secret: cred.key, fetchImpl });
        return `ClickUp user: ${data.user?.username || 'unknown'}.`;
      }
      const data = await call('https://api.clickup.com/api/v2/team', { headers, secret: cred.key, fetchImpl });
      const list = lines((data.teams || []).map((team) => `- ${team.name}`));
      return list.length ? `ClickUp workspaces:\n${list.join('\n')}` : 'No ClickUp workspaces were returned.';
    },
  },
  {
    id: 'discord', name: 'Discord webhook', group: 'Chat', auth: 'token',
    hint: 'Paste a webhook URL. Test posts one line in that channel. The URL stays encrypted and is never shown to the model.',
    setup: 'Create a Discord channel webhook and copy its URL.',
    setupUrl: 'https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks',
    placeholder: 'https://discord.com/api/webhooks/…',
    fields: [keyField('https://discord.com/api/webhooks/…', 'Webhook URL')],
    aliases: ['discord'],
    tools: [{ name: 'discord_send', sig: '{"content":"hello"}', desc: 'post a message to the connected Discord webhook' }],
    async test(cred, fetchImpl) {
      await postDiscord(cred.key, 'Agora connected this webhook.', fetchImpl);
      return { ok: true, detail: 'Discord accepted the webhook. A test line was posted.' };
    },
    async run(tool, args, cred, fetchImpl) {
      const content = clip(args.content || args.text, 500);
      if (!content) throw new Error('Say what to send to Discord.');
      await postDiscord(cred.key, content, fetchImpl);
      return 'Discord message posted.';
    },
  },
  {
    id: 'slack', name: 'Slack webhook', group: 'Chat', auth: 'token',
    hint: 'Paste an incoming webhook URL. Test posts one line. The URL stays encrypted and is never shown to the model.',
    setup: 'Create a Slack incoming webhook.',
    setupUrl: 'https://api.slack.com/messaging/webhooks',
    placeholder: 'https://hooks.slack.com/services/…',
    fields: [keyField('https://hooks.slack.com/services/…', 'Webhook URL')],
    aliases: ['slack'],
    tools: [{ name: 'slack_send', sig: '{"text":"hello"}', desc: 'post a message to the connected Slack webhook' }],
    async test(cred, fetchImpl) {
      await postSlack(cred.key, 'Agora connected this webhook.', fetchImpl);
      return { ok: true, detail: 'Slack accepted the webhook. A test line was posted.' };
    },
    async run(tool, args, cred, fetchImpl) {
      const text = clip(args.text || args.content, 500);
      if (!text) throw new Error('Say what to send to Slack.');
      await postSlack(cred.key, text, fetchImpl);
      return 'Slack message posted.';
    },
  },
  {
    id: 'telegram', name: 'Telegram bot', group: 'Chat', auth: 'token',
    hint: 'Paste the bot token from BotFather and the chat id that should receive messages.',
    setup: 'Create a bot with BotFather, then send the bot a message so you can read the chat id.',
    setupUrl: 'https://core.telegram.org/bots#botfather',
    placeholder: '123456:ABC…',
    fields: [keyField('123456:ABC…', 'Bot token'), { id: 'chatId', secret: false, label: 'Chat id', placeholder: '123456789' }],
    aliases: ['telegram'],
    tools: [
      { name: 'telegram_me', sig: '{}', desc: 'read the connected Telegram bot name' },
      { name: 'telegram_send', sig: '{"text":"hello"}', desc: 'send a Telegram message to the saved chat' },
    ],
    async test(cred, fetchImpl) {
      const data = await call(`https://api.telegram.org/bot${encodeURIComponent(cred.key)}/getMe`, { secret: cred.key, fetchImpl });
      return { ok: true, detail: `Telegram bot @${data.result?.username || 'bot'} is connected.` };
    },
    async run(tool, args, cred, fetchImpl) {
      if (tool === 'telegram_me') {
        const data = await call(`https://api.telegram.org/bot${encodeURIComponent(cred.key)}/getMe`, { secret: cred.key, fetchImpl });
        return `Telegram bot: @${data.result?.username || 'unknown'}.`;
      }
      const text = clip(args.text || args.content, 500);
      if (!text) throw new Error('Say what to send on Telegram.');
      if (!cred.chatId) throw new Error('Add a Telegram chat id in Connectors first.');
      await call(`https://api.telegram.org/bot${encodeURIComponent(cred.key)}/sendMessage`, {
        method: 'POST', form: true, secret: cred.key, fetchImpl,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ chat_id: String(cred.chatId), text }),
      });
      return 'Telegram message sent.';
    },
  },
  {
    id: 'bluesky', name: 'Bluesky', group: 'Chat', auth: 'token',
    hint: 'Use an app password, not your account password. Neither value is shown to the model.',
    setup: 'Create a Bluesky app password.',
    setupUrl: 'https://bsky.app/settings/app-passwords',
    placeholder: 'xxxx-xxxx-xxxx-xxxx',
    fields: [
      { id: 'handle', secret: false, label: 'Handle', placeholder: 'you.bsky.social' },
      keyField('xxxx-xxxx-xxxx-xxxx', 'App password'),
    ],
    aliases: ['bluesky', 'bsky'],
    tools: [
      { name: 'bluesky_profile', sig: '{}', desc: 'read the connected Bluesky profile' },
      { name: 'bluesky_posts', sig: '{}', desc: 'read recent posts from the connected Bluesky account' },
    ],
    async test(cred, fetchImpl) {
      const session = await bskySession(cred, fetchImpl);
      return { ok: true, detail: `Signed in to Bluesky as @${session.handle}.` };
    },
    async run(tool, args, cred, fetchImpl) {
      const session = await bskySession(cred, fetchImpl);
      if (tool === 'bluesky_profile') {
        const data = await call(`https://bsky.social/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(session.handle)}`, { headers: bearer(session.accessJwt), secret: session.accessJwt, fetchImpl });
        return `Bluesky profile: @${data.handle || session.handle} (${data.displayName || 'no display name'}).`;
      }
      const data = await call(`https://bsky.social/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(session.handle)}&limit=5`, { headers: bearer(session.accessJwt), secret: session.accessJwt, fetchImpl });
      const list = lines((data.feed || []).map((item) => `- ${clip(item.post?.record?.text, 140)}`));
      return list.length ? `Bluesky posts:\n${list.join('\n')}` : 'No Bluesky posts were returned.';
    },
  },
  {
    id: 'mastodon', name: 'Mastodon', group: 'Sign-in', auth: 'oauth',
    hint: 'Sign in on your Mastodon server. This page registers its own app there. No key is stored in the project.',
    setup: 'Use any Mastodon server that allows app registration. mastodon.social works.',
    setupUrl: 'https://docs.joinmastodon.org/client/token/',
    placeholder: '',
    fields: [{ id: 'host', secret: false, label: 'Server', placeholder: 'mastodon.social', value: 'mastodon.social' }],
    aliases: ['mastodon'],
    tools: [{ name: 'mastodon_profile', sig: '{}', desc: 'read the connected Mastodon profile' }],
    async test() { return { ok: false, detail: 'Use the Mastodon sign-in button.' }; },
    async run(tool, args, cred, fetchImpl) {
      const host = String(args.host || cred.host || 'mastodon.social').trim();
      const data = await call(`https://${host}/api/v1/accounts/verify_credentials`, { headers: bearer(cred.key), secret: cred.key, fetchImpl });
      return `Mastodon account: @${data.acct || data.username} on ${host}.`;
    },
  },
  {
    id: 'spotify', name: 'Spotify', group: 'Sign-in', auth: 'oauth',
    hint: 'Create a Spotify app and paste its public client ID. No client secret is used. Register the redirect URI shown here.',
    setup: 'Create a Spotify app and add the redirect URI from this page.',
    setupUrl: 'https://developer.spotify.com/dashboard',
    placeholder: '',
    fields: [{ id: 'clientId', secret: false, label: 'Client ID', placeholder: 'Public Spotify client ID' }],
    aliases: ['spotify'],
    tools: [
      { name: 'spotify_me', sig: '{}', desc: 'read the connected Spotify profile' },
      { name: 'spotify_playlists', sig: '{}', desc: 'list Spotify playlists for the connected user' },
    ],
    async test() { return { ok: false, detail: 'Use the Spotify sign-in button.' }; },
    async run(tool, args, cred, fetchImpl) {
      if (tool === 'spotify_me') {
        const data = await call('https://api.spotify.com/v1/me', { headers: bearer(cred.key), secret: cred.key, fetchImpl });
        return `Spotify user: ${data.display_name || data.id}.`;
      }
      const data = await call('https://api.spotify.com/v1/me/playlists?limit=8', { headers: bearer(cred.key), secret: cred.key, fetchImpl });
      const list = lines((data.items || []).map((item) => `- ${item.name} — ${item.external_urls?.spotify || ''}`));
      return list.length ? `Spotify playlists:\n${list.join('\n')}` : 'No Spotify playlists were returned.';
    },
  },
  {
    id: 'dropbox', name: 'Dropbox', group: 'Sign-in', auth: 'oauth',
    hint: 'Create a Dropbox app and paste its app key. Sign-in uses PKCE, so there is no app secret. Register the redirect URI shown here.',
    setup: 'Create a Dropbox app with the account and file metadata scopes, then paste the app key.',
    setupUrl: 'https://www.dropbox.com/developers/apps',
    placeholder: '',
    fields: [{ id: 'clientId', secret: false, label: 'App key', placeholder: 'Dropbox app key' }],
    aliases: ['dropbox'],
    tools: [
      { name: 'dropbox_account', sig: '{}', desc: 'read the connected Dropbox account' },
      { name: 'dropbox_files', sig: '{}', desc: 'list files in the Dropbox root folder' },
    ],
    async test() { return { ok: false, detail: 'Use the Dropbox sign-in button.' }; },
    async run(tool, args, cred, fetchImpl) {
      if (tool === 'dropbox_account') {
        const data = await call('https://api.dropboxapi.com/2/users/get_current_account', {
          method: 'POST', headers: { ...bearer(cred.key), 'Content-Type': 'application/json' }, body: 'null', secret: cred.key, fetchImpl,
        });
        return `Dropbox account: ${data.name?.display_name || data.email || 'connected'}.`;
      }
      const data = await call('https://api.dropboxapi.com/2/files/list_folder', {
        method: 'POST', headers: { ...bearer(cred.key), 'Content-Type': 'application/json' }, secret: cred.key, fetchImpl,
        body: { path: '', limit: 8 },
      });
      const list = lines((data.entries || []).map((item) => `- ${item.name}`));
      return list.length ? `Dropbox files:\n${list.join('\n')}` : 'The Dropbox folder is empty.';
    },
  },
  {
    id: 'gdrive', name: 'Google Drive', group: 'Sign-in', auth: 'oauth',
    hint: 'Create a Google OAuth client and paste its public client ID. Access is read-only. Register the redirect URI shown here.',
    setup: 'Create a Web application OAuth client and enable the Drive API.',
    setupUrl: 'https://console.cloud.google.com/apis/credentials',
    placeholder: '',
    fields: [{ id: 'clientId', secret: false, label: 'Client ID', placeholder: 'Public Google client ID' }],
    aliases: ['google drive', 'gdrive'],
    tools: [
      { name: 'gdrive_about', sig: '{}', desc: 'read the connected Google Drive user' },
      { name: 'gdrive_files', sig: '{}', desc: 'list recent Google Drive files' },
    ],
    async test() { return { ok: false, detail: 'Use the Google Drive sign-in button.' }; },
    async run(tool, args, cred, fetchImpl) {
      if (tool === 'gdrive_about') {
        const data = await call('https://www.googleapis.com/drive/v3/about?fields=user', { headers: bearer(cred.key), secret: cred.key, fetchImpl });
        return `Google Drive user: ${data.user?.displayName || data.user?.emailAddress || 'connected'}.`;
      }
      const data = await call('https://www.googleapis.com/drive/v3/files?pageSize=8&fields=files(name,webViewLink)', { headers: bearer(cred.key), secret: cred.key, fetchImpl });
      const list = lines((data.files || []).map((file) => `- ${file.name}${file.webViewLink ? ` — ${file.webViewLink}` : ''}`));
      return list.length ? `Google Drive files:\n${list.join('\n')}` : 'No Google Drive files were returned.';
    },
  },
  {
    id: 'pexels', name: 'Pexels', group: 'Media', auth: 'token',
    hint: 'Paste a Pexels API key. The agent can search photos. The key is not shown to the model.',
    setup: 'Request a Pexels API key.',
    setupUrl: 'https://www.pexels.com/api/',
    placeholder: 'Pexels key',
    fields: [keyField('Pexels key', 'API key')],
    aliases: ['pexels'],
    tools: [
      { name: 'pexels_search', sig: '{"query":"forest"}', desc: 'search Pexels photos' },
      { name: 'pexels_curated', sig: '{}', desc: 'list curated Pexels photos' },
    ],
    async test(cred, fetchImpl) {
      await call('https://api.pexels.com/v1/curated?per_page=1', { headers: bearer(cred.key), secret: cred.key, fetchImpl });
      return { ok: true, detail: 'Pexels key works.' };
    },
    async run(tool, args, cred, fetchImpl) {
      const url = tool === 'pexels_search'
        ? `https://api.pexels.com/v1/search?per_page=5&query=${encodeURIComponent(clip(args.query || args.q || 'nature', 80))}`
        : 'https://api.pexels.com/v1/curated?per_page=5';
      const data = await call(url, { headers: bearer(cred.key), secret: cred.key, fetchImpl });
      const list = lines((data.photos || []).map((photo) => `- ${photo.alt || 'Photo'} by ${photo.photographer} — ${photo.url}`));
      return list.length ? `Pexels photos:\n${list.join('\n')}` : 'Pexels returned no photos.';
    },
  },
  {
    id: 'unsplash', name: 'Unsplash', group: 'Media', auth: 'token',
    hint: 'Paste an Unsplash access key. The agent can search photos. The key is not shown to the model.',
    setup: 'Create an Unsplash application and copy the access key.',
    setupUrl: 'https://unsplash.com/oauth/applications',
    placeholder: 'Access key',
    fields: [keyField('Access key', 'Access key')],
    aliases: ['unsplash'],
    tools: [
      { name: 'unsplash_search', sig: '{"query":"forest"}', desc: 'search Unsplash photos' },
      { name: 'unsplash_photos', sig: '{}', desc: 'list recent Unsplash photos' },
    ],
    async test(cred, fetchImpl) {
      await call('https://api.unsplash.com/photos?per_page=1', { headers: { Authorization: `Client-ID ${cred.key}` }, secret: cred.key, fetchImpl });
      return { ok: true, detail: 'Unsplash key works.' };
    },
    async run(tool, args, cred, fetchImpl) {
      const headers = { Authorization: `Client-ID ${cred.key}` };
      const url = tool === 'unsplash_search'
        ? `https://api.unsplash.com/search/photos?per_page=5&query=${encodeURIComponent(clip(args.query || args.q || 'nature', 80))}`
        : 'https://api.unsplash.com/photos?per_page=5';
      const data = await call(url, { headers, secret: cred.key, fetchImpl });
      const photos = data.results || data;
      const list = lines((Array.isArray(photos) ? photos : []).map((photo) => `- ${photo.alt_description || photo.description || 'Photo'} by ${photo.user?.name || 'someone'} — ${photo.links?.html || ''}`));
      return list.length ? `Unsplash photos:\n${list.join('\n')}` : 'Unsplash returned no photos.';
    },
  },
  {
    id: 'openweather', name: 'OpenWeather', group: 'Media', auth: 'token',
    hint: 'Paste an OpenWeather API key. The agent can read the current weather for a city.',
    setup: 'Create an OpenWeather API key.',
    setupUrl: 'https://home.openweathermap.org/api_keys',
    placeholder: 'OpenWeather key',
    fields: [keyField('OpenWeather key', 'API key')],
    aliases: ['openweather'],
    tools: [
      { name: 'openweather_now', sig: '{"city":"Paris"}', desc: 'read the current weather for a city' },
      { name: 'openweather_geo', sig: '{"city":"Paris"}', desc: 'look up a city with OpenWeather' },
    ],
    async test(cred, fetchImpl) {
      await call(`https://api.openweathermap.org/data/2.5/weather?q=London&appid=${encodeURIComponent(cred.key)}&units=metric`, { secret: cred.key, fetchImpl });
      return { ok: true, detail: 'OpenWeather key works.' };
    },
    async run(tool, args, cred, fetchImpl) {
      const city = clip(args.city || args.q || args.query, 80);
      if (!city) throw new Error('Name a city.');
      if (tool === 'openweather_geo') {
        const data = await call(`https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(city)}&limit=1&appid=${encodeURIComponent(cred.key)}`, { secret: cred.key, fetchImpl });
        const place = Array.isArray(data) ? data[0] : null;
        return place ? `${place.name}, ${place.country} is at ${place.lat}, ${place.lon}.` : 'OpenWeather did not find that place.';
      }
      const data = await call(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${encodeURIComponent(cred.key)}&units=metric`, { secret: cred.key, fetchImpl });
      const temp = data.main?.temp;
      const desc = data.weather?.[0]?.description || 'unknown';
      return `${data.name || city}: ${temp ?? '?'}°C, ${desc}.`;
    },
  },
  {
    id: 'stripe', name: 'Stripe test', group: 'Media', auth: 'token',
    hint: 'Paste a test secret key or a restricted test key. Live keys are refused. Agora only reads the balance and recent customers.',
    setup: 'Copy a test secret key from the Stripe dashboard.',
    setupUrl: 'https://dashboard.stripe.com/test/apikeys',
    placeholder: 'sk_test_…',
    fields: [keyField('sk_test_…', 'Test secret key')],
    aliases: ['stripe'],
    tools: [
      { name: 'stripe_balance', sig: '{}', desc: 'read the Stripe test balance' },
      { name: 'stripe_customers', sig: '{}', desc: 'list recent Stripe test customers' },
    ],
    async test(cred, fetchImpl) {
      stripeKey(cred.key);
      await call('https://api.stripe.com/v1/balance', { headers: bearer(cred.key), secret: cred.key, fetchImpl });
      return { ok: true, detail: 'Stripe test key works. Only reads are used.' };
    },
    async run(tool, args, cred, fetchImpl) {
      stripeKey(cred.key);
      if (tool === 'stripe_customers') {
        const data = await call('https://api.stripe.com/v1/customers?limit=5', { headers: bearer(cred.key), secret: cred.key, fetchImpl });
        const list = lines((data.data || []).map((item) => `- ${item.name || item.id}${item.email ? ` — ${item.email}` : ''}`));
        return list.length ? `Stripe test customers:\n${list.join('\n')}` : 'No Stripe test customers were returned.';
      }
      const data = await call('https://api.stripe.com/v1/balance', { headers: bearer(cred.key), secret: cred.key, fetchImpl });
      const available = (data.available || []).map((item) => `${(item.amount / 100).toFixed(2)} ${String(item.currency || '').toUpperCase()}`);
      return `Stripe test balance: ${available.join(', ') || '0'}.`;
    },
  },
];

function stripeKey(key) {
  if (!/^sk_test_|^rk_test_/.test(String(key || ''))) {
    throw new Error('Paste a Stripe test key that starts with sk_test_ or rk_test_. Live keys are not accepted.');
  }
}

async function linearQuery(cred, query, fetchImpl) {
  return call('https://api.linear.app/graphql', {
    method: 'POST', secret: cred.key, fetchImpl,
    headers: { ...bearer(cred.key), 'Content-Type': 'application/json' },
    body: { query },
  });
}

async function postDiscord(webhook, content, fetchImpl) {
  const url = httpsOnly(webhook, 'https://discord.com/api/webhooks/', 'Discord webhook');
  await call(url, {
    method: 'POST', secret: webhook, fetchImpl,
    headers: { 'Content-Type': 'application/json' },
    body: { content },
  });
}

async function postSlack(webhook, text, fetchImpl) {
  const url = httpsOnly(webhook, 'https://hooks.slack.com/services/', 'Slack webhook');
  await call(url, {
    method: 'POST', form: true, secret: webhook, fetchImpl,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ payload: JSON.stringify({ text }) }),
  });
}

async function bskySession(cred, fetchImpl) {
  if (!cred.handle || !cred.key) throw new Error('Enter the Bluesky handle and app password.');
  const data = await call('https://bsky.social/xrpc/com.atproto.server.createSession', {
    method: 'POST', secret: cred.key, fetchImpl,
    headers: { 'Content-Type': 'application/json' },
    body: { identifier: cred.handle, password: cred.key },
  });
  if (!data.accessJwt || !data.handle) throw new Error('Bluesky did not start a session.');
  return { handle: data.handle, accessJwt: data.accessJwt };
}

export function specById(id) {
  return CONNECTOR_SPECS.find((item) => item.id === id) || null;
}

export function specForTool(name) {
  return CONNECTOR_SPECS.find((item) => item.tools.some((tool) => tool.name === name)) || null;
}

export function intentFor(text) {
  const raw = String(text || '').trim();
  const lower = raw.toLowerCase();
  if (/\bgithub\b/.test(lower) && /\bgist\b/.test(lower) && /\b(create|make|new|save)\b/.test(lower)) {
    const content = raw.replace(/^[\s\S]*?\bgist\b[:\s-]*/i, '').trim().slice(0, 4000);
    return { id: 'github', tool: 'github_create_gist', args: { content, filename: 'note.md', description: 'Note from Agora' } };
  }
  for (const spec of CONNECTOR_SPECS) {
    if (!spec.aliases.some((alias) => new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower))) continue;
    let tool = spec.tools.find((item) => {
      if (item.name.endsWith('_send')) return /\b(send|post|message)\b/i.test(lower);
      if (/list_models|models|engines|voices/.test(item.name)) return /\b(model|models|engine|engines|voice|voices)\b/i.test(lower);
      if (/balance|customers/.test(item.name)) return /\b(balance|customer|customers)\b/i.test(lower);
      if (/project|repo|board|task|issue|playlist|file|photo|search/.test(item.name)) return /\b(project|projects|repo|repos|board|boards|task|tasks|issue|issues|playlist|playlists|file|files|photo|photos|search|find)\b/i.test(lower);
      if (/weather_now|weather_geo/.test(item.name)) return item.name.endsWith('_geo') ? /\b(where|geo|coordinate)/i.test(lower) : /\b(weather|forecast)\b/i.test(lower);
      return false;
    });
    if (!tool && spec.id === 'openweather') tool = spec.tools[0];
    if (tool) {
      const args = {};
      if (tool.name === 'notion_search' || tool.name === 'pexels_search' || tool.name === 'unsplash_search') {
        args.query = queryFrom(raw, /\b(notion|pexels|unsplash|search|find|photos?|for)\b/ig);
      }
      if (tool.name.startsWith('openweather')) args.city = cityFrom(raw);
      if (tool.name === 'discord_send' || tool.name === 'slack_send' || tool.name === 'telegram_send') {
        args.text = queryFrom(raw, /\b(discord|slack|telegram|send|post|message|a|the|to)\b/ig);
        args.content = args.text;
      }
      return { id: spec.id, tool: tool.name, args };
    }
    return { id: spec.id, tool: '', args: {} };
  }
  return null;
}
