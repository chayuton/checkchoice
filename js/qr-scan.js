// อ่าน QR code จากกล้องหรือรูปภาพ (ใช้รับชุดข้อสอบจากเครื่องอื่น)
//  - ใช้ BarcodeDetector ของเบราว์เซอร์ถ้ามี (เช่น Chrome บน Android) เร็วและอ่าน QR ที่หนาแน่นได้ดี
//  - ไม่เช่นนั้นใช้ jsQR ใน Web Worker (js/qr-worker.js) ซึ่งเป็น JavaScript ล้วน ใช้ได้แม้เบราว์เซอร์
//    ปิด WebAssembly เช่น iPhone ที่เปิดโหมดล็อกดาวน์ (โหมดนั้นไม่มีกล้องสด จึงใช้การถ่ายรูปแทน)
import { fileToCanvas, toCanvas, canvasImageData } from './capture.js';

// ด้านยาวสูงสุดของภาพที่ส่งให้ jsQR (ภาพที่ใหญ่กว่านี้ ทั้งช้าลงมากและมักอ่านไม่ได้เพราะเม็ดสัญญาณรบกวน
// ของกล้องกลายเป็นจุดที่ jsQR ต้องตรวจทีละจุด ย่อแล้วอ่านได้ดีกว่า: ทดสอบไว้ใน tests/qr.test.mjs)
const FRAME_MAX = 1200;

// ---------------------------------------------------------------------------
// jsQR ใน Web Worker
// ---------------------------------------------------------------------------
let worker = null;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  const w = new Worker(new URL('./qr-worker.js', import.meta.url));
  w.onmessage = (e) => {
    const { id, text } = e.data || {};
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    p.resolve(text || null);
  };
  w.onerror = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    try { w.terminate(); } catch (err) { /* ignore */ }
    if (worker === w) worker = null;
    const err = new Error('โหลดตัวอ่าน QR code ไม่สำเร็จ ลองเปิดหน้านี้ใหม่อีกครั้ง');
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };
  worker = w;
  return w;
}

/** อ่าน QR code จาก ImageData คืนข้อความ หรือ null ถ้าไม่พบ (ส่งบัฟเฟอร์ให้ worker โดยไม่คัดลอก) */
export function decodeImageData(imageData, inversion = 'attemptBoth') {
  return new Promise((resolve, reject) => {
    let w;
    try { w = getWorker(); } catch (err) { reject(err); return; }
    const id = ++seq;
    pending.set(id, { resolve, reject });
    const buffer = imageData.data.buffer;
    w.postMessage({ id, width: imageData.width, height: imageData.height, buffer, inversion }, [buffer]);
  });
}

// ---------------------------------------------------------------------------
// BarcodeDetector ของเบราว์เซอร์
// ---------------------------------------------------------------------------
let nativePromise = null;
let nativeErrors = 0;

function nativeDetector() {
  if (!nativePromise) {
    nativePromise = (async () => {
      try {
        const BD = self.BarcodeDetector;
        if (typeof BD !== 'function') return null;
        const formats = typeof BD.getSupportedFormats === 'function' ? await BD.getSupportedFormats() : ['qr_code'];
        if (!Array.isArray(formats) || !formats.includes('qr_code')) return null;
        return new BD({ formats: ['qr_code'] });
      } catch (e) {
        return null;
      }
    })();
  }
  return nativePromise;
}

/** มีตัวอ่าน QR ของเบราว์เซอร์ที่ใช้งานได้ */
async function hasNative() {
  return nativeErrors < 3 && !!(await nativeDetector());
}

async function detectNative(source) {
  if (!(await hasNative())) return null;
  try {
    const codes = await (await nativeDetector()).detect(source);
    nativeErrors = 0;
    const hit = Array.isArray(codes) ? codes.find((c) => c && typeof c.rawValue === 'string' && c.rawValue) : null;
    return hit ? hit.rawValue : null;
  } catch (e) {
    // บางเครื่องมี BarcodeDetector แต่ใช้งานจริงไม่ได้: ผิดพลาดติดกันหลายครั้งแล้วใช้ jsQR อย่างเดียว
    nativeErrors++;
    return null;
  }
}

// ---------------------------------------------------------------------------
// รูปภาพ (ถ่ายรูปหน้าจอเครื่องต้นทาง หรือภาพหน้าจอที่มี QR code)
// ---------------------------------------------------------------------------
export async function decodeImageFile(file) {
  const canvas = await fileToCanvas(file, 2000);
  const native = await detectNative(canvas);
  if (native) return native;
  const long = Math.max(canvas.width, canvas.height);
  const at = (size) => (size >= long ? canvas : toCanvas(canvas, canvas.width, canvas.height, size));
  // ลองหลายขนาด: QR ที่หนาแน่นต้องใช้ภาพใหญ่ขึ้น ภาพที่เบลอหรือมีสัญญาณรบกวนอ่านได้ดีขึ้นเมื่อย่อ
  for (const size of [...new Set([1200, 1500, 900].map((x) => Math.min(x, long)))]) {
    const text = await decodeImageData(canvasImageData(at(size)), 'dontInvert');
    if (text) return text;
  }
  // พื้นหลังรบกวนมาก: ลองเฉพาะกลางภาพ
  const side = Math.round(Math.min(canvas.width, canvas.height) * 0.75);
  const s = Math.min(1, FRAME_MAX / side);
  const crop = document.createElement('canvas');
  crop.width = crop.height = Math.round(side * s);
  const cctx = crop.getContext('2d', { willReadFrequently: true });
  cctx.imageSmoothingQuality = 'high';
  cctx.drawImage(canvas, (canvas.width - side) / 2, (canvas.height - side) / 2, side, side, 0, 0, crop.width, crop.height);
  const text = await decodeImageData(canvasImageData(crop), 'dontInvert');
  if (text) return text;
  // QR สีกลับ (ขาวบนดำ) พบน้อย ลองเป็นอย่างสุดท้าย
  return decodeImageData(canvasImageData(at(Math.min(1200, long))), 'onlyInvert');
}

// ---------------------------------------------------------------------------
// กล้องสด: อ่านเฟรมต่อเนื่องจนพบ QR code
// ---------------------------------------------------------------------------
export class QrScanner {
  constructor(video, { onText, onState, onError } = {}) {
    this.video = video;
    this.onText = onText || (() => {});
    this.onState = onState || (() => {});
    this.onError = onError || (() => {});
    this.stream = null;
    this.wanted = false;
    this.running = false;
    this.frame = 0;
    this.timer = null;
    this.canvas = document.createElement('canvas');
  }

  static supported() {
    try { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); } catch (e) { return false; }
  }

  async start() {
    if (this.wanted) return;
    this.wanted = true;
    this.onState('starting');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
    } catch (err) {
      this.wanted = false;
      throw err;
    }
    // หยุดไปแล้วระหว่างรอผู้ใช้อนุญาตกล้อง
    if (!this.wanted) { stream.getTracks().forEach((t) => t.stop()); return; }
    this.stream = stream;
    const v = this.video;
    v.setAttribute('playsinline', '');
    v.muted = true;
    v.srcObject = stream;
    try { await v.play(); } catch (e) { /* บางเบราว์เซอร์เล่นเองเมื่อภาพพร้อม */ }
    if (!this.wanted) return;
    // กล้องหน้า (เช่น เว็บแคมของโน้ตบุ๊ก) แสดงภาพกลับซ้ายขวาเหมือนกระจก ขยับตามได้ง่ายกว่า
    // (เฉพาะภาพที่แสดง ภาพที่อ่าน QR ยังเป็นภาพจริง)
    const track = stream.getVideoTracks()[0];
    const settings = track && track.getSettings ? track.getSettings() : {};
    v.classList.toggle('is-mirrored', settings.facingMode === 'user' || (!settings.facingMode && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '')));
    // กล้องถูกแอปอื่นแย่งไประหว่างสแกน (การหยุดเองด้วย stop() ไม่ทำให้เกิดเหตุการณ์นี้)
    if (track) {
      track.addEventListener('ended', () => {
        if (!this.running) return;
        this.stop();
        const err = new Error('กล้องหยุดทำงาน');
        err.name = 'NotReadableError';
        this.onError(err);
      });
    }
    this.running = true;
    this.onState('scanning');
    this.loop();
  }

  stop() {
    this.wanted = false;
    this.running = false;
    clearTimeout(this.timer);
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    try { this.video.srcObject = null; } catch (e) { /* ignore */ }
  }

  async loop() {
    if (!this.running) return;
    const t0 = Date.now();
    let text = null;
    try {
      text = await this.scanFrame();
    } catch (err) {
      if (!this.running) return;
      this.stop();
      this.onError(err);
      return;
    }
    if (!this.running) return;
    if (text) this.onText(text);
    if (this.running) this.timer = setTimeout(() => this.loop(), Math.max(30, 110 - (Date.now() - t0)));
  }

  async scanFrame() {
    const v = this.video;
    if (v.readyState < 2 || !v.videoWidth) return null;
    this.frame++;
    if (await hasNative()) {
      const text = await detectNative(v);
      if (text) return text;
      // มีตัวอ่านของเบราว์เซอร์แล้ว ใช้ jsQR เสริมทุก 3 เฟรม
      if (this.frame % 3) return null;
    }
    const vw = v.videoWidth, vh = v.videoHeight;
    let sx = 0, sy = 0, sw = vw, sh = vh;
    if (this.frame % 4) {
      // ส่วนกลางภาพที่ตรงกับกรอบเล็งบนหน้าจอ ทุก 4 เฟรมอ่านทั้งภาพ เผื่อ QR ไม่อยู่กลางกรอบ
      const side = Math.min(vw, vh);
      sx = (vw - side) / 2;
      sy = (vh - side) / 2;
      sw = sh = side;
    }
    const s = Math.min(1, FRAME_MAX / Math.max(sw, sh));
    const dw = Math.max(1, Math.round(sw * s)), dh = Math.max(1, Math.round(sh * s));
    const c = this.canvas;
    if (c.width !== dw) c.width = dw;
    if (c.height !== dh) c.height = dh;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, dw, dh);
    return decodeImageData(ctx.getImageData(0, 0, dw, dh), 'dontInvert');
  }
}
