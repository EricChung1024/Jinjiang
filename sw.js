/* 金匠鍋貼 Service Worker：讓網站可安裝、可離線開啟。
 * 改版時請更新 VERSION，舊快取會自動清除。 */
const VERSION = 'jinjiang-v2';
const CORE = [
  './', './index.html', './manifest.webmanifest',
  './assets/styles.css', './assets/lucide.min.js', './assets/three.min.js', './assets/street3d.js',
  './assets/hero-poster.png',
  './assets/icons/icon-192.png', './assets/icons/icon-512.png', './assets/icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // 外部連結（訂位、點餐、字型）一律走網路

  // 頁面：先走網路拿最新版，失敗（離線）才用快取
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put('./index.html', copy));
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 靜態檔案：先用快取，背景更新
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
