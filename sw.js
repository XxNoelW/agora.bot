// Shell v3 precaches the app, including share and stats. The runtime cache keeps Agora 1.0 and Agora vision.
import { CACHE_NAME, RUNTIME_CACHE, SHELL_FILES, shouldCache, shouldRuntimeCache } from './js/shell-cache.js';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const base = new URL('./', self.location);
    await Promise.all(SHELL_FILES.map(async (file) => {
      try {
        const res = await fetch(new URL(file, base));
        if (res.ok) await cache.put(new URL(file, base), res);
      } catch { /* a missing shell file should not block install */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('agora-shell-') && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (shouldRuntimeCache(request.url)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const hit = await cache.match(request);
      if (hit) return hit;
      try {
        const fresh = await fetch(request);
        if (fresh.ok) await cache.put(request, fresh.clone());
        return fresh;
      } catch {
        return hit || Response.error();
      }
    })());
    return;
  }
  if (!shouldCache(request.url, self.location.origin)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(request);
    try {
      const fresh = await fetch(request);
      if (fresh.ok) cache.put(request, fresh.clone());
      return fresh;
    } catch {
      return hit || cache.match(new URL('index.html', self.location));
    }
  })());
});
