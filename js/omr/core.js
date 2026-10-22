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
  const LATIN = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const THAI = ['ก', 'ข', 'ค', 'ง', 'จ', 'ฉ', 'ช', 'ซ'];
  const LIMITS = { blocks: [1, 10], rowsPerBlock: [1, 60], choices: [2, 8], headerRows: [0, 4], questions: 300 };

  /**
   * โครงสร้างแบบฟอร์ม
   *  blocks        จำนวนชุดคอลัมน์ข้อสอบที่วางเรียงกันในแนวนอน
   *  rowsPerBlock  จำนวนข้อในแต่ละชุด
   *  choices       จำนวนตัวเลือกต่อข้อ
   *  headerRows    แถวหัวตาราง (เช่น A–E และ ก–จ) ใช้บอกทิศของกระดาษด้วย
   *  numberColumn  แต่ละชุดมีคอลัมน์ "ข้อ" อยู่ซ้ายสุด
   *  order         'down' เลขข้อเรียงลงตามคอลัมน์แล้วไปชุดถัดไป (1–15, 16–30 …)
   *                'across' เลขข้อเรียงตามแถวข้ามชุด (1 2 3 4 / 5 6 7 8 …)
   *  aspect        อัตราส่วนกว้าง/สูงของตารางโดยประมาณ (ใช้กรองกรอบในโหมดกล้องสด)
   */
  const TEMPLATES = [
    {
      id: 'grid-60x5',
      name: 'ตาราง 60 ข้อ (4 ชุด × 15 ข้อ) ตัวเลือก A–E',
      blocks: 4, rowsPerBlock: 15, choices: 5, headerRows: 2, numberColumn: true, order: 'down',
      aspect: 1.83,
      choiceLabels: LATIN.slice(0, 5), thaiLabels: THAI.slice(0, 5),
      builtin: true,
    },
    {
      id: 'grid-100x5',
      name: 'ตาราง 100 ข้อ (5 ชุด × 20 ข้อ) ตัวเลือก A–E',
      blocks: 5, rowsPerBlock: 20, choices: 5, headerRows: 2, numberColumn: true, order: 'down',
      choiceLabels: LATIN.slice(0, 5), thaiLabels: THAI.slice(0, 5),
      builtin: true,
    },
    {
      id: 'grid-120x4',
      name: 'ตาราง 120 ข้อ (4 ชุด × 30 ข้อ) ตัวเลือก A–D',
      blocks: 4, rowsPerBlock: 30, choices: 4, headerRows: 2, numberColumn: true, order: 'down',
      choiceLabels: LATIN.slice(0, 4), thaiLabels: THAI.slice(0, 4),
      builtin: true,
    },
  ];

  // แบบฟอร์มที่ไม่ได้ระบุอัตราส่วน ใช้อัตราส่วนของกระดาษที่แอปพิมพ์ให้
  TEMPLATES.forEach((t) => { if (!t.aspect) t.aspect = +sheetLayout(t).aspect.toFixed(3); });

  const clampInt = (v, lo, hi, d) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };

  /** สร้าง/เติมค่าแบบฟอร์มให้ครบและอยู่ในช่วงที่รองรับ */
  function normalizeTemplate(t) {
    const out = Object.assign({}, t);
    out.blocks = clampInt(t.blocks, ...LIMITS.blocks, 1);
    out.rowsPerBlock = clampInt(t.rowsPerBlock, ...LIMITS.rowsPerBlock, 20);
    out.choices = clampInt(t.choices, ...LIMITS.choices, 5);
    out.headerRows = clampInt(t.headerRows, ...LIMITS.headerRows, 1);
    out.numberColumn = t.numberColumn !== false;
    out.order = t.order === 'across' ? 'across' : 'down';
    out.choiceLabels = LATIN.slice(0, out.choices);
    out.thaiLabels = THAI.slice(0, out.choices);
    const a = Number(t.aspect);
    out.aspect = Number.isFinite(a) && a > 0.2 && a < 6 ? a : sheetLayout(out).aspect;
    out.name = typeof t.name === 'string' && t.name.trim() ? t.name.trim().slice(0, 80) : defaultName(out);
    return out;
  }

  function defaultName(t) {
    return `ตาราง ${t.blocks * t.rowsPerBlock} ข้อ (${t.blocks} ชุด × ${t.rowsPerBlock} ข้อ) ตัวเลือก ${LATIN[0]}–${LATIN[t.choices - 1]}`;
  }

  /** ตรวจว่าแบบฟอร์มใช้ได้ คืนรายการปัญหา (ว่าง = ใช้ได้) */
  function validateTemplate(t) {
    const errs = [];
    const inRange = (v, [lo, hi]) => Number.isInteger(v) && v >= lo && v <= hi;
    if (!inRange(t.blocks, LIMITS.blocks)) errs.push(`จำนวนชุดต้องอยู่ระหว่าง ${LIMITS.blocks.join('–')}`);
    if (!inRange(t.rowsPerBlock, LIMITS.rowsPerBlock)) errs.push(`จำนวนข้อต่อชุดต้องอยู่ระหว่าง ${LIMITS.rowsPerBlock.join('–')}`);
    if (!inRange(t.choices, LIMITS.choices)) errs.push(`จำนวนตัวเลือกต้องอยู่ระหว่าง ${LIMITS.choices.join('–')}`);
    if (!inRange(t.headerRows, LIMITS.headerRows)) errs.push(`แถวหัวตารางต้องอยู่ระหว่าง ${LIMITS.headerRows.join('–')}`);
    if (t.blocks * t.rowsPerBlock > LIMITS.questions) errs.push(`รวมแล้วต้องไม่เกิน ${LIMITS.questions} ข้อ`);
    const { cols, rows } = gridShape(t);
    if (cols > 80 || rows > 80) errs.push('ตารางมีช่องมากเกินไป');
    return errs;
  }

  /** ขนาดตารางบนกระดาษ A4 สำหรับพิมพ์ (มม.) เลือกแนวตั้ง/แนวนอนที่ได้ช่องใหญ่กว่า */
  function sheetLayout(t) {
    const { cols, rows } = gridShape(t);
    const header = 40; // พื้นที่หัวกระดาษ (ชื่อ เลขที่ วันที่) และหมายเหตุท้ายตาราง หน่วย มม.
    const options = [
      { orientation: 'landscape', w: 297 - 20, h: 210 - 20 - header },
      { orientation: 'portrait', w: 210 - 20, h: 297 - 20 - header },
    ].map((p) => {
      const cellW = Math.min(14, p.w / cols);
      const cellH = Math.min(cellW * 0.9, 10, p.h / rows);
      return Object.assign(p, { cellW, cellH, score: Math.min(cellW, cellH * 1.3) });
    });
    const best = options[0].score >= options[1].score ? options[0] : options[1];
    const tableW = best.cellW * cols, tableH = best.cellH * rows;
    return { orientation: best.orientation, cellW: best.cellW, cellH: best.cellH, tableW, tableH, aspect: tableW / tableH };
  }

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

  /** ข้อ q (เริ่มที่ 1) อยู่ชุดไหน แถวไหนของชุด */
  function blockRowOf(t, q) {
    if (t.order === 'across') return { b: (q - 1) % t.blocks, r: Math.floor((q - 1) / t.blocks) };
    return { b: Math.floor((q - 1) / t.rowsPerBlock), r: (q - 1) % t.rowsPerBlock };
  }

  /** คอลัมน์ของตัวเลือก c ในชุด b */
  function choiceCol(t, b, c) {
    return b * (t.choices + (t.numberColumn ? 1 : 0)) + (t.numberColumn ? 1 : 0) + c;
  }

  /** ตำแหน่งช่อง (แถว, คอลัมน์) ของข้อ q (เริ่มที่ 1) ตัวเลือก c (เริ่มที่ 0) */
  function cellOf(t, q, c) {
    const { b, r } = blockRowOf(t, q);
    return { row: t.headerRows + r, col: choiceCol(t, b, c) };
  }

  /** ช่องเลขข้อ (ใช้ไฮไลต์ทั้งแถว) */
  function numberCellOf(t, q) {
    const { b, r } = blockRowOf(t, q);
    return { row: t.headerRows + r, col: b * (t.choices + (t.numberColumn ? 1 : 0)) };
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

  /** ขนาดภาพหลังดัดตรง: ด้านยาวของตารางเท่ากับ warpWidth (ตารางแนวนอนกว้าง 2400 แนวตั้งสูง 2400) */
  function warpSize(w, h, o) {
    const ar = w / h;
    return ar >= 1
      ? { W: o.warpWidth, H: Math.round(o.warpWidth / ar) }
      : { W: Math.round(o.warpWidth * ar), H: o.warpWidth };
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
    const { W, H } = warpSize(w, h, o);
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
      if (!spacingOk(xs, 2.4) || !spacingOk(ys, 2.5)) return null;

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
          for (let b = 0; b < template.blocks; b++) choiceCols.push(choiceCol(template, b, c));
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

  // ---------------------------------------------------------------------------
  // ตรวจหาโครงตารางจากรูปกระดาษเปล่า (ไม่รู้จำนวนแถว/คอลัมน์ล่วงหน้า) ใช้ตอนเพิ่มแบบฟอร์มใหม่
  // ---------------------------------------------------------------------------
  function smooth5(profile) {
    const n = profile.length;
    const sm = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = -2; k <= 2; k++) { const j = i + k; if (j >= 0 && j < n) s += profile[j]; }
      sm[i] = s / 5;
    }
    return sm;
  }

  /** หาเส้นทั้งหมดที่เด่นพอ (ไม่ระบุจำนวน) */
  function peaksUnknown(profile, inner, minGap) {
    const n = profile.length;
    const sm = smooth5(profile);
    let max = 0;
    for (let i = inner; i < n - inner; i++) if (sm[i] > max) max = sm[i];
    if (max <= 0) return [];
    const thr = max * 0.35;
    const peaks = [];
    for (let i = inner; i < n - inner;) {
      if (sm[i] < thr) { i++; continue; }
      let j = i, best = i;
      while (j < n - inner && sm[j] >= thr) { if (sm[j] > sm[best]) best = j; j++; }
      peaks.push(best);
      i = j;
    }
    const merged = [];
    for (const p of peaks) {
      const last = merged.length ? merged[merged.length - 1] : null;
      if (last != null && p - last < minGap) { if (sm[p] > sm[last]) merged[merged.length - 1] = p; } else merged.push(p);
    }
    return merged;
  }

  /**
   * เติมเส้นที่หายไป: ช่องที่กว้างเกือบ 2 เท่า (หรือมากกว่า) ของช่องปกติ และมียอดจาง ๆ
   * อยู่ใกล้ตำแหน่งที่ควรเป็นเส้น (เช่น เส้นที่พิมพ์จาง) ให้เพิ่มเส้นนั้นกลับ
   */
  function recoverMissing(lines, profile) {
    const sm = smooth5(profile);
    let max = 0;
    for (let i = 0; i < sm.length; i++) if (sm[i] > max) max = sm[i];
    const diffs = lines.slice(1).map((v, i) => v - lines[i]);
    const med = diffs.slice().sort((a, b) => a - b)[Math.floor(diffs.length / 2)];
    const out = [lines[0]];
    for (let i = 1; i < lines.length; i++) {
      const a = lines[i - 1], b = lines[i], d = b - a;
      const k = Math.round(d / med);
      if (d >= med * 1.8 && k >= 2) {
        for (let j = 1; j < k; j++) {
          const expect = a + (d * j) / k;
          const lo = Math.round(expect - med * 0.25), hi = Math.round(expect + med * 0.25);
          let best = -1;
          for (let x = Math.max(lo, 0); x <= Math.min(hi, sm.length - 1); x++) if (best < 0 || sm[x] > sm[best]) best = x;
          if (best >= 0 && sm[best] >= max * 0.08) out.push(best);
        }
      }
      out.push(b);
    }
    return out;
  }

  /** ตัดเส้นที่ชิดกันผิดปกติ (เช่น เส้นคู่) ให้เหลือระยะห่างสม่ำเสมอ */
  function regularize(lines) {
    let out = lines.slice();
    for (let guard = 0; guard < 20; guard++) {
      const diffs = out.slice(1).map((v, i) => v - out[i]);
      const med = diffs.slice().sort((a, b) => a - b)[Math.floor(diffs.length / 2)];
      const k = diffs.findIndex((d) => d < med * 0.4);
      if (k < 0) break;
      // ลบเส้นด้านใน (ไม่ลบกรอบนอก)
      const remove = k + 1 === out.length - 1 ? k : k + 1;
      out.splice(remove, 1);
    }
    return out;
  }

  /** วิเคราะห์โครงตารางของกรอบหนึ่ง (หมุนตาม quad ที่ให้มา) */
  function analyzeUnknownGrid(cv, src, gray, quad, o) {
    const { w, h } = quadSize(quad);
    const { W, H } = warpSize(w, h, o);
    const P = o.pad;
    const mats = [];
    const keep = (m) => (mats.push(m), m);
    try {
      const srcPts = keep(cv.matFromArray(4, 1, cv.CV_32FC2, [].concat(...quad)));
      const dstPts = keep(cv.matFromArray(4, 1, cv.CV_32FC2, [P, P, W - 1 - P, P, W - 1 - P, H - 1 - P, P, H - 1 - P]));
      const M = keep(cv.getPerspectiveTransform(srcPts, dstPts));
      const wg = keep(new cv.Mat());
      cv.warpPerspective(gray, wg, M, new cv.Size(W, H), cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar());
      const small = keep(new cv.Mat());
      cv.resize(wg, small, new cv.Size(Math.round(W / 4), Math.round(H / 4)), 0, 0, cv.INTER_AREA);
      cv.medianBlur(small, small, 13);
      const bg = keep(new cv.Mat());
      cv.resize(small, bg, new cv.Size(W, H), 0, 0, cv.INTER_LINEAR);
      const norm = keep(new cv.Mat());
      cv.divide(wg, bg, norm, 255, -1);
      const bw = keep(new cv.Mat());
      cv.threshold(norm, bw, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);

      // เส้นตารางยาวต่อเนื่องตลอดตาราง ใช้ตัวกรองยาว 1/20 ของด้าน ตัวหนังสือและกากบาทจะไม่ผ่าน
      const kh = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(Math.round(W / 20), 1)));
      const kv = keep(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, Math.round(H / 20))));
      const horiz = keep(new cv.Mat());
      const vert = keep(new cv.Mat());
      cv.morphologyEx(bw, horiz, cv.MORPH_OPEN, kh);
      cv.morphologyEx(bw, vert, cv.MORPH_OPEN, kv);
      const inner = P + 14;
      const pxv = reduceProfile(cv, vert, 0), pyh = reduceProfile(cv, horiz, 1);
      for (let i = 0; i < inner; i++) { pxv[i] = 0; pxv[W - 1 - i] = 0; pyh[i] = 0; pyh[H - 1 - i] = 0; }
      const xs = recoverMissing(regularize([P].concat(peaksUnknown(pxv, inner, 18), [W - 1 - P])), pxv);
      const ys = recoverMissing(regularize([P].concat(peaksUnknown(pyh, inner, 18), [H - 1 - P])), pyh);
      const C = xs.length - 1, R = ys.length - 1;
      if (C < 3 || R < 3 || C > 80 || R > 80) return null;

      const grid = keep(new cv.Mat());
      cv.bitwise_or(horiz, vert, grid);
      const k7 = keep(cv.Mat.ones(7, 7, cv.CV_8U));
      cv.dilate(grid, grid, k7);
      cv.bitwise_not(grid, grid);
      const ink = keep(new cv.Mat());
      cv.bitwise_and(bw, grid, ink);
      const k3 = keep(cv.Mat.ones(3, 3, cv.CV_8U));
      cv.morphologyEx(ink, ink, cv.MORPH_OPEN, k3);
      const fill = [];
      for (let r = 0; r < R; r++) {
        const row = [];
        for (let c = 0; c < C; c++) {
          const x0 = xs[c], x1 = xs[c + 1], y0 = ys[r], y1 = ys[r + 1];
          const mx = Math.floor((x1 - x0) * 0.15), my = Math.floor((y1 - y0) * 0.15);
          const rw = Math.max(1, x1 - x0 - 2 * mx), rh = Math.max(1, y1 - y0 - 2 * my);
          const roi = ink.roi(new cv.Rect(x0 + mx, y0 + my, rw, rh));
          row.push(cv.countNonZero(roi) / (rw * rh));
          roi.delete();
        }
        fill.push(row);
      }

      // แถวหัวตาราง: แถวบนสุดที่มีตัวพิมพ์เกือบทุกช่อง
      const has = (v) => v > 0.012;
      const rowFill = fill.map((row) => row.filter(has).length / C);
      let headerRows = 0;
      while (headerRows < Math.min(4, R - 2) && rowFill[headerRows] >= 0.6) headerRows++;
      let bottomLike = 0;
      while (bottomLike < Math.min(4, R - 2) && rowFill[R - 1 - bottomLike] >= 0.6) bottomLike++;

      // คอลัมน์เลขข้อ: มีตัวเลขพิมพ์อยู่เกือบทุกแถวของส่วนคำตอบ
      const body = fill.slice(headerRows);
      const numberCols = [];
      for (let c = 0; c < C; c++) {
        if (body.filter((row) => has(row[c])).length / Math.max(1, body.length) >= 0.6) numberCols.push(c);
      }
      const warnings = [];
      let blocks = 1, choices = C, numberColumn = false;
      // คอลัมน์เลขข้อวางห่างเท่ากันทุกชุด อนุมานจากระยะห่าง (บางชุดอาจพิมพ์จางจนตรวจไม่ติด)
      let per = 0;
      if (numberCols.length >= 2) {
        const gcd = (a, b) => (b ? gcd(b, a % b) : a);
        per = numberCols.slice(1).map((c, i) => c - numberCols[i]).reduce(gcd);
      } else if (numberCols.length === 1) {
        per = numberCols[0] > 0 ? numberCols[0] : C;
      }
      if (per >= 3 && per <= 9 && C % per === 0 && numberCols.every((c) => c % per === 0)) {
        blocks = C / per; choices = per - 1; numberColumn = true;
      }
      if (!numberColumn) {
        warnings.push('หาคอลัมน์เลขข้อไม่พบ กรุณากำหนดจำนวนชุดและตัวเลือกเอง');
        choices = Math.min(8, Math.max(2, C));
      }
      if (!headerRows) warnings.push('ไม่พบแถวหัวตาราง แอปจะบอกทิศของกระดาษไม่ได้ ควรถ่ายให้หัวตารางอยู่ด้านบน');

      let score = 0;
      if (headerRows >= 1 && headerRows <= 3) score += 2;
      if (numberColumn) score += 3;
      if (R - headerRows >= 3) score += 1;
      if (bottomLike > headerRows) score -= 3;

      return {
        score,
        template: { blocks, rowsPerBlock: R - headerRows, choices, headerRows, numberColumn, order: 'down', aspect: w / h },
        grid: { cols: C, rows: R, xs, ys, W, H },
        fill,
        warnings,
      };
    } finally {
      mats.forEach((m) => m.delete());
    }
  }

  /** ภาพตารางสีที่ดัดตรงแล้ว ขนาดสำหรับแสดงผล */
  function warpDisplay(cv, src, quad, o) {
    const { w, h } = quadSize(quad);
    const { W, H } = warpSize(w, h, o);
    const P = o.pad;
    const mats = [];
    const keep = (m) => (mats.push(m), m);
    try {
      const srcPts = keep(cv.matFromArray(4, 1, cv.CV_32FC2, [].concat(...quad)));
      const dstPts = keep(cv.matFromArray(4, 1, cv.CV_32FC2, [P, P, W - 1 - P, P, W - 1 - P, H - 1 - P, P, H - 1 - P]));
      const M = keep(cv.getPerspectiveTransform(srcPts, dstPts));
      const scale = Math.min(1, o.displayWidth / W);
      const dw = Math.round(W * scale), dh = Math.round(H * scale);
      // ดัดภาพลงขนาดแสดงผลโดยตรง (คูณเมทริกซ์ด้วยสเกล)
      const S = keep(cv.matFromArray(3, 3, cv.CV_64F, [scale, 0, 0, 0, scale, 0, 0, 0, 1]));
      const MS = keep(new cv.Mat());
      cv.gemm(S, M, 1, new cv.Mat(), 0, MS, 0);
      const out = keep(new cv.Mat());
      cv.warpPerspective(src, out, MS, new cv.Size(dw, dh), cv.INTER_AREA, cv.BORDER_REPLICATE, new cv.Scalar());
      return { width: dw, height: dh, scale, data: new Uint8ClampedArray(out.data) };
    } finally {
      mats.forEach((m) => m.delete());
    }
  }

  /**
   * ตรวจหาโครงตารางของแบบฟอร์มใหม่จากรูปกระดาษเปล่า
   * คืนค่า { ok, template (ค่าที่แนะนำ), grid, warnings, display, quad, rotation }
   */
  function inferTemplate(cv, rgba, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const mats = [];
    const keep = (m) => (mats.push(m), m);
    try {
      let src = rgba;
      const s = o.workLongSide / Math.max(rgba.cols, rgba.rows);
      if (Math.abs(s - 1) > 0.01) {
        src = keep(new cv.Mat());
        cv.resize(rgba, src, new cv.Size(Math.round(rgba.cols * s), Math.round(rgba.rows * s)), 0, 0,
          s < 0.5 ? cv.INTER_AREA : cv.INTER_LINEAR);
      }
      const gray = keep(new cv.Mat());
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      const candidates = findQuadCandidates(cv, gray, 0.15, 3);
      if (!candidates.length) return { ok: false, error: 'not_found' };
      let best = null;
      for (const cand of candidates.slice().reverse()) {
        for (const r of [0, 2, 1, 3]) {
          const quad = rotateQuad(cand.quad, r);
          const res = analyzeUnknownGrid(cv, src, gray, quad, o);
          if (!res) continue;
          if (!best || res.score > best.res.score) best = { res, quad, r };
          if (res.score >= 6) break;
        }
        if (best && best.res.score >= 6) break;
      }
      if (!best) return { ok: false, error: 'grid' };
      const inv = 1 / s;
      return Object.assign({
        ok: true,
        quad: best.quad.map((p) => [p[0] * inv, p[1] * inv]),
        rotation: best.r,
        display: warpDisplay(cv, src, best.quad, o),
      }, best.res);
    } finally {
      mats.forEach((m) => m.delete());
    }
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
      // ลองกรอบเล็กก่อน: ถ้าเห็นทั้งขอบกระดาษและตาราง ตารางจะอยู่ด้านในและเล็กกว่า
      for (const cand of candidates.slice().reverse()) {
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
      for (const c of cands.slice().reverse()) {
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
    LATIN,
    THAI,
    LIMITS,
    normalizeTemplate,
    validateTemplate,
    defaultName,
    sheetLayout,
    gridShape,
    questionCount,
    blockRowOf,
    choiceCol,
    cellOf,
    numberCellOf,
    inferTemplate,
    _internal: { findQuadCandidates, analyzeUnknownGrid, rotateQuad, quadSize },
    decide,
    decideAll,
    lastMarkedQuestion,
    grade,
    linePositions,
    readSheet,
    detectTable,
  };
});
