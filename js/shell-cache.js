// App shell in one cache. Model weights, the helper library, and Agora vision use the runtime cache.
export const CACHE_NAME = 'agora-shell-v3';

export const SHELL_FILES = [
  'index.html',
  'stats.html',
  'manifest.webmanifest',
  'css/style.css',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'data/plugins.json',
  'js/app.js',
  'js/agents.js',
  'js/agora-pages.js',
  'js/attachments.js',
  'js/browser-store.js',
  'js/builtins.js',
  'js/characters.js',
  'js/chats.js',
  'js/cloud.js',
  'js/connector-api.js',
  'js/connectors.js',
  'js/dom.js',
  'js/examples.js',
  'js/feedback.js',
  'js/generate.js',
  'js/icons.js',
  'js/image.js',
  'js/library.js',
  'js/llm.js',
  'js/mcp-client.js',
  'js/memory.js',
  'js/marketplace.js',
  'js/math.js',
  'js/metrics.js',
  'js/offline-run.js',
  'js/offline.js',
  'js/oauth.js',
  'js/openrouter.js',
  'js/orchestrator.js',
  'js/pages.js',
  'js/pdf-read.js',
  'js/panels.js',
  'js/persist.js',
  'js/pii.js',
  'js/progress.js',
  'js/pipeline.js',
  'js/plugin-catalog.js',
  'js/plugin-http.js',
  'js/plugin-local.js',
  'js/plugin-run.js',
  'js/plugin-store.js',
  'js/plugin-ui.js',
  'js/qr.js',
  'js/roles.js',
  'js/routines.js',
  'js/runner.js',
  'js/scheduler.js',
  'js/secrets.js',
  'js/session.js',
  'js/share.js',
  'js/stats-page.js',
  'js/shell-cache.js',
  'js/store.js',
  'js/student-model.js',
  'js/teachers.js',
  'js/text.js',
  'js/tools.js',
  'js/tour.js',
  'js/training.js',
  'js/usage.js',
  'js/vision-run.js',
  'js/vision.js',
  'js/voice.js',
  'workers/agora-cloud/index.js',
  'sw.js',
];

export const RUNTIME_CACHE = 'agora-runtime-v1';

export function shouldRuntimeCache(requestUrl) {
  let url;
  try { url = new URL(requestUrl); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname;
  if (host === 'huggingface.co' || host.endsWith('.huggingface.co') || host.endsWith('.hf.co')) return true;
  if (host === 'esm.run') return true;
  if (host === 'raw.githubusercontent.com' && url.pathname.includes('/mlc-ai/')) return true;
  if (host === 'cdn.jsdelivr.net' && /tesseract|pdfjs-dist/i.test(url.pathname)) return true;
  if (host === 'tessdata.projectnaptha.com') return true;
  return false;
}

export function shouldCache(requestUrl, pageOrigin) {
  let url;
  try { url = new URL(requestUrl); } catch { return false; }
  if (url.origin !== pageOrigin) return false;
  if (url.pathname.endsWith('/')) return true;
  return SHELL_FILES.some((file) => url.pathname.endsWith(`/${file}`) || url.pathname.endsWith(file));
}
