/*
 * SAS Kairós — Service Worker
 *
 * Princípios:
 *  - Nunca cachear APIs, Server Actions, Supabase nem respostas autenticadas de dados.
 *  - Assets imutáveis do Next (/_next/static) → cache-first.
 *  - Ícones/imagens públicas → stale-while-revalidate.
 *  - Navegação → network-first com fallback para /offline (estrutura básica do app).
 *  - Atualização controlada: nova versão espera em "waiting" até o usuário confirmar.
 *
 * Incremente VERSION a cada mudança de estratégia para descartar caches antigos.
 */
const VERSION = "v1";
const STATIC_CACHE = `kairos-static-${VERSION}`;
const SHELL_CACHE = `kairos-shell-${VERSION}`;
const IMAGE_CACHE = `kairos-images-${VERSION}`;
const OFFLINE_URL = "/offline";

const PRECACHE = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE)),
  );
  // Sem skipWaiting automático: o app pergunta ao usuário antes de atualizar.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC_CACHE, SHELL_CACHE, IMAGE_CACHE]);
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("kairos-") && !keep.has(k)).map((k) => caches.delete(k)));
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (type === "CLEAR_PRIVATE_CACHES") {
    // Chamado no logout: remove tudo que não seja asset público imutável.
    event.waitUntil(
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k))),
      ),
    );
  }
  if (type === "GET_VERSION" && event.ports[0]) {
    event.ports[0].postMessage({ version: VERSION });
  }
});

function isNeverCache(request, url) {
  if (request.method !== "GET") return true;
  if (url.origin !== self.location.origin) return true; // Supabase, Asaas, Evolution etc.
  if (url.pathname.startsWith("/api/")) return true;
  if (request.headers.get("Next-Action")) return true; // Server Actions
  if (request.headers.get("RSC") || url.searchParams.has("_rsc")) return true; // payloads RSC
  return false;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (isNeverCache(request, url)) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (url.pathname.startsWith("/icons/") || url.pathname.startsWith("/brand/") || request.destination === "font") {
    event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(event));
  }
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || network;
}

async function networkFirstNavigation(event) {
  try {
    const preload = await event.preloadResponse;
    if (preload) return preload;
    return await fetch(event.request);
  } catch {
    // Páginas autenticadas não são armazenadas: offline mostra a estrutura básica.
    const cache = await caches.open(SHELL_CACHE);
    return (await cache.match(OFFLINE_URL)) || Response.error();
  }
}

// ---------------------------------------------------------------------------
// Notificações push (envio implementado na Fase 10; o SW já sabe exibi-las)
// ---------------------------------------------------------------------------
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data;
  try {
    data = event.data.json();
  } catch {
    return;
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Kairós", {
      body: data.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: data.tag,
      data: { url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/admin" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/admin";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          return client.navigate(target);
        }
      }
      return self.clients.openWindow(target);
    })(),
  );
});
