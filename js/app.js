import { state, save, audit, uid, agentById, resetAll, replaceAll, workspaceChat, MODELS, prefersSmallModel, exportState } from './store.js';
import { onStatus, status, loadModel, checkWebGPU } from './llm.js';
import { normPath } from './tools.js';
import { TEMPLATES, roleById } from './roles.js';
import { clampParallel } from './scheduler.js';
import { teachers, requestTraining } from './teachers.js';
import {
  createOpenRouterAdapter, listModels, pickDefaultTeacherIds, formatPrice,
  writeOpenRouterKey, forgetOpenRouterKey, readOpenRouterKey, redactSecrets, reserveCall,
} from './openrouter.js';
import { runTeacherPipeline, setApproval, toJSONL } from './pipeline.js';
import { parseMetrics } from './metrics.js';
import { usingOpenRouter } from './generate.js';
import { runUserTask, pauseAgent, resumeAgent, stopAgent, isRunning } from './runner.js';
import { watchFigures, playHandoff, figureHTML } from './characters.js';
import { session } from './session.js';
import { $, closeModal, openModal, confirm, toast, announce } from './dom.js';
import {
  renderPage, bannerHTML, patchThread, syncAgents, filterLog,
  createModalHTML, renameModalHTML, runModalHTML, mark,
} from './pages.js';

const view = $('#view');
const TITLES = {
  dashboard: 'Home',
  agents: 'Agents',
  workspace: 'Workspace',
  teachers: 'Teachers',
  training: 'Training',
  eval: 'Scores',
  log: 'Log',
  settings: 'Settings',
};

let runCtl = null;
let seenHandoff = state.handoff?.id || null;
let gpuPromise = null;

function resolvedTheme() {
  const choice = state.settings.theme;
  if (choice === 'light' || choice === 'dark') return choice;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyChrome() {
  document.documentElement.dataset.theme = resolvedTheme();
  document.documentElement.dataset.sidebar = state.settings.sidebarCollapsed ? 'collapsed' : 'open';
  const themeBtn = $('#theme-btn');
  if (themeBtn) {
    const label = state.settings.theme === 'light' ? 'Light theme' : state.settings.theme === 'dark' ? 'Dark theme' : 'Device theme';
    themeBtn.textContent = label;
    themeBtn.setAttribute('aria-label', `Theme: ${label}. Click to change.`);
  }
  const collapse = $('#collapse-btn');
  if (collapse) {
    const collapsed = state.settings.sidebarCollapsed;
    collapse.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    collapse.setAttribute('aria-label', collapsed ? 'Show the sidebar' : 'Hide the sidebar');
  }
}

function paintStatus() {
  const el = $('#model-status');
  if (!el) return;
  const pct = status.progress > 0 && status.progress < 1 ? Math.round(status.progress * 100) : 0;
  el.innerHTML = `${status.text}${pct ? `<div class="progress"><div style="width:${pct}%"></div></div>` : ''}`;
}

function setBusy(on) {
  const send = $('#send');
  const stop = $('#stop');
  if (send) send.hidden = on;
  if (stop) stop.hidden = !on;
}

function draw({ keepDraft = true } = {}) {
  const draft = keepDraft ? ($('#input')?.value ?? '') : '';
  const focused = document.activeElement?.id === 'input';
  session.route = routeName();
  document.title = `${TITLES[session.route] || 'Agona'} · Agona`;
  document.querySelectorAll('#nav a').forEach((link) => link.classList.toggle('active', link.dataset.route === session.route));
  document.body.classList.remove('nav-open');
  view.innerHTML = renderPage(session.route);
  const input = $('#input');
  if (input && draft) input.value = draft;
  if (focused && input) input.focus();
  const brand = $('.brand-mark');
  if (brand && !brand.innerHTML) brand.innerHTML = mark();
  paintStatus();
  watchFigures(document);
  syncAgents();
  setBusy(isRunning());
  const hop = state.handoff;
  if (hop && hop.id !== seenHandoff) {
    seenHandoff = hop.id;
    playHandoff(hop.fromId, hop.toId);
    const from = agentById(hop.fromId);
    const to = agentById(hop.toId);
    if (from && to) announce(`${from.name} handed the job to ${to.name}.`);
  }
}

function routeName() {
  const name = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/')[0];
  return TITLES[name] ? name : 'dashboard';
}

function refresh(patch) {
  syncAgents();
  if (patch && patchThread()) {
    setBusy(isRunning());
    const hop = state.handoff;
    if (hop && hop.id !== seenHandoff) {
      seenHandoff = hop.id;
      playHandoff(hop.fromId, hop.toId);
    }
    return;
  }
  if (session.route === 'workspace' || session.route === 'dashboard' || session.route === 'agents') draw();
}

async function ensureGpu() {
  if (!session.gpu.pending) return session.gpu;
  session.gpu = { ...(await gpuPromise), pending: false };
  return session.gpu;
}

async function submitText(text, extra = {}) {
  const clean = String(text || '').trim();
  if (!clean || runCtl) return;
  const input = $('#input');
  if (input) input.value = '';
  await ensureGpu();
  if (session.route !== 'workspace') location.hash = '#/workspace';
  runCtl = new AbortController();
  setBusy(true);
  const onUpdate = (patch) => refresh(!!patch);
  try {
    await runUserTask(clean, { signal: runCtl.signal, onUpdate, gpu: session.gpu, ...extra });
  } catch (err) {
    console.error(err);
    const chat = workspaceChat();
    chat.messages.push({ id: uid('m_'), role: 'system', content: redactSecrets(err.friendly || err.message || 'Something went wrong.'), ts: Date.now() });
    save();
  } finally {
    runCtl = null;
    draw({ keepDraft: true });
  }
}

function readNumber(id, fallback) {
  const value = +$(id)?.value;
  return Number.isFinite(value) ? value : fallback;
}

async function saveSettings(fromForm) {
  const prev = { ...state.settings };
  const nextParallel = clampParallel(readNumber('#parallel', prev.maxParallel));
  const nextRuntime = Math.max(30, Math.min(300, Math.round(readNumber('#runtime', prev.maxRuntimeSec))));
  const nextTokens = Math.max(64, Math.min(1024, Math.round(readNumber('#tokens', prev.maxTokens))));
  const bumps = [];
  if (fromForm) {
    if (nextParallel > prev.maxParallel) bumps.push(`agents at once ${prev.maxParallel} to ${nextParallel}`);
    if (nextRuntime > prev.maxRuntimeSec) bumps.push(`time limit ${prev.maxRuntimeSec}s to ${nextRuntime}s`);
    if (nextTokens > prev.maxTokens) bumps.push(`answer length ${prev.maxTokens} to ${nextTokens}`);
  }
  if (bumps.length) {
    const ok = await confirm({
      title: 'Raise a limit',
      text: `These will go up: ${bumps.join(', ')}. That can use more memory or time on your computer.`,
      ok: 'Raise',
    });
    if (!ok) { draw(); return; }
    audit('limit', bumps.join(', '));
  }
  const model = fromForm ? ($('#set-model')?.value || prev.model) : prev.model;
  if (prefersHeavy(model) && model !== prev.model) {
    const ok = await confirm({
      title: 'Nagy modell',
      text: 'This helper may be too big for this device. If there is not enough memory, loading will fail. The small helper is the safe pick.',
      ok: 'Use it anyway',
    });
    if (!ok) { draw(); return; }
  }
  state.settings.theme = fromForm ? ($('#theme')?.value || prev.theme) : prev.theme;
  state.settings.model = MODELS.some((item) => item.id === model) ? model : prev.model;
  state.settings.temperature = fromForm ? Math.max(0, Math.min(2, readNumber('#temperature', prev.temperature))) : prev.temperature;
  state.settings.maxTokens = fromForm ? nextTokens : prev.maxTokens;
  state.settings.maxParallel = nextParallel;
  state.settings.maxRuntimeSec = fromForm ? nextRuntime : prev.maxRuntimeSec;
  if (fromForm) {
    const source = $('#reply-source')?.value;
    if (source === 'auto' || source === 'local' || source === 'openrouter') state.settings.replySource = source;
    const chatModel = $('#chat-teacher')?.value || '';
    state.settings.openrouterChatModel = state.teachers.some((item) => item.model === chatModel) ? chatModel : '';
  }
  state.settings.modelMigrated = true;
  save();
  applyChrome();
  draw();
  toast('Settings saved on this computer only.');
}

function prefersHeavy(id) {
  return prefersSmallModel() && (id === MODELS[0].id || id === MODELS[1].id);
}

async function onFile(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (file.size > 200000) { toast('That file is too big for a note.'); return; }
  const text = await file.text();
  if (text.includes('\u0000')) { toast('Only text files can become notes.'); return; }
  const path = normPath('/attachments/' + file.name.replace(/[^\w.\- ]/gi, '_'));
  state.files[path] = text.slice(0, 100000);
  state.fileOwners[path] = 'user';
  save();
  const box = $('#input');
  if (box) box.value = `${box.value ? box.value + ' ' : ''}Attached note: ${path}`;
  toast('The file is in the shared notes. It was not uploaded.');
  if (session.route === 'workspace') draw();
}

const actions = {
  async 'load-model'() {
    await ensureGpu();
    if (!session.gpu.ok) { toast(session.gpu.reason); return; }
    loadModel(state.settings.model).catch(() => {});
  },
  'toggle-model'(btn) {
    const pop = $('#model-pop');
    if (!pop) return;
    pop.hidden = !pop.hidden;
    btn.setAttribute('aria-expanded', pop.hidden ? 'false' : 'true');
  },
  async 'pick-model'(btn) {
    const id = btn.dataset.model;
    if (!MODELS.some((model) => model.id === id)) return;
    if (prefersHeavy(id) && id !== state.settings.model) {
      const ok = await confirm({
        title: 'Nagy modell',
        text: 'This helper may be too big for this device. If there is not enough memory, loading will fail.',
        ok: 'Use it anyway',
      });
      if (!ok) return;
    }
    state.settings.model = id;
    state.settings.modelMigrated = true;
    audit('model', id);
    save();
    $('#model-pop')?.setAttribute('hidden', '');
    draw();
  },
  attach() { $('#file')?.click(); },
  'stop-all'() {
    runCtl?.abort();
    if (session.runBucket) session.runBucket.stopped = true;
    for (const agent of state.agents) {
      if (agent.status === 'working' || agent.status === 'thinking') stopAgent(agent.id);
    }
    toast('Stopped what was running.');
    draw();
  },
  'open-create'() { openModal(createModalHTML(), null, closeModal); },
  'close-modal': closeModal,
  'save-create'() {
    const role = roleById($('#tmpl')?.value) || TEMPLATES[0];
    const name = $('#an')?.value.trim();
    if (!name) { toast('Please add a name.'); return; }
    state.agents.push({
      id: uid('a_'),
      name,
      role: role.id,
      color: role.color,
      accessory: role.accessory,
      prompt: $('#ap')?.value.trim() || role.prompt,
      tools: role.tools.slice(),
      status: 'idle',
      paused: false,
      error: '',
      taskId: null,
    });
    audit('create', `${name} · ${role.title}`);
    save();
    closeModal();
    draw();
  },
  'rename-agent'(btn) {
    const agent = agentById(btn.dataset.id);
    if (!agent) return;
    openModal(renameModalHTML(agent), null, closeModal);
  },
  'save-rename'(btn) {
    const agent = agentById(btn.dataset.id);
    const name = $('#an')?.value.trim();
    if (!agent || !name) return;
    const prev = agent.name;
    agent.name = name;
    audit('rename', `${prev} to ${name}`);
    save();
    closeModal();
    draw();
  },
  pause(btn) { pauseAgent(btn.dataset.id); draw(); },
  resume(btn) { resumeAgent(btn.dataset.id); draw(); },
  'stop-agent'(btn) { stopAgent(btn.dataset.id); draw(); },
  'ask-run'(btn) {
    const agent = agentById(btn.dataset.id);
    if (!agent) return;
    if (agent.paused) { toast('Continue the agent first.'); return; }
    openModal(runModalHTML(agent), null, closeModal);
  },
  'save-run'(btn) {
    const text = $('#one-task')?.value.trim();
    const id = btn.dataset.id;
    if (!text) { toast('Write the job first.'); return; }
    closeModal();
    submitText(text, { onlyAgentId: id });
  },
  async 'delete-agent'(btn) {
    const agent = agentById(btn.dataset.id);
    if (!agent) return;
    const ok = await confirm({
      title: 'Delete agent',
      text: `${agent.name} will be removed from this computer. Their notes stay. This cannot be undone.`,
      ok: 'Delete',
      danger: true,
    });
    if (!ok) return;
    stopAgent(agent.id);
    state.agents = state.agents.filter((item) => item.id !== agent.id);
    for (const task of state.tasks) {
      if (task.assigneeId === agent.id && ['queued', 'running', 'paused'].includes(task.status)) task.status = 'skipped';
    }
    audit('delete', agent.name);
    save();
    draw();
  },
  async 'delete-task'(btn) {
    const task = state.tasks.find((item) => item.id === btn.dataset.id);
    if (!task) return;
    const ok = await confirm({
      title: 'Delete job',
      text: `Remove this from the list: ${task.title}`,
      ok: 'Delete',
      danger: true,
    });
    if (!ok) return;
    state.tasks = state.tasks.filter((item) => item.id !== task.id);
    audit('delete', task.title);
    save();
    draw();
  },
  'new-note'() {
    openModal(`<h2 id="modal-title">New note</h2><label for="note-name">File name</label><input id="note-name" value="/notes.txt"><div class="row"><button type="button" data-ok data-act="save-new-note">Create</button><button type="button" class="ghost" data-act="close-modal">Cancel</button></div>`, null, closeModal);
  },
  'save-new-note'() {
    const path = normPath($('#note-name')?.value || '');
    if (path === '/') { toast('Add a file name, like /notes.txt'); return; }
    state.files[path] ??= '';
    state.fileOwners[path] = 'user';
    session.note = path;
    audit('note', path);
    save();
    closeModal();
    draw();
  },
  'open-note'(btn) { session.note = btn.dataset.path; draw(); },
  'save-note'() {
    if (!session.note) return;
    state.files[session.note] = $('#note-body')?.value ?? '';
    state.fileOwners[session.note] = state.fileOwners[session.note] || 'user';
    save();
    toast('Note saved on this computer.');
  },
  async 'delete-note'() {
    if (!session.note) return;
    const ok = await confirm({ title: 'Delete note', text: `Delete ${session.note}?`, ok: 'Delete', danger: true });
    if (!ok) return;
    delete state.files[session.note];
    delete state.fileOwners[session.note];
    audit('delete', session.note);
    session.note = null;
    save();
    draw();
  },
  async 'test-teacher'(btn) {
    const teacher = state.teachers.find((item) => item.id === btn.dataset.id);
    if (!teacher) return;
    if (!readOpenRouterKey()) { toast('Save a key on this computer first.'); return; }
    session.runBucket = { run: 0, global: state.usage.openrouterCalls || 0, stopped: false };
    try { reserveCall(session.runBucket, { perRun: state.settings.orPerRun, global: state.settings.orGlobal }); }
    catch (err) { toast(redactSecrets(err.message)); return; }
    state.usage.openrouterCalls = session.runBucket.global;
    save();
    const result = await teachers.testConnection('openrouter', { model: teacher.model });
    teacher.connected = !!result.ok;
    audit('connection test', result.message, teacher.label || 'teacher');
    save();
    toast(redactSecrets(result.message));
    draw();
  },
  async 'delete-teacher'(btn) {
    const teacher = state.teachers.find((item) => item.id === btn.dataset.id);
    if (!teacher) return;
    const ok = await confirm({
      title: 'Remove teacher',
      text: `${teacher.label || teacher.model} will leave your list. The key stays until you forget it.`,
      ok: 'Remove',
      danger: true,
    });
    if (!ok) return;
    state.teachers = state.teachers.filter((item) => item.id !== teacher.id);
    audit('delete', teacher.label);
    save();
    draw();
  },
  'export-data'() {
    const blob = new Blob([JSON.stringify(exportState(), null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'agona-masolat.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    audit('save', 'downloaded a local copy');
  },
  async erase() {
    const ok = await confirm({
      title: 'Erase everything',
      text: 'Every agent, job, note, and log entry on this browser will be deleted. The OpenRouter key goes too. This cannot be undone.',
      ok: 'Erase',
      danger: true,
    });
    if (!ok) return;
    resetAll();
    session.note = null;
    toast('Erased on this browser.');
    draw();
  },
  menu() { document.body.classList.toggle('nav-open'); },
  collapse() {
    state.settings.sidebarCollapsed = !state.settings.sidebarCollapsed;
    save();
    applyChrome();
  },
  'forget-key'() {
    forgetOpenRouterKey();
    audit('key', 'OpenRouter key forgotten on this computer');
    toast('The key is forgotten on this computer.');
    draw();
  },
  async 'refresh-models'() { await refreshModels(); },
  'add-teacher'(btn) {
    const id = btn.dataset.model;
    if (!id) return;
    addTeacherRecord(id);
    audit('teacher', `added ${id}`);
    save();
    draw();
  },
  'approve-example'(btn) {
    const example = (state.examples || []).find((item) => item.id === btn.dataset.id);
    if (!example) return;
    try {
      setApproval(example, 'approved');
      audit('approved', `${example.model}: ${String(example.prompt || '').slice(0, 80)}`);
      save();
      draw();
    } catch (err) { toast(err.message); }
  },
  'reject-example'(btn) {
    const example = (state.examples || []).find((item) => item.id === btn.dataset.id);
    if (!example) return;
    setApproval(example, 'rejected');
    audit('rejected', `${example.model}: ${String(example.prompt || '').slice(0, 80)}`);
    save();
    draw();
  },
  'export-jsonl'() {
    const text = toJSONL(state.examples || []);
    if (!text) { toast('No approved examples to download.'); return; }
    downloadText('agona-approved.jsonl', text, 'application/jsonl');
    audit('export', 'downloaded approved examples');
  },
  'stop-pipeline'() {
    if (session.runBucket) session.runBucket.stopped = true;
    pipelineCtl?.abort();
    toast('Stopping the teacher run.');
  },
  'cycle-theme'() {
    const order = ['system', 'dark', 'light'];
    const next = order[(order.indexOf(state.settings.theme) + 1) % order.length];
    state.settings.theme = next;
    save();
    applyChrome();
  },
};

async function onClick(event) {
  const btn = event.target.closest('[data-act]');
  if (!btn || btn.disabled) return;
  if (btn.dataset.act === 'pick-model') event.preventDefault();
  const fn = actions[btn.dataset.act];
  if (!fn) return;
  try { await fn(btn); }
  catch (err) { console.error(err); toast(redactSecrets(err.friendly || err.message || 'That did not work.')); }
}

function onSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  if (form.id === 'composer') submitText($('#input')?.value);
  else if (form.id === 'settings-form') saveSettings(true);
  else if (form.id === 'train-form') startTraining();
  else if (form.id === 'key-form') saveKey();
  else if (form.id === 'limit-form') saveLimits();
  else if (form.id === 'ask-teachers') askTeachers();
}

function limitsNow() {
  return { perRun: state.settings.orPerRun, global: state.settings.orGlobal };
}

function freshBucket() {
  session.runBucket = { run: 0, global: state.usage.openrouterCalls || 0, stopped: false };
  return session.runBucket;
}

function rememberCalls(bucket) {
  state.usage.openrouterCalls = bucket.global;
  save();
}

async function refreshModels() {
  session.catalogError = '';
  try {
    const models = await listModels();
    session.catalog = models;
    if (!state.teachers.length) {
      const ids = pickDefaultTeacherIds(models);
      for (const id of ids) addTeacherRecord(id, models);
      if (ids.length) audit('teachers', `default teachers: ${ids.join(', ')}`);
    }
  } catch (err) {
    session.catalogError = redactSecrets(err.message || 'The model list did not load.');
  }
  save();
  draw();
}

function addTeacherRecord(modelId, catalog = session.catalog) {
  if (state.teachers.some((item) => item.model === modelId)) return;
  const found = catalog.find((item) => item.id === modelId);
  if (!found) return;
  state.teachers.push({
    id: uid('t_'),
    model: found.id,
    label: found.name,
    provider: 'OpenRouter',
    price: formatPrice(found),
    license: found.license || 'not listed',
    contextLength: found.contextLength,
    connected: false,
  });
  if (!state.settings.openrouterChatModel) state.settings.openrouterChatModel = found.id;
}

async function saveLimits() {
  const prev = { per: state.settings.orPerRun, global: state.settings.orGlobal };
  const nextPer = Math.max(1, Math.min(30, Math.round(readNumber('#or-per-run', prev.per))));
  const nextGlobal = Math.max(1, Math.min(500, Math.round(readNumber('#or-global', prev.global))));
  const bumps = [];
  if (nextPer > prev.per) bumps.push(`calls in one run ${prev.per} to ${nextPer}`);
  if (nextGlobal > prev.global) bumps.push(`total calls ${prev.global} to ${nextGlobal}`);
  if (bumps.length) {
    const ok = await confirm({
      title: 'Raise a limit',
      text: `These will go up: ${bumps.join(', ')}. More calls can go to openrouter.ai.`,
      ok: 'Raise',
    });
    if (!ok) { draw(); return; }
    audit('limit', bumps.join(', '));
  }
  state.settings.orPerRun = nextPer;
  state.settings.orGlobal = nextGlobal;
  save();
  toast('Call limits saved on this computer.');
  draw();
}

function setRoleStatus(role, status) {
  const agent = state.agents.find((item) => item.role === role);
  if (!agent || agent.paused) return;
  agent.status = status;
}

let pipelineCtl = null;

async function askTeachers() {
  if (pipelineCtl) return;
  const task = $('#teacher-task')?.value.trim();
  if (!task) { toast('Write a job for the teachers.'); return; }
  if (!readOpenRouterKey()) { toast('Save a key on this computer first.'); return; }
  if (state.teachers.length < 2) { toast('Add at least two teachers.'); return; }
  pipelineCtl = new AbortController();
  session.pipelineRunning = true;
  const bucket = freshBucket();
  setRoleStatus('teacher', 'working');
  setRoleStatus('judge', 'thinking');
  setRoleStatus('cleaner', 'working');
  draw();
  const useJudge = !!$('#use-judge-model')?.checked;
  const judgeId = $('#judge-model')?.value || state.teachers[0]?.model;
  try {
    const examples = await runTeacherPipeline({
      models: state.teachers.map((item) => ({
        id: item.model,
        name: item.label,
        license: item.license,
        priceNote: item.price,
        contextLength: item.contextLength,
      })),
      prompt: task,
      complete: (model, prompt, opts) => teachers.complete('openrouter', prompt, { ...opts, model }),
      judgeComplete: useJudge && judgeId
        ? (prompt, opts) => teachers.complete('openrouter', prompt, { ...opts, model: judgeId })
        : null,
      limits: limitsNow(),
      bucket,
      signal: pipelineCtl.signal,
      id: () => uid('ex_'),
      onReserved: (global) => { state.usage.openrouterCalls = global; save(); },
    });
    state.examples = [...examples, ...(state.examples || [])].slice(0, 200);
    setRoleStatus('teacher', 'done');
    setRoleStatus('judge', 'done');
    setRoleStatus('cleaner', 'done');
    audit('teachers', `${examples.length} answers saved. Nothing is approved yet.`);
    toast('Answers are in. Say yes or no before any of them can be used for training.');
  } catch (err) {
    setRoleStatus('teacher', err.code === 'limit' ? 'error' : 'idle');
    setRoleStatus('judge', 'idle');
    setRoleStatus('cleaner', 'idle');
    const note = redactSecrets(err.message || 'The teacher run stopped.');
    audit('teachers', note);
    toast(note);
  } finally {
    rememberCalls(bucket);
    pipelineCtl = null;
    session.pipelineRunning = false;
    if (session.runBucket) session.runBucket.stopped = false;
    draw();
  }
}

function downloadText(name, text, type) {
  const blob = new Blob([text], { type });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function saveKey() {
  const value = $('#or-key')?.value || '';
  writeOpenRouterKey(value);
  const input = $('#or-key');
  if (input) input.value = '';
  audit('key', value.trim() ? 'OpenRouter key saved on this computer' : 'empty key, the old one was forgotten');
  toast(value.trim() ? 'The key stays only in this browser.' : 'No key saved.');
  draw();
}

async function startTraining() {
  const trainer = state.agents.find((agent) => agent.role === 'trainer');
  state.trainingConfig = {
    rank: Math.max(1, Math.min(64, Math.round(readNumber('#rank', 8)))),
    epochs: Math.max(1, Math.min(3, Math.round(readNumber('#epochs', 1)))),
  };
  if (trainer) {
    trainer.status = 'approval';
    trainer.paused = false;
  }
  save();
  syncAgents();
  const ok = await confirm({
    title: 'Start training',
    text: 'You want to start training. That connection is not ready, so no run starts and nothing is sent. Continue?',
    ok: 'Yes',
    extra: trainer ? `<div class="confirm-fig">${figureHTML({ ...trainer, status: 'approval', paused: false }, { live: false, size: 'sm' })}</div>` : '',
  });
  if (trainer) trainer.status = 'idle';
  if (!ok) {
    audit('rejected', 'start training', 'you');
    save();
    draw();
    return;
  }
  let result;
  try { result = requestTraining(state.trainingConfig, { approved: true }); }
  catch (err) { result = { ok: false, message: err.message, code: err.code }; }
  state.trainingRuns.unshift({ id: uid('run_'), ts: Date.now(), status: 'did not start', message: result.message });
  audit('training', result.message, trainer?.name || 'Sári');
  save();
  toast(result.message);
  draw();
}

function showWelcome() {
  if (state.settings.welcomed) return;
  openModal(`<h2 id="modal-title">Hi, this is Agona</h2>
    <p>A small team of helpers works in your browser, on your computer. You do not need an account, and your job is not sent to a hidden server.</p>
    <p><b>1.</b> Write the job in the big box.</p>
    <p><b>2.</b> The first time, this computer downloads a helper. A bar shows how far it is.</p>
    <p><b>3.</b> The team talks in bubbles on the workspace.</p>
    <div class="row"><button type="button" data-act="welcome-ok">OK</button></div>`, null, () => actions['welcome-ok']());
}

actions['welcome-ok'] = () => {
  state.settings.welcomed = true;
  save();
  closeModal();
};

document.addEventListener('click', onClick);
document.addEventListener('submit', onSubmit);
document.addEventListener('change', async (event) => {
  const target = event.target;
  if (target?.id === 'file') onFile(target);
  if (target?.id === 'import-file') importFile(target);
  if (target?.id === 'metrics-file') importMetrics(target);
  if (target?.id === 'tmpl') {
    const role = roleById(target.value);
    if (!role) return;
    const name = $('#an');
    const prompt = $('#ap');
    if (name) name.value = role.name;
    if (prompt) prompt.value = role.prompt;
  }
  if (target?.id === 'log-filter') filterLog(target.value);
});

document.addEventListener('input', (event) => {
  if (event.target?.id === 'input') {
    event.target.style.height = 'auto';
    event.target.style.height = Math.min(160, event.target.scrollHeight) + 'px';
  }
  if (event.target?.id === 'log-filter') filterLog(event.target.value);
  if (event.target?.id === 'model-query') {
    session.catalogQuery = event.target.value;
    draw();
    const box = $('#model-query');
    if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
  }
});

document.addEventListener('keydown', (event) => {
  if (event.target?.id === 'input' && event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    submitText(event.target.value);
  }
});

$('#scrim')?.addEventListener('click', () => document.body.classList.remove('nav-open'));

window.addEventListener('hashchange', () => draw());
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if (state.settings.theme === 'system') applyChrome();
});

onStatus(() => {
  paintStatus();
  const banner = $('#load-banner');
  if (banner) banner.innerHTML = bannerHTML();
});

let parallelSnapshot = state.settings.maxParallel;
document.addEventListener('change', async (event) => {
  if (event.target?.id !== 'parallel') return;
  const next = clampParallel(event.target.value);
  if (next > parallelSnapshot) {
    const ok = await confirm({
      title: 'Raise a limit',
      text: `Agents at once will go from ${parallelSnapshot} to ${next}. That can use more memory.`,
      ok: 'Raise',
    });
    if (!ok) { event.target.value = parallelSnapshot; return; }
    audit('limit', `agents at once: ${next}`);
  }
  parallelSnapshot = next;
  state.settings.maxParallel = next;
  save();
});

async function importMetrics(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const parsed = parseMetrics(data);
    if (!parsed.ok) { toast(parsed.error); return; }
    state.metrics = parsed.metrics;
    audit('scores', `imported metrics for ${parsed.metrics.student || 'unnamed student'}`);
    save();
    toast('Scores loaded from the file. No numbers were added.');
    draw();
  } catch (err) {
    toast('Could not read that metrics file: ' + redactSecrets(err.message));
  }
}

async function importFile(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const ok = await confirm({
    title: 'Load a copy',
    text: 'The agents, notes, and log on this computer will be replaced by the file. The OpenRouter key is not in the file.',
    ok: 'Load',
  });
  if (!ok) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || typeof data !== 'object' || !Array.isArray(data.agents)) throw new Error('That file is not an Agona copy.');
    replaceAll(data);
    session.note = null;
    toast('Loaded into this browser only.');
    applyChrome();
    draw();
  } catch (err) {
    toast('Could not load that file: ' + redactSecrets(err.message));
  }
}

teachers.register(createOpenRouterAdapter());
applyChrome();
const brand = $('.brand-mark');
if (brand) brand.innerHTML = mark();
draw({ keepDraft: false });
gpuPromise = checkWebGPU();
gpuPromise.then((result) => {
  session.gpu = { ...result, pending: false };
  if (!result.ok) {
    const el = $('#model-status');
    if (el) el.textContent = usingOpenRouter() ? 'Answers can come from OpenRouter' : 'No helper on this computer without WebGPU';
  }
  const banner = $('#load-banner');
  if (banner) banner.innerHTML = bannerHTML();
});
showWelcome();
