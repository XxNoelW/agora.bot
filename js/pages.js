import { esc, rich } from './text.js';
import { state, agentById, workspaceChat, modelLabel, MODELS, prefersSmallModel } from './store.js';
import { figureHTML, safeColor } from './characters.js';
import { TEMPLATES, roleTitle, viewState, altText, STATE_LABEL, STATES } from './roles.js';
import { isReady, status } from './llm.js';
import { session } from './session.js';
import { isRunning } from './runner.js';
import { readOpenRouterKey, formatPrice, isFreeModelId } from './openrouter.js';
import { usingOpenRouter } from './generate.js';
import { toJSONL } from './pipeline.js';

const I = (body) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const iconClip = I('<path d="M8 12.5l6.2-6.2a3 3 0 114.2 4.2l-7.4 7.5a4.2 4.2 0 01-6-6l7.2-7.2"/>');
const iconModel = I('<rect x="6" y="6" width="12" height="12" rx="3"/><path d="M9 12h6M12 9v6"/>');
const iconSend = I('<path d="M12 17V7M8 10l4-4 4 4"/>');
const iconStop = I('<rect x="7" y="7" width="10" height="10" rx="2"/>');

const TOOL_LABEL = {
  web_search: 'looked on the web',
  read_page: 'read a page',
  fetch_wikipedia_page: 'read a Wikipedia page',
  write_file: 'saved a note',
  read_file: 'read a note',
  list_files: 'checked the notes',
  run_js: 'did some math',
};

const TASK_LABEL = {
  queued: 'Waiting',
  running: 'Working',
  done: 'Done',
  error: 'Stuck',
  paused: 'Paused',
  skipped: 'Skipped',
};

function head(title, lead) {
  return `<header class="page-head"><h1>${esc(title)}</h1>${lead ? `<p class="lead">${esc(lead)}</p>` : ''}</header>`;
}

export function bannerHTML() {
  const gpu = session.gpu;
  if (gpu.pending) return '<div class="banner">Checking if this browser can run a model on this computer…</div>';
  if (!gpu.ok && usingOpenRouter()) return '<div class="banner ok"><b>Answers come from your OpenRouter teacher.</b><div class="small">Your key goes only to openrouter.ai. The helper on this computer is still the backup.</div></div>';
  if (!gpu.ok) return `<div class="banner">${esc(gpu.reason)} You can still chat if you save an OpenRouter key and pick a teacher.</div>`;
  if (status.error) {
    return `<div class="banner"><b>${esc(status.text)}</b>${status.detail ? `<div class="small">${esc(status.detail)}</div>` : ''}<div class="row"><button type="button" data-act="load-model">Try again</button></div></div>`;
  }
  if (isReady(state.settings.model)) return '';
  const pct = status.progress > 0 && status.progress < 1
    ? `<div class="progress" role="progressbar" aria-valuenow="${Math.round(status.progress * 100)}" aria-valuemin="0" aria-valuemax="100"><div style="width:${Math.round(status.progress * 100)}%"></div></div>`
    : '';
  return `<div class="banner ok"><b>${esc(status.busy ? status.text : 'The helper runs on this computer.')}</b>
    <div class="small">${esc(modelLabel(state.settings.model))}. The first download can take a while. After that, this browser keeps it.</div>
    ${pct}
    <div class="row"><button type="button" data-act="load-model" ${status.busy ? 'disabled' : ''}>${status.busy ? 'Working…' : 'Load the helper'}</button></div></div>`;
}

function composerHTML() {
  const busy = isRunning();
  const phone = prefersSmallModel();
  return `<div class="composer-wrap">
    <form id="composer" class="pill" autocomplete="off">
      <button type="button" class="icon" data-act="attach" aria-label="Attach a note">${iconClip}</button>
      <label class="sr-only" for="input">Job</label>
      <textarea id="input" rows="1" placeholder="Start three agents on the page, the server, and the tests"></textarea>
      <button type="button" class="icon" data-act="toggle-model" aria-label="Choose a model" aria-expanded="false">${iconModel}</button>
      <button type="submit" class="send" id="send" aria-label="Send" ${busy ? 'hidden' : ''}>${iconSend}</button>
      <button type="button" class="send stop" id="stop" data-act="stop-all" aria-label="Stop" ${busy ? '' : 'hidden'}>${iconStop}</button>
    </form>
    <div id="model-pop" class="popover" hidden>
      <p class="pop-title">Which helper on this computer?</p>
      ${MODELS.map((model) => `<button type="button" class="model-opt ${model.id === state.settings.model ? 'active' : ''}" data-act="pick-model" data-model="${esc(model.id)}">${esc(model.label)}</button>`).join('')}
      <p class="small muted">${phone ? 'On this device the small helper is the default, so it can fit.' : 'The big helper is for a desktop. If it does not fit, pick a smaller one.'}</p>
    </div>
    <input id="file" type="file" accept="text/plain,.txt,.md,.json,.csv,.js,.css,.html,.svg" hidden>
  </div>`;
}

function team(agents, size = 'md') {
  if (!agents.length) return '<p class="muted">No agents yet. Make one from a template.</p>';
  return `<div class="team">${agents.map((agent) => figureHTML(agent, { size })).join('')}</div>`;
}

export function renderDashboard() {
  const runs = state.trainingRuns.length;
  const teacherNote = state.teachers.length
    ? `${state.teachers.length} teachers on your list. Calls: ${state.usage.openrouterCalls || 0} / ${state.settings.orGlobal}.`
    : 'No teachers on your list yet.';
  return `<div class="home">
    <section class="home-hero">
      <div class="logo-lockup"><span class="mark mark-lg" aria-hidden="true">${mark()}</span><p class="brand-name">Agona</p></div>
      <h1>What should the team do?</h1>
      <p class="lead">Say the job in your own words. The helper runs on your computer, with no key.</p>
      <div id="load-banner" class="banner-slot">${bannerHTML()}</div>
      ${composerHTML()}
      <p class="hint">Web search calls Wikipedia, DuckDuckGo quick answers, and the Jina reader. We do not send your words anywhere else.</p>
    </section>
    <section class="stats">
      <article class="card"><h2>Agents</h2>${team(state.agents, 'sm')}<p class="small muted">This computer writes one answer at a time. The others wait in line. Limit: ${state.settings.maxParallel}.</p></article>
      <article class="card"><h2>Teachers</h2><p>${esc(teacherNote)}</p><p class="small muted">A call goes out only after you save your own key.</p></article>
      <article class="card"><h2>Student</h2><p>${esc(state.student.name)}</p><p class="small muted">Version: ${esc(state.student.version)}</p><p class="small muted">Status: ${esc(state.student.status)}</p></article>
      <article class="card"><h2>Training runs</h2><p class="stat">${runs}</p><p class="small muted">${runs ? 'None of these ran on a server.' : 'No training run yet.'}</p></article>
      <article class="card"><h2>Cost and limits</h2><p>OpenRouter calls: <b>${state.usage.openrouterCalls || 0}</b> / ${state.settings.orGlobal}</p><p class="small muted">We do not invent a bill. Prices come from the model list, on your key.</p><p class="small muted">Helper here: ${esc(modelLabel(state.settings.model))}</p></article>
    </section>
  </div>`;
}

function agentActions(agent) {
  const pause = agent.paused
    ? `<button type="button" data-act="resume" data-id="${esc(agent.id)}">Continue</button>`
    : `<button type="button" class="ghost" data-act="pause" data-id="${esc(agent.id)}">Pause</button>`;
  return `<div class="row">${pause}
    <button type="button" class="ghost" data-act="stop-agent" data-id="${esc(agent.id)}">Stop</button>
    <button type="button" class="ghost" data-act="ask-run" data-id="${esc(agent.id)}">Start</button>
    <button type="button" class="ghost" data-act="rename-agent" data-id="${esc(agent.id)}">Rename</button>
    <button type="button" class="danger" data-act="delete-agent" data-id="${esc(agent.id)}">Delete</button>
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
    error: item === 'error' ? 'example' : '',
  }, { live: false, size: 'sm' })).join('')}</div>` : '';
  return `${head('Agents', 'Make a new one from a template, and rename it. Up to five can work at once. The start number is four.')}
    <div class="card row spread">
      <label for="parallel">Agents at the same time<input id="parallel" type="number" min="1" max="5" value="${state.settings.maxParallel}"></label>
      <button type="button" data-act="open-create">New agent from a template</button>
    </div>
    <h2>States</h2>
    <p class="small muted">The same character in every state. The words stay even when motion is off.</p>
    ${legend}
    <div class="grid">${state.agents.map((agent) => `<article class="card agent-card">
      ${figureHTML(agent)}
      <p class="role">${esc(roleTitle(agent.role))}</p>
      ${viewState(agent) === 'error' && agent.error ? `<p class="error-text">${esc(agent.error)}</p>` : ''}
      ${agentActions(agent)}
    </article>`).join('')}</div>`;
}

function taskList() {
  if (!state.tasks.length) return '<p class="muted">No jobs yet. Write one below.</p>';
  return `<ul class="tasks">${[...state.tasks].reverse().map((task) => {
    const agent = agentById(task.assigneeId);
    const dep = (task.dependsOn || []).length ? `Waits for ${task.dependsOn.length} earlier job(s).` : 'Can start alone.';
    return `<li class="task">
      <span class="task-state">${esc(TASK_LABEL[task.status] || task.status)}</span>
      <div><b>${esc(task.title)}</b><div class="small muted">${esc(agent?.name || 'Nobody')} · ${esc(dep)}</div>
      ${task.error ? `<div class="error-text">${esc(task.error)}</div>` : ''}</div>
      <button type="button" class="ghost" data-act="delete-task" data-id="${esc(task.id)}">Delete</button>
    </li>`;
  }).join('')}</ul>`;
}

function messageHTML(message) {
  if (message.role === 'user') {
    return `<div class="bubble-row user" data-mid="${esc(message.id)}"><div class="bubble"><div class="meta" data-meta>You</div><div class="text" data-body>${rich(message.content)}</div></div></div>`;
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
    return `<div class="tool-line" data-mid="${esc(message.id)}"><div class="meta" data-meta>${esc(who?.name || 'Helper')} ${esc(TOOL_LABEL[message.tool] || 'used a tool')}</div><pre data-body>${esc(message.content)}</pre></div>`;
  }
  const agent = agentById(message.agentId);
  const meta = message.pending ? (message.loading ? 'the helper is getting ready' : 'writing') : (message.error ? 'stuck' : 'answer');
  return `<div class="bubble-row${message.pending ? ' pending' : ''}${message.error ? ' error' : ''}" data-mid="${esc(message.id)}">
    ${agent ? figureHTML(agent, { size: 'sm', caption: false }) : ''}
    <div class="bubble"><div class="meta" data-meta>${esc(agent?.name || 'Helper')} · ${esc(meta)}</div><div class="text" data-body>${message.content ? rich(message.content) : (message.pending ? '…' : '')}</div></div>
  </div>`;
}

function notesHTML() {
  const names = Object.keys(state.files).sort();
  const current = session.note && (session.note in state.files) ? session.note : null;
  return `<section class="card">
    <div class="row spread"><h2>Shared notes</h2><button type="button" class="ghost" data-act="new-note">New</button></div>
    <p class="small muted">If a note already has an owner, another agent does not overwrite it. They get a new file.</p>
    <div class="note-list">${names.map((name) => `<button type="button" class="note-link ${name === current ? 'active' : ''}" data-act="open-note" data-path="${esc(name)}">${esc(name)}</button>`).join('') || '<p class="muted">No notes yet.</p>'}</div>
    ${current ? `<label class="sr-only" for="note-body">${esc(current)}</label><textarea id="note-body">${esc(state.files[current])}</textarea><div class="row"><button type="button" data-act="save-note">Save</button><button type="button" class="danger" data-act="delete-note">Delete</button></div>` : ''}
  </section>`;
}

export function renderWorkspace() {
  const chat = workspaceChat();
  return `<div class="workspace">
    <div class="side-col">
      <section class="card"><h2>Jobs</h2>${taskList()}</section>
      ${notesHTML()}
    </div>
    <section class="thread-card">
      <header class="row spread"><div><h2>Talk</h2><p class="small muted">The characters talk in bubbles. A handoff stays as a sentence too.</p></div><button type="button" class="ghost" data-act="stop-all" ${isRunning() ? '' : 'disabled'}>Stop everyone</button></header>
      <div id="load-banner">${bannerHTML()}</div>
      <div id="thread" class="thread">${chat.messages.map(messageHTML).join('') || '<div class="welcome"><h2>The shared table is empty</h2><p>Write a job. The project lead splits it. The others start together, up to the limit.</p></div>'}</div>
      <div class="dock">${composerHTML()}</div>
    </section>
  </div>`;
}

export function keyPanelHTML() {
  const saved = !!readOpenRouterKey();
  return `<section class="card">
    <h2>OpenRouter key</h2>
    <p class="warn-note">The key stays only in this browser, and it goes only to openrouter.ai. A server would be safer, but this site has no server. Do not type it on a shared computer. The log and the saved copy do not include it.</p>
    <p>${saved ? 'A key is saved on this computer.' : 'No key yet.'}</p>
    <form id="key-form" autocomplete="off">
      <label for="or-key">Paste your key</label>
      <input id="or-key" type="password" name="or-key" autocomplete="off" spellcheck="false" placeholder="paste it here, it is not saved in the code">
      <div class="row"><button type="submit">Save key here</button><button type="button" class="danger" data-act="forget-key">Forget key</button></div>
    </form>
  </section>`;
}

function teacherCard(teacher) {
  return `<article class="card">
    <h2>${esc(teacher.label || teacher.model)}</h2>
    <p class="small muted">${esc(teacher.model)}</p>
    <p class="small">Price and limit from the list: ${esc(teacher.price || 'not listed')}</p>
    <p class="small muted">License: ${esc(teacher.license || 'not listed')}</p>
    <div class="row"><button type="button" class="ghost" data-act="test-teacher" data-id="${esc(teacher.id)}">Test connection</button><button type="button" class="danger" data-act="delete-teacher" data-id="${esc(teacher.id)}">Remove</button></div>
  </article>`;
}

function catalogHTML() {
  const q = session.catalogQuery || '';
  const added = new Set(state.teachers.map((item) => item.model));
  const rows = (session.catalog || []).filter((model) => {
    if (!q) return isFreeModelId(model.id);
    const hay = `${model.id} ${model.name}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  }).slice(0, 40);
  return `<section class="card">
    <div class="row spread"><h2>Public model list</h2><button type="button" class="ghost" data-act="refresh-models">Refresh list</button></div>
    <p class="small muted">The list comes from openrouter.ai with no key. Free models (the ones ending in :free) show first. We do not invent prices.</p>
    ${session.catalogError ? `<p class="error-text">${esc(session.catalogError)}</p>` : ''}
    <label for="model-query">Search</label>
    <input id="model-query" value="${esc(q)}" placeholder="qwen, deepseek, or :free">
    <div class="catalog">${rows.map((model) => `<div class="catalog-row">
      <div><b>${esc(model.name)}</b><div class="small muted">${esc(model.id)}</div><div class="small">${esc(formatPrice(model))}</div></div>
      <button type="button" data-act="add-teacher" data-model="${esc(model.id)}" ${added.has(model.id) ? 'disabled' : ''}>${added.has(model.id) ? 'On your list' : 'Add'}</button>
    </div>`).join('') || '<p class="muted">Nothing matched. Refresh the list.</p>'}</div>
  </section>`;
}

function exampleCard(example) {
  const reasons = (example.cleanReasons || []).join(' ');
  return `<article class="card example">
    <p class="badge">Teacher answer, not a command</p>
    <p><b>${esc(example.modelName || example.model)}</b> · ${esc(example.status || '')}</p>
    <p class="small muted">${esc(new Date(example.created || Date.now()).toLocaleString('en'))} · ${esc(example.priceNote || '')}</p>
    <p class="small muted">License: ${esc(example.license || 'not listed')} · Source: ${esc(example.source || 'teacher')}</p>
    <pre>${esc(example.text || example.error || '')}</pre>
    <p class="small">${esc(example.judgeNote || '')}</p>
    ${reasons ? `<p class="error-text">${esc(reasons)}</p>` : ''}
    <div class="row">
      <button type="button" data-act="approve-example" data-id="${esc(example.id)}" ${example.dropped ? 'disabled' : ''}>Approve</button>
      <button type="button" class="ghost" data-act="reject-example" data-id="${esc(example.id)}">Reject</button>
    </div>
  </article>`;
}

export function renderTeachers() {
  const busy = session.pipelineRunning;
  const chatOptions = state.teachers.map((teacher) => `<option value="${esc(teacher.model)}" ${teacher.model === state.settings.openrouterChatModel ? 'selected' : ''}>${esc(teacher.label || teacher.model)}</option>`).join('');
  return `${head('Teachers', 'Teachers run on OpenRouter with your key. Their answers are notes, not orders. Nothing goes into the training file until you say yes.')}
    ${keyPanelHTML()}
    <section class="card">
      <h2>Call limit</h2>
      <p>So far <b>${state.usage.openrouterCalls || 0}</b> calls went out. The cap is ${state.settings.orGlobal}. One run can use at most ${state.settings.orPerRun}.</p>
      <form id="limit-form" class="row">
        <label>In one run<input id="or-per-run" type="number" min="1" max="30" value="${state.settings.orPerRun}"></label>
        <label>In total<input id="or-global" type="number" min="1" max="500" value="${state.settings.orGlobal}"></label>
        <button type="submit">Save limits</button>
      </form>
      <p class="small muted">Raising a limit asks you first. When a limit is hit, the page stops by itself.</p>
    </section>
    ${catalogHTML()}
    <h2>Your teachers</h2>
    <div class="grid">${state.teachers.map(teacherCard).join('') || '<p class="muted">No teachers yet. Refresh the list, then add at least two.</p>'}</div>
    <form id="ask-teachers" class="card">
      <h2>A job for the teachers</h2>
      <p class="small muted">Tünde asks at least two teachers at once. Lilla compares them. Dóri leaves out weak examples. You say yes or no.</p>
      <label for="teacher-task">Job</label>
      <textarea id="teacher-task" rows="4" placeholder="Explain in a few sentences how bees make honey."></textarea>
      <label class="checkline"><input id="use-judge-model" type="checkbox"> Also ask a teacher model to judge (one extra call)</label>
      <label for="judge-model">Judge model</label>
      <select id="judge-model"><option value="">The check on this page is enough</option>${chatOptions}</select>
      <div class="row">
        <button type="submit" ${busy ? 'disabled' : ''}>Ask the teachers</button>
        <button type="button" class="ghost" data-act="stop-pipeline" ${busy ? '' : 'disabled'}>Stop</button>
      </div>
    </form>
    <section>
      <div class="row spread"><h2>Examples</h2><button type="button" class="ghost" data-act="export-jsonl">Download approved set</button></div>
      ${(state.examples || []).length ? state.examples.map(exampleCard).join('') : '<p class="muted">No teacher answers yet.</p>'}
    </section>`;
}

export function renderTraining() {
  const trainer = state.agents.find((agent) => agent.role === 'trainer');
  const runs = state.trainingRuns.length
    ? `<ul class="log">${state.trainingRuns.map((run) => `<li><time>${esc(new Date(run.ts).toLocaleString('en'))}</time><b>${esc(run.status)}</b><p>${esc(run.message)}</p></li>`).join('')}</ul>`
    : '<p class="muted">No tries yet.</p>';
  const approved = (state.examples || []).filter((item) => item.approval === 'approved' && !item.dropped).length;
  const jsonl = toJSONL(state.examples || []);
  return `${head('Training', 'The Kaggle training notebook is the next step. It does not run now. You can download the approved examples as a text file. Only those can be used later.')}
    <p class="badge">Training run is not connected yet</p>
    ${trainer ? `<div class="card row">${figureHTML(trainer)}<p>Sári would start training only after you say yes. That run is not live yet.</p></div>` : ''}
    <section class="card"><h2>Approved set</h2><p>${approved} example(s) could go forward. Left-out and rejected ones cannot.</p><button type="button" class="ghost" data-act="export-jsonl" ${jsonl ? '' : 'disabled'}>Download JSONL</button></section>
    <form id="train-form" class="card">
      <label>Data set</label>
      <select disabled><option>${approved ? `${approved} approved example(s). Training does not run yet.` : 'No approved set yet'}</option></select>
      <div class="row">
        <label>LoRA rank, saved only here<input id="rank" type="number" min="1" max="64" value="${Number(state.trainingConfig.rank) || 8}"></label>
        <label>Passes, saved only here<input id="epochs" type="number" min="1" max="3" value="${Number(state.trainingConfig.epochs) || 1}"></label>
      </div>
      <p class="small muted">These numbers stay in this browser. They are not sent anywhere.</p>
      <button type="submit">Start training</button>
    </form>
    <section class="card"><h2>Earlier tries</h2>${runs}</section>`;
}

export function renderEval() {
  return `${head('Scores', 'This is where a before-and-after check will go. Until there is a training run, there is no score. We do not invent numbers.')}
    <p class="badge">Not ready yet</p>
    <section class="card"><h2>Checks</h2><p class="muted">There is no before-score yet. The same questions should be used before and after training, plus a set that training never sees.</p></section>
    <section class="card"><h2>Before / after</h2><p class="muted">No measurement yet.</p></section>
    <section class="card"><h2>Mistakes and slips</h2><p class="muted">No list yet. If a skill gets worse later, it will show up here.</p></section>`;
}

export function renderLog() {
  const rows = state.audit.length
    ? `<ul class="log">${state.audit.map((item) => `<li><time datetime="${esc(new Date(item.ts).toISOString())}">${esc(new Date(item.ts).toLocaleString('en'))}</time><b>${esc(item.actor)}</b><span>${esc(item.action)}</span><p>${esc(item.detail)}</p></li>`).join('')}</ul>`
    : '<p class="muted">Nothing here yet. Starts, stops, yeses, and deletes will show up.</p>';
  return `${head('Log', 'A log on this computer: who did what, and when. It stays in this browser.')}
    <label for="log-filter">Search the log</label><input id="log-filter" placeholder="name or action">
    <div id="log-list">${rows}</div>`;
}

export function renderSettings() {
  const chatOptions = state.teachers.map((teacher) => `<option value="${esc(teacher.model)}" ${teacher.model === state.settings.openrouterChatModel ? 'selected' : ''}>${esc(teacher.label || teacher.model)}</option>`).join('');
  return `${head('Settings', 'Notes stay on this computer. The OpenRouter key is kept apart, and it can go only to openrouter.ai.')}
    ${keyPanelHTML()}
    <form id="settings-form" class="card">
      <label for="theme">Theme<select id="theme">${[['system', 'Match this device'], ['dark', 'Dark'], ['light', 'Light']].map(([id, label]) => `<option value="${id}" ${state.settings.theme === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label for="set-model">Helper on this computer<select id="set-model">${MODELS.map((model) => `<option value="${esc(model.id)}" ${model.id === state.settings.model ? 'selected' : ''}>${esc(model.label)}</option>`).join('')}</select></label>
      <div class="row">
        <label>Playfulness<input id="temperature" type="number" min="0" max="2" step="0.1" value="${state.settings.temperature}"></label>
        <label>Longest answer<input id="tokens" type="number" min="64" max="1024" value="${state.settings.maxTokens}"></label>
      </div>
      <div class="row">
        <label>Agents at once<input id="parallel" type="number" min="1" max="5" value="${state.settings.maxParallel}"></label>
        <label>Time limit per agent, seconds<input id="runtime" type="number" min="30" max="300" value="${state.settings.maxRuntimeSec}"></label>
      </div>
      <label for="reply-source">Where should chat answers come from?</label>
      <select id="reply-source">
        <option value="auto" ${state.settings.replySource === 'auto' ? 'selected' : ''}>Automatic: OpenRouter when this browser has no WebGPU, otherwise the helper here</option>
        <option value="local" ${state.settings.replySource === 'local' ? 'selected' : ''}>Always the helper on this computer</option>
        <option value="openrouter" ${state.settings.replySource === 'openrouter' ? 'selected' : ''}>OpenRouter teacher, if a key is saved</option>
      </select>
      <label for="chat-teacher">Teacher for chat</label>
      <select id="chat-teacher"><option value="">None picked</option>${chatOptions}</select>
      <p class="small muted">Raising how many agents, how long they run, or how long an answer can be will ask you first. Phones start with the small helper. With a key, OpenRouter can answer too.</p>
      <button type="submit">Save</button>
    </form>
    <section class="card">
      <h2>A copy on this computer</h2>
      <div class="row">
        <button type="button" class="ghost" data-act="export-data">Download a copy</button>
        <label class="btn ghost">Load a copy<input id="import-file" type="file" accept="application/json" hidden></label>
        <button type="button" class="danger" data-act="erase">Erase everything</button>
      </div>
      <p class="small muted">The copy is a JSON file on your computer. It is not uploaded. The OpenRouter key is not inside it.</p>
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
  return `<h2 id="modal-title">New agent from a template</h2>
    <label for="tmpl">Template</label>
    <select id="tmpl">${TEMPLATES.map((role) => `<option value="${esc(role.id)}">${esc(role.title)}</option>`).join('')}</select>
    <label for="an">Name</label><input id="an" value="${esc(first.name)}" maxlength="40">
    <label for="ap">How they behave</label><textarea id="ap" rows="5">${esc(first.prompt)}</textarea>
    <div class="row"><button type="button" data-act="save-create">Create</button><button type="button" class="ghost" data-act="close-modal">Cancel</button></div>`;
}

export function renameModalHTML(agent) {
  return `<h2 id="modal-title">Rename</h2>
    <label for="an">New name</label><input id="an" value="${esc(agent.name)}" maxlength="40">
    <p class="small muted">The role stays: ${esc(roleTitle(agent.role))}.</p>
    <div class="row"><button type="button" data-act="save-rename" data-id="${esc(agent.id)}">Save</button><button type="button" class="ghost" data-act="close-modal">Cancel</button></div>`;
}

export function runModalHTML(agent) {
  return `<h2 id="modal-title">Start ${esc(agent.name)}</h2>
    <label for="one-task">What should they do?</label>
    <textarea id="one-task" rows="3" placeholder="A short job just for them"></textarea>
    <div class="row"><button type="button" data-act="save-run" data-id="${esc(agent.id)}">Start</button><button type="button" class="ghost" data-act="close-modal">Cancel</button></div>`;
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
    const label = STATE_LABEL[name] || 'Waiting';
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
  const q = String(query || '').trim().toLowerCase();
  const items = state.audit.filter((item) => !q || `${item.actor} ${item.action} ${item.detail}`.toLowerCase().includes(q));
  const list = document.querySelector('#log-list');
  if (!list) return;
  list.innerHTML = items.length
    ? `<ul class="log">${items.map((item) => `<li><time>${esc(new Date(item.ts).toLocaleString('en'))}</time><b>${esc(item.actor)}</b><span>${esc(item.action)}</span><p>${esc(item.detail)}</p></li>`).join('')}</ul>`
    : '<p class="muted">No matching entry.</p>';
}

export function mark() {
  return `<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="2" y="2" width="28" height="28" rx="10" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="14" r="1.8"/><circle cx="20" cy="14" r="1.8"/><path d="M12 20c1.5 1.7 6.5 1.7 8 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
}
