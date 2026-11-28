// Saves the app shell, Agora 1.0, and optionally Agora vision for offline use.
import { SHELL_FILES } from './shell-cache.js';
import { ensureAnswerModel, WEBLLM_URL } from './llm.js';
import { STUDENT_WASM } from './student-model.js';
import { writeOfflineFlag } from './offline.js';
import { preloadVision } from './vision-run.js';
import { voiceLang } from './voice.js';

async function cacheUrl(url) {
  try {
    const res = await fetch(url);
    return !!res?.ok;
  } catch {
    return false;
  }
}

export async function downloadForOffline({ vision = false, onProgress, lang = voiceLang() } = {}) {
  const say = (progress, en, hu) => onProgress?.({ progress, text: lang === 'hu' ? hu : en });
  say(0.02, 'Saving the app…', 'Az alkalmaz\u00e1s ment\u00e9se…');
  const base = new URL('./', globalThis.location?.href || 'https://xxnoelw.github.io/agora.bot/');
  let shellOk = true;
  for (const file of SHELL_FILES) {
    const ok = await cacheUrl(new URL(file, base));
    if (!ok && file !== 'sw.js') shellOk = false;
  }
  say(0.25, 'Saving the helper library…', 'A seg\u00e9dk\u00f6nyvt\u00e1r ment\u00e9se…');
  await cacheUrl(WEBLLM_URL);
  await cacheUrl(STUDENT_WASM);
  say(0.4, 'Saving Agora 1.0…', 'Az Agora 1.0 ment\u00e9se…');
  await ensureAnswerModel();
  if (vision) {
    say(0.7, 'Saving Agora vision…', 'Az Agora vision ment\u00e9se…');
    await preloadVision({ onProgress, lang });
  }
  const flag = writeOfflineFlag({ shell: shellOk, model: true, vision: !!vision, at: Date.now() });
  say(1, 'Available offline', 'Offline is el\u00e9rhet\u0151');
  return flag;
}
