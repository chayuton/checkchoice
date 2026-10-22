// ตัวกลางคุยกับ Web Worker ที่ประมวลผลภาพ
let worker = null;
let readyPromise = null;
let seq = 0;
const pending = new Map();

export function initOMR() {
  if (readyPromise) return readyPromise;
  if (typeof WebAssembly !== 'object' || !WebAssembly) {
    return Promise.reject(new Error('เบราว์เซอร์นี้ปิดตัวประมวลผลภาพ (WebAssembly) อยู่ ถ้าใช้ iPhone ให้ปิดโหมดล็อกดาวน์แล้วรีสตาร์ทเครื่อง'));
  }
  worker = new Worker(new URL('./worker.js', import.meta.url));
  readyPromise = new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') resolve();
      else if (m.type === 'init-error') reject(new Error(m.message));
      else if (m.type === 'reply' && pending.has(m.id)) {
        const done = pending.get(m.id);
        pending.delete(m.id);
        done(m.result);
      }
    };
    worker.onerror = (e) => reject(new Error(e.message || 'โหลดตัวประมวลผลภาพไม่สำเร็จ'));
  });
  worker.postMessage({ type: 'init' });
  readyPromise.catch(() => { readyPromise = null; });
  return readyPromise;
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
