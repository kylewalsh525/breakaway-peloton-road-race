/* Offline solo play only. API data, bearer tokens, race state and audio are NEVER cached. */
const CACHE = 'breakaway-shell-0.9.0';
const ASSETS = ['/', '/index.html', '/styles.css', '/legacy.js', '/app.mjs', '/ui.mjs', '/renderer.mjs', '/audio.mjs', '/bike.mjs', '/speech.mjs', '/network.mjs', '/storage.mjs', '/icon.svg', '/manifest.webmanifest',
    '/shared/protocol.mjs', '/shared/tracks.mjs', '/shared/simulation.mjs', '/shared/telemetry.mjs', '/shared/voice.mjs', '/shared/profile.mjs'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('breakaway-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/'))
        return;
    if (event.request.mode === 'navigate') {
        event.respondWith(fetch(event.request).catch(() => caches.match('/')));
        return;
    }
    if (ASSETS.includes(url.pathname))
        event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request)));
});
