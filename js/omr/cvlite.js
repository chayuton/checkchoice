/*
 * cvlite — OpenCV.js เฉพาะส่วนที่ core.js ใช้ เขียนด้วย JavaScript ล้วน (ไม่ใช้ WebAssembly)
 *
 * ใช้แทน OpenCV.js เมื่อเบราว์เซอร์ปิด WebAssembly เช่น Safari บน iPhone ที่เปิดโหมดล็อกดาวน์
 * ฟังก์ชันและพารามิเตอร์เหมือน OpenCV.js (ชื่อ ลำดับอาร์กิวเมนต์ ค่าคงที่ ขอบภาพ) core.js จึงใช้ได้
 * โดยไม่ต้องแก้ ผลลัพธ์ใกล้เคียง OpenCV มาก (ต่างกันระดับการปัดเศษ 1 ค่าสี) `npm test` รันชุดทดสอบภาพด้วย --lite
 *
 * รองรับเฉพาะ: ภาพ 8 บิต 1 หรือ 4 ช่องสี, kernel สี่เหลี่ยมที่เป็น 1 ทั้งหมด, และโหมดที่ core.js ใช้
 * โหมดล็อกดาวน์ปิด JIT ด้วย โค้ดจึงเขียนแบบวนลูปตรง ๆ บน typed array และใช้อัลกอริทึมที่ไม่ขึ้นกับขนาด kernel
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.cvlite = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- ชนิดข้อมูล
  const CV_8U = 0, CV_32S = 4, CV_32F = 5, CV_64F = 6;
  const depthOf = (type) => type & 7;
  const channelsOf = (type) => (type >> 3) + 1;
  const makeType = (depth, ch) => depth + ((ch - 1) << 3);

  function makeArray(depth, n) {
    switch (depth) {
      case CV_32S: return new Int32Array(n);
      case CV_32F: return new Float32Array(n);
      case CV_64F: return new Float64Array(n);
      default: return new Uint8Array(n);
    }
  }

  class Mat {
    constructor(rows, cols, type, init) {
      this.rows = 0; this.cols = 0; this.t = CV_8U;
      this.buf = new Uint8Array(0); this.offset = 0; this.step = 0;
      if (rows !== undefined) {
        this.create(rows, cols, type === undefined ? CV_8U : type);
        if (init !== undefined) {
          const v = Array.isArray(init) ? init : [init];
          const ch = channelsOf(this.t);
          for (let i = 0; i < this.buf.length; i++) this.buf[i] = v[i % ch] || 0;
        }
      }
    }
    create(rows, cols, type) {
      this.rows = rows; this.cols = cols; this.t = type;
      this.buf = makeArray(depthOf(type), rows * cols * channelsOf(type));
      this.offset = 0; this.step = cols * channelsOf(type);
      return this;
    }
    /** แทนที่ข้อมูลทั้งหมด (ใช้กับผลลัพธ์ที่คำนวณใส่ buffer ใหม่) */
    assign(rows, cols, type, buf) {
      this.rows = rows; this.cols = cols; this.t = type;
      this.buf = buf; this.offset = 0; this.step = cols * channelsOf(type);
      this.bin = false; // true เมื่อทุกพิกเซลเป็น 0 หรือ 255 (ใช้ morphology แบบนับพิกเซลที่เร็วกว่า)
      return this;
    }
    type() { return this.t; }
    channels() { return channelsOf(this.t); }
    depth() { return depthOf(this.t); }
    size() { return { width: this.cols, height: this.rows }; }
    empty() { return this.rows === 0 || this.cols === 0; }
    isContinuous() { return this.offset === 0 && this.step === this.cols * channelsOf(this.t); }
    get data() { return this.contiguous(Uint8Array); }
    get data32S() { return this.contiguous(Int32Array); }
    get data32F() { return this.contiguous(Float32Array); }
    get data64F() { return this.contiguous(Float64Array); }
    contiguous(Ctor) {
      if (this.isContinuous() && this.buf instanceof Ctor) return this.buf;
      const out = new Ctor(this.rows * this.cols * channelsOf(this.t));
      const w = this.cols * channelsOf(this.t);
      for (let y = 0; y < this.rows; y++) {
        const o = this.offset + y * this.step;
        for (let x = 0; x < w; x++) out[y * w + x] = this.buf[o + x];
      }
      return out;
    }
    roi(rect) {
      const m = new Mat();
      const ch = channelsOf(this.t);
      m.rows = rect.height; m.cols = rect.width; m.t = this.t;
      m.buf = this.buf; m.step = this.step;
      m.offset = this.offset + rect.y * this.step + rect.x * ch;
      return m;
    }
    clone() {
      const m = new Mat();
      return m.assign(this.rows, this.cols, this.t, this.contiguous(this.buf.constructor).slice());
    }
    copyTo(dst) {
      dst.assign(this.rows, this.cols, this.t, this.contiguous(this.buf.constructor).slice());
    }
    delete() { /* ไม่มีหน่วยความจำนอก JavaScript ให้คืน */ }
    isDeleted() { return false; }
    static ones(rows, cols, type) { return new Mat(rows, cols, type, 1); }
    static zeros(rows, cols, type) { return new Mat(rows, cols, type, 0); }
  }

  class MatVector {
    constructor() { this.items = []; }
    size() { return this.items.length; }
    get(i) { return this.items[i]; }
    push_back(m) { this.items.push(m); }
    delete() { this.items = []; }
  }

  function Size(width, height) { return { width, height }; }
  function Point(x, y) { return { x, y }; }
  function Rect(x, y, width, height) { return { x, y, width, height }; }
  function Scalar(a, b, c, d) { return [a || 0, b || 0, c || 0, d || 0]; }

  function matFromArray(rows, cols, type, array) {
    const m = new Mat(rows, cols, type);
    for (let i = 0; i < m.buf.length; i++) m.buf[i] = array[i];
    return m;
  }

  /** ข้อมูล 8 บิตแบบต่อเนื่อง (ภาพ ROI จะถูกคัดลอก) */
  const u8 = (m) => m.data;

  // ---------------------------------------------------------------- สี
  const COLOR_RGBA2GRAY = 11, COLOR_RGB2GRAY = 7, COLOR_BGR2GRAY = 6, COLOR_BGRA2GRAY = 10;

  function cvtColor(src, dst, code) {
    const ch = src.channels();
    const s = u8(src);
    const n = src.rows * src.cols;
    const out = new Uint8Array(n);
    const bgr = code === COLOR_BGR2GRAY || code === COLOR_BGRA2GRAY;
    // ค่าสัมประสิทธิ์และการปัดเศษเหมือน OpenCV (fixed point 14 บิต)
    for (let i = 0, j = 0; i < n; i++, j += ch) {
      const r = s[bgr ? j + 2 : j], g = s[j + 1], b = s[bgr ? j : j + 2];
      out[i] = (r * 4899 + g * 9617 + b * 1868 + 8192) >> 14;
    }
    dst.assign(src.rows, src.cols, CV_8U, out);
  }

  // ---------------------------------------------------------------- ขอบภาพ
  const BORDER_CONSTANT = 0, BORDER_REPLICATE = 1, BORDER_REFLECT = 2, BORDER_REFLECT_101 = 4, BORDER_DEFAULT = 4;

  /** ดัชนีพิกเซลนอกภาพ */
  function borderIndex(i, n, mode) {
    if (i >= 0 && i < n) return i;
    if (n === 1) return 0;
    if (mode === BORDER_REPLICATE) return i < 0 ? 0 : n - 1;
    if (mode === BORDER_REFLECT) {
      while (i < 0 || i >= n) i = i < 0 ? -i - 1 : 2 * n - i - 1;
      return i;
    }
    while (i < 0 || i >= n) i = i < 0 ? -i : 2 * n - i - 2; // REFLECT_101
    return i;
  }

  // ---------------------------------------------------------------- เบลอ
  function GaussianBlur(src, dst, ksize, sigmaX, sigmaY, borderType) {
    const kw = ksize.width, kh = ksize.height;
    const border = borderType === undefined ? BORDER_DEFAULT : borderType;
    // core.js ใช้ 5×5 sigma 0 → kernel [1 4 6 4 1]/16 ของ OpenCV: ใช้เลขจำนวนเต็มล้วนให้เร็วและตรงกับ OpenCV
    if (kw === 5 && kh === 5 && !(sigmaX > 0) && !(sigmaY > 0) && border === BORDER_REFLECT_101 && src.cols >= 5 && src.rows >= 5) {
      dst.assign(src.rows, src.cols, CV_8U, blur5(u8(src), src.cols, src.rows));
      return;
    }
    const kx = gaussKernel(kw, sigmaX), ky = gaussKernel(kh, sigmaY || sigmaX);
    sepFilter8u(src, dst, kx, ky, border);
  }

  /** Gaussian 5×5 แบบ [1 4 6 4 1] ขอบ reflect-101 */
  function blur5(s, W, H) {
    const tmp = new Uint16Array(W * H);
    for (let y = 0; y < H; y++) {
      const o = y * W;
      // ขอบซ้าย/ขวา (reflect-101: -1→1, -2→2, W→W-2, W+1→W-3)
      tmp[o] = s[o + 2] * 2 + s[o + 1] * 8 + s[o] * 6;
      tmp[o + 1] = s[o + 1] + s[o + 3] + 4 * (s[o] + s[o + 2]) + 6 * s[o + 1];
      for (let x = 2; x < W - 2; x++) {
        const p = o + x;
        tmp[p] = s[p - 2] + s[p + 2] + 4 * (s[p - 1] + s[p + 1]) + 6 * s[p];
      }
      const e = o + W - 1;
      tmp[e - 1] = s[e - 3] + s[e - 1] + 4 * (s[e - 2] + s[e]) + 6 * s[e - 1];
      tmp[e] = s[e - 2] * 2 + s[e - 1] * 8 + s[e] * 6;
    }
    const out = new Uint8Array(W * H);
    const row = (y) => (y < 0 ? -y : y >= H ? 2 * H - y - 2 : y) * W;
    for (let y = 0; y < H; y++) {
      const a = row(y - 2), b = row(y - 1), c = y * W, d = row(y + 1), e = row(y + 2);
      for (let x = 0; x < W; x++) {
        out[c + x] = (tmp[a + x] + tmp[e + x] + 4 * (tmp[b + x] + tmp[d + x]) + 6 * tmp[c + x] + 128) >> 8;
      }
    }
    return out;
  }

  function gaussKernel(n, sigma) {
    const small = { 1: [1], 3: [0.25, 0.5, 0.25], 5: [0.0625, 0.25, 0.375, 0.25, 0.0625], 7: [0.03125, 0.109375, 0.21875, 0.28125, 0.21875, 0.109375, 0.03125] };
    if (!(sigma > 0) && small[n]) return small[n];
    const s = sigma > 0 ? sigma : ((n - 1) * 0.5 - 1) * 0.3 + 0.8;
    const k = [];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const x = i - (n - 1) / 2;
      const v = Math.exp(-(x * x) / (2 * s * s));
      k.push(v); sum += v;
    }
    return k.map((v) => v / sum);
  }

  /** กรองแบบแยกแกน สำหรับภาพ 8 บิต 1 ช่องสี */
  function sepFilter8u(src, dst, kx, ky, border) {
    const W = src.cols, H = src.rows;
    const s = u8(src);
    const rx = (kx.length - 1) >> 1, ry = (ky.length - 1) >> 1;
    const tmp = new Float32Array(W * H);
    const xi = new Int32Array(W + 2 * rx);
    for (let i = 0; i < xi.length; i++) xi[i] = borderIndex(i - rx, W, border);
    for (let y = 0; y < H; y++) {
      const ro = y * W;
      for (let x = 0; x < W; x++) {
        let acc = 0;
        for (let k = 0; k < kx.length; k++) acc += kx[k] * s[ro + xi[x + k]];
        tmp[ro + x] = acc;
      }
    }
    const out = new Uint8Array(W * H);
    const yi = new Int32Array(H + 2 * ry);
    for (let i = 0; i < yi.length; i++) yi[i] = borderIndex(i - ry, H, border);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let acc = 0;
        for (let k = 0; k < ky.length; k++) acc += ky[k] * tmp[yi[y + k] * W + x];
        const v = Math.round(acc);
        out[y * W + x] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
    dst.assign(H, W, CV_8U, out);
  }

  // ---------------------------------------------------------------- threshold
  const THRESH_BINARY = 0, THRESH_BINARY_INV = 1, THRESH_OTSU = 8;
  const ADAPTIVE_THRESH_MEAN_C = 0;

  function adaptiveThreshold(src, dst, maxValue, method, type, blockSize, C) {
    const W = src.cols, H = src.rows;
    const s = u8(src);
    const mv = Math.max(0, Math.min(255, Math.round(maxValue)));
    const out = new Uint8Array(W * H);
    const r = blockSize >> 1;
    const area = blockSize * blockSize;
    // ผลรวมแนวตั้งของแต่ละคอลัมน์ในหน้าต่าง (ขอบ replicate) แล้วเลื่อนผลรวมแนวนอนไปตามแถว
    // ค่าเฉลี่ยปัดเศษ m = round(sum/area) เทียบแบบจำนวนเต็ม: m >= v ⇔ 2·sum + area >= 2·area·v
    const col = new Int32Array(W);
    for (let i = -r; i <= r; i++) {
      const o = (i < 0 ? 0 : i >= H ? H - 1 : i) * W;
      for (let x = 0; x < W; x++) col[x] += s[o + x];
    }
    const inv = type === THRESH_BINARY_INV;
    const d = inv ? Math.floor(C) : Math.ceil(C);
    const a2 = 2 * area;
    for (let y = 0; y < H; y++) {
      if (y > 0) {
        const add = y + r, rem = y - r - 1;
        const ao = (add >= H ? H - 1 : add) * W, mo = (rem < 0 ? 0 : rem) * W;
        for (let x = 0; x < W; x++) col[x] += s[ao + x] - s[mo + x];
      }
      const o = y * W;
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += col[i < 0 ? 0 : i >= W ? W - 1 : i];
      for (let x = 0; x < W; x++) {
        if (x > 0) {
          const add = x + r, rem = x - r - 1;
          acc += col[add >= W ? W - 1 : add] - col[rem < 0 ? 0 : rem];
        }
        // BINARY_INV: src - mean <= -C ⇔ mean >= src + C
        const ge = 2 * acc + area >= a2 * (s[o + x] + d);
        out[o + x] = inv ? (ge ? mv : 0) : (ge ? 0 : mv);
      }
    }
    dst.assign(H, W, CV_8U, out);
    dst.bin = mv === 255;
  }

  function otsu(s) {
    const hist = new Float64Array(256);
    for (let i = 0; i < s.length; i++) hist[s[i]]++;
    const scale = 1 / s.length;
    let mu = 0;
    for (let i = 0; i < 256; i++) mu += i * hist[i];
    mu *= scale;
    let mu1 = 0, q1 = 0, maxSigma = 0, maxVal = 0;
    const eps = 1.1920929e-7;
    for (let i = 0; i < 256; i++) {
      const p = hist[i] * scale;
      mu1 *= q1;
      q1 += p;
      const q2 = 1 - q1;
      if (Math.min(q1, q2) < eps || Math.max(q1, q2) > 1 - eps) continue;
      mu1 = (mu1 + i * p) / q1;
      const mu2 = (mu - q1 * mu1) / q2;
      const sigma = q1 * q2 * (mu1 - mu2) * (mu1 - mu2);
      if (sigma > maxSigma) { maxSigma = sigma; maxVal = i; }
    }
    return maxVal;
  }

  function threshold(src, dst, thresh, maxval, type) {
    const s = u8(src);
    let t = thresh;
    if (type & THRESH_OTSU) t = otsu(s);
    const kind = type & 7;
    const mv = Math.max(0, Math.min(255, Math.round(maxval)));
    const tt = Math.floor(t);
    const out = new Uint8Array(s.length);
    if (kind === THRESH_BINARY_INV) for (let i = 0; i < s.length; i++) out[i] = s[i] > tt ? 0 : mv;
    else for (let i = 0; i < s.length; i++) out[i] = s[i] > tt ? mv : 0;
    dst.assign(src.rows, src.cols, CV_8U, out);
    dst.bin = mv === 255;
    return t;
  }

  // ---------------------------------------------------------------- morphology
  const MORPH_RECT = 0, MORPH_ERODE = 0, MORPH_DILATE = 1, MORPH_OPEN = 2, MORPH_CLOSE = 3;

  function getStructuringElement(shape, ksize) {
    return Mat.ones(ksize.height, ksize.width, CV_8U);
  }

  /**
   * min/max ในหน้าต่างยาว k ของทุกแถวหรือทุกคอลัมน์ (van Herk/Gil-Werman: 3 ครั้งต่อพิกเซลไม่ว่า k เท่าไร)
   * หน้าต่างของพิกเซล i คือ [i - a, i - a + k - 1] เหมือน anchor ของ OpenCV พิกเซลนอกภาพไม่มีผล
   */
  function runFilter(s, W, H, k, a, horizontal, isMax) {
    const out = new Uint8Array(W * H);
    if (k <= 1) { out.set(s); return out; }
    const n = horizontal ? W : H;
    const lines = horizontal ? H : W;
    const stride = horizontal ? 1 : W;
    const pad = isMax ? 0 : 255;
    const len = n + k - 1;
    const P = new Uint8Array(len), g = new Uint8Array(len), hh = new Uint8Array(len);
    for (let l = 0; l < lines; l++) {
      const base = horizontal ? l * W : l;
      // P[j] = พิกเซลที่ j - a ของแถว/คอลัมน์ หน้าต่างของพิกเซล i จึงเป็น P[i .. i + k - 1]
      for (let j = 0; j < len; j++) {
        const src = j - a;
        P[j] = (src >= 0 && src < n) ? s[base + src * stride] : pad;
      }
      // g: ค่าสะสมจากซ้ายภายในบล็อกยาว k, hh: ค่าสะสมจากขวา
      for (let j = 0; j < len; j++) {
        if (j % k === 0) g[j] = P[j];
        else { const pv = g[j - 1], v = P[j]; g[j] = isMax ? (v > pv ? v : pv) : (v < pv ? v : pv); }
      }
      for (let j = len - 1; j >= 0; j--) {
        if (j === len - 1 || (j + 1) % k === 0) hh[j] = P[j];
        else { const nv = hh[j + 1], v = P[j]; hh[j] = isMax ? (v > nv ? v : nv) : (v < nv ? v : nv); }
      }
      for (let i = 0; i < n; i++) {
        // หน้าต่างของพิกเซล i ใน P คือ [i, i + k - 1]
        const x = hh[i], y = g[i + k - 1];
        out[base + i * stride] = isMax ? (x > y ? x : y) : (x < y ? x : y);
      }
    }
    return out;
  }

  /**
   * erode/dilate ของภาพขาวดำ (0/255) แนวนอน หน้าต่างของพิกเซล x คือ [x - a, x - a + k - 1]
   * หาช่วงพิกเซลขาวด้วย indexOf แล้วระบายผลด้วย fill (ทั้งสองทำงานในเบราว์เซอร์โดยตรง เร็วแม้ไม่มี JIT)
   * dilate: ช่วง [rs, re] ขยายเป็น [rs - (k - 1 - a), re + a]
   * erode:  ช่วง [rs, re] หดเป็น [rs + a, re - (k - 1 - a)] ยกเว้นด้านที่ชนขอบภาพ (นอกภาพไม่มีผลเหมือน OpenCV)
   */
  function binRows(s, W, H, k, a, isMax) {
    const out = new Uint8Array(W * H);
    const left = k - 1 - a;
    for (let y = 0; y < H; y++) {
      const o = y * W;
      const row = s.subarray(o, o + W);
      let pos = 0;
      while (pos < W) {
        const rs = row.indexOf(255, pos);
        if (rs < 0) break;
        let re = row.indexOf(0, rs);
        re = re < 0 ? W - 1 : re - 1;
        let from, to;
        if (isMax) { from = rs - left; to = re + a; }
        else { from = rs === 0 ? 0 : rs + a; to = re === W - 1 ? W - 1 : re - left; }
        if (from < 0) from = 0;
        if (to > W - 1) to = W - 1;
        if (to >= from) out.fill(255, o + from, o + to + 1);
        pos = re + 1;
      }
    }
    return out;
  }

  /** เหมือน binRows แต่แนวตั้ง: เก็บผลรวม (0/255) ของแต่ละคอลัมน์ในหน้าต่าง แล้วเลื่อนทีละแถว */
  function binCols(s, W, H, k, a, isMax) {
    const out = new Uint8Array(W * H);
    const cnt = new Int32Array(W);
    let lo = -a, hi = k - 1 - a;
    for (let r = lo < 0 ? 0 : lo; r <= hi && r < H; r++) {
      const o = r * W;
      for (let x = 0; x < W; x++) cnt[x] += s[o + x];
    }
    for (let y = 0; y < H; y++) {
      const o = y * W;
      if (isMax) {
        for (let x = 0; x < W; x++) if (cnt[x] !== 0) out[o + x] = 255;
      } else {
        const full = 255 * ((hi >= H ? H - 1 : hi) - (lo < 0 ? 0 : lo) + 1);
        for (let x = 0; x < W; x++) if (cnt[x] === full) out[o + x] = 255;
      }
      const remO = lo >= 0 ? lo * W : -1;
      lo++; hi++;
      const addO = hi < H ? hi * W : -1;
      if (remO >= 0 && addO >= 0) for (let x = 0; x < W; x++) cnt[x] += s[addO + x] - s[remO + x];
      else if (remO >= 0) for (let x = 0; x < W; x++) cnt[x] -= s[remO + x];
      else if (addO >= 0) for (let x = 0; x < W; x++) cnt[x] += s[addO + x];
    }
    return out;
  }

  /** erode/dilate ด้วย kernel สี่เหลี่ยมขนาด kw×kh (แยกแกน) */
  function rectMorph(s, W, H, kw, kh, isMax, bin) {
    let out = s;
    if (kw > 1) out = bin ? binRows(out, W, H, kw, kw >> 1, isMax) : runFilter(out, W, H, kw, kw >> 1, true, isMax);
    if (kh > 1) out = bin ? binCols(out, W, H, kh, kh >> 1, isMax) : runFilter(out, W, H, kh, kh >> 1, false, isMax);
    if (out === s) out = s.slice();
    return out;
  }

  const kernelSize = (kernel) => (kernel && kernel.rows ? { w: kernel.cols, h: kernel.rows } : { w: 3, h: 3 });

  function erode(src, dst, kernel) {
    const { w, h } = kernelSize(kernel);
    const bin = !!src.bin;
    dst.assign(src.rows, src.cols, CV_8U, rectMorph(u8(src), src.cols, src.rows, w, h, false, bin));
    dst.bin = bin;
  }

  function dilate(src, dst, kernel) {
    const { w, h } = kernelSize(kernel);
    const bin = !!src.bin;
    dst.assign(src.rows, src.cols, CV_8U, rectMorph(u8(src), src.cols, src.rows, w, h, true, bin));
    dst.bin = bin;
  }

  function morphologyEx(src, dst, op, kernel) {
    const { w, h } = kernelSize(kernel);
    const W = src.cols, H = src.rows;
    const bin = !!src.bin;
    let out;
    if (op === MORPH_OPEN) out = rectMorph(rectMorph(u8(src), W, H, w, h, false, bin), W, H, w, h, true, bin);
    else if (op === MORPH_CLOSE) out = rectMorph(rectMorph(u8(src), W, H, w, h, true, bin), W, H, w, h, false, bin);
    else if (op === MORPH_DILATE) out = rectMorph(u8(src), W, H, w, h, true, bin);
    else out = rectMorph(u8(src), W, H, w, h, false, bin);
    dst.assign(H, W, CV_8U, out);
    dst.bin = bin;
  }

  /** median แบบ Huang (ฮิสโทแกรมเลื่อน) ขอบแบบ replicate */
  function medianBlur(src, dst, ksize) {
    const W = src.cols, H = src.rows;
    const s = u8(src);
    const r = ksize >> 1;
    const half = (ksize * ksize) >> 1;
    const out = new Uint8Array(W * H);
    const hist = new Int32Array(256);
    const cx = (x) => (x < 0 ? 0 : x >= W ? W - 1 : x);
    const rowsIdx = new Int32Array(ksize);
    for (let y = 0; y < H; y++) {
      for (let i = 0; i < ksize; i++) { const yy = y - r + i; rowsIdx[i] = (yy < 0 ? 0 : yy >= H ? H - 1 : yy) * W; }
      hist.fill(0);
      for (let i = 0; i < ksize; i++) for (let dx = -r; dx <= r; dx++) hist[s[rowsIdx[i] + cx(dx)]]++;
      let med = 0, lt = 0;
      while (lt + hist[med] <= half) { lt += hist[med]; med++; }
      out[y * W] = med;
      for (let x = 1; x < W; x++) {
        const rem = cx(x - r - 1), add = cx(x + r);
        for (let i = 0; i < ksize; i++) {
          const ro = rowsIdx[i];
          const v0 = s[ro + rem];
          hist[v0]--; if (v0 < med) lt--;
          const v1 = s[ro + add];
          hist[v1]++; if (v1 < med) lt++;
        }
        if (lt > half) {
          do { med--; lt -= hist[med]; } while (lt > half);
        } else {
          while (lt + hist[med] <= half) { lt += hist[med]; med++; }
        }
        out[y * W + x] = med;
      }
    }
    dst.assign(H, W, CV_8U, out);
  }

  // ---------------------------------------------------------------- เลขคณิตและบิต
  function divide(src1, src2, dst, scale, dtype) {
    const a = u8(src1), b = u8(src2);
    const sc = scale === undefined ? 1 : scale;
    const out = new Uint8Array(a.length);
    for (let i = 0; i < a.length; i++) {
      const d = b[i];
      if (d === 0) { out[i] = 0; continue; }
      const v = Math.round((a[i] * sc) / d);
      out[i] = v > 255 ? 255 : v;
    }
    dst.assign(src1.rows, src1.cols, src1.type(), out);
  }

  function bitwise_or(a, b, dst) {
    const x = u8(a), y = u8(b);
    const out = new Uint8Array(x.length);
    for (let i = 0; i < x.length; i++) out[i] = x[i] | y[i];
    const bin = !!(a.bin && b.bin);
    dst.assign(a.rows, a.cols, a.type(), out);
    dst.bin = bin;
  }

  function bitwise_and(a, b, dst) {
    const x = u8(a), y = u8(b);
    const out = new Uint8Array(x.length);
    for (let i = 0; i < x.length; i++) out[i] = x[i] & y[i];
    const bin = !!(a.bin && b.bin);
    dst.assign(a.rows, a.cols, a.type(), out);
    dst.bin = bin;
  }

  function bitwise_not(a, dst) {
    const x = u8(a);
    const out = new Uint8Array(x.length);
    for (let i = 0; i < x.length; i++) out[i] = 255 - x[i];
    const bin = !!a.bin;
    dst.assign(a.rows, a.cols, a.type(), out);
    dst.bin = bin;
  }

  function countNonZero(m) {
    let n = 0;
    const w = m.cols * m.channels();
    for (let y = 0; y < m.rows; y++) {
      const o = m.offset + y * m.step;
      for (let x = 0; x < w; x++) if (m.buf[o + x] !== 0) n++;
    }
    return n;
  }

  const REDUCE_SUM = 0, REDUCE_AVG = 1, REDUCE_MAX = 2, REDUCE_MIN = 3;

  function reduce(src, dst, dim, rtype, dtype) {
    const W = src.cols, H = src.rows;
    const s = u8(src);
    if (dim === 0) {
      const out = new Int32Array(W);
      for (let y = 0; y < H; y++) { const o = y * W; for (let x = 0; x < W; x++) out[x] += s[o + x]; }
      dst.assign(1, W, CV_32S, out);
    } else {
      const out = new Int32Array(H);
      for (let y = 0; y < H; y++) { const o = y * W; let acc = 0; for (let x = 0; x < W; x++) acc += s[o + x]; out[y] = acc; }
      dst.assign(H, 1, CV_32S, out);
    }
  }

  function gemm(a, b, alpha, c, beta, d) {
    const A = a.data64F, B = b.data64F;
    const n = a.rows, m = b.cols, k = a.cols;
    const C = c && !c.empty() ? c.data64F : null;
    const out = new Float64Array(n * m);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) {
        let acc = 0;
        for (let t = 0; t < k; t++) acc += A[i * k + t] * B[t * m + j];
        out[i * m + j] = alpha * acc + (C ? beta * C[i * m + j] : 0);
      }
    }
    d.assign(n, m, CV_64F, out);
  }

  // ---------------------------------------------------------------- ย่อ/ขยายภาพ
  const INTER_NEAREST = 0, INTER_LINEAR = 1, INTER_CUBIC = 2, INTER_AREA = 3;

  /** น้ำหนักแบบเชิงเส้น (กึ่งกลางพิกเซลตรงกันแบบ OpenCV) */
  function linearTaps(dn, sn) {
    const scale = sn / dn;
    const i0 = new Int32Array(dn), i1 = new Int32Array(dn), w1 = new Float32Array(dn);
    for (let x = 0; x < dn; x++) {
      let f = (x + 0.5) * scale - 0.5;
      let i = Math.floor(f);
      f -= i;
      if (i < 0) { i = 0; f = 0; }
      if (i >= sn - 1) { i = sn - 1; f = 0; }
      i0[x] = i; i1[x] = Math.min(i + 1, sn - 1); w1[x] = f;
    }
    return { i0, i1, w1 };
  }

  /** น้ำหนักแบบเฉลี่ยพื้นที่ (ย่อภาพ) */
  function areaTaps(dn, sn) {
    const scale = sn / dn;
    const start = new Int32Array(dn + 1);
    const idx = [], wt = [];
    for (let x = 0; x < dn; x++) {
      const f0 = x * scale, f1 = Math.min(sn, (x + 1) * scale);
      start[x] = idx.length;
      let i = Math.floor(f0);
      for (; i < f1 - 1e-9; i++) {
        const a = Math.max(f0, i), b = Math.min(f1, i + 1);
        if (b - a > 1e-9) { idx.push(Math.min(i, sn - 1)); wt.push((b - a) / (f1 - f0)); }
      }
    }
    start[dn] = idx.length;
    return { start, idx: Int32Array.from(idx), wt: Float32Array.from(wt) };
  }

  function resize(src, dst, dsize, fx, fy, interpolation) {
    const sw = src.cols, sh = src.rows, ch = src.channels();
    const dw = dsize && dsize.width ? dsize.width : Math.round(sw * fx);
    const dh = dsize && dsize.height ? dsize.height : Math.round(sh * fy);
    const s = u8(src);
    const out = new Uint8Array(dw * dh * ch);
    const rowS = sw * ch, rowW = dw * ch;
    const tmp = new Float32Array(rowW * sh);
    if (interpolation === INTER_AREA && dw <= sw && dh <= sh) {
      const tx = areaTaps(dw, sw), ty = areaTaps(dh, sh);
      const xs = tx.start, xi = tx.idx, xw = tx.wt, ys = ty.start, yi = ty.idx, yw = ty.wt;
      for (let y = 0; y < sh; y++) {
        const ro = y * rowS, to = y * rowW;
        for (let x = 0; x < dw; x++) {
          const t0 = xs[x], t1 = xs[x + 1];
          for (let c = 0; c < ch; c++) {
            let acc = 0;
            for (let t = t0; t < t1; t++) acc += xw[t] * s[ro + xi[t] * ch + c];
            tmp[to + x * ch + c] = acc;
          }
        }
      }
      for (let y = 0; y < dh; y++) {
        const oo = y * rowW, t0 = ys[y], t1 = ys[y + 1];
        for (let i = 0; i < rowW; i++) {
          let acc = 0;
          for (let t = t0; t < t1; t++) acc += yw[t] * tmp[yi[t] * rowW + i];
          out[oo + i] = acc + 0.5; // Uint8Array ตัดเศษและจำกัดช่วง 0–255 ให้เอง (ค่าไม่ติดลบ)
        }
      }
    } else {
      const tx = linearTaps(dw, sw), ty = linearTaps(dh, sh);
      const x0 = tx.i0, x1 = tx.i1, xf = tx.w1;
      for (let y = 0; y < sh; y++) {
        const ro = y * rowS, to = y * rowW;
        if (ch === 1) {
          for (let x = 0; x < dw; x++) {
            const va = s[ro + x0[x]];
            tmp[to + x] = va + (s[ro + x1[x]] - va) * xf[x];
          }
        } else {
          for (let x = 0; x < dw; x++) {
            const a = ro + x0[x] * ch, b = ro + x1[x] * ch, f = xf[x];
            for (let c = 0; c < ch; c++) {
              const va = s[a + c];
              tmp[to + x * ch + c] = va + (s[b + c] - va) * f;
            }
          }
        }
      }
      const y0 = ty.i0, y1 = ty.i1, yf = ty.w1;
      for (let y = 0; y < dh; y++) {
        const a = y0[y] * rowW, b = y1[y] * rowW, f = yf[y], oo = y * rowW;
        if (f === 0) {
          for (let i = 0; i < rowW; i++) out[oo + i] = tmp[a + i] + 0.5;
        } else {
          for (let i = 0; i < rowW; i++) {
            const va = tmp[a + i];
            out[oo + i] = va + (tmp[b + i] - va) * f + 0.5;
          }
        }
      }
    }
    dst.assign(dh, dw, makeType(CV_8U, ch), out);
  }

  // ---------------------------------------------------------------- เรขาคณิต
  const CV_32FC2 = makeType(CV_32F, 2), CV_32SC2 = makeType(CV_32S, 2);

  function points(m) {
    const d = m.depth() === CV_32S ? m.data32S : m.depth() === CV_32F ? m.data32F : m.data64F;
    const n = d.length >> 1;
    const pts = new Array(n);
    for (let i = 0; i < n; i++) pts[i] = [d[2 * i], d[2 * i + 1]];
    return pts;
  }

  function pointsMat(pts, dst) {
    const buf = new Int32Array(pts.length * 2);
    for (let i = 0; i < pts.length; i++) { buf[2 * i] = Math.round(pts[i][0]); buf[2 * i + 1] = Math.round(pts[i][1]); }
    const m = dst || new Mat();
    return m.assign(pts.length, 1, CV_32SC2, buf);
  }

  function contourArea(contour, oriented) {
    const d = contour.depth() === CV_32S ? contour.data32S : contour.data32F;
    const n = d.length >> 1;
    if (n < 3) return 0;
    let a = 0;
    let px = d[2 * (n - 1)], py = d[2 * (n - 1) + 1];
    for (let i = 0; i < n; i++) {
      const x = d[2 * i], y = d[2 * i + 1];
      a += px * y - x * py;
      px = x; py = y;
    }
    a *= 0.5;
    return oriented ? a : Math.abs(a);
  }

  function arcLength(curve, closed) {
    const p = points(curve);
    let len = 0;
    for (let i = 1; i < p.length; i++) len += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    if (closed && p.length > 1) len += Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]);
    return len;
  }

  /** convex hull (Andrew's monotone chain) */
  function convexHull(points_, hull, clockwise, returnPoints) {
    const p = points(points_).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const q of p) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
      lower.push(q);
    }
    for (let i = p.length - 1; i >= 0; i--) {
      const q = p[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
      upper.push(q);
    }
    let h = p.length < 3 ? p.slice() : lower.slice(0, -1).concat(upper.slice(0, -1));
    // ลำดับตามเข็มนาฬิกาบนจอ (y ชี้ลง) = ทวนเข็มในระบบที่ y ชี้ขึ้น ซึ่ง OpenCV ใช้เมื่อ clockwise=false
    if (clockwise) h = h.reverse();
    pointsMat(h, hull);
  }

  /** Douglas-Peucker แบบเดียวกับ approxPolyDP ของ OpenCV */
  function approxPolyDP(curve, approxCurve, epsilon, closed) {
    const src = points(curve);
    const count0 = src.length;
    if (!count0) { pointsMat([], approxCurve); return; }
    const eps = epsilon * epsilon;
    const dst = [];
    const stack = [];
    let count = count0;
    let isClosed = !!closed;
    let initIters = 3;
    let startPt = [-1000000, -1000000], endPt, pt;
    let pos = 0, leEps = false;
    let sliceStart = 0, sliceEnd = 0, rightStart = 0, rightEnd = 0;

    if (!isClosed) {
      rightStart = count;
      endPt = src[0];
      startPt = src[count - 1];
      if (startPt[0] !== endPt[0] || startPt[1] !== endPt[1]) {
        stack.push([0, count - 1]);
      } else {
        isClosed = true;
        initIters = 1;
      }
    }

    if (isClosed) {
      rightStart = 0;
      for (let i = 0; i < initIters; i++) {
        let maxDist = 0;
        pos = (pos + rightStart) % count;
        startPt = src[pos];
        if (++pos >= count) pos = 0;
        for (let j = 1; j < count; j++) {
          pt = src[pos];
          if (++pos >= count) pos = 0;
          const dx = pt[0] - startPt[0], dy = pt[1] - startPt[1];
          const dist = dx * dx + dy * dy;
          if (dist > maxDist) { maxDist = dist; rightStart = j; }
        }
        leEps = maxDist <= eps;
      }
      if (!leEps) {
        rightEnd = sliceStart = pos % count;
        sliceEnd = rightStart = (rightStart + sliceStart) % count;
        stack.push([rightStart, rightEnd]);
        stack.push([sliceStart, sliceEnd]);
      } else {
        dst.push(startPt);
      }
    }

    while (stack.length) {
      const [s0, s1] = stack.pop();
      endPt = src[s1];
      pos = s0;
      startPt = src[pos];
      if (++pos >= count) pos = 0;
      let split = -1;
      if (pos !== s1) {
        const dx = endPt[0] - startPt[0], dy = endPt[1] - startPt[1];
        let maxDist = 0;
        while (pos !== s1) {
          pt = src[pos];
          if (++pos >= count) pos = 0;
          const dist = Math.abs((pt[1] - startPt[1]) * dx - (pt[0] - startPt[0]) * dy);
          if (dist > maxDist) { maxDist = dist; split = (pos + count - 1) % count; }
        }
        leEps = maxDist * maxDist <= eps * (dx * dx + dy * dy);
      } else {
        leEps = true;
        startPt = src[s0];
      }
      if (leEps) {
        dst.push(startPt);
      } else {
        stack.push([split, s1]);
        stack.push([s0, split]);
      }
    }

    if (!isClosed) dst.push(src[count - 1]);

    // ตัดจุดที่อยู่บนเส้นตรงเกือบเดียวกันออก
    isClosed = !!closed;
    count = dst.length;
    let newCount = count;
    pos = isClosed ? count - 1 : 0;
    const readDst = () => { const v = dst[pos]; if (++pos >= count) pos = 0; return v; };
    startPt = readDst();
    let wpos = pos;
    pt = readDst();
    const out = dst.slice();
    const lo = isClosed ? 0 : 1, hi = count - (isClosed ? 0 : 1);
    for (let i = lo; i < hi && newCount > 2; i++) {
      endPt = readDst();
      const dx = endPt[0] - startPt[0], dy = endPt[1] - startPt[1];
      const dist = Math.abs((pt[0] - startPt[0]) * dy - (pt[1] - startPt[1]) * dx);
      const inner = (pt[0] - startPt[0]) * (endPt[0] - pt[0]) + (pt[1] - startPt[1]) * (endPt[1] - pt[1]);
      if (dist * dist <= 0.5 * eps * (dx * dx + dy * dy) && dx !== 0 && dy !== 0 && inner >= 0) {
        newCount--;
        out[wpos] = startPt = endPt;
        if (++wpos >= count) wpos = 0;
        pt = readDst();
        i++;
        continue;
      }
      out[wpos] = startPt = pt;
      if (++wpos >= count) wpos = 0;
      pt = endPt;
    }
    if (!isClosed) out[wpos] = pt;
    pointsMat(out.slice(0, newCount), approxCurve);
  }

  /** แก้ระบบสมการเชิงเส้น n×n (Gaussian elimination + partial pivoting) */
  function solve(A, b, n) {
    const M = A.map((row, i) => row.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = c + 1; r < n; r++) {
        const f = M[r][c] / M[c][c];
        if (!f) continue;
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
      let s = M[r][n];
      for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
      x[r] = s / M[r][r];
    }
    return x;
  }

  function getPerspectiveTransform(srcPts, dstPts) {
    const s = points(srcPts), d = points(dstPts);
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      A.push([s[i][0], s[i][1], 1, 0, 0, 0, -s[i][0] * d[i][0], -s[i][1] * d[i][0]]);
      b.push(d[i][0]);
    }
    for (let i = 0; i < 4; i++) {
      A.push([0, 0, 0, s[i][0], s[i][1], 1, -s[i][0] * d[i][1], -s[i][1] * d[i][1]]);
      b.push(d[i][1]);
    }
    const x = solve(A, b, 8) || [1, 0, 0, 0, 1, 0, 0, 0];
    return matFromArray(3, 3, CV_64F, x.concat([1]));
  }

  function invert3(m) {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C;
    if (!det) return null;
    const inv = 1 / det;
    return [A * inv, -(b * i - c * h) * inv, (b * f - c * e) * inv,
      B * inv, (a * i - c * g) * inv, -(a * f - c * d) * inv,
      C * inv, -(a * h - b * g) * inv, (a * e - b * d) * inv];
  }

  const WARP_INVERSE_MAP = 16;

  /**
   * ดัดภาพตามเมทริกซ์ perspective แบบ bilinear ขอบแบบ replicate
   * คำนวณพิกัดต้นทางจริงทุก 16 พิกเซลแล้วประมาณเชิงเส้นระหว่างนั้น (คลาดไม่ถึง 0.01 พิกเซลสำหรับกระดาษที่ถ่ายเอียง)
   */
  function warpPerspective(src, dst, M, dsize, flags, borderMode, borderValue) {
    const sw = src.cols, sh = src.rows, ch = src.channels();
    const W = dsize.width, H = dsize.height;
    const m = Array.from(M.data64F);
    const T = (flags & WARP_INVERSE_MAP) ? m : invert3(m);
    const out = new Uint8Array(W * H * ch);
    if (!T) { dst.assign(H, W, src.type(), out); return; }
    const s = u8(src);
    const maxX = sw - 1, maxY = sh - 1;
    const rowS = sw * ch;
    const t0 = T[0], t1 = T[1], t2 = T[2], t3 = T[3], t4 = T[4], t5 = T[5], t6 = T[6], t7 = T[7], t8 = T[8];
    const SPAN = 16;
    for (let y = 0; y < H; y++) {
      const bx = t1 * y + t2, by = t4 * y + t5, bw = t7 * y + t8;
      let oo = y * W * ch;
      for (let xs = 0; xs < W; xs += SPAN) {
        const xe = xs + SPAN < W ? xs + SPAN : W - 1;
        const w0 = bw + t6 * xs, w1 = bw + t6 * xe;
        const ax0 = w0 ? (bx + t0 * xs) / w0 : 0, ay0 = w0 ? (by + t3 * xs) / w0 : 0;
        const ax1 = w1 ? (bx + t0 * xe) / w1 : 0, ay1 = w1 ? (by + t3 * xe) / w1 : 0;
        const n = xe > xs ? xe - xs : 1;
        const dx = (ax1 - ax0) / n, dy = (ay1 - ay0) / n;
        const end = xs + SPAN < W ? xs + SPAN : W;
        let fx = ax0, fy = ay0;
        for (let x = xs; x < end; x++, oo += ch, fx += dx, fy += dy) {
          let px = fx < 0 ? 0 : fx > maxX ? maxX : fx;
          let py = fy < 0 ? 0 : fy > maxY ? maxY : fy;
          const x0 = px | 0, y0 = py | 0;
          const ax = px - x0, ay = py - y0;
          const p00 = y0 * rowS + x0 * ch;
          const sx = x0 < maxX ? ch : 0, sy = y0 < maxY ? rowS : 0;
          if (ch === 1) {
            const a = s[p00], b = s[p00 + sx], c = s[p00 + sy], d = s[p00 + sy + sx];
            const top = a + (b - a) * ax;
            out[oo] = top + (c + (d - c) * ax - top) * ay + 0.5;
          } else {
            for (let k = 0; k < ch; k++) {
              const p = p00 + k;
              const a = s[p], b = s[p + sx], c = s[p + sy], d = s[p + sy + sx];
              const top = a + (b - a) * ax;
              out[oo + k] = top + (c + (d - c) * ax - top) * ay + 0.5;
            }
          }
        }
      }
    }
    dst.assign(H, W, src.type(), out);
  }

  // ---------------------------------------------------------------- contours (Suzuki & Abe 1985)
  const RETR_EXTERNAL = 0, RETR_LIST = 1, RETR_CCOMP = 2, RETR_TREE = 3;
  const CHAIN_APPROX_NONE = 1, CHAIN_APPROX_SIMPLE = 2;
  // ทิศรอบพิกเซล: 0 ขวา แล้ววนทวนเข็มบนจอ (ขวาบน บน ซ้ายบน ซ้าย ซ้ายล่าง ล่าง ขวาล่าง)
  const DX = [1, 1, 0, -1, -1, -1, 0, 1];
  const DY = [0, -1, -1, -1, 0, 1, 1, 1];

  /**
   * หาเส้นขอบทั้งหมด (RETR_LIST: ทั้งขอบนอกและขอบรู ไม่สร้าง hierarchy)
   * ภาพถูกเติมขอบ 0 รอบนอก 1 พิกเซล เหมือน OpenCV ที่ถือว่านอกภาพเป็นพื้นหลัง
   */
  function findContours(image, contours, hierarchy, mode, method) {
    const W = image.cols, H = image.rows;
    const s = u8(image);
    const w2 = W + 2;
    const F = new Int32Array(w2 * (H + 2));
    for (let y = 0; y < H; y++) {
      const so = y * W, fo = (y + 1) * w2 + 1;
      for (let x = 0; x < W; x++) if (s[so + x]) F[fo + x] = 1;
    }
    const off = DX.map((dx, k) => DY[k] * w2 + dx);
    const simple = method === CHAIN_APPROX_SIMPLE;
    let nbd = 1;
    const outerOnly = mode === RETR_EXTERNAL;
    for (let y = 1; y <= H; y++) {
      for (let x = 1; x <= W; x++) {
        const p = y * w2 + x;
        const v = F[p];
        if (v === 0) continue;
        let fromDir;
        let isHole = false;
        if (v === 1 && F[p - 1] === 0) fromDir = 4;                 // ขอบนอก (ซ้ายเป็นพื้นหลัง)
        else if (v >= 1 && F[p + 1] === 0) { fromDir = 0; isHole = true; } // ขอบรู (ขวาเป็นพื้นหลัง)
        else continue;
        nbd++;
        if (nbd > 0x3fffffff) nbd = 2;
        const pts = [];
        // 3.1 หาเพื่อนบ้านแรกตามเข็มนาฬิกา
        let d1 = -1;
        for (let k = 0; k < 8; k++) {
          const d = (fromDir - k + 8) & 7;
          if (F[p + off[d]] !== 0) { d1 = d; break; }
        }
        if (d1 < 0) {
          F[p] = -nbd;
          pts.push(x - 1, y - 1);
        } else {
          const p1 = p + off[d1];
          let p3 = p, d2 = d1;  // d2: ทิศจาก p3 ไปยัง p2 (พิกเซลก่อนหน้า)
          let lastDir = -1;
          pts.push(x - 1, y - 1);
          for (let guard = 0; guard < 8 * w2 * (H + 2); guard++) {
            // 3.3 หาเพื่อนบ้านถัดไปทวนเข็มนาฬิกา เริ่มจากทิศถัดจาก d2
            let d4 = -1, eastZero = false;
            for (let k = 1; k <= 8; k++) {
              const d = (d2 + k) & 7;
              const q = p3 + off[d];
              if (F[q] !== 0) { d4 = d; break; }
              if (d === 0) eastZero = true;
            }
            // 3.4 ทำเครื่องหมาย
            if (eastZero) F[p3] = -nbd;
            else if (F[p3] === 1) F[p3] = nbd;
            const p4 = p3 + off[d4];
            // 3.5 กลับมาที่จุดเริ่ม
            if (p4 === p && p3 === p1) break;
            const nx = (p4 % w2) - 1, ny = ((p4 / w2) | 0) - 1;
            if (simple && d4 === lastDir) { pts[pts.length - 2] = nx; pts[pts.length - 1] = ny; }
            else pts.push(nx, ny);
            lastDir = d4;
            d2 = (d4 + 4) & 7;
            p3 = p4;
          }
          if (simple && pts.length > 4) {
            // จุดสุดท้ายอยู่บนเส้นตรงเดียวกับจุดแรกหรือไม่ (ตัดซ้ำเหมือน OpenCV)
            const n = pts.length;
            const ax = pts[n - 2] - pts[n - 4], ay = pts[n - 1] - pts[n - 3];
            const bx = pts[0] - pts[n - 2], by = pts[1] - pts[n - 1];
            if (Math.sign(ax) === Math.sign(bx) && Math.sign(ay) === Math.sign(by) && ax * by === ay * bx) pts.length = n - 2;
          }
        }
        if (!(outerOnly && isHole)) {
          const m = new Mat();
          m.assign(pts.length >> 1, 1, CV_32SC2, Int32Array.from(pts));
          contours.push_back(m);
        }
      }
    }
    if (hierarchy) hierarchy.assign(1, contours.size(), makeType(CV_32S, 4), new Int32Array(contours.size() * 4).fill(-1));
  }

  // ---------------------------------------------------------------- หมุนภาพ (ใช้ในชุดทดสอบ)
  const ROTATE_90_CLOCKWISE = 0, ROTATE_180 = 1, ROTATE_90_COUNTERCLOCKWISE = 2;

  function rotate(src, dst, code) {
    const W = src.cols, H = src.rows, ch = src.channels();
    const s = u8(src);
    const swap = code !== ROTATE_180;
    const dw = swap ? H : W, dh = swap ? W : H;
    const out = new Uint8Array(s.length);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let nx, ny;
        if (code === ROTATE_90_CLOCKWISE) { nx = H - 1 - y; ny = x; }
        else if (code === ROTATE_90_COUNTERCLOCKWISE) { nx = y; ny = W - 1 - x; }
        else { nx = W - 1 - x; ny = H - 1 - y; }
        const si = (y * W + x) * ch, di = (ny * dw + nx) * ch;
        for (let c = 0; c < ch; c++) out[di + c] = s[si + c];
      }
    }
    dst.assign(dh, dw, src.type(), out);
  }

  // ---------------------------------------------------------------- ส่งออก
  return {
    lite: true,
    Mat, MatVector, Size, Point, Rect, Scalar, matFromArray,
    CV_8U, CV_8UC1: CV_8U, CV_8UC3: makeType(CV_8U, 3), CV_8UC4: makeType(CV_8U, 4),
    CV_32S, CV_32F, CV_64F, CV_32FC2, CV_32SC2,
    COLOR_RGBA2GRAY, COLOR_RGB2GRAY, COLOR_BGR2GRAY, COLOR_BGRA2GRAY,
    BORDER_CONSTANT, BORDER_REPLICATE, BORDER_REFLECT, BORDER_REFLECT_101, BORDER_DEFAULT,
    THRESH_BINARY, THRESH_BINARY_INV, THRESH_OTSU, ADAPTIVE_THRESH_MEAN_C,
    MORPH_RECT, MORPH_ERODE, MORPH_DILATE, MORPH_OPEN, MORPH_CLOSE,
    INTER_NEAREST, INTER_LINEAR, INTER_CUBIC, INTER_AREA, WARP_INVERSE_MAP,
    REDUCE_SUM, REDUCE_AVG, REDUCE_MAX, REDUCE_MIN,
    RETR_EXTERNAL, RETR_LIST, RETR_CCOMP, RETR_TREE, CHAIN_APPROX_NONE, CHAIN_APPROX_SIMPLE,
    cvtColor, GaussianBlur, adaptiveThreshold, threshold, getStructuringElement, erode, dilate, morphologyEx,
    medianBlur, divide, bitwise_or, bitwise_and, bitwise_not, countNonZero, reduce, gemm, resize,
    contourArea, arcLength, convexHull, approxPolyDP, getPerspectiveTransform, warpPerspective, findContours,
    ROTATE_90_CLOCKWISE, ROTATE_180, ROTATE_90_COUNTERCLOCKWISE, rotate,
  };
});
