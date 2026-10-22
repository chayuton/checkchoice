// เส้นทางหน้าจอ ส่วนหัว และการป้องกันการออกจากหน้าที่ยังไม่บันทึก
import { h, clear, icon } from './ui.js';

let routes = [];
let cleanup = null;
let guard = null;
let currentHash = '#/';
let ignoreNext = false;

/** หน้าจอที่มีงานค้างตั้งฟังก์ชันนี้ คืนค่า true (หรือ Promise<true>) เมื่อออกได้ */
export function setLeaveGuard(fn) { guard = fn; }

export function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

async function render() {
  const hash = location.hash || '#/';
  if (cleanup) { try { cleanup(); } catch (e) { /* ignore */ } }
  cleanup = null;
  guard = null;
  const root = document.getElementById('app');
  for (const [re, view] of routes) {
    const m = hash.match(re);
    if (!m) continue;
    clear(root);
    window.scrollTo(0, 0);
    try {
      const c = await view(root, ...m.slice(1));
      cleanup = typeof c === 'function' ? c : null;
    } catch (err) {
      console.error(err);
      clear(root).append(appBar({ title: 'เกิดข้อผิดพลาด', back: '#/' }),
        h('main', { class: 'page' }, h('p', { class: 'notice notice-error' }, String((err && err.message) || err))));
    }
    return;
  }
  location.replace('#/');
}

export function startRouter(list) {
  routes = list;
  currentHash = location.hash || '#/';
  window.addEventListener('hashchange', async () => {
    if (ignoreNext) { ignoreNext = false; return; }
    if (guard) {
      const ok = await guard();
      if (!ok) { ignoreNext = true; location.hash = currentHash; return; }
    }
    currentHash = location.hash || '#/';
    render();
  });
  window.addEventListener('beforeunload', (e) => {
    if (guard) { e.preventDefault(); e.returnValue = ''; }
  });
  render();
}

export function appBar({ title, subtitle, back, actions }) {
  return h('header', { class: 'appbar' },
    back ? h('a', { class: 'icon-btn', href: back, 'aria-label': 'ย้อนกลับ' }, icon('back')) :
      h('a', { class: 'wordmark', href: '#/', 'aria-label': 'CheckChoice หน้าแรก' },
        h('span', { class: 'wordmark-box', 'aria-hidden': 'true' }), h('span', { class: 'wordmark-text' }, 'CheckChoice')),
    h('div', { class: 'appbar-title' },
      title ? h('h1', null, title) : null,
      subtitle ? h('p', { class: 'appbar-sub' }, subtitle) : null),
    h('div', { class: 'appbar-actions' }, actions || []));
}
