// Curated connector catalog. Rebuilds data/plugins.json from scripts/kept-plugins.json
// plus official remote MCP servers checked against a live initialize call.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const kept = JSON.parse(readFileSync(new URL('./kept-plugins.json', import.meta.url), 'utf8'));

function patch(plugin) {
  if (plugin.id === 'mcp-cloudflare') {
    plugin.summary = 'Official Cloudflare MCP for the Cloudflare API, including Workers, DNS, R2, and D1. Needs your API token. Browser calls need the proxy.';
    plugin.keywords = ['cloudflare', 'workers', 'dns', 'r2', 'd1'];
  }
  if (plugin.id === 'mcp-atlassian') {
    plugin.mcp = 'https://mcp.atlassian.com/v2/mcp';
    plugin.summary = 'Official Atlassian MCP for Jira and Confluence. Needs sign-in.';
    plugin.keywords = ['jira', 'confluence', 'atlassian'];
  }
  if (plugin.id === 'mcp-huggingface') {
    plugin.keywords = ['hugging face', 'huggingface'];
  }
  if (plugin.id === 'wikipedia') {
    plugin.summary = 'Search and read English Wikipedia. No key. One Wikipedia connector, not a copy per language.';
    plugin.keywords = ['wikipedia', 'wiki'];
  }
  return plugin;
}

const added = [
  ['mcp-discord', 'Discord', 'https://mcp.discord.com/mcp', 'https://discord.com/developers/docs/intro', 'oauth', 'signin', false, 'Official Discord MCP. Needs sign-in. Browser calls need the proxy.'],
  ['mcp-dropbox', 'Dropbox', 'https://mcp.dropbox.com/mcp', 'https://www.dropbox.com/developers', 'oauth', 'signin', false, 'Official Dropbox MCP. Needs sign-in. Browser calls need the proxy.'],
  ['mcp-x', 'X', 'https://api.x.com/mcp', 'https://docs.x.com/', 'oauth', 'signin', false, 'Official X MCP. Needs sign-in. Browser calls need the proxy.'],
  ['mcp-shopify', 'Shopify', 'https://mcp.shopify.com/mcp', 'https://shopify.dev/docs/apps/build/devmcp', 'oauth', 'signin', false, 'Official Shopify MCP. Needs sign-in. The server blocks browser origins until you set the proxy URL.'],
  ['mcp-zendesk', 'Zendesk', 'https://mcp.zendesk.com/mcp', 'https://developer.zendesk.com/', 'oauth', 'signin', false, 'Official Zendesk MCP. Needs sign-in. Browser calls need the proxy.'],
  ['mcp-zoom', 'Zoom', 'https://mcp.zoom.us/mcp/zoom/streamable', 'https://developers.zoom.us/docs/mcp/', 'oauth', 'signin', false, 'Official Zoom MCP for meetings, chat, and docs. Needs sign-in. Browser calls need the proxy.'],
  ['mcp-calendly', 'Calendly', 'https://mcp.calendly.com', 'https://developer.calendly.com/', 'oauth', 'signin', false, 'Official Calendly MCP. Needs sign-in. Browser calls need the proxy.'],
  ['mcp-trello', 'Trello', 'https://mcp.trello.com/v1', 'https://developer.atlassian.com/cloud/trello/', 'oauth', 'signin', true, 'Official Trello MCP. Needs sign-in.'],
  ['mcp-make', 'Make', 'https://mcp.make.com/mcp', 'https://www.make.com/en/integrations', 'oauth', 'signin', true, 'Official Make MCP. Needs sign-in.'],
  ['mcp-agentmail', 'AgentMail', 'https://mcp.agentmail.to/mcp', 'https://www.agentmail.to/', 'oauth', 'signin', true, 'Official AgentMail MCP. Needs sign-in.'],
  ['mcp-kaggle', 'Kaggle', 'https://www.kaggle.com/mcp', 'https://www.kaggle.com/docs', 'none', 'none', false, 'Official Kaggle MCP. No key for the public server. Browser calls need the proxy.'],
  ['mcp-twilio', 'Twilio', 'https://mcp.twilio.com/docs', 'https://www.twilio.com/docs/ai/mcp', 'none', 'none', true, 'Official Twilio docs MCP. No key. It searches Twilio API docs and does not send messages.'],
  ['mcp-salesforce', 'Salesforce', 'https://api.salesforce.com/platform/mcp/v1/platform/sobject-all', 'https://developer.salesforce.com/', 'bearer', 'key', false, 'Official Salesforce MCP for sObjects. Needs your token. Browser calls need the proxy.'],
].map(([id, name, mcp, homepage, auth, needs, cors, summary]) => ({
  id,
  name,
  category: 'Accounts',
  icon: '🔌',
  summary,
  auth,
  needs,
  homepage,
  transport: 'mcp',
  mcp,
  cors,
  keywords: [name.toLowerCase()],
  tools: [],
}));

const plugins = kept.map(patch).concat(added);
const ids = new Set();
const toolNames = new Set();
for (const plugin of plugins) {
  if (!plugin.id || ids.has(plugin.id)) throw new Error(`bad id ${plugin.id}`);
  ids.add(plugin.id);
  if (!plugin.name || !plugin.summary || !plugin.category || !String(plugin.homepage).startsWith('https://')) {
    throw new Error(`incomplete ${plugin.id}`);
  }
  if (plugin.transport === 'mcp' && !String(plugin.mcp).startsWith('https://')) throw new Error(`mcp ${plugin.id}`);
  if (plugin.needs === 'proxy' && plugin.via !== 'proxy') throw new Error(`proxy flag ${plugin.id}`);
  if ((plugin.needs === 'key' || plugin.needs === 'signin') && !/key|sign-in|token/i.test(plugin.summary)) {
    throw new Error(`summary ${plugin.id}`);
  }
  for (const tool of plugin.tools || []) {
    if (toolNames.has(tool.name)) throw new Error(`duplicate tool ${tool.name}`);
    toolNames.add(tool.name);
  }
}
if (plugins.length < 80 || plugins.length > 120) {
  throw new Error(`catalog size ${plugins.length} is outside 80-120`);
}
if (plugins.some((plugin) => plugin.id.startsWith('wiki-') && plugin.id !== 'wikipedia')) {
  throw new Error('per-language Wikipedia entries are not allowed');
}

const out = new URL('../data/plugins.json', import.meta.url);
mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
writeFileSync(out, JSON.stringify(plugins, null, 2));

function hostOf(value) {
  try { return new URL(value).host; } catch { return ''; }
}
const fetchHosts = new Set();
const mcpHosts = new Set();
for (const plugin of plugins) {
  if (plugin.via === 'proxy') {
    for (const tool of plugin.tools || []) {
      const host = hostOf(tool.get || tool.steps?.[0]?.url || '');
      if (host) fetchHosts.add(host);
    }
  }
  if (plugin.transport === 'mcp' && plugin.cors === false) {
    const host = hostOf(plugin.mcp);
    if (host) mcpHosts.add(host);
  }
}
const allowDir = new URL('../workers/agora-connectors/src/', import.meta.url);
mkdirSync(allowDir, { recursive: true });
writeFileSync(new URL('./allow.js', allowDir), `// Generated by scripts/build-plugins.mjs. Public hosts only.
export const FETCH_HOSTS = new Set(${JSON.stringify([...fetchHosts].sort(), null, 2)});
export const MCP_HOSTS = new Set(${JSON.stringify([...mcpHosts].sort(), null, 2)});
`);

const builtin = [
  'web_search', 'read_page', 'fetch_wikipedia_page', 'write_file', 'read_file', 'list_files', 'run_js',
  'remember', 'forget', 'create_routine', 'list_routines', 'cancel_routine',
  'github_list_repos', 'github_list_pages', 'github_list_gists', 'github_create_gist',
];
const lines = [...toolNames].sort();
writeFileSync(new URL('../data/tool-names.txt', import.meta.url), `${lines.join('\n')}\n`);
writeFileSync(new URL('../data/tool-names.json', import.meta.url), JSON.stringify({
  pluginCount: plugins.length,
  pluginTools: lines,
  builtinTools: builtin,
}, null, 2));
console.log(`wrote ${plugins.length} plugins, ${toolNames.size} plugin tools, ${fetchHosts.size} proxy hosts, ${mcpHosts.size} MCP hosts`);
