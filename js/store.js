// localStorage-backed state for the static Agona site.
import { ROLE_DEFS } from './roles.js';
import { normalizeIcon } from './icons.js';
import { clampParallel, DEFAULT_PARALLEL } from './scheduler.js';
import { forgetOpenRouterKey, redactSecrets } from './openrouter.js';

const KEY = 'agona:v1';
const OLD_KEY = 'agentcloud:v1';

export const WEBLLM_PIN_NOTE = '0.2.87';
export const DEFAULT_MODEL = 'Qwen2.5-Coder-7B-Instruct-q4f16_1-MLC';
export const MEDIUM_MODEL = 'Qwen2.5-3B-Instruct-q4f16_1-MLC';
export const FALLBACK_MODEL = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';
export const PHONE_MODEL = 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC';
export const SMALL_CODER_MODEL = 'Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC';
export const LEGACY_DEFAULT_MODEL = FALLBACK_MODEL;

export const MODELS = [
  { id: DEFAULT_MODEL, label: 'Big coder · Qwen2.5 Coder 7B (desktop default, about 5 GB)' },
  { id: MEDIUM_MODEL, label: 'Medium · Qwen2.5 3B (about 2.5 GB)' },
  { id: SMALL_CODER_MODEL, label: 'Small coder · Qwen2.5 Coder 1.5B' },
  { id: FALLBACK_MODEL, label: 'Small · Qwen2.5 1.5B (about 1.1 GB)' },
  { id: PHONE_MODEL, label: 'Phone · Qwen2.5 0.5B (about 0.5 GB)' },
];

const OLD_ADA = 'You are Ada, a thoughtful analyst. You reason carefully, are concise, and like to use tools to check facts.';
const NEW_ADA = 'You are Ada, a kind and careful friend. You explain things in simple words and check facts before you sound sure. Reply in English unless the user writes in another language.';

export const uid = (p = '') => p + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function prefersSmallModel(nav = globalThis.navigator) {
  if (!nav) return false;
  try {
    if (nav.userAgentData && nav.userAgentData.mobile) return true;
  } catch { /* ignore */ }
  const ua = String(nav.userAgent || '');
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  const mem = nav.deviceMemory;
  if (typeof mem === 'number' && mem > 0 && mem <= 4) return true;
  return false;
}

export function pickDefaultModel(nav = globalThis.navigator) {
  return prefersSmallModel(nav) ? PHONE_MODEL : DEFAULT_MODEL;
}

function clamp(n, min, max, fallback) {
  const x = +n;
  if (!Number.isFinite(x)) return fallback;
  return Math.min(max, Math.max(min, x));
}

function blank(nav) {
  return {
    version: 2,
    agents: [],
    chats: [],
    files: {
      '/notes.txt': 'Shared notes. Every agent can read them. If a note already has an owner, another agent does not overwrite it. They get a new file.',
    },
    fileOwners: { '/notes.txt': 'system' },
    fileBackups: {},
    keys: [],
    tasks: [],
    audit: [],
    teachers: [],
    trainingRuns: [],
    approvals: [],
    student: { name: 'Agona Student', version: 'not yet', status: 'not trained yet' },
    trainingConfig: { rank: 8, epochs: 1 },
    usage: { userMessages: 0, agentMessages: 0, toolCalls: 0, apiCalls: 0, openrouterCalls: 0 },
    examples: [],
    metrics: null,
    settings: {
      model: pickDefaultModel(nav),
      modelMigrated: true,
      rounds: 1,
      temperature: 0.7,
      maxTokens: 384,
      maxParallel: DEFAULT_PARALLEL,
      maxRuntimeSec: 120,
      theme: 'dark',
      sidebarCollapsed: false,
      welcomed: false,
      replySource: 'auto',
      openrouterChatModel: '',
      orPerRun: 8,
      orGlobal: 40,
    },
  };
}

export function defaults(nav = globalThis.navigator) {
  const data = blank(nav);
  data.agents = [];
  data.chats = [];
  return data;
}

function knownModel(id) {
  return MODELS.some((model) => model.id === id);
}

function withSearch(tools) {
  const list = Array.isArray(tools) ? tools.slice() : [];
  if (!list.includes('web_search')) list.unshift('web_search');
  if (!list.includes('read_page')) list.splice(Math.min(1, list.length), 0, 'read_page');
  return list;
}

function normalizeAgent(agent) {
  const role = ROLE_DEFS.find((item) => item.id === agent.role);
  const prompt = agent.prompt === OLD_ADA ? NEW_ADA : (agent.prompt || role?.prompt || 'Reply in simple English. If the user writes in another language, answer in that language.');
  return {
    id: agent.id || uid('a_'),
    name: agent.name || role?.name || 'Agent',
    role: agent.role || 'custom',
    color: role?.color || agent.color || '#E8B4B8',
    accessory: role?.accessory || agent.accessory || 'spark',
    prompt,
    tools: withSearch(Array.isArray(agent.tools) ? agent.tools : (role ? role.tools.slice() : ['web_search', 'read_page', 'read_file', 'list_files', 'write_file'])),
    icon: normalizeIcon(agent.icon, role?.color || agent.color),
    status: agent.paused ? 'paused' : (agent.status || 'idle'),
    paused: !!agent.paused,
    error: agent.error || '',
    taskId: agent.taskId || null,
  };
}

export function migrateState(data, nav = globalThis.navigator) {
  const base = blank(nav);
  const src = data && typeof data === 'object' ? data : {};
  const incoming = src.settings || {};
  const settings = { ...base.settings, ...incoming };
  // A missing flag means this save has never been migrated. Defaults set the flag on purpose.
  if (incoming.modelMigrated !== true) settings.modelMigrated = false;
  let model = settings.model;
  if (!settings.modelMigrated && (!model || model === LEGACY_DEFAULT_MODEL)) model = pickDefaultModel(nav);
  if (!knownModel(model)) model = pickDefaultModel(nav);
  settings.model = model;
  settings.modelMigrated = true;
  settings.temperature = clamp(settings.temperature, 0, 2, 0.7);
  settings.maxTokens = clamp(settings.maxTokens, 64, 1024, 384);
  settings.maxParallel = clampParallel(settings.maxParallel ?? DEFAULT_PARALLEL);
  settings.maxRuntimeSec = clamp(settings.maxRuntimeSec, 30, 300, 120);
  settings.rounds = clamp(settings.rounds, 1, 3, 1);
  if (!['system', 'dark', 'light'].includes(settings.theme)) settings.theme = 'system';
  settings.sidebarCollapsed = !!settings.sidebarCollapsed;
  settings.welcomed = !!settings.welcomed;
  if (!['auto', 'local', 'openrouter'].includes(settings.replySource)) settings.replySource = 'auto';
  settings.openrouterChatModel = String(settings.openrouterChatModel || '');
  settings.orPerRun = clamp(settings.orPerRun, 1, 30, 8);
  settings.orGlobal = clamp(settings.orGlobal, 1, 500, 40);
  delete settings.openrouterKey;
  delete settings.apiKey;

  const agents = Array.isArray(src.agents) ? src.agents.map(normalizeAgent) : [];

  const chats = Array.isArray(src.chats) ? src.chats : base.chats;
  for (const chat of chats) {
    chat.messages = Array.isArray(chat.messages) ? chat.messages : [];
    for (const message of chat.messages) {
      if (!message?.pending) continue;
      message.pending = false;
      message.loading = false;
      if (!String(message.content || '').trim()) message.content = 'The reply was interrupted.';
    }
  }

  const files = src.files && typeof src.files === 'object' && !Array.isArray(src.files) ? src.files : base.files;
  return {
    ...base,
    ...src,
    version: 2,
    agents,
    chats,
    files,
    fileOwners: src.fileOwners && typeof src.fileOwners === 'object' ? src.fileOwners : { ...base.fileOwners },
    fileBackups: src.fileBackups && typeof src.fileBackups === 'object' ? src.fileBackups : {},
    keys: Array.isArray(src.keys) ? src.keys : [],
    tasks: Array.isArray(src.tasks) ? src.tasks : [],
    audit: Array.isArray(src.audit) ? src.audit : [],
    teachers: Array.isArray(src.teachers) ? src.teachers.map(stripTeacherSecret) : [],
    examples: Array.isArray(src.examples) ? src.examples.map(stripExampleSecret) : [],
    metrics: src.metrics && typeof src.metrics === 'object' ? src.metrics : null,
    trainingRuns: Array.isArray(src.trainingRuns) ? src.trainingRuns : [],
    approvals: Array.isArray(src.approvals) ? src.approvals : [],
    student: { ...base.student, ...(src.student || {}) },
    trainingConfig: { ...base.trainingConfig, ...(src.trainingConfig || {}) },
    usage: { ...base.usage, ...(src.usage || {}) },
    settings,
  };
}

function load() {
  try {
    const fresh = localStorage.getItem(KEY);
    if (fresh) return migrateState(JSON.parse(fresh));
    const old = localStorage.getItem(OLD_KEY);
    if (old) return migrateState(JSON.parse(old));
  } catch (err) {
    console.warn('state load failed', err);
  }
  return migrateState(defaults());
}

export const state = load();
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (err) { console.warn('save failed', err); }
  listeners.forEach((fn) => {
    try { fn(); } catch (err) { console.error(err); }
  });
}

function stripTeacherSecret(teacher) {
  if (!teacher || typeof teacher !== 'object') return teacher;
  const { key, apiKey, token, secret, ...rest } = teacher;
  return rest;
}

function stripExampleSecret(example) {
  if (!example || typeof example !== 'object') return example;
  const { key, apiKey, token, secret, ...rest } = example;
  if (typeof rest.text === 'string') rest.text = redactSecrets(rest.text);
  if (typeof rest.error === 'string') rest.error = redactSecrets(rest.error);
  return rest;
}

export function exportState() {
  const copy = JSON.parse(JSON.stringify(state));
  delete copy.settings?.openrouterKey;
  delete copy.settings?.apiKey;
  copy.teachers = (copy.teachers || []).map(stripTeacherSecret);
  copy.examples = (copy.examples || []).map(stripExampleSecret);
  return copy;
}

export function audit(action, detail, actor = 'you') {
  if (!Array.isArray(state.audit)) state.audit = [];
  state.audit.unshift({
    id: uid('log_'),
    ts: Date.now(),
    actor: String(actor || 'te'),
    action: String(action || ''),
    detail: redactSecrets(String(detail || '')).slice(0, 500),
  });
  if (state.audit.length > 400) state.audit.length = 400;
  save();
}

export function replaceAll(data) {
  const next = migrateState(data);
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, next);
  save();
}

export function resetAll() {
  localStorage.removeItem(KEY);
  forgetOpenRouterKey();
  const next = defaults();
  for (const key of Object.keys(state)) delete state[key];
  Object.assign(state, migrateState(next));
  save();
}

export const agentById = (id) => state.agents.find((agent) => agent.id === id);

export function workspaceChat() {
  let chat = state.chats.find((item) => item && item.id === 'workspace');
  if (!chat) chat = state.chats[0];
  if (!chat) {
    chat = { id: 'workspace', name: 'Workspace', type: 'group', agentIds: [], messages: [] };
    state.chats.unshift(chat);
  }
  chat.messages = Array.isArray(chat.messages) ? chat.messages : [];
  return chat;
}

export function modelLabel(id) {
  return MODELS.find((model) => model.id === id)?.label || id;
}
