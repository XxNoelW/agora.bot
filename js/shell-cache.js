// App-shell files only. Model weights and the WebLLM library stay on their own hosts and caches.
export const CACHE_NAME = 'agora-shell-v2';

export const SHELL_FILES = [
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'data/plugins.json',
  'js/app.js',
  'js/agents.js',
  'js/attachments.js',
  'js/browser-store.js',
  'js/characters.js',
  'js/chats.js',
  'js/cloud.js',
  'js/connector-api.js',
  'js/connectors.js',
  'js/dom.js',
  'js/feedback.js',
  'js/generate.js',
  'js/icons.js',
  'js/image.js',
  'js/llm.js',
  'js/mcp-client.js',
  'js/memory.js',
  'js/metrics.js',
  'js/oauth.js',
  'js/openrouter.js',
  'js/orchestrator.js',
  'js/pages.js',
  'js/panels.js',
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
  'js/shell-cache.js',
  'js/store.js',
  'js/student-model.js',
  'js/teachers.js',
  'js/text.js',
  'js/tools.js',
  'sw.js',
];

export function shouldCache(requestUrl, pageOrigin) {
  let url;
  try { url = new URL(requestUrl); } catch { return false; }
  if (url.origin !== pageOrigin) return false;
  if (url.pathname.endsWith('/')) return true;
  return SHELL_FILES.some((file) => url.pathname.endsWith(`/${file}`) || url.pathname.endsWith(file));
}
