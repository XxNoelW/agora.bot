// OpenRouter client for the static site. The key never lives in this file.

export const MODELS_URL = 'https://openrouter.ai/api/v1/models';
export const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const KEY_NAME = 'agona:openrouter-key';

// Live smoke on 2026-11-12: the first returned a provider error, the second
// returned ok with an empty message.content. They stay eligible, but they are
// not the defaults while a non-reasoning free model is on the list.
const WEAK_FREE_IDS = new Set([
  'google/gemma-4-26b-a4b-it:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
]);
const PREFERRED_FAMILY = /qwen|deepseek|llama|mistral/i;
const SKIP_FREE = /lyria|openrouter\/free|audio/i;

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
  const reasoning = raw.reasoning && typeof raw.reasoning === 'object' ? {
    mandatory: raw.reasoning.mandatory === true,
    defaultEnabled: raw.reasoning.default_enabled === true,
    efforts: Array.isArray(raw.reasoning.supported_efforts) ? raw.reasoning.supported_efforts.map(String) : [],
  } : null;
  const modality = raw.architecture && typeof raw.architecture === 'object' ? String(raw.architecture.modality || '') : '';
  return {
    id,
    name: String(raw.name || id),
    promptPrice,
    completionPrice,
    contextLength: Number.isFinite(contextLength) ? contextLength : null,
    license: typeof raw.license === 'string' ? raw.license : '',
    reasoning,
    textOnly: modality ? modality === 'text->text' : null,
  };
}

export function isReasoningFirst(model) {
  const id = `${model?.id || ''} ${model?.name || ''}`;
  if (/reasoning|thinking|\br1\b/i.test(id)) return true;
  if (model?.reasoning?.mandatory || model?.reasoning?.defaultEnabled) return true;
  return false;
}

export function isInstructModel(model) {
  return /instruct|-it(?=:|$)/i.test(`${model?.id || ''} ${model?.name || ''}`);
}

export function canAskNoReasoning(model) {
  const info = model?.reasoning;
  if (info?.mandatory) return false;
  if (info?.efforts?.length && !info.efforts.includes('none')) return false;
  return true;
}

function teacherRank(model) {
  const preferred = PREFERRED_FAMILY.test(model.id) || PREFERRED_FAMILY.test(model.name || '');
  const reasoning = isReasoningFirst(model);
  let score = 60;
  if (preferred && !reasoning) score = 0;
  else if (preferred) score = 10;
  else if (isInstructModel(model) && !reasoning) score = 20;
  else if (!reasoning) score = 30;
  else if (canAskNoReasoning(model)) score = 40;
  if (model.textOnly === false) score += 3;
  if (/code/i.test(model.id)) score += 2;
  if (WEAK_FREE_IDS.has(model.id)) score += 15;
  return score;
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

export function pickTeacherCandidates(models, limit = 4) {
  const list = (models || []).map((item) => (typeof item === 'string' ? { id: item } : item)).filter((item) => item?.id);
  const free = list.filter((item) => isFreeModelId(item.id) && !SKIP_FREE.test(item.id));
  const ranked = free
    .map((item, index) => ({ item, index, score: teacherRank(item) }))
    .sort((a, b) => a.score - b.score || a.index - b.index);
  const picked = [];
  for (const row of ranked) {
    if (!picked.includes(row.item.id)) picked.push(row.item.id);
    if (picked.length >= limit) break;
  }
  return picked;
}

export function pickDefaultTeacherIds(models) {
  return pickTeacherCandidates(models, 2);
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
    return content.map((part) => (typeof part === 'string' ? part : part?.text || part?.content || '')).join('');
  }
  return '';
}

export function extractAnswer(message) {
  const content = messageText(message?.content).trim();
  if (content) return { text: content, source: 'content' };
  const details = Array.isArray(message?.reasoning_details)
    ? message.reasoning_details.map((part) => messageText(part?.text || part?.content)).join('')
    : '';
  const reasoning = [messageText(message?.reasoning), messageText(message?.reasoning_content), details]
    .map((part) => part.trim())
    .find(Boolean) || '';
  if (reasoning) return { text: reasoning, source: 'reasoning' };
  return { text: '', source: '' };
}

function resolveModel(model, catalog) {
  if (model && typeof model === 'object') return model;
  const id = String(model || '');
  return (catalog || []).find((item) => item.id === id) || { id };
}

function providerFailure(data, status, key) {
  const providerCode = data?.error?.code != null ? String(data.error.code) : String(status);
  const detail = redactSecrets(data?.error?.message || `OpenRouter problem (${status}).`, key);
  const message = detail.includes(providerCode) ? detail : `${detail} (${providerCode})`;
  const err = new Error(message);
  err.code = status === 401 || status === 403 ? 'auth' : 'provider';
  err.status = status;
  return err;
}

function summarizeFailures(attempts) {
  const fails = (attempts || []).filter((item) => !item.ok);
  if (!fails.length) return 'No teacher answered.';
  const last = fails[fails.length - 1];
  const same = fails.every((item) => item.message === last.message);
  if (same && fails.length > 1) return `${last.message} (tried ${fails.length} times)`;
  return fails.map((item) => item.message).join('; ');
}

function retryable(err) {
  return err?.code === 'provider' || err?.code === 'empty' || err?.code === 'timeout' || err?.code === 'network' || err?.code === 'http';
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
  catalog,
  reasoningMode = 'suppress',
} = {}) {
  const key = getKey();
  if (!key) {
    const err = new Error('There is no OpenRouter key in this browser.');
    err.code = 'no_key';
    throw err;
  }
  const record = resolveModel(model, catalog);
  if (!record.id) {
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
  const reasoningFirst = isReasoningFirst(record);
  const tokens = reasoningFirst ? Math.max(Number(maxTokens) || 0, 800) : maxTokens;
  const payload = {
    model: record.id,
    messages: messages || [{ role: 'user', content: String(prompt ?? '') }],
    max_tokens: tokens,
    temperature: 0.3,
  };
  if (reasoningMode === 'suppress' && reasoningFirst && canAskNoReasoning(record)) {
    payload.reasoning = { effort: 'none' };
  }
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
      body: JSON.stringify(payload),
    });
    let data = {};
    try { data = await response.json(); }
    catch { data = {}; }
    if (!response.ok || data?.error) {
      throw providerFailure(data, response.status, key);
    }
    const answer = extractAnswer(data?.choices?.[0]?.message);
    if (!answer.text) {
      const err = new Error('The model returned no answer text.');
      err.code = 'empty';
      throw err;
    }
    return {
      text: answer.text,
      source: answer.source,
      model: data.model || record.id,
      version: data.model || record.id,
    };
  } catch (err) {
    if (signal?.aborted) {
      const stop = new Error('Stopped.');
      stop.code = 'abort';
      throw stop;
    }
    if (err?.code === 'no_key' || err?.code === 'no_model' || err?.code === 'auth' || err?.code === 'http' || err?.code === 'provider' || err?.code === 'empty' || err?.code === 'blocked_url') throw err;
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

export async function completeWithFallback(prompt, {
  models,
  beforeExtraCall,
  catalog,
  ...rest
} = {}) {
  const list = [...new Set((models || []).filter(Boolean))];
  if (!list.length) {
    const err = new Error('No teacher model is picked.');
    err.code = 'no_model';
    throw err;
  }
  const attempts = [];
  let last = null;
  for (let index = 0; index < list.length; index += 1) {
    const model = list[index];
    for (let tryNo = 0; tryNo < 2; tryNo += 1) {
      if (index > 0 || tryNo > 0) beforeExtraCall?.();
      try {
        const result = await completeOpenRouter(model, prompt, {
          ...rest,
          catalog,
          maxTokens: tryNo > 0 ? Math.max(rest.maxTokens || 400, 1200) : rest.maxTokens,
          reasoningMode: tryNo === 0 ? 'suppress' : 'allow',
        });
        attempts.push({ model: result.model || model, ok: true, try: tryNo + 1, source: result.source });
        return { ...result, attempts };
      } catch (err) {
        if (err?.code === 'auth' || err?.code === 'abort' || err?.code === 'no_key' || err?.code === 'blocked_url' || err?.code === 'limit' || err?.code === 'no_model') {
          throw err;
        }
        const message = `${model}: ${redactSecrets(err?.message || 'The call did not work.', rest.getKey?.())}`;
        attempts.push({ model, ok: false, try: tryNo + 1, code: err?.code || 'error', message });
        last = err;
        if (!retryable(err)) break;
      }
    }
  }
  const err = new Error(summarizeFailures(attempts));
  err.code = last?.code || 'provider';
  err.attempts = attempts;
  throw err;
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
