// Declarative HTTP tools. URLs come from the catalog. Arguments are encoded.
import { assertPublicHttpUrl } from './tools.js';
import { LOCAL_TOOLS } from './plugin-local.js';

function getPath(bag, path) {
  let cur = bag;
  for (const part of String(path).split('.')) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

export function fillTemplate(template, bag) {
  return String(template).replace(/\{([a-zA-Z0-9_.]+)\}/g, (_, path) => {
    const value = getPath(bag, path);
    if (value == null || value === '') throw new Error(`Missing ${path}.`);
    return encodeURIComponent(String(value));
  });
}

function clip(text, max = 1600) {
  const s = String(text || '');
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function presentWiki(data) {
  const title = data.title || data.titles?.normalized || 'Page';
  const extract = data.extract || data.description || '';
  const url = data.content_urls?.desktop?.page || '';
  if (!extract && data.type === 'disambiguation') return `${title} is a disambiguation page. ${url}`.trim();
  return clip([title, url, extract].filter(Boolean).join('\n'));
}

function presentOpenSearch(data) {
  if (!Array.isArray(data) || !Array.isArray(data[1])) return clip(JSON.stringify(data));
  const titles = data[1];
  const urls = data[3] || [];
  const lines = titles.slice(0, 5).map((title, i) => `- ${title}${urls[i] ? ` — ${urls[i]}` : ''}`);
  return lines.length ? lines.join('\n') : 'No matches.';
}

function presentRss(xml) {
  const text = String(xml || '');
  const chunks = [...text.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].slice(0, 8);
  if (!chunks.length) return 'No stories in that feed.';
  const lines = chunks.map((match) => {
    const block = match[0];
    const title = (block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i) || [])[1] || 'Story';
    const href = (block.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1]
      || (block.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1]
      || '';
    return `- ${title.replace(/<[^>]+>/g, '').trim()}${href ? ` — ${href.trim()}` : ''}`;
  });
  return lines.join('\n');
}

function presentWeather(data) {
  const current = data.current || {};
  const bits = [];
  if (current.temperature_2m != null) bits.push(`${current.temperature_2m}°`);
  if (current.wind_speed_10m != null) bits.push(`wind ${current.wind_speed_10m}`);
  if (current.weather_code != null) bits.push(`code ${current.weather_code}`);
  const place = data.timezone ? ` (${data.timezone})` : '';
  return bits.length ? `Weather${place}: ${bits.join(', ')}.` : clip(JSON.stringify(data));
}

function presentAuto(data) {
  if (typeof data === 'string') return clip(data.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  if (data == null) return 'No data.';
  return clip(JSON.stringify(data, null, 2));
}

const PRESENT = {
  wiki: presentWiki,
  opensearch: presentOpenSearch,
  rss: presentRss,
  weather: presentWeather,
  auto: presentAuto,
};

async function readBody(res) {
  const text = await res.text();
  const type = res.headers?.get?.('content-type') || '';
  if (!res.ok) throw new Error(`The service answered ${res.status}.`);
  if (type.includes('json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
    try { return JSON.parse(text); } catch { return text; }
  }
  return text;
}

async function directGet(url, fetchImpl, signal, headers) {
  const res = await fetchImpl(url, { signal, headers: { Accept: 'application/json, application/rss+xml, application/xml, text/xml, text/plain, */*', ...headers } });
  return readBody(res);
}

async function proxyGet(workerUrl, url, fetchImpl, signal) {
  if (!workerUrl) {
    throw new Error('This connector needs the Agora proxy. Deploy the Worker and paste its URL in Connectors.');
  }
  const res = await fetchImpl(`${workerUrl}/proxy`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ url }),
  });
  const data = await readBody(res);
  if (data && typeof data === 'object' && 'body' in data) {
    if (data.status && data.status >= 400) throw new Error(`The service answered ${data.status}.`);
    const body = String(data.body || '');
    if (body.trim().startsWith('{') || body.trim().startsWith('[')) {
      try { return JSON.parse(body); } catch { return body; }
    }
    return body;
  }
  return data;
}

function withKey(url, plugin, key) {
  if (plugin.needs !== 'key' && plugin.auth !== 'key') return { url, headers: {} };
  if (!key) throw new Error(`Paste your ${plugin.name} key in Connectors. It stays in this browser.`);
  const spec = plugin.key || { in: 'query', name: 'api_key' };
  if (spec.in === 'header') {
    return { url, headers: { [spec.name]: `${spec.prefix || ''}${key}` } };
  }
  const next = new URL(url);
  next.searchParams.set(spec.name || 'api_key', key);
  return { url: next.toString(), headers: {} };
}

export async function runHttpTool(plugin, tool, args, { fetchImpl = fetch, signal, workerUrl = '', key = '' } = {}) {
  if (plugin.local) {
    const fn = LOCAL_TOOLS[tool.name] || LOCAL_TOOLS[plugin.local];
    if (!fn) throw new Error('That local tool is not available.');
    return String(await fn(args || {}));
  }
  const bag = { ...(args || {}) };
  const steps = tool.steps || (tool.get ? [{ url: tool.get, as: 'out' }] : []);
  if (!steps.length) throw new Error('That connector has no request.');
  let last = null;
  for (const step of steps) {
    const raw = fillTemplate(step.url, bag);
    const safe = assertPublicHttpUrl(raw);
    const authed = withKey(safe, plugin, key);
    const viaProxy = plugin.via === 'proxy';
    const keyed = plugin.needs === 'key' || plugin.auth === 'key';
    if (keyed && viaProxy) throw new Error('A key is sent only from this browser, and that service does not allow the call.');
    try {
      last = viaProxy
        ? await proxyGet(workerUrl, authed.url, fetchImpl, signal)
        : await directGet(authed.url, fetchImpl, signal, authed.headers);
    } catch (err) {
      const blocked = err?.name === 'TypeError' || /failed to fetch|network/i.test(String(err?.message || ''));
      if (!viaProxy && !keyed && blocked && workerUrl) last = await proxyGet(workerUrl, authed.url, fetchImpl, signal);
      else throw err;
    }
    if (step.as) bag[step.as] = last;
  }
  const present = PRESENT[tool.present] || presentAuto;
  const text = present(last);
  return key ? text.split(key).join('••••') : text;
}
