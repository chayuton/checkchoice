// วาดภาพตารางที่ดัดตรงแล้ว พร้อมกรอบแสดงผลการอ่านแต่ละข้อ
const OMR = self.OMRCore;

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/**
 * image: ImageBitmap | HTMLImageElement | HTMLCanvasElement
 * geom: { xs, ys, scale } (พิกัดในภาพดัดตรงขนาดเต็ม)
 * mode: 'key' | 'review'
 */
export function drawSheet(canvas, image, geom, template, { count, key, items, mode }) {
  const w = image.width || image.naturalWidth;
  const hgt = image.height || image.naturalHeight;
  canvas.width = w;
  canvas.height = hgt;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, w, hgt);
  const s = geom.scale;
  const X = (i) => geom.xs[i] * s, Y = (i) => geom.ys[i] * s;
  const rect = (r, c, pad = 2) => [X(c) + pad, Y(r) + pad, X(c + 1) - X(c) - 2 * pad, Y(r + 1) - Y(r) - 2 * pad];
  const green = '#1F9D5A', red = '#D63445', ink = '#2E54E6';
  const hl = 'rgba(255, 214, 51, 0.38)';
  const lw = Math.max(2, Math.round(w / 400));
  const total = OMR.questionCount(template);

  for (let q = 1; q <= total; q++) {
    const i = q - 1;
    const first = OMR.cellOf(template, q, 0);
    const last = OMR.cellOf(template, q, template.choices - 1);
    if (q > count) {
      // ข้อที่เกินจำนวนข้อสอบ: แรเงาไว้ ไม่นำมาคิดคะแนน
      ctx.fillStyle = 'rgba(120, 128, 134, 0.35)';
      const a = rect(first.row, first.col, 0), b = rect(last.row, last.col, 0);
      ctx.fillRect(a[0], a[1], b[0] + b[2] - a[0], a[3]);
      continue;
    }
    if (mode === 'key') {
      if (key[i] != null) {
        const cell = OMR.cellOf(template, q, key[i]);
        ctx.strokeStyle = ink;
        ctx.lineWidth = lw;
        ctx.strokeRect(...rect(cell.row, cell.col));
      }
      continue;
    }
    const it = items[i];
    if (!it) continue;
    const pending = it.flag && !it.resolved;
    if (pending) {
      ctx.fillStyle = hl;
      const a = rect(first.row, first.col, 0), b = rect(last.row, last.col, 0);
      ctx.fillRect(a[0], a[1], b[0] + b[2] - a[0], a[3]);
    }
    const k = key[i];
    if (it.choice != null) {
      const cell = OMR.cellOf(template, q, it.choice);
      const ok = !pending && k != null && k === it.choice;
      ctx.strokeStyle = pending ? cssVar('--hl-edge', '#D9A600') : (ok ? green : red);
      ctx.lineWidth = lw;
      ctx.strokeRect(...rect(cell.row, cell.col));
    }
    if (!pending && k != null && it.choice !== k) {
      const cell = OMR.cellOf(template, q, k);
      ctx.save();
      ctx.setLineDash([lw * 2, lw * 2]);
      ctx.strokeStyle = green;
      ctx.lineWidth = lw;
      ctx.strokeRect(...rect(cell.row, cell.col, lw + 2));
      ctx.restore();
    }
  }
}

/** แปลงผลจาก worker (ข้อมูลพิกเซล) เป็น canvas */
export function displayToCanvas(display) {
  const c = document.createElement('canvas');
  c.width = display.width;
  c.height = display.height;
  c.getContext('2d').putImageData(new ImageData(display.data, display.width, display.height), 0, 0);
  return c;
}

export async function blobToImage(blob) {
  if (self.createImageBitmap) {
    try { return await createImageBitmap(blob); } catch (e) { /* fallback below */ }
  }
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  await img.decode();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return img;
}
