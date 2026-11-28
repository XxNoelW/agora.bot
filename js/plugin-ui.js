import { esc } from './text.js';
import { filterCatalog, categoriesOf } from './plugin-catalog.js';
import { catalogList, enabledPlugins } from './plugin-run.js';
import { pluginConfig, isEnabled, DEFAULT_WORKER_URL } from './plugin-store.js';
import { hasSecret } from './secrets.js';
import { connectorsHTML } from './pages.js';

const NEEDS_LABEL = {
  none: 'Ready',
  key: 'Needs your key',
  signin: 'Needs sign-in',
  proxy: 'Needs the proxy',
};

let shown = 48;
let view = { query: '', category: '', needs: '' };

export function resetPluginView() {
  shown = 48;
  view = { query: '', category: '', needs: '' };
}

function badge(plugin) {
  if (plugin.transport === 'mcp' && plugin.cors === false) return 'Needs sign-in · proxy';
  return NEEDS_LABEL[plugin.needs] || 'Ready';
}

function toolLines(plugin) {
  const tools = plugin.tools || [];
  if (!tools.length) return '<p class="small muted">Tools appear after you connect.</p>';
  return `<ul class="small">${tools.slice(0, 12).map((tool) => `<li><b>${esc(tool.name)}</b> ${esc(tool.description || '')}</li>`).join('')}</ul>`;
}

export async function pluginResultsHTML() {
  const list = filterCatalog(catalogList(), view);
  const slice = list.slice(0, shown);
  const cards = [];
  for (const plugin of slice) {
    const on = isEnabled(plugin.id);
    const wantsSecret = plugin.needs === 'key' || plugin.auth === 'bearer' || plugin.auth === 'header' || plugin.auth === 'oauth';
    const secret = wantsSecret ? await hasSecret(`plugin:${plugin.id}`) : false;
    const keyLabel = plugin.auth === 'header' ? 'Header value' : (plugin.auth === 'oauth' ? 'Token, or use Sign in' : 'Key');
    const keyField = wantsSecret
      ? `<label for="key-${esc(plugin.id)}">${esc(keyLabel)}</label>
         <input id="key-${esc(plugin.id)}" data-plugin-key="${esc(plugin.id)}" type="password" autocomplete="off" placeholder="${secret ? 'Saved on this computer' : 'Stays in this browser'}">`
      : '';
    const connect = plugin.transport === 'mcp'
      ? `<button type="button" data-act="connect-plugin" data-plugin="${esc(plugin.id)}">${plugin.needs === 'signin' ? 'Sign in' : 'Connect'}</button>`
      : '';
    cards.push(`<article class="plugin-card" data-plugin-card="${esc(plugin.id)}">
      <div class="row spread">
        <h3>${esc(plugin.icon || '')} ${esc(plugin.name)}</h3>
        <span class="model-pill">${esc(badge(plugin))}</span>
      </div>
      <p class="small">${esc(plugin.summary)}</p>
      <p class="small"><a href="${esc(plugin.homepage)}" target="_blank" rel="noopener noreferrer">About</a> · ${esc(plugin.category)}</p>
      <label class="checkline"><input type="checkbox" data-plugin-toggle="${esc(plugin.id)}" ${on ? 'checked' : ''}> Use in chat</label>
      ${keyField}
      <div class="row">
        ${connect}
        ${secret || on ? `<button type="button" class="danger" data-act="disconnect-plugin" data-plugin="${esc(plugin.id)}">Disconnect</button>` : ''}
      </div>
      ${on ? toolLines(plugin) : ''}
    </article>`);
  }
  const more = list.length > slice.length
    ? `<button type="button" data-act="plugins-more">Show more (${list.length - slice.length} left)</button>`
    : '';
  return `<p class="small muted">${list.length} connectors${view.query || view.category || view.needs ? '' : ` in the catalog`}.</p>
    <div class="plugin-grid">${cards.join('') || '<p>No connectors match that search.</p>'}</div>
    <div class="row">${more}</div>`;
}

function connectedHTML() {
  const rows = enabledPlugins();
  if (!rows.length) return '<p>Nothing is turned on yet. Open the store and enable a connector.</p>';
  return rows.map((plugin) => `<article class="plugin-card">
    <div class="row spread"><h3>${esc(plugin.icon || '')} ${esc(plugin.name)}</h3><span class="model-pill">${esc(badge(plugin))}</span></div>
    ${toolLines(plugin)}
    <button type="button" class="danger" data-act="disconnect-plugin" data-plugin="${esc(plugin.id)}">Disconnect</button>
  </article>`).join('');
}

export async function connectorsShell(tab = 'store') {
  const config = pluginConfig();
  const cats = categoriesOf(catalogList());
  const chips = [`<button type="button" class="chip${view.category ? '' : ' on'}" data-act="plugin-cat" data-cat="">All</button>`]
    .concat(cats.map(([name, count]) => `<button type="button" class="chip${view.category === name ? ' on' : ''}" data-act="plugin-cat" data-cat="${esc(name)}">${esc(name)} ${count}</button>`))
    .join('');
  const needChips = [
    ['', 'Any access'],
    ['none', 'No key'],
    ['key', 'Needs your key'],
    ['signin', 'Sign-in'],
    ['proxy', 'Needs proxy'],
  ].map(([id, label]) => `<button type="button" class="chip${view.needs === id ? ' on' : ''}" data-act="plugin-need" data-need="${esc(id)}">${label}</button>`).join('');
  const store = `<label for="plugin-filter">Search the store</label>
    <input id="plugin-filter" type="search" placeholder="Weather, Wikipedia, GitHub…" value="${esc(view.query)}" autocomplete="off">
    <div class="chip-row">${chips}</div>
    <div class="chip-row">${needChips}</div>
    <div id="plugin-results">${await pluginResultsHTML()}</div>
    <section class="plugin-card">
      <h3>Add a connector by URL</h3>
      <p class="small">Paste a remote MCP server that speaks Streamable HTTP. A token stays encrypted in this browser.</p>
      <label for="custom-name">Name</label>
      <input id="custom-name" maxlength="80" placeholder="My server">
      <label for="custom-url">MCP URL</label>
      <input id="custom-url" placeholder="https://example.com/mcp" autocomplete="off" spellcheck="false">
      <label for="custom-auth">Access</label>
      <select id="custom-auth">
        <option value="none">No key</option>
        <option value="bearer">Bearer token</option>
        <option value="header">API key header</option>
        <option value="oauth">OAuth sign-in</option>
      </select>
      <label for="custom-header">Header name</label>
      <input id="custom-header" placeholder="X-API-Key" autocomplete="off">
      <label for="custom-secret">Token or key</label>
      <input id="custom-secret" type="password" autocomplete="off">
      <div class="row"><button type="button" data-act="add-custom-mcp">Add connector</button></div>
    </section>
    <section class="plugin-card">
      <h3>Limits</h3>
      <label for="max-steps">Max tool steps</label>
      <input id="max-steps" type="number" min="1" max="8" value="${esc(String(config.maxSteps))}">
      <label for="worker-url">Proxy URL</label>
      <input id="worker-url" placeholder="${esc(DEFAULT_WORKER_URL)}" value="${esc(config.workerUrl || DEFAULT_WORKER_URL)}" autocomplete="off" spellcheck="false">
      <p class="small muted">The proxy is filled in with https://agora-connectors.knoel99-morcik.workers.dev. Paste another URL to use your own Worker.</p>
      <button type="button" data-act="save-plugin-settings">Save limits</button>
    </section>`;
  const panel = tab === 'accounts'
    ? connectorsHTML({ embedded: true })
    : tab === 'connected'
      ? connectedHTML()
      : store;
  return `<h2 id="modal-title">Connectors</h2>
    <div class="chip-row" role="tablist">
      <button type="button" class="chip${tab === 'store' ? ' on' : ''}" data-act="connector-tab" data-tab="store">Store</button>
      <button type="button" class="chip${tab === 'connected' ? ' on' : ''}" data-act="connector-tab" data-tab="connected">Connected</button>
      <button type="button" class="chip${tab === 'accounts' ? ' on' : ''}" data-act="connector-tab" data-tab="accounts">Accounts</button>
    </div>
    <div id="connector-panel">${panel}</div>
    <div class="row"><button type="button" class="ghost" data-act="close-modal">Close</button></div>`;
}

export function setPluginQuery(query) {
  view.query = query;
  shown = 48;
}

export function setPluginCategory(category) {
  view.category = category;
  shown = 48;
}

export function setPluginNeeds(needs) {
  view.needs = needs;
  shown = 48;
}

export function showMorePlugins() {
  shown += 48;
}
