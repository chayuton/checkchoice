// ภาพจำลอง "ถ่าย QR code บนหน้าจอด้วยกล้องมือถือ" สำหรับทดสอบการรับชุดข้อสอบ
// ใช้ใน tests/qr.test.mjs (อ่านด้วย jsQR ใน Node) และ tests/e2e.mjs (วิดีโอกล้องจำลอง .y4m และรูปถ่าย .jpg)
// สุ่มแบบกำหนด seed จึงได้ภาพเดิมทุกครั้ง
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jpeg = require('jpeg-js');
const { default: qrcode } = await import(pathToFileURL(path.join(root, 'vendor/qrcode.mjs')).href);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** QR code แบบเดียวกับที่แอปวาดในกล่องส่งชุดข้อสอบ (js/transfer-ui.js): ระดับแก้ข้อผิดพลาด L ขอบขาว 4 ช่อง
 *  ลิงก์ชุดข้อสอบแบบย่อแบ่งเป็นส่วนลิงก์ (โหมด Byte) และส่วนข้อมูล (โหมด Alphanumeric) */
export function qrImage(text, { ecc = 'L', module = 6, margin = 4 } = {}) {
  const qr = qrcode(0, ecc);
  const at = text.indexOf('#/import/');
  const payload = at >= 0 ? text.slice(at + 9) : '';
  if (payload && /^[0-9A-Z]+$/.test(payload)) {
    qr.addData(text.slice(0, at + 9), 'Byte');
    qr.addData(payload, 'Alphanumeric');
  } else {
    qr.addData(text);
  }
  qr.make();
  const n = qr.getModuleCount();
  const size = (n + margin * 2) * module;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      for (let y = (r + margin) * module; y < (r + margin + 1) * module; y++) {
        for (let x = (c + margin) * module; x < (c + margin + 1) * module; x++) {
          const i = (y * size + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    }
  }
  return { width: size, height: size, data, modules: n };
}

// ---------------------------------------------------------------- homography (src → dst)
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

function homography(from, to) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i], [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

function boxBlur(data, W, H, r) {
  if (r < 1) return data;
  const tmp = new Float32Array(W * H * 3);
  const out = new Uint8ClampedArray(data.length);
  const span = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    for (let ch = 0; ch < 3; ch++) {
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += data[(y * W + Math.min(W - 1, Math.max(0, x))) * 4 + ch];
      for (let x = 0; x < W; x++) {
        tmp[(y * W + x) * 3 + ch] = acc / span;
        acc += data[(y * W + Math.min(W - 1, x + r + 1)) * 4 + ch] - data[(y * W + Math.max(0, x - r)) * 4 + ch];
      }
    }
  }
  for (let x = 0; x < W; x++) {
    for (let ch = 0; ch < 3; ch++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[(Math.min(H - 1, Math.max(0, y)) * W + x) * 3 + ch];
      for (let y = 0; y < H; y++) {
        out[(y * W + x) * 4 + ch] = acc / span;
        acc += tmp[(Math.min(H - 1, y + r + 1) * W + x) * 3 + ch] - tmp[(Math.max(0, y - r) * W + x) * 3 + ch];
      }
    }
  }
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return out;
}

/**
 * ภาพจากกล้องที่เล็งไปยังหน้าจอที่แสดง src
 *  W, H      ขนาดเฟรม
 *  cover     ความกว้างของ src เทียบกับด้านสั้นของเฟรม
 *  tilt      ถือกล้องเอียง (ขอบบนแคบกว่าขอบล่าง) 0–0.2
 *  rotate    หมุน (องศา)
 *  offset    เลื่อนจากกลางเฟรม [dx, dy] เป็นสัดส่วนของเฟรม
 *  blur      รัศมีเบลอ (px) noise ความแรงของสัญญาณรบกวน
 */
export function cameraShot(src, opts = {}) {
  const { W = 1280, H = 720, cover = 0.55, tilt = 0.06, rotate = 4, offset = [0, 0], blur = 1, noise = 4, seed = 1 } = opts;
  const rnd = mulberry32(seed);
  const s = Math.min(W, H) * cover;
  const cx = W / 2 + offset[0] * W, cy = H / 2 + offset[1] * H;
  const a = rotate * Math.PI / 180;
  const quad = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => {
    const k = y < 0 ? 1 - tilt : 1 + tilt * 0.3;
    const px = x * k * s / 2, py = y * s / 2;
    return [cx + px * Math.cos(a) - py * Math.sin(a), cy + px * Math.sin(a) + py * Math.cos(a)];
  });
  const Hi = homography(quad, [[0, 0], [src.width, 0], [src.width, src.height], [0, src.height]]);
  const sw = src.width, sh = src.height;
  const pad = 0.35;   // หน้าจอสีขาวรอบ QR (กล่องข้อความ) ก่อนถึงกรอบจอสีเข้ม
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Hi[6] * x + Hi[7] * y + 1;
      const u = (Hi[0] * x + Hi[1] * y + Hi[2]) / d - 0.5;
      const v = (Hi[3] * x + Hi[4] * y + Hi[5]) / d - 0.5;
      let val;
      if (u >= 0 && v >= 0 && u < sw - 1 && v < sh - 1) {
        const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
        const p = (xx, yy) => src.data[(yy * sw + xx) * 4];
        val = (p(x0, y0) * (1 - fx) + p(x0 + 1, y0) * fx) * (1 - fy) + (p(x0, y0 + 1) * (1 - fx) + p(x0 + 1, y0 + 1) * fx) * fy;
      } else if (u > -sw * pad && v > -sh * pad && u < sw * (1 + pad) && v < sh * (1 + pad)) {
        val = 250;
      } else {
        val = 38;
      }
      // หน้าจอที่ถ่ายด้วยกล้อง: ดำไม่สนิท ขาวไม่สุด และสว่างไม่เท่ากันทั้งภาพ
      const light = 0.82 + 0.22 * (x / W) - 0.08 * (y / H);
      const g = (28 + val * 0.82) * light;
      const i = (y * W + x) * 4;
      out[i] = g * 0.97; out[i + 1] = g; out[i + 2] = g * 1.04; out[i + 3] = 255;
    }
  }
  const blurred = boxBlur(out, W, H, blur);
  if (noise > 0) {
    for (let i = 0; i < blurred.length; i += 4) {
      const n = (rnd() + rnd() + rnd() - 1.5) * 2 * noise;
      blurred[i] += n; blurred[i + 1] += n; blurred[i + 2] += n;
    }
  }
  return { width: W, height: H, data: blurred };
}

/** ย่อภาพแบบเฉลี่ยตามพื้นที่ที่ทับกันจริง ให้ด้านยาวไม่เกิน maxLong (ใกล้เคียงการย่อภาพของ canvas ในเบราว์เซอร์) */
export function resize(img, maxLong) {
  const s = Math.min(1, maxLong / Math.max(img.width, img.height));
  if (s === 1) return img;
  const W = Math.max(1, Math.round(img.width * s)), H = Math.max(1, Math.round(img.height * s));
  const fx = img.width / W, fy = img.height / H;
  // น้ำหนักของพิกเซลต้นทางในแต่ละพิกเซลปลายทาง (แยกแกน)
  const spans = (n, f, limit) => Array.from({ length: n }, (_, i) => {
    const a = i * f, b = (i + 1) * f, out = [];
    for (let k = Math.floor(a); k < Math.min(limit, Math.ceil(b)); k++) {
      const w = Math.min(b, k + 1) - Math.max(a, k);
      if (w > 1e-6) out.push([k, w]);
    }
    return out;
  });
  const sx = spans(W, fx, img.width), sy = spans(H, fy, img.height);
  const tmp = new Float32Array(W * img.height * 3);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, t = 0;
      for (const [k, w] of sx[x]) {
        const i = (y * img.width + k) * 4;
        r += img.data[i] * w; g += img.data[i + 1] * w; b += img.data[i + 2] * w; t += w;
      }
      const o = (y * W + x) * 3;
      tmp[o] = r / t; tmp[o + 1] = g / t; tmp[o + 2] = b / t;
    }
  }
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, t = 0;
      for (const [k, w] of sy[y]) {
        const i = (k * W + x) * 3;
        r += tmp[i] * w; g += tmp[i + 1] * w; b += tmp[i + 2] * w; t += w;
      }
      const o = (y * W + x) * 4;
      out[o] = r / t; out[o + 1] = g / t; out[o + 2] = b / t; out[o + 3] = 255;
    }
  }
  return { width: W, height: H, data: out };
}

/** ตัดส่วนของภาพ (เหมือนที่ตัวสแกนตัดกลางเฟรมก่อนอ่าน) */
export function crop(img, sx, sy, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const from = ((sy + y) * img.width + sx) * 4;
    out.set(img.data.subarray(from, from + w * 4), y * w * 4);
  }
  return { width: w, height: h, data: out };
}

export function writeJPEG(file, img, quality = 88) {
  writeFileSync(file, jpeg.encode({ data: Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), width: img.width, height: img.height }, quality).data);
}

export function readJPEG(buf) {
  const raw = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
  return { width: raw.width, height: raw.height, data: new Uint8ClampedArray(raw.data.buffer, raw.data.byteOffset, raw.data.length) };
}

/** เขียนวิดีโอ .y4m (I420) สำหรับกล้องจำลองของ Chromium (--use-file-for-fake-video-capture) */
export function writeY4M(file, frames, fps = 30) {
  const { width: W, height: H } = frames[0];
  if (W % 2 || H % 2) throw new Error('ขนาดเฟรมต้องเป็นเลขคู่');
  const parts = [Buffer.from(`YUV4MPEG2 W${W} H${H} F${fps}:1 Ip A1:1 C420jpeg\n`)];
  for (const f of frames) {
    const yuv = Buffer.alloc(W * H * 3 / 2);
    const d = f.data;
    for (let i = 0, p = 0; i < W * H; i++, p += 4) {
      yuv[i] = Math.max(0, Math.min(255, Math.round(0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2])));
    }
    let u = W * H, v = W * H + (W / 2) * (H / 2);
    for (let y = 0; y < H; y += 2) {
      for (let x = 0; x < W; x += 2) {
        let r = 0, g = 0, b = 0;
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const p = ((y + dy) * W + x + dx) * 4;
          r += d[p]; g += d[p + 1]; b += d[p + 2];
        }
        r /= 4; g /= 4; b /= 4;
        yuv[u++] = Math.max(0, Math.min(255, Math.round(-0.168736 * r - 0.331264 * g + 0.5 * b + 128)));
        yuv[v++] = Math.max(0, Math.min(255, Math.round(0.5 * r - 0.418688 * g - 0.081312 * b + 128)));
      }
    }
    parts.push(Buffer.from('FRAME\n'), yuv);
  }
  writeFileSync(file, Buffer.concat(parts));
}
