/*
 * CheckChoice — แกนอ่านกระดาษคำตอบแบบกากบาทในช่องตาราง (OMR)
 *
 * ใช้ได้ทั้งใน Web Worker (importScripts) และ Node (require) จึงเขียนแบบ UMD
 * ฟังก์ชันที่ใช้ OpenCV รับออบเจกต์ cv เป็นพารามิเตอร์ ส่วนการตัดสินคำตอบและการคิดคะแนน
 * เป็น JavaScript ล้วน ใช้ได้ทั้งในหน้าเว็บและในชุดทดสอบ
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OMRCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // แบบฟอร์มกระดาษคำตอบ
  // ---------------------------------------------------------------------------
  const TEMPLATES = [
    {
      id: 'grid-60x5',
      name: 'ตาราง 60 ข้อ (4 ชุด × 15 ข้อ) ตัวเลือก A–E',
      blocks: 4,            // จำนวนชุดคอลัมน์ข้อสอบ
      rowsPerBlock: 15,     // จำนวนข้อในแต่ละชุด
      choices: 5,           // จำนวนตัวเลือกต่อข้อ
      headerRows: 2,        // แถวหัวตาราง (A–E และ ก–จ)
      numberColumn: true,   // แต่ละชุดมีคอลัมน์ "ข้อ" อยู่ซ้ายสุด
      aspect: 1.83,         // อัตราส่วนกว้าง/สูงของตารางโดยประมาณ (ใช้ในโหมดกล้องสด)
      choiceLabels: ['A', 'B', 'C', 'D', 'E'],
      thaiLabels: ['ก', 'ข', 'ค', 'ง', 'จ'],
    },
  ];

  const DEFAULTS = {
    workLongSide: 2400,   // ปรับขนาดภาพให้ด้านยาวเท่านี้ก่อนประมวลผล
    warpWidth: 2400,      // ความกว้างของตารางหลังดัดภาพ
    pad: 20,              // ขอบรอบตารางหลังดัดภาพ
    minInk: 0.025,        // สัดส่วนหมึกขั้นต่ำที่นับว่าทำเครื่องหมาย
    dominance: 1.8,       // ช่องที่หมึกมากที่สุดต้องมากกว่าอันดับสองกี่เท่า
    scribbleInk: 0.22,    // ช่องที่หมึกเกินค่านี้และเด่นกว่าอีกช่องมาก = ระบายยกเลิก
    scribbleDominance: 1.5, // ช่องระบายต้องมีหมึกมากกว่าช่องกากบาทกี่เท่า (ภาพเบลอทำให้ค่าห่างกันน้อยลง)
    cellMargin: 0.12,     // ตัดขอบช่องออกกี่ส่วนก่อนนับหมึก
    displayWidth: 1200,   // ความกว้างภาพตารางที่ส่งกลับไปแสดงผล
  };

  function gridShape(t) {
    return {
      cols: t.blocks * (t.choices + (t.numberColumn ? 1 : 0)),
      rows: t.headerRows + t.rowsPerBlock,
    };
  }

  function questionCount(t) {
    return t.blocks * t.rowsPerBlock;
  }

  /** ตำแหน่งช่อง (แถว, คอลัมน์) ของข้อ q (เริ่มที่ 1) ตัวเลือก c (เริ่มที่ 0) */
  function cellOf(t, q, c) {
    const b = Math.floor((q - 1) / t.rowsPerBlock);
    const r = (q - 1) % t.rowsPerBlock;
    const per = t.choices + (t.numberColumn ? 1 : 0);
    return { row: t.headerRows + r, col: b * per + (t.numberColumn ? 1 : 0) + c };
  }

  /** ช่องเลขข้อ (ใช้ไฮไลต์ทั้งแถว) */
  function numberCellOf(t, q) {
    const b = Math.floor((q - 1) / t.rowsPerBlock);
    const r = (q - 1) % t.rowsPerBlock;
    const per = t.choices + (t.numberColumn ? 1 : 0);
    return { row: t.headerRows + r, col: b * per };
  }

  // ---------------------------------------------------------------------------
  // การตัดสินคำตอบ (JavaScript ล้วน)
  // ---------------------------------------------------------------------------
  /**
   * densities: สัดส่วนหมึกของแต่ละตัวเลือก
   * คืนค่า { choice: index|null, flag: null|'blank'|'multi'|'changed', cancelled: index|null }
   */
  function decide(densities, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const order = densities.map((v, i) => i).sort((a, b) => densities[b] - densities[a]);
    const top = densities[order[0]];
    const second = order.length > 1 ? densities[order[1]] : 0;
    const third = order.length > 2 ? densities[order[2]] : 0;
    if (top < o.minInk) return { choice: null, flag: 'blank', cancelled: null };
    if (second < o.minInk) return { choice: order[0], flag: null, cancelled: null };
    if (top >= o.scribbleInk && top >= second * o.scribbleDominance && third < o.minInk) {
      // ระบายทึบช่องหนึ่งเพื่อยกเลิก แล้วกากบาทอีกช่อง -> ใช้ช่องที่กากบาท แต่ให้ครูยืนยัน
      return { choice: order[1], flag: 'changed', cancelled: order[0] };
    }
    return { choice: null, flag: 'multi', cancelled: null };
  }

  const FLAG_TEXT = {
    blank: 'ไม่ได้ตอบ',
    multi: 'ตอบหลายช่อง',
    changed: 'แก้คำตอบ',
  };

  /** อ่านคำตอบทุกข้อจากค่าหมึก */
  function decideAll(template, densities, opts) {
    return densities.map((d) => decide(d, opts));
  }

  /** ข้อสุดท้ายที่มีเครื่องหมาย (ใช้เสนอจำนวนข้อจากใบเฉลย) */
  function lastMarkedQuestion(decisions) {
    for (let i = decisions.length - 1; i >= 0; i--) {
      if (decisions[i].flag !== 'blank') return i + 1;
    }
    return 0;
  }

  /**
   * คิดคะแนน
   * key: อาร์เรย์คำตอบที่ถูก (index ตัวเลือก หรือ null) ยาวเท่าจำนวนข้อของแบบฟอร์ม
   * items: อาร์เรย์ { choice, flag, resolved } ของนักศึกษา
   * ข้อที่ติดธงแต่ยังไม่ยืนยันนับเป็นศูนย์
   */
  function grade(key, items, count) {
    let correct = 0, pending = 0;
    const perQuestion = [];
    for (let i = 0; i < count; i++) {
      const it = items[i] || { choice: null, flag: 'blank', resolved: false };
      const unresolved = !!it.flag && !it.resolved;
      if (unresolved) pending++;
      const ok = !unresolved && key[i] != null && it.choice === key[i];
      if (ok) correct++;
      perQuestion.push({ ok, unresolved });
    }
    return { correct, total: count, pending, perQuestion };
  }

  // ---------------------------------------------------------------------------
  // ส่วนที่ใช้ OpenCV
  // ---------------------------------------------------------------------------
  function orderCorners(pts) {
    // pts: [[x,y] x4] -> บนซ้าย, บนขวา, ล่างขวา, ล่างซ้าย
    const s = pts.map((p) => p[0] + p[1]);
    const d = pts.map((p) => p[1] - p[0]);
    const idx = (arr, fn) => arr.indexOf(fn(...arr));
    return [pts[idx(s, Math.min)], pts[idx(d, Math.min)], pts[idx(s, Math.max)], pts[idx(d, Math.max)]];
  }

  function quadSize(q) {
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const w = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
    const h = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
    return { w, h };
  }

  function polygonArea(q) {
    let a = 0;
    for (let i = 0; i < q.length; i++) {
      const p = q[i], n = q[(i + 1) % q.length];
      a += p[0] * n[1] - n[0] * p[1];
    }
    return Math.abs(a) / 2;
  }

  /** หากรอบสี่เหลี่ยมขนาดใหญ่ที่อาจเป็นตาราง เรียงจากใหญ่ไปเล็ก */
  function findQuadCandidates(cv, gray, minAreaFrac, maxCandidates) {
    const mats = [];
    const keep = (m) => (mats.push(m), m);
    try {
      const blur = keep(new cv.Mat());
      cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);
      const bw = keep(new cv.Mat());
      const block = Math.max(15, Math.round(Math.max(gray.cols, gray.rows) / 83) | 1);
      cv.adaptiveThreshold(blur, bw, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, block, 10);
      const k3 = keep(cv.Mat.ones(3, 3, cv.CV_8U));
      cv.dilate(bw, bw, k3);
      const contours = keep(new cv.MatVector());
      const hierarchy = keep(new cv.Mat());
      cv.findContours(bw, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      const imgArea = gray.cols * gray.rows;
      const found = [];
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i);
        const area = cv.contourArea(c);
        if (area < minAreaFrac * imgArea) { c.delete(); continue; }
        const hull = new cv.Mat();
        cv.convexHull(c, hull, false, true);
        const peri = cv.arcLength(hull, true);
        let quad = null;
        for (const eps of [0.02, 0.03, 0.04, 0.05]) {
          const approx = new cv.Mat();
          cv.approxPolyDP(hull, approx, eps * peri, true);
          if (approx.rows === 4) {
            const d = approx.data32S;
            quad = orderCorners([[d[0], d[1]], [d[2], d[3]], [d[4], d[5]], [d[6], d[7]]]);
          }
          approx.delete();
          if (quad) break;
        }
        hull.delete();
        c.delete();
        if (quad) {
          const a = polygonArea(quad);
          // ตัดรายการซ้ำ (ขอบด้านนอก/ด้านในของเส้นเดียวกัน)
          const dup = found.some((f) => Math.abs(f.area - a) / a < 0.03 &&
            f.quad.every((p, j) => Math.hypot(p[0] - quad[j][0], p[1] - quad[j][1]) < 0.02 * Math.sqrt(imgArea)));
          if (!dup) found.push({ quad, area: a });
        }
      }
      found.sort((a, b) => b.area - a.area);
      return found.slice(0, maxCandidates || 6);
    } finally {
      mats.forEach((m) => m.delete());
    }
  }

  /** หาตำแหน่งเส้นจากผลรวมพิกเซล เลือกจุดสูงสุดที่ห่างกันพอ */
  function linePositions(profile, nExpected, minGapFrac) {
    const n = profile.length;
    const sm = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = -2; k <= 2; k++) {
        const j = i + k;
        if (j >= 0 && j < n) s += profile[j];
      }
      sm[i] = s / 5;
    }
    let max = 0;
    for (let i = 0; i < n; i++) if (sm[i] > max) max = sm[i];
    if (max <= 0) return [];
    const minGap = n / (nExpected * (minGapFrac || 2.2));
    const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => sm[b] - sm[a] || a - b);
    const peaks = [];
    for (const i of idx) {
      if (sm[i] < max * 0.15) break;
      if (peaks.every((p) => Math.abs(i - p) > minGap)) peaks.push(i);
      if (peaks.length === nExpected) break;
    }
    return peaks.sort((a, b) => a - b);
  }

  function spacingOk(lines, maxRatio) {
    const diffs = [];
    for (let i = 1; i < lines.length; i++) diffs.push(lines[i] - lines[i - 1]);
    const mn = Math.min(...diffs), mx = Math.max(...diffs);
    return mn > 0 && mx / mn <= maxRatio;
  }

  function reduceProfile(cv, mask, dim) {
    const out = new cv.Mat();
    cv.reduce(mask, out, dim, cv.REDUCE_SUM, cv.CV_32S);
    const arr = Array.from(out.data32S);
    out.delete();
    return arr;
  }

  /**
   * ดัดภาพตามกรอบ แล้วแบ่งช่องและวัดหมึก
   * คืนค่า null ถ้ากรอบนี้ไม่ใช่ตารางของแบบฟอร์ม
   */
  function analyzeQuad(cv, src, gray, quad, template, o) {
    const { cols, rows } = gridShape(template);
    const { w, h } = quadSize(quad);
    const W = o.warpWidth;
    const H = Math.round(W * h / w);
    const P = o.pad;
    const mats = [];
    const keep = (m) => (mats.push(m), m);
    try {
      const srcPts = keep(cv.matFromArray(4, 1, cv.CV_32FC2, [].concat(...quad)));
      const dstPts = keep(cv.matFromArray(4, 1, cv.CV_32FC2,
        [P, P, W - 1 - P, P, W - 1 - P, H - 1 - P, P, H - 1 - P]));
      const M = keep(cv.getPerspectiveTransform(srcPts, dstPts));
      const wg = keep(new cv.Mat());
      cv.warpPerspective(gray, wg, M, new cv.Size(W, H), cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar());

      // ทำให้แสงสม่ำเสมอ: ประมาณพื้นหลังจากภาพย่อ 1/4 (เร็วกว่า median 51 บนภาพเต็มมาก)
      const small = keep(new cv.Mat());
      cv.resize(wg, small, new cv.Size(Math.round(W / 4), Math.round(H / 4)), 0, 0, cv.INTER_AREA);
      cv.medianBlur(small, small, 13);
      const bg = keep(new cv.Mat());
      cv.resize(small, bg, new cv.Size(W, H), 0, 0, cv.INTER_LINEAR);
      const norm = keep(new cv.Mat());
      cv.divide(wg, bg, norm, 255, -1);
      const bw = keep(new cv.Mat());
      cv.threshold(norm, bw, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);

      // แยกเส้นตารางแนวนอน/แนวตั้ง
      const hk = Math.max(15, Math.round(W / (cols + 1)));
      const vk = Math.max(15, Math.round(H / Math.max(rows - 2, rows * 0.85)));
      const kh = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(hk, 1)));
      const kv = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, vk)));
      const horiz = keep(new cv.Mat());
      const vert = keep(new cv.Mat());
      cv.morphologyEx(bw, horiz, cv.MORPH_OPEN, kh);
      cv.morphologyEx(bw, vert, cv.MORPH_OPEN, kv);

      // เส้นกรอบนอกรู้ตำแหน่งจากการดัดภาพ จึงหาเฉพาะเส้นด้านใน
      const inner = P + 25;
      const px = reduceProfile(cv, vert, 0);
      const py = reduceProfile(cv, horiz, 1);
      for (let i = 0; i < inner; i++) { px[i] = 0; px[W - 1 - i] = 0; }
      for (let i = 0; i < inner; i++) { py[i] = 0; py[H - 1 - i] = 0; }
      const xs = [P].concat(linePositions(px, cols - 1), [W - 1 - P]);
      const ys = [P].concat(linePositions(py, rows - 1), [H - 1 - P]);
      if (xs.length !== cols + 1 || ys.length !== rows + 1) return null;
      if (!spacingOk(xs, 2.0) || !spacingOk(ys, 2.5)) return null;

      // หมึกที่เหลือหลังลบเส้นตาราง
      const grid = keep(new cv.Mat());
      cv.bitwise_or(horiz, vert, grid);
      const k7 = keep(cv.Mat.ones(7, 7, cv.CV_8U));
      cv.dilate(grid, grid, k7);
      cv.bitwise_not(grid, grid);
      const ink = keep(new cv.Mat());
      cv.bitwise_and(bw, grid, ink);
      const k3 = keep(cv.Mat.ones(3, 3, cv.CV_8U));
      cv.morphologyEx(ink, ink, cv.MORPH_OPEN, k3);

      const cellInk = (rowIdx, colIdx) => {
        const x0 = xs[colIdx], x1 = xs[colIdx + 1];
        const y0 = ys[rowIdx], y1 = ys[rowIdx + 1];
        const mx = Math.floor((x1 - x0) * o.cellMargin);
        const my = Math.floor((y1 - y0) * o.cellMargin);
        const rw = Math.max(1, x1 - x0 - 2 * mx), rh = Math.max(1, y1 - y0 - 2 * my);
        const roi = ink.roi(new cv.Rect(x0 + mx, y0 + my, rw, rh));
        const v = cv.countNonZero(roi) / (rw * rh);
        roi.delete();
        return v;
      };

      const nQ = questionCount(template);
      const densities = [];
      for (let q = 1; q <= nQ; q++) {
        const row = [];
        for (let c = 0; c < template.choices; c++) {
          const cell = cellOf(template, q, c);
          row.push(cellInk(cell.row, cell.col));
        }
        densities.push(row);
      }

      // ตรวจทิศกระดาษ: แถวหัวตาราง (A–E / ก–จ) มีตัวพิมพ์ทุกช่อง ส่วนแถวท้ายมีกากบาทแค่บางช่อง
      // ถ้าแถวล่างสุดดูเหมือนหัวตารางมากกว่า แปลว่าภาพกลับหัว
      let orientation = null;
      if (template.headerRows > 0) {
        const choiceCols = [];
        for (let c = 0; c < template.choices; c++) {
          for (let b = 0; b < template.blocks; b++) choiceCols.push(cellOf(template, 1 + b * template.rowsPerBlock, c).col);
        }
        const rowFill = (r) => choiceCols.filter((col) => cellInk(r, col) > o.minInk * 0.6).length / choiceCols.length;
        let top = 0, bottom = 0;
        for (let k = 0; k < template.headerRows; k++) {
          top = Math.max(top, rowFill(k));
          bottom = Math.max(bottom, rowFill(rows - 1 - k));
        }
        orientation = { top, bottom, upright: top >= 0.6 && top >= bottom };
      }

      // ภาพตารางสีสำหรับแสดงผล
      let display = null;
      if (src) {
        const wc = keep(new cv.Mat());
        cv.warpPerspective(src, wc, M, new cv.Size(W, H), cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar());
        const scale = Math.min(1, o.displayWidth / W);
        const dw = Math.round(W * scale), dh = Math.round(H * scale);
        const small = keep(new cv.Mat());
        cv.resize(wc, small, new cv.Size(dw, dh), 0, 0, cv.INTER_AREA);
        display = { width: dw, height: dh, scale, data: new Uint8ClampedArray(small.data) };
      }
      return { W, H, xs, ys, densities, display, orientation };
    } finally {
      mats.forEach((m) => m.delete());
    }
  }

  /** หมุนลำดับมุม: r=1 ภาพหมุนตามเข็ม 90°, r=2 กลับหัว, r=3 หมุนทวนเข็ม 90° */
  function rotateQuad(q, r) {
    return [q[r % 4], q[(r + 1) % 4], q[(r + 2) % 4], q[(r + 3) % 4]];
  }

  /**
   * อ่านกระดาษคำตอบหนึ่งแผ่น
   * rgba: cv.Mat ชนิด CV_8UC4 (ภาพจาก canvas หรือจากไฟล์)
   * คืนค่า { ok, error?, quad, W, H, xs, ys, densities, decisions, display }
   */
  function readSheet(cv, rgba, template, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const mats = [];
    const keep = (m) => (mats.push(m), m);
    try {
      let src = rgba;
      const long = Math.max(rgba.cols, rgba.rows);
      const s = o.workLongSide / long;
      if (Math.abs(s - 1) > 0.01) {
        src = keep(new cv.Mat());
        cv.resize(rgba, src, new cv.Size(Math.round(rgba.cols * s), Math.round(rgba.rows * s)), 0, 0,
          s < 0.5 ? cv.INTER_AREA : cv.INTER_LINEAR);
      }
      const gray = keep(new cv.Mat());
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      const candidates = findQuadCandidates(cv, gray, 0.15, 6);
      if (!candidates.length) {
        return { ok: false, error: 'not_found' };
      }
      const inv = 1 / s;
      const finish = (res, quad, rotation, warning) => Object.assign({
        ok: true,
        quad: quad.map((p) => [p[0] * inv, p[1] * inv]),
        rotation,
        warning: warning || null,
        decisions: decideAll(template, res.densities, o),
      }, res);
      const tplPortrait = (template.aspect || 1.5) < 1;
      for (const cand of candidates) {
        // ตารางในภาพเป็นแนวตั้ง แต่แบบฟอร์มเป็นแนวนอน (หรือกลับกัน) แปลว่าภาพหมุน 90°
        const { w, h } = quadSize(cand.quad);
        const rots = (w < h) !== tplPortrait ? [1, 3] : [0, 2];
        let fallback = null;
        for (const r of rots) {
          const quad = rotateQuad(cand.quad, r);
          const res = analyzeQuad(cv, src, gray, quad, template, o);
          if (!res) continue;
          if (!res.orientation || res.orientation.upright) return finish(res, quad, r);
          if (!fallback) fallback = { res, quad, r };
        }
        if (fallback) return finish(fallback.res, fallback.quad, fallback.r, 'orientation');
      }
      return { ok: false, error: 'grid' };
    } finally {
      mats.forEach((m) => m.delete());
    }
  }

  /**
   * หากรอบตารางอย่างเร็ว สำหรับโหมดกล้องสด (ไม่แบ่งช่อง)
   * rgba: ภาพขนาดเล็ก (เช่น กว้าง 640) คืนค่า quad หรือ null
   */
  function detectTable(cv, rgba, template) {
    const gray = new cv.Mat();
    try {
      cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
      const cands = findQuadCandidates(cv, gray, 0.12, 4);
      const want = template && template.aspect ? template.aspect : null;
      for (const c of cands) {
        const { w, h } = quadSize(c.quad);
        if (w < 1 || h < 1) continue;
        // เทียบอัตราส่วนแบบไม่สนทิศ (ถือมือถือแนวตั้งหรือแนวนอนก็ได้)
        const ar = Math.max(w, h) / Math.min(w, h);
        const wantN = want ? Math.max(want, 1 / want) : null;
        if (wantN && (ar < wantN * 0.7 || ar > wantN * 1.3)) continue;
        if (!wantN && ar > 3) continue;
        return c.quad;
      }
      return null;
    } finally {
      gray.delete();
    }
  }

  return {
    TEMPLATES,
    DEFAULTS,
    FLAG_TEXT,
    gridShape,
    questionCount,
    cellOf,
    numberCellOf,
    decide,
    decideAll,
    lastMarkedQuestion,
    grade,
    linePositions,
    readSheet,
    detectTable,
  };
});
