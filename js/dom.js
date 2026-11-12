import { esc } from './text.js';

export const $ = (sel, root = document) => root.querySelector(sel);

let onDismiss = null;

export function closeModal() {
  const modal = $('#modal');
  if (!modal) return;
  modal.classList.add('hidden');
  $('#modal-box').innerHTML = '';
  document.body.classList.remove('modal-open');
  onDismiss = null;
}

export function openModal(html, onMount, dismiss) {
  const modal = $('#modal');
  const box = $('#modal-box');
  box.innerHTML = html;
  modal.classList.remove('hidden');
  document.body.classList.add('modal-open');
  onDismiss = dismiss || null;
  onMount?.(box);
  const focus = box.querySelector('[data-ok], button, input, textarea, select');
  focus?.focus();
}

export function confirm({ title, text, ok = 'Megerősítem', cancel = 'Mégse', danger = false, extra = '' }) {
  const previous = document.activeElement;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      closeModal();
      resolve(value);
      if (previous && typeof previous.focus === 'function') previous.focus();
    };
    openModal(`<h2 id="modal-title">${esc(title)}</h2><p id="modal-text">${esc(text)}</p>${extra}<div class="row modal-actions"><button type="button" data-ok class="${danger ? 'danger' : ''}">${esc(ok)}</button><button type="button" data-cancel class="ghost">${esc(cancel)}</button></div>`, (box) => {
      box.querySelector('[data-ok]').onclick = () => finish(true);
      box.querySelector('[data-cancel]').onclick = () => finish(false);
    }, () => finish(false));
  });
}

document.addEventListener('click', (event) => {
  if (event.target?.id === 'modal') onDismiss?.();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('#modal')?.classList.contains('hidden')) onDismiss?.();
});

export function toast(text) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 3400);
}

export function announce(text) {
  const live = $('#live');
  if (!live || !text) return;
  live.textContent = '';
  live.textContent = text;
}
