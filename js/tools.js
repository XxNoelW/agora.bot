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
    const response = await (opts.fetch || fetch)(url, {
      signal: gate.signal,
      headers: { Accept: 'application/json, text/plain, */*' },
    });
    if (!response.ok) throw new Error('The request failed (' + response.status + ')');
    return await response.text();
  } catch (e) {
    if (gate.parentAborted()) {
      const err = new Error('Stopped.');
      err.name = 'AbortError';
      throw err;
    }
    if (e.name === 'AbortError') throw new Error('That site took too long to answer.');
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
  if (url.username || url.password) throw new Error('Links with a hidden password are blocked.');
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

const TERM_DROP = new Set([
  'what', 'whats', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how', 'which',
  'is', 'are', 'was', 'were', 'do', 'does', 'did', 'can', 'could', 'would', 'should',
  'the', 'and', 'for', 'you', 'your', 'please', 'tell', 'about', 'from', 'with',
  'that', 'this', 'make', 'made', 'making', 'look', 'search', 'find', 'out', 'latest',
  'news', 'into', 'onto', 'over', 'under', 'than', 'then', 'just', 'have', 'has',
]);

export function isDateTimeQuestion(text) {
  const s = String(text || '').trim().replace(/[!?.]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!s || s.length > 70) return false;
  return /^(what(?:'s| is|s)?|whats|tell me|do you know)?\s*(the\s+|today'?s\s+|current\s+|local\s+)*(date|time|day)(\s+and\s+(date|time))?(\s+(today|now|is it|please))?$/i.test(s)
    || /^(today'?s date|the date today|the time now|what day is it|what time is it|current date|current time|what(?:'s| is) today)$/i.test(s);
}

export function isSimpleMath(text) {
  const s = String(text || '').trim();
  return /^(what(?:'s| is)?\s+)?[-+]?\d[\d\s.+*/x×÷()-]{0,32}\??$/i.test(s);
}

export function searchQuery(text) {
  let q = String(text || '').replace(/[?!.]+/g, ' ').replace(/\s+/g, ' ').trim();
  q = q.replace(/^(please\s+)?(can you\s+|could you\s+|would you\s+)?/i, '');
  q = q.replace(/^(search(?: for)?|look up|lookup|find(?: out)?|tell me(?: about)?)\s+/i, '');
  // "How..." stays intact. Wikipedia ranks those better than the bare keywords.
  q = q.replace(/^(what|who|where|which)\s+(is|are|was|were)\s+/i, '');
  q = q.replace(/^(a|an|the)\s+/i, '');
  return q.trim().slice(0, 140);
}

export function contentTerms(text) {
  return [...new Set(String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !TERM_DROP.has(word)))];
}

function escapeReg(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function termHit(hay, term) {
  const forms = [term];
  if (term.endsWith('s') && term.length > 3) forms.push(term.slice(0, -1));
  else forms.push(term + 's');
  return forms.some((form) => new RegExp('\\b' + escapeReg(form) + '\\b', 'i').test(hay));
}

function offTopic(query, item) {
  const title = String(item?.title || '');
  const hay = `${title} ${item?.snippet || ''}`;
  if (/\bmay refer to\b|\bdisambiguation\b/i.test(hay)) return true;
  if (/^what is\b/i.test(title)) return true;
  const q = searchQuery(query).toLowerCase();
  const of = q.match(/^([a-z0-9]+)\s+of\s+(.+)$/);
  if (!of) return false;
  const head = of[1];
  const object = of[2].trim();
  const compound = title.toLowerCase().match(new RegExp('\\b' + escapeReg(head) + '\\s+([a-z]+)'));
  if (compound && compound[1] !== 'of' && compound[1] !== 'and') return true;
  const titled = title.toLowerCase();
  if (new RegExp('\\b' + escapeReg(head) + 's?\\b').test(titled) && !titled.includes(object) && !/\bof\b/.test(titled)) return true;
  const near = new RegExp(
    '\\b' + escapeReg(head) + '\\b(?:\\W+\\w+){0,6}\\W+\\b' + escapeReg(object) + '\\b|\\b'
    + escapeReg(object) + '\\b(?:\\W+\\w+){0,6}\\W+\\b' + escapeReg(head) + '\\b',
    'i',
  );
  return !near.test(hay);
}

export function relevantSources(query, results) {
  const looked = searchQuery(query) || String(query || '');
  const terms = contentTerms(looked);
  if (!terms.length) return [];
  const need = terms.length <= 2 ? terms.length : Math.ceil(terms.length * 0.5);
  return (results || []).filter((item) => {
    if (!item?.title || !item?.url || offTopic(query, item)) return false;
    const hay = `${item.title} ${item.snippet || ''}`;
    let hits = 0;
    for (const term of terms) if (termHit(hay, term)) hits += 1;
    return hits >= need;
  }).slice(0, 3);
}

export function sourcesUsed(answer, results) {
  const body = String(answer || '');
  const low = body.toLowerCase();
  return (results || []).filter((item) => {
    if (!item?.url || !item?.title) return false;
    if (body.includes(item.url)) return true;
    const title = String(item.title).trim();
    const words = title.split(/\s+/).filter(Boolean);
    if (words.length < 2) return false;
    return low.includes(title.toLowerCase());
  });
}

export function needsWebSearch(text) {
  const s = String(text || '').trim();
  if (s.length < 8) return false;
  if (/^(hi|hello|hey|hiya|yo|howdy|sup|thanks|thank you|thx|ok|okay|bye|good morning|good afternoon|good night|how are you|what's up|whats up|hola)[!.?\s]*$/i.test(s)) return false;
  if (isDateTimeQuestion(s) || isSimpleMath(s)) return false;
  if (/^(what(?:'s| is) your name|who are you|what are you)[?!.\s]*$/i.test(s)) return false;
  if (!contentTerms(searchQuery(s)).length) return false;
  if (/\b(search|look up|lookup|find out|wikipedia|according to)\b/i.test(s)) return true;
  if (s.split(/\s+/).length < 4) return false;
  return /\b(how|who|why|where|when|what|which)\b/i.test(s);
}

export function formatClock(now = new Date(), timeZone) {
  const zone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const date = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: zone,
  }).format(now);
  const time = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone: zone,
  }).format(now);
  return { timeZone: zone, date, time };
}

export function clockPrompt(now = new Date(), timeZone) {
  const clock = formatClock(now, timeZone);
  return `The visitor's local date and time is ${clock.date}, ${clock.time}. Timezone: ${clock.timeZone}. Use this for today, the date, the time, and the day of the week.`;
}

export function localDateAnswer(text, now = new Date(), timeZone) {
  if (!isDateTimeQuestion(text)) return '';
  const clock = formatClock(now, timeZone);
  const s = String(text || '').toLowerCase();
  const wantsZone = /time\s*zone/.test(s);
  const wantsTime = /\btime\b/.test(s);
  const wantsDate = /\b(date|day|today)\b/.test(s) || (!wantsTime && !wantsZone);
  const parts = [];
  if (wantsDate) parts.push(`Today is ${clock.date}.`);
  if (wantsTime) parts.push(`The local time is ${clock.time}.`);
  if (wantsZone) parts.push(`The timezone is ${clock.timeZone}.`);
  return parts.join(' ') || `Today is ${clock.date}. The local time is ${clock.time}.`;
}

export function extractSources(text) {
  const results = [];
  const re = /(?:^|\n)\d+\.\s+(.+?)\s+[—-]\s+(.+)\n(https?:\/\/\S+)/g;
  let match;
  const body = String(text || '');
  while ((match = re.exec(body))) {
    results.push({ title: match[1].trim(), source: match[2].trim(), url: match[3].trim(), snippet: '' });
  }
  return results;
}

function tidySnippet(text) {
  let s = String(text || '').replace(/\s+/g, ' ').trim();
  if (/^[a-z(“]/.test(s)) {
    const dot = s.search(/\.\s+[A-Z]/);
    if (dot >= 0 && dot < 100) s = s.slice(dot + 2).trim();
  }
  return s;
}

export function answerFromSources(results) {
  const rows = (results || []).filter((item) => item && item.url && item.title).slice(0, 3);
  if (!rows.length) return '';
  const parts = rows.map((item) => {
    const snippet = tidySnippet(item.snippet);
    return `${snippet || item.title}\n[${item.title}](${item.url})`;
  });
  return `Here is what I found.\n\n${parts.join('\n\n')}`;
}

export function ensureCited(text) {
  return String(text || '').trim();
}

async function wikiRestSearch(query, opts) {
  const url = 'https://en.wikipedia.org/w/rest.php/v1/search/page?q='
    + encodeURIComponent(query) + '&limit=4';
  const data = JSON.parse(await fetchText(url, opts));
  return (data.pages || []).map((page) => ({
    title: page.title,
    url: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(String(page.key || page.title || '').replace(/ /g, '_')),
    snippet: stripHtml(page.excerpt || '').replace(/\s+/g, ' ').slice(0, 320),
    source: 'Wikipedia',
  })).filter((page) => page.title && page.url);
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
    const text = await fetchText(url, opts, 8000);
    if (/bots use DuckDuckGo|complete the following challenge|select all squares/i.test(text)) {
      return { results: [], note: 'Live web search was busy, so these sources are from Wikipedia and quick answers.' };
    }
    return { results: parseDdgLite(text), note: '' };
  } catch (e) {
    if (opts.signal?.aborted || e.name === 'AbortError') throw e;
    return { results: [], note: '' };
  }
}

async function collectSources(query, opts) {
  const q = String(query || '').trim();
  const [rest, wiki, instant, web] = await Promise.all([
    wikiRestSearch(q, opts).catch((e) => (opts.signal?.aborted || e.name === 'AbortError' ? Promise.reject(e) : [])),
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
  for (const item of rest) add(item);
  for (const item of wiki) add(item);
  for (const item of web.results || []) add(item);
  for (const item of instant) add(item);
  const note = !(web.results || []).length && web.note ? web.note : '';
  return { results: results.slice(0, 5), note };
}

export async function gatherSources(query, opts = {}) {
  const raw = String(query || '').trim();
  const q = searchQuery(raw) || raw;
  if (!q) throw new Error('Tell me what to look up.');
  let found = { results: [], note: '' };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (opts.signal?.aborted) break;
    found = await collectSources(q, opts);
    found.results = relevantSources(q, found.results);
    if (found.results.length || opts.signal?.aborted) break;
  }
  found.query = q;
  return found;
}

export async function webSearch(query, opts = {}) {
  const found = await gatherSources(query, opts);
  if (!found.results.length) return 'No pages found. Try a simpler question.';
  return formatSources(found.results, found.note);
}

export async function readPage(args = {}, opts = {}) {
  const title = String(args.title || args.page || '').trim();
  let target = String(args.url || args.link || args.href || '').trim();
  if (!target && (title || args.query)) {
    target = 'https://en.wikipedia.org/wiki/' + encodeURIComponent((title || String(args.query)).replace(/ /g, '_'));
  }
  if (!target) throw new Error('Give a link or a Wikipedia title.');
  const safe = assertPublicHttpUrl(target);
  const wiki = wikipediaTitle(safe);
  if (wiki) {
    const api = 'https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exchars=3500&redirects=1&titles='
      + encodeURIComponent(wiki) + '&format=json&origin=*';
    const data = JSON.parse(await fetchText(api, opts));
    const page = Object.values(data.query?.pages || {})[0];
    if (!page || page.missing !== undefined) return 'That Wikipedia page was not found.';
    const pageUrl = 'https://en.wikipedia.org/wiki/' + encodeURIComponent(String(page.title).replace(/ /g, '_'));
    return `Title: ${page.title}\nLink: ${pageUrl}\n\n${clip(page.extract || 'No text on that page.', 2800)}`;
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

export function resolveWritePath(path, agentId, files = {}, owners = {}) {
  path = normPath(path);
  if (!agentId) return path;
  const owner = owners?.[path];
  if (!owner || owner === agentId || !(path in files)) return path;
  const match = path.match(/^(.*?)(\.[^./]+)?$/);
  const base = match?.[1] || path;
  const ext = match?.[2] || '';
  const stamp = String(agentId).replace(/[^\w-]/g, '').slice(0, 8) || 'agent';
  let next = `${base}-${stamp}${ext}`;
  let n = 2;
  while (next in files && owners?.[next] && owners[next] !== agentId) {
    next = `${base}-${stamp}-${n}${ext}`;
    n += 1;
  }
  return next;
}

export function applyWrite(path, content, agentId, files, owners = {}, backups = {}) {
  const text = String(content ?? '');
  if (text.length > 100000) throw new Error('That note is too long.');
  const dest = resolveWritePath(path, agentId, files, owners);
  if (dest === '/') throw new Error('Pick a file name, like /notes.txt');
  if (dest in files) backups[dest] = files[dest];
  files[dest] = text;
  if (agentId) owners[dest] = agentId;
  return dest;
}

function write_file({ path, content }, opts = {}) {
  path = normPath(path);
  if (path === '/') throw new Error('Pick a file name, like /notes.txt');
  if (!state.fileOwners || typeof state.fileOwners !== 'object') state.fileOwners = {};
  if (!state.fileBackups || typeof state.fileBackups !== 'object') state.fileBackups = {};
  const dest = applyWrite(path, content, opts.agentId, state.files, state.fileOwners, state.fileBackups);
  save();
  if (dest !== path) return `${path} belongs to another agent, so I saved this instead: ${dest} (${state.files[dest].length} characters)`;
  return `Saved ${state.files[dest].length} characters to ${dest}.`;
}
function read_file({ path }) {
  path = normPath(path);
  if (!(path in state.files)) return `No note named ${path}. Use list_files to see what exists.`;
  return clip(state.files[path], 3000);
}
function list_files() {
  const names = Object.keys(state.files).sort();
  return names.length ? names.map((p) => `${p} (${state.files[p].length} characters)`).join('\n') : '(no notes yet)';
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
      done(clip([logs.length ? 'log:\n' + logs.join('\n') : '', ok ? (result !== undefined ? 'result: ' + result : '') : 'problem: ' + error].filter(Boolean).join('\n') || '(no output; use console.log or return)'));
    };
    worker.onerror = (e) => { e.preventDefault(); done('problem: ' + e.message); };
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

export function toolPrompt(allowed) {
  const names = Array.isArray(allowed) ? PROMPT_TOOLS.filter((name) => allowed.includes(name)) : PROMPT_TOOLS;
  if (!names.length) return 'Reply with exactly NONE.';
  return `Reply with ONLY one line. Either:
NONE
or
TOOL: tool_name {"arg":"value"}

Tools:
${names.map((name) => `- ${name} ${TOOLS[name].sig} — ${TOOLS[name].desc}`).join('\n')}

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
    return 'Tool problem: ' + (e.message || e);
  }
}
