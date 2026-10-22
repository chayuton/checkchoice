// ตรวจว่าเบราว์เซอร์มีฟีเจอร์ที่แอปต้องใช้ และบอกวิธีแก้เป็นภาษาคน แทนข้อความผิดพลาดทางเทคนิค
//
// Safari บน iPhone/iPad ที่เปิดโหมดล็อกดาวน์ (Lockdown Mode) ปิด IndexedDB (ตั้งแต่ iOS 17),
// WebAssembly, JIT และกล้องสด (getUserMedia) แอปจึงมีโหมดสำรอง: เก็บข้อมูลใน localStorage
// และใช้ตัวอ่านภาพที่เขียนด้วย JavaScript ล้วน ใช้งานได้แต่ช้ากว่า ถ้าปิดโหมดล็อกดาวน์เฉพาะเว็บนี้
// (ปุ่ม aA → การตั้งค่าเว็บไซต์) จะกลับมาทำงานเต็มความสามารถโดยไม่ต้องปิดทั้งเครื่อง
import { h, clear } from './ui.js';
import { platform, isStandalone } from './pwa.js';

export function hasWebAssembly() {
  try { return typeof WebAssembly === 'object' && WebAssembly !== null && typeof WebAssembly.instantiate === 'function'; } catch (e) { return false; }
}

function hasCamera() {
  try { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); } catch (e) { return false; }
}

let caps = null;

/** สรุปความสามารถของเบราว์เซอร์ storage มาจาก initStorage() ใน db.js */
export function detectCapabilities(storage) {
  caps = {
    storage: storage.kind,     // 'indexeddb' | 'fallback' | 'none'
    images: storage.images,    // 'indexeddb' | 'cache' | 'memory' | null
    wasm: hasWebAssembly(),
    camera: hasCamera(),
  };
  return caps;
}

export function capabilities() {
  return caps || { storage: 'indexeddb', images: 'indexeddb', wasm: hasWebAssembly(), camera: hasCamera() };
}

/** ทำงานแบบจำกัด (ไม่มี IndexedDB หรือ WebAssembly) */
export function isLimited(c = capabilities()) {
  return c.storage !== 'indexeddb' || !c.wasm;
}

/** น่าจะเป็นโหมดล็อกดาวน์ของ iPhone/iPad */
export function lockdownLikely(c = capabilities()) {
  return platform() === 'ios' && (c.storage !== 'indexeddb' || !c.wasm);
}

const steps = (items) => h('ol', { class: 'help-steps' }, items.map((t) => h('li', null, t)));

/** วิธีปิดโหมดล็อกดาวน์เฉพาะเว็บนี้ (เหมือนที่แอปอื่นบน iOS แนะนำ) และวิธีปิดทั้งเครื่อง */
export function lockdownHelp() {
  const standalone = isStandalone();
  return [
    h('p', { class: 'section-help' }, 'อนุญาตเฉพาะเว็บนี้ได้โดยไม่ต้องปิดโหมดล็อกดาวน์ทั้งเครื่อง:'),
    steps([
      standalone
        ? 'เปิด Safari แล้วไปที่ checkchoice.vercel.app (ตอนนี้เปิดจากไอคอนบนหน้าจอโฮมอยู่ ซึ่งไม่มีแถบที่อยู่เว็บ)'
        : 'ใน Safari แตะปุ่มเมนูหน้าเว็บที่อยู่ข้างช่องที่อยู่เว็บ (ปุ่ม aA หรือ ⋯ แล้วแต่รุ่น iOS)',
      'เลือก การตั้งค่าเว็บไซต์ (Website Settings)',
      'ปิด โหมดล็อกดาวน์ (Lockdown Mode) สำหรับเว็บนี้ แล้วแตะ เสร็จสิ้น หน้าเว็บจะโหลดใหม่เอง',
    ]),
    h('p', { class: 'section-help' }, 'ถ้ายังทำงานแบบจำกัดอยู่ ให้ปิดทั้งเครื่องที่ การตั้งค่า → ความเป็นส่วนตัวและความปลอดภัย → โหมดล็อกดาวน์ → ปิดโหมดล็อกดาวน์ (เครื่องจะรีสตาร์ท)'),
  ];
}

/** ข้อความสรุปว่าโหมดจำกัดขาดอะไรไปบ้าง */
export function limitedSummary(c = capabilities()) {
  const out = [];
  if (!c.wasm) out.push('อ่านกระดาษช้าลง (ใช้ตัวอ่านภาพสำรองเพราะเบราว์เซอร์ปิด WebAssembly)');
  if (!c.camera) out.push('ไม่มีกล้องสด ใช้ปุ่มถ่ายรูปแทน');
  if (c.storage === 'fallback') {
    out.push(c.images === 'memory'
      ? 'เก็บคะแนนและเฉลยได้ แต่รูปกระดาษจะหายเมื่อปิดแอป (เบราว์เซอร์ปิดที่เก็บไฟล์)'
      : 'เก็บข้อมูลในพื้นที่สำรองซึ่งจุได้น้อยกว่า ควรดาวน์โหลดไฟล์สำรองหลังตรวจเสร็จ');
  }
  return out;
}

/** กล่องแจ้งโหมดจำกัดบนหน้าแรก (ซ่อนได้จนกว่าจะเปิดแอปใหม่) */
export function limitedNotice() {
  const c = capabilities();
  if (!isLimited(c)) return null;
  try { if (sessionStorage.getItem('cc.hideLimited') === '1') return null; } catch (e) { /* ignore */ }
  const details = h('div', { class: 'limited-details', hidden: true }, lockdownHelp());
  const box = h('aside', { class: 'notice limited-notice', id: 'limited-notice' },
    h('p', { class: 'limited-title' }, lockdownLikely(c)
      ? 'เครื่องนี้เปิดโหมดล็อกดาวน์ (Lockdown Mode) อยู่ แอปจึงทำงานแบบจำกัด'
      : 'เบราว์เซอร์นี้ปิดบางฟีเจอร์ แอปจึงทำงานแบบจำกัด'),
    h('ul', { class: 'help-steps' }, limitedSummary(c).map((t) => h('li', null, t))),
    details,
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn btn-small btn-primary', onclick: (e) => {
        details.hidden = !details.hidden;
        e.currentTarget.textContent = details.hidden ? 'วิธีใช้เต็มความสามารถ' : 'ซ่อนวิธีแก้';
      } }, 'วิธีใช้เต็มความสามารถ'),
      h('button', { type: 'button', class: 'btn btn-small btn-quiet', onclick: () => {
        try { sessionStorage.setItem('cc.hideLimited', '1'); } catch (e) { /* ignore */ }
        box.remove();
      } }, 'รับทราบ')));
  return box;
}

/** หน้าจออธิบายเมื่อเบราว์เซอร์ไม่ให้เก็บข้อมูลเลย (เปิดแอปไม่ได้) */
export function environmentHelp(root) {
  const p = platform();
  const iosSection = h('section', { class: 'form-section' },
    h('h2', { class: 'section-title' }, p === 'ios' ? 'ถ้าเปิดโหมดล็อกดาวน์ (Lockdown Mode) อยู่' : 'ถ้าใช้ iPhone หรือ iPad'),
    lockdownHelp());

  const otherSection = h('section', { class: 'form-section' },
    h('h2', { class: 'section-title' }, 'สาเหตุที่พบบ่อย'),
    h('ul', { class: 'help-steps' },
      h('li', null, 'ตั้งค่าปิดกั้นคุกกี้ทั้งหมด (การตั้งค่า → Safari → ปิดกั้นคุกกี้ทั้งหมด): ปิดตัวเลือกนี้ก่อน'),
      h('li', null, 'เปิดลิงก์จากในแอป LINE, Facebook หรือ Messenger: แตะเมนู ⋯ แล้วเลือกเปิดใน Safari หรือ Chrome'),
      h('li', null, 'โหมดส่วนตัวของเบราว์เซอร์บางรุ่นไม่ให้เว็บเก็บข้อมูล: เปิดในหน้าต่างปกติ'),
      h('li', null, 'เบราว์เซอร์รุ่นเก่ามาก: อัปเดต iOS/Android หรือใช้ Safari, Chrome, Edge รุ่นล่าสุด')));

  clear(root).append(
    h('header', { class: 'appbar' },
      h('span', { class: 'wordmark' }, h('span', { class: 'wordmark-box', 'aria-hidden': 'true' }), h('span', { class: 'wordmark-text' }, 'CheckChoice'))),
    h('main', { class: 'page page-form', id: 'env-help' },
      h('h1', { class: 'page-title' }, 'เบราว์เซอร์นี้ยังใช้ CheckChoice ไม่ได้'),
      h('div', { class: 'notice notice-error' },
        h('p', null, 'เบราว์เซอร์ไม่อนุญาตให้เว็บนี้เก็บข้อมูลในเครื่อง (ทั้ง IndexedDB และ localStorage) แอปจึงบันทึกเฉลยและคะแนนไม่ได้')),
      p === 'ios' ? iosSection : otherSection,
      p === 'ios' ? otherSection : iosSection,
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-primary btn-large', onclick: () => location.reload() }, 'ลองใหม่'))));
}
