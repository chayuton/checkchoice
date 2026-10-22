/* Web Worker: โหลด OpenCV.js และประมวลผลภาพ โดยไม่ทำให้หน้าจอค้าง */
/* global OMRCore */
importScripts('core.js');

let cvPromise = null;

// โมดูล OpenCV.js มีเมธอด then ของ Emscripten จึงห่อไว้ในออบเจกต์ ไม่ให้ Promise วนไม่รู้จบ
function loadCv() {
  if (cvPromise) return cvPromise;
  cvPromise = new Promise((resolve, reject) => {
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
    if (c instanceof Promise) { c.then(done, reject); return; }
    c.onRuntimeInitialized = () => done(c);
  });
  return cvPromise;
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
      await loadCv();
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'init-error', message: errorText(null, err) });
    }
    return;
  }

  let cv;
  try {
    ({ cv } = await loadCv());
  } catch (err) {
    self.postMessage({ type: 'reply', id: m.id, result: { ok: false, error: 'opencv', message: errorText(null, err) } });
    return;
  }

  let mat = null;
  try {
    mat = toMat(cv, m);
    if (m.type === 'process') {
      const t0 = Date.now();
      const res = OMRCore.readSheet(cv, mat, m.template, m.opts);
      res.ms = Date.now() - t0;
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
