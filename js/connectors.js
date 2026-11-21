// Account connectors. The model sees names and status, never keys.
import { hasSecret, readSecret, scrubSecrets } from './secrets.js';
import {
  CONNECTOR_SPECS, UNAVAILABLE, asCred, packCred, secretValues, specById, specForTool, intentFor,
} from './connector-api.js';

export { UNAVAILABLE, asCred, packCred };

export const CONNECTORS = CONNECTOR_SPECS;
export const CONNECTOR_IDS = CONNECTOR_SPECS.map((item) => item.id);

const META_KEY = 'agona:connector-meta';
export const connectorView = {};

export function connectorById(id) {
  return specById(id);
}

export function loadConnectorMeta(storage = globalThis.localStorage) {
  try {
    const parsed = JSON.parse(storage?.getItem(META_KEY) || '{}');
    for (const id of CONNECTOR_IDS) {
      const row = parsed[id] && typeof parsed[id] === 'object' ? parsed[id] : {};
      connectorView[id] = {
        state: row.state === 'connected' || row.state === 'failed' ? row.state : 'unknown',
        detail: scrubSecrets(row.detail || ''),
      };
    }
  } catch {
    for (const id of CONNECTOR_IDS) connectorView[id] = { state: 'unknown', detail: '' };
  }
  return connectorView;
}

export function writeConnectorMeta(id, patch, storage = globalThis.localStorage) {
  const current = loadConnectorMeta(storage);
  current[id] = {
    state: patch.state || 'unknown',
    detail: scrubSecrets(patch.detail || '').slice(0, 180),
  };
  const saved = {};
  for (const key of CONNECTOR_IDS) saved[key] = current[key];
  try { storage?.setItem(META_KEY, JSON.stringify(saved)); } catch { /* private mode */ }
  return current[id];
}

export async function testConnector(id, key, fetchImpl = fetch) {
  const spec = specById(id);
  const cred = asCred(key);
  if (spec?.auth !== 'oauth' && !cred.key) return { ok: false, detail: 'Paste a key first.' };
  try {
    if (!spec?.test) return { ok: false, detail: 'That connector does not take a pasted key.' };
    return await spec.test(cred, fetchImpl);
  } catch (err) {
    const who = spec?.name || 'The service';
    const detail = err.status === 401 || err.status === 403
      ? `${who} rejected that token (${err.status}).`
      : scrubSecrets(err.message || 'The test failed.', secretValues(cred));
    return { ok: false, detail };
  }
}

export async function runConnectorAction(id, tool, args = {}, key, fetchImpl = fetch) {
  const spec = specById(id);
  const cred = asCred(key);
  if (!cred.key) return 'That account is not connected.';
  try {
    if (!spec?.run) return 'That account action is not available.';
    const text = await spec.run(tool, args || {}, cred, fetchImpl);
    return scrubSecrets(String(text || ''), secretValues(cred).concat(cred.accessJwt ? [cred.accessJwt] : []));
  } catch (err) {
    return scrubSecrets(err.message || 'The account action failed.', secretValues(cred));
  }
}

export function isConnectorTool(name) {
  return !!specForTool(name);
}

export function toolConnector(name) {
  return specForTool(name)?.id || '';
}

export function agentAllows(agent, id) {
  return Array.isArray(agent?.connectors) && agent.connectors.includes(id);
}

export function matchConnectorIntent(text) {
  return intentFor(text);
}

export function connectorPrompt(agent) {
  const allowed = (agent?.connectors || []).filter((id) => connectorById(id));
  if (!allowed.length) return 'This agent cannot use outside accounts. Never ask for an API key in the chat.';
  const bits = allowed.map((id) => {
    const view = connectorView[id] || { state: 'unknown' };
    const name = connectorById(id).name;
    return `${name} is ${view.state === 'connected' ? 'connected' : 'not connected'}.`;
  });
  return `${bits.join(' ')} Never ask the user to paste a token into the chat. You only know the connector name and whether it is connected.`;
}

export function connectorDecidePrompt(agent) {
  const lines = [];
  for (const spec of CONNECTORS) {
    if (!agentAllows(agent, spec.id) || connectorView[spec.id]?.state !== 'connected') continue;
    for (const tool of spec.tools) lines.push(`TOOL: ${tool.name} ${tool.sig}`);
  }
  return lines.join('\n');
}

export async function executeConnectorTool(agent, name, args = {}, fetchImpl = fetch) {
  const id = toolConnector(name);
  const label = connectorById(id)?.name || 'That account';
  if (!agentAllows(agent, id)) return { text: `${label} is not enabled for this agent.`, connect: '' };
  if (!(await hasSecret(id))) {
    return { text: `${label} is not connected. A connect card is on the page. Do not ask for the key.`, connect: id };
  }
  const stored = await readSecret(id);
  const cred = asCred(stored);
  const nextArgs = { ...args };
  if (id === 'mastodon') nextArgs.host = args.host || (await readSecret('mastodon-host')) || 'mastodon.social';
  const text = await runConnectorAction(id, name, nextArgs, stored, fetchImpl);
  return { text: scrubSecrets(text, secretValues(cred)), connect: '' };
}

export async function fulfillConnectorIntent(agent, intent, fetchImpl = fetch) {
  const spec = connectorById(intent.id);
  const label = spec?.name || 'That account';
  if (!agentAllows(agent, intent.id)) {
    return { text: `${label} is not enabled for ${agent.name}. Turn it on in Connectors.`, connect: intent.id, ran: false };
  }
  if (!(await hasSecret(intent.id))) {
    const how = spec?.auth === 'oauth'
      ? 'Use the sign-in button in Connectors.'
      : 'Use the card below. I cannot see the key.';
    return { text: `${label} is not connected yet. ${how}`, connect: intent.id, ran: false };
  }
  if (!intent.tool) {
    const view = connectorView[intent.id];
    return { text: `${label} is ${view?.state === 'connected' ? 'connected' : 'available'}. ${view?.detail || ''}`.trim(), connect: '', ran: false };
  }
  const outcome = await executeConnectorTool(agent, intent.tool, intent.args, fetchImpl);
  return { ...outcome, ran: !outcome.connect };
}

loadConnectorMeta();
