// Per-visitor plugin settings. Secrets never go in this object.
const KEY = 'agora:plugins';

export const DEFAULT_ENABLED = ['clock', 'calculator', 'units', 'wikipedia', 'weather', 'dictionary', 'currency'];

const EMPTY = () => ({
  enabled: DEFAULT_ENABLED.slice(),
  workerUrl: '',
  maxSteps: 4,
  custom: [],
  tools: {},
});

let memory = null;

export function loadPluginConfig(storage = globalThis.localStorage) {
  if (memory) return memory;
  const base = EMPTY();
  try {
    const parsed = JSON.parse(storage?.getItem(KEY) || 'null');
    if (parsed && typeof parsed === 'object') {
      base.enabled = Array.isArray(parsed.enabled) ? parsed.enabled.map(String) : base.enabled;
      base.workerUrl = cleanWorkerUrl(parsed.workerUrl);
      base.maxSteps = clampSteps(parsed.maxSteps);
      base.custom = Array.isArray(parsed.custom) ? parsed.custom.map(cleanCustom).filter(Boolean) : [];
      base.tools = parsed.tools && typeof parsed.tools === 'object' ? parsed.tools : {};
    }
  } catch { /* keep defaults */ }
  memory = base;
  return memory;
}

export function savePluginConfig(storage = globalThis.localStorage) {
  const config = loadPluginConfig(storage);
  const saved = {
    enabled: config.enabled,
    workerUrl: config.workerUrl,
    maxSteps: config.maxSteps,
    custom: config.custom,
    tools: config.tools,
  };
  try { storage?.setItem(KEY, JSON.stringify(saved)); } catch { /* private mode */ }
  return config;
}

export function resetPluginMemory(next) {
  memory = next || null;
}

function clampSteps(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 4;
  return Math.min(8, Math.max(1, n));
}

export function cleanWorkerUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch { return ''; }
}

function cleanCustom(row) {
  if (!row || typeof row !== 'object') return null;
  const url = String(row.url || '').trim();
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
  } catch { return null; }
  const auth = ['none', 'bearer', 'header', 'oauth'].includes(row.auth) ? row.auth : 'none';
  return {
    id: String(row.id || '').replace(/[^\w-]/g, '').slice(0, 40),
    name: String(row.name || 'Custom connector').slice(0, 80),
    url,
    auth,
    headerName: String(row.headerName || '').replace(/[^\w-]/g, '').slice(0, 40),
  };
}

export function pluginConfig() {
  return loadPluginConfig();
}

export function setMaxSteps(value) {
  const config = loadPluginConfig();
  config.maxSteps = clampSteps(value);
  savePluginConfig();
  return config.maxSteps;
}

export function setWorkerUrl(value) {
  const config = loadPluginConfig();
  config.workerUrl = cleanWorkerUrl(value);
  savePluginConfig();
  return config.workerUrl;
}

export function isEnabled(id) {
  return loadPluginConfig().enabled.includes(id);
}

export function setEnabled(id, on) {
  const config = loadPluginConfig();
  const set = new Set(config.enabled);
  if (on) set.add(id);
  else set.delete(id);
  config.enabled = [...set];
  savePluginConfig();
  return config.enabled;
}

export function rememberTools(id, tools) {
  const config = loadPluginConfig();
  config.tools[id] = (tools || []).slice(0, 80).map((tool) => ({
    name: String(tool.name || '').slice(0, 80),
    description: String(tool.description || '').slice(0, 240),
  }));
  savePluginConfig();
}

export function addCustom(row) {
  const config = loadPluginConfig();
  const clean = cleanCustom(row);
  if (!clean?.id) throw new Error('That connector needs a name and an https URL.');
  config.custom = config.custom.filter((item) => item.id !== clean.id).concat(clean);
  savePluginConfig();
  return clean;
}

export function removeCustom(id) {
  const config = loadPluginConfig();
  config.custom = config.custom.filter((item) => item.id !== id);
  config.enabled = config.enabled.filter((item) => item !== id);
  delete config.tools[id];
  savePluginConfig();
}
