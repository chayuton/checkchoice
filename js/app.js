// จุดเริ่มต้นของแอป: เส้นทางหน้าจอ, service worker และการติดตั้ง
import { h, toast } from './ui.js';
import { startRouter } from './nav.js';
import { homeView } from './views/home.js';
import { examView } from './views/exam.js';
import { scanView } from './views/scan.js';
import { resultsView } from './views/results.js';
import { resultView } from './views/result.js';
import { printView } from './views/print.js';
import { settingsView } from './views/settings.js';
import { importView } from './views/import.js';
import { install } from './pwa.js';
import { environmentProblems, environmentHelp, PROBLEM } from './env.js';

const routes = [
  [/^#\/?$/, (root) => homeView(root)],
  [/^#\/exam\/new$/, (root) => examView(root, null)],
  [/^#\/exam\/([\w-]+)$/, (root, id) => examView(root, id)],
  [/^#\/exam\/([\w-]+)\/scan$/, (root, id) => scanView(root, id)],
  [/^#\/exam\/([\w-]+)\/results$/, (root, id) => resultsView(root, id)],
  [/^#\/exam\/([\w-]+)\/result\/(\d+)$/, (root, id, no) => resultView(root, id, Number(no))],
  [/^#\/exam\/([\w-]+)\/print$/, (root, id) => printView(root, id)],
  [/^#\/import\/([A-Za-z0-9_-]+)$/, (root, payload) => importView(root, payload)],
  [/^#\/settings$/, (root) => settingsView(root)],
];

// ตรวจความพร้อมของเบราว์เซอร์ก่อนเปิดแอป (เช่น iPhone ที่เปิดโหมดล็อกดาวน์จะไม่มี IndexedDB/WebAssembly)
environmentProblems().then((problems) => {
  const root = document.getElementById('app');
  const storageOk = !problems.includes(PROBLEM.indexedDB) && !problems.includes(PROBLEM.storageBlocked);
  if (!problems.length) { startRouter(routes); return; }
  environmentHelp(root, problems, storageOk ? () => startRouter(routes) : null);
});

// ---------------------------------------------------------------------------
// Service worker (ใช้งานออฟไลน์)
// ---------------------------------------------------------------------------
let updateRequested = false;

function showUpdateBanner(reg) {
  if (document.getElementById('update-banner')) return;
  const bar = h('div', { id: 'update-banner', class: 'update-banner', role: 'status' },
    h('span', null, 'มีแอปเวอร์ชันใหม่'),
    h('button', { class: 'btn btn-small btn-primary', onclick: () => {
      updateRequested = true;
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      bar.remove();
    } }, 'อัปเดตเลย'));
  document.body.appendChild(bar);
}

const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && secure) {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg);
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(reg);
      });
    });
  }).catch((err) => console.warn('service worker', err));
  // โหลดหน้าใหม่เฉพาะเมื่อผู้ใช้กด "อัปเดตเลย" (ครั้งแรกที่ติดตั้งไม่ต้องโหลดใหม่ งานที่ทำอยู่จะได้ไม่หาย)
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateRequested || refreshing) return;
    refreshing = true;
    location.reload();
  });
}

window.addEventListener('appinstalled', () => {
  install.prompt = null;
  toast('ติดตั้งแอปแล้ว เปิดได้จากหน้าจอหลัก');
});
