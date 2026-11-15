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
