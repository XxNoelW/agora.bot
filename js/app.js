import { state, save, uid, agentById, MODELS, replaceAll, resetAll } from './store.js';
import { onStatus, status, loadModel, checkWebGPU, isReady } from './llm.js';
import { runConversation } from './orchestrator.js';
import { execTool, TOOLS } from './tools.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = $('#view');
let gpu = { ok: true, reason: '' };
let currentChatId = state.chats[0]?.id || null;
let running = null; // AbortController
let currentFile = null;

// ---------- modal ----------
function modal(html, onMount) {
  $('#modal-box').innerHTML = html; $('#modal').classList.remove('hidden'); onMount?.($('#modal-box'));
}
const closeModal = () => $('#modal').classList.add('hidden');
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

// ---------- model status ----------
onStatus((s) => {
  $('#model-status').innerHTML = `${esc(s.text)}${s.progress > 0 && s.progress < 1 ? `<div class="progress"><div style="width:${(s.progress * 100).toFixed(0)}%"></div></div>` : ''}`;
  const b = $('#load-banner'); if (b) b.innerHTML = bannerHTML();
});
function bannerHTML() {
  if (!gpu.ok) return `<div class="banner">⚠️ ${esc(gpu.reason)} You can still manage agents, files, keys and settings; chat replies need WebGPU.</div>`;
  if (isReady(state.settings.model)) return '';
  return `<div class="banner ok">Model <b>${esc(state.settings.model)}</b> runs fully in your browser. First load downloads weights (cached afterwards). <button class="secondary" data-act="load-model">Load model</button>
  <div class="small">${esc(status.text)}</div>${status.progress > 0 && status.progress < 1 ? `<div class="progress"><div style="width:${(status.progress * 100).toFixed(0)}%"></div></div>` : ''}</div>`;
}
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-act="load-model"]')) loadModel(state.settings.model).catch(() => {});
});

// ---------- router ----------
const routes = { chats: renderChats, agents: renderAgents, computer: renderComputer, keys: renderKeys, usage: renderUsage, settings: renderSettings };
function route() {
  const r = (location.hash.replace('#/', '') || 'chats').split('/')[0];
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === r));
  $('#sidebar').classList.remove('open');
  (routes[r] || renderChats)();
}
window.addEventListener('hashchange', route);
$('#menu-btn').onclick = () => $('#sidebar').classList.toggle('open');

// ---------- chats ----------
function renderChats() {
  const chat = state.chats.find((c) => c.id === currentChatId) || state.chats[0];
  currentChatId = chat?.id || null;
  view.innerHTML = `<div class="chat-layout">
    <div class="chat-list card">
      <div class="row" style="margin-bottom:10px"><button id="new-group">+ Group</button><button class="secondary" id="new-dm">+ 1:1</button></div>
      ${state.chats.map((c) => `<div class="chat-item ${c.id === currentChatId ? 'active' : ''}" data-id="${c.id}">
        <div>${c.type === 'group' ? '👥' : esc(agentById(c.agentIds[0])?.emoji || '🤖')} ${esc(c.name)}</div>
        <div class="small muted">${c.agentIds.map((id) => esc(agentById(id)?.name || '?')).join(', ')}</div></div>`).join('') || '<div class="muted small">No chats yet.</div>'}
    </div>
    <div class="chat-main">${chat ? `
      <div class="chat-head row" style="justify-content:space-between">
        <div><b>${esc(chat.name)}</b> <span class="muted small">${chat.type === 'group' ? `group · ${state.settings.rounds} round(s) of replies` : '1:1'}</span></div>
        <div class="row"><button class="secondary" id="edit-chat">Edit</button><button class="secondary" id="clear-chat">Clear</button><button class="danger" id="del-chat">Delete</button></div>
      </div>
      <div id="load-banner" style="padding:0 12px">${bannerHTML()}</div>
      <div class="messages" id="messages"></div>
      <div class="composer">
        <textarea id="input" placeholder="Message ${esc(chat.name)}… (Enter to send, Shift+Enter newline)"></textarea>
        <button id="send">Send</button><button class="danger hidden" id="stop" style="display:none">Stop</button>
      </div>` : '<div style="padding:20px" class="muted">Create a chat to get started.</div>'}
    </div></div>`;
  view.querySelectorAll('.chat-item').forEach((el) => el.onclick = () => { currentChatId = el.dataset.id; renderChats(); });
  $('#new-group').onclick = () => chatModal({ type: 'group' });
  $('#new-dm').onclick = () => chatModal({ type: 'dm' });
  if (!chat) return;
  renderMessages(chat);
  $('#edit-chat').onclick = () => chatModal(chat);
  $('#clear-chat').onclick = () => { if (confirm('Clear messages?')) { chat.messages = []; save(); renderChats(); } };
  $('#del-chat').onclick = () => { if (confirm('Delete chat?')) { state.chats = state.chats.filter((c) => c !== chat); currentChatId = state.chats[0]?.id; save(); renderChats(); } };
  const input = $('#input');
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(chat); } };
  $('#send').onclick = () => send(chat);
  $('#stop').onclick = () => running?.abort();
  setRunningUI(!!running);
}

function setRunningUI(on) {
  const s = $('#send'), st = $('#stop'); if (!s) return;
  s.disabled = on; st.style.display = on ? '' : 'none';
}

function msgHTML(m) {
  if (m.role === 'tool') return `<div class="msg tool"><div class="av">🛠️</div><div class="body">${esc(agentById(m.agentId)?.name || 'Agent')} → ${esc(m.tool)}(${esc(JSON.stringify(m.args ?? {}))})\n${esc(m.content)}</div></div>`;
  if (m.role === 'user') return `<div class="msg user"><div class="av">🧑</div><div><div class="body">${esc(m.content)}</div></div></div>`;
  const a = agentById(m.agentId) || { name: 'Deleted agent', emoji: '❔' };
  return `<div class="msg"><div class="av">${esc(a.emoji)}</div><div style="min-width:0"><div class="name">${esc(a.name)}${m.toolCall ? ` · uses ${esc(m.toolCall)}` : ''}${m.pending ? ' · typing…' : ''}</div><div class="body">${esc(m.content || '…')}</div></div></div>`;
}

function renderMessages(chat) {
  const box = $('#messages'); if (!box) return;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.innerHTML = chat.messages.map(msgHTML).join('') || '<div class="muted">No messages yet. Say hi!</div>';
  if (nearBottom || running) box.scrollTop = box.scrollHeight;
}

let rafPending = false;
async function send(chat) {
  const input = $('#input'); const text = input.value.trim();
  if (!text || running) return;
  if (!gpu.ok) { alert(gpu.reason); return; }
  input.value = '';
  chat.messages.push({ id: uid('m_'), role: 'user', content: text, ts: Date.now() });
  state.usage.userMessages++; save();
  running = new AbortController(); setRunningUI(true); renderMessages(chat);
  const onUpdate = (streaming) => {
    if (currentChatId !== chat.id) return;
    if (streaming) { if (rafPending) return; rafPending = true; requestAnimationFrame(() => { rafPending = false; renderMessages(chat); }); }
    else renderMessages(chat);
  };
  try { await runConversation(chat, { onUpdate, signal: running.signal }); }
  catch (e) { console.error(e); }
  finally {
    chat.messages.forEach((m) => { if (m.pending) { m.pending = false; if (!m.content) m.content = '(stopped)'; } });
    running = null; save(); if (currentChatId === chat.id && $('#messages')) { renderMessages(chat); setRunningUI(false); }
  }
}

function chatModal(chat) {
  const isNew = !chat.id; const isGroup = chat.type === 'group';
  if (!state.agents.length) { alert('Create an agent first.'); location.hash = '#/agents'; return; }
  modal(`<h2>${isNew ? 'New' : 'Edit'} ${isGroup ? 'group chat' : '1:1 chat'}</h2>
    <label>Name</label><input id="cn" value="${esc(chat.name || '')}" placeholder="${isGroup ? 'Group name' : 'Optional'}">
    <label>${isGroup ? 'Agents' : 'Agent'}</label><div class="checks">
    ${state.agents.map((a) => `<label><input type="${isGroup ? 'checkbox' : 'radio'}" name="ag" value="${a.id}" ${chat.agentIds?.includes(a.id) ? 'checked' : ''}> ${esc(a.emoji)} ${esc(a.name)}</label>`).join('')}</div>
    <div class="row" style="margin-top:16px"><button id="cs">Save</button><button class="secondary" id="cc">Cancel</button></div>`, (b) => {
    $('#cc', b).onclick = closeModal;
    $('#cs', b).onclick = () => {
      const ids = [...b.querySelectorAll('input[name=ag]:checked')].map((i) => i.value);
      if (!ids.length) return alert('Pick at least one agent.');
      const name = $('#cn', b).value.trim() || (isGroup ? 'Group' : agentById(ids[0]).name);
      if (isNew) { const c = { id: uid('c_'), name, type: chat.type, agentIds: ids, messages: [] }; state.chats.unshift(c); currentChatId = c.id; }
      else Object.assign(chat, { name, agentIds: ids });
      save(); closeModal(); renderChats();
    };
  });
}

// ---------- agents ----------
function renderAgents() {
  view.innerHTML = `<div class="row" style="justify-content:space-between"><h1>Agents</h1><button id="na">+ New agent</button></div>
  <div class="grid">${state.agents.map((a) => `<div class="card"><div style="font-size:30px">${esc(a.emoji)}</div><b>${esc(a.name)}</b>
    <p class="muted small" style="white-space:pre-wrap;max-height:90px;overflow:hidden">${esc(a.prompt)}</p>
    <div class="row"><button class="secondary" data-chat="${a.id}">Chat</button><button class="secondary" data-edit="${a.id}">Edit</button><button class="danger" data-del="${a.id}">Delete</button></div></div>`).join('')}</div>
  ${state.agents.length ? '' : '<p class="muted">No agents yet.</p>'}`;
  $('#na').onclick = () => agentModal({});
  view.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => agentModal(agentById(b.dataset.edit)));
  view.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
    if (!confirm('Delete agent?')) return;
    const id = b.dataset.del; state.agents = state.agents.filter((a) => a.id !== id);
    state.chats.forEach((c) => c.agentIds = c.agentIds.filter((x) => x !== id));
    save(); renderAgents();
  });
  view.querySelectorAll('[data-chat]').forEach((b) => b.onclick = () => {
    let c = state.chats.find((c) => c.type === 'dm' && c.agentIds[0] === b.dataset.chat);
    if (!c) { c = { id: uid('c_'), name: agentById(b.dataset.chat).name, type: 'dm', agentIds: [b.dataset.chat], messages: [] }; state.chats.unshift(c); save(); }
    currentChatId = c.id; location.hash = '#/chats';
  });
}
function agentModal(a) {
  const isNew = !a.id;
  modal(`<h2>${isNew ? 'New' : 'Edit'} agent</h2>
    <div class="row"><div style="width:80px"><label>Avatar</label><input id="ae" value="${esc(a.emoji || '🤖')}" maxlength="4"></div><div style="flex:1"><label>Name</label><input id="an" value="${esc(a.name || '')}"></div></div>
    <label>System prompt / personality</label><textarea id="ap" rows="7">${esc(a.prompt || 'You are a helpful, friendly assistant.')}</textarea>
    <div class="row" style="margin-top:16px"><button id="as">Save</button><button class="secondary" id="ac">Cancel</button></div>`, (b) => {
    $('#ac', b).onclick = closeModal;
    $('#as', b).onclick = () => {
      const name = $('#an', b).value.trim(); if (!name) return alert('Name required');
      const data = { name, emoji: $('#ae', b).value.trim() || '🤖', prompt: $('#ap', b).value.trim() };
      if (isNew) state.agents.push({ id: uid('a_'), ...data }); else Object.assign(a, data);
      save(); closeModal(); renderAgents();
    };
  });
}

// ---------- computer ----------
function renderComputer() {
  const files = Object.keys(state.files).sort();
  if (currentFile && !(currentFile in state.files)) currentFile = null;
  view.innerHTML = `<h1>Shared Computer</h1><p class="muted">A virtual machine shared by all agents. Files live in localStorage. Agents use tools: ${Object.keys(TOOLS).map((t) => `<code>${t}</code>`).join(', ')}.</p>
  <div class="fs">
    <div class="fs-list card"><div class="row" style="margin-bottom:8px"><button id="nf">+ File</button></div>
      ${files.map((f) => `<div class="fs-file ${f === currentFile ? 'active' : ''}" data-f="${esc(f)}">📄 ${esc(f)}</div>`).join('') || '<div class="muted small">Empty</div>'}</div>
    <div class="fs-edit card">${currentFile ? `
      <div class="row" style="justify-content:space-between"><b class="mono">${esc(currentFile)}</b><div class="row"><button id="sf">Save</button><button class="secondary" id="rf">Run as JS</button><button class="danger" id="df">Delete</button></div></div>
      <textarea id="fc">${esc(state.files[currentFile])}</textarea><pre id="out" class="mono small muted" style="white-space:pre-wrap"></pre>` : '<div class="muted">Select a file.</div>'}
      <h2>Terminal (run_js)</h2><div class="row"><input id="js" placeholder="console.log([1,2,3].map(x=>x*2))" class="mono" style="flex:1"><button id="rj">Run</button></div><pre id="jout" class="mono small" style="white-space:pre-wrap"></pre>
    </div></div>`;
  view.querySelectorAll('[data-f]').forEach((el) => el.onclick = () => { currentFile = el.dataset.f; renderComputer(); });
  $('#nf').onclick = () => { let p = prompt('File path', '/notes.md'); if (!p) return; if (!p.startsWith('/')) p = '/' + p; state.files[p] ??= ''; currentFile = p; save(); renderComputer(); };
  $('#rj').onclick = async () => { $('#jout').textContent = 'running…'; $('#jout').textContent = await execTool('run_js', { code: $('#js').value }); };
  if (!currentFile) return;
  $('#sf').onclick = () => { state.files[currentFile] = $('#fc').value; save(); $('#out').textContent = 'Saved.'; };
  $('#df').onclick = () => { if (confirm('Delete file?')) { delete state.files[currentFile]; currentFile = null; save(); renderComputer(); } };
  $('#rf').onclick = async () => { $('#out').textContent = 'running…'; $('#out').textContent = await execTool('run_js', { code: $('#fc').value }); };
}

// ---------- API keys ----------
function genKey() { const b = new Uint8Array(24); crypto.getRandomValues(b); return 'ak_' + [...b].map((x) => x.toString(16).padStart(2, '0')).join(''); }
function renderKeys() {
  view.innerHTML = `<div class="row" style="justify-content:space-between"><h1>API Keys</h1><button id="nk">+ Generate key</button></div>
  <div class="card small muted">Keys are generated and stored locally in this browser. They work <b>within this site only</b> via a JS API — e.g. from the browser console or a script on this page:
  <pre class="mono">const ac = Agora.connect('ak_...');
ac.listAgents();
await ac.writeFile('/hello.txt', 'hi');
await ac.send(chatId, 'Hello agents!'); // requires loaded model</pre>There is no remote server; keys cannot be used from other origins.</div>
  <div class="card"><table><tr><th>Name</th><th>Key</th><th>Created</th><th></th></tr>
  ${state.keys.map((k) => `<tr><td>${esc(k.name)}</td><td><span class="key">${esc(k.key.slice(0, 10))}…${esc(k.key.slice(-4))}</span> <button class="secondary" data-copy="${k.key}">Copy</button></td><td class="small muted">${new Date(k.created).toLocaleString()}</td><td><button class="danger" data-rev="${k.key}">Revoke</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">No keys.</td></tr>'}</table></div>`;
  $('#nk').onclick = () => { const name = prompt('Key name', 'My integration'); if (name === null) return; const key = genKey(); state.keys.push({ name: name || 'key', key, created: Date.now() }); save(); renderKeys(); navigator.clipboard?.writeText(key).catch(() => {}); alert('New key (copied to clipboard):\n' + key); };
  view.querySelectorAll('[data-copy]').forEach((b) => b.onclick = () => navigator.clipboard?.writeText(b.dataset.copy).then(() => b.textContent = 'Copied'));
  view.querySelectorAll('[data-rev]').forEach((b) => b.onclick = () => { if (confirm('Revoke key?')) { state.keys = state.keys.filter((k) => k.key !== b.dataset.rev); save(); renderKeys(); } });
}

// ---------- usage ----------
function renderUsage() {
  const u = state.usage;
  view.innerHTML = `<h1>Usage</h1><div class="card"><div class="muted small">Plan</div><div class="stat">Unlimited ♾️</div><div class="muted small">All inference runs locally on your GPU — no quotas, no billing.</div></div>
  <div class="grid">${[['User messages', u.userMessages], ['Agent messages', u.agentMessages], ['Tool calls', u.toolCalls], ['API calls', u.apiCalls], ['Agents', state.agents.length], ['Files', Object.keys(state.files).length]]
    .map(([l, v]) => `<div class="card"><div class="muted small">${l}</div><div class="stat">${v}</div><div class="small muted">of Unlimited</div></div>`).join('')}</div>
  <button class="secondary" id="ru">Reset counters</button>`;
  $('#ru').onclick = () => { state.usage = { userMessages: 0, agentMessages: 0, toolCalls: 0, apiCalls: 0 }; save(); renderUsage(); };
}

// ---------- settings ----------
function renderSettings() {
  const s = state.settings;
  view.innerHTML = `<h1>Settings</h1>
  <div class="card"><h2>Model</h2><div id="load-banner">${bannerHTML()}</div>
    <label>WebLLM model</label><select id="sm">${MODELS.map((m) => `<option value="${m.id}" ${m.id === s.model ? 'selected' : ''}>${m.label}</option>`).join('')}</select>
    <div class="row"><div style="flex:1"><label>Temperature</label><input id="st" type="number" step="0.1" min="0" max="2" value="${s.temperature}"></div>
    <div style="flex:1"><label>Max tokens per reply</label><input id="sx" type="number" min="64" max="2048" value="${s.maxTokens}"></div>
    <div style="flex:1"><label>Agent-to-agent rounds (groups)</label><select id="sr">${[1, 2, 3].map((n) => `<option ${n == s.rounds ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>
    <div class="row" style="margin-top:12px"><button id="ss">Save settings</button></div></div>
  <div class="card"><h2>Data</h2><div class="row"><button class="secondary" id="ex">Export JSON</button><label class="btn" style="margin:0;color:#fff">Import JSON<input type="file" id="im" accept="application/json" hidden></label><button class="danger" id="cl">Clear all data</button></div></div>`;
  $('#ss').onclick = () => { Object.assign(s, { model: $('#sm').value, temperature: +$('#st').value || 0.7, maxTokens: +$('#sx').value || 512, rounds: +$('#sr').value }); save(); renderSettings(); };
  $('#ex').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })); a.download = 'agent-cloud-export.json'; a.click(); };
  $('#im').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { const d = JSON.parse(await f.text()); if (!d || typeof d !== 'object' || !Array.isArray(d.agents)) throw new Error('Not an Agora export'); replaceAll(d); currentChatId = state.chats[0]?.id; alert('Imported.'); renderSettings(); } catch (err) { alert('Import failed: ' + err.message); } };
  $('#cl').onclick = () => { if (confirm('Delete ALL agents, chats, files and keys?')) { resetAll(); currentChatId = state.chats[0]?.id; renderSettings(); } };
}

// ---------- public JS API ----------
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
        ok(); const chat = state.chats.find((c) => c.id === chatId); if (!chat) throw new Error('chat not found');
        chat.messages.push({ id: uid('m_'), role: 'user', content: String(text), ts: Date.now() }); state.usage.userMessages++; save();
        const n = chat.messages.length; const ctl = new AbortController();
        await runConversation(chat, { onUpdate: () => currentChatId === chat.id && renderMessages(chat), signal: ctl.signal });
        save(); return chat.messages.slice(n).map((m) => ({ role: m.role, agent: agentById(m.agentId)?.name, content: m.content }));
      },
    };
  },
};

// ---------- boot ----------
route();
checkWebGPU().then((r) => { gpu = r; if (!r.ok) $('#model-status').textContent = '⚠️ WebGPU unavailable'; const b = $('#load-banner'); if (b) b.innerHTML = bannerHTML(); });
