import { state, save, audit, uid, agentById, resetAll, replaceAll, workspaceChat, MODELS, prefersSmallModel } from './store.js';
import { onStatus, status, loadModel, checkWebGPU } from './llm.js';
import { normPath } from './tools.js';
import { TEMPLATES, roleById } from './roles.js';
import { clampParallel } from './scheduler.js';
import { teachers, requestTraining } from './teachers.js';
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
  dashboard: 'Kezdőlap',
  agents: 'Agentek',
  workspace: 'Közös munkatér',
  teachers: 'Tanármodellek',
  training: 'Tanítás',
  eval: 'Értékelés',
  log: 'Napló',
  settings: 'Beállítások',
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
    const label = state.settings.theme === 'light' ? 'Világos téma' : state.settings.theme === 'dark' ? 'Sötét téma' : 'Rendszer témája';
    themeBtn.textContent = label;
    themeBtn.setAttribute('aria-label', `Téma: ${label}. Kattintásra vált.`);
  }
  const collapse = $('#collapse-btn');
  if (collapse) {
    const collapsed = state.settings.sidebarCollapsed;
    collapse.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    collapse.setAttribute('aria-label', collapsed ? 'Oldalsáv kinyitása' : 'Oldalsáv összecsukása');
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
    if (from && to) announce(`${from.name} átadta a feladatot ${to.name} nevű agentnek.`);
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
    chat.messages.push({ id: uid('m_'), role: 'system', content: err.friendly || err.message || 'Valami hiba történt.', ts: Date.now() });
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
    if (nextParallel > prev.maxParallel) bumps.push(`párhuzamosság ${prev.maxParallel} → ${nextParallel}`);
    if (nextRuntime > prev.maxRuntimeSec) bumps.push(`időkeret ${prev.maxRuntimeSec} mp → ${nextRuntime} mp`);
    if (nextTokens > prev.maxTokens) bumps.push(`válaszhossz ${prev.maxTokens} → ${nextTokens}`);
  }
  if (bumps.length) {
    const ok = await confirm({
      title: 'Limit emelése',
      text: `Ezek nőnek: ${bumps.join(', ')}. Több memória vagy idő kellhet a gépeden.`,
      ok: 'Emelés',
    });
    if (!ok) { draw(); return; }
    audit('limit', bumps.join(', '));
  }
  const model = fromForm ? ($('#set-model')?.value || prev.model) : prev.model;
  if (prefersHeavy(model) && model !== prev.model) {
    const ok = await confirm({
      title: 'Nagy modell',
      text: 'Ez a modell nagy lehet ehhez az eszközhöz. Ha nincs elég memória, a betöltés elhasal. A kis modell a biztonságos választás.',
      ok: 'Mégis ezt választom',
    });
    if (!ok) { draw(); return; }
  }
  state.settings.theme = fromForm ? ($('#theme')?.value || prev.theme) : prev.theme;
  state.settings.model = MODELS.some((item) => item.id === model) ? model : prev.model;
  state.settings.temperature = fromForm ? Math.max(0, Math.min(2, readNumber('#temperature', prev.temperature))) : prev.temperature;
  state.settings.maxTokens = fromForm ? nextTokens : prev.maxTokens;
  state.settings.maxParallel = nextParallel;
  state.settings.maxRuntimeSec = fromForm ? nextRuntime : prev.maxRuntimeSec;
  state.settings.modelMigrated = true;
  save();
  applyChrome();
  draw();
  toast('Beállítások elmentve, csak ezen a gépen.');
}

function prefersHeavy(id) {
  return prefersSmallModel() && (id === MODELS[0].id || id === MODELS[1].id);
}

async function onFile(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (file.size > 200000) { toast('Ez a fájl túl nagy egy jegyzethez.'); return; }
  const text = await file.text();
  if (text.includes('\u0000')) { toast('Csak szöveges fájlt tudok a jegyzetekbe tenni.'); return; }
  const path = normPath('/csatolmany/' + file.name.replace(/[^\w.\-áéíóöőúüű ]/gi, '_'));
  state.files[path] = text.slice(0, 100000);
  state.fileOwners[path] = 'user';
  save();
  const box = $('#input');
  if (box) box.value = `${box.value ? box.value + ' ' : ''}Csatolt jegyzet: ${path}`;
  toast('A fájl a közös jegyzetekbe került. Nem töltöttük fel.');
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
        text: 'Ez a modell nagy lehet ehhez az eszközhöz. Ha nincs elég memória, a betöltés elhasal.',
        ok: 'Mégis ezt választom',
      });
      if (!ok) return;
    }
    state.settings.model = id;
    state.settings.modelMigrated = true;
    audit('modell', id);
    save();
    $('#model-pop')?.setAttribute('hidden', '');
    draw();
  },
  attach() { $('#file')?.click(); },
  'stop-all'() {
    runCtl?.abort();
    for (const agent of state.agents) {
      if (agent.status === 'working' || agent.status === 'thinking') stopAgent(agent.id);
    }
    toast('Leállítottam, amit épp futott.');
    draw();
  },
  'open-create'() { openModal(createModalHTML(), null, closeModal); },
  'close-modal': closeModal,
  'save-create'() {
    const role = roleById($('#tmpl')?.value) || TEMPLATES[0];
    const name = $('#an')?.value.trim();
    if (!name) { toast('Kell egy név.'); return; }
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
    audit('létrehozás', `${name} · ${role.title}`);
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
    audit('átnevezés', `${prev} → ${name}`);
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
    if (agent.paused) { toast('Előbb folytasd az agentet.'); return; }
    openModal(runModalHTML(agent), null, closeModal);
  },
  'save-run'(btn) {
    const text = $('#one-task')?.value.trim();
    const id = btn.dataset.id;
    if (!text) { toast('Írd le a feladatot.'); return; }
    closeModal();
    submitText(text, { onlyAgentId: id });
  },
  async 'delete-agent'(btn) {
    const agent = agentById(btn.dataset.id);
    if (!agent) return;
    const ok = await confirm({
      title: 'Agent törlése',
      text: `${agent.name} törlődik erről a gépről. A jegyzetei megmaradnak. Ezt nem vonjuk vissza.`,
      ok: 'Törlés',
      danger: true,
    });
    if (!ok) return;
    stopAgent(agent.id);
    state.agents = state.agents.filter((item) => item.id !== agent.id);
    for (const task of state.tasks) {
      if (task.assigneeId === agent.id && ['queued', 'running', 'paused'].includes(task.status)) task.status = 'skipped';
    }
    audit('törlés', agent.name);
    save();
    draw();
  },
  async 'delete-task'(btn) {
    const task = state.tasks.find((item) => item.id === btn.dataset.id);
    if (!task) return;
    const ok = await confirm({
      title: 'Feladat törlése',
      text: `Törlöd a listából: ${task.title}`,
      ok: 'Törlés',
      danger: true,
    });
    if (!ok) return;
    state.tasks = state.tasks.filter((item) => item.id !== task.id);
    audit('törlés', task.title);
    save();
    draw();
  },
  'new-note'() {
    openModal(`<h2 id="modal-title">Új jegyzet</h2><label for="note-name">Fájlnév</label><input id="note-name" value="/jegyzet.txt"><div class="row"><button type="button" data-ok data-act="save-new-note">Létrehozás</button><button type="button" class="ghost" data-act="close-modal">Mégse</button></div>`, null, closeModal);
  },
  'save-new-note'() {
    const path = normPath($('#note-name')?.value || '');
    if (path === '/') { toast('Kell egy fájlnév, például /jegyzet.txt'); return; }
    state.files[path] ??= '';
    state.fileOwners[path] = 'user';
    session.note = path;
    audit('jegyzet', path);
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
    toast('Jegyzet elmentve ezen a gépen.');
  },
  async 'delete-note'() {
    if (!session.note) return;
    const ok = await confirm({ title: 'Jegyzet törlése', text: `Törlöd: ${session.note}`, ok: 'Törlés', danger: true });
    if (!ok) return;
    delete state.files[session.note];
    delete state.fileOwners[session.note];
    audit('törlés', session.note);
    session.note = null;
    save();
    draw();
  },
  async 'test-teacher'(btn) {
    const teacher = state.teachers.find((item) => item.id === btn.dataset.id);
    const result = await teachers.testConnection(teacher?.id || btn.dataset.id);
    audit('tesztkapcsolat', result.message, teacher?.label || 'tanár');
    toast(result.message);
  },
  async 'delete-teacher'(btn) {
    const teacher = state.teachers.find((item) => item.id === btn.dataset.id);
    if (!teacher) return;
    const ok = await confirm({
      title: 'Tanárfeljegyzés törlése',
      text: `${teacher.label} feljegyzése törlődik erről a gépről. Hálózati fiók nem törlődik, mert nincs csatlakoztatva.`,
      ok: 'Törlés',
      danger: true,
    });
    if (!ok) return;
    state.teachers = state.teachers.filter((item) => item.id !== teacher.id);
    audit('törlés', teacher.label);
    save();
    draw();
  },
  'export-data'() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'agona-masolat.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    audit('mentés', 'helyi másolat letöltve');
  },
  async erase() {
    const ok = await confirm({
      title: 'Minden törlése',
      text: 'Minden agent, feladat, jegyzet és napló törlődik ebből a böngészőből. Ezt nem lehet visszavonni.',
      ok: 'Törlés',
      danger: true,
    });
    if (!ok) return;
    resetAll();
    session.note = null;
    toast('Törölve, csak ezen a böngészőn.');
    draw();
  },
  menu() { document.body.classList.toggle('nav-open'); },
  collapse() {
    state.settings.sidebarCollapsed = !state.settings.sidebarCollapsed;
    save();
    applyChrome();
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
  catch (err) { console.error(err); toast(err.friendly || err.message || 'Ez nem sikerült.'); }
}

function onSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  if (form.id === 'composer') submitText($('#input')?.value);
  else if (form.id === 'settings-form') saveSettings(true);
  else if (form.id === 'teacher-form') saveTeacher(form);
  else if (form.id === 'train-form') startTraining();
}

function saveTeacher(form) {
  const data = new FormData(form);
  const label = String(data.get('label') || '').trim();
  if (!label) { toast('Kell egy név.'); return; }
  state.teachers.push({
    id: uid('t_'),
    label,
    provider: String(data.get('provider') || '').trim(),
    tags: String(data.get('tags') || '').split(',').map((tag) => tag.trim()).filter(Boolean),
    price: String(data.get('price') || '').trim(),
    note: String(data.get('note') || '').trim(),
    connected: false,
  });
  audit('tanár', `${label} feljegyezve, nincs kapcsolat`);
  save();
  form.reset();
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
    title: 'Tanítás indítása',
    text: 'Tanítást szeretnél indítani. A kapcsolat még nincs bekötve, ezért futás nem indul, és adat nem megy ki. Folytatod?',
    ok: 'Jóváhagyom',
    extra: trainer ? `<div class="confirm-fig">${figureHTML({ ...trainer, status: 'approval', paused: false }, { live: false, size: 'sm' })}</div>` : '',
  });
  if (trainer) trainer.status = 'idle';
  if (!ok) {
    audit('elutasítva', 'tanítás indítása', 'te');
    save();
    draw();
    return;
  }
  let result;
  try { result = requestTraining(state.trainingConfig, { approved: true }); }
  catch (err) { result = { ok: false, message: err.message, code: err.code }; }
  state.trainingRuns.unshift({ id: uid('run_'), ts: Date.now(), status: 'nem indult', message: result.message });
  audit('tanítás', result.message, trainer?.name || 'Sári');
  save();
  toast(result.message);
  draw();
}

function showWelcome() {
  if (state.settings.welcomed) return;
  openModal(`<h2 id="modal-title">Szia, ez az Agona</h2>
    <p>Több kis agent dolgozik a böngésződben, a te gépeden. Nem kell fiók, és nem küldjük el a feladatot egy titkos szervernek.</p>
    <p><b>1.</b> Írd le a feladatot a nagy mezőbe.</p>
    <p><b>2.</b> Az első alkalommal letöltődik egy helyi modell. A sáv mutatja, hol tart.</p>
    <p><b>3.</b> A csapat a közös munkatéren beszél, buborékban.</p>
    <div class="row"><button type="button" data-act="welcome-ok">Rendben</button></div>`, null, () => actions['welcome-ok']());
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
      title: 'Limit emelése',
      text: `A párhuzamos agentek száma ${parallelSnapshot} értékről ${next} értékre nő. Ez több memóriát használhat.`,
      ok: 'Emelés',
    });
    if (!ok) { event.target.value = parallelSnapshot; return; }
    audit('limit', `párhuzamosság: ${next}`);
  }
  parallelSnapshot = next;
  state.settings.maxParallel = next;
  save();
});

async function importFile(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const ok = await confirm({
    title: 'Másolat betöltése',
    text: 'A mostani agentek, jegyzetek és a napló felülíródnak a fájllal, csak ezen a gépen.',
    ok: 'Betöltés',
  });
  if (!ok) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || typeof data !== 'object' || !Array.isArray(data.agents)) throw new Error('Ez a fájl nem Agona-másolat.');
    replaceAll(data);
    session.note = null;
    toast('Betöltve, csak ebbe a böngészőbe.');
    applyChrome();
    draw();
  } catch (err) {
    toast('Nem sikerült betölteni: ' + err.message);
  }
}

applyChrome();
const brand = $('.brand-mark');
if (brand) brand.innerHTML = mark();
draw({ keepDraft: false });
gpuPromise = checkWebGPU();
gpuPromise.then((result) => {
  session.gpu = { ...result, pending: false };
  if (!result.ok) {
    const el = $('#model-status');
    if (el) el.textContent = 'WebGPU nélkül nincs helyi modell';
  }
  const banner = $('#load-banner');
  if (banner) banner.innerHTML = bannerHTML();
});
showWelcome();
