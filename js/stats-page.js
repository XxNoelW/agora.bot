const CLOUD = 'https://agora-cloud.knoel99-morcik.workers.dev';
const TYPES = ['visit', 'chat', 'tool', 'share', 'feedback'];

function lang() {
  try { return localStorage.getItem('agora:voice-lang') === 'hu' ? 'hu' : 'en'; }
  catch { return 'en'; }
}

function ui(en, hu, which = lang()) {
  return which === 'hu' ? hu : en;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

export function dayTotals(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const day = String(row.day || '');
    if (!day) continue;
    if (!map.has(day)) map.set(day, { day, total: 0 });
    map.get(day).total += Number(row.count) || 0;
  }
  return [...map.values()];
}

export function chartSvg(rows) {
  const days = dayTotals(rows);
  if (!days.length) return '';
  const max = Math.max(1, ...days.map((day) => day.total));
  const width = Math.max(days.length, 1) * 14;
  const bars = days.map((day, index) => {
    const h = Math.max(2, Math.round((day.total / max) * 88));
    return `<rect x="${index * 14 + 2}" y="${96 - h}" width="10" height="${h}" rx="2"><title>${esc(day.day)}: ${esc(day.total)}</title></rect>`;
  }).join('');
  return `<svg class="stats-chart" viewBox="0 0 ${width} 100" role="img" aria-label="${days.length}">${bars}</svg>`;
}

export function statsMarkup(data, which = lang()) {
  const rows = data?.rows || [];
  const totals = data?.totals || {};
  const lead = ui(
    'Anonymous counts for the last 30 days. No cookies and no addresses.',
    'N\u00e9vtelen sz\u00e1mok az elm\u00falt 30 napb\u00f3l. Nincs s\u00fcti, \u00e9s c\u00edm sincs.',
    which,
  );
  const empty = ui('No counts yet.', 'M\u00e9g nincs sz\u00e1m.', which);
  const names = {
    visit: ui('Visits', 'L\u00e1togat\u00e1sok', which),
    chat: ui('Chats', 'Cseveg\u00e9sek', which),
    tool: ui('Tools', 'Eszk\u00f6z\u00f6k', which),
    share: ui('Shares', 'Megoszt\u00e1sok', which),
    feedback: ui('Feedback', 'Visszajelz\u00e9s', which),
  };
  const cards = TYPES.map((type) => `<li><span>${names[type]}</span><b>${Number(totals[type]) || 0}</b></li>`).join('');
  const chart = chartSvg(rows);
  const tableRows = rows.map((row) => `<tr><td>${esc(row.day)}</td><td>${esc(names[row.type] || row.type)}</td><td>${esc(row.key || '—')}</td><td>${esc(row.count)}</td></tr>`).join('');
  return {
    lead,
    langLabel: which === 'hu' ? 'EN' : 'HU',
    body: `${chart ? `<div class="stats-chart-wrap">${chart}</div>` : `<p>${empty}</p>`}
      <ul class="stats-totals">${cards}</ul>
      ${tableRows ? `<table class="stats-table"><thead><tr><th>${ui('Day', 'Nap', which)}</th><th>${ui('Type', 'T\u00edpus', which)}</th><th>${ui('Key', 'Kulcs', which)}</th><th>${ui('Count', 'Sz\u00e1m', which)}</th></tr></thead><tbody>${tableRows}</tbody></table>` : ''}`,
  };
}

async function boot() {
  const lead = document.querySelector('#stats-lead');
  const box = document.querySelector('#stats-box');
  const button = document.querySelector('#stats-lang');
  const draw = () => {
    if (button) button.textContent = lang() === 'hu' ? 'EN' : 'HU';
  };
  button?.addEventListener('click', () => {
    const next = lang() === 'hu' ? 'en' : 'hu';
    try { localStorage.setItem('agora:voice-lang', next); } catch { /* private mode */ }
    if (box?.dataset.ready === '1') {
      const view = statsMarkup(JSON.parse(box.dataset.payload || '{}'));
      if (lead) lead.textContent = view.lead;
      box.innerHTML = view.body;
    }
    draw();
  });
  draw();
  if (lead) {
    lead.textContent = ui('Loading counts…', 'Sz\u00e1mok bet\u00f6lt\u00e9se…');
  }
  try {
    const res = await fetch(`${CLOUD}/stats`);
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const view = statsMarkup(data);
    if (lead) lead.textContent = view.lead;
    if (box) {
      box.dataset.ready = '1';
      box.dataset.payload = JSON.stringify(data);
      box.innerHTML = view.body;
    }
  } catch {
    if (lead) {
      lead.textContent = ui(
        'The counts could not be loaded.',
        'A sz\u00e1mokat nem siker\u00fclt bet\u00f6lteni.',
      );
    }
  }
}

if (typeof document !== 'undefined' && document.querySelector('#stats-box')) boot();
