// UPGit service worker — deliberately minimal scope.
//
// WHAT'S CACHED: the static app shell only (HTML/CSS/JS/manifest/icons)
// so the UI can load offline. WHAT'S NEVER CACHED: anything under /api/
// — that's every GitHub token, session cookie response, repo content,
// commit data, and issue/PR data in this app. Offline mode here means
// "the UI loads and tells you you're offline," not "your private repo
// data is available offline." That distinction is intentional per the
// app's own security rules (see README).

// v2: bumped on purpose — this alone forces every existing installed
// service worker to treat the new file as a different version, delete
// the old (stale) cache in activate(), and take over immediately
// (skipWaiting + clients.claim() below already do the "immediately"
// part). Bump this string again on any future deploy that changes
// shell files, or returning visitors will keep seeing old cached code
// no matter how the fetch strategy below behaves.
const CACHE_NAME = 'upgit-shell-v2';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/theme.js',
  '/js/i18n.js',
  '/js/quickActions.js',
  '/js/repo.js',
  '/js/repoTabs.js',
  '/js/diff.js',
  '/js/editor.js',
  '/js/upload.js',
  '/js/org.js',
  '/js/activity.js',
  '/js/settings.js',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-maskable.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept API calls — always hit the network, never cache.
  // This is the line that keeps tokens/private data out of the cache.
  if (url.pathname.startsWith('/api/')) return;

  // Only handle same-origin GET requests for the shell; let everything
  // else (cross-origin CDN modules, POST/PUT/DELETE) pass through
  // untouched.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Network-first, cache as offline fallback only. The previous
  // cache-first strategy meant that once a browser had the shell
  // cached, it would keep serving that exact snapshot forever — even
  // after a new deploy — until the cache name itself changed. This
  // way, every load tries the network (i.e. the current deployment)
  // first, and only falls back to the cached copy when the network is
  // unavailable.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
