// localStorage-backed state
const KEY = 'agentcloud:v1';

export const DEFAULT_MODEL = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';
export const MODELS = [
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 1.5B Instruct (~1.1 GB, default)' },
  { id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 3B Instruct (~2.5 GB)' },
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 3B Instruct (~2.3 GB)' },
  { id: 'Phi-3.5-mini-instruct-q4f16_1-MLC', label: 'Phi-3.5 mini Instruct (~3.7 GB)' },
];

export const uid = (p = '') => p + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function defaults() {
  const a1 = { id: uid('a_'), name: 'Ada', emoji: '🧠', prompt: 'You are Ada, a thoughtful analyst. You reason carefully, are concise, and like to use tools to check facts.' };
  const a2 = { id: uid('a_'), name: 'Max', emoji: '🚀', prompt: 'You are Max, an energetic creative thinker. You propose bold ideas and build on what others say.' };
  return {
    agents: [a1, a2],
    chats: [{ id: uid('c_'), name: 'Brainstorm', type: 'group', agentIds: [a1.id, a2.id], messages: [] }],
    files: { '/README.txt': 'Shared cloud computer. All agents can read and write files here.' },
    keys: [],
    usage: { userMessages: 0, agentMessages: 0, toolCalls: 0, apiCalls: 0 },
    settings: { model: DEFAULT_MODEL, rounds: 2, temperature: 0.7, maxTokens: 512 },
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const d = JSON.parse(raw); const def = defaults(); return { ...def, ...d, settings: { ...def.settings, ...d.settings }, usage: { ...def.usage, ...d.usage } }; }
  } catch (e) { console.warn('state load failed', e); }
  return defaults();
}

export const state = load();
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.warn('save failed', e); }
  listeners.forEach((f) => f());
}

export function replaceAll(data) {
  const def = defaults();
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, def, data, { settings: { ...def.settings, ...(data.settings || {}) }, usage: { ...def.usage, ...(data.usage || {}) } });
  save();
}

export function resetAll() { localStorage.removeItem(KEY); replaceAll(defaults()); }

export const agentById = (id) => state.agents.find((a) => a.id === id);
