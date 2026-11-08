// localStorage-backed state
const KEY = 'agentcloud:v1';

// Checked against @mlc-ai/web-llm@0.2.87 prebuiltAppConfig.model_list
// (npm lib/index.js, modelVersion v0_2_87/base).
// Qwen2.5-Coder-7B is the largest Qwen coder in that list (~5.1 GB VRAM).
// It keeps a normal chat history and answers directly. Newer Qwen3 / Qwen3.5
// builds either spend the reply on hidden "thinking" or keep only one turn.
export const DEFAULT_MODEL = 'Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC';
export const FALLBACK_MODEL = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';
export const LEGACY_DEFAULT_MODEL = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';
export const MEDIUM_MODEL = 'Qwen2.5-3B-Instruct-q4f16_1-MLC';

export const MODELS = [
  { id: DEFAULT_MODEL, label: 'Super helper — best for coding and looking things up (about 5 GB)' },
  { id: MEDIUM_MODEL, label: 'Medium helper — middle size (about 2.5 GB)' },
  { id: FALLBACK_MODEL, label: 'Small helper — for slower computers (about 1.6 GB)' },
];

export const ADA_PROMPT = 'You are Ada, a kind and careful friend. You explain things in simple words. When you are not sure, you look things up. You like getting facts right.';
export const MAX_PROMPT = 'You are Max, a cheerful friend who is full of ideas. You use simple words, you build on what other people say, and you keep answers short unless someone asks for more.';

const OLD_PROMPTS = new Map([
  ['You are Ada, a thoughtful analyst. You reason carefully, are concise, and like to use tools to check facts.', ADA_PROMPT],
  ['You are Max, an energetic creative thinker. You propose bold ideas and build on what others say.', MAX_PROMPT],
]);

export const uid = (p = '') => p + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function defaults() {
  const ada = { id: uid('a_'), name: 'Ada', emoji: '🧠', prompt: ADA_PROMPT };
  const max = { id: uid('a_'), name: 'Max', emoji: '🚀', prompt: MAX_PROMPT };
  return {
    agents: [ada, max],
    chats: [{ id: uid('c_'), name: 'Friends chat', type: 'group', agentIds: [ada.id, max.id], messages: [] }],
    files: { '/welcome.txt': 'Shared notes. Every friend can read and write files here.' },
    keys: [],
    usage: { userMessages: 0, agentMessages: 0, toolCalls: 0, apiCalls: 0 },
    settings: {
      model: DEFAULT_MODEL,
      rounds: 2,
      temperature: 0.7,
      maxTokens: 384,
      modelMigrated: true,
      welcomed: false,
    },
  };
}

export function migrateState(data) {
  const fresh = defaults();
  if (!data || typeof data !== 'object') return fresh;
  const settings = { ...fresh.settings, ...(data.settings || {}) };
  if (!data.settings?.modelMigrated) {
    if (settings.model === LEGACY_DEFAULT_MODEL) settings.model = DEFAULT_MODEL;
    settings.modelMigrated = true;
  }
  if (!MODELS.some((m) => m.id === settings.model)) settings.model = DEFAULT_MODEL;
  settings.rounds = Math.max(1, Math.min(3, +settings.rounds || 2));
  settings.temperature = Number.isFinite(+settings.temperature) ? Math.min(2, Math.max(0, +settings.temperature)) : 0.7;
  settings.maxTokens = Math.max(64, Math.min(2048, +settings.maxTokens || 384));
  const agents = Array.isArray(data.agents)
    ? data.agents.map((agent) => ({ ...agent, prompt: OLD_PROMPTS.get(agent.prompt) || agent.prompt }))
    : fresh.agents;
  const chats = Array.isArray(data.chats) ? data.chats : fresh.chats;
  for (const chat of chats) {
    if (!Array.isArray(chat.messages)) chat.messages = [];
    chat.agentIds = Array.isArray(chat.agentIds) ? chat.agentIds : [];
    for (const message of chat.messages) {
      if (!message?.pending) continue;
      const hadText = String(message.content || '').trim();
      message.pending = false;
      message.loading = false;
      if (!hadText) {
        message.content = 'This reply was interrupted. Send your message again.';
        message.error = true;
      }
    }
  }
  return {
    ...fresh,
    ...data,
    agents,
    chats,
    files: data.files && typeof data.files === 'object' && !Array.isArray(data.files) ? data.files : fresh.files,
    keys: Array.isArray(data.keys) ? data.keys : [],
    usage: { ...fresh.usage, ...(data.usage || {}) },
    settings,
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return migrateState(JSON.parse(raw));
  } catch (e) { console.warn('state load failed', e); }
  return defaults();
}

export const state = load();
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.warn('save failed', e); }
  listeners.forEach((fn) => fn());
}

export function replaceAll(data) {
  const next = migrateState(data);
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, next);
  save();
}

export function resetAll() {
  localStorage.removeItem(KEY);
  replaceAll(defaults());
}

export const agentById = (id) => state.agents.find((a) => a.id === id);
