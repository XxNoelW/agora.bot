import { state, save, agentById, resetAll, exportState, uid } from './store.js';
import { onStatus, status, loadModel, checkWebGPU } from './llm.js';
import {
  readOpenRouterKey, writeOpenRouterKey, forgetOpenRouterKey, redactSecrets, listModels,
  pickTeacherCandidates, pickDefaultTeacherIds, createOpenRouterAdapter,
} from './openrouter.js';
import { teachers } from './teachers.js';
import { usingOpenRouter } from './generate.js';
import { runUserTask, runGroupRound, isRunning } from './runner.js';
import { settlePending } from './orchestrator.js';
import { session } from './session.js';
import { $, closeModal, openModal, confirm, toast, announce } from './dom.js';
import {
  agentListHTML, agentChatsHTML, groupListHTML, chatHeadHTML, threadHTML, settingsHTML,
  renameChatHTML, agentFormHTML, groupFormHTML, patchThread,
} from './pages.js';
import { ensureAgentChats, listAgentChats, createAgentChat, renameAgentChat, deleteAgentChat, createGroupChat, groupCanContinue } from './chats.js';
import { createAgentRecord, applyAgentEdits, removeAgent } from './agents.js';
import { ICON_COLORS } from './icons.js';
import { resizeImageFile } from './image.js';

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
  return agentById(session.agentId) || null;
}

function currentGroup() {
  return state.chats.find((chat) => chat && chat.id === session.groupId && chat.type === 'group') || null;
}

function currentChat() {
  if (session.view === 'group') return currentGroup();
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
  const cont = $('#continue');
  if (send) send.hidden = !!on;
  if (stop) stop.hidden = !on;
  if (cont) cont.hidden = on || !groupCanContinue(currentChat());
}

function paint(patch) {
  const agent = session.view === 'group' ? null : currentAgent();
  const chat = currentChat();
  if (chat && session.view !== 'group') session.chatId = chat.id;
  const patched = !!(patch && chat && patchThread(chat));
  if (!patched) {
    const agents = $('#agent-list');
    const chats = $('#chat-list');
    const groups = $('#group-list');
    const head = $('#chat-head');
    if (agents) agents.innerHTML = agentListHTML(session.view === 'agent' ? agent?.id : '');
    if (chats) chats.innerHTML = agentChatsHTML(session.view === 'agent' ? agent?.id : '', chat?.id);
    if (groups) groups.innerHTML = groupListHTML(session.view === 'group' ? chat?.id : '');
    if (head) head.innerHTML = chat ? chatHeadHTML(chat, agent) : '<div class="who"><div><h1>Agona</h1><p class="model-pill">Agora AI</p></div></div>';
    if (thread) {
      thread.innerHTML = `<div class="column">${chat ? threadHTML(chat, agent) : threadHTML(null, null)}</div>`;
      const start = thread.querySelector('.bubble-row.user:last-of-type, .welcome, .empty-home');
      if (start) start.scrollIntoView({ block: 'start' });
    }
    const input = $('#input');
    if (input) {
      input.placeholder = chat?.type === 'group' ? `Message ${chat.name}` : (agent ? `Message ${agent.name}` : 'Create an agent to start');
      input.disabled = !chat;
    }
    const label = $('#chats-label');
    if (label) label.textContent = agent ? `${agent.name}'s chats` : 'Chats';
    document.title = `${chat?.name || agent?.name || 'Agona'} · Agona`;
  }
  paintStatus();
  setBusy(isRunning());
  applyChrome();
}

function closeDrawer() {
  if (window.matchMedia('(max-width: 800px)').matches) document.body.classList.remove('nav-open');
}

function activateAgent(agentId, chatId) {
  ensureAgentChats(state.agents.filter((agent) => agent.id === agentId));
  const agent = agentById(agentId);
  if (!agent) {
    session.view = 'empty';
    session.agentId = '';
    session.chatId = '';
    save();
    paint(false);
    return;
  }
  const chats = listAgentChats(agent.id);
  const chat = chats.find((item) => item.id === chatId) || chats[0];
  session.view = 'agent';
  session.agentId = agent.id;
  session.chatId = chat?.id || '';
  session.groupId = '';
  state.settings.activeAgentId = agent.id;
  state.settings.activeChatId = session.chatId;
  state.settings.activeGroupId = '';
  save();
  closeDrawer();
  paint(false);
}

function activateGroup(groupId) {
  const chat = state.chats.find((item) => item.id === groupId && item.type === 'group');
  if (!chat) {
    paint(false);
    return;
  }
  session.view = 'group';
  session.groupId = chat.id;
  state.settings.activeGroupId = chat.id;
  save();
  closeDrawer();
  paint(false);
  $('#input')?.focus();
}

function blankDraft(agent) {
  if (agent) {
    return {
      id: agent.id,
      name: agent.name,
      icon: agent.icon?.type === 'photo'
        ? { type: 'photo', dataUrl: agent.icon.dataUrl }
        : { type: 'shape', shape: agent.icon?.shape || 'robot', color: agent.icon?.color || agent.color || ICON_COLORS[0] },
    };
  }
  return { id: '', name: '', icon: { type: 'shape', shape: 'robot', color: ICON_COLORS[0] } };
}

function openAgentForm() {
  openModal(agentFormHTML(session.draft, { editing: !!session.draft?.id }), null, closeModal);
  $('#agent-name')?.focus();
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
  const chat = currentChat();
  if (!chat) {
    toast('Create an agent first.');
    return;
  }
  const input = $('#input');
  if (input) {
    input.value = '';
    input.style.height = 'auto';
  }
  await ensureGpu();
  runCtl = new AbortController();
  setBusy(true);
  try {
    const opts = { signal: runCtl.signal, onUpdate: (patch) => paint(!!patch), gpu: session.gpu };
    if (chat.type === 'group') await runGroupRound(chat, { ...opts, text: clean, fresh: true });
    else await runUserTask(clean, { ...opts, onlyAgentId: session.agentId, chat });
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
    save();
    announce('Replied.');
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
  'open-create'() {
    session.draft = blankDraft(null);
    openAgentForm();
  },
  'edit-agent'(btn) {
    const agent = agentById(btn.dataset.id || session.agentId);
    if (!agent) return;
    session.draft = blankDraft(agent);
    openAgentForm();
  },
  'pick-shape'(btn) {
    const name = $('#agent-name')?.value ?? session.draft.name;
    session.draft.name = name;
    session.draft.icon = { type: 'shape', shape: btn.dataset.shape, color: session.draft.icon?.color || ICON_COLORS[0] };
    openAgentForm();
  },
  'pick-color'(btn) {
    const name = $('#agent-name')?.value ?? session.draft.name;
    session.draft.name = name;
    const icon = session.draft.icon || { type: 'shape', shape: 'robot' };
    session.draft.icon = { ...icon, type: icon.type === 'photo' ? 'photo' : 'shape', color: btn.dataset.color };
    if (session.draft.icon.type !== 'photo') session.draft.icon.shape = session.draft.icon.shape || 'robot';
    openAgentForm();
  },
  'save-agent'() {
    const name = $('#agent-name')?.value || '';
    try {
      if (session.draft?.id) {
        const agent = agentById(session.draft.id);
        if (!agent) return;
        applyAgentEdits(agent, { name, icon: session.draft.icon });
        save();
        closeModal();
        toast('Agent updated.');
        paint(false);
        return;
      }
      const agent = createAgentRecord({ name, icon: session.draft.icon });
      state.agents.push(agent);
      const chat = createAgentChat(agent.id, { name: 'New chat', persist: false });
      save();
      closeModal();
      activateAgent(agent.id, chat.id);
    } catch (err) {
      toast(err.message || 'Add a name.');
    }
  },
  async 'delete-agent'(btn) {
    const id = btn.dataset.id || session.draft?.id || session.agentId;
    const agent = agentById(id);
    if (!agent) return;
    const ok = await confirm({
      title: 'Delete agent',
      text: `${agent.name} and their chats will be removed from this browser.`,
      ok: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const next = removeAgent(id, state.agents, state.chats);
    state.agents.splice(0, state.agents.length, ...next.agents);
    state.chats.splice(0, state.chats.length, ...next.chats);
    save();
    closeModal();
    const fallback = state.agents[0];
    if (fallback) activateAgent(fallback.id);
    else {
      session.view = 'empty';
      session.agentId = '';
      session.chatId = '';
      session.groupId = '';
      paint(false);
    }
  },
  'select-agent'(btn) { activateAgent(btn.dataset.id); },
  'select-chat'(btn) {
    activateAgent(session.agentId, btn.dataset.id);
    $('#input')?.focus();
  },
  'new-chat'() {
    const agent = currentAgent();
    if (!agent) { toast('Create an agent first.'); return; }
    const count = listAgentChats(agent.id).length + 1;
    const chat = createAgentChat(agent.id, { name: count === 1 ? 'New chat' : `New chat ${count}` });
    activateAgent(agent.id, chat.id);
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
      text: `Delete "${chat.name}"?`,
      ok: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const result = deleteAgentChat(chat.id);
    const next = result?.replacement?.id || listAgentChats(chat.agentId)[0]?.id;
    activateAgent(chat.agentId, next);
  },
  'open-group'() {
    if (state.agents.length < 2) { toast('Create at least two agents first.'); return; }
    openModal(groupFormHTML(), null, closeModal);
  },
  'select-group'(btn) { activateGroup(btn.dataset.id); },
  'save-group'() {
    const name = $('#group-name')?.value || '';
    const ids = [...document.querySelectorAll('input[name="member"]:checked')].map((box) => box.value);
    try {
      const chat = createGroupChat(name, ids);
      closeModal();
      activateGroup(chat.id);
    } catch (err) {
      toast(err.message || 'Pick at least two agents.');
    }
  },
  async 'continue-group'() {
    const chat = currentGroup();
    if (!chat || runCtl || !groupCanContinue(chat)) return;
    runCtl = new AbortController();
    setBusy(true);
    try {
      await runGroupRound(chat, { signal: runCtl.signal, onUpdate: (patch) => paint(!!patch), fresh: false });
    } catch (err) {
      toast(redactSecrets(err.message || 'That did not work.'));
    } finally {
      runCtl = null;
      settlePending(chat.messages, { aborted: false });
      save();
      paint(false);
    }
  },
  'open-settings'() { openModal(settingsHTML(), null, closeModal); },
  stop() { runCtl?.abort(); toast('Stopped.'); },
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
      text: 'Every agent and chat on this browser will be deleted. The key goes too. This cannot be undone.',
      ok: 'Erase',
      danger: true,
    });
    if (!ok) return;
    resetAll();
    closeModal();
    session.view = 'empty';
    session.agentId = '';
    session.chatId = '';
    session.groupId = '';
    toast('Erased on this browser.');
    paint(false);
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

teachers.register(createOpenRouterAdapter());
applyChrome();
session.view = state.settings.activeGroupId ? 'group' : (state.settings.activeAgentId ? 'agent' : 'empty');
session.agentId = state.settings.activeAgentId || '';
session.chatId = state.settings.activeChatId || '';
session.groupId = state.settings.activeGroupId || '';
if (session.view === 'group' && currentGroup()) activateGroup(session.groupId);
else if (currentAgent()) activateAgent(session.agentId, session.chatId);
else paint(false);

document.addEventListener('click', onClick);
document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  if (form.id === 'composer') submitText($('#input')?.value);
  else if (form.id === 'settings-form') saveSettings();
});
document.addEventListener('change', async (event) => {
  if (event.target?.id !== 'agent-photo') return;
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const dataUrl = await resizeImageFile(file);
    session.draft.name = $('#agent-name')?.value || session.draft.name || '';
    session.draft.icon = { type: 'photo', dataUrl, color: session.draft.icon?.color };
    openAgentForm();
  } catch (err) {
    toast(err.message || 'Could not use that photo.');
  }
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
