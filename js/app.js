import { state, save, uid, agentById, MODELS, replaceAll, resetAll } from './store.js';
import { onStatus, status, loadModel, checkWebGPU, isReady } from './llm.js';
import { runConversation, settlePending } from './orchestrator.js';
import { execTool, normPath } from './tools.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = $('#view');
let gpu = { ok: false, reason: '', pending: true };
let gpuPromise = null;
let currentChatId = state.chats[0]?.id || null;
let running = null;
let currentFile = null;
let advTab = 'brain';

const TOOL_LABEL = {
  web_search: 'looked on the internet',
  read_page: 'read a page',
  fetch_wikipedia_page: 'read a Wikipedia page',
  write_file: 'saved a note',
  read_file: 'read a note',
  list_files: 'checked the notes',
  run_js: 'did some math',
};

function linkify(escaped) {
  return escaped
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s>])(https?:\/\/[^\s<]+)/g, (all, pre, url) => {
      const trail = url.match(/[.,)]+$/);
      const clean = trail ? url.slice(0, -trail[0].length) : url;
      return `${pre}<a href="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>${trail ? trail[0] : ''}`;
    });
}
const rich = (s) => linkify(esc(s));

function modal(html, onMount) {
  $('#modal-box').innerHTML = html;
  $('#modal').classList.remove('hidden');
  onMount?.($('#modal-box'));
}
const closeModal = () => $('#modal').classList.add('hidden');
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

function modelLabel(id) {
  return MODELS.find((m) => m.id === id)?.label || id;
}

onStatus((s) => {
  const pct = s.progress > 0 && s.progress < 1 ? Math.round(s.progress * 100) : 0;
  const el = $('#model-status');
  if (el) el.innerHTML = `${esc(s.text)}${pct ? `<div class="progress"><div style="width:${pct}%"></div></div>` : ''}`;
  const banner = $('#load-banner');
  if (banner) banner.innerHTML = bannerHTML();
});

function bannerHTML() {
  if (gpu.pending) return '<div class="banner">Checking whether this browser can run the AI friends…</div>';
  if (!gpu.ok) return `<div class="banner">${esc(gpu.reason)}</div>`;
  if (status.error) {
    return `<div class="banner"><b>${esc(status.text)}</b>${status.detail ? `<div class="small">${esc(status.detail)}</div>` : ''}
      <div class="row" style="margin-top:8px"><button data-act="load-model">Try again</button></div></div>`;
  }
  if (isReady(state.settings.model)) return '';
  const pct = status.progress > 0 && status.progress < 1
    ? `<div class="progress" role="progressbar" aria-valuenow="${Math.round(status.progress * 100)}" aria-valuemin="0" aria-valuemax="100"><div style="width:${Math.round(status.progress * 100)}%"></div></div>`
    : '';
  return `<div class="banner ok"><b>${esc(status.busy ? status.text : 'The helper brain runs on this computer.')}</b>
    <div class="small">${esc(modelLabel(state.settings.model))}. The first download can take a few minutes. After that it stays in this browser.</div>
    ${status.detail ? `<div class="small">${esc(status.detail)}</div>` : ''}${pct}
    <div class="row" style="margin-top:8px"><button data-act="load-model" ${status.busy ? 'disabled' : ''}>${status.busy ? 'Working…' : 'Load the helper'}</button></div></div>`;
}

document.addEventListener('click', (e) => {
  const button = e.target.closest('[data-act="load-model"]');
  if (!button || button.disabled) return;
  button.disabled = true;
  loadModel(state.settings.model).catch(() => {});
});

const routes = { chats: renderChats, agents: renderAgents, advanced: renderAdvanced };
function route() {
  const name = (location.hash.replace('#/', '') || 'chats').split('/')[0];
  if (name === 'computer') advTab = 'notes';
  if (name === 'keys') advTab = 'keys';
  if (name === 'usage') advTab = 'usage';
  if (name === 'settings') advTab = 'brain';
  const key = ['computer', 'keys', 'usage', 'settings', 'advanced'].includes(name) ? 'advanced' : name;
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === key));
  $('#sidebar').classList.remove('open');
  (routes[key] || renderChats)();
}
window.addEventListener('hashchange', route);
$('#menu-btn').onclick = () => $('#sidebar').classList.toggle('open');

function renderChats() {
  const chat = state.chats.find((c) => c.id === currentChatId) || state.chats[0];
  currentChatId = chat?.id || null;
  const together = chat && chat.type === 'group' && chat.agentIds.length > 1;
  view.innerHTML = `<div class="chat-layout">
    <div class="chat-list card">
      <div class="row" style="margin-bottom:10px"><button id="new-group">New group</button><button class="secondary" id="new-dm">One friend</button></div>
      ${state.chats.map((c) => `<div class="chat-item ${c.id === currentChatId ? 'active' : ''}" data-id="${c.id}">
        <div>${c.type === 'group' ? '👥' : esc(agentById(c.agentIds[0])?.emoji || '🙂')} ${esc(c.name)}</div>
        <div class="small muted">${c.agentIds.map((id) => esc(agentById(id)?.name || 'Missing friend')).join(', ') || 'No friends yet'}</div></div>`).join('') || '<div class="muted small">No chats yet.</div>'}
    </div>
    <div class="chat-main">${chat ? `
      <div class="chat-head row" style="justify-content:space-between">
        <div><b>${esc(chat.name)}</b><div class="small muted">${together ? 'Friends answer together, then they can reply to each other.' : 'A chat with one friend.'}</div></div>
        <div class="row"><button class="secondary" id="edit-chat">Edit</button><button class="secondary" id="clear-chat">Clear</button><button class="danger" id="del-chat">Delete</button></div>
      </div>
      <div id="load-banner" style="padding:12px 12px 0">${bannerHTML()}</div>
      <div class="messages" id="messages"></div>
      <div class="composer">
        <textarea id="input" placeholder="Type a message and press Enter"></textarea>
        <button id="send">Send</button><button class="danger" id="stop" style="display:none">Stop</button>
      </div>` : '<div style="padding:20px" class="muted">Make a chat to get started.</div>'}
    </div></div>`;
  view.querySelectorAll('.chat-item').forEach((el) => { el.onclick = () => { currentChatId = el.dataset.id; renderChats(); }; });
  $('#new-group').onclick = () => chatModal({ type: 'group' });
  $('#new-dm').onclick = () => chatModal({ type: 'dm' });
  if (!chat) return;
  renderMessages(chat);
  $('#edit-chat').onclick = () => chatModal(chat);
  $('#clear-chat').onclick = () => { if (confirm('Clear this chat?')) { chat.messages = []; save(); renderChats(); } };
  $('#del-chat').onclick = () => { if (confirm('Delete this chat?')) { state.chats = state.chats.filter((c) => c !== chat); currentChatId = state.chats[0]?.id; save(); renderChats(); } };
  const input = $('#input');
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(chat); } };
  $('#send').onclick = () => send(chat);
  $('#stop').onclick = () => running?.abort();
  view.querySelectorAll('[data-say]').forEach((button) => {
    button.onclick = () => send(chat, button.dataset.say);
  });
  setRunningUI(!!running && currentChatId === chat.id);
}

function setRunningUI(on) {
  const sendBtn = $('#send');
  const stopBtn = $('#stop');
  if (!sendBtn || !stopBtn) return;
  sendBtn.disabled = on;
  stopBtn.style.display = on ? '' : 'none';
}

function pendingLabel(m) {
  if (!m.pending) return '';
  if (m.toolCall && !m.answered) return ' · looking something up…';
  if (m.loading) return ' · getting ready…';
  return ' · writing…';
}

function msgHTML(m) {
  if (m.role === 'tool') {
    const who = agentById(m.agentId)?.name || 'A friend';
    return `<div class="msg tool"><div class="av">🔎</div><div class="stack"><div class="name">${esc(who)} ${esc(TOOL_LABEL[m.tool] || 'used a tool')}</div><div class="body">${rich(m.content)}</div></div></div>`;
  }
  if (m.role === 'user') return `<div class="msg user"><div class="av">🧑</div><div class="stack"><div class="body">${rich(m.content)}</div></div></div>`;
  const agent = agentById(m.agentId) || { name: 'Friend', emoji: '🙂' };
  const body = m.content ? rich(m.content) : (m.pending ? '…' : '');
  return `<div class="msg${m.pending ? ' pending' : ''}${m.error ? ' error' : ''}"><div class="av">${esc(agent.emoji)}</div><div class="stack"><div class="name">${esc(agent.name)}${pendingLabel(m)}</div><div class="body">${body}</div></div></div>`;
}

function waveCaption(chat, wave, react) {
  const names = [...new Set(chat.messages.filter((m) => m.wave === wave && m.role === 'agent').map((m) => agentById(m.agentId)?.name).filter(Boolean))];
  if (!names.length) return react ? 'Replying to each other' : 'Answering together';
  const who = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  if (react) return names.length > 1 ? `${who} reply to each other` : `${who} adds a thought`;
  return names.length > 1 ? `${who} are answering together` : `${who} is answering`;
}

function renderMessages(chat) {
  const box = $('#messages');
  if (!box) return;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  if (!chat.messages.length) {
    box.innerHTML = `<div class="welcome"><h2>Say hi</h2>
      <p>Your friends answer in this box. The first message downloads a helper brain. A bar shows how far along it is.</p>
      <div class="row"><button data-say="hi">Say hi</button><button class="secondary" data-say="How do bees make honey?">How do bees make honey?</button></div></div>`;
    box.querySelectorAll('[data-say]').forEach((button) => { button.onclick = () => send(chat, button.dataset.say); });
    return;
  }
  const multi = chat.type === 'group' && chat.agentIds.length > 1;
  let html = '';
  let lastWave = null;
  for (const message of chat.messages) {
    if (multi && message.wave && message.wave !== lastWave && message.role === 'agent') {
      html += `<div class="wave-label">${esc(waveCaption(chat, message.wave, message.react))}</div>`;
      lastWave = message.wave;
    }
    html += msgHTML(message);
  }
  box.innerHTML = html;
  if (nearBottom || running) box.scrollTop = box.scrollHeight;
}

let rafPending = false;
async function ensureGpu() {
  if (!gpu.pending) return gpu;
  gpu = { ...(await gpuPromise), pending: false };
  const banner = $('#load-banner');
  if (banner) banner.innerHTML = bannerHTML();
  if (!gpu.ok) $('#model-status').textContent = 'This browser cannot run the friends';
  return gpu;
}

async function send(chat, preset) {
  const input = $('#input');
  const text = String(preset ?? input?.value ?? '').trim();
  if (!text || running) return;
  if (input) input.value = '';
  await ensureGpu();
  chat.messages.push({ id: uid('m_'), role: 'user', content: text, ts: Date.now() });
  state.usage.userMessages++;
  save();
  if (!gpu.ok) {
    chat.messages.push({
      id: uid('m_'), role: 'agent', agentId: chat.agentIds[0], error: true,
      content: gpu.reason, answered: true, ts: Date.now(),
    });
    save();
    if (currentChatId === chat.id) renderMessages(chat);
    return;
  }
  running = new AbortController();
  const signal = running.signal;
  setRunningUI(true);
  renderMessages(chat);
  const onUpdate = () => {
    if (currentChatId !== chat.id) return;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; renderMessages(chat); });
  };
  try { await runConversation(chat, { onUpdate, signal }); }
  catch (e) {
    console.error(e);
    chat.messages.push({
      id: uid('m_'), role: 'agent', agentId: chat.agentIds[0], error: true, answered: true,
      content: e.friendly || e.message || 'Something went wrong. Please try again.', ts: Date.now(),
    });
  } finally {
    settlePending(chat.messages, { aborted: signal.aborted });
    running = null;
    save();
    if (currentChatId === chat.id && $('#messages')) { renderMessages(chat); setRunningUI(false); }
  }
}

function chatModal(chat) {
  const isNew = !chat.id;
  const isGroup = chat.type === 'group';
  if (!state.agents.length) { alert('Make a friend first.'); location.hash = '#/agents'; return; }
  modal(`<h2>${isNew ? 'New' : 'Edit'} ${isGroup ? 'group' : 'chat'}</h2>
    <p class="muted">A group lets friends answer together. A one-friend chat is just you and one friend.</p>
    <label>Name</label><input id="cn" value="${esc(chat.name || '')}" placeholder="${isGroup ? 'Group name' : 'Optional'}">
    <label>${isGroup ? 'Which friends?' : 'Which friend?'}</label><div class="checks">
    ${state.agents.map((a) => `<label><input type="${isGroup ? 'checkbox' : 'radio'}" name="ag" value="${a.id}" ${chat.agentIds?.includes(a.id) ? 'checked' : ''}> ${esc(a.emoji)} ${esc(a.name)}</label>`).join('')}</div>
    <div class="row" style="margin-top:16px"><button id="cs">Save</button><button class="secondary" id="cc">Cancel</button></div>`, (box) => {
    $('#cc', box).onclick = closeModal;
    $('#cs', box).onclick = () => {
      const ids = [...box.querySelectorAll('input[name=ag]:checked')].map((i) => i.value);
      if (!ids.length) return alert('Pick at least one friend.');
      if (!isGroup && ids.length > 1) ids.splice(1);
      const name = $('#cn', box).value.trim() || (isGroup ? 'Group' : agentById(ids[0]).name);
      if (isNew) {
        const created = { id: uid('c_'), name, type: chat.type, agentIds: ids, messages: [] };
        state.chats.unshift(created);
        currentChatId = created.id;
      } else Object.assign(chat, { name, agentIds: ids });
      save();
      closeModal();
      renderChats();
    };
  });
}

function renderAgents() {
  view.innerHTML = `<div class="row" style="justify-content:space-between;align-items:flex-end"><div><h1>Friends</h1><p class="lead">A friend is an AI buddy with a name and a personality.</p></div><button id="na">New friend</button></div>
  <div class="grid">${state.agents.map((a) => `<div class="card"><div style="font-size:36px">${esc(a.emoji)}</div><b>${esc(a.name)}</b>
    <p class="muted small" style="white-space:pre-wrap;max-height:90px;overflow:hidden">${esc(a.prompt)}</p>
    <div class="row"><button data-chat="${a.id}">Chat</button><button class="secondary" data-edit="${a.id}">Edit</button><button class="danger" data-del="${a.id}">Delete</button></div></div>`).join('')}</div>
  ${state.agents.length ? '' : '<p class="muted">No friends yet. Make one, then start a chat.</p>'}`;
  $('#na').onclick = () => agentModal({});
  view.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => agentModal(agentById(b.dataset.edit)); });
  view.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
    if (!confirm('Delete this friend?')) return;
    const id = b.dataset.del;
    state.agents = state.agents.filter((a) => a.id !== id);
    state.chats.forEach((c) => { c.agentIds = c.agentIds.filter((x) => x !== id); });
    save();
    renderAgents();
  });
  view.querySelectorAll('[data-chat]').forEach((b) => b.onclick = () => {
    let chat = state.chats.find((c) => c.type === 'dm' && c.agentIds.length === 1 && c.agentIds[0] === b.dataset.chat);
    if (!chat) {
      chat = { id: uid('c_'), name: agentById(b.dataset.chat).name, type: 'dm', agentIds: [b.dataset.chat], messages: [] };
      state.chats.unshift(chat);
      save();
    }
    currentChatId = chat.id;
    location.hash = '#/chats';
  });
}

function agentModal(agent) {
  const isNew = !agent.id;
  modal(`<h2>${isNew ? 'New friend' : 'Edit friend'}</h2>
    <div class="row"><div style="width:110px"><label>Picture</label><input id="ae" value="${esc(agent.emoji || '🙂')}" maxlength="8"></div><div style="flex:1"><label>Name</label><input id="an" value="${esc(agent.name || '')}" placeholder="Ada"></div></div>
    <label>What is this friend like?</label><textarea id="ap" rows="6">${esc(agent.prompt || 'You are a kind friend. You explain things in simple words and keep answers short.')}</textarea>
    <div class="row" style="margin-top:16px"><button id="as">Save</button><button class="secondary" id="ac">Cancel</button></div>`, (box) => {
    $('#ac', box).onclick = closeModal;
    $('#as', box).onclick = () => {
      const name = $('#an', box).value.trim();
      if (!name) return alert('Please add a name.');
      const data = { name, emoji: $('#ae', box).value.trim() || '🙂', prompt: $('#ap', box).value.trim() };
      if (isNew) state.agents.push({ id: uid('a_'), ...data });
      else Object.assign(agent, data);
      save();
      closeModal();
      renderAgents();
    };
  });
}

function advNav(active) {
  const items = [['brain', 'Helper brain'], ['notes', 'Shared notes'], ['keys', 'Script keys'], ['usage', 'Counters'], ['data', 'Save & reset']];
  return `<div class="row" style="margin:12px 0">${items.map(([id, label]) => `<button class="${id === active ? '' : 'secondary'}" data-adv="${id}">${label}</button>`).join('')}</div>`;
}
function bindAdv() {
  view.querySelectorAll('[data-adv]').forEach((button) => {
    button.onclick = () => { advTab = button.dataset.adv; renderAdvanced(); };
  });
}

function renderAdvanced() {
  if (advTab === 'notes') return renderComputer();
  if (advTab === 'keys') return renderKeys();
  if (advTab === 'usage') return renderUsage();
  if (advTab === 'data') return renderData();
  return renderBrain();
}

function renderBrain() {
  const s = state.settings;
  view.innerHTML = `<h1>Advanced</h1><p class="lead">You can ignore this page and just chat. These controls change the helper brain.</p>${advNav('brain')}
    <div class="card"><h2>Helper brain</h2><div id="load-banner">${bannerHTML()}</div>
      <label>Which helper?</label><select id="sm">${MODELS.map((m) => `<option value="${m.id}" ${m.id === s.model ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select>
      <p class="small muted">Super helper is the best at coding and using the web. If it will not load, pick Small helper.</p>
      <div class="row"><div style="flex:1"><label>Creativity (0 is steady, 1 is playful)</label><input id="st" type="number" step="0.1" min="0" max="2" value="${s.temperature}"></div>
      <div style="flex:1"><label>Longest reply</label><input id="sx" type="number" min="64" max="2048" value="${s.maxTokens}"></div>
      <div style="flex:1"><label>Group replies</label><select id="sr">${[1, 2, 3].map((n) => `<option value="${n}" ${n === +s.rounds ? 'selected' : ''}>${n === 1 ? '1 — answer only' : n === 2 ? '2 — answer, then react' : '3 — keep talking'}</option>`).join('')}</select></div></div>
      <div class="row" style="margin-top:12px"><button id="ss">Save</button></div></div>`;
  bindAdv();
  $('#ss').onclick = () => {
    const nextModel = $('#sm').value;
    Object.assign(s, {
      model: nextModel,
      temperature: +$('#st').value || 0.7,
      maxTokens: +$('#sx').value || 384,
      rounds: +$('#sr').value || 1,
      modelMigrated: true,
    });
    save();
    renderBrain();
  };
}

function renderComputer() {
  const files = Object.keys(state.files).sort();
  if (currentFile && !(currentFile in state.files)) currentFile = null;
  view.innerHTML = `<h1>Advanced</h1><p class="lead">Shared notes live in this browser. Friends can read and write them.</p>${advNav('notes')}
  <div class="fs">
    <div class="fs-list card"><div class="row" style="margin-bottom:8px"><button id="nf">New note</button></div>
      ${files.map((f) => `<div class="fs-file ${f === currentFile ? 'active' : ''}" data-f="${esc(f)}">📄 ${esc(f)}</div>`).join('') || '<div class="muted small">No notes yet</div>'}</div>
    <div class="fs-edit card">${currentFile ? `
      <div class="row" style="justify-content:space-between"><b class="mono">${esc(currentFile)}</b><div class="row"><button id="sf">Save</button><button class="danger" id="df">Delete</button></div></div>
      <textarea id="fc">${esc(state.files[currentFile])}</textarea>` : '<div class="muted">Pick a note, or make a new one.</div>'}
      <details class="advanced"><summary>Try JavaScript</summary>
        <p class="small muted">This runs in a little sandbox for 3 seconds. It cannot see the page. Friends can use the same tool.</p>
        <div class="row"><input id="js" placeholder="console.log(2 + 2)" class="mono" style="flex:1"><button id="rj">Run</button></div>
        <pre id="jout" class="mono small" style="white-space:pre-wrap"></pre>
      </details>
    </div></div>`;
  bindAdv();
  view.querySelectorAll('[data-f]').forEach((el) => { el.onclick = () => { currentFile = el.dataset.f; renderComputer(); }; });
  $('#nf').onclick = () => {
    const named = prompt('Note name', '/notes.txt');
    if (!named) return;
    const path = normPath(named);
    if (path === '/') return alert('Please add a file name, like /notes.txt');
    state.files[path] ??= '';
    currentFile = path;
    save();
    renderComputer();
  };
  $('#rj').onclick = async () => { $('#jout').textContent = 'Running…'; $('#jout').textContent = await execTool('run_js', { code: $('#js').value }); };
  if (!currentFile) return;
  $('#sf').onclick = () => { state.files[currentFile] = $('#fc').value; save(); };
  $('#df').onclick = () => { if (confirm('Delete this note?')) { delete state.files[currentFile]; currentFile = null; save(); renderComputer(); } };
}

function genKey() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return 'ak_' + [...bytes].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function renderKeys() {
  view.innerHTML = `<h1>Advanced</h1><p class="lead">You do not need a key to chat. Keys only let a script on this page talk to Agora.</p>${advNav('keys')}
  <div class="card small muted">Keys stay in this browser. They do not work from another website. There is no server.
  <pre class="mono">const ac = Agora.connect('ak_...');
ac.listAgents();
await ac.send(chatId, 'Hello!');</pre></div>
  <div class="row" style="margin-bottom:10px"><button id="nk">Make a key</button></div>
  <div class="card"><table><tr><th>Name</th><th>Key</th><th>Created</th><th></th></tr>
  ${state.keys.map((k) => `<tr><td>${esc(k.name)}</td><td><span class="key">${esc(k.key.slice(0, 10))}…${esc(k.key.slice(-4))}</span> <button class="secondary" data-copy="${k.key}">Copy</button></td><td class="small muted">${new Date(k.created).toLocaleString()}</td><td><button class="danger" data-rev="${k.key}">Remove</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">No keys.</td></tr>'}</table></div>`;
  bindAdv();
  $('#nk').onclick = () => {
    const name = prompt('Key name', 'My script');
    if (name === null) return;
    const key = genKey();
    state.keys.push({ name: name || 'key', key, created: Date.now() });
    save();
    renderKeys();
    navigator.clipboard?.writeText(key).catch(() => {});
    alert('New key (copied if the browser allowed it):\n' + key);
  };
  view.querySelectorAll('[data-copy]').forEach((b) => { b.onclick = () => navigator.clipboard?.writeText(b.dataset.copy).then(() => { b.textContent = 'Copied'; }); });
  view.querySelectorAll('[data-rev]').forEach((b) => b.onclick = () => {
    if (confirm('Remove this key?')) { state.keys = state.keys.filter((k) => k.key !== b.dataset.rev); save(); renderKeys(); }
  });
}

function renderUsage() {
  const u = state.usage;
  view.innerHTML = `<h1>Advanced</h1><p class="lead">Everything runs on your computer. There is no bill.</p>${advNav('usage')}
  <div class="grid">${[['Your messages', u.userMessages], ['Friend messages', u.agentMessages], ['Lookups and tools', u.toolCalls], ['Script calls', u.apiCalls], ['Friends', state.agents.length], ['Notes', Object.keys(state.files).length]]
    .map(([label, value]) => `<div class="card"><div class="muted small">${label}</div><div class="stat">${value}</div></div>`).join('')}</div>
  <button class="secondary" id="ru">Reset counters</button>`;
  bindAdv();
  $('#ru').onclick = () => { state.usage = { userMessages: 0, agentMessages: 0, toolCalls: 0, apiCalls: 0 }; save(); renderUsage(); };
}

function renderData() {
  view.innerHTML = `<h1>Advanced</h1><p class="lead">Save a copy of your friends and chats, or start fresh.</p>${advNav('data')}
    <div class="card"><div class="row"><button class="secondary" id="ex">Download a copy</button><label class="btn" style="margin:0">Load a copy<input type="file" id="im" accept="application/json" hidden></label><button class="danger" id="cl">Erase everything</button></div>
    <p class="small muted">The copy is a JSON file on your computer. Nothing is uploaded.</p></div>`;
  bindAdv();
  $('#ex').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
    a.download = 'agora-export.json';
    a.click();
  };
  $('#im').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || typeof data !== 'object' || !Array.isArray(data.agents)) throw new Error('That file is not an Agora copy.');
      replaceAll(data);
      currentChatId = state.chats[0]?.id;
      alert('Loaded.');
      renderData();
    } catch (err) { alert('Could not load that file: ' + err.message); }
  };
  $('#cl').onclick = () => {
    if (confirm('Erase all friends, chats, notes, and keys on this browser?')) {
      resetAll();
      currentChatId = state.chats[0]?.id;
      renderData();
    }
  };
}

window.Agora = {
  connect(key) {
    if (!state.keys.some((k) => k.key === key)) throw new Error('Invalid or revoked API key');
    const tick = () => { state.usage.apiCalls++; save(); };
    const ok = () => { if (!state.keys.some((k) => k.key === key)) throw new Error('API key revoked'); tick(); };
    return {
      listAgents: () => (ok(), state.agents.map(({ id, name, emoji }) => ({ id, name, emoji }))),
      listChats: () => (ok(), state.chats.map(({ id, name, type, agentIds }) => ({ id, name, type, agentIds }))),
      listFiles: () => (ok(), Object.keys(state.files)),
      readFile: async (path) => (ok(), execTool('read_file', { path })),
      writeFile: async (path, content) => (ok(), execTool('write_file', { path, content })),
      runJS: async (code) => (ok(), execTool('run_js', { code })),
      async send(chatId, text) {
        ok();
        const chat = state.chats.find((c) => c.id === chatId);
        if (!chat) throw new Error('chat not found');
        const check = await checkWebGPU();
        if (!check.ok) throw new Error(check.reason);
        chat.messages.push({ id: uid('m_'), role: 'user', content: String(text), ts: Date.now() });
        state.usage.userMessages++;
        save();
        const start = chat.messages.length;
        const ctl = new AbortController();
        await runConversation(chat, { onUpdate: () => currentChatId === chat.id && renderMessages(chat), signal: ctl.signal });
        settlePending(chat.messages, { aborted: ctl.signal.aborted });
        save();
        return chat.messages.slice(start).map((m) => ({ role: m.role, agent: agentById(m.agentId)?.name, content: m.content }));
      },
    };
  },
};

function showWelcome() {
  if (state.settings.welcomed) return;
  const done = () => {
    if (!state.settings.welcomed) { state.settings.welcomed = true; save(); }
    closeModal();
  };
  modal(`<h2>Welcome to Agora</h2>
    <p>This is a chat with AI friends. They run in this browser, on your computer. You do not need an account.</p>
    <p><b>1.</b> Type a message and press Send. Try saying hi.</p>
    <p><b>2.</b> The first time, your computer downloads a helper brain. A bar shows the progress. It can take a few minutes, then it is saved here.</p>
    <p><b>3.</b> In a group, friends answer together. Then they can reply to each other.</p>
    <p><b>4.</b> They can search the web and show you the links they used.</p>
    <div class="row" style="margin-top:16px"><button id="welcome-go">Start chatting</button></div>`, (box) => {
    $('#welcome-go', box).onclick = done;
  });
  const onBackdrop = (e) => {
    if (e.target.id !== 'modal') return;
    done();
    $('#modal').removeEventListener('click', onBackdrop);
  };
  $('#modal').addEventListener('click', onBackdrop);
}

route();
gpuPromise = checkWebGPU();
gpuPromise.then((result) => {
  gpu = { ...result, pending: false };
  if (!result.ok) $('#model-status').textContent = 'This browser cannot run the friends';
  const banner = $('#load-banner');
  if (banner) banner.innerHTML = bannerHTML();
});
showWelcome();
