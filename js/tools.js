// Shared "cloud computer" tools
import { state, save } from './store.js';

const normPath = (p) => { p = String(p || '').trim(); if (!p.startsWith('/')) p = '/' + p; return p.replace(/\/+/g, '/'); };
const clip = (s, n = 1500) => (s.length > n ? s.slice(0, n) + '… [truncated]' : s);
const strip = (h) => String(h || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'");

async function web_search({ query }) {
  if (!query) throw new Error('query required');
  const out = [];
  try {
    const r = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`);
    const d = await r.json();
    if (d.AbstractText) out.push(`DuckDuckGo: ${d.AbstractText} (${d.AbstractURL})`);
    (d.RelatedTopics || []).slice(0, 3).forEach((t) => t.Text && out.push(`- ${t.Text}`));
  } catch { /* DDG often blocks CORS; ignore */ }
  const r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=5&origin=*`);
  const d = await r.json();
  (d.query?.search || []).forEach((s) => out.push(`Wikipedia "${s.title}": ${strip(s.snippet)}`));
  return out.length ? out.join('\n') : 'No results.';
}

async function fetch_wikipedia_page({ title }) {
  if (!title) throw new Error('title required');
  const r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exintro=1&redirects=1&titles=${encodeURIComponent(title)}&format=json&origin=*`);
  const d = await r.json();
  const page = Object.values(d.query?.pages || {})[0];
  if (!page || page.missing !== undefined) return 'Page not found.';
  return `${page.title}:\n${clip(page.extract || '', 2000)}`;
}

function write_file({ path, content }) {
  path = normPath(path); state.files[path] = String(content ?? ''); save();
  return `Wrote ${state.files[path].length} chars to ${path}`;
}
function read_file({ path }) {
  path = normPath(path);
  if (!(path in state.files)) return `File not found: ${path}`;
  return clip(state.files[path], 3000);
}
function list_files() {
  const k = Object.keys(state.files).sort();
  return k.length ? k.map((p) => `${p} (${state.files[p].length} chars)`).join('\n') : '(empty)';
}

const WORKER_SRC = `self.onmessage=(e)=>{const logs=[];const fmt=(a)=>a.map(x=>{try{return typeof x==='string'?x:JSON.stringify(x)}catch{return String(x)}}).join(' ');
const console={log:(...a)=>logs.push(fmt(a)),error:(...a)=>logs.push('ERR '+fmt(a)),warn:(...a)=>logs.push(fmt(a))};
try{const r=(new Function('console',e.data))(console);Promise.resolve(r).then(v=>self.postMessage({ok:true,logs,result:v===undefined?undefined:fmt([v])}),err=>self.postMessage({ok:false,logs,error:String(err)}))}
catch(err){self.postMessage({ok:false,logs,error:String(err)})}}`;

export function run_js({ code }, timeout = 3000) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
    const w = new Worker(url);
    const done = (s) => { clearTimeout(t); w.terminate(); URL.revokeObjectURL(url); resolve(s); };
    const t = setTimeout(() => done(`Timeout after ${timeout}ms`), timeout);
    w.onmessage = (e) => {
      const { ok, logs, result, error } = e.data;
      done(clip([logs.length ? 'console:\n' + logs.join('\n') : '', ok ? (result !== undefined ? 'return: ' + result : '') : 'error: ' + error].filter(Boolean).join('\n') || '(no output; use console.log or return)'));
    };
    w.onerror = (e) => { e.preventDefault(); done('error: ' + e.message); };
    w.postMessage(String(code || ''));
  });
}

export const TOOLS = {
  web_search: { fn: web_search, sig: '{"query":"..."}', desc: 'search the web (Wikipedia + DuckDuckGo)' },
  fetch_wikipedia_page: { fn: fetch_wikipedia_page, sig: '{"title":"..."}', desc: 'get the intro text of a Wikipedia article' },
  write_file: { fn: write_file, sig: '{"path":"/notes.md","content":"..."}', desc: 'write a file on the shared computer' },
  read_file: { fn: read_file, sig: '{"path":"/notes.md"}', desc: 'read a file on the shared computer' },
  list_files: { fn: list_files, sig: '{}', desc: 'list files on the shared computer' },
  run_js: { fn: run_js, sig: '{"code":"console.log(2+2)"}', desc: 'run JavaScript in a sandbox (no DOM, 3s timeout)' },
};

export function toolPrompt() {
  return `You share a cloud computer with the other agents. You may use ONE tool by writing a single line exactly like:
TOOL: tool_name {json arguments}
then stop and wait for the result. Available tools:
${Object.entries(TOOLS).map(([n, t]) => `- ${n} ${t.sig} — ${t.desc}`).join('\n')}
Only use a tool when it really helps. If no tool is needed, just reply normally.`;
}

// Find a TOOL: line. Returns {name,args,raw} or null.
export function parseToolCall(text) {
  const m = text.match(/^\s*TOOL:\s*([a-z_]+)\s*(\{[\s\S]*)?$/m);
  if (!m || !TOOLS[m[1]]) return null;
  let args = {};
  if (m[2]) {
    // take balanced JSON object from start
    const s = m[2]; let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    try { args = JSON.parse(end >= 0 ? s.slice(0, end + 1) : s); } catch { return { name: m[1], args: null, raw: m[0] }; }
  }
  return { name: m[1], args, raw: m[0] };
}

export async function execTool(name, args) {
  state.usage.toolCalls++; save();
  try { return String(await TOOLS[name].fn(args || {})); }
  catch (e) { return 'Tool error: ' + e.message; }
}
