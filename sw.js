/* Service worker: เก็บไฟล์แอปไว้ในเครื่องเพื่อใช้งานออฟไลน์
   - ไฟล์ใน vendor/ fonts/ icons/ (ใหญ่และไม่ค่อยเปลี่ยน): ใช้จากแคชก่อน
   - ไฟล์แอปอื่น ๆ: ดึงจากเครือข่ายก่อน (ได้เวอร์ชันล่าสุดเสมอ) ถ้าออฟไลน์ใช้จากแคช */
const CACHE = 'checkchoice-v7';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/nav.js',
  'js/ui.js',
  'js/db.js',
  'js/store.js',
  'js/pwa.js',
  'js/grid.js',
  'js/overlay.js',
  'js/capture.js',
  'js/review-panel.js',
  'js/export.js',
  'js/env.js',
  'js/transfer.js',
  'js/transfer-ui.js',
  'js/template-draw.js',
  'js/training.js',
  'js/delete-ui.js',
  'js/qr-scan.js',
  'js/qr-worker.js',
  'js/omr/core.js',
  'js/omr/client.js',
  'js/omr/worker.js',
  'js/omr/cvlite.js',
  'js/views/home.js',
  'js/views/exam.js',
  'js/views/scan.js',
  'js/views/results.js',
  'js/views/result.js',
  'js/views/print.js',
  'js/views/settings.js',
  'js/views/import.js',
  'js/views/library.js',
  'js/views/templates.js',
  'js/views/training.js',
  'js/views/receive.js',
  'vendor/opencv.js',
  'vendor/xlsx.mini.min.js',
  'vendor/qrcode.mjs',
  'vendor/jsqr.min.js',
  'vendor/fflate.mjs',
  'fonts/plex-thai-looped-thai-400.woff2',
  'fonts/plex-thai-looped-thai-500.woff2',
  'fonts/plex-thai-looped-thai-600.woff2',
  'fonts/plex-thai-looped-latin-400.woff2',
  'fonts/plex-thai-looped-latin-500.woff2',
  'fonts/plex-thai-looped-latin-600.woff2',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('checkchoice-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

const STATIC = /\/(vendor|fonts|icons)\//;

function timeout(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (STATIC.test(url.pathname)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    })());
    return;
  }

  event.respondWith((async () => {
    try {
      const res = await Promise.race([fetch(req), timeout(5000)]);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    } catch (err) {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const shell = await caches.match('index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
