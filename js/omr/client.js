// ตัวกลางคุยกับ Web Worker ที่ประมวลผลภาพ
let worker = null;
let readyPromise = null;
let engine = null;   // { lite: boolean } เมื่อพร้อมแล้ว
let seq = 0;
const pending = new Map();

function hasWasm() {
  try { return typeof WebAssembly === 'object' && WebAssembly !== null && typeof WebAssembly.instantiate === 'function'; } catch (e) { return false; }
}

/** บังคับใช้ตัวอ่านภาพสำรอง (สำหรับทดสอบ): localStorage cc.engine = 'lite' */
function forceLite() {
  try { return localStorage.getItem('cc.engine') === 'lite'; } catch (e) { return false; }
}

/** เริ่มตัวอ่านภาพ คืน { lite } (lite = ใช้ตัวอ่านสำรองที่ไม่ต้องใช้ WebAssembly) */
export function initOMR() {
  if (readyPromise) return readyPromise;
  worker = new Worker(new URL('./worker.js', import.meta.url));
  readyPromise = new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') { engine = { lite: !!m.lite }; resolve(engine); }
      else if (m.type === 'init-error') reject(new Error(m.message));
      else if (m.type === 'reply' && pending.has(m.id)) {
        const done = pending.get(m.id);
        pending.delete(m.id);
        done(m.result);
      }
    };
    worker.onerror = (e) => reject(new Error(e.message || 'โหลดตัวประมวลผลภาพไม่สำเร็จ'));
  });
  worker.postMessage({ type: 'init', lite: !hasWasm() || forceLite() });
  readyPromise.catch(() => { readyPromise = null; });
  return readyPromise;
}

/** ตัวอ่านภาพที่ใช้อยู่ (null ถ้ายังไม่พร้อม) */
export function omrEngine() {
  return engine;
}

/** ด้านยาวของภาพที่ควรส่งให้ตัวอ่าน (ตัวอ่านสำรองใช้ภาพเล็กกว่าเพื่อให้เร็วพอ) */
export async function workLongSide() {
  try {
    const e = await initOMR();
    return e.lite ? 1600 : 2400;
  } catch (err) {
    return 2400;
  }
}

function call(type, imageData, template, opts, transfer) {
  return initOMR().then(() => new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    const buffer = transfer ? imageData.data.buffer : imageData.data.slice().buffer;
    worker.postMessage({
      type, id, template, opts,
      width: imageData.width, height: imageData.height, buffer,
    }, [buffer]);
  }));
}

/** อ่านกระดาษคำตอบจาก ImageData (ส่งบัฟเฟอร์ให้ worker โดยไม่คัดลอก) */
export function readSheet(imageData, template, opts) {
  return call('process', imageData, template, opts, true);
}

/** หาโครงตารางจากรูปกระดาษเปล่า (ใช้ตอนเพิ่มแบบฟอร์มใหม่) */
export function inferTemplate(imageData) {
  return call('infer', imageData, null, null, true);
}

/** หากรอบตารางอย่างเร็ว สำหรับโหมดกล้องสด */
export function detectTable(imageData, template) {
  return call('detect', imageData, template, null, true);
}
