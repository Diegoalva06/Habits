'use strict';

/* =========================================================
   HABITS — Service worker (PWA)
   - Archivos propios: primero la red (siempre la última versión
     tras un deploy) y, sin internet, la copia guardada.
   - SDK de Supabase y fuentes: llevan versión en la URL, así que
     se sirven desde la caché y solo se descargan una vez.
   - Nunca toca las peticiones a la API de Supabase (datos y login).
   - Muestra los recordatorios push aunque la app esté cerrada.
   Si cambias la lista de SHELL, sube la versión de CACHE.
   ========================================================= */
const CACHE = 'habits-v1';
const SHELL = [
  './', 'index.html', 'styles.css', 'halloween.js', 'config.js', 'core.js', 'db.js', 'app.js',
  'manifest.webmanifest', 'nequi-qr.svg',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
];
// Misma URL que el <script> de index.html: si actualizas la versión allí, cámbiala aquí también.
const SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
const STATIC_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(SHELL);
    // Sin el SDK la app no arranca en modo cuenta; si falla la descarga, se guardará en la próxima visita
    await c.add(new Request(SDK, { mode: 'cors' })).catch(() => {});
  }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true })
      || (req.mode === 'navigate' && await cache.match('index.html'));
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) e.respondWith(networkFirst(req));
  else if (STATIC_HOSTS.includes(url.hostname)) e.respondWith(cacheFirst(req));
  // Cualquier otra cosa (API de Supabase, Turnstile…) va directo a la red
});

/* ---------- Notificaciones push (las envía la Edge Function send-reminders) ---------- */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Habits', {
    body: d.body || '',
    tag: d.tag || undefined,
    icon: 'icons/icon-192.png',
    data: { url: d.url || './' },
  }));
});

// Al tocar la notificación: volver a la app si ya está abierta o abrirla
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.startsWith(self.registration.scope));
    return open ? open.focus() : self.clients.openWindow(target);
  }));
});
