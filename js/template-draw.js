// วาดผังแบบฟอร์ม: แถวหัวตาราง คอลัมน์เลขข้อ และเลขข้อในแต่ละแถว
// ใช้ทั้งวาดทับรูปกระดาษเปล่า (ให้อาจารย์เทียบกับเลขที่พิมพ์อยู่จริง) และวาดเป็นผังตัวอย่างเมื่อไม่มีรูป
const OMR = self.OMRCore;

/** เส้นตารางแบบช่องเท่ากัน (ใช้เมื่อไม่มีรูป) */
export function uniformGrid(template, width, height, pad = 6) {
  const { cols, rows } = OMR.gridShape(template);
  const xs = [], ys = [];
  for (let c = 0; c <= cols; c++) xs.push(pad + ((width - 2 * pad) * c) / cols);
  for (let r = 0; r <= rows; r++) ys.push(pad + ((height - 2 * pad) * r) / rows);
  return { xs, ys };
}

/**
 * วาดผังลงบน canvas
 * image: รูปตารางที่ดัดตรงแล้ว (หรือ null = ผังเปล่า)
 * xs, ys: ตำแหน่งเส้นในพิกัดของ canvas
 */
export function drawTemplateMap(canvas, template, { image = null, xs, ys, width, height, showNumbers = true } = {}) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  if (image) ctx.drawImage(image, 0, 0, width, height);
  const { cols, rows } = OMR.gridShape(template);
  const okShape = xs.length === cols + 1 && ys.length === rows + 1;
  if (!okShape) return false;
  const per = template.choices + (template.numberColumn ? 1 : 0);
  const cell = (r, c) => [xs[c], ys[r], xs[c + 1] - xs[c], ys[r + 1] - ys[r]];

  // แถวหัวตาราง
  ctx.fillStyle = image ? 'rgba(125, 134, 140, 0.28)' : '#E8ECE9';
  for (let r = 0; r < template.headerRows; r++) for (let c = 0; c < cols; c++) ctx.fillRect(...cell(r, c));
  // คอลัมน์เลขข้อ
  if (template.numberColumn) {
    ctx.fillStyle = image ? 'rgba(36, 64, 179, 0.16)' : '#E4E9FA';
    for (let b = 0; b < template.blocks; b++) for (let r = template.headerRows; r < rows; r++) ctx.fillRect(...cell(r, b * per));
  }
  // เส้นตาราง (เฉพาะผังเปล่า)
  if (!image) {
    ctx.strokeStyle = '#7D868C';
    ctx.lineWidth = 1;
    xs.forEach((x) => { ctx.beginPath(); ctx.moveTo(x, ys[0]); ctx.lineTo(x, ys[ys.length - 1]); ctx.stroke(); });
    ys.forEach((y) => { ctx.beginPath(); ctx.moveTo(xs[0], y); ctx.lineTo(xs[xs.length - 1], y); ctx.stroke(); });
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#23282C';
    ctx.strokeRect(xs[0], ys[0], xs[xs.length - 1] - xs[0], ys[ys.length - 1] - ys[0]);
  }
  // ตัวอักษรหัวตาราง
  const ch = (ys[ys.length - 1] - ys[0]) / rows;
  const cw = (xs[xs.length - 1] - xs[0]) / cols;
  const fontPx = Math.max(7, Math.min(ch, cw) * 0.42);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (!image && template.headerRows > 0) {
    ctx.fillStyle = '#23282C';
    ctx.font = `600 ${fontPx}px "Plex Thai Looped", system-ui, sans-serif`;
    for (let b = 0; b < template.blocks; b++) {
      for (let c = 0; c < template.choices; c++) {
        const [x, y, w, hh] = cell(0, OMR.choiceCol(template, b, c));
        ctx.fillText(template.choiceLabels[c], x + w / 2, y + hh / 2);
      }
    }
  }
  // เลขข้อ: วางในคอลัมน์เลขข้อ (หรือช่องตัวเลือกแรกถ้าไม่มีคอลัมน์เลขข้อ)
  if (showNumbers) {
    ctx.font = `600 ${fontPx}px "Plex Thai Looped", system-ui, sans-serif`;
    const total = OMR.questionCount(template);
    for (let q = 1; q <= total; q++) {
      const pos = template.numberColumn ? OMR.numberCellOf(template, q) : OMR.cellOf(template, q, 0);
      const [x, y, w, hh] = cell(pos.row, pos.col);
      if (image) {
        const tw = Math.max(ctx.measureText(String(q)).width + 6, hh * 0.9);
        ctx.fillStyle = 'rgba(36, 64, 179, 0.92)';
        ctx.fillRect(x + w / 2 - tw / 2, y + hh * 0.12, tw, hh * 0.76);
        ctx.fillStyle = '#FFFFFF';
      } else {
        ctx.fillStyle = '#4A535A';
      }
      ctx.fillText(String(q), x + w / 2, y + hh / 2);
    }
  }
  return true;
}

/** ผังตัวอย่างขนาดเล็ก (ใช้ในรายการแบบฟอร์ม) */
export function templateThumb(template, maxW = 220, maxH = 150) {
  const canvas = document.createElement('canvas');
  const a = template.aspect || OMR.sheetLayout(template).aspect;
  let w = maxW, hgt = Math.round(maxW / a);
  if (hgt > maxH) { hgt = maxH; w = Math.round(maxH * a); }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const g = uniformGrid(template, w * dpr, hgt * dpr, 2 * dpr);
  drawTemplateMap(canvas, template, { xs: g.xs, ys: g.ys, width: w * dpr, height: hgt * dpr, showNumbers: false });
  canvas.style.width = `${w}px`;
  canvas.style.height = `${hgt}px`;
  canvas.className = 'tpl-thumb';
  canvas.setAttribute('aria-hidden', 'true');
  return canvas;
}
