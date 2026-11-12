// Picks OpenRouter when the visitor asked for it, otherwise the local WebLLM.
import { chat } from './llm.js';
import { state, save } from './store.js';
import { session } from './session.js';
import { completeWithFallback, pickTeacherCandidates, readOpenRouterKey, redactSecrets, reserveCall } from './openrouter.js';

export function chooseReplySource({ settings, key, gpuOk }) {
  const mode = settings?.replySource || 'auto';
  const model = settings?.openrouterChatModel || '';
  const remote = !!(key && model);
  if (mode === 'local') return 'local';
  if (mode === 'openrouter') return remote ? 'openrouter' : 'local';
  if (!gpuOk && remote) return 'openrouter';
  return 'local';
}

export function usingOpenRouter() {
  return chooseReplySource({
    settings: state.settings,
    key: readOpenRouterKey(),
    gpuOk: !!session.gpu?.ok,
  }) === 'openrouter';
}

function limits() {
  return {
    perRun: state.settings.orPerRun,
    global: state.settings.orGlobal,
  };
}

function bucket() {
  if (!session.runBucket) {
    session.runBucket = { run: 0, global: state.usage.openrouterCalls || 0, stopped: false };
  }
  session.runBucket.global = state.usage.openrouterCalls || 0;
  return session.runBucket;
}

export async function generate(modelId, messages, opts = {}) {
  if (!usingOpenRouter()) return chat(modelId, messages, opts);
  const current = bucket();
  reserveCall(current, limits());
  state.usage.openrouterCalls = current.global;
  save();
  try {
    const chatModel = state.settings.openrouterChatModel;
    const extras = pickTeacherCandidates(session.catalog || [], 4).filter((id) => id !== chatModel);
    const result = await completeWithFallback('', {
      models: [chatModel, ...extras].slice(0, 3),
      catalog: session.catalog || [],
      messages,
      signal: opts.signal,
      maxTokens: opts.maxTokens || 384,
      beforeExtraCall: () => {
        reserveCall(current, limits());
        state.usage.openrouterCalls = current.global;
        save();
      },
    });
    const text = redactSecrets(result.text || '');
    opts.onToken?.(text);
    return text;
  } catch (err) {
    if (err?.code === 'limit' || err?.code === 'abort') throw err;
    const wrapped = new Error(redactSecrets(err.message || 'OpenRouter did not answer.'));
    wrapped.code = err.code || 'llm';
    wrapped.friendly = wrapped.message;
    throw wrapped;
  }
}
