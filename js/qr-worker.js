/* Web Worker: อ่าน QR code ด้วย jsQR โดยไม่ทำให้ภาพจากกล้องกระตุก
   jsQR เขียนด้วย JavaScript ล้วน จึงใช้ได้แม้เบราว์เซอร์ปิด WebAssembly (เช่น iPhone ที่เปิดโหมดล็อกดาวน์) */
/* global jsQR */
importScripts('../vendor/jsqr.min.js');

self.onmessage = (e) => {
  const { id, width, height, buffer, inversion } = e.data || {};
  let text = null;
  try {
    const res = jsQR(new Uint8ClampedArray(buffer), width, height, { inversionAttempts: inversion || 'attemptBoth' });
    if (res && typeof res.data === 'string' && res.data) text = res.data;
  } catch (err) {
    text = null;
  }
  self.postMessage({ id, text });
};
