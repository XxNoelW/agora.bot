import { esc, rich } from './text.js';
import { state, agentById } from './store.js';
import { figureHTML, safeColor } from './characters.js';
import { viewState, altText, STATE_LABEL } from './roles.js';
import { readOpenRouterKey } from './openrouter.js';
import { extractSources } from './tools.js';
import { listAgentChats } from './chats.js';

const TOOL_LABEL = {
  web_search: 'looked on the web',
  read_page: 'read a page',
  fetch_wikipedia_page: 'read a page',
  write_file: 'saved a note',
  read_file: 'read a note',
  list_files: 'checked the notes',
  run_js: 'worked something out',
};

function sourceItems(message) {
  if (Array.isArray(message.sources) && message.sources.length) return message.sources;
  return extractSources(message.content || '');
}

function sourcesHTML(message) {
  const sources = sourceItems(message).filter((item) => item && item.url);
  if (!sources.length) return `<p>${esc(message.content || '')}</p>`;
  return `<p class="src-label">Sources</p><ul class="sources">${sources.map((item) => `<li>
      <a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.title || item.url)}</a>
    </li>`).join('')}</ul>`;
}

export function messageHTML(message) {
  if (!message) return '';
  if (message.role === 'user') {
    return `<div class="bubble-row user" data-mid="${esc(message.id)}"><div class="bubble"><div class="meta">You</div><div class="text" data-body>${rich(message.content)}</div></div></div>`;
  }
  if (message.role === 'tool') {
    const who = agentById(message.agentId);
    const web = message.tool === 'web_search' || message.tool === 'read_page' || message.tool === 'fetch_wikipedia_page';
    return `<div class="tool-line" data-mid="${esc(message.id)}"><div class="meta">${esc(who?.name || 'Agent')} ${esc(TOOL_LABEL[message.tool] || 'used a tool')}</div>${web ? sourcesHTML(message) : `<p data-body>${esc(message.content || '')}</p>`}</div>`;
  }
  if (message.role === 'system' || message.role === 'handoff' || message.role === 'task') {
    return `<div class="sys-line" data-mid="${esc(message.id)}"><p data-body>${esc(message.content || '')}</p></div>`;
  }
  const agent = agentById(message.agentId);
  const phase = message.pending
    ? (String(message.content || '').startsWith('Looking up') ? 'looking up' : (String(message.content || '').startsWith('Getting Agora') ? 'getting ready' : 'writing'))
    : (message.error ? 'could not finish' : 'Agora AI');
  return `<div class="bubble-row${message.pending ? ' pending' : ''}${message.error ? ' error' : ''}" data-mid="${esc(message.id)}">
    ${agent ? figureHTML(agent, { size: 'sm', caption: false }) : ''}
    <div class="bubble"><div class="meta" data-meta>${esc(agent?.name || 'Agent')} · ${esc(phase)}</div><div class="text" data-body>${message.content ? rich(message.content) : (message.pending ? '…' : '')}</div></div>
  </div>`;
}

export function agentListHTML(activeId) {
  if (!state.agents.length) return '<p class="muted empty-note">No agents on this computer.</p>';
  return state.agents.map((agent) => {
    const on = agent.id === activeId;
    return `<button type="button" class="agent-row${on ? ' active' : ''}" data-act="select-agent" data-id="${esc(agent.id)}" style="--agent:${safeColor(agent.color)}" aria-current="${on ? 'true' : 'false'}">
      ${figureHTML(agent, { size: 'sm', caption: false })}
      <span class="agent-name">${esc(agent.name)}</span>
    </button>`;
  }).join('');
}

export function chatListHTML(agentId, activeChatId) {
  const chats = listAgentChats(agentId);
  if (!chats.length) return '<p class="muted empty-note">No chats yet.</p>';
  return chats.map((chat) => {
    const on = chat.id === activeChatId;
    return `<div class="chat-row${on ? ' active' : ''}">
      <button type="button" class="chat-select" data-act="select-chat" data-id="${esc(chat.id)}" aria-current="${on ? 'true' : 'false'}">${esc(chat.name || 'New chat')}</button>
      <button type="button" class="quiet" data-act="rename-chat" data-id="${esc(chat.id)}" aria-label="Rename chat">Rename</button>
      <button type="button" class="quiet" data-act="delete-chat" data-id="${esc(chat.id)}" aria-label="Delete chat">Delete</button>
    </div>`;
  }).join('');
}

export function chatHeadHTML(agent) {
  if (!agent) return '<div class="who"><h1>Agona</h1><p class="model-pill">Agora AI</p></div>';
  return `<div class="who">
    ${figureHTML(agent, { size: 'sm', caption: false })}
    <div>
      <h1>${esc(agent.name)}</h1>
      <p class="model-pill">Agora AI</p>
    </div>
  </div>`;
}

export function threadHTML(chat, agent) {
  const messages = chat?.messages || [];
  if (!messages.length) {
    return `<div class="welcome">
      ${agent ? figureHTML(agent, { size: 'md', caption: false }) : ''}
      <h2>${esc(agent?.name || 'Agona')}</h2>
      <p>Ask anything. Agora AI answers in your language, and questions can include links from the web.</p>
    </div>`;
  }
  return messages.map(messageHTML).join('');
}

export function settingsHTML() {
  const saved = !!readOpenRouterKey();
  const theme = state.settings.theme || 'dark';
  const option = (id, label) => `<option value="${id}" ${theme === id ? 'selected' : ''}>${label}</option>`;
  return `<h2 id="modal-title">Settings</h2>
    <p class="small muted">Chats stay in this browser. Agora AI is the only model here.</p>
    <form id="settings-form" autocomplete="off">
      <label for="theme">Theme</label>
      <select id="theme">${option('dark', 'Dark')}${option('light', 'Light')}${option('system', 'Match this device')}</select>
      <h2>Online connection</h2>
      <p class="warn-note">A key is optional. It stays only in this browser and is sent only to openrouter.ai. Do not type it on a shared computer.</p>
      <p>${saved ? 'A key is saved on this computer.' : 'No key yet. Agora AI can still search the web.'}</p>
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

export function welcomeHTML() {
  return `<h2 id="modal-title">Hi, this is Agona</h2>
    <p>Pick an agent on the left and start a chat. Agora AI answers in the language you write.</p>
    <p>Your chats stay on this computer. When a question needs the web, the reply includes links to the pages that were found.</p>
    <div class="row"><button type="button" data-act="welcome-ok">OK</button></div>`;
}

function plainBody(node) {
  return node?.textContent ?? '';
}

export function patchThread(chat) {
  const box = document.querySelector('#thread');
  if (!box || !chat) return false;
  const nodes = [...box.querySelectorAll('[data-mid]')];
  if (nodes.length !== chat.messages.length) return false;
  for (let i = 0; i < chat.messages.length; i++) {
    const message = chat.messages[i];
    if (nodes[i].dataset.mid !== message.id) return false;
    const body = nodes[i].querySelector('[data-body]');
    const next = message.content || (message.pending ? '…' : '');
    if (body && plainBody(body) !== next && message.role !== 'tool') body.textContent = next;
    const meta = nodes[i].querySelector('[data-meta]');
    if (meta && message.role === 'agent') {
      const phase = message.pending
        ? (String(message.content || '').startsWith('Looking up') ? 'looking up' : (String(message.content || '').startsWith('Getting Agora') ? 'getting ready' : 'writing'))
        : (message.error ? 'could not finish' : 'Agora AI');
      const agent = agentById(message.agentId);
      meta.textContent = `${agent?.name || 'Agent'} · ${phase}`;
    }
    nodes[i].classList.toggle('pending', !!message.pending);
    nodes[i].classList.toggle('error', !!message.error);
  }
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  if (near) box.scrollTop = box.scrollHeight;
  return true;
}

export function syncAgents() {
  if (typeof document === 'undefined') return;
  for (const agent of state.agents) {
    const name = viewState(agent);
    const label = STATE_LABEL[name] || 'Waiting';
    document.querySelectorAll(`[data-live-agent="${agent.id}"]`).forEach((el) => {
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
