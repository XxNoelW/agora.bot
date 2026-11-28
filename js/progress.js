// Turns a WebLLM initProgressCallback report into percent, megabytes, and ETA.
import { voiceLang } from './voice.js';

function ui(en, hu) {
  return voiceLang() === 'hu' ? hu : en;
}

export function describeProgress(report) {
  const text = String(report?.text || '');
  let progress = typeof report?.progress === 'number' ? report.progress : NaN;
  if (!Number.isFinite(progress)) {
    const pct = text.match(/(\d+(?:\.\d+)?)%\s*completed/i);
    progress = pct ? Number(pct[1]) / 100 : 0;
  }
  if (progress > 1 && progress <= 100) progress /= 100;
  progress = Math.min(1, Math.max(0, progress || 0));
  const mbMatch = text.match(/(\d+(?:\.\d+)?)\s*MB/i);
  let mb = mbMatch ? Number(mbMatch[1]) : null;
  if (mb == null && Number.isFinite(report?.loaded) && report.loaded >= 0) {
    mb = report.loaded / (1024 * 1024);
  }
  let elapsed = Number.isFinite(report?.timeElapsed) ? report.timeElapsed : null;
  if (elapsed == null) {
    const secs = text.match(/(\d+(?:\.\d+)?)\s*secs?/i);
    if (secs) elapsed = Number(secs[1]);
  }
  const fromCache = /from cache/i.test(text) || (/\d+(?:\.\d+)?\s*MB\s+loaded/i.test(text) && !/fetch/i.test(text));
  let eta = null;
  if (elapsed != null && progress > 0.02 && progress < 1) {
    eta = Math.max(0, (elapsed * (1 - progress)) / progress);
  }
  return {
    progress,
    percent: Math.round(progress * 100),
    mb: mb == null ? null : Math.round(mb * 10) / 10,
    eta,
    fromCache,
    text,
  };
}

export function formatEta(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '';
  const s = Math.round(seconds);
  if (s < 8) return ui('almost done', 'mindj\u00e1rt k\u00e9sz');
  if (s < 90) {
    const n = Math.max(10, Math.round(s / 5) * 5);
    return ui(`about ${n} sec left`, `kb. ${n} m\u00e1sodperc van h\u00e1tra`);
  }
  const min = Math.max(1, Math.round(s / 60));
  return ui(`about ${min} min left`, `kb. ${min} perc van h\u00e1tra`);
}

export function progressLine(info) {
  const bits = [`${info?.percent || 0}%`];
  if (info?.mb != null) bits.push(`${info.mb} MB`);
  const eta = formatEta(info?.eta);
  if (eta) bits.push(eta);
  return bits.join(' · ');
}

export function progressMessage(info, name = 'Agora 1.0') {
  if (info?.fromCache) {
    return ui(
      `Loading ${name} from cache.`,
      `A ${name} a mentett p\u00e9ld\u00e1nyb\u00f3l t\u00f6lt\u0151dik.`,
    );
  }
  if ((info?.percent || 0) <= 0) {
    return ui(
      `Downloading ${name}. The first time can take a few minutes. This bar moves as the files arrive, so the page is not stuck.`,
      `A ${name} let\u00f6lt\u00e9se folyamatban van. Az els\u0151 alkalom n\u00e9h\u00e1ny percig tarthat. A s\u00e1v halad, ahogy a f\u00e1jlok meg\u00e9rkeznek, az oldal nem akadt el.`,
    );
  }
  return ui(
    `Downloading ${name}. The first time can take a few minutes.`,
    `A ${name} let\u00f6lt\u00e9se folyamatban van. Az els\u0151 alkalom n\u00e9h\u00e1ny percig tarthat.`,
  );
}
