// การรับภาพ: ถ่ายรูป/เลือกรูป และกล้องสด
import { detectTable } from './omr/client.js';

export const WORK_LONG_SIDE = 2400;

async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    // เบราว์เซอร์รุ่นเก่า: ใช้แท็ก img (หมุนภาพตาม EXIF ให้อัตโนมัติ)
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}

/** วาดภาพลง canvas โดยย่อให้ด้านยาวไม่เกิน maxLong */
export function toCanvas(source, srcW, srcH, maxLong = WORK_LONG_SIDE) {
  const s = Math.min(1, maxLong / Math.max(srcW, srcH));
  const w = Math.round(srcW * s), h = Math.round(srcH * s);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  return canvas;
}

/** แปลงไฟล์รูปเป็น canvas พร้อมประมวลผล (maxLong: ด้านยาวสูงสุด ตัวอ่านภาพสำรองใช้ภาพเล็กกว่า) */
export async function fileToCanvas(file, maxLong = WORK_LONG_SIDE) {
  if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('ไฟล์นี้ไม่ใช่รูปภาพ');
  const img = await decode(file);
  const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
  const canvas = toCanvas(img, w, h, maxLong);
  if (img.close) img.close();
  return canvas;
}

export function canvasImageData(canvas) {
  return canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.85) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('แปลงรูปไม่สำเร็จ'))), type, quality);
  });
}

/** สร้างปุ่มเลือกไฟล์ที่ซ่อนไว้ (capture=true เปิดกล้องหลังทันทีบนมือถือ) */
export function pickImage({ capture = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (capture) input.setAttribute('capture', 'environment');
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    let settled = false;
    const done = (f) => { if (settled) return; settled = true; input.remove(); resolve(f); };
    input.addEventListener('change', () => done(input.files && input.files[0] ? input.files[0] : null));
    input.addEventListener('cancel', () => done(null));
    document.body.appendChild(input);
    input.click();
  });
}

// ---------------------------------------------------------------------------
// กล้องสด: หากรอบตารางทุก ๆ ~150 ms และถ่ายอัตโนมัติเมื่อภาพนิ่ง
// ---------------------------------------------------------------------------
export class LiveCamera {
  constructor(video, overlay, { template, onCapture, onStatus, autoCapture = true }) {
    this.video = video;
    this.overlay = overlay;
    this.template = template;
    this.onCapture = onCapture;
    this.onStatus = onStatus || (() => {});
    this.autoCapture = autoCapture;
    this.stream = null;
    this.running = false;
    this.paused = false;
    this.history = [];
    this.small = document.createElement('canvas');
    this.timer = null;
    this.lastQuad = null;
  }

  static supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  async start() {
    if (this.running) return;
    if (!LiveCamera.supported()) throw new Error('เบราว์เซอร์นี้ไม่รองรับกล้องสด ใช้โหมดถ่ายรูปแทน');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    await this.video.play();
    this.running = true;
    this.paused = false;
    this.onStatus('search');
    this.tick();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.drawQuad(null);
  }

  pause() { this.paused = true; this.history = []; this.drawQuad(null); }
  resume() { this.paused = false; this.history = []; this.onStatus('search'); }

  get torchSupported() {
    const track = this.stream && this.stream.getVideoTracks()[0];
    const caps = track && track.getCapabilities ? track.getCapabilities() : {};
    return !!caps.torch;
  }

  async setTorch(on) {
    const track = this.stream && this.stream.getVideoTracks()[0];
    if (track) await track.applyConstraints({ advanced: [{ torch: !!on }] });
  }

  async tick() {
    if (!this.running) return;
    const v = this.video;
    if (!this.paused && v.readyState >= 2 && v.videoWidth) {
      try {
        const sw = 640, sh = Math.round(640 * v.videoHeight / v.videoWidth);
        this.small.width = sw;
        this.small.height = sh;
        const ctx = this.small.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(v, 0, 0, sw, sh);
        const res = await detectTable(ctx.getImageData(0, 0, sw, sh), this.template);
        if (!this.running || this.paused) { this.schedule(); return; }
        const quad = res && res.ok && res.quad ? res.quad.map((p) => [p[0] * v.videoWidth / sw, p[1] * v.videoHeight / sh]) : null;
        this.handleQuad(quad);
      } catch (e) {
        // ข้ามเฟรมที่ผิดพลาด
      }
    }
    this.schedule();
  }

  schedule() {
    if (this.running) this.timer = setTimeout(() => this.tick(), 120);
  }

  handleQuad(quad) {
    this.lastQuad = quad;
    this.drawQuad(quad);
    if (!quad) { this.history = []; this.onStatus('search'); return; }
    this.history.push(quad);
    if (this.history.length > 5) this.history.shift();
    const diag = Math.hypot(this.video.videoWidth, this.video.videoHeight);
    const stable = this.history.length >= 4 && this.history.every((q) =>
      q.every((p, i) => Math.hypot(p[0] - quad[i][0], p[1] - quad[i][1]) < diag * 0.012));
    if (stable && this.autoCapture) {
      this.onStatus('capturing');
      this.capture();
    } else {
      this.onStatus(stable ? 'ready' : 'hold');
    }
  }

  /** ถ่ายภาพเต็มความละเอียดจากวิดีโอ */
  capture() {
    const v = this.video;
    if (!v.videoWidth) return;
    this.pause();
    const canvas = toCanvas(v, v.videoWidth, v.videoHeight);
    this.onCapture(canvas);
  }

  drawQuad(quad) {
    const c = this.overlay;
    const v = this.video;
    const rect = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(rect.width * dpr);
    c.height = Math.round(rect.height * dpr);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    if (!quad || !v.videoWidth) return;
    // วิดีโอแสดงแบบ object-fit: contain
    const s = Math.min(c.width / v.videoWidth, c.height / v.videoHeight);
    const ox = (c.width - v.videoWidth * s) / 2, oy = (c.height - v.videoHeight * s) / 2;
    const css = getComputedStyle(document.documentElement);
    ctx.lineWidth = 4 * dpr;
    ctx.strokeStyle = css.getPropertyValue('--hl-edge').trim() || '#E0A800';
    ctx.fillStyle = 'rgba(255, 224, 102, 0.18)';
    ctx.beginPath();
    quad.forEach((p, i) => {
      const x = ox + p[0] * s, y = oy + p[1] * s;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}
