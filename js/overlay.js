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
export function drawSheet(canvas, image, geom, template, { count, key, items, mode, multi }) {
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
      for (const c of OMR.choiceSet(key[i])) {
        const cell = OMR.cellOf(template, q, c);
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
    const keySet = OMR.choiceSet(key[i]);
    const chosen = OMR.choiceSet(it.choice);
    const ok = !pending && OMR.isCorrect(key[i], it.choice, multi);
    for (const c of chosen) {
      const cell = OMR.cellOf(template, q, c);
      // ข้อที่ผิด: ช่องที่ตรงกับเฉลยยังเป็นสีเขียว ช่องที่ไม่ใช่เฉลยเป็นสีแดง
      const good = ok || keySet.includes(c);
      ctx.strokeStyle = pending ? cssVar('--hl-edge', '#D9A600') : (good ? green : red);
      ctx.lineWidth = lw;
      ctx.strokeRect(...rect(cell.row, cell.col));
    }
    if (!pending && !ok) {
      // เส้นประสีเขียว = ช่องเฉลยที่นักศึกษาไม่ได้กากบาท
      for (const c of keySet) {
        if (chosen.includes(c)) continue;
        const cell = OMR.cellOf(template, q, c);
        ctx.save();
        ctx.setLineDash([lw * 2, lw * 2]);
        ctx.strokeStyle = green;
        ctx.lineWidth = lw;
        ctx.strokeRect(...rect(cell.row, cell.col, lw + 2));
        ctx.restore();
      }
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
