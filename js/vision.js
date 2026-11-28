// Picture reading. The user-facing name is always Agora vision.
import { hideModelNames } from './text.js';

export const VISION_PUBLIC_NAME = 'Agora vision';
export const VISION_MODEL_ID = 'Phi-3.5-vision-instruct-q4f16_1-MLC';
export const VISION_VRAM_MB = 4521.54;
export const VISION_SIZE_LABEL = '4.4 GB';
export const OCR_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js';

export function visionPlan({ webgpu = false, memoryGB = null } = {}) {
  if (!webgpu) return { mode: 'ocr', reason: 'webgpu' };
  if (typeof memoryGB === 'number' && memoryGB > 0 && memoryGB <= 4) return { mode: 'ocr', reason: 'memory' };
  return { mode: 'vision', reason: '' };
}

export function visionSizeWarning(lang = 'en') {
  if (lang === 'hu') {
    return `${VISION_PUBLIC_NAME} az els\u0151 k\u00e9pn\u00e9l k\u00f6r\u00fclbel\u00fcl ${VISION_SIZE_LABEL} let\u00f6lt\u00e9s. Csak akkor t\u00f6lt\u0151dik, ha k\u00e9pet csatolsz.`;
  }
  return `${VISION_PUBLIC_NAME} is an extra download of about ${VISION_SIZE_LABEL} the first time you attach a picture. It loads only then.`;
}

export function visionProgressLabel(report, lang = 'en') {
  const progress = typeof report?.progress === 'number' ? report.progress : 0;
  const pct = progress > 0 && progress < 1 ? ` ${Math.round(progress * 100)}%` : '';
  const raw = hideModelNames(report?.text || '');
  if (/download|fetch/i.test(raw)) {
    return lang === 'hu' ? `${VISION_PUBLIC_NAME} let\u00f6lt\u00e9se${pct}` : `Downloading ${VISION_PUBLIC_NAME}${pct}`;
  }
  if (lang === 'hu') return `${VISION_PUBLIC_NAME} indul${pct}`;
  return `Starting ${VISION_PUBLIC_NAME}${pct}`;
}

export function visionPrompt() {
  return 'Describe this picture for a text assistant. Transcribe every word you can read, in the original language. Then say what the picture shows, in a few sentences. Do not identify a person by name.';
}

export function visionContext(text) {
  const body = String(text || '').replace(/\u0000/g, '').trim().slice(0, 4000);
  if (!body) return '';
  return `[Picture, read by ${VISION_PUBLIC_NAME}]\n${body}`;
}

export function visionMiss(reason, lang = 'en') {
  if (reason === 'memory' || reason === 'webgpu') {
    return lang === 'hu'
      ? 'Ezen az eszk\u00f6z\u00f6n nem fut az Agora vision. \u00cdrd le a k\u00e9pet egy mondatban, \u00e9s az Agora 1.0 \u00edgy is tud seg\u00edteni.'
      : 'This device cannot run Agora vision. Describe the picture in a sentence and Agora 1.0 can still help.';
  }
  return lang === 'hu'
    ? 'Az Agora vision nem tudta elolvasni a k\u00e9pet. \u00cdrd le egy mondatban, \u00e9s az Agora 1.0 \u00edgy is tud seg\u00edteni.'
    : 'Agora vision could not read this picture. Describe it in a sentence and Agora 1.0 can still help.';
}

export function visionMessages(dataUrl) {
  return [{
    role: 'user',
    content: [
      { type: 'text', text: visionPrompt() },
      { type: 'image_url', image_url: { url: String(dataUrl || '') } },
    ],
  }];
}
