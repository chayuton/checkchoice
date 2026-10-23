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
import { receiveView } from './views/receive.js';
import { libraryView } from './views/library.js';
import { templatesView, templateDetailView, templateEditView, templatePrintView } from './views/templates.js';
import { trainingView } from './views/training.js';
import { install } from './pwa.js';
import { initStorage } from './db.js';
import { detectCapabilities, environmentHelp } from './env.js';

const routes = [
  [/^#\/?$/, (root) => homeView(root)],
  [/^#\/library$/, (root) => libraryView(root)],
  [/^#\/exam\/new$/, (root) => examView(root, null)],
  [/^#\/exam\/new\/([\w-]+)$/, (root, tpl) => examView(root, null, tpl)],
  [/^#\/exam\/([\w-]+)$/, (root, id) => examView(root, id)],
  [/^#\/exam\/([\w-]+)\/scan$/, (root, id) => scanView(root, id)],
  [/^#\/exam\/([\w-]+)\/results$/, (root, id) => resultsView(root, id)],
  [/^#\/exam\/([\w-]+)\/result\/(\d+)$/, (root, id, no) => resultView(root, id, Number(no))],
  [/^#\/exam\/([\w-]+)\/print$/, (root, id) => printView(root, id)],
  [/^#\/import\/([A-Za-z0-9_-]+)$/, (root, payload) => importView(root, payload)],
  [/^#\/receive$/, (root) => receiveView(root)],
  [/^#\/templates$/, (root) => templatesView(root)],
  [/^#\/templates\/new$/, (root) => templateEditView(root, null)],
  [/^#\/templates\/([\w-]+)\/edit$/, (root, id) => templateEditView(root, id)],
  [/^#\/templates\/([\w-]+)\/print$/, (root, id) => templatePrintView(root, id)],
  [/^#\/templates\/([\w-]+)$/, (root, id) => templateDetailView(root, id)],
  [/^#\/training$/, (root) => trainingView(root)],
  [/^#\/settings$/, (root) => settingsView(root)],
];

// แท็บอื่นยังเปิดแอปเวอร์ชันเก่าค้างไว้ ทำให้ปรับที่เก็บข้อมูลเป็นเวอร์ชันใหม่ไม่ได้จนกว่าแท็บนั้นจะปิด
window.addEventListener('checkchoice:db-blocked', () => {
  if (document.getElementById('db-blocked')) return;
  document.body.appendChild(h('div', { id: 'db-blocked', class: 'update-banner db-blocked', role: 'alert' },
    h('span', null, 'แอปเวอร์ชันใหม่ต้องปรับที่เก็บข้อมูลก่อน กรุณาปิดแท็บหรือหน้าต่างอื่นของ CheckChoice ที่เปิดค้างไว้ แล้วหน้านี้จะเปิดต่อเอง')));
});
window.addEventListener('checkchoice:db-ready', () => {
  const el = document.getElementById('db-blocked');
  if (el) el.remove();
});

// เลือกที่เก็บข้อมูลก่อนเปิดแอป: ปกติใช้ IndexedDB ถ้าเบราว์เซอร์ปิดไว้ (เช่น iPhone ที่เปิดโหมดล็อกดาวน์)
// ใช้ที่เก็บสำรองแทน และเปิดหน้าอธิบายเฉพาะเมื่อเก็บข้อมูลไม่ได้เลย
initStorage().then((storage) => {
  const c = detectCapabilities(storage);
  if (c.storage === 'none') { environmentHelp(document.getElementById('app')); return; }
  startRouter(routes);
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
