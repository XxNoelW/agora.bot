import { esc, rich } from './text.js';
import { state, agentById, workspaceChat, modelLabel, MODELS, prefersSmallModel } from './store.js';
import { figureHTML, safeColor } from './characters.js';
import { TEMPLATES, roleTitle, viewState, altText, STATE_LABEL, STATES } from './roles.js';
import { isReady, status } from './llm.js';
import { session } from './session.js';
import { isRunning } from './runner.js';

const I = (body) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const iconClip = I('<path d="M8 12.5l6.2-6.2a3 3 0 114.2 4.2l-7.4 7.5a4.2 4.2 0 01-6-6l7.2-7.2"/>');
const iconModel = I('<rect x="6" y="6" width="12" height="12" rx="3"/><path d="M9 12h6M12 9v6"/>');
const iconSend = I('<path d="M12 17V7M8 10l4-4 4 4"/>');
const iconStop = I('<rect x="7" y="7" width="10" height="10" rx="2"/>');

const TOOL_HU = {
  web_search: 'keresett a weben',
  read_page: 'olvasott egy oldalt',
  fetch_wikipedia_page: 'olvasott egy Wikipédia-oldalt',
  write_file: 'jegyzetet mentett',
  read_file: 'jegyzetet olvasott',
  list_files: 'megnézte a jegyzeteket',
  run_js: 'számolt',
};

function head(title, lead) {
  return `<header class="page-head"><h1>${esc(title)}</h1>${lead ? `<p class="lead">${esc(lead)}</p>` : ''}</header>`;
}

export function bannerHTML() {
  const gpu = session.gpu;
  if (gpu.pending) return '<div class="banner">Megnézem, hogy ez a böngésző tud-e helyben modellt futtatni…</div>';
  if (!gpu.ok) return `<div class="banner">${esc(gpu.reason)}</div>`;
  if (status.error) {
    return `<div class="banner"><b>${esc(status.text)}</b>${status.detail ? `<div class="small">${esc(status.detail)}</div>` : ''}<div class="row"><button type="button" data-act="load-model">Újra</button></div></div>`;
  }
  if (isReady(state.settings.model)) return '';
  const pct = status.progress > 0 && status.progress < 1
    ? `<div class="progress" role="progressbar" aria-valuenow="${Math.round(status.progress * 100)}" aria-valuemin="0" aria-valuemax="100"><div style="width:${Math.round(status.progress * 100)}%"></div></div>`
    : '';
  return `<div class="banner ok"><b>${esc(status.busy ? status.text : 'A segéd ezen a gépen fut.')}</b>
    <div class="small">${esc(modelLabel(state.settings.model))}. Az első letöltés eltarthat. Utána a böngésző megőrzi.</div>
    ${pct}
    <div class="row"><button type="button" data-act="load-model" ${status.busy ? 'disabled' : ''}>${status.busy ? 'Dolgozik…' : 'Segéd betöltése'}</button></div></div>`;
}

function composerHTML() {
  const busy = isRunning();
  const phone = prefersSmallModel();
  return `<div class="composer-wrap">
    <form id="composer" class="pill" autocomplete="off">
      <button type="button" class="icon" data-act="attach" aria-label="Csatolás">${iconClip}</button>
      <label class="sr-only" for="input">Feladat</label>
      <textarea id="input" rows="1" placeholder="Indíts három agentet a frontend, a backend és a tesztek elkészítésére"></textarea>
      <button type="button" class="icon" data-act="toggle-model" aria-label="Modell választása" aria-expanded="false">${iconModel}</button>
      <button type="submit" class="send" id="send" aria-label="Küldés" ${busy ? 'hidden' : ''}>${iconSend}</button>
      <button type="button" class="send stop" id="stop" data-act="stop-all" aria-label="Leállítás" ${busy ? '' : 'hidden'}>${iconStop}</button>
    </form>
    <div id="model-pop" class="popover" hidden>
      <p class="pop-title">Melyik helyi modell?</p>
      ${MODELS.map((model) => `<button type="button" class="model-opt ${model.id === state.settings.model ? 'active' : ''}" data-act="pick-model" data-model="${esc(model.id)}">${esc(model.label)}</button>`).join('')}
      <p class="small muted">${phone ? 'Ezen az eszközön a kis modell az alap, hogy elférjen.' : 'A nagy modell asztali gépre való. Ha nem fér el, válassz kisebbet.'}</p>
    </div>
    <input id="file" type="file" accept="text/plain,.txt,.md,.json,.csv,.js,.css,.html,.svg" hidden>
  </div>`;
}

function team(agents, size = 'md') {
  if (!agents.length) return '<p class="muted">Még nincs agent. Hozz létre egyet sablonból.</p>';
  return `<div class="team">${agents.map((agent) => figureHTML(agent, { size })).join('')}</div>`;
}

export function renderDashboard() {
  const runs = state.trainingRuns.length;
  const teacherNote = state.teachers.length
    ? `${state.teachers.length} feljegyzett tanár, egyik sincs csatlakoztatva.`
    : 'Nincs csatlakoztatott tanár.';
  return `<div class="home">
    <section class="home-hero">
      <div class="logo-lockup"><span class="mark mark-lg" aria-hidden="true">${mark()}</span><p class="brand-name">Agona</p></div>
      <h1>Miben segítsen a csapat?</h1>
      <p class="lead">Írd le a feladatot a saját szavaiddal. A modell a te gépeden fut, kulcs nélkül.</p>
      <div id="load-banner" class="banner-slot">${bannerHTML()}</div>
      ${composerHTML()}
      <p class="hint">A webes keresés a Wikipediát, a DuckDuckGo gyors választ és a Jina olvasót hívja. Más szerverre nem küldünk üzenetet.</p>
    </section>
    <section class="stats">
      <article class="card"><h2>Futó agentek</h2>${team(state.agents, 'sm')}<p class="small muted">Egyszerre egy válasz készül a gépen, a többiek sorban várnak. Keret: ${state.settings.maxParallel}.</p></article>
      <article class="card"><h2>Tanárok</h2><p>${esc(teacherNote)}</p><p class="small muted">A kapcsolat későbbi lépés.</p></article>
      <article class="card"><h2>Student</h2><p>${esc(state.student.name)}</p><p class="small muted">Verzió: ${esc(state.student.version)}</p><p class="small muted">Állapot: ${esc(state.student.status)}</p></article>
      <article class="card"><h2>Tanítási futások</h2><p class="stat">${runs}</p><p class="small muted">${runs ? 'Egyik sem indult el a hálózaton.' : 'Még nem indult tanítás.'}</p></article>
      <article class="card"><h2>Költség és erőforrás</h2><p>Külső költség: <b>0 Ft</b></p><p class="small muted">Helyi modell: ${esc(modelLabel(state.settings.model))}</p><p class="small muted">Eszközhívások itt: ${state.usage.toolCalls}</p></article>
    </section>
  </div>`;
}

function agentActions(agent) {
  const pause = agent.paused
    ? `<button type="button" data-act="resume" data-id="${esc(agent.id)}">Folytatás</button>`
    : `<button type="button" class="ghost" data-act="pause" data-id="${esc(agent.id)}">Szünet</button>`;
  return `<div class="row">${pause}
    <button type="button" class="ghost" data-act="stop-agent" data-id="${esc(agent.id)}">Leállítás</button>
    <button type="button" class="ghost" data-act="ask-run" data-id="${esc(agent.id)}">Indítás</button>
    <button type="button" class="ghost" data-act="rename-agent" data-id="${esc(agent.id)}">Átnevezés</button>
    <button type="button" class="danger" data-act="delete-agent" data-id="${esc(agent.id)}">Törlés</button>
  </div>`;
}

export function renderAgents() {
  const sample = state.agents.find((agent) => agent.role === 'orchestrator') || state.agents[0];
  const legend = sample ? `<div class="legend">${STATES.map((item) => figureHTML({
    ...sample,
    id: '',
    name: sample.name,
    status: item,
    paused: item === 'paused',
    error: item === 'error' ? 'példa' : '',
  }, { live: false, size: 'sm' })).join('')}</div>` : '';
  return `${head('Agentek', 'Sablonból hozhatsz létre újat, és átnevezheted. Egyszerre legfeljebb öt dolgozhat, az alap négy.')}
    <div class="card row spread">
      <label for="parallel">Egyszerre futtatható agentek<input id="parallel" type="number" min="1" max="5" value="${state.settings.maxParallel}"></label>
      <button type="button" data-act="open-create">Új agent sablonból</button>
    </div>
    <h2>Állapotok</h2>
    <p class="small muted">Ugyanaz a figura minden állapotban. A szöveg akkor is leolvasható, ha a mozgás ki van kapcsolva.</p>
    ${legend}
    <div class="grid">${state.agents.map((agent) => `<article class="card agent-card">
      ${figureHTML(agent)}
      <p class="role">${esc(roleTitle(agent.role))}</p>
      ${viewState(agent) === 'error' && agent.error ? `<p class="error-text">${esc(agent.error)}</p>` : ''}
      ${agentActions(agent)}
    </article>`).join('')}</div>`;
}

function taskList() {
  if (!state.tasks.length) return '<p class="muted">Még nincs feladat. Írd meg lent, mit csináljon a csapat.</p>';
  return `<ul class="tasks">${[...state.tasks].reverse().map((task) => {
    const agent = agentById(task.assigneeId);
    const dep = (task.dependsOn || []).length ? `Vár ${task.dependsOn.length} előzményre.` : 'Önálló.';
    return `<li class="task">
      <span class="task-state">${esc(task.status)}</span>
      <div><b>${esc(task.title)}</b><div class="small muted">${esc(agent?.name || 'Nincs gazda')} · ${esc(dep)}</div>
      ${task.error ? `<div class="error-text">${esc(task.error)}</div>` : ''}</div>
      <button type="button" class="ghost" data-act="delete-task" data-id="${esc(task.id)}">Törlés</button>
    </li>`;
  }).join('')}</ul>`;
}

function messageHTML(message) {
  if (message.role === 'user') {
    return `<div class="bubble-row user" data-mid="${esc(message.id)}"><div class="bubble"><div class="meta" data-meta>Te</div><div class="text" data-body>${rich(message.content)}</div></div></div>`;
  }
  if (message.role === 'handoff') {
    return `<div class="handoff-line" data-mid="${esc(message.id)}"><span class="parcel-icon" aria-hidden="true"></span><p data-body>${esc(message.content)}</p></div>`;
  }
  if (message.role === 'system') {
    return `<div class="sys-line" data-mid="${esc(message.id)}"><p data-body>${esc(message.content)}</p></div>`;
  }
  if (message.role === 'task') {
    return `<div class="task-line" data-mid="${esc(message.id)}"><p data-body>${esc(message.content)}</p></div>`;
  }
  if (message.role === 'tool') {
    const who = agentById(message.agentId);
    return `<div class="tool-line" data-mid="${esc(message.id)}"><div class="meta" data-meta>${esc(who?.name || 'Agent')} ${esc(TOOL_HU[message.tool] || 'eszközt használt')}</div><pre data-body>${esc(message.content)}</pre></div>`;
  }
  const agent = agentById(message.agentId);
  const meta = message.pending ? (message.loading ? 'a segéd készül' : 'írja a választ') : (message.error ? 'hiba' : 'válasz');
  return `<div class="bubble-row${message.pending ? ' pending' : ''}${message.error ? ' error' : ''}" data-mid="${esc(message.id)}">
    ${agent ? figureHTML(agent, { size: 'sm', caption: false }) : ''}
    <div class="bubble"><div class="meta" data-meta>${esc(agent?.name || 'Agent')} · ${esc(meta)}</div><div class="text" data-body>${message.content ? rich(message.content) : (message.pending ? '…' : '')}</div></div>
  </div>`;
}

function notesHTML() {
  const names = Object.keys(state.files).sort();
  const current = session.note && (session.note in state.files) ? session.note : null;
  return `<section class="card">
    <div class="row spread"><h2>Közös jegyzetek</h2><button type="button" class="ghost" data-act="new-note">Új</button></div>
    <p class="small muted">Ha egy jegyzetnek más a gazdája, az agent nem írja felül: új fájlt kap.</p>
    <div class="note-list">${names.map((name) => `<button type="button" class="note-link ${name === current ? 'active' : ''}" data-act="open-note" data-path="${esc(name)}">${esc(name)}</button>`).join('') || '<p class="muted">Nincs jegyzet.</p>'}</div>
    ${current ? `<label class="sr-only" for="note-body">${esc(current)}</label><textarea id="note-body">${esc(state.files[current])}</textarea><div class="row"><button type="button" data-act="save-note">Mentés</button><button type="button" class="danger" data-act="delete-note">Törlés</button></div>` : ''}
  </section>`;
}

export function renderWorkspace() {
  const chat = workspaceChat();
  return `<div class="workspace">
    <div class="side-col">
      <section class="card"><h2>Feladatok</h2>${taskList()}</section>
      ${notesHTML()}
    </div>
    <section class="thread-card">
      <header class="row spread"><div><h2>Beszélgetés</h2><p class="small muted">A figurák beszédbuborékkal beszélnek. Az átadás szöveggel is megmarad.</p></div><button type="button" class="ghost" data-act="stop-all" ${isRunning() ? '' : 'disabled'}>Mindenki álljon le</button></header>
      <div id="load-banner">${bannerHTML()}</div>
      <div id="thread" class="thread">${chat.messages.map(messageHTML).join('') || '<div class="welcome"><h2>A közös asztal üres</h2><p>Írj egy feladatot. A projektvezető részekre bontja, a többiek a kereten belül párhuzamosan indulnak.</p></div>'}</div>
      <div class="dock">${composerHTML()}</div>
    </section>
  </div>`;
}

function teacherCard(teacher) {
  return `<article class="card">
    <h2>${esc(teacher.label || 'Névtelen')}</h2>
    <p class="small muted">${esc(teacher.provider || 'Szolgáltató nincs megadva')} · ${teacher.tags?.length ? esc(teacher.tags.join(', ')) : 'nincs címke'}</p>
    <p>${esc(teacher.note || 'Nincs megjegyzés.')}</p>
    <p class="small">Ár vagy limit: ${esc(teacher.price || 'nincs megadva')}</p>
    <p class="badge">Nincs csatlakoztatva</p>
    <div class="row"><button type="button" class="ghost" data-act="test-teacher" data-id="${esc(teacher.id)}">Tesztkapcsolat</button><button type="button" class="danger" data-act="delete-teacher" data-id="${esc(teacher.id)}">Eltávolítás</button></div>
  </article>`;
}

export function renderTeachers() {
  return `${head('Tanármodellek', 'Itt jegyezheted fel, kit szeretnél később csatlakoztatni. API-kulcsot nem kérünk, és a teszt sem hív külső szolgáltatást.')}
    <p class="badge">Előkészület · a kapcsolat később jön</p>
    <form id="teacher-form" class="card">
      <h2>Tanár feljegyzése</h2>
      <label for="t-name">Név</label><input id="t-name" name="label" maxlength="80" placeholder="például egy későbbi tanár">
      <label for="t-provider">Szolgáltató vagy helyi végpont neve</label><input id="t-provider" name="provider" maxlength="120" placeholder="még nincs eldöntve">
      <label for="t-tags">Képességcímkék</label><input id="t-tags" name="tags" maxlength="160" placeholder="magyar, kód, vesszővel">
      <label for="t-price">Ár vagy limit, ha tudod</label><input id="t-price" name="price" maxlength="120" placeholder="nem találunk ki árat">
      <label for="t-note">Megjegyzés</label><textarea id="t-note" name="note" rows="3" maxlength="500"></textarea>
      <button type="submit">Feljegyzés</button>
    </form>
    <div class="grid">${state.teachers.map(teacherCard).join('') || '<p class="muted">Még nincs feljegyzett tanár.</p>'}</div>`;
}

export function renderTraining() {
  const trainer = state.agents.find((agent) => agent.role === 'trainer');
  const runs = state.trainingRuns.length
    ? `<ul class="log">${state.trainingRuns.map((run) => `<li><time>${esc(new Date(run.ts).toLocaleString('hu-HU'))}</time><b>${esc(run.status)}</b><p>${esc(run.message)}</p></li>`).join('')}</ul>`
    : '<p class="muted">Még nincs kísérlet.</p>';
  return `${head('Tanítás', 'A tanítást csak jóváhagyás után szabad elindítani. A futtatás még nincs bekötve, ezért most nem indul el, és adat nem megy ki.')}
    <p class="badge">Előkészület</p>
    ${trainer ? `<div class="card row">${figureHTML(trainer)}<p>Sári jelzi, ha jóváhagyásra vár a tanítás.</p></div>` : ''}
    <form id="train-form" class="card">
      <label>Adatkészlet</label>
      <select disabled><option>Még nincs jóváhagyott készlet</option></select>
      <div class="row">
        <label>LoRA rang, helyi jegyzet<input id="rank" type="number" min="1" max="64" value="${Number(state.trainingConfig.rank) || 8}"></label>
        <label>Epoch, helyi jegyzet<input id="epochs" type="number" min="1" max="3" value="${Number(state.trainingConfig.epochs) || 1}"></label>
      </div>
      <p class="small muted">Ezek a számok csak ebben a böngészőben maradnak. Nem küldjük sehova.</p>
      <button type="submit">Tanítás indítása</button>
    </form>
    <section class="card"><h2>Korábbi kísérletek</h2>${runs}</section>`;
}

export function renderEval() {
  return `${head('Értékelés', 'Itt lesz az előtte-utána mérés. Amíg nincs tanítás, nincs eredmény. Nem írunk ki kitalált pontszámot.')}
    <p class="badge">Előkészület</p>
    <section class="card"><h2>Benchmark</h2><p class="muted">Még nincs baseline. Ugyanaz a tesztkészlet kell a tanítás előtt és után, és egy külön teszt, amit a tanításhoz nem használunk.</p></section>
    <section class="card"><h2>Előtte / utána</h2><p class="muted">Nincs mérés.</p></section>
    <section class="card"><h2>Hibák és regressziók</h2><p class="muted">Nincs lista. Ha később egy készség romlik, itt jelenik meg.</p></section>`;
}

export function renderLog() {
  const rows = state.audit.length
    ? `<ul class="log">${state.audit.map((item) => `<li><time datetime="${esc(new Date(item.ts).toISOString())}">${esc(new Date(item.ts).toLocaleString('hu-HU'))}</time><b>${esc(item.actor)}</b><span>${esc(item.action)}</span><p>${esc(item.detail)}</p></li>`).join('')}</ul>`
    : '<p class="muted">Még nincs bejegyzés. Ami elindul, leáll, jóváhagyásra kerül vagy törlődik, ide kerül.</p>';
  return `${head('Napló', 'Helyi napló: ki, mikor, mit indított, állított meg vagy törölt. Csak ebben a böngészőben él.')}
    <label for="log-filter">Keresés a naplóban</label><input id="log-filter" placeholder="név vagy művelet">
    <div id="log-list">${rows}</div>`;
}

export function renderSettings() {
  return `${head('Beállítások', 'Minden ezen a gépen marad. Titkot nem tárolunk, és rejtett küldés nincs.')}
    <form id="settings-form" class="card">
      <label for="theme">Téma<select id="theme">${[['system', 'Rendszer'], ['dark', 'Sötét'], ['light', 'Világos']].map(([id, label]) => `<option value="${id}" ${state.settings.theme === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label for="set-model">Modell<select id="set-model">${MODELS.map((model) => `<option value="${esc(model.id)}" ${model.id === state.settings.model ? 'selected' : ''}>${esc(model.label)}</option>`).join('')}</select></label>
      <div class="row">
        <label>Kreativitás<input id="temperature" type="number" min="0" max="2" step="0.1" value="${state.settings.temperature}"></label>
        <label>Leghosszabb válasz<input id="tokens" type="number" min="64" max="1024" value="${state.settings.maxTokens}"></label>
      </div>
      <div class="row">
        <label>Párhuzamos agentek<input id="parallel" type="number" min="1" max="5" value="${state.settings.maxParallel}"></label>
        <label>Időkeret agentenként, másodperc<input id="runtime" type="number" min="30" max="300" value="${state.settings.maxRuntimeSec}"></label>
      </div>
      <p class="small muted">A párhuzamosság, az idő és a válaszhossz emelése előtt rákérdezünk. Telefonon és kevés memórián a kis modell az alap.</p>
      <button type="submit">Mentés</button>
    </form>
    <section class="card">
      <h2>Mentés ezen a gépen</h2>
      <div class="row">
        <button type="button" class="ghost" data-act="export-data">Másolat letöltése</button>
        <label class="btn ghost">Másolat betöltése<input id="import-file" type="file" accept="application/json" hidden></label>
        <button type="button" class="danger" data-act="erase">Minden törlése</button>
      </div>
      <p class="small muted">A másolat JSON fájl a gépeden. Nem töltjük fel sehova.</p>
    </section>`;
}

const PAGES = {
  dashboard: renderDashboard,
  agents: renderAgents,
  workspace: renderWorkspace,
  teachers: renderTeachers,
  training: renderTraining,
  eval: renderEval,
  log: renderLog,
  settings: renderSettings,
};

export function renderPage(name) {
  const body = (PAGES[name] || renderDashboard)();
  const wide = name === 'dashboard' || name === 'workspace' ? ' wide' : '';
  return `<div class="wrap${wide}">${body}</div>`;
}

export function createModalHTML() {
  const first = TEMPLATES[0];
  return `<h2 id="modal-title">Új agent sablonból</h2>
    <label for="tmpl">Sablon</label>
    <select id="tmpl">${TEMPLATES.map((role) => `<option value="${esc(role.id)}">${esc(role.title)}</option>`).join('')}</select>
    <label for="an">Név</label><input id="an" value="${esc(first.name)}" maxlength="40">
    <label for="ap">Leírás</label><textarea id="ap" rows="5">${esc(first.prompt)}</textarea>
    <div class="row"><button type="button" data-act="save-create">Létrehozás</button><button type="button" class="ghost" data-act="close-modal">Mégse</button></div>`;
}

export function renameModalHTML(agent) {
  return `<h2 id="modal-title">Átnevezés</h2>
    <label for="an">Új név</label><input id="an" value="${esc(agent.name)}" maxlength="40">
    <p class="small muted">A szerep megmarad: ${esc(roleTitle(agent.role))}.</p>
    <div class="row"><button type="button" data-act="save-rename" data-id="${esc(agent.id)}">Mentés</button><button type="button" class="ghost" data-act="close-modal">Mégse</button></div>`;
}

export function runModalHTML(agent) {
  return `<h2 id="modal-title">${esc(agent.name)} indítása</h2>
    <label for="one-task">Mit csináljon?</label>
    <textarea id="one-task" rows="3" placeholder="Rövid feladat csak neki"></textarea>
    <div class="row"><button type="button" data-act="save-run" data-id="${esc(agent.id)}">Indítás</button><button type="button" class="ghost" data-act="close-modal">Mégse</button></div>`;
}

function plainBody(node) {
  return node?.textContent ?? '';
}

export function patchThread() {
  const box = document.querySelector('#thread');
  if (!box) return false;
  const chat = workspaceChat();
  const nodes = [...box.querySelectorAll('[data-mid]')];
  if (nodes.length !== chat.messages.length) return false;
  for (let i = 0; i < chat.messages.length; i++) {
    const message = chat.messages[i];
    if (nodes[i].dataset.mid !== message.id) return false;
    const body = nodes[i].querySelector('[data-body]');
    const next = message.content || (message.pending ? '…' : '');
    if (body && plainBody(body) !== next) body.textContent = next;
    nodes[i].classList.toggle('pending', !!message.pending);
    nodes[i].classList.toggle('error', !!message.error);
  }
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
  if (near) box.scrollTop = box.scrollHeight;
  return true;
}

export function syncAgents() {
  if (typeof document === 'undefined') return;
  for (const agent of state.agents) {
    const name = viewState(agent);
    const label = STATE_LABEL[name] || 'Vár';
    const nodes = document.querySelectorAll(`[data-live-agent="${agent.id}"]`);
    nodes.forEach((el) => {
      el.dataset.state = name;
      el.style.setProperty('--agent', safeColor(agent.color));
      el.setAttribute('aria-label', altText(agent));
      const cap = el.querySelector('[data-state-label]');
      if (cap) cap.textContent = label;
      const title = el.querySelector('.fig-name');
      if (title) title.textContent = agent.name;
    });
  }
}

export function filterLog(query) {
  const q = String(query || '').trim().toLocaleLowerCase('hu-HU');
  const items = state.audit.filter((item) => !q || `${item.actor} ${item.action} ${item.detail}`.toLocaleLowerCase('hu-HU').includes(q));
  const list = document.querySelector('#log-list');
  if (!list) return;
  list.innerHTML = items.length
    ? `<ul class="log">${items.map((item) => `<li><time>${esc(new Date(item.ts).toLocaleString('hu-HU'))}</time><b>${esc(item.actor)}</b><span>${esc(item.action)}</span><p>${esc(item.detail)}</p></li>`).join('')}</ul>`
    : '<p class="muted">Nincs ilyen bejegyzés.</p>';
}

export function mark() {
  return `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="10" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="14" r="1.8"/><circle cx="20" cy="14" r="1.8"/><path d="M12 20c1.5 1.7 6.5 1.7 8 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
}
