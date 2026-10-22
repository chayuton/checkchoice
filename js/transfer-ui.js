// กล่องส่งชุดข้อสอบไปอีกเครื่อง: QR code สำหรับสแกนด้วยกล้องมือถือ + ลิงก์สำหรับคัดลอก/แชร์
import { h, icon, toast } from './ui.js';
import { importLink } from './transfer.js';
import { examTitle } from './store.js';

function drawQR(qr, canvas, cssSize) {
  const n = qr.getModuleCount();
  const margin = 4;
  const cells = n + margin * 2;
  const dpr = Math.max(2, window.devicePixelRatio || 1);
  const px = Math.max(1, Math.floor((cssSize * dpr) / cells));
  canvas.width = canvas.height = cells * px;
  canvas.style.width = canvas.style.height = `${(cells * px) / dpr}px`;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + margin) * px, (r + margin) * px, px, px);
    }
  }
}

async function copyText(text, input) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    input.select();
    try { return document.execCommand('copy'); } catch (e2) { return false; }
  }
}

export async function openTransferDialog(exam) {
  const { default: qrcode } = await import('../vendor/qrcode.mjs');
  const link = importLink(exam, location.origin + location.pathname);
  // ระดับแก้ข้อผิดพลาด L: QR โปร่งกว่า สแกนจากหน้าจอได้ง่าย (หน้าจอไม่มีรอยเปื้อนเหมือนกระดาษ)
  const qr = qrcode(0, 'L');
  qr.addData(link);
  qr.make();
  const t = examTitle(exam);

  const canvas = h('canvas', { class: 'qr-canvas', role: 'img', 'aria-label': 'QR code ของลิงก์ชุดข้อสอบ' });
  drawQR(qr, canvas, 260);
  const linkInput = h('input', { class: 'input link-input', id: 'transfer-link', readonly: true, value: link, 'aria-label': 'ลิงก์ชุดข้อสอบ' });

  const dlg = h('dialog', { class: 'dialog dialog-wide', id: 'transfer-dialog' });
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.append(
    h('h2', { class: 'dialog-title' }, 'ส่งชุดข้อสอบไปเครื่องอื่น'),
    h('p', { class: 'dialog-text' }, `${t.course} ${t.exam}`),
    h('div', { class: 'qr-box' }, canvas),
    h('ol', { class: 'help-steps' },
      h('li', null, 'เปิดแอปกล้องบน iPhone หรือ Android แล้วเล็งที่ QR code นี้'),
      h('li', null, 'แตะลิงก์ที่ขึ้นมา แล้วกด "นำเข้าชุดข้อสอบ" บนมือถือ')),
    h('p', { class: 'section-help' }, 'หรือคัดลอกลิงก์ส่งทาง LINE หรืออีเมล ลิงก์มีเฉพาะรายวิชาและเฉลย ไม่มีรูปหรือคะแนนของนักศึกษา'),
    linkInput,
    h('div', { class: 'dialog-actions' },
      navigator.share ? h('button', { type: 'button', class: 'btn btn-quiet', onclick: async () => {
        try { await navigator.share({ title: `เฉลย ${t.course} ${t.exam}`, url: link }); } catch (e) { /* ผู้ใช้ยกเลิก */ }
      } }, 'แชร์') : null,
      h('button', { type: 'button', class: 'btn btn-quiet', id: 'btn-copy-link', onclick: async () => {
        toast(await copyText(link, linkInput) ? 'คัดลอกลิงก์แล้ว' : 'คัดลอกไม่ได้ กดค้างที่ลิงก์เพื่อคัดลอกเอง', 'ok');
      } }, 'คัดลอกลิงก์'),
      h('button', { type: 'button', class: 'btn btn-primary', autofocus: true, onclick: close }, 'เสร็จแล้ว')));
  document.body.appendChild(dlg);
  if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  return { link, close };
}

/** ปุ่มเปิดกล่องส่งชุดข้อสอบ */
export function transferButton(exam, cls = 'btn btn-quiet') {
  return h('button', { type: 'button', class: cls, onclick: () => openTransferDialog(exam).catch((err) => toast(err.message || String(err), 'error')) },
    icon('send'), 'ส่งไปมือถือ / เครื่องอื่น');
}
