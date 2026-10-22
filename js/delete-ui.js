// ลบชุดข้อสอบที่ไม่ใช้แล้ว (ทีละชุดหรือทั้งรายวิชา) เพื่อคืนพื้นที่ในเครื่อง พร้อมบอกว่าจะได้พื้นที่คืนเท่าไร
import { h, icon, toast, confirmDialog, plural, formatBytes } from './ui.js';
import { deleteExam, storageByExam, examTitle } from './store.js';

/** ถามยืนยันแล้วลบชุดข้อสอบ (พร้อมผลตรวจและรูปทั้งหมด) คืน true ถ้าลบแล้ว */
export async function deleteExamsWithConfirm(exams) {
  if (!exams || !exams.length) return false;
  let usage = new Map();
  try { usage = await storageByExam(); } catch (e) { /* ไม่รู้ขนาดก็ยังลบได้ */ }
  let bytes = 0, results = 0, sheets = 0;
  for (const e of exams) {
    const u = usage.get(e.id);
    if (!u) continue;
    bytes += u.bytes; results += u.results; sheets += u.sheetImages;
  }
  const first = examTitle(exams[0]);
  const single = exams.length === 1;
  const details = [];
  if (!single) {
    const names = exams.map((e) => `"${examTitle(e).exam}"`);
    details.push(names.length > 4 ? `${names.slice(0, 4).join(', ')} และอีก ${names.length - 4} ชุด` : names.join(', '));
  }
  details.push(single ? 'เฉลยและรูปใบเฉลย' : 'เฉลยและรูปใบเฉลยของทุกชุด');
  details.push(results ? `ผลตรวจ ${plural(results, 'คน')} และรูปกระดาษที่ตรวจแล้ว ${plural(sheets, 'รูป')}` : 'ยังไม่มีผลตรวจ');
  const message = single
    ? `"${first.exam}"${first.course ? ` ของวิชา ${first.course}` : ''} จะถูกลบออกจากเครื่องนี้ พร้อมกับ`
    : `${plural(exams.length, 'ชุดข้อสอบ')}ของวิชา ${first.course || 'ที่ไม่ระบุรายวิชา'} จะถูกลบออกจากเครื่องนี้ พร้อมกับ`;
  const ok = await confirmDialog(message, {
    title: single ? 'ลบชุดข้อสอบนี้' : 'ลบทุกชุดข้อสอบของวิชานี้',
    details,
    note: `ได้พื้นที่คืนประมาณ ${formatBytes(bytes)} ลบแล้วกู้คืนไม่ได้ ถ้าอาจต้องใช้อีก ให้ดาวน์โหลดไฟล์สำรองในหน้าตั้งค่าก่อน`,
    okText: single ? 'ลบชุดข้อสอบ' : `ลบทั้ง ${exams.length} ชุด`,
    danger: true,
  });
  if (!ok) return false;
  try {
    for (const e of exams) await deleteExam(e.id);
  } catch (err) {
    toast(`ลบไม่สำเร็จ: ${err.message || err}`, 'error');
    return false;
  }
  toast(single
    ? `ลบ "${first.exam}" แล้ว ได้พื้นที่คืนประมาณ ${formatBytes(bytes)}`
    : `ลบ ${plural(exams.length, 'ชุดข้อสอบ')}แล้ว ได้พื้นที่คืนประมาณ ${formatBytes(bytes)}`, 'ok');
  return true;
}

/** ปุ่มถังขยะในแถวของชุดข้อสอบ/รายวิชา */
export function trashButton(label, onclick, extraClass = '') {
  return h('button', {
    type: 'button', class: `btn btn-quiet btn-small btn-trash ${extraClass}`.trim(), 'aria-label': label, title: label, onclick,
  }, icon('trash'));
}
