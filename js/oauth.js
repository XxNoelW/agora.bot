// Client-side OAuth. GitHub's device-code host does not allow browser calls.
// Mastodon does: the page registers an app on the server, then redirects.
import { readSecret, saveSecret, scrubSecrets } from './secrets.js';
import { writeConnectorMeta } from './connectors.js';

export function redirectUri(href = globalThis.location?.href || 'http://127.0.0.1:8000/') {
  const url = new URL(href);
  url.hash = '';
  url.search = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.origin + url.pathname;
}

export function mastodonHost(value) {
  const name = String(value || 'mastodon.social').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(name) || name === 'localhost' || name.endsWith('.local')) {
    throw new Error('Enter a Mastodon server name, like mastodon.social.');
  }
  return name;
}

export async function registerMastodonApp(host, redirect, fetchImpl = fetch) {
  const res = await fetchImpl(`https://${host}/api/v1/apps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'Agona',
      redirect_uris: redirect,
      scopes: 'read',
      website: redirect,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.client_id || !data.client_secret) {
    throw new Error(scrubSecrets(data.error || 'Mastodon did not register the app.'));
  }
  return { client_id: data.client_id, client_secret: data.client_secret, redirect };
}

export async function beginMastodonLogin(hostInput, { fetchImpl = fetch, assign = (url) => globalThis.location.assign(url) } = {}) {
  const host = mastodonHost(hostInput);
  const redirect = redirectUri();
  const app = await registerMastodonApp(host, redirect, fetchImpl);
  await saveSecret(`mastodon-app:${host}`, JSON.stringify(app));
  try { sessionStorage.setItem('agona:mastodon-host', host); } catch { /* private mode */ }
  const url = new URL(`https://${host}/oauth/authorize`);
  url.searchParams.set('client_id', app.client_id);
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'read');
  url.searchParams.set('state', `mastodon.${Math.random().toString(36).slice(2, 10)}`);
  assign(url.toString());
}

export async function finishMastodonLogin(code, { fetchImpl = fetch, href } = {}) {
  const host = mastodonHost((() => {
    try { return sessionStorage.getItem('agona:mastodon-host') || 'mastodon.social'; }
    catch { return 'mastodon.social'; }
  })());
  const raw = await readSecret(`mastodon-app:${host}`);
  if (!raw) throw new Error('The Mastodon sign-in expired. Start it again.');
  const app = JSON.parse(raw);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: String(code || ''),
    client_id: app.client_id,
    client_secret: app.client_secret,
    redirect_uri: app.redirect || redirectUri(href),
  });
  const res = await fetchImpl(`https://${host}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(scrubSecrets(data.error_description || data.error || 'Mastodon did not return a token.', [app.client_secret, data.access_token]));
  }
  await saveSecret('mastodon', data.access_token);
  await saveSecret('mastodon-host', host);
  const who = await fetchImpl(`https://${host}/api/v1/accounts/verify_credentials`, {
    headers: { Authorization: `Bearer ${data.access_token}` },
  });
  const profile = await who.json();
  const username = profile.acct || profile.username || 'account';
  writeConnectorMeta('mastodon', { state: 'connected', detail: `Signed in as @${username} on ${host}.` });
  return { username, host };
}

export const GITHUB_OAUTH_NOTE = 'GitHub sign-in from this page is not available. The device-code address at github.com does not allow browser requests, and the token exchange needs a confidential client. Connect GitHub with a personal access token instead. No GitHub client secret is stored in this project.';

const CLIENTS_KEY = 'agona:oauth-clients';

const PKCE = {
  spotify: {
    auth: 'https://accounts.spotify.com/authorize',
    token: 'https://accounts.spotify.com/api/token',
    scope: 'user-read-private user-read-email playlist-read-private',
    extra: {},
  },
  dropbox: {
    auth: 'https://www.dropbox.com/oauth2/authorize',
    token: 'https://api.dropboxapi.com/oauth2/token',
    scope: 'account_info.read files.metadata.read',
    extra: { token_access_type: 'online' },
  },
  gdrive: {
    auth: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/drive.metadata.readonly',
    extra: { access_type: 'online', prompt: 'consent' },
  },
};

function base64url(bytes) {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return btoa(out).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function readClientId(provider, storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(CLIENTS_KEY) || '{}');
    return String(parsed[provider] || '');
  } catch {
    return '';
  }
}

export function saveClientId(provider, clientId, storage = globalThis.localStorage) {
  let parsed = {};
  try { parsed = JSON.parse(storage?.getItem(CLIENTS_KEY) || '{}'); } catch { parsed = {}; }
  parsed[provider] = String(clientId || '').trim();
  try { storage?.setItem(CLIENTS_KEY, JSON.stringify(parsed)); } catch { /* private mode */ }
}

export async function beginPkce(provider, clientId, { assign = (url) => globalThis.location.assign(url) } = {}) {
  const spec = PKCE[provider];
  const id = String(clientId || readClientId(provider) || '').trim();
  if (!spec) throw new Error('That sign-in is not available.');
  if (!id || /\s/.test(id)) throw new Error('Paste the public client ID first. It is not a secret.');
  saveClientId(provider, id);
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64url(new Uint8Array(digest));
  const state = `${provider}.${base64url(crypto.getRandomValues(new Uint8Array(9)))}`;
  try { sessionStorage.setItem(`agona:pkce:${state}`, verifier); } catch { /* private mode */ }
  const url = new URL(spec.auth);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', id);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('scope', spec.scope);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  for (const [key, value] of Object.entries(spec.extra)) url.searchParams.set(key, value);
  assign(url.toString());
}

async function profileLine(provider, token, fetchImpl) {
  if (provider === 'spotify') {
    const res = await fetchImpl('https://api.spotify.com/v1/me', { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) throw new Error('Spotify did not accept the sign-in.');
    return `Signed in to Spotify as ${data.display_name || data.id}.`;
  }
  if (provider === 'dropbox') {
    const res = await fetchImpl('https://api.dropboxapi.com/2/users/get_current_account', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: 'null',
    });
    const data = await res.json();
    if (!res.ok) throw new Error('Dropbox did not accept the sign-in.');
    return `Signed in to Dropbox as ${data.name?.display_name || data.email || 'that account'}.`;
  }
  const res = await fetchImpl('https://www.googleapis.com/drive/v3/about?fields=user', { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) throw new Error('Google Drive did not accept the sign-in.');
  return `Signed in to Google Drive as ${data.user?.displayName || data.user?.emailAddress || 'that account'}.`;
}

export async function finishPkce(provider, code, state, { fetchImpl = fetch } = {}) {
  const spec = PKCE[provider];
  if (!spec) throw new Error('That sign-in is not available.');
  let verifier = '';
  try { verifier = sessionStorage.getItem(`agona:pkce:${state}`) || ''; } catch { verifier = ''; }
  if (!verifier) throw new Error('The sign-in expired. Start it again.');
  const clientId = readClientId(provider);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: String(code || ''),
    redirect_uri: redirectUri(),
    client_id: clientId,
    code_verifier: verifier,
  });
  const res = await fetchImpl(spec.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(scrubSecrets(data.error_description || data.error || 'Sign-in did not return a token.', [data.access_token, clientId]));
  }
  await saveSecret(provider, data.access_token);
  const detail = await profileLine(provider, data.access_token, fetchImpl);
  writeConnectorMeta(provider, { state: 'connected', detail: scrubSecrets(detail, [data.access_token]) });
  try { sessionStorage.removeItem(`agona:pkce:${state}`); } catch { /* ignore */ }
  return { detail };
}
