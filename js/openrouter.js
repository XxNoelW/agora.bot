// OpenRouter client for the static site. The key never lives in this file.

export const MODELS_URL = 'https://openrouter.ai/api/v1/models';
export const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const KEY_NAME = 'agona:openrouter-key';

// Checked against the public model list on 2026-11-12. That list had no
// Qwen or DeepSeek id ending in :free. These two did exist and are free.
export const VERIFIED_FREE_FALLBACK = [
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
];

const ALLOWED = new Set([MODELS_URL, CHAT_URL]);

export function assertOpenRouterUrl(url) {
  const parsed = new URL(String(url));
  if (parsed.origin !== 'https://openrouter.ai' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    const err = new Error('Only the two known openrouter.ai addresses can be called.');
    err.code = 'blocked_url';
    throw err;
  }
  if (!ALLOWED.has(parsed.href)) {
    const err = new Error('That OpenRouter address is not allowed.');
    err.code = 'blocked_url';
    throw err;
  }
  return parsed.href;
}

export function readOpenRouterKey(storage = globalThis.localStorage) {
  try { return storage?.getItem(KEY_NAME) || ''; }
  catch { return ''; }
}

export function writeOpenRouterKey(key, storage = globalThis.localStorage) {
  const clean = String(key || '').trim();
  if (!clean) {
    forgetOpenRouterKey(storage);
    return;
  }
  storage.setItem(KEY_NAME, clean);
}

export function forgetOpenRouterKey(storage = globalThis.localStorage) {
  try { storage?.removeItem(KEY_NAME); }
  catch { /* private mode */ }
}

export function redactSecrets(text, key = '') {
  let out = String(text ?? '');
  const secret = key || readOpenRouterKey();
  if (secret && secret.length > 4) out = out.split(secret).join('••••');
  out = out.replace(/sk-or-v1-[A-Za-z0-9_-]+/g, '••••');
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer ••••');
  return out;
}

export function isFreeModelId(id) {
  return /:free$/i.test(String(id || ''));
}

export function normalizeCatalogModel(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  if (!id) return null;
  const promptPrice = raw.pricing && raw.pricing.prompt != null ? String(raw.pricing.prompt) : '';
  const completionPrice = raw.pricing && raw.pricing.completion != null ? String(raw.pricing.completion) : '';
  const contextLength = Number(raw.context_length);
  return {
    id,
    name: String(raw.name || id),
    promptPrice,
    completionPrice,
    contextLength: Number.isFinite(contextLength) ? contextLength : null,
    license: typeof raw.license === 'string' ? raw.license : '',
  };
}

export function formatPrice(model) {
  if (!model || (model.promptPrice === '' && model.completionPrice === '')) return 'The list does not show a price.';
  const part = (value, label) => {
    if (value === '' || value == null) return `${label}: not listed`;
    const num = Number(value);
    if (!Number.isFinite(num)) return `${label}: not listed`;
    if (num === 0) return `${label}: 0 USD per token`;
    return `${label}: ${value} USD per token`;
  };
  const limit = model.contextLength ? ` Context: ${model.contextLength} tokens.` : '';
  return `${part(model.promptPrice, 'reading')}, ${part(model.completionPrice, 'writing')}.${limit}`;
}

export function pickDefaultTeacherIds(models) {
  const list = (models || []).map((item) => (typeof item === 'string' ? { id: item } : item)).filter((item) => item?.id);
  const free = list.filter((item) => isFreeModelId(item.id) && !/lyria|openrouter\/free/i.test(item.id));
  const qwen = free.find((item) => /qwen/i.test(item.id));
  const deepseek = free.find((item) => /deepseek/i.test(item.id));
  const picked = [];
  const push = (id) => { if (id && !picked.includes(id)) picked.push(id); };
  if (qwen && deepseek) {
    push(qwen.id);
    push(deepseek.id);
    return picked.slice(0, 2);
  }
  push(qwen?.id);
  push(deepseek?.id);
  for (const id of VERIFIED_FREE_FALLBACK) {
    if (free.some((item) => item.id === id)) push(id);
  }
  for (const item of free) push(item.id);
  return picked.slice(0, 2);
}

export function reserveCall(bucket, limits) {
  return reserveCalls(bucket, limits, 1);
}

export function reserveCalls(bucket, limits, count) {
  const n = Math.max(1, count | 0);
  if (bucket?.stopped) {
    const err = new Error('The run was stopped.');
    err.code = 'abort';
    throw err;
  }
  const perRun = limits?.perRun ?? 8;
  const global = limits?.global ?? 40;
  if ((bucket?.run || 0) + n > perRun) {
    const err = new Error(`This run hit its call limit (${perRun}). I stopped. No more calls went out.`);
    err.code = 'limit';
    throw err;
  }
  if ((bucket?.global || 0) + n > global) {
    const err = new Error(`The total call limit (${global}) is used up. I stopped. No more calls went out.`);
    err.code = 'limit';
    throw err;
  }
  bucket.run += n;
  bucket.global += n;
  return bucket;
}

function messageText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('');
  }
  return '';
}

export async function listModels({ fetchImpl = globalThis.fetch, signal } = {}) {
  const url = assertOpenRouterUrl(MODELS_URL);
  const response = await fetchImpl(url, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) {
    const err = new Error(`The model list did not load (${response.status}).`);
    err.code = 'http';
    throw err;
  }
  const data = await response.json();
  const rows = Array.isArray(data?.data) ? data.data : [];
  return rows.map(normalizeCatalogModel).filter(Boolean);
}

export async function completeOpenRouter(model, prompt, {
  getKey = readOpenRouterKey,
  fetchImpl = globalThis.fetch,
  signal,
  maxTokens = 400,
  messages,
  timeoutMs = 45000,
} = {}) {
  const key = getKey();
  if (!key) {
    const err = new Error('There is no OpenRouter key in this browser.');
    err.code = 'no_key';
    throw err;
  }
  if (!model) {
    const err = new Error('No teacher model is picked.');
    err.code = 'no_model';
    throw err;
  }
  const url = assertOpenRouterUrl(CHAT_URL);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const onAbort = () => ctl.abort();
  signal?.addEventListener?.('abort', onAbort);
  const referer = (typeof location !== 'undefined' && location.origin && location.origin !== 'null')
    ? location.origin
    : 'https://xxnoelw.github.io/agora.bot';
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'HTTP-Referer': referer,
        'X-Title': 'Agona',
      },
      body: JSON.stringify({
        model,
        messages: messages || [{ role: 'user', content: String(prompt ?? '') }],
        max_tokens: maxTokens,
        temperature: 0.3,
      }),
    });
    let data = {};
    try { data = await response.json(); }
    catch { data = {}; }
    if (!response.ok) {
      const detail = redactSecrets(data?.error?.message || `OpenRouter problem (${response.status}).`, key);
      const err = new Error(detail);
      err.code = response.status === 401 || response.status === 403 ? 'auth' : 'http';
      throw err;
    }
    const text = messageText(data?.choices?.[0]?.message?.content).trim();
    return {
      text,
      model: data.model || model,
      version: data.model || model,
    };
  } catch (err) {
    if (signal?.aborted) {
      const stop = new Error('Stopped.');
      stop.code = 'abort';
      throw stop;
    }
    if (err?.code === 'no_key' || err?.code === 'no_model' || err?.code === 'auth' || err?.code === 'http' || err?.code === 'blocked_url') throw err;
    if (err?.name === 'AbortError') {
      const stop = new Error(signal?.aborted ? 'Stopped.' : 'OpenRouter took too long to answer.');
      stop.code = signal?.aborted ? 'abort' : 'timeout';
      throw stop;
    }
    const wrapped = new Error(redactSecrets(err?.message || 'The OpenRouter call did not work.', key));
    wrapped.code = 'network';
    throw wrapped;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}

export function createOpenRouterAdapter({ getKey = readOpenRouterKey, fetchImpl = globalThis.fetch } = {}) {
  return {
    id: 'openrouter',
    label: 'OpenRouter',
    async testConnection(opts = {}) {
      try {
        const res = await completeOpenRouter(opts.model, 'Reply with one word: ok', {
          getKey, fetchImpl, signal: opts.signal, maxTokens: 16,
        });
        return { ok: true, code: 'ok', message: `The connection works (${opts.model}). Start of the reply: ${redactSecrets(res.text, getKey()).slice(0, 40)}` };
      } catch (err) {
        return { ok: false, code: err.code || 'error', message: redactSecrets(err.message || 'The test did not work.', getKey()) };
      }
    },
    async complete(prompt, opts = {}) {
      return completeOpenRouter(opts.model, prompt, { ...opts, getKey, fetchImpl });
    },
  };
}
