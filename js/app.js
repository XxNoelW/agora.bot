import { state, save, agentById, resetAll, exportState, uid } from './store.js';
import { onStatus, status, loadModel, checkWebGPU } from './llm.js';
import { readOpenRouterKey, writeOpenRouterKey, forgetOpenRouterKey, redactSecrets, listModels, pickTeacherCandidates, pickDefaultTeacherIds } from './openrouter.js';
import { createOpenRouterAdapter } from './openrouter.js';
import { teachers } from './teachers.js';
import { usingOpenRouter } from './generate.js';
import { runUserTask, isRunning } from './runner.js';
import { settlePending } from './orchestrator.js';
import { watchFigures } from './characters.js';
import { session } from './session.js';
import { $, closeModal, openModal, confirm, toast, announce } from './dom.js';
import {
  agentListHTML, chatListHTML, chatHeadHTML, threadHTML, settingsHTML, renameChatHTML, welcomeHTML,
  patchThread, syncAgents,
} from './pages.js';
import { ensureAgentChats, listAgentChats, createAgentChat, renameAgentChat, deleteAgentChat } from './chats.js';

const thread = $('#thread');
let runCtl = null;
let gpuPromise = null;

function resolvedTheme() {
  const choice = state.settings.theme;
  if (choice === 'light' || choice === 'dark') return choice;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyChrome() {
  document.documentElement.dataset.theme = resolvedTheme();
  const menu = $('#menu-btn');
  if (menu) menu.setAttribute('aria-expanded', document.body.classList.contains('nav-open') ? 'true' : 'false');
}

function currentAgent() {
  return agentById(session.agentId) || state.agents[0] || null;
}

function currentChat() {
  const agent = currentAgent();
  if (!agent) return null;
  return listAgentChats(agent.id).find((chat) => chat.id === session.chatId) || listAgentChats(agent.id)[0] || null;
}

function statusLine() {
  if (usingOpenRouter() && !status.busy) return 'Agora AI is ready';
  if (status.error) return 'Agora AI could not start here. Questions can still search the web.';
  if (status.ready) return 'Agora AI is ready on this device';
  if (status.busy) {
    const pct = status.progress > 0 && status.progress < 1 ? ` ${Math.round(status.progress * 100)}%` : '';
    return `Getting Agora AI ready${pct}`;
  }
  if (session.gpu && session.gpu.ok === false && !session.gpu.pending) return 'Agora AI will search the web on this device';
  return 'Agora AI';
}

function paintStatus() {
  const el = $('#model-status');
  if (el) el.textContent = statusLine();
}

function setBusy(on) {
  const send = $('#send');
  const stop = $('#stop');
  if (send) send.hidden = !!on;
  if (stop) stop.hidden = !on;
}

function paint(patch) {
  const agent = currentAgent();
  const chat = currentChat();
  if (agent) session.agentId = agent.id;
  if (chat) session.chatId = chat.id;
  const patched = !!(patch && chat && patchThread(chat));
  if (!patched) {
    const agents = $('#agent-list');
    const chats = $('#chat-list');
    const head = $('#chat-head');
    if (agents) agents.innerHTML = agentListHTML(agent?.id);
    if (chats) chats.innerHTML = chatListHTML(agent?.id, chat?.id);
    if (head) head.innerHTML = chatHeadHTML(agent);
    if (thread) {
      thread.innerHTML = threadHTML(chat, agent);
      const start = thread.querySelector('.bubble-row.user:last-of-type') || thread.querySelector('.bubble-row, .tool-line, .sys-line');
      if (start) start.scrollIntoView({ block: 'start' });
    }
    const input = $('#input');
    if (input) input.placeholder = agent ? `Message ${agent.name}` : 'Message';
    const label = $('#chats-label');
    if (label) label.textContent = agent ? `Chats with ${agent.name}` : 'Chats';
    document.title = `${agent?.name || 'Agona'} · Agona`;
  }
  paintStatus();
  setBusy(isRunning());
  syncAgents();
  watchFigures(document);
  applyChrome();
}

function activate(agentId, chatId, { closeDrawer = false } = {}) {
  ensureAgentChats(state.agents);
  const agent = agentById(agentId) || state.agents[0];
  if (!agent) return;
  const chats = listAgentChats(agent.id);
  const chat = chats.find((item) => item.id === chatId) || chats[0];
  session.agentId = agent.id;
  session.chatId = chat?.id || '';
  state.settings.activeAgentId = agent.id;
  state.settings.activeChatId = session.chatId;
  save();
  if (closeDrawer) document.body.classList.remove('nav-open');
  paint(false);
}

function nextChatName(agentId) {
  const names = new Set(listAgentChats(agentId).map((chat) => chat.name));
  if (!names.has('New chat')) return 'New chat';
  let n = 2;
  while (names.has(`New chat ${n}`)) n += 1;
  return `New chat ${n}`;
}

async function ensureGpu() {
  if (!session.gpu.pending) return session.gpu;
  session.gpu = { ...(await gpuPromise), pending: false };
  return session.gpu;
}

async function ensureOnline() {
  if (!readOpenRouterKey() || state.settings.openrouterChatModel) return;
  try {
    const models = await listModels();
    session.catalog = models;
    const id = pickTeacherCandidates(models, 1)[0] || pickDefaultTeacherIds(models)[0] || '';
    if (!id) return;
    state.settings.openrouterChatModel = id;
    save();
    paintStatus();
  } catch { /* a later reply explains if Agora AI cannot answer */ }
}

async function submitText(text) {
  const clean = String(text || '').trim();
  if (!clean || runCtl) return;
  const agent = currentAgent();
  const chat = currentChat();
  if (!agent || !chat) return;
  const input = $('#input');
  if (input) {
    input.value = '';
    input.style.height = 'auto';
  }
  await ensureGpu();
  runCtl = new AbortController();
  setBusy(true);
  try {
    await runUserTask(clean, {
      signal: runCtl.signal,
      onUpdate: (patch) => paint(!!patch),
      gpu: session.gpu,
      onlyAgentId: agent.id,
      chat,
    });
  } catch (err) {
    console.error(err);
    chat.messages.push({
      id: uid('m_'),
      role: 'system',
      content: redactSecrets(err.friendly || err.message || 'Agora AI could not answer. Please try again.'),
      ts: Date.now(),
    });
    save();
  } finally {
    runCtl = null;
    settlePending(chat.messages, { aborted: false });
    for (const message of chat.messages) {
      if (message.pending) {
        message.pending = false;
        message.loading = false;
        message.error = true;
        message.content = message.content || 'Agora AI could not finish that reply. Please try again.';
      }
    }
    save();
    announce(`${agent.name} replied.`);
    paint(false);
  }
}

async function saveSettings() {
  const theme = $('#theme')?.value;
  if (theme === 'dark' || theme === 'light' || theme === 'system') state.settings.theme = theme;
  const key = $('#or-key')?.value || '';
  if (key.trim()) writeOpenRouterKey(key);
  const field = $('#or-key');
  if (field) field.value = '';
  save();
  applyChrome();
  closeModal();
  toast(key.trim() ? 'Saved on this computer. The key stays in this browser.' : 'Saved on this computer.');
  paint(false);
  await ensureOnline();
  paintStatus();
}

const actions = {
  menu() {
    document.body.classList.toggle('nav-open');
    applyChrome();
  },
  'close-menu'() { document.body.classList.remove('nav-open'); applyChrome(); },
  'close-modal': closeModal,
  'select-agent'(btn) {
    activate(btn.dataset.id, '', { closeDrawer: false });
  },
  'select-chat'(btn) {
    activate(session.agentId, btn.dataset.id, { closeDrawer: true });
    $('#input')?.focus();
  },
  'new-chat'() {
    const agent = currentAgent();
    if (!agent) return;
    const chat = createAgentChat(agent.id, { name: nextChatName(agent.id) });
    activate(agent.id, chat.id, { closeDrawer: true });
    $('#input')?.focus();
  },
  'rename-chat'(btn) {
    const chat = state.chats.find((item) => item.id === btn.dataset.id);
    if (!chat) return;
    openModal(renameChatHTML(chat), null, closeModal);
  },
  'save-chat-name'(btn) {
    const name = $('#chat-name')?.value || '';
    const chat = renameAgentChat(btn.dataset.id, name);
    if (!chat || !String(name).trim()) { toast('Add a name.'); return; }
    closeModal();
    paint(false);
  },
  async 'delete-chat'(btn) {
    const chat = state.chats.find((item) => item.id === btn.dataset.id);
    if (!chat) return;
    const ok = await confirm({
      title: 'Delete chat',
      text: `Delete "${chat.name}"? The messages on this computer will be removed.`,
      ok: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const result = deleteAgentChat(chat.id);
    const agentId = chat.agentId || session.agentId;
    const next = result?.replacement?.id || listAgentChats(agentId)[0]?.id;
    activate(agentId, next);
  },
  'open-settings'() {
    openModal(settingsHTML(), null, closeModal);
  },
  stop() {
    runCtl?.abort();
    toast('Stopped.');
  },
  'forget-key'() {
    forgetOpenRouterKey();
    state.settings.openrouterChatModel = '';
    save();
    toast('The key is forgotten on this computer.');
    closeModal();
    paint(false);
  },
  'export-data'() {
    const blob = new Blob([JSON.stringify(exportState(), null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'agona-copy.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  },
  async erase() {
    const ok = await confirm({
      title: 'Erase everything',
      text: 'Every chat on this browser will be deleted. The key goes too. This cannot be undone.',
      ok: 'Erase',
      danger: true,
    });
    if (!ok) return;
    resetAll();
    ensureAgentChats(state.agents);
    closeModal();
    toast('Erased on this browser.');
    activate(state.agents[0]?.id);
  },
  'welcome-ok'() {
    state.settings.welcomed = true;
    save();
    closeModal();
  },
};

async function onClick(event) {
  const btn = event.target.closest('[data-act]');
  if (!btn || btn.disabled) return;
  const fn = actions[btn.dataset.act];
  if (!fn) return;
  try { await fn(btn); }
  catch (err) { console.error(err); toast(redactSecrets(err.friendly || err.message || 'That did not work.')); }
}

function showWelcome() {
  if (state.settings.welcomed) return;
  openModal(welcomeHTML(), null, () => actions['welcome-ok']());
}

teachers.register(createOpenRouterAdapter());
ensureAgentChats(state.agents);
applyChrome();
activate(state.settings.activeAgentId || state.agents[0]?.id, state.settings.activeChatId);

document.addEventListener('click', onClick);
document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  if (form.id === 'composer') submitText($('#input')?.value);
  else if (form.id === 'settings-form') saveSettings();
});
document.addEventListener('keydown', (event) => {
  if (event.target?.id === 'input' && event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    submitText(event.target.value);
  }
});
document.addEventListener('input', (event) => {
  if (event.target?.id !== 'input') return;
  event.target.style.height = 'auto';
  event.target.style.height = Math.min(160, event.target.scrollHeight) + 'px';
});
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if (state.settings.theme === 'system') applyChrome();
});
onStatus(() => paintStatus());
gpuPromise = checkWebGPU();
gpuPromise.then((result) => {
  session.gpu = { ...result, pending: false };
  paintStatus();
  if (result.ok) loadModel(state.settings.model).catch(() => {});
});
ensureOnline();
showWelcome();
