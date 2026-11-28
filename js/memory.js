// Visitor notes. The prompt only receives a short slice, because Agora 1.0 is small.
import { listRows, saveRow, removeRow, replaceRows } from './browser-store.js';

const FLAG = 'agora:memory-enabled';
let cache = [];

export function memoryEnabled(storage = globalThis.localStorage) {
  try {
    const value = storage?.getItem(FLAG);
    if (value == null) return true;
    return value !== '0';
  } catch { return true; }
}

export function setMemoryEnabled(on, storage = globalThis.localStorage) {
  try { storage?.setItem(FLAG, on ? '1' : '0'); } catch { /* private mode */ }
  return memoryEnabled(storage);
}

export function cachedMemories() {
  return cache;
}

export function memoriesFor(agentId, list = cache) {
  const id = String(agentId || '');
  return (Array.isArray(list) ? list : []).filter((row) => String(row?.agentId || '') === id);
}

export async function loadMemories() {
  cache = (await listRows('memories')).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  return cache;
}

function cleanText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

export function parseMemoryCommand(text) {
  const raw = String(text || '').trim();
  const name = raw.match(/^(?:my name is|call me|a nevem|h\u00edvj(?:\s+\w+)?)\s+(.+)$/i);
  if (name) return { op: 'remember', kind: 'name', text: cleanText(name[1].replace(/[.!?]+$/g, '')), lang: /nevem|h\u00edvj/i.test(raw) ? 'hu' : 'en' };
  const remember = raw.match(/^(?:please\s+)?(?:remember that|remember|eml\u00e9kezz(?:\s+arra)?(?:,?\s+hogy)?)\s+(.+)$/i);
  if (remember) {
    const body = cleanText(remember[1]);
    const named = body.match(/^(?:my name is|a nevem)\s+(.+)$/i);
    return {
      op: 'remember',
      kind: named ? 'name' : 'fact',
      text: named ? cleanText(named[1]) : body,
      lang: /eml\u00e9kezz|nevem/i.test(raw) ? 'hu' : 'en',
    };
  }
  const forget = raw.match(/^(?:please\s+)?(?:forget|felejtsd el|felejts el)\s+(.+)$/i);
  if (forget) {
    return { op: 'forget', text: cleanText(forget[1]), lang: /felejts/i.test(raw) ? 'hu' : 'en' };
  }
  return null;
}

function sameAgent(row, agentId) {
  if (agentId === undefined) return true;
  return String(row?.agentId || '') === String(agentId || '');
}

export function upsertMemory(list, { text, kind = 'fact', id, now = Date.now(), agentId } = {}) {
  const clean = cleanText(text);
  if (!clean) return list;
  const next = (Array.isArray(list) ? list : []).map((row) => ({ ...row }));
  const scope = agentId === undefined ? '' : String(agentId || '');
  if (kind === 'name') {
    const existing = next.find((row) => row.kind === 'name' && sameAgent(row, agentId));
    if (existing) {
      existing.text = clean;
      existing.updated = now;
      if (agentId !== undefined) existing.agentId = scope;
      return next;
    }
  }
  const same = next.find((row) => sameAgent(row, agentId) && row.text.toLowerCase() === clean.toLowerCase());
  if (same) {
    same.kind = kind;
    same.updated = now;
    if (agentId !== undefined) same.agentId = scope;
    return next;
  }
  const row = { id: id || `mem_${now.toString(36)}`, text: clean, kind, created: now, updated: now };
  if (agentId !== undefined) row.agentId = scope;
  next.unshift(row);
  const kept = [];
  const counts = new Map();
  for (const item of next) {
    const key = String(item.agentId || '');
    const n = counts.get(key) || 0;
    if (n >= 80) continue;
    counts.set(key, n + 1);
    kept.push(item);
  }
  return kept;
}

export function forgetMemories(list, query, agentId) {
  const rows = Array.isArray(list) ? list : [];
  const q = cleanText(query).toLowerCase();
  if (!q) return { list: rows, removed: [] };
  const inScope = (row) => sameAgent(row, agentId);
  if (/^(everything|all|all of it|mindent|minden)$/i.test(q)) {
    return { list: rows.filter((row) => !inScope(row)), removed: rows.filter(inScope) };
  }
  const removed = [];
  const next = [];
  for (const row of rows) {
    const hit = inScope(row) && (row.text.toLowerCase().includes(q) || (row.kind === 'name' && q.includes(row.text.toLowerCase())));
    if (hit) removed.push(row);
    else next.push(row);
  }
  return { list: next, removed };
}

export function claimLegacyMemories(list, agentId) {
  const id = String(agentId || '');
  if (!id) return { list: list || [], changed: false };
  let changed = false;
  const next = (list || []).map((row) => {
    if (row?.agentId) return row;
    changed = true;
    return { ...row, agentId: id };
  });
  return { list: next, changed };
}

function words(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9\u00e1\u00e9\u00ed\u00f3\u00f6\u0151\u00fa\u00fc\u0171]+/).filter((word) => word.length > 3);
}

export function selectMemories(list, userText, limit = 6) {
  const rows = Array.isArray(list) ? list : [];
  const name = rows.find((row) => row.kind === 'name');
  const terms = words(userText);
  const ranked = rows
    .filter((row) => row !== name)
    .map((row) => ({
      row,
      score: terms.reduce((sum, term) => sum + (row.text.toLowerCase().includes(term) ? term.length : 0), 0),
    }))
    .sort((a, b) => b.score - a.score || (b.row.updated || 0) - (a.row.updated || 0));
  const picked = [];
  if (name) picked.push(name);
  for (const item of ranked) {
    if (picked.length >= limit) break;
    if (item.score > 0 || picked.length < 3) picked.push(item.row);
  }
  return picked.slice(0, limit);
}

export function memoryBlock(userText, list = cache, enabled = memoryEnabled(), agentId) {
  if (!enabled) return '';
  const rows = agentId === undefined ? list : memoriesFor(agentId, list);
  const picked = selectMemories(rows, userText);
  if (!picked.length) return '';
  const lines = picked.map((row) => `- ${row.kind === 'name' ? 'Name: ' : ''}${row.text}`);
  let body = `Notes saved for this agent:\n${lines.join('\n')}\nUse a note only when it fits the question. Do not recite the list.`;
  if (body.length > 480) body = body.slice(0, 477) + '…';
  return body;
}

export function memoryToolLines() {
  return [
    'TOOL: remember {"text":"the visitor likes tea"} — save a fact in this browser',
    'TOOL: forget {"text":"tea"} — delete a saved fact',
  ].join('\n');
}

function reply(lang, en, hu) {
  return lang === 'hu' ? hu : en;
}

export async function applyMemoryCommand(command, agentId) {
  if (!memoryEnabled()) {
    return reply(command.lang, 'Memory is off. Turn it on in Memory.', 'A mem\u00f3ria ki van kapcsolva. Kapcsold be a Memory panelen.');
  }
  if (!cleanText(command.text)) {
    return reply(command.lang, 'Tell me what to remember or forget.', 'Mondd meg, mire eml\u00e9kezzek.');
  }
  const scope = agentId === undefined ? undefined : agentId;
  if (command.op === 'forget') {
    const result = forgetMemories(cache, command.text, scope);
    cache = result.list;
    await replaceRows('memories', cache);
    if (!result.removed.length) return reply(command.lang, 'I did not have that saved.', 'Ez nem volt elmentve.');
    return reply(command.lang, 'Forgotten for this agent.', 'Elfelejtettem enn\u00e9l az agentn\u00e9l.');
  }
  cache = upsertMemory(cache, { ...command, agentId: scope });
  const saved = cache.find((row) => sameAgent(row, scope) && row.text.toLowerCase() === command.text.toLowerCase()) || cache[0];
  await saveRow('memories', saved);
  return reply(command.lang, 'I will remember that for this agent.', 'Megjegyeztem enn\u00e9l az agentn\u00e9l.');
}

export async function editMemory(id, text) {
  const row = cache.find((item) => item.id === id);
  if (!row) return null;
  row.text = cleanText(text);
  row.updated = Date.now();
  if (!row.text) return removeMemory(id);
  await saveRow('memories', row);
  return row;
}

export async function removeMemory(id) {
  cache = cache.filter((row) => row.id !== id);
  await removeRow('memories', id);
  return cache;
}

export async function replaceMemories(rows) {
  const now = Date.now();
  const next = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const text = cleanText(row?.text);
    if (!text) continue;
    const rowOut = {
      id: String(row.id || `mem_${now.toString(36)}_${next.length}`).slice(0, 40),
      text,
      kind: row.kind === 'name' ? 'name' : 'fact',
      created: Number(row.created) || now,
      updated: Number(row.updated) || now,
    };
    if (row.agentId) rowOut.agentId = String(row.agentId).slice(0, 40);
    next.push(rowOut);
  }
  cache = next.sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 200);
  await replaceRows('memories', cache);
  return cache;
}

export async function addMemory(text, kind = 'fact', agentId) {
  cache = upsertMemory(cache, { text, kind, agentId });
  const saved = cache.find((row) => sameAgent(row, agentId) && row.text.toLowerCase() === cleanText(text).toLowerCase()) || cache[0];
  await saveRow('memories', saved);
  return saved;
}

export async function forgetAgent(agentId) {
  const id = String(agentId || '');
  if (!id) return cache;
  cache = cache.filter((row) => String(row?.agentId || '') !== id);
  await replaceRows('memories', cache);
  return cache;
}

export function isMemoryTool(name) {
  return name === 'remember' || name === 'forget';
}

export async function runMemoryTool(name, args = {}, agentId) {
  if (name === 'remember') return applyMemoryCommand({ op: 'remember', kind: 'fact', text: args.text || args.fact || '', lang: 'en' }, agentId);
  if (name === 'forget') return applyMemoryCommand({ op: 'forget', text: args.text || args.query || '', lang: 'en' }, agentId);
  return '';
}
