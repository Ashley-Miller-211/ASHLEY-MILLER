'use strict';

const SHELL_CACHE = 'space-explorer-shell-v1';
const API_CACHE = 'space-explorer-api-v1';
const APP_SHELL = [
  './space-explorer.html',
  './manifest.json',
  './service-worker.js',
  './icons/space-explorer.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter(name => name.startsWith('space-explorer-') && ![SHELL_CACHE, API_CACHE].includes(name))
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function notifyClients(type) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach(client => client.postMessage({ type }));
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && response.type !== 'opaque') {
      await cache.put(request, response.clone()).catch(() => {});
      await notifyClients('network-restored');
      return response;
    }
    return (await cache.match(request)) || response;
  } catch {
    await notifyClients('offline-fallback');
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ msg: 'Offline and no cached NASA response is available.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isApodApi = url.hostname === 'api.nasa.gov';
  const isNasaArchiveApi = url.hostname === 'science.nasa.gov' && url.pathname.startsWith('/wp-json/wp/v2/image-article');

  if (isApodApi || isNasaArchiveApi) {
    event.respondWith(networkFirst(request));
    return;
  }

  const appScope = new URL(self.registration.scope);
  if (url.origin === appScope.origin && url.pathname.startsWith(appScope.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});