import { FETCH_HOSTS, MCP_HOSTS } from './allow.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, MCP-Protocol-Version, Mcp-Session-Id',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS, ...extra },
  });
}

function allowed(url, hosts) {
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== 'https:') return null;
  if (!hosts.has(parsed.host)) return null;
  if (parsed.username || parsed.password) return null;
  return parsed;
}

async function proxyFetch(url) {
  const target = allowed(url, FETCH_HOSTS);
  if (!target) return json({ error: 'That host is not on the proxy list.' }, 403);
  const res = await fetch(target, {
    headers: { Accept: 'application/json, application/rss+xml, application/xml, text/xml, text/plain, */*', 'User-Agent': 'Agora/1.0' },
    redirect: 'follow',
  });
  const body = (await res.text()).slice(0, 20000);
  return json({ status: res.status, contentType: res.headers.get('content-type') || '', body });
}

async function proxyMcp(payload) {
  const target = allowed(payload?.url, MCP_HOSTS);
  if (!target) return json({ error: 'That MCP host is not on the proxy list.' }, 403);
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': String(payload.protocol || '2025-06-18'),
  };
  if (payload.token) headers.Authorization = `Bearer ${payload.token}`;
  if (payload.headerName && payload.headerValue) headers[String(payload.headerName).slice(0, 40)] = String(payload.headerValue);
  if (payload.sessionId) headers['Mcp-Session-Id'] = String(payload.sessionId);
  const res = await fetch(target, { method: 'POST', headers, body: JSON.stringify(payload.body || {}) });
  const text = (await res.text()).slice(0, 100000);
  const session = res.headers.get('mcp-session-id');
  return new Response(text, {
    status: res.status,
    headers: {
      ...CORS,
      'Content-Type': res.headers.get('content-type') || 'application/json',
      ...(session ? { 'Mcp-Session-Id': session } : {}),
    },
  });
}

function toolList() {
  const tools = [...FETCH_HOSTS].map((host) => ({
    name: `proxy_${host.replace(/[^a-z0-9]+/gi, '_')}`,
    description: `Fetch a public page on ${host}`,
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  }));
  return { tools };
}

async function mcpServer(request) {
  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  if (body.method === 'initialize') {
    return json({
      jsonrpc: '2.0',
      id: body.id,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'agora-connectors', version: '1.0' },
      },
    });
  }
  if (body.method === 'notifications/initialized') return new Response(null, { status: 202, headers: CORS });
  if (body.method === 'tools/list') {
    return json({ jsonrpc: '2.0', id: body.id, result: toolList() });
  }
  if (body.method === 'tools/call') {
    const url = body.params?.arguments?.url;
    const proxied = await proxyFetch(url);
    const data = await proxied.json();
    return json({
      jsonrpc: '2.0',
      id: body.id,
      result: { content: [{ type: 'text', text: String(data.body || data.error || '').slice(0, 4000) }] },
    });
  }
  return json({ jsonrpc: '2.0', id: body.id ?? null, error: { code: -32601, message: 'Method not found' } });
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return json({ ok: true, name: 'agora-connectors' });
    }
    if (request.method === 'POST' && url.pathname === '/proxy') {
      let payload = {};
      try { payload = await request.json(); } catch { payload = {}; }
      return proxyFetch(payload.url);
    }
    if (request.method === 'POST' && url.pathname === '/mcp-proxy') {
      let payload = {};
      try { payload = await request.json(); } catch { payload = {}; }
      return proxyMcp(payload);
    }
    if (request.method === 'POST' && url.pathname === '/mcp') return mcpServer(request);
    return json({ error: 'Not found' }, 404);
  },
};
