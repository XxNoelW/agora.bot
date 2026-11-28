import { esc } from './text.js';
import { state } from './store.js';
import { memoryEnabled, cachedMemories } from './memory.js';
import { cachedRoutines, routineLabel } from './routines.js';
import { agentById } from './store.js';

export function memoryPanelHTML() {
  const on = memoryEnabled();
  const rows = cachedMemories();
  const chats = (state.chats || []).filter((chat) => chat && chat.messages).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const facts = rows.map((row) => `<li class="memory-row">
    <input data-memory="${esc(row.id)}" value="${esc(row.text)}" maxlength="240" aria-label="Memory">
    <span class="model-pill">${esc(row.kind)}</span>
    <button type="button" data-act="save-memory" data-id="${esc(row.id)}">Save</button>
    <button type="button" class="danger" data-act="delete-memory" data-id="${esc(row.id)}">Delete</button>
  </li>`).join('');
  const history = chats.slice(0, 40).map((chat) => {
    const who = chat.type === 'group' ? 'Group' : (agentById(chat.agentId)?.name || 'Agent');
    return `<li class="memory-row">
      <button type="button" data-act="open-history" data-id="${esc(chat.id)}">${esc(chat.name || 'New chat')}</button>
      <span class="small muted">${esc(who)}</span>
      <button type="button" class="quiet" data-act="rename-chat" data-id="${esc(chat.id)}">Rename</button>
      <button type="button" class="danger" data-act="delete-chat" data-id="${esc(chat.id)}">Delete</button>
    </li>`;
  }).join('');
  return `<h2 id="modal-title">Memory</h2>
    <p class="small">Agora 1.0 keeps these notes in this browser and adds only the relevant ones to a reply. Say “remember that …” or “forget …”.</p>
    <label class="checkline"><input id="memory-toggle" type="checkbox" ${on ? 'checked' : ''}> Remember</label>
    <form id="memory-add">
      <label for="memory-text">Add a note</label>
      <input id="memory-text" maxlength="240" placeholder="I like short answers">
      <button type="submit">Add</button>
    </form>
    <ul class="memory-list">${facts || '<li class="small muted">No notes yet.</li>'}</ul>
    <h2>Chats</h2>
    <label for="history-filter">Search chats</label>
    <input id="history-filter" type="search" placeholder="Search name or text" autocomplete="off">
    <ul class="memory-list" id="history-list">${history || '<li class="small muted">No chats yet.</li>'}</ul>
    <h2>Feedback</h2>
    <p class="small">Thumbs on an answer stay on this computer. Export downloads a file. Agora does not send it anywhere.</p>
    <button type="button" data-act="export-feedback">Export feedback</button>
    <div class="row"><button type="button" class="ghost" data-act="close-modal">Close</button></div>`;
}

export function routinesPanelHTML() {
  const rows = cachedRoutines();
  const items = rows.map((row) => `<li class="memory-row">
    <span><b>${esc(routineLabel(row))}</b> ${esc(row.text)}</span>
    <button type="button" class="danger" data-act="delete-routine" data-id="${esc(row.id)}">Delete</button>
  </li>`).join('');
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    .map((name, index) => `<option value="${index}">${name}</option>`).join('');
  return `<h2 id="modal-title">Routines</h2>
    <p class="warn-note">Routines run while Agora is open in this tab or the installed app. If Agora was closed, missed ones catch up the next time you open it. Routines that run while the browser is fully closed come later.</p>
    <form id="routine-add">
      <label for="routine-text">What should Agora do?</label>
      <input id="routine-text" maxlength="240" placeholder="tell me the weather" required>
      <label for="routine-kind">Repeat</label>
      <select id="routine-kind"><option value="daily">Every day</option><option value="weekly">Every week</option></select>
      <label for="routine-time">Time</label>
      <input id="routine-time" type="time" value="08:00" required>
      <label for="routine-day">Weekday</label>
      <select id="routine-day">${days}</select>
      <button type="submit">Save routine</button>
    </form>
    <p class="small">You can also say “every morning at 8 tell me the weather” or “remind me Friday 5pm”.</p>
    <ul class="memory-list">${items || '<li class="small muted">No routines yet.</li>'}</ul>
    <div class="row">
      <button type="button" data-act="notify-permission">Allow notifications</button>
      <button type="button" class="ghost" data-act="close-modal">Close</button>
    </div>`;
}

export function filterHistory(query) {
  const q = String(query || '').trim().toLowerCase();
  document.querySelectorAll('#history-list .memory-row').forEach((row) => {
    row.hidden = !!q && !(row.textContent || '').toLowerCase().includes(q);
  });
}
