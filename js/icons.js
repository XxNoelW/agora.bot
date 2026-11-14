// Small built-in avatars. Photos are stored separately as resized data URLs.

export const SHAPES = ['robot', 'cat', 'star', 'rocket', 'brain', 'spark', 'leaf', 'heart'];

export const ICON_COLORS = ['#7EC8C3', '#F3B48A', '#C5B4E3', '#8FCBB0', '#F2D06B', '#9EC5E8', '#F4A6C1', '#E7C4A0'];

export const MAX_ICON_URL = 48000;

const PATHS = {
  robot: '<rect x="7" y="8" width="10" height="8" rx="2"/><path d="M12 8V5M9 12h.5M14.5 12H15M8 16v2M16 16v2"/>',
  cat: '<path d="M8 10l-2-4 4 2h4l4-2-2 4v5a4 4 0 01-8 0z"/><path d="M10 12h.5M14 12h.5"/>',
  star: '<path d="M12 4.5l1.8 3.8 4.2.5-3.1 2.9.8 4.1L12 13.8 8.3 15.8l.8-4.1L6 8.8l4.2-.5z"/>',
  rocket: '<path d="M12 4c2 2 3 5 3 8l-3 2-3-2c0-3 1-6 3-8z"/><path d="M9 14l-2 3 3-1M15 14l2 3-3-1M12 14v3"/>',
  brain: '<path d="M9 9a2.5 2.5 0 014-2 2.5 2.5 0 014 2.2A2.4 2.4 0 0116 14a2.5 2.5 0 01-4 2 2.5 2.5 0 01-4-2 2.4 2.4 0 011-5z"/><path d="M12 7.5V16"/>',
  spark: '<path d="M12 4l1.2 4.2L17.5 9.5 13.2 10.8 12 15l-1.2-4.2L6.5 9.5l4.3-1.3z"/>',
  leaf: '<path d="M6 16c6-1 10-6 12-10-6 1-10 5-12 10z"/><path d="M8 14c2-1 4-3 6-6"/>',
  heart: '<path d="M12 17s-6-3.6-6-7a3 3 0 016-1 3 3 0 016 1c0 3.4-6 7-6 7z"/>',
};

export function iconSVG(shape) {
  const body = PATHS[shape] || PATHS.robot;
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function safeHex(color) {
  return /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : ICON_COLORS[0];
}

export function normalizeIcon(icon, fallbackColor) {
  if (icon && icon.type === 'photo' && typeof icon.dataUrl === 'string' && /^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(icon.dataUrl) && icon.dataUrl.length <= MAX_ICON_URL) {
    return { type: 'photo', dataUrl: icon.dataUrl };
  }
  const shape = SHAPES.includes(icon?.shape) ? icon.shape : 'robot';
  return { type: 'shape', shape, color: safeHex(icon?.color || fallbackColor) };
}

export function iconMarkup(agent) {
  const icon = normalizeIcon(agent?.icon, agent?.color);
  if (icon.type === 'photo') {
    return `<img class="avatar photo" alt="" src="${icon.dataUrl}">`;
  }
  return `<span class="avatar shape" style="--agent:${icon.color}" aria-hidden="true">${iconSVG(icon.shape)}</span>`;
}
