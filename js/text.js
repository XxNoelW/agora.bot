export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

export function clip(text, n) {
  const s = String(text || '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export function rich(s) {
  const escaped = esc(s);
  return escaped
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s>])(https?:\/\/[^\s<]+)/g, (all, pre, url) => {
      const trail = url.match(/[.,)]+$/);
      const clean = trail ? url.slice(0, -trail[0].length) : url;
      return `${pre}<a href="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>${trail ? trail[0] : ''}`;
    });
}
