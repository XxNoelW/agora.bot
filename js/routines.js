// Routines run only while this page is open. A closed browser catches up on the next visit.
import { listRows, saveRow, removeRow } from './browser-store.js';

let cache = [];
let timer = 0;

const WEEKDAYS = [
  ['sunday', 'vasarnap', 'vas\u00e1rnap'],
  ['monday', 'hetfo', 'h\u00e9tf\u0151', 'hetfon', 'h\u00e9tf\u0151n'],
  ['tuesday', 'kedd', 'kedden'],
  ['wednesday', 'szerda', 'szerdan', 'szerd\u00e1n'],
  ['thursday', 'csutortok', 'cs\u00fct\u00f6rt\u00f6k', 'csutortokon', 'cs\u00fct\u00f6rt\u00f6k\u00f6n'],
  ['friday', 'pentek', 'p\u00e9ntek', 'penteken', 'p\u00e9nteken'],
  ['saturday', 'szombat', 'szombaton'],
];

export function cachedRoutines() {
  return cache;
}

export async function loadRoutines() {
  cache = (await listRows('routines')).sort((a, b) => (a.nextAt || 0) - (b.nextAt || 0));
  return cache;
}

function clean(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

function hourOf(hour, minute, suffix) {
  let h = Number(hour);
  const m = Number(minute || 0);
  const mark = String(suffix || '').toLowerCase();
  if (mark === 'pm' && h < 12) h += 12;
  if (mark === 'am' && h === 12) h = 0;
  if (h > 23 || m > 59) return null;
  return { hour: h, minute: m };
}

function weekdayOf(text) {
  const lower = String(text || '').toLowerCase();
  for (let day = 0; day < WEEKDAYS.length; day += 1) {
    if (WEEKDAYS[day].some((name) => new RegExp(`\\b${name}\\b`, 'i').test(lower))) return day;
  }
  return null;
}

function stripScheduleWords(text) {
  return clean(String(text || '')
    .replace(/^(?:please\s+)?(?:remind me(?:\s+to)?|every|minden|eml\u00e9keztess(?:\s+engem)?)\b/i, '')
    .replace(/\b(?:on|at|morning|evening|day|reggel|este|nap|kor)\b/ig, '')
    .replace(/\b\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm|kor)?\b/ig, '')
    .replace(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|hetfo|h\u00e9tf\u0151n?|kedden|kedd|szerd\u00e1n|szerdan|szerda|cs\u00fct\u00f6rt\u00f6k\u00f6n|csutortokon|cs\u00fct\u00f6rt\u00f6k|penteken|p\u00e9nteken|pentek|p\u00e9ntek|szombaton|szombat|vas\u00e1rnap|vasarnap)\b/ig, '')
    .replace(/^[\s,:-]+/, '')
    .replace(/^(?:to|that|hogy)\s+/i, ''));
}

export function parseRoutine(text) {
  const raw = clean(text);
  if (!raw) return null;
  const trigger = /^(?:please\s+)?(?:remind me|every|minden|eml\u00e9keztess)\b/i.test(raw);
  if (!trigger) return null;
  const lang = /minden|eml\u00e9keztess|reggel|kor\b/i.test(raw) ? 'hu' : 'en';
  const time = raw.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|kor)?\b/i);
  const clock = time ? hourOf(time[1], time[2], time[3]) : null;
  const day = weekdayOf(raw);
  let kind = 'daily';
  let hour = clock?.hour;
  let minute = clock?.minute || 0;
  if (/morning|reggel/i.test(raw)) {
    kind = 'daily';
    if (hour == null) hour = 8;
  } else if (/evening|este/i.test(raw)) {
    kind = 'daily';
    if (hour == null) hour = 18;
    else if (!time?.[3] && hour < 12) hour += 12;
  } else if (day != null) {
    kind = 'weekly';
    if (hour == null) return null;
  } else if (/every\s+day|minden\s+nap/i.test(raw)) {
    kind = 'daily';
    if (hour == null) return null;
  } else if (hour == null) return null;
  const task = stripScheduleWords(raw) || raw;
  return { kind, hour, minute, weekday: day, text: task, lang };
}

export function nextRun(spec, from = Date.now()) {
  const start = new Date(from);
  start.setSeconds(0, 0);
  const stamp = (date) => {
    date.setHours(spec.hour, spec.minute, 0, 0);
    return date.getTime();
  };
  if (spec.kind === 'weekly') {
    const date = new Date(start);
    const wanted = Number(spec.weekday);
    const delta = (wanted - date.getDay() + 7) % 7;
    date.setDate(date.getDate() + delta);
    let at = stamp(date);
    if (at <= from) {
      date.setDate(date.getDate() + 7);
      at = stamp(date);
    }
    return at;
  }
  const date = new Date(start);
  let at = stamp(date);
  if (at <= from) {
    date.setDate(date.getDate() + 1);
    at = stamp(date);
  }
  return at;
}

export function routineLabel(spec) {
  const hh = String(spec.hour).padStart(2, '0');
  const mm = String(spec.minute).padStart(2, '0');
  if (spec.kind === 'weekly') {
    const name = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][spec.weekday] || 'Weekly';
    return `${name} ${hh}:${mm}`;
  }
  return `Every day ${hh}:${mm}`;
}

export async function createRoutine(spec, now = Date.now()) {
  const row = {
    id: spec.id || `rt_${now.toString(36)}`,
    text: clean(spec.text),
    kind: spec.kind,
    hour: spec.hour,
    minute: spec.minute,
    weekday: spec.weekday ?? null,
    nextAt: nextRun(spec, now),
    enabled: true,
    created: now,
    lastFired: 0,
  };
  cache = cache.filter((item) => item.id !== row.id).concat(row).sort((a, b) => a.nextAt - b.nextAt);
  await saveRow('routines', row);
  return row;
}

export async function cancelRoutine(idOrText) {
  const q = clean(idOrText).toLowerCase();
  const hit = cache.find((row) => row.id === idOrText || row.text.toLowerCase().includes(q));
  if (!hit) return null;
  cache = cache.filter((row) => row.id !== hit.id);
  await removeRow('routines', hit.id);
  return hit;
}

export function dueRoutines(now = Date.now(), list = cache) {
  return list.filter((row) => row.enabled !== false && row.nextAt && row.nextAt <= now);
}

export async function markFired(row, now = Date.now()) {
  row.lastFired = now;
  row.nextAt = nextRun(row, now);
  await saveRow('routines', row);
  return row;
}

export function routineToolLines() {
  return [
    'TOOL: create_routine {"when":"every morning at 8","text":"tell me the weather"} — schedule a reminder while this page is open',
    'TOOL: list_routines {} — list reminders saved in this browser',
    'TOOL: cancel_routine {"text":"weather"} — delete a reminder',
  ].join('\n');
}

export function isRoutineTool(name) {
  return name === 'create_routine' || name === 'list_routines' || name === 'cancel_routine';
}

export function formatRoutineList(list = cache) {
  if (!list.length) return 'No routines yet. They only run while Agora is open.';
  return list.map((row) => `- ${row.id} — ${routineLabel(row)} — ${row.text}`).join('\n');
}

export async function runRoutineTool(name, args = {}, now = Date.now()) {
  if (name === 'list_routines') return formatRoutineList(cache);
  if (name === 'cancel_routine') {
    const hit = await cancelRoutine(args.id || args.text || '');
    return hit ? `Cancelled ${hit.text}.` : 'I could not find that routine.';
  }
  const phrase = [args.when, args.text].filter(Boolean).join(' ');
  const parsed = parseRoutine(/^(?:every|remind me|minden|eml\u00e9keztess)\b/i.test(phrase) ? phrase : `every ${phrase}`);
  if (!parsed) return 'I could not read that schedule. Try: every morning at 8 tell me the weather.';
  if (args.text) parsed.text = clean(args.text);
  const row = await createRoutine(parsed, now);
  return `Saved. ${routineLabel(row)}: ${row.text}. This runs only while Agora is open.`;
}

export function startRoutineLoop(onFire, now = () => Date.now()) {
  stopRoutineLoop();
  const tick = async () => {
    const due = dueRoutines(now());
    for (const row of due.slice(0, 3)) {
      await markFired(row, now());
      try { await onFire(row, due.length); } catch { /* the page can still show the next one */ }
    }
    if (due.length > 3) {
      for (const row of due.slice(3)) await markFired(row, now());
    }
    const upcoming = cache.filter((row) => row.enabled !== false && row.nextAt > now()).sort((a, b) => a.nextAt - b.nextAt)[0];
    const delay = upcoming ? Math.min(Math.max(upcoming.nextAt - now(), 1000), 30000) : 30000;
    timer = setTimeout(tick, delay);
  };
  timer = setTimeout(tick, 400);
}

export function stopRoutineLoop() {
  if (timer) clearTimeout(timer);
  timer = 0;
}
