// 表紙めくり — offline support.
// Keeps a copy of the app itself (index.html, manifest, icons) so the
// home-screen app opens even without a connection. The page is always
// fetched fresh from the network first, so an uploaded new index.html is
// used on the next launch; the saved copy is used only when the network
// fails or takes longer than a few seconds. Your PDFs are not involved
// here -- they stay in the app's own storage.
var CACHE = "hyoushi-mekuri-shell-v1";
var SHELL = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];
var NETWORK_TIMEOUT_MS = 4000;

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // One missing file must not stop the rest from being saved.
      return Promise.all(SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: "reload" })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k.indexOf("hyoushi-mekuri-shell-") === 0 && k !== CACHE;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function savedPage(request) {
  return caches.match(request, { ignoreSearch: true }).then(function (hit) {
    return hit || caches.match("./index.html");
  }).then(function (hit) {
    return hit || caches.match("./");
  });
}

function networkFirst(request) {
  return new Promise(function (resolve) {
    var settled = false;
    function finish(response) {
      if (settled || !response) return false;
      settled = true;
      resolve(response);
      return true;
    }
    var timer = setTimeout(function () {
      savedPage(request).then(function (hit) { finish(hit); });
    }, NETWORK_TIMEOUT_MS);
    fetch(request, { cache: "no-store" }).then(function (response) {
      clearTimeout(timer);
      if (response && response.ok) {
        var copy = response.clone();
        caches.open(CACHE).then(function (cache) {
          return Promise.all([cache.put(request, copy.clone()), cache.put("./index.html", copy)]);
        }).catch(function () {});
        finish(response);
      } else {
        // e.g. a 404 while GitHub Pages is updating: prefer the saved copy
        savedPage(request).then(function (hit) { if (!finish(hit)) finish(response); });
      }
    }).catch(function () {
      clearTimeout(timer);
      savedPage(request).then(function (hit) {
        if (!finish(hit)) finish(Response.error());
      });
    });
  });
}

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // fonts etc.: browser default
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }
  // manifest / icons: saved copy first, refreshed in the background
  event.respondWith(
    caches.match(request).then(function (hit) {
      var fresh = fetch(request).then(function (response) {
        if (response && response.ok) {
          var copy = response.clone();
          caches.open(CACHE).then(function (cache) { return cache.put(request, copy); }).catch(function () {});
        }
        return response;
      }).catch(function () { return hit || Response.error(); });
      return hit || fresh;
    })
  );
});
