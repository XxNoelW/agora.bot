// Community agents. The published object is only the definition.
import { cloudCode, cloudUrl } from './cloud.js';
import { scrubDefinition } from './builtins.js';
import { uid } from './store.js';

export function publishPreview(agent, { names = [] } = {}) {
  const { def, warnings } = scrubDefinition(agent, { names });
  return {
    def: {
      name: def.name,
      emoji: def.emoji,
      description: def.description,
      instructions: def.instructions,
      lang: def.nameHu ? 'hu' : 'en',
      tools: def.tools,
      examples: def.examples,
    },
    warnings,
  };
}

export function agentFromInstall(row) {
  return {
    id: uid('a_'),
    name: String(row?.name || 'Agent').slice(0, 40),
    nameHu: '',
    role: 'custom',
    builtin: '',
    emoji: String(row?.emoji || '').slice(0, 8),
    description: String(row?.description || '').slice(0, 180),
    descriptionHu: '',
    prompt: String(row?.instructions || '').slice(0, 4000),
    examples: Array.isArray(row?.examples) ? row.examples.slice(0, 6) : [],
    examplesHu: [],
    tools: Array.isArray(row?.tools) ? row.tools.slice(0, 24) : ['web_search', 'read_page'],
    connectors: [],
    sourceId: String(row?.id || ''),
    status: 'idle',
    paused: false,
    error: '',
    taskId: null,
  };
}

async function call(path, { method = 'GET', body, auth = false, fetchImpl = fetch, base = cloudUrl() } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && cloudCode()) headers.Authorization = `Bearer ${cloudCode()}`;
  let res;
  try {
    res = await fetchImpl(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, data: { error: 'offline' } };
  }
  let data = {};
  try { data = await res.json(); } catch { data = {}; }
  return { ok: res.ok, status: res.status, data };
}

export function listPublished(query = '', sort = 'popular', opts = {}) {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (sort) params.set('sort', sort);
  const suffix = params.toString() ? `?${params}` : '';
  return call(`/agents${suffix}`, opts);
}

export function publishAgent(def, opts = {}) {
  return call('/agents', { method: 'POST', body: def, auth: true, ...opts });
}

export function installPublished(id, opts = {}) {
  return call(`/agents/${encodeURIComponent(id)}/install`, { method: 'POST', ...opts });
}

export function reportPublished(id, opts = {}) {
  return call(`/agents/${encodeURIComponent(id)}/report`, { method: 'POST', ...opts });
}
