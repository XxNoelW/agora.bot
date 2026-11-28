// Per-chat files. Chunks stay in this browser. Search is local BM25, so it works offline.

const CHUNK = 700;
const OVERLAP = 80;

const cache = new Map();

export function chunkText(text, { size = CHUNK, overlap = OVERLAP, name = 'file', page = 1 } = {}) {
  const clean = String(text || '').replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').trim();
  if (!clean) return [];
  const pages = clean.split(/\f/);
  const chunks = [];
  pages.forEach((part, index) => {
    const body = part.replace(/\s+/g, ' ').trim();
    if (!body) return;
    const pageNo = pages.length > 1 ? index + 1 : page;
    let start = 0;
    while (start < body.length) {
      const slice = body.slice(start, start + size).trim();
      if (slice) {
        chunks.push({
          id: `${name}:${pageNo}:${start}`,
          name: String(name).slice(0, 80),
          page: pageNo,
          text: slice,
        });
      }
      if (start + size >= body.length) break;
      start += Math.max(1, size - overlap);
    }
  });
  return chunks;
}

export function zipLocalEntries(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const entries = [];
  let i = 0;
  while (i + 30 <= view.length && view[i] === 0x50 && view[i + 1] === 0x4b && view[i + 2] === 0x03 && view[i + 3] === 0x04) {
    const method = view[i + 8] | (view[i + 9] << 8);
    const compSize = view[i + 18] | (view[i + 19] << 8) | (view[i + 20] << 16) | (view[i + 21] << 24);
    const nameLen = view[i + 26] | (view[i + 27] << 8);
    const extraLen = view[i + 28] | (view[i + 29] << 8);
    const start = i + 30 + nameLen + extraLen;
    const name = new TextDecoder().decode(view.slice(i + 30, i + 30 + nameLen));
    entries.push({ name, method, data: view.slice(start, start + compSize) });
    i = start + compSize;
  }
  return entries;
}

export function extractDocxXml(xml) {
  return String(xml || '')
    .replace(/<w:p[ >]/g, '\n')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function words(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9\u00e1\u00e9\u00ed\u00f3\u00f6\u0151\u00fa\u00fc\u0171]+/).filter((word) => word.length > 2);
}

export function bm25(chunks, query, limit = 4) {
  const docs = Array.isArray(chunks) ? chunks : [];
  const terms = [...new Set(words(query))];
  if (!docs.length || !terms.length) return [];
  const docsWords = docs.map((chunk) => words(chunk.text));
  const avg = docsWords.reduce((sum, list) => sum + list.length, 0) / docs.length || 1;
  const scored = docs.map((chunk, index) => {
    const list = docsWords[index];
    let score = 0;
    for (const term of terms) {
      const tf = list.filter((word) => word === term).length;
      if (!tf) continue;
      const df = docsWords.filter((row) => row.includes(term)).length || 1;
      const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
      const k = 1.2;
      const b = 0.75;
      score += idf * ((tf * (k + 1)) / (tf + k * (1 - b + b * list.length / avg)));
    }
    return { ...chunk, score };
  });
  return scored.filter((row) => row.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}

export function citation(hit) {
  const page = hit?.page ? ` p.${hit.page}` : '';
  return `[${hit?.name || 'file'}${page}]`;
}

export function libraryBlock(chunks, query) {
  const hits = bm25(chunks, query, 3);
  if (!hits.length) return { text: '', hits: [] };
  const lines = hits.map((hit) => `${citation(hit)} ${hit.text}`);
  return {
    hits,
    text: `Notes from the user's files. When you use one, cite it exactly like ${citation(hits[0])}.\n${lines.join('\n')}`,
  };
}

export function setChatLibrary(chatId, chunks) {
  cache.set(String(chatId || ''), Array.isArray(chunks) ? chunks : []);
}

export function chatLibrary(chatId) {
  return cache.get(String(chatId || '')) || [];
}

export function rememberChunks(chatId, more) {
  const next = chatLibrary(chatId).concat(more || []);
  setChatLibrary(chatId, next.slice(-80));
  return chatLibrary(chatId);
}
