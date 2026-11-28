import { esc, rich } from './text.js';
import { state, agentById } from './store.js';
import { readOpenRouterKey } from './openrouter.js';
import { extractSources } from './tools.js';
import { listAgentChats, listGroupChats } from './chats.js';
import { iconMarkup, iconSVG, SHAPES, ICON_COLORS, safeHex } from './icons.js';
import { CONNECTORS, connectorView, UNAVAILABLE } from './connectors.js';
import { DEFAULT_STUDENT_REPO } from './student-model.js';
import { GITHUB_OAUTH_NOTE, readClientId, redirectUri } from './oauth.js';

const TOOL_LABEL = {
  web_search: 'looked on the web',
  read_page: 'read a page',
  fetch_wikipedia_page: 'read a page',
  write_file: 'saved a note',
  read_file: 'read a note',
  list_files: 'checked the notes',
  run_js: 'worked something out',
  github_list_repos: 'listed GitHub repos',
  github_list_pages: 'listed GitHub Pages sites',
  github_list_gists: 'listed GitHub gists',
  github_create_gist: 'created a gist',
  remember: 'saved a memory',
  forget: 'forgot a memory',
  create_routine: 'saved a routine',
  list_routines: 'listed routines',
  cancel_routine: 'cancelled a routine',
};

function sourceItems(message) {
  if (Array.isArray(message.sources)) return message.sources;
  return extractSources(message.content || '');
}

function sourcesHTML(message) {
  const sources = sourceItems(message).filter((item) => item && item.url);
  if (!sources.length) return '';
  return `<p class="src-label">Sources</p><ul class="sources">${sources.map((item) => `<li><a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.title || item.url)}</a></li>`).join('')}</ul>`;
}

function fieldInputs(spec, prefix) {
  const fields = spec?.fields?.length ? spec.fields : [{ id: 'key', secret: true, label: 'Key', placeholder: spec?.placeholder || '' }];
  return fields.map((field) => {
    const type = field.secret ? 'password' : 'text';
    const value = field.id === 'clientId' ? readClientId(spec.id) : (field.value || '');
    const id = `${prefix}-${field.id}`;
    return `<label for="${esc(id)}">${esc(field.label || spec.name)}</label>
      <input id="${esc(id)}" data-field="${esc(field.id)}" type="${type}" autocomplete="off" spellcheck="false" placeholder="${esc(field.placeholder || '')}" value="${field.secret ? '' : esc(value)}">`;
  }).join('');
}

function setupLine(spec) {
  if (!spec?.setupUrl) return spec?.setup ? `<p class="small">${esc(spec.setup)}</p>` : '';
  return `<p class="small"><a href="${esc(spec.setupUrl)}" target="_blank" rel="noopener noreferrer">${esc(spec.setup || 'Where to get a key')}</a></p>`;
}

function connectCardHTML(message) {
  const spec = CONNECTORS.find((item) => item.id === message.connector);
  const name = spec?.name || 'Account';
  if (message.state === 'connected') {
    return `<div class="connect-card" data-mid="${esc(message.id)}"><p><b>${esc(name)}</b></p><p>${esc(message.detail || 'Connected.')}</p></div>`;
  }
  const failed = message.state === 'failed' && message.detail ? `<p class="small">${esc(message.detail)}</p>` : '';
  if (spec?.auth === 'oauth') {
    const act = spec.id === 'mastodon' ? 'mastodon-start' : 'oauth-start';
    const extra = spec.id === 'mastodon' ? '' : ` data-oauth="${esc(spec.id)}"`;
    return `<div class="connect-card" data-mid="${esc(message.id)}">
      <p><b>Connect ${esc(name)}</b></p>
      <p class="small">${esc(spec.hint || '')}</p>
      ${setupLine(spec)}
      ${fieldInputs(spec, `card-${message.id}`)}
      <div class="row"><button type="button" data-act="${act}" data-connector="${esc(spec.id)}"${extra}>Sign in</button></div>
    </div>`;
  }
  return `<div class="connect-card" data-mid="${esc(message.id)}">
    <p><b>Connect ${esc(name)}</b></p>
    <p class="small">${esc(spec?.hint || '')}</p>
    ${setupLine(spec)}
    ${failed}
    ${fieldInputs(spec, `card-${message.id}`)}
    <div class="row"><button type="button" data-act="test-connector" data-connector="${esc(message.connector)}" data-mid="${esc(message.id)}">Test and save</button></div>
  </div>`;
}

export function messageHTML(message) {
  if (!message) return '';
  if (message.role === 'connect') return connectCardHTML(message);
  if (message.role === 'user') {
    return `<div class="bubble-row user" data-mid="${esc(message.id)}"><div class="bubble"><div class="meta">You</div><div class="text" data-body>${rich(message.content)}</div></div></div>`;
  }
  if (message.role === 'tool') {
    if (message.hidden) return '';
    const who = agentById(message.agentId);
    const web = message.tool === 'web_search' || message.tool === 'read_page' || message.tool === 'fetch_wikipedia_page';
    if (web && !sourceItems(message).some((item) => item && item.url)) return '';
    const label = `${who?.name || 'Agent'} ${TOOL_LABEL[message.tool] || 'used a tool'}`;
    const body = web ? sourcesHTML(message) : `<p>${esc(message.content || '')}</p>`;
    return `<details class="tool-line" data-mid="${esc(message.id)}"><summary>${esc(label)}</summary>${body}</details>`;
  }
  if (message.role === 'system' || message.role === 'handoff' || message.role === 'task') {
    return `<div class="sys-line" data-mid="${esc(message.id)}"><p>${esc(message.content || '')}</p></div>`;
  }
  const agent = agentById(message.agentId);
  const phase = message.pending
    ? (String(message.content || '').startsWith('Looking up') ? 'looking up' : (String(message.content || '').startsWith('Getting Agora') ? 'getting ready' : 'writing'))
    : (message.error ? 'could not finish' : 'Agora 1.0');
  const image = message.image
    ? `<img class="chat-image" alt="Attached image" src="${esc(message.image)}"><p class="small muted">Agora 1.0 cannot see this picture.</p>`
    : '';
  const file = message.attachment?.text
    ? `<details class="file-note"><summary>${esc(message.attachment.name || 'File')}</summary><pre>${esc(message.attachment.text)}</pre></details>`
    : '';
  const rated = message.rating === 'up' || message.rating === 'down';
  const rate = !message.pending && message.content
    ? `<div class="rate">
        <button type="button" class="quiet${message.rating === 'up' ? ' on' : ''}" data-act="rate" data-rate="up" data-mid="${esc(message.id)}" aria-label="Thumbs up" aria-pressed="${message.rating === 'up' ? 'true' : 'false'}">Up</button>
        <button type="button" class="quiet${message.rating === 'down' ? ' on' : ''}" data-act="rate" data-rate="down" data-mid="${esc(message.id)}" aria-label="Thumbs down" aria-pressed="${message.rating === 'down' ? 'true' : 'false'}">Down</button>
        ${rated ? `<input class="rate-note" data-rate-note="${esc(message.id)}" maxlength="500" placeholder="Optional comment" value="${esc(message.ratingComment || '')}" aria-label="Feedback comment">` : ''}
      </div>`
    : '';
  return `<div class="bubble-row${message.pending ? ' pending' : ''}${message.error ? ' error' : ''}" data-mid="${esc(message.id)}">
    ${agent ? iconMarkup(agent) : ''}
    <div class="bubble"><div class="meta" data-meta>${esc(agent?.name || 'Agent')} · ${esc(phase)}</div>${image}${file}<div class="text" data-body>${message.content ? rich(message.content) : (message.pending ? '…' : '')}</div>${rate}</div>
  </div>`;
}

export function agentListHTML(activeId) {
  if (!state.agents.length) return '<p class="muted empty-note">No agents yet.</p>';
  return state.agents.map((agent) => {
    const on = agent.id === activeId;
    return `<div class="agent-row-wrap${on ? ' active' : ''}">
      <button type="button" class="agent-row${on ? ' active' : ''}" data-act="select-agent" data-id="${esc(agent.id)}" aria-current="${on ? 'true' : 'false'}">
        ${iconMarkup(agent)}
        <span class="agent-name">${esc(agent.name)}</span>
      </button>
      <button type="button" class="quiet tiny" data-act="edit-agent" data-id="${esc(agent.id)}" aria-label="Edit ${esc(agent.name)}">Edit</button>
    </div>`;
  }).join('');
}

export function agentChatsHTML(agentId, activeChatId, query = '') {
  const q = String(query || '').trim().toLowerCase();
  const chats = listAgentChats(agentId).filter((chat) => {
    if (!q) return true;
    if ((chat.name || '').toLowerCase().includes(q)) return true;
    return (chat.messages || []).some((message) => String(message.content || '').toLowerCase().includes(q));
  });
  if (!agentId) return '';
  if (!chats.length) return `<p class="muted empty-note">${q ? 'No chats match.' : 'No chats yet.'}</p>`;
  return chats.map((chat) => {
    const on = chat.id === activeChatId;
    return `<div class="chat-row${on ? ' active' : ''}">
      <button type="button" class="chat-select" data-act="select-chat" data-id="${esc(chat.id)}" aria-current="${on ? 'true' : 'false'}">${esc(chat.name || 'New chat')}</button>
      <button type="button" class="quiet" data-act="rename-chat" data-id="${esc(chat.id)}" aria-label="Rename chat">Rename</button>
      <button type="button" class="quiet" data-act="delete-chat" data-id="${esc(chat.id)}" aria-label="Delete chat">Delete</button>
    </div>`;
  }).join('');
}

export function groupListHTML(activeId) {
  const groups = listGroupChats();
  if (!groups.length) return '<p class="muted empty-note">No groups yet.</p>';
  return groups.map((chat) => {
    const on = chat.id === activeId;
    const faces = (chat.agentIds || []).slice(0, 4).map((id) => agentById(id)).filter(Boolean);
    return `<button type="button" class="group-row${on ? ' active' : ''}" data-act="select-group" data-id="${esc(chat.id)}" aria-current="${on ? 'true' : 'false'}">
      <span class="face-stack">${faces.map((agent) => iconMarkup(agent)).join('')}</span>
      <span class="agent-name">${esc(chat.name || 'Group')}</span>
    </button>`;
  }).join('');
}

export function chatHeadHTML(chat, agent) {
  if (chat?.type === 'group') {
    const members = (chat.agentIds || []).map((id) => agentById(id)).filter(Boolean);
    return `<div class="who">
      <span class="face-stack">${members.map((item) => iconMarkup(item)).join('')}</span>
      <div>
        <h1>${esc(chat.name || 'Group')}</h1>
        <p class="model-pill">Agora 1.0 · ${esc(members.map((item) => item.name).join(', '))}</p>
      </div>
    </div>`;
  }
  if (!agent) return '<div class="who"><div><h1>Agora</h1><p class="model-pill">Agora 1.0</p></div></div>';
  return `<div class="who">
    ${iconMarkup(agent)}
    <div>
      <h1>${esc(agent.name)}</h1>
      <p class="model-pill">Agora 1.0</p>
    </div>
    <button type="button" class="quiet" data-act="edit-agent" data-id="${esc(agent.id)}">Edit</button>
    <button type="button" class="quiet" data-act="delete-agent" data-id="${esc(agent.id)}">Delete</button>
  </div>`;
}

export function emptyHomeHTML() {
  const faces = [['robot', ICON_COLORS[0]], ['cat', ICON_COLORS[1]], ['spark', ICON_COLORS[2]]]
    .map(([shape, color]) => `<span class="avatar shape" style="--agent:${color}">${iconSVG(shape)}</span>`).join('');
  return `<div class="empty-home">
    <div class="hero-faces" aria-hidden="true">${faces}</div>
    <h1>Create an agent</h1>
    <p>You start with an empty workspace. Give an agent a name and an icon, then chat. Agora 1.0 is the only model, and it can search the web when a question needs it.</p>
    <button type="button" data-act="open-create">Create agent</button>
  </div>`;
}

export function threadHTML(chat, agent) {
  const messages = chat?.messages || [];
  if (!chat) return emptyHomeHTML();
  if (!messages.length) {
    const title = chat.type === 'group' ? (chat.name || 'Group') : (agent?.name || 'Agent');
    const note = chat.type === 'group'
      ? 'Everyone in the group sees the whole conversation and answers in turn.'
      : 'Ask anything. Agora 1.0 answers in your language.';
    return `<div class="welcome">${chat.type === 'group' ? '' : (agent ? iconMarkup(agent) : '')}<h2>${esc(title)}</h2><p>${esc(note)}</p></div>`;
  }
  return messages.map(messageHTML).join('');
}

export function agentFormHTML(draft, { editing = false } = {}) {
  const icon = draft?.icon || { type: 'shape', shape: 'robot', color: ICON_COLORS[0] };
  const preview = icon.type === 'photo' && icon.dataUrl
    ? `<img class="avatar photo lg" alt="" src="${esc(icon.dataUrl)}">`
    : `<span class="avatar shape lg" style="--agent:${safeHex(icon.color)}">${iconSVG(icon.shape || 'robot')}</span>`;
  return `<h2 id="modal-title">${editing ? 'Edit agent' : 'Create agent'}</h2>
    <label for="agent-name">Name</label>
    <input id="agent-name" maxlength="40" value="${esc(draft?.name || '')}">
    <p class="section-label">Icon</p>
    <div class="shape-grid">${SHAPES.map((shape) => `<button type="button" class="shape-btn${icon.type !== 'photo' && icon.shape === shape ? ' selected' : ''}" data-act="pick-shape" data-shape="${shape}" aria-label="${shape}" style="--agent:${safeHex(icon.color)}">${iconSVG(shape)}</button>`).join('')}</div>
    <div class="color-row">${ICON_COLORS.map((color) => `<button type="button" class="color-btn${icon.color === color ? ' selected' : ''}" data-act="pick-color" data-color="${color}" style="background:${color}" aria-label="Color ${color}"></button>`).join('')}</div>
    <div class="preview-row">${preview}<label class="btn ghost">Upload a photo<input id="agent-photo" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label></div>
    <p class="small muted">Photos stay on this computer. They are resized before they are saved.</p>
    <div class="row">
      <button type="button" data-act="save-agent">${editing ? 'Save' : 'Create agent'}</button>
      <button type="button" class="ghost" data-act="close-modal">Cancel</button>
      ${editing ? `<button type="button" class="danger" data-act="delete-agent" data-id="${esc(draft?.id || '')}">Delete</button>` : ''}
    </div>`;
}

export function groupFormHTML() {
  if (state.agents.length < 2) {
    return `<h2 id="modal-title">New group</h2><p>Create at least two agents first.</p><button type="button" class="ghost" data-act="close-modal">Close</button>`;
  }
  const boxes = state.agents.map((agent) => `<label class="checkline"><input type="checkbox" name="member" value="${esc(agent.id)}">${iconMarkup(agent)}<span>${esc(agent.name)}</span></label>`).join('');
  return `<h2 id="modal-title">New group</h2>
    <label for="group-name">Name</label>
    <input id="group-name" maxlength="80" placeholder="Project room">
    <p class="section-label">Members</p>
    <div class="member-picks">${boxes}</div>
    <p class="small muted">Pick at least two. They answer in turn and can read each other.</p>
    <div class="row"><button type="button" data-act="save-group">Create group</button><button type="button" class="ghost" data-act="close-modal">Cancel</button></div>`;
}

function agentChecks(id) {
  if (!state.agents.length) return '<p class="small muted">Create an agent to let it use this account.</p>';
  return `<div class="member-picks">${state.agents.map((agent) => `<label class="checkline"><input type="checkbox" data-allow="1" data-connector="${esc(id)}" data-id="${esc(agent.id)}" ${(agent.connectors || []).includes(id) ? 'checked' : ''}>${esc(agent.name)}</label>`).join('')}</div>`;
}

function connectorCard(item) {
  const view = connectorView[item.id] || { state: 'unknown', detail: '' };
  const label = view.state === 'connected' ? 'Connected' : view.state === 'failed' ? 'Failed' : (item.auth === 'oauth' ? 'Sign in' : 'Not connected');
  const act = item.id === 'mastodon' ? 'mastodon-start' : 'oauth-start';
  const extra = item.auth === 'oauth' && item.id !== 'mastodon' ? ` data-oauth="${esc(item.id)}"` : '';
  const action = item.auth === 'oauth'
    ? `<button type="button" data-act="${act}" data-connector="${esc(item.id)}"${extra}>Sign in</button>`
    : `<button type="button" data-act="test-connector" data-connector="${esc(item.id)}">Test and save</button>`;
  const redirect = item.auth === 'oauth' && item.id !== 'mastodon'
    ? `<p class="small">Redirect URI: ${esc(redirectUri())}</p>`
    : '';
  return `<section class="connector-row" data-connector-card data-hay="${esc(`${item.group} ${item.name} ${item.hint}`.toLowerCase())}">
    <p class="section-label">${esc(item.group)}</p>
    <div class="row spread"><h2>${esc(item.name)}</h2><span class="model-pill">${esc(label)}</span></div>
    <p class="small">${esc(view.detail || item.hint)}</p>
    ${setupLine(item)}
    ${redirect}
    ${fieldInputs(item, `panel-${item.id}`)}
    <div class="row">
      ${action}
      <button type="button" class="danger" data-act="disconnect-connector" data-connector="${esc(item.id)}">Disconnect</button>
    </div>
    <p class="section-label">Agents that may use it</p>
    ${agentChecks(item.id)}
  </section>`;
}

export function connectorsHTML(opts = {}) {
  const groups = ['Models', 'Code', 'Work', 'Chat', 'Media', 'Sign-in'];
  const cards = groups.map((group) => {
    const items = CONNECTORS.filter((item) => item.group === group).map(connectorCard).join('');
    return items ? `<div data-connector-group="${esc(group)}">${items}</div>` : '';
  }).join('');
  const skipped = UNAVAILABLE.map((item) => `<li><b>${esc(item.name)}.</b> ${esc(item.why)}</li>`).join('');
  const body = `<p class="small muted">Keys stay encrypted in this browser. Agora 1.0 only sees whether an account is connected.</p>
    <label for="connector-filter">Find a connector</label>
    <input id="connector-filter" type="search" placeholder="Search connectors" autocomplete="off">
    ${cards}
    <section class="connector-row" data-connector-card data-hay="unavailable skipped">
      <h2>Not available from this site</h2>
      <ul class="small">${skipped}<li><b>GitHub sign-in.</b> ${esc(GITHUB_OAUTH_NOTE)}</li></ul>
    </section>`;
  if (opts.embedded) return body;
  return `<h2 id="modal-title">Connectors</h2>${body}
    <div class="row"><button type="button" class="ghost" data-act="close-modal">Close</button></div>`;
}

export function settingsHTML() {
  const saved = !!readOpenRouterKey();
  const theme = state.settings.theme || 'dark';
  const option = (id, label) => `<option value="${id}" ${theme === id ? 'selected' : ''}>${label}</option>`;
  return `<h2 id="modal-title">Settings</h2>
    <p class="small muted">Chats stay in this browser. The sidebar says which model is answering.</p>
    <form id="settings-form" autocomplete="off">
      <label for="theme">Theme</label>
      <select id="theme">${option('dark', 'Dark')}${option('light', 'Light')}${option('system', 'Match this device')}</select>
      <h2>Agora 1.0</h2>
      <p class="small">Agora 1.0 is the trained model. This page loads it from the Hugging Face repo below. If the weights are not published, the built-in model answers instead.</p>
      <label for="student-repo">Hugging Face repo</label>
      <input id="student-repo" value="${esc(state.settings.studentRepo || DEFAULT_STUDENT_REPO)}" autocomplete="off" spellcheck="false" placeholder="${esc(DEFAULT_STUDENT_REPO)}">
      <h2>Online connection</h2>
      <p class="warn-note">A key is optional. It stays only in this browser and is sent only to openrouter.ai. Do not type it on a shared computer.</p>
      <p>${saved ? 'A key is saved on this computer.' : 'No key yet. Agora 1.0 can still search the web.'}</p>
      <label for="or-key">Paste a key</label>
      <input id="or-key" type="password" name="or-key" autocomplete="off" spellcheck="false" placeholder="Stays on this computer">
      <div class="row">
        <button type="submit">Save</button>
        <button type="button" class="ghost" data-act="close-modal">Close</button>
        <button type="button" class="danger" data-act="forget-key">Forget key</button>
      </div>
    </form>
    <section class="settings-extra">
      <h2>This browser</h2>
      <div class="row">
        <button type="button" class="ghost" data-act="export-data">Download a copy</button>
        <button type="button" class="danger" data-act="erase">Erase everything</button>
      </div>
      <p class="small muted">The copy is a file on your computer. The key is not inside it.</p>
    </section>`;
}

export function renameChatHTML(chat) {
  return `<h2 id="modal-title">Rename chat</h2>
    <label for="chat-name">Name</label>
    <input id="chat-name" maxlength="80" value="${esc(chat?.name || '')}">
    <div class="row"><button type="button" data-act="save-chat-name" data-id="${esc(chat?.id || '')}">Save</button><button type="button" class="ghost" data-act="close-modal">Cancel</button></div>`;
}

function plainBody(node) {
  return node?.textContent ?? '';
}

export function patchThread(chat) {
  const box = document.querySelector('#thread');
  if (!box || !chat) return false;
  const nodes = [...box.querySelectorAll('[data-mid]')];
  const visible = (chat.messages || []).filter((message) => messageHTML(message));
  if (nodes.length !== visible.length) return false;
  for (let i = 0; i < visible.length; i += 1) {
    const message = visible[i];
    if (nodes[i].dataset.mid !== message.id) return false;
    const body = nodes[i].querySelector('[data-body]');
    const next = message.content || (message.pending ? '…' : '');
    if (body && plainBody(body) !== next && message.role !== 'tool') body.textContent = next;
    nodes[i].classList.toggle('pending', !!message.pending);
    nodes[i].classList.toggle('error', !!message.error);
  }
  return true;
}

export function syncAgents() {}
