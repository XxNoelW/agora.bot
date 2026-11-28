// The store reads data/plugins.json. Tests can inject a catalog with setCatalog.
let catalog = null;

export function setCatalog(data) {
  catalog = Array.isArray(data) ? data : [];
  return catalog;
}

export function peekCatalog() {
  return catalog;
}

export async function loadCatalog(fetchImpl = fetch) {
  if (catalog) return catalog;
  const url = new URL('../data/plugins.json', import.meta.url);
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error('The plugin catalog did not load.');
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('The plugin catalog is not a list.');
  catalog = data;
  return catalog;
}

export function categoriesOf(list = catalog || []) {
  const counts = new Map();
  for (const plugin of list) {
    const name = plugin.category || 'Other';
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export function filterCatalog(list, { query = '', category = '', needs = '' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  return (list || []).filter((plugin) => {
    if (category && plugin.category !== category) return false;
    if (needs && plugin.needs !== needs) return false;
    if (!q) return true;
    const hay = [plugin.name, plugin.category, plugin.summary, ...(plugin.keywords || [])].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

export function pluginById(id, list = catalog || []) {
  return list.find((plugin) => plugin.id === id) || null;
}

export function toolIndex(list = catalog || []) {
  const map = new Map();
  for (const plugin of list) {
    for (const tool of plugin.tools || []) {
      if (tool?.name) map.set(tool.name, { plugin, tool });
    }
  }
  return map;
}
