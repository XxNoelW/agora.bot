// Small pages Agora can build inside the chat. The frame cannot read the parent page.
import { state, save, uid } from './store.js';
import { esc } from './text.js';

const PAGE_CAP = 12;
const HTML_CAP = 20000;
const VERSION_CAP = 12;

export function cleanPageHtml(html) {
  return String(html || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, HTML_CAP);
}

export function pageSrcDoc(html) {
  const body = cleanPageHtml(html);
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:;"></head><body>${body}</body></html>`;
}

export function pageFrameHTML(html, title = 'Page') {
  const doc = esc(pageSrcDoc(html));
  return `<iframe class="page-frame" title="${esc(title)}" sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${doc}"></iframe>`;
}

function pages() {
  if (!Array.isArray(state.settings.pages)) state.settings.pages = [];
  return state.settings.pages;
}

export function listPages() {
  return pages().slice();
}

export function pageById(id) {
  return pages().find((page) => page.id === id) || null;
}

export function createPage({ title, html, chatId } = {}) {
  const page = {
    id: uid('p_'),
    title: String(title || 'Page').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Page',
    html: cleanPageHtml(html),
    chatId: String(chatId || ''),
    versions: [],
    updated: Date.now(),
  };
  const list = pages();
  list.unshift(page);
  if (list.length > PAGE_CAP) list.length = PAGE_CAP;
  save();
  return page;
}

export function updatePage(id, { title, html } = {}) {
  const page = pageById(id);
  if (!page) return null;
  page.versions = [{ html: page.html, title: page.title, at: page.updated }, ...(page.versions || [])].slice(0, VERSION_CAP);
  if (typeof title === 'string' && title.trim()) page.title = title.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (typeof html === 'string') page.html = cleanPageHtml(html);
  page.updated = Date.now();
  save();
  return page;
}

export function restorePage(id, index) {
  const page = pageById(id);
  const version = page?.versions?.[index];
  if (!version) return null;
  return updatePage(id, { title: version.title, html: version.html });
}
