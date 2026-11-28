// The trained model is a Qwen2.5-1.5B QLoRA merge, quantized for WebLLM.
// The wasm library is the prebuilt Qwen2 1.5B library from WebLLM 0.2.87.
// Only the weights come from the visitor's Hugging Face repo.

export const DEFAULT_STUDENT_REPO = 'XxNoelW/Agora-1.0';
export const LITE_REPO = 'XxNoelW/Agora-1.0-Lite';
export const TRAINED_MODEL_NAME = 'Agora 1.0';
export const LITE_MODEL_NAME = 'Agora Lite';
export const STUDENT_MODEL_ID = 'agora-student-q4f16_1';
export const LITE_MODEL_ID = 'agora-lite';
export const STUDENT_WASM = 'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_87/base/Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm';

// `agora-lite` is the model id the page asks WebLLM to load. The weights
// come from LITE_REPO when that Hugging Face repo is public.
export const MODEL_CONFIG = {
  agora: {
    id: STUDENT_MODEL_ID,
    repo: DEFAULT_STUDENT_REPO,
    label: TRAINED_MODEL_NAME,
  },
  'agora-lite': {
    id: LITE_MODEL_ID,
    repo: LITE_REPO,
    label: LITE_MODEL_NAME,
  },
};

export function cleanRepo(value) {
  const text = String(value || '')
    .trim()
    .replace(/^https?:\/\/huggingface\.co\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/resolve\/.*$/i, '')
    .replace(/\/+$/, '');
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,38}[A-Za-z0-9])?\/[A-Za-z0-9][A-Za-z0-9._-]{0,90}$/.test(text)) return '';
  return text;
}

export function studentRecord(repoId) {
  const repo = cleanRepo(repoId) || DEFAULT_STUDENT_REPO;
  return {
    model: `https://huggingface.co/${repo}`,
    model_id: STUDENT_MODEL_ID,
    model_lib: STUDENT_WASM,
    low_resource_required: true,
    vram_required_MB: 1629.75,
    overrides: { context_window_size: 4096 },
  };
}

export function liteRecord(repoId = LITE_REPO) {
  const repo = cleanRepo(repoId) || LITE_REPO;
  return {
    model: `https://huggingface.co/${repo}`,
    model_id: LITE_MODEL_ID,
    model_lib: STUDENT_WASM,
    low_resource_required: true,
    vram_required_MB: 512,
    overrides: { context_window_size: 4096 },
  };
}

export function studentAppConfig(repoId) {
  return { model_list: [studentRecord(repoId)] };
}

export function choiceAppConfig(choice, repoId) {
  if (choice === 'agora-lite') return { model_list: [liteRecord(repoId || LITE_REPO)] };
  return studentAppConfig(repoId);
}

export async function publishedModel(repoId, fetchImpl = fetch) {
  const repo = cleanRepo(repoId);
  if (!repo) return 'missing';
  const url = `https://huggingface.co/${repo}/resolve/main/mlc-chat-config.json`;
  try {
    const res = await fetchImpl(url, { method: 'GET' });
    if (!res || res.status === 404 || res.status === 401) return 'missing';
    if (!res.ok) return 'error';
    const text = await res.text();
    if (/"model_type"\s*:\s*"qwen2"/.test(text) && /"quantization"\s*:\s*"q4f16_1"/.test(text)) return 'ready';
    return 'error';
  } catch {
    return 'error';
  }
}

export async function studentWeightsReady(repoId, fetchImpl = fetch) {
  return (await publishedModel(repoId, fetchImpl)) === 'ready';
}

let liteOffer = 'unknown';

export function getLiteOffer() {
  return liteOffer;
}

export async function refreshLiteOffer(fetchImpl = fetch) {
  const result = await publishedModel(LITE_REPO, fetchImpl);
  liteOffer = result === 'ready' ? 'ready' : (result === 'missing' ? 'soon' : 'unknown');
  return liteOffer;
}

export function shouldSuggestLite({ offer, smallDevice, dismissed, choice }) {
  if (dismissed || choice === 'agora-lite' || !smallDevice) return false;
  return offer === 'ready' || offer === 'soon';
}

export function builtinName(modelId) {
  const id = String(modelId || '');
  if (id.includes('Coder-7B')) return 'Qwen2.5 Coder 7B';
  if (id.includes('Coder-1.5B')) return 'Qwen2.5 Coder 1.5B';
  if (id.includes('0.5B')) return 'Qwen2.5 0.5B';
  if (id.includes('3B')) return 'Qwen2.5 3B';
  if (id.includes('1.5B')) return 'Qwen2.5 1.5B';
  return 'model';
}

export function answerLine({ kind, repo, builtin, reason, busy, progress, online, gpuOk, label, fromCache }) {
  const pct = progress > 0 && progress < 1 ? ` ${Math.round(progress * 100)}%` : '';
  const name = label || TRAINED_MODEL_NAME;
  if (online && !busy) return 'Answering online';
  if (busy && kind === 'trained' && fromCache) return `Loading ${name} from cache${pct}`;
  if (busy && kind === 'trained') return `Downloading ${name}${pct}`;
  if (busy && fromCache) return `Loading the built-in model from cache${pct}`;
  if (busy) return `Downloading the built-in model${pct}`;
  if (kind === 'trained') return `Answering with ${name}`;
  if (kind === 'builtin') {
    const why = reason ? ` ${reason}` : '';
    return `Answering with ${TRAINED_MODEL_NAME}.${why}`;
  }
  if (gpuOk === false) return 'Answering from web search. This browser cannot run a model.';
  return 'Checking which model can answer';
}
