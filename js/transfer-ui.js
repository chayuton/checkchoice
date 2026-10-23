// กล่องส่งชุดข้อสอบไปอีกเครื่อง: QR code สำหรับสแกนด้วยแอปบนมือถือ (หน้า "รับจากเครื่องอื่น")
// หรือแอปกล้อง + ลิงก์สำหรับคัดลอก/แชร์
import { h, icon, toast } from './ui.js';
import { encodeExam, isQRAlphanumeric } from './transfer.js';
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

export async function copyText(text, input) {
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
  const prefix = `${location.origin}${location.pathname}#/import/`;
  const payload = encodeExam(exam);
  const link = prefix + payload;
  // ระดับแก้ข้อผิดพลาด L: QR โปร่งกว่า สแกนจากหน้าจอได้ง่าย (หน้าจอไม่มีรอยเปื้อนเหมือนกระดาษ)
  // ส่วนข้อมูลเป็นตัวพิมพ์ใหญ่และตัวเลขล้วน ใส่เป็นโหมด Alphanumeric ซึ่งใช้พื้นที่น้อยกว่าโหมด Byte
  const qr = qrcode(0, 'L');
  qr.addData(prefix, 'Byte');
  qr.addData(payload, isQRAlphanumeric(payload) ? 'Alphanumeric' : 'Byte');
  qr.make();
  const t = examTitle(exam);

  // QR ของลิงก์ชุดข้อสอบค่อนข้างหนาแน่น ยิ่งใหญ่ยิ่งสแกนง่าย: ใหญ่เท่าที่กล่องรับได้ และแตะเพื่อขยายเต็มจอ
  const canvas = h('canvas', { class: 'qr-canvas', role: 'img', 'aria-label': 'QR code ของลิงก์ชุดข้อสอบ' });
  drawQR(qr, canvas, Math.max(220, Math.min(340, (window.innerWidth || 360) - 88)));
  const zoomBtn = h('button', { type: 'button', class: 'qr-zoom-btn', id: 'btn-qr-zoom', 'aria-label': 'ขยาย QR code เต็มจอ',
    onclick: () => openFullQR(qr) }, canvas);
  const linkInput = h('input', { class: 'input link-input', id: 'transfer-link', readonly: true, value: link, 'aria-label': 'ลิงก์ชุดข้อสอบ' });

  const dlg = h('dialog', { class: 'dialog dialog-wide', id: 'transfer-dialog' });
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.append(
    h('h2', { class: 'dialog-title' }, 'ส่งชุดข้อสอบไปเครื่องอื่น'),
    h('p', { class: 'dialog-text' }, `${t.course} ${t.exam}`),
    h('div', { class: 'qr-box' }, zoomBtn, h('span', { class: 'qr-zoom-hint' }, 'แตะที่ QR code เพื่อขยายเต็มจอ')),
    h('ol', { class: 'help-steps' },
      h('li', null, 'บนมือถือ เปิดแอป CheckChoice แล้วแตะ ', h('strong', null, 'รับจากเครื่องอื่น'), ' ที่หน้าแรก'),
      h('li', null, 'เล็งกล้องที่ QR code นี้ แล้วกด ', h('strong', null, 'นำเข้าชุดข้อสอบ'))),
    h('p', { class: 'section-help' }, 'ยังไม่มีแอปบนมือถือ: สแกนด้วยแอปกล้องแล้วแตะลิงก์ที่ขึ้นมาก็ได้ (ถ้าเพิ่มแอปไว้บนหน้าจอโฮมของ iPhone แล้ว ให้สแกนจากในแอป ชุดข้อสอบจะได้เข้าแอป ไม่ใช่เข้า Safari)'),
    h('p', { class: 'section-help' }, 'หรือคัดลอกลิงก์ส่งทาง LINE หรืออีเมล แล้ววางในหน้า "รับจากเครื่องอื่น" ลิงก์มีเฉพาะรายวิชาและเฉลย ไม่มีรูปหรือคะแนนของนักศึกษา'),
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

/** QR code เต็มจอ (กล่องที่สองซ้อนบนกล่องส่ง) แตะที่ไหนก็ได้หรือกด Esc เพื่อปิด */
function openFullQR(qr) {
  const size = Math.max(240, Math.min(window.innerWidth || 0, window.innerHeight || 0) - 40);
  const canvas = h('canvas', { class: 'qr-canvas qr-canvas-full', role: 'img', 'aria-label': 'QR code ของลิงก์ชุดข้อสอบ (ขยาย)' });
  drawQR(qr, canvas, size);
  const dlg = h('dialog', { class: 'qr-full', id: 'qr-full', 'aria-label': 'QR code ขยายเต็มจอ' },
    canvas, h('p', { class: 'qr-full-hint' }, 'แตะที่ใดก็ได้เพื่อปิด'));
  const close = () => { if (dlg.open) dlg.close(); dlg.remove(); };
  dlg.addEventListener('click', close);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  document.body.appendChild(dlg);
  if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
}

/** ปุ่มเปิดกล่องส่งชุดข้อสอบ */
export function transferButton(exam, cls = 'btn btn-quiet') {
  return h('button', { type: 'button', class: cls, onclick: () => openTransferDialog(exam).catch((err) => toast(err.message || String(err), 'error')) },
    icon('send'), 'ส่งไปมือถือ / เครื่องอื่น');
}
