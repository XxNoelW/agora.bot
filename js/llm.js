// In-browser model via WebLLM. The CDN URL is pinned so a new release
// cannot silently change model ids or hang the import.
export const WEBLLM_VERSION = '0.2.87';
export const WEBLLM_URL = `https://esm.run/@mlc-ai/web-llm@${WEBLLM_VERSION}`;

const IMPORT_TIMEOUT_MS = 30_000;
const LOAD_STALL_MS = 120_000;
const LOAD_MAX_MS = 15 * 60_000;
const FIRST_TOKEN_MS = 120_000;
const TOKEN_STALL_MS = 45_000;
const GEN_MAX_MS = 4 * 60_000;
const GPU_TIMEOUT_MS = 8_000;

let webllm = null;
let libPromise = null;
let engine = null;
let loadedModel = null;
let loading = null;
let loadingModelId = null;
let loadEpoch = 0;
let genChain = Promise.resolve();

const statusListeners = new Set();
export let status = {
  text: 'A segéd még nincs betöltve',
  detail: '',
  progress: 0,
  ready: false,
  error: false,
  busy: false,
};

export class LlmError extends Error {
  constructor(message, { friendly, code } = {}) {
    super(message);
    this.name = 'LlmError';
    this.friendly = friendly || message;
    this.code = code || 'llm';
  }
}

export function friendlyMessage(e) {
  if (!e) return 'Valami hiba történt. Próbáld újra.';
  if (e.friendly) return e.friendly;
  if (e.name === 'AbortError' || e.code === 'abort') return 'Megállítva.';
  const m = String(e.message || e);
  if (/webgpu/i.test(m)) return 'Ez a böngésző nem tudja futtatni az agenteket. Chrome vagy Edge kell, ott, ahol van WebGPU. Enélkül a felület megnyílik, de válasz nem készül.';
  if (/timeout|timed out|stall|too long|went quiet/i.test(m)) return 'Túl sokáig tartott, ezért megálltam. Próbáld újra, vagy válassz kisebb modellt a beállításokban.';
  if (/failed to fetch|network|import|load failed/i.test(m)) return 'Nem sikerült letölteni a segédet. Ellenőrizd a netet, és próbáld újra.';
  if (/not found|unknown model|cannot find model|model_id/i.test(m)) return 'Ez a modell nem elérhető. Válassz másikat a beállításokban.';
  return 'Hiba történt válasz közben. Próbáld újra.';
}

export const onStatus = (fn) => { statusListeners.add(fn); fn(status); };
export const offStatus = (fn) => statusListeners.delete(fn);

function setStatus(patch) {
  status = { ...status, ...patch };
  statusListeners.forEach((fn) => {
    try { fn(status); } catch (err) { console.error(err); }
  });
}

export function friendlyLoadText(raw, progress) {
  const pct = progress > 0 && progress < 1 ? ` (${Math.round(progress * 100)}%)` : '';
  const t = String(raw || '');
  if (/fetch|download/i.test(t)) return `A segéd letöltése${pct}`;
  if (/cache/i.test(t)) return `A mentett segéd betöltése${pct}`;
  if (/shader|gpu|compil/i.test(t)) return `Indulás a grafikus chipen${pct}`;
  if (/lib/i.test(t)) return `A segédkönyvtár megnyitása${pct}`;
  if (!t) return `A segéd készül${pct}`;
  return t + pct;
}

export function withTimeout(promise, ms, friendly) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new LlmError(friendly, { friendly, code: 'timeout' }));
    }, ms);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

function watchdog(ms, makeError) {
  let timer;
  let rejectPromise;
  let wait = ms;
  const promise = new Promise((_, reject) => { rejectPromise = reject; });
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => rejectPromise(makeError()), wait);
  };
  arm();
  return {
    promise,
    bump(next) { if (next) wait = next; arm(); },
    clear() { clearTimeout(timer); },
  };
}

function abortPromise(signal) {
  return new Promise((_, reject) => {
    const stop = () => reject(new LlmError('Megállítva.', { friendly: 'Megállítva.', code: 'abort' }));
    if (signal.aborted) stop();
    else signal.addEventListener('abort', stop, { once: true });
  });
}

export function webgpuSupported() {
  return typeof navigator !== 'undefined' && !!navigator.gpu;
}

export async function checkWebGPU() {
  if (!webgpuSupported()) {
    return {
      ok: false,
      reason: 'Ez a böngésző nem tudja futtatni az agenteket. Chrome vagy Edge kell, WebGPU-val. Telefonon is csak ott megy, ahol van WebGPU. A felület ettől még megnyílik.',
    };
  }
  try {
    const adapter = await withTimeout(
      navigator.gpu.requestAdapter(),
      GPU_TIMEOUT_MS,
      'Nem találom a grafikus chipet az agentekhez. Próbáld Chrome-ban vagy Edge-ben.',
    );
    if (!adapter) {
      return {
        ok: false,
        reason: 'Ez a böngésző nem tudja használni a grafikus chipet. Próbáld Chrome-ban vagy Edge-ben. A felület ettől még megnyílik.',
      };
    }
    return { ok: true, reason: '' };
  } catch (e) {
    return { ok: false, reason: e.friendly || friendlyMessage(e) };
  }
}

async function getLib() {
  if (webllm) return webllm;
  if (!libPromise) {
    libPromise = import(/* @vite-ignore */ WEBLLM_URL)
      .then((mod) => { webllm = mod; return mod; })
      .catch((err) => { libPromise = null; throw err; });
  }
  try {
    return await withTimeout(
      libPromise,
      IMPORT_TIMEOUT_MS,
      'Nem sikerült letölteni a segédkönyvtárat. Ellenőrizd a netet, és próbáld újra.',
    );
  } catch (e) {
    if (e?.code === 'timeout') {
      // Keep libPromise so a later try can use the same import if it finishes.
      throw e;
    }
    libPromise = null;
    throw e.friendly ? e : new LlmError(e.message || 'import failed', { friendly: friendlyMessage(e) });
  }
}

async function dropEngine() {
  const current = engine;
  engine = null;
  loadedModel = null;
  if (!current) return;
  try { current.interruptGenerate?.(); } catch { /* already idle */ }
  try { await current.unload?.(); } catch { /* best effort */ }
}

async function doLoad(modelId) {
  const my = ++loadEpoch;
  const chk = await checkWebGPU();
  if (!chk.ok) {
    setStatus({ text: chk.reason, detail: '', progress: 0, ready: false, error: true, busy: false });
    throw new LlmError(chk.reason, { friendly: chk.reason, code: 'webgpu' });
  }
  setStatus({ text: 'A segédkönyvtár megnyitása…', detail: WEBLLM_URL, progress: 0, ready: false, error: false, busy: true });
  let lib;
  try { lib = await getLib(); }
  catch (e) {
    const friendly = e.friendly || friendlyMessage(e);
    setStatus({ text: friendly, detail: e.message || '', progress: 0, ready: false, error: true, busy: false });
    if (e.friendly) throw e;
    throw new LlmError(e.message || 'import failed', { friendly, code: e.code || 'llm' });
  }
  if (my !== loadEpoch) throw new LlmError('Megállítva.', { friendly: 'Megállítva.', code: 'abort' });

  const known = lib.prebuiltAppConfig?.model_list;
  if (Array.isArray(known) && known.length && !known.some((m) => m.model_id === modelId)) {
    const friendly = 'Ez a modell nem elérhető. Válassz másikat a beállításokban.';
    setStatus({ text: friendly, detail: modelId, progress: 0, ready: false, error: true, busy: false });
    throw new LlmError('unknown model ' + modelId, { friendly, code: 'model' });
  }

  const stalled = () => new LlmError(
    'download stalled',
    { friendly: 'A letöltés megállt. Ellenőrizd a netet, vagy válassz kisebb modellt a beállításokban.', code: 'timeout' },
  );
  const watch = watchdog(LOAD_STALL_MS, stalled);
  let maxTimer;
  const maxPromise = new Promise((_, reject) => {
    maxTimer = setTimeout(() => reject(new LlmError(
      'download too long',
      { friendly: 'A letöltés túl sokáig tartott. Próbáld újra, vagy válassz kisebb modellt.', code: 'timeout' },
    )), LOAD_MAX_MS);
  });
  const onProgress = (report) => {
    watch.bump();
    const progress = typeof report?.progress === 'number' ? report.progress : 0;
    setStatus({
      text: friendlyLoadText(report?.text, progress),
      detail: report?.text || '',
      progress,
      ready: false,
      error: false,
      busy: true,
    });
  };
  const task = (async () => {
    if (engine && loadedModel !== modelId) await engine.reload(modelId);
    else if (!engine) {
      const created = await lib.CreateMLCEngine(modelId, { initProgressCallback: onProgress });
      if (my !== loadEpoch) {
        try { await created.unload?.(); } catch { /* abandoned */ }
        return null;
      }
      engine = created;
    }
    if (my !== loadEpoch) return null;
    loadedModel = modelId;
    return engine;
  })();

  try {
    const ready = await Promise.race([task, watch.promise, maxPromise]);
    if (!ready || my !== loadEpoch) throw stalled();
    setStatus({ text: 'Kész a beszélgetésre', detail: modelId, progress: 1, ready: true, error: false, busy: false });
    return ready;
  } catch (e) {
    if (my === loadEpoch) loadEpoch += 1;
    await dropEngine();
    const friendly = e.friendly || friendlyMessage(e);
    setStatus({ text: friendly, detail: e.message || '', progress: 0, ready: false, error: true, busy: false });
    if (e.friendly) throw e;
    throw new LlmError(e.message || 'load failed', { friendly, code: e.code || 'llm' });
  } finally {
    watch.clear();
    clearTimeout(maxTimer);
  }
}

export function loadModel(modelId) {
  if (engine && loadedModel === modelId) return Promise.resolve(engine);
  if (loading && loadingModelId === modelId) return loading;
  const previous = loading;
  const run = (async () => {
    if (previous) { try { await previous; } catch { /* start a fresh load */ } }
    if (engine && loadedModel === modelId) return engine;
    return doLoad(modelId);
  })();
  loading = run;
  loadingModelId = modelId;
  run.then(() => {
    if (loading === run) { loading = null; loadingModelId = null; }
  }, () => {
    if (loading === run) { loading = null; loadingModelId = null; }
  });
  return run;
}

export function isReady(modelId) { return !!engine && loadedModel === modelId && status.ready; }

function locked(fn) {
  const run = genChain.then(() => fn(), () => fn());
  genChain = run.then(() => {}, () => {});
  return run;
}

async function openStream(eng, args) {
  try {
    return await eng.chat.completions.create(args);
  } catch (e) {
    const msg = String(e?.message || e);
    if (!/busy|locked|in progress|already generating|interrupted/i.test(msg)) throw e;
    try { eng.interruptGenerate(); } catch { /* ignore */ }
    await new Promise((resolve) => setTimeout(resolve, 300));
    return eng.chat.completions.create(args);
  }
}

// One model can only write one reply at a time. Calls wait in line.
export async function chat(modelId, messages, {
  temperature = 0.7,
  maxTokens = 384,
  onToken,
  signal,
  stop,
  shouldStop,
} = {}) {
  return locked(() => complete(modelId, messages, { temperature, maxTokens, onToken, signal, stop, shouldStop }));
}

async function complete(modelId, messages, { temperature, maxTokens, onToken, signal, stop, shouldStop }) {
  if (signal?.aborted || shouldStop?.()) {
    throw new LlmError('Megállítva.', { friendly: 'Megállítva.', code: signal?.aborted ? 'abort' : 'skip' });
  }
  // Stop must unblock the chat even while a big download continues in the background.
  const eng = await (signal ? Promise.race([loadModel(modelId), abortPromise(signal)]) : loadModel(modelId));
  if (signal?.aborted || shouldStop?.()) {
    try { eng.interruptGenerate(); } catch { /* idle */ }
    throw new LlmError('Megállítva.', { friendly: 'Megállítva.', code: signal?.aborted ? 'abort' : 'skip' });
  }

  const quiet = () => new LlmError(
    'generation stalled',
    { friendly: 'A segéd elhallgatott, ezért megálltam. Nem marad örökre „írja…” állapotban. Próbáld újra.', code: 'timeout' },
  );
  const watch = watchdog(FIRST_TOKEN_MS, quiet);
  let maxTimer;
  const maxPromise = new Promise((_, reject) => {
    maxTimer = setTimeout(() => reject(new LlmError(
      'reply too long',
      { friendly: 'A válasz túl sokáig tartott, ezért megálltam. Próbálj rövidebb kérdést, vagy kisebb modellt.', code: 'timeout' },
    )), GEN_MAX_MS);
  });
  const racers = [watch.promise, maxPromise];
  if (signal) racers.push(abortPromise(signal));

  let out = '';
  let streamError = null;
  try {
    const stream = await Promise.race([
      openStream(eng, {
        messages,
        temperature,
        top_p: 0.9,
        max_tokens: maxTokens,
        stream: true,
        frequency_penalty: 0.2,
        ...(stop?.length ? { stop } : {}),
      }),
      ...racers,
    ]);
    const reading = (async () => {
      try {
        for await (const chunk of stream) {
          if (signal?.aborted || shouldStop?.()) break;
          const delta = chunk?.choices?.[0]?.delta?.content || '';
          if (!delta) continue;
          out += delta;
          watch.bump(TOKEN_STALL_MS);
          onToken?.(out);
        }
      } catch (e) {
        if (!signal?.aborted) streamError = e;
      }
      return out;
    })();
    await Promise.race([reading, ...racers]);
    if (streamError) throw streamError;
  } catch (e) {
    try { eng.interruptGenerate(); } catch { /* idle */ }
    if (signal?.aborted || e?.code === 'abort') {
      throw new LlmError('Megállítva.', { friendly: 'Megállítva.', code: 'abort' });
    }
    if (shouldStop?.() || e?.code === 'skip') {
      throw new LlmError('skip', { friendly: '', code: 'skip' });
    }
    if (e?.friendly) throw e;
    throw new LlmError(e.message || 'generation failed', { friendly: friendlyMessage(e), code: e.code || 'llm' });
  } finally {
    watch.clear();
    clearTimeout(maxTimer);
  }

  if (signal?.aborted) throw new LlmError('Megállítva.', { friendly: 'Megállítva.', code: 'abort' });
  if (shouldStop?.()) throw new LlmError('skip', { friendly: '', code: 'skip' });
  return out.trim();
}
