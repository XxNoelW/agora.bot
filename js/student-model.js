// The trained model is a Qwen2.5-1.5B QLoRA merge, quantized for WebLLM.
// The wasm library is the prebuilt Qwen2 1.5B library from WebLLM 0.2.87.
// Only the weights come from the visitor's Hugging Face repo.

export const DEFAULT_STUDENT_REPO = 'XxNoelW/agora-student';
export const STUDENT_MODEL_ID = 'agora-student-q4f16_1';
export const STUDENT_WASM = 'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_87/base/Qwen2-1.5B-Instruct-q4f16_1_cs1k-webgpu.wasm';

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

export function studentAppConfig(repoId) {
  return { model_list: [studentRecord(repoId)] };
}

export async function studentWeightsReady(repoId, fetchImpl = fetch) {
  const repo = cleanRepo(repoId);
  if (!repo) return false;
  const url = `https://huggingface.co/${repo}/resolve/main/mlc-chat-config.json`;
  try {
    const res = await fetchImpl(url, { method: 'GET' });
    if (!res?.ok) return false;
    const text = await res.text();
    return /"model_type"\s*:\s*"qwen2"/.test(text) && /"quantization"\s*:\s*"q4f16_1"/.test(text);
  } catch {
    return false;
  }
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

export function answerLine({ kind, repo, builtin, reason, busy, progress, online, gpuOk }) {
  const pct = progress > 0 && progress < 1 ? ` ${Math.round(progress * 100)}%` : '';
  if (online && !busy) return 'Answering online';
  if (busy && kind === 'trained') return `Downloading the trained model${pct}`;
  if (busy) return `Downloading the built-in model${pct}`;
  if (kind === 'trained') return `Answering with the trained model (${repo || DEFAULT_STUDENT_REPO})`;
  if (kind === 'builtin') {
    const name = builtin || 'built-in model';
    return reason ? `Answering with the built-in ${name}. ${reason}` : `Answering with the built-in ${name}.`;
  }
  if (gpuOk === false) return 'Answering from web search. This browser cannot run a model.';
  return 'Checking which model can answer';
}
