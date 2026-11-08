// Tools that work from a static page: no API key and no backend.
import { state, save } from './store.js';

const clip = (s, n = 1500) => (s.length > n ? s.slice(0, n) + '… [truncated]' : s);

export function normPath(p) {
  p = String(p || '').trim().replace(/\\/g, '/');
  if (!p.startsWith('/')) p = '/' + p;
  const parts = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return '/' + parts.join('/');
}

function stripHtml(h) {
  return String(h || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => {
      const c = Number(n);
      return c > 0 && c < 128 ? String.fromCharCode(c) : ' ';
    });
}

function anySignal(parent, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  const onAbort = () => ctl.abort();
  parent?.addEventListener?.('abort', onAbort);
  return {
    signal: ctl.signal,
    done() {
      clearTimeout(timer);
      parent?.removeEventListener?.('abort', onAbort);
    },
    parentAborted: () => !!parent?.aborted,
  };
}

async function fetchText(url, opts = {}, ms = 15000) {
  const gate = anySignal(opts.signal, ms);
  try {
    const response = await fetch(url, {
      signal: gate.signal,
      headers: { Accept: 'application/json, text/plain, */*' },
    });
    if (!response.ok) throw new Error('Request failed (' + response.status + ')');
    return await response.text();
  } catch (e) {
    if (gate.parentAborted()) {
      const err = new Error('Stopped.');
      err.name = 'AbortError';
      throw err;
    }
    if (e.name === 'AbortError') throw new Error('The website took too long to answer.');
    throw e;
  } finally {
    gate.done();
  }
}

export function assertPublicHttpUrl(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); }
  catch { throw new Error('That link does not look right.'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http and https links can be read.');
  if (url.username || url.password) throw new Error('Links with a password hidden in them are blocked.');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  const privateIp = ipv4 && (
    ipv4[1] === '10' || ipv4[1] === '127' || ipv4[1] === '0'
    || (ipv4[1] === '192' && ipv4[2] === '168')
    || (ipv4[1] === '169' && ipv4[2] === '254')
    || (ipv4[1] === '172' && Number(ipv4[2]) >= 16 && Number(ipv4[2]) <= 31)
  );
  if (
    !host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost')
    || privateIp || host === '::1'
  ) throw new Error('That page is on a private network, so I will not open it.');
  return url.toString();
}

function wikipediaTitle(raw) {
  try {
    const url = new URL(raw);
    if (!/(^|\.)wikipedia\.org$/i.test(url.hostname)) return null;
    const match = url.pathname.match(/^\/wiki\/([^#?]+)/);
    if (!match) return null;
    return decodeURIComponent(match[1]).replace(/_/g, ' ');
  } catch { return null; }
}

export function unwrapDuckLink(raw) {
  try {
    const url = new URL(raw);
    const uddg = url.searchParams.get('uddg');
    if (uddg) return uddg;
    return url.toString();
  } catch { return raw; }
}

export function parseDdgLite(markdown) {
  const text = String(markdown || '');
  if (/bots use DuckDuckGo|complete the following challenge|select all squares/i.test(text)) return [];
  const results = [];
  const re = /(?:^|\n)\d+\.\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\n([\s\S]*?)(?=\n\d+\.\[|$)/g;
  let match;
  while ((match = re.exec(text))) {
    const title = match[1].replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
    const url = unwrapDuckLink(match[2]);
    const lines = match[3].replace(/\*\*/g, '').split('\n').map((s) => s.trim()).filter(Boolean);
    if (lines.length > 1 && !/\s/.test(lines[lines.length - 1])) lines.pop();
    const snippet = lines.join(' ').replace(/\s+/g, ' ').slice(0, 320);
    if (!title || !/^https?:\/\//i.test(url)) continue;
    results.push({ title, url, snippet, source: 'Web' });
    if (results.length >= 5) break;
  }
  return results;
}

export function formatSources(results, note = '') {
  const body = results.map((r, i) => {
    const snippet = r.snippet ? '\n' + r.snippet : '';
    return `${i + 1}. ${r.title} — ${r.source}\n${r.url}${snippet}`;
  }).join('\n\n');
  return (note ? note + '\n\n' : '') + body;
}

async function wikiSearch(query, opts) {
  const url = 'https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch='
    + encodeURIComponent(query)
    + '&gsrlimit=4&prop=extracts|info&inprop=url&exintro=1&explaintext=1&exchars=360&format=json&origin=*';
  const data = JSON.parse(await fetchText(url, opts));
  return Object.values(data.query?.pages || {})
    .sort((a, b) => (a.index || 0) - (b.index || 0))
    .map((page) => ({
      title: page.title,
      url: page.fullurl || ('https://en.wikipedia.org/wiki/' + encodeURIComponent(String(page.title).replace(/ /g, '_'))),
      snippet: stripHtml(page.extract || '').replace(/\s+/g, ' ').slice(0, 320),
      source: 'Wikipedia',
    }))
    .filter((page) => page.title && page.url);
}

async function ddgInstant(query, opts) {
  const url = 'https://api.duckduckgo.com/?q=' + encodeURIComponent(query) + '&format=json&no_html=1&skip_disambig=1';
  const data = JSON.parse(await fetchText(url, opts));
  const out = [];
  if (data.AbstractText && data.AbstractURL) {
    out.push({
      title: data.Heading || data.AbstractSource || 'Quick answer',
      url: data.AbstractURL,
      snippet: data.AbstractText,
      source: data.AbstractSource || 'Quick answer',
    });
  }
  const topics = [];
  for (const topic of data.RelatedTopics || []) {
    if (Array.isArray(topic.Topics)) topics.push(...topic.Topics);
    else topics.push(topic);
  }
  for (const topic of topics) {
    if (topic.Text && topic.FirstURL) {
      out.push({ title: String(topic.Text).slice(0, 90), url: topic.FirstURL, snippet: topic.Text, source: 'DuckDuckGo' });
    }
  }
  return out.slice(0, 3);
}

async function ddgWeb(query, opts) {
  const url = 'https://r.jina.ai/https://lite.duckduckgo.com/lite/?q=' + encodeURIComponent(query);
  try {
    const text = await fetchText(url, opts, 20000);
    if (/bots use DuckDuckGo|complete the following challenge|select all squares/i.test(text)) {
      return { results: [], note: 'The live web search was busy, so these sources are from Wikipedia and quick answers.' };
    }
    return { results: parseDdgLite(text), note: '' };
  } catch (e) {
    if (opts.signal?.aborted || e.name === 'AbortError') throw e;
    return { results: [], note: '' };
  }
}

export async function webSearch(query, opts = {}) {
  const q = String(query || '').trim();
  if (!q) throw new Error('Tell me what to search for.');
  const [wiki, instant, web] = await Promise.all([
    wikiSearch(q, opts).catch((e) => (opts.signal?.aborted || e.name === 'AbortError' ? Promise.reject(e) : [])),
    ddgInstant(q, opts).catch((e) => (opts.signal?.aborted || e.name === 'AbortError' ? Promise.reject(e) : [])),
    ddgWeb(q, opts).catch((e) => (opts.signal?.aborted || e.name === 'AbortError' ? Promise.reject(e) : { results: [], note: '' })),
  ]);
  const results = [];
  const seen = new Set();
  const add = (item) => {
    if (!item?.url || !item?.title) return;
    let key = item.url;
    try { const u = new URL(item.url); key = (u.origin + u.pathname).replace(/\/$/, '').toLowerCase(); } catch { /* keep raw */ }
    if (seen.has(key)) return;
    seen.add(key);
    results.push(item);
  };
  for (const item of web.results || []) add(item);
  for (const item of wiki) add(item);
  for (const item of instant) add(item);
  const top = results.slice(0, 5);
  if (!top.length) return 'No pages found. Try a simpler question.';
  const note = !(web.results || []).length && web.note ? web.note : '';
  return formatSources(top, note);
}

export async function readPage(args = {}, opts = {}) {
  const title = String(args.title || args.page || '').trim();
  let target = String(args.url || args.link || args.href || '').trim();
  if (!target && (title || args.query)) {
    target = 'https://en.wikipedia.org/wiki/' + encodeURIComponent((title || String(args.query)).replace(/ /g, '_'));
  }
  if (!target) throw new Error('Give a url or a Wikipedia title.');
  const safe = assertPublicHttpUrl(target);
  const wiki = wikipediaTitle(safe);
  if (wiki) {
    const api = 'https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exchars=3500&redirects=1&titles='
      + encodeURIComponent(wiki) + '&format=json&origin=*';
    const data = JSON.parse(await fetchText(api, opts));
    const page = Object.values(data.query?.pages || {})[0];
    if (!page || page.missing !== undefined) return 'That Wikipedia page was not found.';
    const pageUrl = 'https://en.wikipedia.org/wiki/' + encodeURIComponent(String(page.title).replace(/ /g, '_'));
    return `Title: ${page.title}\nURL: ${pageUrl}\n\n${clip(page.extract || 'No text on that page.', 2800)}`;
  }
  const text = await fetchText('https://r.jina.ai/' + safe, opts, 20000);
  if (!text.trim()) return 'That page had no text I could read.';
  return clip(text, 2800);
}

async function web_search(args, opts) {
  return webSearch(args.query || args.q || args.search, opts);
}

async function fetch_wikipedia_page(args, opts) {
  return readPage({ title: args.title || args.query, url: args.url }, opts);
}

function write_file({ path, content }) {
  path = normPath(path);
  if (path === '/') throw new Error('Pick a file name, like /notes.txt');
  state.files[path] = String(content ?? '');
  save();
  return `Wrote ${state.files[path].length} chars to ${path}`;
}
function read_file({ path }) {
  path = normPath(path);
  if (!(path in state.files)) return `File not found: ${path}. Use list_files to see what exists.`;
  return clip(state.files[path], 3000);
}
function list_files() {
  const names = Object.keys(state.files).sort();
  return names.length ? names.map((p) => `${p} (${state.files[p].length} chars)`).join('\n') : '(no notes yet)';
}

const WORKER_SRC = `self.onmessage=(e)=>{const logs=[];const fmt=(a)=>a.map(x=>{try{return typeof x==='string'?x:JSON.stringify(x)}catch{return String(x)}}).join(' ');
const console={log:(...a)=>logs.push(fmt(a)),error:(...a)=>logs.push('ERR '+fmt(a)),warn:(...a)=>logs.push(fmt(a))};
try{const r=(new Function('console',e.data))(console);Promise.resolve(r).then(v=>self.postMessage({ok:true,logs,result:v===undefined?undefined:fmt([v])}),err=>self.postMessage({ok:false,logs,error:String(err)}))}
catch(err){self.postMessage({ok:false,logs,error:String(err)})}}`;

export function run_js({ code }, opts = {}) {
  const timeout = opts.timeout || 3000;
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
    const worker = new Worker(url);
    const done = (s) => { clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(url); resolve(s); };
    const timer = setTimeout(() => done(`Timeout after ${timeout}ms`), timeout);
    if (opts.signal) {
      if (opts.signal.aborted) { done('Stopped.'); return; }
      opts.signal.addEventListener('abort', () => done('Stopped.'), { once: true });
    }
    worker.onmessage = (e) => {
      const { ok, logs, result, error } = e.data;
      done(clip([logs.length ? 'console:\n' + logs.join('\n') : '', ok ? (result !== undefined ? 'return: ' + result : '') : 'error: ' + error].filter(Boolean).join('\n') || '(no output; use console.log or return)'));
    };
    worker.onerror = (e) => { e.preventDefault(); done('error: ' + e.message); };
    worker.postMessage(String(code || ''));
  });
}

export const TOOLS = {
  web_search: { fn: web_search, sig: '{"query":"how do bees make honey"}', desc: 'search the web and Wikipedia and return links' },
  read_page: { fn: readPage, sig: '{"url":"https://en.wikipedia.org/wiki/Bee"}', desc: 'read a web page (Wikipedia is read directly; other pages use a reader)' },
  fetch_wikipedia_page: { fn: fetch_wikipedia_page, sig: '{"title":"Bee"}', desc: 'read the text of a Wikipedia article' },
  write_file: { fn: write_file, sig: '{"path":"/notes.txt","content":"hello"}', desc: 'save a note on the shared computer' },
  read_file: { fn: read_file, sig: '{"path":"/notes.txt"}', desc: 'read a note on the shared computer' },
  list_files: { fn: list_files, sig: '{}', desc: 'list shared notes' },
  run_js: { fn: run_js, sig: '{"code":"console.log(2+2)"}', desc: 'run JavaScript in a sandbox (no page access, 3s limit)' },
};

const PROMPT_TOOLS = ['web_search', 'read_page', 'write_file', 'read_file', 'list_files', 'run_js'];

export function toolPrompt() {
  return `Reply with ONLY one line. Either:
NONE
or
TOOL: tool_name {"arg":"value"}

Tools:
${PROMPT_TOOLS.map((name) => `- ${name} ${TOOLS[name].sig} — ${TOOLS[name].desc}`).join('\n')}

Examples:
User: hi
NONE
User: how do bees make honey?
TOOL: web_search {"query":"how do bees make honey"}
User: read https://en.wikipedia.org/wiki/Bee
TOOL: read_page {"url":"https://en.wikipedia.org/wiki/Bee"}
User: save a note that says hello
TOOL: write_file {"path":"/notes.txt","content":"hello"}

No other words.`;
}

function normalizeTool(name) {
  const n = String(name || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (n === 'search' || n === 'websearch' || n === 'internet' || n === 'internet_search' || n === 'google') return 'web_search';
  if (n === 'wiki' || n === 'wikipedia' || n === 'read' || n === 'fetch' || n === 'open_page' || n === 'browse') return 'read_page';
  return n;
}

function extractBalanced(s) {
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false, quote = '';
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === quote) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function parseJsonLoose(s) {
  if (!s) return null;
  const tries = [s, s.replace(/,\s*([}\]])/g, '$1'), s.replace(/'/g, '"').replace(/,\s*([}\]])/g, '$1')];
  for (const candidate of tries) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch { /* try the next repair */ }
  }
  return null;
}

function argsFromAfter(name, after) {
  const trimmed = after.trim();
  if (trimmed.startsWith('{')) {
    const jsonText = extractBalanced(trimmed);
    if (!jsonText) return null;
    return parseJsonLoose(jsonText);
  }
  const bare = after.split('\n')[0].replace(/^[\s:.-]+/, '').trim().replace(/^["']|["']$/g, '');
  if (!bare) return name === 'list_files' ? {} : null;
  if (name === 'web_search') return { query: bare };
  if (name === 'read_page' || name === 'fetch_wikipedia_page') {
    return /^https?:\/\//i.test(bare) ? { url: bare } : { title: bare };
  }
  if (name === 'read_file') return { path: bare };
  if (name === 'list_files') return {};
  if (name === 'write_file' || name === 'run_js') return null;
  return null;
}

function parseJsonEnvelope(text) {
  const jsonText = extractBalanced(text);
  if (!jsonText) return null;
  const parsed = parseJsonLoose(jsonText);
  if (!parsed) return null;
  const name = normalizeTool(parsed.name || parsed.tool || parsed.tool_name);
  if (!name || !TOOLS[name]) return null;
  let args = parsed.arguments ?? parsed.args ?? parsed.parameters ?? null;
  if (args == null) {
    args = { ...parsed };
    delete args.name; delete args.tool; delete args.tool_name;
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return { name, args: null, raw: jsonText };
  return { name, args, raw: jsonText };
}

// Find a tool call. Returns {name, args, raw} or null. args is null when JSON was broken.
export function parseToolCall(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/```(?:json|tool|javascript)?/gi, '').replace(/```/g, '');
  if (/^\s*NONE\b/i.test(cleaned.trim()) && !/TOOL\s*:/i.test(cleaned)) return null;

  const toolRe = /TOOL\s*:?\s*([A-Za-z0-9_]+)/gi;
  let match;
  while ((match = toolRe.exec(cleaned))) {
    const name = normalizeTool(match[1]);
    if (!TOOLS[name]) continue;
    const after = cleaned.slice(match.index + match[0].length);
    const args = argsFromAfter(name, after);
    return { name, args, raw: cleaned.slice(match.index, match.index + match[0].length + Math.min(after.length, 400)).split('\n')[0] };
  }

  const callRe = /\b(web_search|read_page|read_file|write_file|list_files|run_js|fetch_wikipedia_page|wiki|search)\s*\(\s*([\s\S]{0,800}?)\)/i;
  const call = cleaned.match(callRe);
  if (call) {
    const name = normalizeTool(call[1]);
    if (TOOLS[name]) {
      const inner = call[2].trim();
      if (!inner) return { name, args: name === 'list_files' ? {} : null, raw: call[0] };
      if (inner.startsWith('{') || inner.startsWith("'") || inner.startsWith('"')) {
        if (inner.startsWith('{')) {
          const parsed = parseJsonLoose(extractBalanced(inner) || inner);
          return { name, args: parsed, raw: call[0] };
        }
        const value = inner.replace(/^['"]|['"]$/g, '');
        if (name === 'web_search') return { name, args: { query: value }, raw: call[0] };
        if (name === 'read_page') return { name, args: /^https?:\/\//i.test(value) ? { url: value } : { title: value }, raw: call[0] };
      }
      return { name, args: argsFromAfter(name, inner), raw: call[0] };
    }
  }

  return parseJsonEnvelope(cleaned);
}

export async function execTool(name, args, opts = {}) {
  const tool = TOOLS[name];
  if (!tool) return 'Unknown tool: ' + name;
  state.usage.toolCalls++;
  save();
  try { return String(await tool.fn(args || {}, opts)); }
  catch (e) {
    if (opts.signal?.aborted || e.name === 'AbortError') throw e;
    return 'Tool error: ' + (e.message || e);
  }
}
