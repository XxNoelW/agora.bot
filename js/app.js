import { state, save, agentById, resetAll, exportState, uid } from './store.js';
import { onStatus, status, ensureAnswerModel, currentAnswerLine, checkWebGPU } from './llm.js';
import { cleanRepo, getLiteOffer, refreshLiteOffer } from './student-model.js';
import { esc } from './text.js';
import { examplePrompts } from './examples.js';
import { tourSteps, tourButtonLabel, tourSkipLabel } from './tour.js';
import { progressLine, progressMessage } from './progress.js';
import { requestPersistentStorage } from './persist.js';
import { snapshotFromChat, publishShare, fetchShare, shareDialogHTML, sharedThreadHTML, transcriptText } from './share.js';
import { noteEvent } from './usage.js';
import { helpImproveEnabled, trainingTurn, postTraining } from './training.js';
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
  renameChatHTML, agentFormHTML, groupFormHTML, connectorsHTML, patchThread, liteHintHTML,
} from './pages.js';
import { testConnector, writeConnectorMeta, packCred } from './connectors.js';
import { saveSecret, deleteSecret, hasSecret } from './secrets.js';
import { beginMastodonLogin, finishMastodonLogin, beginPkce, finishPkce } from './oauth.js';
import { ensureCatalog, catalogList, connectPlugin, dropMcpSession } from './plugin-run.js';
import { setEnabled, setMaxSteps, setWorkerUrl, addCustom, removeCustom, rememberTools } from './plugin-store.js';
import { connectorsShell, pluginResultsHTML, setPluginQuery, setPluginCategory, setPluginNeeds, showMorePlugins } from './plugin-ui.js';
import { beginMcpOauth, finishMcpOauth } from './mcp-client.js';
import { ensureAgentChats, listAgentChats, createAgentChat, renameAgentChat, deleteAgentChat, createGroupChat, groupCanContinue } from './chats.js';
import { createAgentRecord, applyAgentEdits, removeAgent, duplicateAgent } from './agents.js';
import { ICON_COLORS } from './icons.js';
import { resizeImageFile, shrinkChatImage, visionImage } from './image.js';
import { memoryPanelHTML, routinesPanelHTML, filterHistory } from './panels.js';
import {
  loadMemories, parseMemoryCommand, applyMemoryCommand, memoryEnabled, setMemoryEnabled,
  addMemory, editMemory, removeMemory, forgetAgent, claimLegacyMemories, replaceMemories,
} from './memory.js';
import {
  loadRoutines, parseRoutine, createRoutine, cancelRoutine, startRoutineLoop,
} from './routines.js';
import { loadFeedback, feedbackRecord, saveFeedback, toJSONL } from './feedback.js';
import { attachmentBlock, textFromPdf } from './attachments.js';
import { voiceLang, setVoiceLang, speakEnabled, setSpeakEnabled, startListening, speakText } from './voice.js';
import {
  setCloudUrl, clearCloudCode, createAccount, linkAccount, syncNow, flushQueuedSync, resolveConflict, removeAccount, ui,
} from './cloud.js';
import { isHomeworkAgent } from './builtins.js';
import { offlineBadge, offlineBanner, readOfflineFlag } from './offline.js';
import { describeImage } from './vision-run.js';
import { downloadForOffline } from './offline-run.js';

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
  if (status.error && !status.busy) return 'The model could not start. Questions can still search the web.';
  return currentAnswerLine({
    online: usingOpenRouter(),
    gpuOk: session.gpu?.pending ? undefined : session.gpu?.ok,
  });
}

function paintStatus() {
  const el = $('#model-status');
  if (el) el.textContent = statusLine();
  paintLoad();
}

function activeModelName() {
  return state.settings.modelChoice === 'agora-lite' && getLiteOffer() === 'ready' ? 'Agora Lite' : 'Agora 1.0';
}

function paintLoad() {
  const bar = $('#load-bar');
  if (!bar) return;
  if (document.body.classList.contains('share-mode')) {
    bar.hidden = true;
    return;
  }
  const preparing = !!session.gpu?.pending && !status.ready;
  const loading = preparing || (status.busy && !status.ready);
  const failed = !!(status.error && !status.busy && !status.ready);
  bar.hidden = !loading && !failed;
  if (bar.hidden) return;
  const info = {
    percent: status.percent || (status.progress ? Math.round(status.progress * 100) : 0),
    mb: status.mb,
    eta: status.eta,
    fromCache: !!status.fromCache,
  };
  const msg = $('#load-msg');
  const meta = $('#load-meta');
  const fill = $('#load-fill');
  const track = $('#load-track');
  const retry = $('#load-retry');
  const name = activeModelName();
  if (msg) {
    msg.textContent = failed
      ? (status.text || ui('Agora 1.0 could not start.', 'Az Agora 1.0 nem indult el.'))
      : (preparing && !status.busy
        ? ui(
          `Preparing ${name}. The first download can take a few minutes. This bar will move as the files arrive.`,
          `A ${name} k\u00e9sz\u00fcl. Az els\u0151 let\u00f6lt\u00e9s n\u00e9h\u00e1ny percig tarthat. A s\u00e1v halad, ahogy a f\u00e1jlok meg\u00e9rkeznek.`,
        )
        : progressMessage(info, name));
  }
  if (meta) meta.textContent = failed ? '' : progressLine(info);
  if (fill) {
    fill.style.width = `${info.percent}%`;
    fill.classList.toggle('indeterminate', !failed && info.percent <= 0);
  }
  if (track) track.setAttribute('aria-valuenow', String(info.percent));
  if (retry) {
    retry.hidden = !failed;
    retry.textContent = ui('Try again', '\u00dajra');
  }
}

function paintLite() {
  const slot = $('#lite-hint');
  if (!slot || document.body.classList.contains('share-mode')) {
    if (slot) slot.hidden = true;
    return;
  }
  const html = liteHintHTML();
  if (slot.dataset.html === html) {
    slot.hidden = !html;
    return;
  }
  slot.dataset.html = html;
  slot.hidden = !html;
  slot.innerHTML = html;
}

function showTour() {
  const box = $('#tour');
  if (!box) return;
  if (state.settings.welcomed || session.shared) {
    box.hidden = true;
    return;
  }
  const steps = tourSteps();
  const index = Math.min(session.tourStep || 0, steps.length - 1);
  const step = steps[index];
  box.hidden = false;
  box.innerHTML = `<p class="section-label">${esc(ui('Welcome', '\u00dcdv\u00f6z\u00f6l'))} ${index + 1} / ${steps.length}</p>
    <h2>${esc(step.title)}</h2>
    <p>${esc(step.body)}</p>
    <div class="row">
      <button type="button" data-act="tour-next">${esc(tourButtonLabel(index, steps.length))}</button>
      <button type="button" class="ghost" data-act="tour-skip">${esc(tourSkipLabel())}</button>
    </div>`;
}

function finishTour() {
  state.settings.welcomed = true;
  save();
  const box = $('#tour');
  if (box) box.hidden = true;
}

function setBusy(on) {
  const send = $('#send');
  const stop = $('#stop');
  const cont = $('#continue');
  if (send) send.hidden = !!on;
  if (stop) stop.hidden = !on;
  if (cont) cont.hidden = on || !groupCanContinue(currentChat());
}

function paintShared() {
  const snap = session.shared || { loading: true, messages: [] };
  const head = $('#chat-head');
  if (head) {
    const title = snap.title || ui('Shared chat', 'Megosztott cseveg\u00e9s');
    head.innerHTML = `<div class="who"><div><h1>${esc(title)}</h1><p class="model-pill">${esc(ui('Read-only', 'Csak olvashat\u00f3'))}</p></div></div>`;
  }
  if (thread) thread.innerHTML = `<div class="column">${sharedThreadHTML(snap)}</div>`;
  const bar = $('#share-bar');
  const note = $('#share-note');
  if (note) {
    note.textContent = ui(
      'This is a read-only copy. Try Agora to start your own chat in this browser.',
      'Ez egy csak olvashat\u00f3 m\u00e1solat. Pr\u00f3b\u00e1ld ki az Agor\u00e1t, \u00e9s kezdj saj\u00e1t cseveg\u00e9st ebben a b\u00f6ng\u00e9sz\u0151ben.',
    );
  }
  const tryButton = $('#try-agora');
  const copyButton = $('#copy-shared');
  if (tryButton) tryButton.textContent = ui('Try Agora', 'Agora kipr\u00f3b\u00e1l\u00e1sa');
  if (copyButton) copyButton.textContent = ui('Copy as text', 'M\u00e1sol\u00e1s sz\u00f6vegk\u00e9nt');
  if (bar) bar.hidden = false;
  const input = $('#input');
  if (input) input.disabled = true;
  document.title = `${snap.title || 'Agora'} · Agora`;
  paintStatus();
  applyChrome();
}

function paint(patch) {
  if (session.shared) {
    paintShared();
    return;
  }
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
    if (chats) chats.innerHTML = agentChatsHTML(session.view === 'agent' ? agent?.id : '', chat?.id, session.chatQuery || '');
    if (groups) groups.innerHTML = groupListHTML(session.view === 'group' ? chat?.id : '');
    if (head) head.innerHTML = chat ? chatHeadHTML(chat, agent) : '<div class="who"><div><h1>Agora</h1><p class="model-pill">Agora 1.0</p></div></div>';
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
    document.title = `${chat?.name || agent?.name || 'Agora'} · Agora`;
  }
  paintStatus();
  paintLite();
  paintOffline();
  const solve = $('#show-solution');
  if (solve) {
    const homework = isHomeworkAgent(agent) && chat && chat.type !== 'group';
    solve.hidden = !homework;
    solve.textContent = ui('Show solution', 'Megold\u00e1s mutat\u00e1sa');
  }
  setBusy(isRunning());
  applyChrome();
}

function paintOffline() {
  const badge = $('#offline-badge');
  const flag = readOfflineFlag();
  const view = offlineBadge({ online: navigator.onLine !== false, shell: flag.shell, model: flag.model });
  if (badge) {
    badge.hidden = !view.text;
    badge.textContent = view.text;
    badge.classList.toggle('ready', view.ready);
  }
  let note = $('#offline-note');
  const banner = offlineBanner(navigator.onLine !== false);
  if (!note && banner) {
    note = document.createElement('p');
    note.id = 'offline-note';
    note.className = 'offline-note';
    $('#composer')?.prepend(note);
  }
  if (note) {
    note.hidden = !banner;
    note.textContent = banner;
  }
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
  const icon = agent?.icon?.type === 'photo'
    ? { type: 'photo', dataUrl: agent.icon.dataUrl }
    : { type: 'shape', shape: agent?.icon?.shape || 'robot', color: agent?.icon?.color || agent?.color || ICON_COLORS[0] };
  if (agent) {
    return {
      id: agent.id,
      name: agent.name,
      nameHu: agent.nameHu || '',
      emoji: agent.emoji || '',
      description: agent.description || '',
      descriptionHu: agent.descriptionHu || '',
      prompt: agent.prompt || '',
      examples: agent.examples || [],
      examplesHu: agent.examplesHu || [],
      tools: agent.tools || [],
      builtin: agent.builtin || '',
      icon,
    };
  }
  return {
    id: '', name: '', nameHu: '', emoji: '', description: '', descriptionHu: '', prompt: '',
    examples: [], examplesHu: [], tools: ['web_search', 'read_page', 'read_file', 'list_files', 'write_file'], builtin: '', icon,
  };
}

function readAgentFields(draft) {
  if (!$('#agent-name')) return draft;
  const lang = voiceLang();
  const name = $('#agent-name').value;
  const description = $('#agent-description')?.value || '';
  const examples = ($('#agent-examples')?.value || '').split('\n');
  const tools = [...document.querySelectorAll('[data-tool]')].filter((el) => el.checked).map((el) => el.dataset.tool);
  const next = {
    ...draft,
    emoji: $('#agent-emoji')?.value || '',
    prompt: $('#agent-prompt')?.value || '',
    tools,
    icon: draft.icon,
  };
  if (lang === 'hu') {
    next.nameHu = name;
    next.descriptionHu = description;
    next.examplesHu = examples;
    if (!next.name) next.name = name;
  } else {
    next.name = name;
    next.description = description;
    next.examples = examples;
  }
  return next;
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
  } catch { /* a later reply explains if Agora 1.0 cannot answer */ }
}

function pushLocalTurn(chat, userText, answer, tool) {
  chat.messages.push({ id: uid('m_'), role: 'user', content: userText, ts: Date.now() });
  chat.messages.push({ id: uid('m_'), role: 'tool', tool, content: answer, agentId: session.agentId, ts: Date.now() });
  chat.messages.push({
    id: uid('m_'), role: 'agent', agentId: session.agentId, content: answer, answered: true, ts: Date.now(),
  });
  state.usage.userMessages += 1;
  state.usage.agentMessages += 1;
  save();
  paint(false);
  if (speakEnabled()) speakText(answer, voiceLang());
}

async function submitText(text, extra = {}) {
  const typed = String(text || '').trim();
  const attachment = session.attachment;
  const image = session.image || '';
  const imageDetail = session.imageDetail || image;
  if ((!typed && !attachment && !image) || runCtl) return;
  noteEvent('chat');
  const chat = currentChat();
  if (!chat) {
    toast('Create an agent first.');
    return;
  }
  const memoryCommand = typed ? parseMemoryCommand(typed) : null;
  if (memoryCommand && !attachment && !image) {
    const answer = await applyMemoryCommand(memoryCommand, currentAgent()?.id || '');
    const input = $('#input');
    if (input) { input.value = ''; input.style.height = 'auto'; }
    pushLocalTurn(chat, typed, answer, memoryCommand.op);
    return;
  }
  const routineCommand = typed ? parseRoutine(typed) : null;
  if (routineCommand && !attachment && !image) {
    const row = await createRoutine(routineCommand);
    const answer = routineCommand.lang === 'hu'
      ? `Be\u00e1ll\u00edtottam. Ez csak akkor fut, ha az Agora nyitva van.`
      : `Saved for ${row.text}. This runs only while Agora is open.`;
    const input = $('#input');
    if (input) { input.value = ''; input.style.height = 'auto'; }
    pushLocalTurn(chat, typed, answer, 'create_routine');
    return;
  }
  const clean = typed;
  const input = $('#input');
  if (input) {
    input.value = '';
    input.style.height = 'auto';
  }
  session.attachment = null;
  session.image = '';
  session.imageDetail = '';
  let imageText = '';
  let imageMiss = '';
  if (imageDetail) {
    paintPending(ui('Reading the picture…', 'A k\u00e9p olvas\u00e1sa…'), 0.05);
    try {
      const memoryGB = typeof navigator.deviceMemory === 'number' ? navigator.deviceMemory : null;
      const reading = await describeImage(imageDetail, {
        memoryGB,
        lang: voiceLang(),
        onProgress: (report) => paintPending(report.text, report.progress),
      });
      imageText = reading.text || '';
      imageMiss = reading.notice || '';
    } catch {
      imageMiss = ui(
        'Agora vision could not read this picture. Describe it in a sentence and Agora 1.0 can still help.',
        'Az Agora vision nem tudta elolvasni a k\u00e9pet. \u00cdrd le egy mondatban, \u00e9s az Agora 1.0 \u00edgy is tud seg\u00edteni.',
      );
    }
  }
  paintPending();
  await ensureGpu();
  runCtl = new AbortController();
  setBusy(true);
  try {
    const opts = { signal: runCtl.signal, onUpdate: (patch) => paint(!!patch), gpu: session.gpu };
    if (chat.type === 'group') {
      let body = clean;
      if (attachment?.text) body = `${attachment.text}\n\n${body}`.trim();
      await runGroupRound(chat, { ...opts, text: body, fresh: true, image, imageText, imageMiss, solution: !!extra.solution });
    } else await runUserTask(clean, { ...opts, onlyAgentId: session.agentId, chat, attachment, image, imageText, imageMiss, solution: !!extra.solution, title: typed });
  } catch (err) {
    console.error(err);
    chat.messages.push({
      id: uid('m_'),
      role: 'system',
      content: redactSecrets(err.friendly || err.message || 'Agora 1.0 could not answer. Please try again.'),
      ts: Date.now(),
    });
    save();
  } finally {
    runCtl = null;
    settlePending(chat.messages, { aborted: false });
    save();
    announce('Replied.');
    paint(false);
    if (speakEnabled()) {
      const last = [...chat.messages].reverse().find((item) => item.role === 'agent' && item.content && !item.pending);
      if (last) speakText(last.content, voiceLang());
    }
  }
}

function paintPending(statusText = '', progress = 0) {
  const box = $('#pending');
  if (!box) return;
  const bits = [];
  if (session.attachment) bits.push(session.attachment.name);
  if (session.image) bits.push(ui('Picture attached', 'K\u00e9p csatolva'));
  if (statusText) bits.push(statusText);
  box.hidden = !bits.length;
  const pct = progress > 0 && progress < 1 ? Math.round(progress * 100) : 0;
  box.innerHTML = `${escHtml(bits.join(' · '))}${pct ? `<div class="vision-bar"><span style="width:${pct}%"></span></div>` : ''}`;
}

function escHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

async function saveSettings() {
  const theme = $('#theme')?.value;
  if (theme === 'dark' || theme === 'light' || theme === 'system') state.settings.theme = theme;
  const repoField = $('#student-repo');
  if (repoField) {
    const repo = cleanRepo(repoField.value);
    if (!repo) {
      toast('Use a Hugging Face repo id like XxNoelW/Agora-1.0.');
      return;
    }
    state.settings.studentRepo = repo;
  }
  const choice = document.querySelector('input[name="model-choice"]:checked')?.value;
  if (choice === 'agora' || choice === 'agora-lite') {
    if (choice === 'agora-lite' && getLiteOffer() !== 'ready') {
      toast(ui('Agora Lite is coming soon.', 'Az Agora Lite hamarosan \u00e9rkezik.'));
      return;
    }
    state.settings.modelChoice = choice;
  }
  const improve = $('#help-improve');
  if (improve) state.settings.helpImprove = !!improve.checked;
  const counts = $('#usage-counts');
  if (counts) state.settings.usageCounts = !!counts.checked;
  const key = $('#or-key')?.value || '';
  if (key.trim()) writeOpenRouterKey(key);
  if ($('#cloud-url')) setCloudUrl($('#cloud-url').value);
  const field = $('#or-key');
  if (field) field.value = '';
  save();
  applyChrome();
  closeModal();
  toast(key.trim() ? 'Saved on this computer. The key stays in this browser.' : 'Saved on this computer.');
  paint(false);
  await ensureOnline();
  if (session.gpu?.ok) ensureAnswerModel().catch(() => {});
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
    session.draft = readAgentFields(session.draft);
    session.draft.icon = { type: 'shape', shape: btn.dataset.shape, color: session.draft.icon?.color || ICON_COLORS[0] };
    openAgentForm();
  },
  'pick-color'(btn) {
    session.draft = readAgentFields(session.draft);
    const icon = session.draft.icon || { type: 'shape', shape: 'robot' };
    session.draft.icon = { ...icon, type: icon.type === 'photo' ? 'photo' : 'shape', color: btn.dataset.color };
    if (session.draft.icon.type !== 'photo') session.draft.icon.shape = session.draft.icon.shape || 'robot';
    openAgentForm();
  },
  'use-example'(btn) {
    const input = $('#input');
    if (!input) return;
    input.value = btn.dataset.prompt || '';
    input.focus();
  },
  'show-solution'() {
    const text = voiceLang() === 'hu' ? 'Mutasd a teljes megold\u00e1st.' : 'Show the full solution.';
    submitText(text, { solution: true });
  },
  async 'download-offline'() {
    const box = $('#offline-progress');
    const button = document.querySelector('[data-act="download-offline"]');
    if (button) button.disabled = true;
    if (box) box.hidden = false;
    try {
      await downloadForOffline({
        vision: !!$('#offline-vision')?.checked,
        lang: voiceLang(),
        onProgress: (report) => {
          if (!box) return;
          const pct = report.progress > 0 && report.progress < 1 ? ` ${Math.round(report.progress * 100)}%` : '';
          box.textContent = `${report.text || ''}${pct}`;
        },
      });
      paintOffline();
      toast(ui('Available offline', 'Offline is el\u00e9rhet\u0151'));
    } catch (err) {
      toast(err.friendly || err.message || ui('The download did not finish.', 'A let\u00f6lt\u00e9s nem fejez\u0151d\u00f6tt be.'));
    } finally {
      if (button) button.disabled = false;
    }
  },
  'save-agent'() {
    session.draft = readAgentFields(session.draft);
    const fields = session.draft;
    const name = voiceLang() === 'hu' ? (fields.name || fields.nameHu) : fields.name;
    try {
      if (fields.id) {
        const agent = agentById(fields.id);
        if (!agent) return;
        applyAgentEdits(agent, {
          name: voiceLang() === 'hu' ? agent.name : name,
          nameHu: voiceLang() === 'hu' ? fields.nameHu : agent.nameHu,
          icon: fields.icon,
          emoji: fields.emoji,
          description: fields.description,
          descriptionHu: fields.descriptionHu,
          prompt: fields.prompt,
          examples: fields.examples,
          examplesHu: fields.examplesHu,
          tools: fields.tools,
        });
        if (voiceLang() !== 'hu') agent.name = name;
        if (agent.builtin === 'homework') {
          agent.tools = (agent.tools || []).filter((name) => name !== 'web_search' && name !== 'read_page' && name !== 'fetch_wikipedia_page');
        }
        save();
        closeModal();
        toast(ui('Agent updated.', 'Az agent friss\u00fclt.'));
        paint(false);
        return;
      }
      const agent = createAgentRecord({
        name, icon: fields.icon, emoji: fields.emoji, description: fields.description,
        prompt: fields.prompt, examples: fields.examples, tools: fields.tools,
      });
      if (voiceLang() === 'hu') {
        agent.nameHu = fields.nameHu || name;
        agent.descriptionHu = fields.descriptionHu || '';
        agent.examplesHu = fields.examplesHu || [];
      }
      state.agents.push(agent);
      const chat = createAgentChat(agent.id, { name: 'New chat', persist: false });
      save();
      closeModal();
      activateAgent(agent.id, chat.id);
    } catch (err) {
      toast(err.message || 'Add a name.');
    }
  },
  'duplicate-agent'(btn) {
    const agent = agentById(btn.dataset.id || session.draft?.id);
    if (!agent) return;
    const copy = duplicateAgent(agent);
    state.agents.push(copy);
    const chat = createAgentChat(copy.id, { name: 'New chat', persist: false });
    save();
    closeModal();
    activateAgent(copy.id, chat.id);
    toast(ui('Copied. This agent starts with empty memory.', 'M\u00e1solat k\u00e9sz. Ennek az agentnek \u00fcres a mem\u00f3ri\u00e1ja.'));
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
    if (agent.builtin) {
      const hidden = new Set(state.settings.hiddenBuiltins || []);
      hidden.add(agent.builtin);
      state.settings.hiddenBuiltins = [...hidden];
      state.settings.builtinsSeeded = true;
    }
    const next = removeAgent(id, state.agents, state.chats);
    state.agents.splice(0, state.agents.length, ...next.agents);
    state.chats.splice(0, state.chats.length, ...next.chats);
    await forgetAgent(id);
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
  'open-memory'() { openModal(memoryPanelHTML(currentAgent()?.id || ''), bindMemoryPanel, closeModal); $('#modal-box')?.classList.add('wide'); },
  'open-routines'() { openRoutines(); },
  'open-connectors'() { openConnectors('store'); },
  'save-memory'(btn) {
    const input = document.querySelector(`[data-memory="${btn.dataset.id}"]`);
    editMemory(btn.dataset.id, input?.value || '').then(() => openModal(memoryPanelHTML(currentAgent()?.id || ''), bindMemoryPanel, closeModal));
  },
  async 'delete-memory'(btn) {
    await removeMemory(btn.dataset.id);
    openModal(memoryPanelHTML(currentAgent()?.id || ''), bindMemoryPanel, closeModal);
  },
  'open-history'(btn) {
    const chat = state.chats.find((item) => item.id === btn.dataset.id);
    if (!chat) return;
    closeModal();
    if (chat.type === 'group') activateGroup(chat.id);
    else activateAgent(chat.agentId, chat.id);
  },
  async 'delete-routine'(btn) {
    await cancelRoutine(btn.dataset.id);
    openModal(routinesPanelHTML(), null, closeModal);
  },
  'notify-permission'() {
    if (!globalThis.Notification) { toast('This browser has no notifications.'); return; }
    Notification.requestPermission().then((result) => {
      toast(result === 'granted' ? 'Notifications are on for this browser.' : 'Notifications stay off.');
    });
  },
  async 'export-feedback'() {
    const rows = await loadFeedback();
    const blob = new Blob([toJSONL(rows)], { type: 'application/x-ndjson' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'agora-feedback.jsonl';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    toast(rows.length ? 'Downloaded on this computer. Nothing was sent.' : 'No ratings yet.');
  },
  async 'rate'(btn) {
    const chat = currentChat();
    const message = chat?.messages?.find((item) => item.id === btn.dataset.mid);
    if (!message) return;
    message.rating = btn.dataset.rate === 'down' ? 'down' : 'up';
    const record = feedbackRecord(chat, message, message.rating, message.ratingComment || '');
    await saveFeedback(record);
    save();
    noteEvent('feedback');
    if (helpImproveEnabled(state.settings)) {
      const messages = trainingTurn(chat, message);
      postTraining({ rating: message.rating, lang: voiceLang(), messages }).catch(() => {});
    }
    paint(false);
  },
  'example'(btn) {
    const item = examplePrompts()[Number(btn.dataset.example)];
    if (!item) return;
    submitText(item.text);
  },
  async 'share-chat'() {
    const chat = currentChat();
    const snapshot = snapshotFromChat(chat, (message) => agentById(message.agentId)?.name || 'Agora 1.0');
    if (!snapshot.messages.length) {
      toast(ui('Nothing to share yet.', 'M\u00e9g nincs mit megosztani.'));
      return;
    }
    session.shareDraft = snapshot;
    openModal(shareDialogHTML(snapshot, null), null, closeModal);
    try {
      const result = await publishShare(snapshot);
      if (result.ok) noteEvent('share');
      if ($('#modal') && !$('#modal').classList.contains('hidden')) openModal(shareDialogHTML(snapshot, result), null, closeModal);
    } catch {
      if ($('#modal') && !$('#modal').classList.contains('hidden')) {
        openModal(shareDialogHTML(snapshot, {
          ok: false,
          error: ui('The link could not be created. You can still copy the chat.', 'A link nem k\u00e9sz\u00fclt el. A cseveg\u00e9st \u00edgy is kim\u00e1solhatod.'),
        }), null, closeModal);
      }
    }
  },
  async 'copy-transcript'() {
    const text = transcriptText(session.shareDraft || { messages: [] });
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast(ui('Chat copied.', 'A cseveg\u00e9s a v\u00e1g\u00f3lapra ker\u00fclt.'));
    } catch {
      toast(ui('Select the chat and copy it.', 'Jel\u00f6ld ki a cseveg\u00e9st, \u00e9s m\u00e1sold ki.'));
    }
  },
  async 'copy-share-link'() {
    const link = $('#share-url')?.value || '';
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast(ui('Link copied.', 'A link a v\u00e1g\u00f3lapra ker\u00fclt.'));
    } catch {
      toast(ui('Select the link and copy it.', 'Jel\u00f6ld ki a linket, \u00e9s m\u00e1sold ki.'));
    }
  },
  async 'copy-shared'() {
    const text = transcriptText(session.shared || { messages: [] });
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast(ui('Chat copied.', 'A cseveg\u00e9s a v\u00e1g\u00f3lapra ker\u00fclt.'));
    } catch {
      toast(ui('Select the chat and copy it.', 'Jel\u00f6ld ki a cseveg\u00e9st, \u00e9s m\u00e1sold ki.'));
    }
  },
  'try-agora'() {
    const next = `${location.pathname}${location.hash || ''}`;
    location.assign(next);
  },
  'tour-next'() {
    const steps = tourSteps();
    session.tourStep = (session.tourStep || 0) + 1;
    if (session.tourStep >= steps.length) finishTour();
    else showTour();
  },
  'tour-skip': finishTour,
  'use-lite'() {
    if (getLiteOffer() !== 'ready') {
      toast(ui('Agora Lite is coming soon.', 'Az Agora Lite hamarosan \u00e9rkezik.'));
      return;
    }
    state.settings.modelChoice = 'agora-lite';
    state.settings.liteDismissed = true;
    save();
    ensureAnswerModel().catch(() => {});
    paint(false);
    toast(ui('Agora Lite will load.', 'Az Agora Lite t\u00f6lt\u0151dik.'));
  },
  'dismiss-lite'() {
    state.settings.liteDismissed = true;
    save();
    paint(false);
  },
  'retry-model'() {
    ensureAnswerModel().catch(() => {});
  },
  'pick-file'() { $('#file-input')?.click(); },
  'pick-image'() { $('#image-input')?.click(); },
  'voice-input'() { toggleMic(); },
  'voice-lang'() {
    const next = setVoiceLang(voiceLang() === 'hu' ? 'en' : 'hu');
    const button = $('#voice-lang');
    if (button) button.textContent = next === 'hu' ? 'HU' : 'EN';
    showTour();
    paint(false);
    if ($('#cloud-url')) openModal(settingsHTML(), null, closeModal);
  },
  'toggle-speak'() {
    const on = setSpeakEnabled(!speakEnabled());
    const button = $('#speak-toggle');
    if (button) button.setAttribute('aria-pressed', on ? 'true' : 'false');
    toast(on ? 'Agora 1.0 will read replies aloud.' : 'Spoken replies are off.');
  },
  'connector-tab'(btn) { openConnectors(btn.dataset.tab || 'store'); },
  'plugin-cat'(btn) { setPluginCategory(btn.dataset.cat || ''); openConnectors('store'); },
  'plugin-need'(btn) { setPluginNeeds(btn.dataset.need || ''); openConnectors('store'); },
  'plugins-more'() { showMorePlugins(); refreshPluginResults(); },
  async 'connect-plugin'(btn) {
    const plugin = catalogList().find((item) => item.id === btn.dataset.plugin);
    if (!plugin) return;
    const typed = document.querySelector(`[data-plugin-key="${plugin.id}"]`)?.value?.trim() || '';
    if (typed) await saveSecret(`plugin:${plugin.id}`, typed);
    if ((plugin.auth === 'oauth' || plugin.needs === 'signin') && !(await hasSecret(`plugin:${plugin.id}`))) {
      toast('Opening the sign-in page…');
      await beginMcpOauth(plugin);
      return;
    }
    const connected = await connectPlugin(plugin);
    rememberTools(plugin.id, connected.tools || plugin.tools || []);
    setEnabled(plugin.id, true);
    toast(connected.tools?.length ? `Connected. ${connected.tools.length} tools.` : 'Connected.');
    openConnectors('connected');
  },
  async 'disconnect-plugin'(btn) {
    const id = btn.dataset.plugin;
    setEnabled(id, false);
    dropMcpSession(id);
    await deleteSecret(`plugin:${id}`);
    if (id.startsWith('custom-')) removeCustom(id);
    toast('Disconnected on this computer.');
    openConnectors(document.querySelector('[data-tab].chip.on')?.dataset.tab || 'store');
  },
  async 'add-custom-mcp'() {
    const name = $('#custom-name')?.value?.trim() || 'Custom connector';
    const url = $('#custom-url')?.value?.trim() || '';
    const auth = $('#custom-auth')?.value || 'none';
    const headerName = $('#custom-header')?.value?.trim() || '';
    const secret = $('#custom-secret')?.value?.trim() || '';
    const id = `custom-${Math.random().toString(36).slice(2, 8)}`;
    addCustom({ id, name, url, auth, headerName });
    if (secret) await saveSecret(`plugin:${id}`, secret);
    setEnabled(id, true);
    const plugin = catalogList().find((item) => item.id === id);
    if (auth === 'oauth' && !secret) {
      toast('Opening the sign-in page…');
      await beginMcpOauth(plugin);
      return;
    }
    const connected = await connectPlugin(plugin);
    rememberTools(id, connected.tools || []);
    toast(connected.tools?.length ? `Added. ${connected.tools.length} tools.` : 'Added.');
    openConnectors('connected');
  },
  'save-plugin-settings'() {
    setMaxSteps($('#max-steps')?.value);
    setWorkerUrl($('#worker-url')?.value);
    toast('Proxy URL saved on this computer.');
  },
  async 'create-cloud-account'() {
    const result = await createAccount($('#cloud-url')?.value || '');
    toast(result.message);
    openModal(settingsHTML(), null, closeModal);
  },
  async 'copy-sync-code'() {
    const code = $('#sync-code')?.value || '';
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast(ui('Sync code copied.', 'A szinkronk\u00f3d a v\u00e1g\u00f3lapra ker\u00fclt.'));
    } catch {
      toast(ui('Select the code and copy it.', 'Jel\u00f6ld ki a k\u00f3dot, \u00e9s m\u00e1sold ki.'));
    }
  },
  async 'link-cloud'() {
    const result = await linkAccount($('#cloud-url')?.value || '', $('#cloud-link')?.value || '');
    toast(result.message);
    paint(false);
    openModal(settingsHTML(), null, closeModal);
  },
  async 'sync-now'() {
    setCloudUrl($('#cloud-url')?.value || '');
    const result = await syncNow();
    toast(result.message);
    openModal(settingsHTML(), null, closeModal);
  },
  async 'sync-keep-local'() {
    const result = await resolveConflict('local');
    toast(result.message);
    openModal(settingsHTML(), null, closeModal);
  },
  async 'sync-use-server'() {
    const result = await resolveConflict('server');
    toast(result.message);
    paint(false);
    openModal(settingsHTML(), null, closeModal);
  },
  'forget-cloud'() {
    clearCloudCode();
    toast(ui('Removed from this device. The account is still there.', 'Elt\u00e1vol\u00edtva err\u0151l az eszk\u00f6zr\u0151l. A fi\u00f3k megmaradt.'));
    openModal(settingsHTML(), null, closeModal);
  },
  async 'delete-cloud-account'() {
    const ok = await confirm({
      title: ui('Delete account', 'Fi\u00f3k t\u00f6rl\u00e9se'),
      text: ui(
        'The synced copy is deleted. Chats on this device stay.',
        'A szinkroniz\u00e1lt m\u00e1solat t\u00f6rl\u0151dik. A cseveg\u00e9sek ezen az eszk\u00f6z\u00f6n megmaradnak.',
      ),
      ok: ui('Delete account', 'Fi\u00f3k t\u00f6rl\u00e9se'),
      danger: true,
    });
    if (!ok) {
      openModal(settingsHTML(), null, closeModal);
      return;
    }
    const result = await removeAccount();
    toast(result.message);
    openModal(settingsHTML(), null, closeModal);
  },
  async 'test-connector'(btn) {
    const root = btn.closest('.connect-card, .connector-row');
    const cred = readConnectorCred(root);
    const id = btn.dataset.connector;
    const result = await testConnector(id, cred);
    if (result.ok) {
      await saveSecret(id, packCred(cred));
      if (btn.closest('.connect-card')) {
        const agent = currentAgent();
        if (agent && !(agent.connectors || []).includes(id)) agent.connectors = [...(agent.connectors || []), id];
      }
    }
    writeConnectorMeta(id, { state: result.ok ? 'connected' : 'failed', detail: result.detail });
    const chat = currentChat();
    if (chat) {
      for (const message of chat.messages) {
        if (message.role === 'connect' && message.connector === id) {
          message.state = result.ok ? 'connected' : 'failed';
          message.detail = result.detail;
        }
      }
    }
    save();
    toast(result.detail);
    if ($('#modal-title')?.textContent === 'Connectors') openConnectors('accounts');
    else paint(false);
  },
  async 'disconnect-connector'(btn) {
    const id = btn.dataset.connector;
    await deleteSecret(id);
    if (id === 'mastodon') await deleteSecret('mastodon-host');
    writeConnectorMeta(id, { state: 'unknown', detail: 'Disconnected.' });
    save();
    toast('Disconnected on this computer.');
    openConnectors('accounts');
  },
  async 'mastodon-start'(btn) {
    const root = btn.closest('.connect-card, .connector-row');
    const host = root?.querySelector('[data-field="host"]')?.value || 'mastodon.social';
    toast('Opening Mastodon…');
    await beginMastodonLogin(host);
  },
  async 'oauth-start'(btn) {
    const root = btn.closest('.connect-card, .connector-row');
    const clientId = root?.querySelector('[data-field="clientId"]')?.value || '';
    toast('Opening the sign-in page…');
    await beginPkce(btn.dataset.oauth, clientId);
  },
  async 'open-settings'() {
    await refreshLiteOffer().catch(() => {});
    openModal(settingsHTML(), null, closeModal);
  },
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
    clearCloudCode();
    closeModal();
    const first = state.agents[0];
    if (first) activateAgent(first.id);
    else {
      session.view = 'empty';
      session.agentId = '';
      session.chatId = '';
      session.groupId = '';
      paint(false);
    }
    toast('Erased on this browser.');
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
const oauthParams = new URLSearchParams(location.search);
const oauthCode = oauthParams.get('code');
const oauthError = oauthParams.get('error');
const oauthState = oauthParams.get('state') || '';
const oauthProvider = oauthState.split('.')[0];
if (oauthCode || oauthError) {
  history.replaceState(null, '', location.pathname + location.hash);
  if (oauthError) toast('Sign-in was cancelled.');
  else if (oauthProvider === 'mcp') {
    finishMcpOauth(oauthCode, oauthState).then(async (result) => {
      await saveSecret(`plugin:${result.id}`, result.accessToken);
      setEnabled(result.id, true);
      toast('Signed in on this computer.');
      paint(false);
    }).catch((err) => toast(scrubOauth(err)));
  } else if (oauthProvider === 'spotify' || oauthProvider === 'dropbox' || oauthProvider === 'gdrive') {
    finishPkce(oauthProvider, oauthCode, oauthState).then((result) => {
      toast(result.detail);
      paint(false);
    }).catch((err) => toast(scrubOauth(err)));
  } else {
    finishMastodonLogin(oauthCode).then((profile) => {
      toast(`Mastodon connected as @${profile.username}.`);
      paint(false);
    }).catch((err) => toast(scrubOauth(err)));
  }
}
function scrubOauth(err) {
  return redactSecrets(err?.message || 'Mastodon sign-in failed.');
}
ensureAgentChats(state.agents);
if (!state.settings.activeAgentId && state.agents[0]) state.settings.activeAgentId = state.agents[0].id;
session.view = state.settings.activeGroupId ? 'group' : (state.settings.activeAgentId ? 'agent' : 'empty');
session.agentId = state.settings.activeAgentId || '';
session.chatId = state.settings.activeChatId || '';
session.groupId = state.settings.activeGroupId || '';
const shareId = oauthParams.get('share');
const openingShare = !!(shareId && !oauthCode && !oauthError);
if (openingShare) {
  document.body.classList.add('share-mode');
  session.shared = { loading: true, title: '', messages: [] };
  paint(false);
  fetchShare(shareId).then((snap) => {
    session.shared = snap.error ? { error: snap.error, title: '', messages: [] } : snap;
    paint(false);
  });
} else if (session.view === 'group' && currentGroup()) activateGroup(session.groupId);
else if (currentAgent()) activateAgent(session.agentId, session.chatId);
else paint(false);

function readConnectorCred(root) {
  const fields = [...(root?.querySelectorAll('[data-field]') || [])];
  if (!fields.length) {
    const input = root?.querySelector('input[type="password"]');
    const key = String(input?.value || '').trim();
    if (input) input.value = '';
    return key;
  }
  const cred = {};
  for (const el of fields) {
    cred[el.dataset.field] = el.value.trim();
    if (el.type === 'password') el.value = '';
  }
  return cred;
}

document.addEventListener('click', onClick);
document.addEventListener('input', (event) => {
  if (event.target?.id === 'chat-search') {
    session.chatQuery = event.target.value;
    paint(false);
    return;
  }
  if (event.target?.dataset?.rateNote) {
    const chat = currentChat();
    const message = chat?.messages?.find((item) => item.id === event.target.dataset.rateNote);
    if (!message?.rating) return;
    message.ratingComment = event.target.value;
    saveFeedback(feedbackRecord(chat, message, message.rating, message.ratingComment));
    save();
    return;
  }
  if (event.target?.id === 'plugin-filter') {
    setPluginQuery(event.target.value.trim());
    refreshPluginResults();
    return;
  }
  if (event.target?.id !== 'connector-filter') return;
  const query = event.target.value.trim().toLowerCase();
  document.querySelectorAll('[data-connector-card]').forEach((card) => {
    card.hidden = !!query && !(card.dataset.hay || '').includes(query);
  });
  document.querySelectorAll('[data-connector-group]').forEach((group) => {
    const cards = [...group.querySelectorAll('[data-connector-card]')];
    group.hidden = cards.length > 0 && cards.every((card) => card.hidden);
  });
});
document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  if (form.id === 'composer') submitText($('#input')?.value);
  else if (form.id === 'settings-form') saveSettings();
});
document.addEventListener('change', async (event) => {
  if (event.target?.dataset?.pluginToggle) {
    setEnabled(event.target.dataset.pluginToggle, event.target.checked);
    refreshPluginResults();
    return;
  }
  if (event.target?.dataset?.allow) {
    const agent = agentById(event.target.dataset.id);
    const id = event.target.dataset.connector;
    if (!agent || !id) return;
    const set = new Set(agent.connectors || []);
    if (event.target.checked) set.add(id);
    else set.delete(id);
    agent.connectors = [...set];
    save();
    return;
  }
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
function afterFirstPaint(fn) {
  if (typeof requestAnimationFrame !== 'function') {
    setTimeout(fn, 0);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(fn));
}
function startModel() {
  requestPersistentStorage();
  gpuPromise = checkWebGPU();
  gpuPromise.then((result) => {
    session.gpu = { ...result, pending: false };
    if (result.ok) ensureAnswerModel().catch(() => {});
    else paintLoad();
    paintStatus();
  });
  refreshLiteOffer().then(() => { if (!session.shared) paint(false); }).catch(() => {});
}
ensureOnline();
ensureCatalog().catch(() => {});
loadMemories().then(async (rows) => {
  const home = state.agents.find((agent) => agent.builtin === 'default') || state.agents[0];
  if (!home) return;
  const claimed = claimLegacyMemories(rows, home.id);
  if (claimed.changed) await replaceMemories(claimed.list);
}).catch(() => {});
loadFeedback().catch(() => {});
loadRoutines().then(() => {
  startRoutineLoop(async (routine) => {
    if (globalThis.Notification?.permission === 'granted') {
      try { new Notification('Agora 1.0', { body: routine.text }); } catch { /* the browser blocked it */ }
    }
    toast(routine.text);
    const chat = currentChat();
    if (!chat || runCtl) return;
    if (/\b(tell|weather|what|mondd|id\u0151j\u00e1r\u00e1s)\b/i.test(routine.text)) submitText(routine.text);
    else {
      chat.messages.push({ id: uid('m_'), role: 'system', content: `Reminder: ${routine.text}`, ts: Date.now() });
      save();
      paint(false);
    }
  });
}).catch(() => {});
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js', { type: 'module' }).catch(() => {});
}
noteEvent('visit');
if (!openingShare) {
  showTour();
  afterFirstPaint(startModel);
}
const langButton = $('#voice-lang');
if (langButton) langButton.textContent = voiceLang() === 'hu' ? 'HU' : 'EN';
const speakButton = $('#speak-toggle');
if (speakButton) speakButton.setAttribute('aria-pressed', speakEnabled() ? 'true' : 'false');

function openRoutines() {
  openModal(routinesPanelHTML(), (box) => {
    box.querySelector('#routine-add')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const text = box.querySelector('#routine-text')?.value || '';
      const kind = box.querySelector('#routine-kind')?.value || 'daily';
      const time = box.querySelector('#routine-time')?.value || '08:00';
      const [hour, minute] = time.split(':').map((part) => Number(part));
      const weekday = Number(box.querySelector('#routine-day')?.value || 0);
      if (!text.trim() || !Number.isFinite(hour)) return;
      await createRoutine({ text: text.trim(), kind, hour, minute: minute || 0, weekday: kind === 'weekly' ? weekday : null });
      openRoutines();
    });
  }, closeModal);
  $('#modal-box')?.classList.add('wide');
}

function bindMemoryPanel(box) {
  box.querySelector('#memory-toggle')?.addEventListener('change', (event) => {
    setMemoryEnabled(event.target.checked);
  });
  box.querySelector('#memory-add')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const text = box.querySelector('#memory-text')?.value || '';
    if (!text.trim()) return;
    await addMemory(text, 'fact', currentAgent()?.id || '');
    openModal(memoryPanelHTML(currentAgent()?.id || ''), bindMemoryPanel, closeModal);
    $('#modal-box')?.classList.add('wide');
  });
  box.querySelector('#history-filter')?.addEventListener('input', (event) => filterHistory(event.target.value));
}

let listening = null;
function toggleMic() {
  if (listening) {
    listening.stop();
    listening = null;
    $('#mic')?.setAttribute('aria-pressed', 'false');
    return;
  }
  listening = startListening({
    lang: voiceLang(),
    onText(said) {
      const input = $('#input');
      if (input) input.value = said;
    },
    onEnd() {
      listening = null;
      $('#mic')?.setAttribute('aria-pressed', 'false');
    },
    onError(err) {
      listening = null;
      $('#mic')?.setAttribute('aria-pressed', 'false');
      toast(err.message || 'Voice input stopped.');
    },
  });
  if (listening) $('#mic')?.setAttribute('aria-pressed', 'true');
}

$('#file-input')?.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (file.size > 2000000) { toast('That file is too big.'); return; }
  try {
    let text = '';
    if (/pdf$/i.test(file.name) || file.type === 'application/pdf') {
      text = await textFromPdf(new Uint8Array(await file.arrayBuffer()));
      if (!text) { toast('No text could be read from that PDF.'); return; }
    } else text = await file.text();
    session.attachment = { name: file.name, text: attachmentBlock(file.name, text).split('\n').slice(1).join('\n') || text.slice(0, 8000) };
    paintPending();
  } catch {
    toast('That file could not be read.');
  }
});
$('#image-input')?.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    session.image = await shrinkChatImage(file);
    try { session.imageDetail = await visionImage(file); }
    catch { session.imageDetail = session.image; }
    paintPending(ui(
      'Agora vision may download about 4.4 GB the first time.',
      'Az Agora vision az els\u0151 alkalommal k\u00f6r\u00fclbel\u00fcl 4,4 GB-ot t\u00f6lthet le.',
    ));
  } catch (err) {
    toast(err.message || 'That image could not be used.');
  }
});
window.addEventListener('online', () => {
  paintOffline();
  flushQueuedSync().then((result) => { if (result?.message) toast(result.message); }).catch(() => {});
});
window.addEventListener('offline', () => paintOffline());

let connectorTab = 'store';
async function openConnectors(tab) {
  connectorTab = tab || connectorTab;
  try { await ensureCatalog(); } catch { /* the store still opens if the catalog file is missing */ }
  openModal(await connectorsShell(connectorTab), null, closeModal);
  $('#modal-box')?.classList.add('wide');
}
async function refreshPluginResults() {
  const box = $('#plugin-results');
  if (!box) return;
  box.innerHTML = await pluginResultsHTML();
}
