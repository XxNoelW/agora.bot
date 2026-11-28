// Streamable HTTP MCP client, plus OAuth 2.1 PKCE and dynamic client registration.
import { assertPublicHttpUrl } from './tools.js';
import { redirectUri } from './oauth.js';

function clip(text, max = 1800) {
  const s = String(text || '');
  return s.length > max ? s.slice(0, max) + '…' : s;
}

export function parseMcpPayload(text, contentType = '') {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('The MCP server sent an empty response.');
  const sse = contentType.includes('text/event-stream') || raw.startsWith('event:') || raw.includes('\ndata:');
  if (!sse) return JSON.parse(raw);
  const messages = raw.split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  const picked = [...messages].reverse().find((line) => line.includes('"result"') || line.includes('"error"')) || messages.at(-1);
  if (!picked) throw new Error('The MCP server sent no JSON event.');
  return JSON.parse(picked);
}

function authHint(header) {
  const text = String(header || '');
  const meta = text.match(/resource_metadata="([^"]+)"/i);
  return { www: text, metadata: meta ? meta[1] : '' };
}

export async function mcpRequest(server, method, params, { id = 1, fetchImpl = fetch, signal } = {}) {
  const note = method.startsWith('notifications/');
  const body = note
    ? { jsonrpc: '2.0', method, params: params || {} }
    : { jsonrpc: '2.0', id, method, params: params || {} };
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': server.protocol || '2025-06-18',
  };
  if (server.sessionId) headers['Mcp-Session-Id'] = server.sessionId;
  if (server.token) headers.Authorization = `Bearer ${server.token}`;
  if (server.headerName && server.headerValue) headers[server.headerName] = server.headerValue;
  const target = assertPublicHttpUrl(server.url);
  let res;
  try {
    res = server.proxy
      ? await fetchImpl(`${String(server.proxy).replace(/\/$/, '')}/mcp-proxy`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({
          url: target,
          body,
          token: server.token || '',
          headerName: server.headerName || '',
          headerValue: server.headerValue || '',
          sessionId: server.sessionId || '',
          protocol: server.protocol || '2025-06-18',
        }),
      })
      : await fetchImpl(target, { method: 'POST', signal, headers, body: JSON.stringify(body) });
  } catch (err) {
    if (err?.name === 'TypeError') {
      throw new Error('That server did not allow this browser to connect. Set the proxy URL if the catalog says this one needs it.');
    }
    throw err;
  }
  const session = res.headers?.get?.('mcp-session-id');
  if (session) server.sessionId = session;
  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    const hint = authHint(res.headers?.get?.('www-authenticate'));
    const err = new Error('That server wants you to sign in.');
    err.code = 'auth';
    err.metadata = hint.metadata;
    err.status = res.status;
    throw err;
  }
  if (!res.ok) throw new Error(`The MCP server answered ${res.status}.`);
  if (note) return null;
  const payload = parseMcpPayload(text, res.headers?.get?.('content-type') || '');
  if (payload.error) throw new Error(payload.error.message || 'The MCP server returned an error.');
  return payload.result;
}

export async function connectMcp(server, opts = {}) {
  const init = await mcpRequest(server, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'Agora', version: '1.0' },
  }, opts);
  server.protocol = init?.protocolVersion || '2025-06-18';
  try { await mcpRequest(server, 'notifications/initialized', {}, opts); } catch { /* some servers ignore this */ }
  const tools = [];
  let cursor = '';
  for (let page = 0; page < 8; page += 1) {
    const listed = await mcpRequest(server, 'tools/list', cursor ? { cursor } : {}, { ...opts, id: page + 2 });
    for (const tool of listed?.tools || []) {
      tools.push({
        name: String(tool.name || ''),
        description: String(tool.description || tool.title || '').slice(0, 240),
      });
    }
    cursor = listed?.nextCursor || '';
    if (!cursor) break;
  }
  return { serverInfo: init?.serverInfo || {}, tools: tools.filter((tool) => tool.name) };
}

export async function callMcpTool(server, name, args, opts = {}) {
  const result = await mcpRequest(server, 'tools/call', { name, arguments: args || {} }, opts);
  const blocks = Array.isArray(result?.content) ? result.content : [];
  const text = blocks.map((block) => block?.text || '').filter(Boolean).join('\n') || JSON.stringify(result ?? {});
  const secret = server.token || server.headerValue || '';
  return clip(secret ? text.split(secret).join('••••') : text);
}

function base64url(bytes) {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return btoa(out).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function pkcePair() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const verifier = base64url(bytes);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

async function readJson(res) {
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  if (!res.ok) throw new Error(data.error_description || data.error || `The server answered ${res.status}.`);
  return data;
}

export async function discoverOauth(mcpUrl, { metadata = '', fetchImpl = fetch } = {}) {
  const origin = new URL(mcpUrl).origin;
  const resourceUrl = metadata || `${origin}/.well-known/oauth-protected-resource`;
  let resource = {};
  try { resource = await readJson(await fetchImpl(resourceUrl, { headers: { Accept: 'application/json' } })); }
  catch { resource = {}; }
  const issuer = (resource.authorization_servers && resource.authorization_servers[0]) || origin;
  const issuerUrl = new URL(issuer);
  const asUrl = `${issuerUrl.origin}/.well-known/oauth-authorization-server${issuerUrl.pathname === '/' ? '' : issuerUrl.pathname}`;
  const authServer = await readJson(await fetchImpl(asUrl, { headers: { Accept: 'application/json' } }));
  return { resource, authServer, issuer };
}

export async function beginMcpOauth(plugin, { metadata = '', fetchImpl = fetch, assign, storage = globalThis.sessionStorage } = {}) {
  const found = await discoverOauth(plugin.mcp || plugin.url, { metadata, fetchImpl });
  const as = found.authServer;
  if (!as.authorization_endpoint || !as.token_endpoint) throw new Error('That server did not publish a sign-in endpoint.');
  let clientId = '';
  if (as.registration_endpoint) {
    const registered = await readJson(await fetchImpl(as.registration_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_name: 'Agora',
        redirect_uris: [redirectUri()],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
    }));
    clientId = registered.client_id;
    if (!clientId) throw new Error('The server did not register Agora.');
  } else throw new Error('That server has no dynamic registration. Paste a token instead.');
  const { verifier, challenge } = await pkcePair();
  const state = `mcp.${plugin.id}.${Math.random().toString(36).slice(2, 10)}`;
  const pending = {
    id: plugin.id,
    verifier,
    tokenEndpoint: as.token_endpoint,
    clientId,
    redirect: redirectUri(),
    resource: plugin.mcp || plugin.url,
  };
  storage?.setItem('agora:mcp-oauth', JSON.stringify(pending));
  const url = new URL(as.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', pending.redirect);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  if (as.scopes_supported?.length) url.searchParams.set('scope', as.scopes_supported.slice(0, 8).join(' '));
  (assign || ((href) => globalThis.location.assign(href)))(url.toString());
  return url.toString();
}

export async function finishMcpOauth(code, state, { fetchImpl = fetch, storage = globalThis.sessionStorage } = {}) {
  const raw = storage?.getItem('agora:mcp-oauth');
  if (!raw) throw new Error('The sign-in expired. Start it again.');
  const pending = JSON.parse(raw);
  if (!String(state || '').startsWith(`mcp.${pending.id}.`)) throw new Error('The sign-in state did not match.');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: String(code || ''),
    redirect_uri: pending.redirect,
    client_id: pending.clientId,
    code_verifier: pending.verifier,
  });
  const token = await readJson(await fetchImpl(pending.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  }));
  if (!token.access_token) throw new Error('The server did not return a token.');
  storage?.removeItem('agora:mcp-oauth');
  return { id: pending.id, accessToken: token.access_token, refreshToken: token.refresh_token || '' };
}
