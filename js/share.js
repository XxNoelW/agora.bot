import { esc } from './text.js';
import { cloudUrl } from './cloud.js';
import { voiceLang } from './voice.js';

export const SHARE_SITE = 'https://xxnoelw.github.io/agora.bot/';
export const SHARE_MAX = 256 * 1024;

function ui(en, hu) {
  return voiceLang() === 'hu' ? hu : en;
}

export function shareLink(id) {
  return `${SHARE_SITE}?share=${encodeURIComponent(id)}`;
}

export function snapshotFromChat(chat, nameOf = () => 'Agora 1.0') {
  const messages = [];
  for (const message of chat?.messages || []) {
    if (!message || message.pending) continue;
    if (message.role !== 'user' && message.role !== 'agent') continue;
    const content = String(message.content || '').trim();
    if (!content) continue;
    messages.push({
      role: message.role === 'agent' ? 'assistant' : 'user',
      name: message.role === 'agent' ? String(nameOf(message) || 'Agora 1.0').slice(0, 40) : '',
      content,
    });
  }
  return fitSnapshot({ title: chat?.name || 'Chat', messages });
}

export function fitSnapshot(snapshot, max = SHARE_MAX) {
  const title = String(snapshot?.title || 'Chat').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Chat';
  const messages = (snapshot?.messages || []).map((message) => ({
    role: message?.role === 'assistant' ? 'assistant' : 'user',
    name: message?.role === 'assistant' ? String(message.name || '').slice(0, 40) : '',
    content: String(message?.content || ''),
  })).filter((message) => message.content.trim());
  let trimmed = false;
  const size = () => new TextEncoder().encode(JSON.stringify({ title, messages })).length;
  while (messages.length > 1 && size() > max) {
    messages.shift();
    trimmed = true;
  }
  if (messages[0] && size() > max) {
    const overhead = size() - new TextEncoder().encode(messages[0].content).length;
    messages[0].content = messages[0].content.slice(0, Math.max(0, max - overhead - 16));
    trimmed = true;
  }
  return { title, messages, trimmed };
}

export function transcriptText(snapshot) {
  const you = ui('You', 'Te');
  const lines = [];
  if (snapshot?.title) lines.push(snapshot.title, '');
  for (const message of snapshot?.messages || []) {
    const who = message.role === 'assistant' ? (message.name || 'Agora 1.0') : you;
    lines.push(`${who}: ${message.content}`);
  }
  return lines.join('\n\n').trim();
}

export async function publishShare(snapshot, fetchImpl = fetch, base = cloudUrl()) {
  const res = await fetchImpl(`${base}/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: snapshot.title, messages: snapshot.messages }),
  });
  let data = {};
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) {
    const fallback = ui(
      'The link could not be created. You can still copy the chat.',
      'A link nem k\u00e9sz\u00fclt el. A cseveg\u00e9st \u00edgy is kim\u00e1solhatod.',
    );
    const error = res.status === 404 || res.status === 401 ? fallback : (data.error || fallback);
    return { ok: false, status: res.status, error };
  }
  return { ok: true, id: data.id, url: shareLink(data.id), trimmed: !!data.trimmed };
}

export async function fetchShare(id, fetchImpl = fetch, base = cloudUrl()) {
  const clean = String(id || '').trim().toUpperCase();
  if (!/^[A-Z2-7]{16}$/.test(clean)) {
    return { error: ui('That share link is not valid.', 'Ez a megoszt\u00e1si link nem \u00e9rv\u00e9nyes.') };
  }
  let res;
  try {
    res = await fetchImpl(`${base}/share/${clean}`);
  } catch {
    return { error: ui('The shared chat could not be opened.', 'A megosztott cseveg\u00e9st nem siker\u00fclt megnyitni.') };
  }
  let data = {};
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) {
    if (res.status === 404 || res.status === 401) {
      return { error: ui('That share was not found.', 'Ez a megoszt\u00e1s nem tal\u00e1lhat\u00f3.') };
    }
    return { error: data.error || ui('The shared chat could not be opened.', 'A megosztott cseveg\u00e9st nem siker\u00fclt megnyitni.') };
  }
  return {
    id: data.id || clean,
    title: data.title || 'Chat',
    messages: Array.isArray(data.messages) ? data.messages : [],
    created: data.created || 0,
  };
}

export function shareDialogHTML(snapshot, result) {
  const textNote = snapshot?.trimmed
    ? `<p class="small">${esc(ui('Older messages were left out so the link stays small.', 'A r\u00e9gebbi \u00fczenetek kimaradtak, hogy a link kicsi maradjon.'))}</p>`
    : '';
  if (!result) {
    return `<h2 id="modal-title">${esc(ui('Share', 'Megoszt\u00e1s'))}</h2>
      <p>${esc(ui('Creating a read-only link…', 'Olvas\u00e1si link k\u00e9sz\u00fcl…'))}</p>
      ${textNote}
      <div class="row"><button type="button" data-act="copy-transcript">${esc(ui('Copy as text', 'M\u00e1sol\u00e1s sz\u00f6vegk\u00e9nt'))}</button></div>`;
  }
  if (!result.ok) {
    return `<h2 id="modal-title">${esc(ui('Share', 'Megoszt\u00e1s'))}</h2>
      <p>${esc(result.error || ui('The link could not be created. You can still copy the chat.', 'A link nem k\u00e9sz\u00fclt el. A cseveg\u00e9st \u00edgy is kim\u00e1solhatod.'))}</p>
      ${textNote}
      <div class="row">
        <button type="button" data-act="copy-transcript">${esc(ui('Copy as text', 'M\u00e1sol\u00e1s sz\u00f6vegk\u00e9nt'))}</button>
        <button type="button" class="ghost" data-act="close-modal">${esc(ui('Close', 'Bez\u00e1r\u00e1s'))}</button>
      </div>`;
  }
  return `<h2 id="modal-title">${esc(ui('Share', 'Megoszt\u00e1s'))}</h2>
    <p class="small">${esc(ui('Anyone with this link can read the chat. It does not include keys.', 'Aki megkapja a linket, elolvashatja a cseveg\u00e9st. Kulcs nincs benne.'))}</p>
    <label for="share-url">${esc(ui('Link', 'Link'))}</label>
    <input id="share-url" readonly value="${esc(result.url || '')}">
    ${textNote}
    <div class="row">
      <button type="button" data-act="copy-share-link">${esc(ui('Copy link', 'Link m\u00e1sol\u00e1sa'))}</button>
      <button type="button" class="ghost" data-act="copy-transcript">${esc(ui('Copy as text', 'M\u00e1sol\u00e1s sz\u00f6vegk\u00e9nt'))}</button>
      <button type="button" class="ghost" data-act="close-modal">${esc(ui('Close', 'Bez\u00e1r\u00e1s'))}</button>
    </div>`;
}

export function sharedThreadHTML(snapshot) {
  if (!snapshot) return '';
  if (snapshot.loading) {
    return `<div class="welcome"><h2>${esc(ui('Shared chat', 'Megosztott cseveg\u00e9s'))}</h2><p>${esc(ui('Opening the shared chat…', 'A megosztott cseveg\u00e9s ny\u00edlik…'))}</p></div>`;
  }
  if (snapshot.error) {
    return `<div class="welcome"><h2>${esc(ui('This link did not open', 'Ez a link nem ny\u00edlt meg'))}</h2><p>${esc(snapshot.error)}</p></div>`;
  }
  const messages = snapshot.messages || [];
  if (!messages.length) {
    return `<div class="welcome"><h2>${esc(snapshot.title || 'Chat')}</h2><p>${esc(ui('This chat is empty.', 'Ez a cseveg\u00e9s \u00fcres.'))}</p></div>`;
  }
  return messages.map((message) => {
    const mine = message.role !== 'assistant';
    const who = mine ? ui('You', 'Te') : (message.name || 'Agora 1.0');
    return `<div class="bubble-row${mine ? ' user' : ''}"><div class="bubble"><div class="meta">${esc(who)}</div><div class="text">${esc(message.content || '')}</div></div></div>`;
  }).join('');
}
