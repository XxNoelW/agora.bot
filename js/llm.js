// WebLLM wrapper (lazy loaded from CDN)
let webllm = null;
let engine = null;
let loadedModel = null;
let loading = null;
const statusListeners = new Set();
export let status = { text: 'Model: not loaded', progress: 0, ready: false };

export const onStatus = (fn) => { statusListeners.add(fn); fn(status); };
export const offStatus = (fn) => statusListeners.delete(fn);
function setStatus(s) { status = { ...status, ...s }; statusListeners.forEach((f) => f(status)); }

export function webgpuSupported() { return typeof navigator !== 'undefined' && 'gpu' in navigator; }

export async function checkWebGPU() {
  if (!webgpuSupported()) return { ok: false, reason: 'WebGPU is not available in this browser. Use a recent Chrome/Edge (113+) on desktop, or enable WebGPU in your browser flags.' };
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { ok: false, reason: 'WebGPU is present but no GPU adapter was found (blocked GPU or unsupported hardware).' };
    return { ok: true };
  } catch (e) { return { ok: false, reason: 'WebGPU error: ' + e.message }; }
}

export async function loadModel(modelId) {
  if (engine && loadedModel === modelId) return engine;
  if (loading) return loading;
  loading = (async () => {
    const chk = await checkWebGPU();
    if (!chk.ok) { setStatus({ text: '⚠️ ' + chk.reason, ready: false }); throw new Error(chk.reason); }
    setStatus({ text: 'Loading WebLLM library…', progress: 0, ready: false });
    if (!webllm) webllm = await import('https://esm.run/@mlc-ai/web-llm');
    const cb = (r) => setStatus({ text: r.text, progress: r.progress ?? 0 });
    if (engine) { await engine.reload(modelId); }
    else engine = await webllm.CreateMLCEngine(modelId, { initProgressCallback: cb });
    loadedModel = modelId;
    setStatus({ text: '✅ Ready: ' + modelId, progress: 1, ready: true });
    return engine;
  })();
  try { return await loading; }
  catch (e) { setStatus({ text: '❌ ' + e.message, ready: false }); throw e; }
  finally { loading = null; }
}

export function isReady(modelId) { return !!engine && loadedModel === modelId; }

// Streams a chat completion. onToken(fullTextSoFar). Returns final text.
export async function chat(modelId, messages, { temperature = 0.7, maxTokens = 512, onToken, signal, stop } = {}) {
  const eng = await loadModel(modelId);
  const stream = await eng.chat.completions.create({
    messages, temperature, top_p: 0.9, max_tokens: maxTokens, stream: true,
    frequency_penalty: 0.3, ...(stop ? { stop } : {}),
  });
  let out = '';
  for await (const chunk of stream) {
    if (signal?.aborted) { try { eng.interruptGenerate(); } catch {} break; }
    out += chunk.choices[0]?.delta?.content || '';
    onToken?.(out);
  }
  return out.trim();
}
