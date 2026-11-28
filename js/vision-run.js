// Loads Agora vision only when a picture is attached, then unloads it.
import { checkWebGPU, getWebLlm, releaseAnswerModel } from './llm.js';
import {
  OCR_URL, VISION_MODEL_ID, visionContext, visionMessages, visionMiss, visionPlan, visionProgressLabel, visionSizeWarning,
} from './vision.js';
import { voiceLang } from './voice.js';

let engine = null;

async function unload() {
  const current = engine;
  engine = null;
  if (!current) return;
  try { await current.unload?.(); } catch { /* already gone */ }
}

async function recognize(dataUrl, importOcr, lang) {
  const loader = importOcr || ((url) => import(/* @vite-ignore */ url));
  const mod = await loader(OCR_URL);
  const createWorker = mod.createWorker || mod.default?.createWorker;
  if (!createWorker) throw new Error('ocr');
  const worker = await createWorker(lang === 'hu' ? 'hun+eng' : 'eng+hun');
  try {
    const result = await worker.recognize(dataUrl);
    return String(result?.data?.text || '');
  } finally {
    try { await worker.terminate(); } catch { /* ignore */ }
  }
}

export async function describeImage(dataUrl, {
  memoryGB = null,
  onProgress,
  importOcr,
  lang = voiceLang(),
} = {}) {
  const gpu = await checkWebGPU();
  const plan = visionPlan({ webgpu: !!gpu?.ok, memoryGB });
  if (plan.mode === 'vision') {
    onProgress?.({ progress: 0, text: visionSizeWarning(lang) });
    try {
      await releaseAnswerModel();
      const lib = await getWebLlm();
      engine = await lib.CreateMLCEngine(VISION_MODEL_ID, {
        initProgressCallback: (report) => {
          onProgress?.({
            progress: typeof report?.progress === 'number' ? report.progress : 0,
            text: visionProgressLabel(report, lang),
          });
        },
      });
      const reply = await engine.chat.completions.create({
        messages: visionMessages(dataUrl),
        temperature: 0.2,
        max_tokens: 480,
      });
      const text = String(reply?.choices?.[0]?.message?.content || '').trim();
      await unload();
      if (text) return { ok: true, source: 'vision', text, context: visionContext(text), notice: '' };
    } catch {
      await unload();
    }
  }
  try {
    onProgress?.({
      progress: 0.4,
      text: lang === 'hu' ? 'A k\u00e9pen l\u00e9v\u0151 szavak olvas\u00e1sa…' : 'Reading the words in the picture…',
    });
    const text = (await recognize(dataUrl, importOcr, lang)).trim();
    if (text) return { ok: true, source: 'ocr', text, context: visionContext(text), notice: '' };
  } catch { /* the notice below is the fallback */ }
  const notice = visionMiss(plan.mode === 'vision' ? 'failed' : plan.reason, lang);
  return { ok: false, source: 'none', text: '', context: '', notice };
}

export async function preloadVision({ onProgress, lang = voiceLang() } = {}) {
  onProgress?.({ progress: 0, text: visionSizeWarning(lang) });
  await releaseAnswerModel();
  const lib = await getWebLlm();
  engine = await lib.CreateMLCEngine(VISION_MODEL_ID, {
    initProgressCallback: (report) => {
      onProgress?.({
        progress: typeof report?.progress === 'number' ? report.progress : 0,
        text: visionProgressLabel(report, lang),
      });
    },
  });
  await unload();
  return true;
}
