import { esc } from './text.js';
import { altText, viewState, STATE_LABEL } from './roles.js';

const ACCESSORIES = {
  clipboard: `<g transform="translate(58 46)"><rect x="0" y="0" width="16" height="18" rx="2.5" fill="#FFF6E8" stroke="#1a1a1a" stroke-width="1.2"/><rect x="4.5" y="-3" width="7" height="4" rx="1" fill="#1a1a1a"/><path d="M3 7h10M3 11h7" stroke="#1a1a1a" stroke-width="1.2" stroke-linecap="round"/></g>`,
  glass: `<g transform="translate(58 14)" fill="none" stroke="#1a1a1a" stroke-width="1.7" stroke-linecap="round"><circle cx="7" cy="7" r="6"/><path d="M11.5 11.5 L16 16"/></g>`,
  glasses: `<g fill="none" stroke="#1a1a1a" stroke-width="1.5"><circle cx="37" cy="33" r="6.2"/><circle cx="51" cy="33" r="6.2"/><path d="M43.2 33h1.6" stroke-linecap="round"/></g>`,
  book: `<g transform="translate(56 48)" stroke="#1a1a1a" stroke-width="1.1" fill="#FFF6E8"><path d="M1 2h8v14H1z"/><path d="M9 2h8v14H9z"/></g>`,
  gavel: `<g transform="translate(60 12)" fill="#1a1a1a"><rect x="1" y="0" width="14" height="6" rx="1.5"/><rect x="6.2" y="6" width="2.4" height="11" rx="1"/></g>`,
  spark: `<path transform="translate(60 12)" fill="#1a1a1a" d="M8 0l1.4 5.2L15 8l-5.6 1.4L8 15l-1.4-5.6L1 8l5.6-1.4z"/>`,
  cap: `<g transform="translate(26 8)" fill="#1a1a1a"><polygon points="18,0 34,7 18,14 2,7"/><rect x="16" y="7" width="4" height="7"/><path d="M26 7v7" stroke="#1a1a1a" fill="none" stroke-width="1.4"/></g>`,
  check: `<g transform="translate(56 46)"><rect x="0" y="0" width="16" height="18" rx="2.5" fill="#FFF6E8" stroke="#1a1a1a"/><path d="M3 6.5l2.2 2.2L9 4.5M3 13l2.2 2.2L9 11" fill="none" stroke="#1a1a1a" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></g>`,
  pen: `<g transform="translate(64 48) rotate(18)"><rect x="0" y="0" width="4" height="16" rx="1" fill="#1a1a1a"/><polygon points="0,16 4,16 2,20" fill="#E06A6A"/></g>`,
};

function arm(side) {
  const x = side < 0 ? 16 : 64;
  return `<g class="arm ${side < 0 ? 'arm-l' : 'arm-r'}" transform="translate(${x} 52)">
    <g class="limb-pivot">
      <rect class="skin limb" x="0" y="0" width="8" height="16" rx="4"/>
      <circle class="skin" cx="4" cy="18" r="4"/>
    </g>
  </g>`;
}

export function characterSVG(accessory) {
  const extra = ACCESSORIES[accessory] || '';
  return `<svg class="fig-svg" viewBox="0 0 96 100" aria-hidden="true" focusable="false">
    <g class="body-wrap">
      <ellipse class="shadow" cx="44" cy="94" rx="18" ry="3"/>
      ${arm(-1)}
      <g class="torso"><rect class="skin" x="26" y="48" width="36" height="30" rx="14"/><rect x="34" y="58" width="20" height="7" rx="3.5" fill="#fff" opacity=".35"/></g>
      ${arm(1)}
      <g class="head">
        <circle class="skin" cx="44" cy="32" r="18"/>
        <g class="face">
          <g class="eye eye-l"><ellipse cx="37" cy="33" rx="3.1" ry="3.6" fill="#1a1a1a"/><circle class="pupil" cx="38.1" cy="32.1" r="1.05" fill="#fff"/></g>
          <g class="eye eye-r"><ellipse cx="51" cy="33" rx="3.1" ry="3.6" fill="#1a1a1a"/><circle class="pupil" cx="52.1" cy="32.1" r="1.05" fill="#fff"/></g>
          <path class="mouth mouth-soft" d="M36 40q8 4 16 0" fill="none" stroke="#1a1a1a" stroke-width="1.6" stroke-linecap="round"/>
          <path class="mouth mouth-happy" d="M35 38q9 8 18 0" fill="none" stroke="#1a1a1a" stroke-width="1.7" stroke-linecap="round"/>
          <path class="mouth mouth-sad" d="M36 42q8-6 16 0" fill="none" stroke="#1a1a1a" stroke-width="1.6" stroke-linecap="round"/>
          <path class="mouth mouth-ask" d="M39 41h10" stroke="#1a1a1a" stroke-width="1.7" stroke-linecap="round"/>
          <circle class="mouth mouth-sleep" cx="44" cy="41" r="1.15" fill="#1a1a1a"/>
        </g>
        <g class="accessory accessory-${accessory || 'none'}">${extra}</g>
      </g>
      <g class="thought">
        <circle cx="68" cy="20" r="1.6" class="bubble-fill"/>
        <circle cx="73" cy="15" r="2.2" class="bubble-fill"/>
        <ellipse cx="82" cy="11" rx="10" ry="6" class="bubble-fill"/>
        <circle class="dot d1" cx="76" cy="11" r="1.05" fill="#1a1a1a"/>
        <circle class="dot d2" cx="81" cy="11" r="1.05" fill="#1a1a1a"/>
        <circle class="dot d3" cx="86" cy="11" r="1.05" fill="#1a1a1a"/>
      </g>
      <g class="zzz"><text x="68" y="18">z</text><text x="76" y="12">z</text></g>
      <g class="stars"><path d="M18 16l1.2 2.4 2.6.3-2 1.8.6 2.6L18 22l-2.4 1.1.6-2.6-2-1.8 2.6-.3z"/><path d="M70 40l1 2 2.2.2-1.7 1.5.5 2.1L70 44.7 68 46l.5-2.1-1.7-1.5 2.2-.2z"/></g>
      <g class="err-badge"><circle cx="68" cy="52" r="7"/><text x="68" y="56">!</text></g>
    </g>
  </svg>`;
}

export function safeColor(color) {
  return /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#C5B4E3';
}

export function figureHTML(agent, { size = 'md', live = true, caption = true } = {}) {
  const state = viewState(agent);
  const liveAttr = live && agent?.id ? ` data-live-agent="${esc(agent.id)}"` : '';
  const cap = caption
    ? `<figcaption><span class="fig-name">${esc(agent?.name || '')}</span><span class="fig-state" data-state-label>${esc(STATE_LABEL[state] || 'Vár')}</span></figcaption>`
    : '';
  return `<figure class="fig fig-${size}"${liveAttr} data-state="${esc(state)}" data-role="${esc(agent?.role || '')}" style="--agent:${safeColor(agent?.color)}" role="img" aria-label="${esc(altText(agent))}">
    ${characterSVG(agent?.accessory)}
    ${cap}
  </figure>`;
}

let observer = null;

export function watchFigures(root = typeof document !== 'undefined' ? document : null) {
  if (!root || typeof IntersectionObserver === 'undefined') return;
  observer?.disconnect();
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      entry.target.classList.toggle('is-offscreen', entry.intersectionRatio <= 0);
    }
  }, { threshold: 0 });
  root.querySelectorAll('.fig').forEach((el) => observer.observe(el));
}

export function playHandoff(fromId, toId) {
  if (typeof document === 'undefined' || !fromId || !toId) return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const safe = (id) => {
    try { return CSS.escape(id); }
    catch { return String(id).replace(/[^a-zA-Z0-9_-]/g, ''); }
  };
  const pick = (id) => {
    const all = [...document.querySelectorAll(`[data-live-agent="${safe(id)}"]`)];
    return all.reverse().find((node) => !node.classList.contains('is-offscreen')) || all[0];
  };
  const from = pick(fromId);
  const to = pick(toId);
  if (!from || !to) return;
  if (from.classList.contains('is-offscreen') && to.classList.contains('is-offscreen')) return;
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'parcel';
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  const anim = el.animate([
    { transform: `translate(${a.left + a.width / 2}px, ${a.top + 8}px)`, opacity: 1 },
    { transform: `translate(${b.left + b.width / 2}px, ${b.top + 8}px)`, opacity: 0.15 },
  ], { duration: 700, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' });
  const cleanup = () => el.remove();
  anim.onfinish = cleanup;
  anim.oncancel = cleanup;
}
