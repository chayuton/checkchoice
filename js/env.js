// ตรวจว่าเบราว์เซอร์มีฟีเจอร์ที่แอปต้องใช้ ถ้าไม่มีให้บอกสาเหตุและวิธีแก้ แทนข้อความผิดพลาดทางเทคนิค
import { h, clear } from './ui.js';
import { platform } from './pwa.js';

export const PROBLEM = {
  indexedDB: 'indexedDB',          // ไม่มี IndexedDB เลย (เช่น iPhone ที่เปิดโหมดล็อกดาวน์)
  storageBlocked: 'storageBlocked', // มี IndexedDB แต่เปิดไม่ได้ (เช่น ปิดกั้นคุกกี้/ข้อมูลเว็บไซต์)
  webassembly: 'webassembly',      // ไม่มี WebAssembly ใช้ประมวลผลภาพไม่ได้
};

function hasIndexedDB() {
  try { return typeof indexedDB !== 'undefined' && indexedDB !== null; } catch (e) { return false; }
}

export function hasWebAssembly() {
  try { return typeof WebAssembly === 'object' && WebAssembly !== null && typeof WebAssembly.instantiate === 'function'; } catch (e) { return false; }
}

/** ลองเปิดฐานข้อมูลทดสอบ (บางเบราว์เซอร์มีตัวแปร indexedDB แต่ใช้งานจริงไม่ได้) */
function probeIndexedDB(timeoutMs = 4000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
    try {
      const req = indexedDB.open('checkchoice-probe', 1);
      req.onsuccess = () => {
        try { req.result.close(); indexedDB.deleteDatabase('checkchoice-probe'); } catch (e) { /* ignore */ }
        finish(true);
      };
      req.onerror = () => finish(false);
      req.onblocked = () => finish(true);
      setTimeout(() => finish(false), timeoutMs);
    } catch (e) {
      finish(false);
    }
  });
}

/** คืนรายการปัญหาที่พบ (ว่าง = พร้อมใช้งาน) */
export async function environmentProblems() {
  const problems = [];
  if (!hasIndexedDB()) problems.push(PROBLEM.indexedDB);
  else if (!(await probeIndexedDB())) problems.push(PROBLEM.storageBlocked);
  if (!hasWebAssembly()) problems.push(PROBLEM.webassembly);
  return problems;
}

const FEATURE_TEXT = {
  [PROBLEM.indexedDB]: 'ที่เก็บข้อมูลในเครื่อง (IndexedDB) ถูกปิดอยู่',
  [PROBLEM.storageBlocked]: 'เบราว์เซอร์ไม่อนุญาตให้เว็บนี้เก็บข้อมูล',
  [PROBLEM.webassembly]: 'ตัวประมวลผลภาพ (WebAssembly) ถูกปิดอยู่',
};

/** หน้าจออธิบายวิธีแก้ (continueAnyway: เปิดแอปต่อได้เมื่อเก็บข้อมูลได้แต่สแกนไม่ได้) */
export function environmentHelp(root, problems, continueAnyway) {
  const p = platform();
  const lockdownLikely = p === 'ios' && (problems.includes(PROBLEM.indexedDB) || problems.includes(PROBLEM.webassembly));
  const steps = (items) => h('ol', { class: 'help-steps' }, items.map((t) => h('li', null, t)));

  const iosSection = h('section', { class: 'form-section' },
    h('h2', { class: 'section-title' }, lockdownLikely ? 'สาเหตุที่น่าจะเป็น: โหมดล็อกดาวน์ของ iPhone/iPad' : 'ถ้าใช้ iPhone หรือ iPad'),
    h('p', { class: 'section-help' }, 'โหมดล็อกดาวน์ (Lockdown Mode) ปิดที่เก็บข้อมูลและตัวประมวลผลภาพของเว็บใน Safari ทำให้แอปนี้ทำงานไม่ได้ ต้องปิดโหมดนี้ทั้งเครื่อง'),
    steps([
      'เปิดแอป การตั้งค่า → ความเป็นส่วนตัวและความปลอดภัย',
      'เลื่อนลงล่างสุด แตะ โหมดล็อกดาวน์ → ปิดโหมดล็อกดาวน์',
      'แตะ ปิดและรีสตาร์ท แล้วรอเครื่องเปิดใหม่',
      'เปิด Safari กลับมาที่หน้านี้อีกครั้ง',
    ]),
    h('p', { class: 'section-help' }, 'การยกเว้นเฉพาะเว็บไซต์นี้ (ปุ่ม aA → การตั้งค่าเว็บไซต์) ยังไม่พอ เพราะ iOS 17.4 ขึ้นไปยังปิดตัวประมวลผลภาพไว้แม้จะยกเว้นเว็บไซต์แล้ว'));

  const otherSection = h('section', { class: 'form-section' },
    h('h2', { class: 'section-title' }, 'สาเหตุอื่นที่พบได้'),
    h('ul', { class: 'help-steps' },
      h('li', null, 'เปิดลิงก์จากในแอป LINE, Facebook หรือ Messenger: แตะเมนู ⋯ แล้วเลือกเปิดใน Safari หรือ Chrome'),
      h('li', null, 'ตั้งค่าปิดกั้นคุกกี้ทั้งหมด (การตั้งค่า → Safari → ปิดกั้นคุกกี้ทั้งหมด): ปิดตัวเลือกนี้ก่อน'),
      h('li', null, 'เบราว์เซอร์รุ่นเก่ามาก: อัปเดต iOS/Android หรือใช้ Safari, Chrome, Edge รุ่นล่าสุด')));

  clear(root).append(
    h('header', { class: 'appbar' },
      h('span', { class: 'wordmark' }, h('span', { class: 'wordmark-box', 'aria-hidden': 'true' }), h('span', { class: 'wordmark-text' }, 'CheckChoice'))),
    h('main', { class: 'page page-form', id: 'env-help' },
      h('h1', { class: 'page-title' }, 'เบราว์เซอร์นี้ยังใช้ CheckChoice ไม่ได้'),
      h('div', { class: 'notice notice-error' },
        h('p', null, 'สิ่งที่ขาดไป:'),
        h('ul', { class: 'help-steps' }, problems.map((x) => h('li', null, FEATURE_TEXT[x] || x)))),
      p === 'ios' ? iosSection : null,
      otherSection,
      p !== 'ios' ? iosSection : null,
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-primary btn-large', onclick: () => location.reload() }, 'ลองใหม่'),
        continueAnyway ? h('button', { type: 'button', class: 'btn btn-quiet', onclick: continueAnyway },
          'เปิดแอปต่อ (ดูผลและส่งออกได้ แต่สแกนไม่ได้)') : null)));
}
