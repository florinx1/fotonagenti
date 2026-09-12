var CACHE_NAME = "foton-agenti-v12";
var APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./config.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/brand/foton.png",
  "./icons/brand/intercargo.png",
  "./lib/leaflet/leaflet.js",
  "./lib/leaflet/leaflet.css",
  "./lib/leaflet/images/marker-icon.png",
  "./lib/leaflet/images/marker-icon-2x.png",
  "./lib/leaflet/images/marker-shadow.png",
  "./lib/leaflet/images/layers.png",
  "./lib/leaflet/images/layers-2x.png",
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(APP_SHELL);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

// Network-first for API calls (Google Apps Script), cache-first for the app shell.
self.addEventListener("fetch", function (event) {
  var req = event.request;
  var url = new URL(req.url);

  if (req.method !== "GET") return; // let POSTs go straight to network

  if (url.origin !== self.location.origin) {
    // API / cross-origin requests: try network, don't cache (data must stay fresh)
    event.respondWith(
      fetch(req).catch(function () {
        return new Response(JSON.stringify({ ok: false, error: "offline" }), {
          headers: { "Content-Type": "application/json" },
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(function (cached) {
      var networkFetch = fetch(req).then(function (res) {
        caches.open(CACHE_NAME).then(function (cache) { cache.put(req, res.clone()); });
        return res;
      }).catch(function () { return cached; });
      return cached || networkFetch;
    })
  );
});
