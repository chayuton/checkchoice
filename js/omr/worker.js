/* Web Worker: ประมวลผลภาพโดยไม่ทำให้หน้าจอค้าง
   ปกติใช้ OpenCV.js (WebAssembly) ถ้าเบราว์เซอร์ปิด WebAssembly (เช่น Safari ในโหมดล็อกดาวน์)
   หรือโหลด OpenCV ไม่สำเร็จ ใช้ตัวอ่านภาพสำรอง cvlite.js ที่เขียนด้วย JavaScript ล้วน */
/* global OMRCore */
importScripts('core.js');


let enginePromise = null;

function hasWasm() {
  try { return typeof WebAssembly === 'object' && WebAssembly !== null && typeof WebAssembly.instantiate === 'function'; } catch (e) { return false; }
}

// โมดูล OpenCV.js มีเมธอด then ของ Emscripten จึงห่อไว้ในออบเจกต์ ไม่ให้ Promise วนไม่รู้จบ
function loadOpenCV() {
  return new Promise((resolve, reject) => {
    try {
      importScripts('../../vendor/opencv.js');
    } catch (err) {
      reject(err);
      return;
    }
    const c = self.cv;
    const done = (m) => resolve({ cv: m });
    if (!c) { reject(new Error('OpenCV.js ไม่ได้โหลด')); return; }
    if (c.Mat) { done(c); return; }
    c.onAbort = (what) => reject(new Error(`OpenCV.js หยุดทำงาน: ${what}`));
    if (c instanceof Promise) { c.then(done, reject); return; }
    c.onRuntimeInitialized = () => done(c);
    // คอมไพล์ WebAssembly ไม่สำเร็จบางกรณีจะเงียบไปเฉย ๆ ไม่ให้รอตลอดไป
    setTimeout(() => reject(new Error('เตรียม OpenCV.js ไม่ทันเวลา')), 45000);
  });
}

function loadLite() {
  importScripts('cvlite.js');
  return { cv: self.cvlite, lite: true };
}

function loadEngine(preferLite) {
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    if (!preferLite && hasWasm()) {
      try {
        const { cv } = await loadOpenCV();
        return { cv, lite: false };
      } catch (err) {
        // ใช้ตัวอ่านสำรองแทน
      }
    }
    return loadLite();
  })();
  return enginePromise;
}

function errorText(cv, err) {
  if (typeof err === 'number' && cv && cv.exceptionFromPtr) {
    try { return cv.exceptionFromPtr(err).msg; } catch (e) { /* ignore */ }
  }
  return (err && err.message) || String(err);
}

function toMat(cv, m) {
  const mat = new cv.Mat(m.height, m.width, cv.CV_8UC4);
  mat.data.set(new Uint8Array(m.buffer));
  return mat;
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      const engine = await loadEngine(!!m.lite);
      self.postMessage({ type: 'ready', lite: engine.lite });
    } catch (err) {
      self.postMessage({ type: 'init-error', message: errorText(null, err) });
    }
    return;
  }

  let engine;
  try {
    engine = await loadEngine(false);
  } catch (err) {
    self.postMessage({ type: 'reply', id: m.id, result: { ok: false, error: 'opencv', message: errorText(null, err) } });
    return;
  }
  const { cv, lite } = engine;
  // ตัวอ่านภาพสำรองทำงานบนภาพเล็กลง (ผลเท่าเดิม) เพราะโหมดล็อกดาวน์ปิด JIT ทำให้ JavaScript ช้าลงมาก
  const opts = lite ? Object.assign({}, OMRCore.LITE_OPTS, m.opts || {}) : m.opts;

  let mat = null;
  try {
    mat = toMat(cv, m);
    if (m.type === 'process') {
      const t0 = Date.now();
      const res = OMRCore.readSheet(cv, mat, m.template, opts);
      res.ms = Date.now() - t0;
      res.lite = lite;
      const transfer = res.display ? [res.display.data.buffer] : [];
      self.postMessage({ type: 'reply', id: m.id, result: res }, transfer);
    } else if (m.type === 'infer') {
      const t0 = Date.now();
      const res = OMRCore.inferTemplate(cv, mat, opts);
      res.ms = Date.now() - t0;
      res.lite = lite;
      const transfer = res.display ? [res.display.data.buffer] : [];
      self.postMessage({ type: 'reply', id: m.id, result: res }, transfer);
    } else if (m.type === 'detect') {
      const quad = OMRCore.detectTable(cv, mat, m.template);
      self.postMessage({ type: 'reply', id: m.id, result: { ok: true, quad } });
    }
  } catch (err) {
    self.postMessage({ type: 'reply', id: m.id, result: { ok: false, error: 'exception', message: errorText(cv, err) } });
  } finally {
    if (mat) mat.delete();
  }
};
