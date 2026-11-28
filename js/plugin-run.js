// Enabled plugins become tools. The small model gets a short list, and clear requests run anyway.
import { loadCatalog, peekCatalog, pluginById, toolIndex } from './plugin-catalog.js';
import { loadPluginConfig, isEnabled, DEFAULT_ENABLED } from './plugin-store.js';
import { runHttpTool } from './plugin-http.js';
import { connectMcp, callMcpTool } from './mcp-client.js';
import { readSecret } from './secrets.js';
import { scrubSecrets } from './secrets.js';

const sessions = new Map();

function escapeReg(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasWord(text, word) {
  if (!word || word.length < 4) return false;
  return new RegExp(`\\b${escapeReg(word)}\\b`, 'i').test(text);
}

export function catalogList() {
  const config = loadPluginConfig();
  const base = (peekCatalog() || []).map((plugin) => (
    plugin.transport === 'mcp'
      ? { ...plugin, tools: config.tools[plugin.id] || plugin.tools || [] }
      : plugin
  ));
  const custom = config.custom.map((row) => ({
    id: row.id,
    name: row.name,
    category: 'Custom',
    icon: '＋',
    summary: 'A remote MCP server you added.',
    auth: row.auth,
    needs: row.auth === 'oauth' ? 'signin' : (row.auth === 'none' ? 'none' : 'key'),
    homepage: row.url,
    transport: 'mcp',
    mcp: row.url,
    cors: true,
    headerName: row.headerName,
    keywords: [row.name],
    tools: config.tools[row.id] || [],
    custom: true,
  }));
  return base.concat(custom);
}

export function enabledPlugins() {
  return catalogList().filter((plugin) => isEnabled(plugin.id));
}

export function isPluginTool(name) {
  return toolIndex(catalogList()).has(name);
}

function sig(tool) {
  const params = tool.params || {};
  const body = Object.fromEntries(Object.keys(params).map((key) => [key, params[key]]));
  return JSON.stringify(body);
}

export function rankPluginTools(text, limit = 12) {
  const enabled = enabledPlugins().filter((plugin) => (plugin.tools || []).length);
  const scored = [];
  for (const plugin of enabled) {
    let score = 1;
    for (const word of plugin.keywords || []) {
      if (hasWord(text, word)) score += word.length;
    }
    for (const tool of plugin.tools) scored.push({ plugin, tool, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const defaults = new Set(DEFAULT_ENABLED);
  const hits = scored.filter((row) => row.score >= 5);
  const pool = hits.length ? hits : scored.filter((row) => defaults.has(row.plugin.id));
  const picked = [];
  const seen = new Set();
  for (const row of pool) {
    if (seen.has(row.tool.name)) continue;
    if (picked.length >= limit) break;
    seen.add(row.tool.name);
    picked.push(row);
  }
  return picked;
}

export function pluginToolPrompt(text) {
  const rows = rankPluginTools(text, 12);
  if (!rows.length) return '';
  return rows.map((row) => `TOOL: ${row.tool.name} ${sig(row.tool)} — ${row.tool.description}`).join('\n');
}

function firstParam(tool) {
  const params = tool.params || {};
  return Object.keys(params)[0] || '';
}

function leftover(text, keywords) {
  let q = String(text || '');
  for (const word of keywords || []) {
    q = q.replace(new RegExp(`\\b${escapeReg(word)}\\b`, 'ig'), ' ');
  }
  q = q.replace(/\b(what|whats|what's|is|the|a|an|in|for|of|please|show|me|now|today|current)\b/ig, ' ');
  return q.replace(/[?!.]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export function matchPluginIntent(text) {
  const rows = rankPluginTools(text, 8).filter((row) => row.score >= 5);
  if (!rows.length) return null;
  const best = rows[0];
  const param = firstParam(best.tool);
  const args = {};
  if (param) {
    const value = leftover(text, best.plugin.keywords);
    if (value) args[param] = value;
  }
  if (param && !args[param] && param !== 'expression') return null;
  return { name: best.tool.name, args, pluginId: best.plugin.id };
}

async function serverFor(plugin, fetchImpl) {
  const config = loadPluginConfig();
  const cached = sessions.get(plugin.id);
  if (cached) return cached;
  const token = await readSecret(`plugin:${plugin.id}`);
  const server = {
    url: plugin.mcp,
    token,
    protocol: '2025-06-18',
    headerName: plugin.headerName || '',
    headerValue: plugin.auth === 'header' ? token : '',
    proxy: plugin.cors === false ? config.workerUrl : '',
  };
  if (plugin.auth === 'header') server.token = '';
  if (plugin.cors === false && !server.proxy) {
    throw new Error('This server blocks browser apps. Deploy the Worker and paste its URL in Connectors.');
  }
  sessions.set(plugin.id, server);
  return server;
}

export function dropMcpSession(id) {
  sessions.delete(id);
}

export async function connectPlugin(plugin, fetchImpl = fetch) {
  if (plugin.transport !== 'mcp') return { tools: plugin.tools || [] };
  sessions.delete(plugin.id);
  const server = await serverFor(plugin, fetchImpl);
  return connectMcp(server, { fetchImpl });
}

export async function runPluginTool(name, args = {}, { fetchImpl = fetch, signal } = {}) {
  const found = toolIndex(catalogList()).get(name);
  if (!found) return `Unknown tool: ${name}`;
  const { plugin, tool } = found;
  if (!isEnabled(plugin.id)) return `${plugin.name} is off. Turn it on in Connectors.`;
  const config = loadPluginConfig();
  try {
    if (plugin.transport === 'mcp') {
      const server = await serverFor(plugin, fetchImpl);
      if (!server.sessionId) await connectMcp(server, { fetchImpl, signal });
      const text = await callMcpTool(server, name, args, { fetchImpl, signal });
      return scrubSecrets(text, [server.token, server.headerValue].filter(Boolean));
    }
    const key = plugin.needs === 'key' || plugin.auth === 'key' ? await readSecret(`plugin:${plugin.id}`) : '';
    const text = await runHttpTool(plugin, tool, args, { fetchImpl, signal, workerUrl: config.workerUrl, key });
    return scrubSecrets(text, key ? [key] : []);
  } catch (err) {
    if (signal?.aborted || err?.name === 'AbortError') throw err;
    return scrubSecrets(err.message || 'The connector failed.');
  }
}

export async function ensureCatalog() {
  if (!peekCatalog()) await loadCatalog();
  return peekCatalog();
}
