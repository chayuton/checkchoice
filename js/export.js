// ส่งออกผลคะแนนเป็น Excel และสำรอง/กู้คืนข้อมูลทั้งหมด
import { db } from './db.js';
import { scoreOf, letterOf, examTitle, multiRuleOf, MULTI_TEXT } from './store.js';

const OMR = self.OMRCore;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.dataset.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`โหลด ${src} ไม่สำเร็จ`));
    document.head.appendChild(s);
  });
}

export function safeFileName(s) {
  return String(s || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'checkchoice';
}

function todayText() {
  const d = new Date();
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' }) + ' ' +
    d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

/** ตารางผลคะแนนที่ใช้ร่วมกันทั้ง Excel และหน้าพิมพ์ */
export function scoreRows(exam, results) {
  return results.map((r) => {
    const g = scoreOf(exam, r);
    const edited = r.items.slice(0, exam.questionCount).filter((it) => it.edited).length;
    const notes = [];
    if (g.pending) notes.push(`รอยืนยัน ${g.pending} ข้อ`);
    if (edited) notes.push(`แก้ด้วยมือ ${edited} ข้อ`);
    return { no: r.studentNo, correct: g.correct, total: g.total, pending: g.pending, note: notes.join(', ') };
  });
}

export async function exportExcel(exam, results) {
  await loadScript('vendor/xlsx.mini.min.js');
  const XLSX = window.XLSX;
  const t = examTitle(exam);
  const N = exam.questionCount;
  const rows = scoreRows(exam, results);

  const sheet1 = [
    ['รายวิชา', t.course],
    ['การสอบ', t.exam],
    ['จำนวนข้อ', N],
    ...(multiRuleOf(exam) ? [['เฉลยหลายคำตอบ', MULTI_TEXT[multiRuleOf(exam)]]] : []),
    ['ส่งออกเมื่อ', todayText()],
    [],
    ['เลขที่', 'จำนวนข้อที่ถูก', 'จำนวนข้อทั้งหมด', 'หมายเหตุ'],
    ...rows.map((r) => [r.no, r.correct, r.total, r.note]),
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(sheet1);
  ws1['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 28 }];

  const head = ['เลขที่'];
  const keyRow = ['เฉลย'];
  for (let i = 0; i < N; i++) { head.push(i + 1); keyRow.push(letterOf(exam.key[i], exam.template)); }
  const rightCount = new Array(N).fill(0);
  const answerRows = results.map((r) => {
    const row = [r.studentNo];
    for (let i = 0; i < N; i++) {
      const it = r.items[i] || {};
      const pending = it.flag && !it.resolved;
      row.push(pending ? '?' : letterOf(it.choice, exam.template));
      if (!pending && OMR.isCorrect(exam.key[i], it.choice, exam.multiAnswer)) rightCount[i]++;
    }
    return row;
  });
  const sheet2 = [head, keyRow, ...answerRows, [], ['จำนวนคนที่ตอบถูก', ...rightCount]];
  const ws2 = XLSX.utils.aoa_to_sheet(sheet2);
  ws2['!cols'] = [{ wch: 16 }, ...new Array(N).fill({ wch: 4 })];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, 'คะแนน');
  XLSX.utils.book_append_sheet(wb, ws2, 'คำตอบรายข้อ');
  const name = safeFileName(`คะแนน ${exam.courseCode || exam.courseName} ${exam.examName}`);
  const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
  download(new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${name}.xlsx`);
}

// ---------------------------------------------------------------------------
// สำรอง/กู้คืน
// ---------------------------------------------------------------------------
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function dataURLToBlob(url) {
  const res = await fetch(url);
  return res.blob();
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function backupAll() {
  const { exams, results, blobs, templates } = await db.dumpAll();
  const files = [];
  for (const b of blobs) files.push({ id: b.id, type: b.type || (b.blob && b.blob.type), data: await blobToDataURL(b.blob) });
  const payload = { app: 'checkchoice', format: 1, exportedAt: new Date().toISOString(), exams, results, templates, files };
  const stamp = new Date().toISOString().slice(0, 10);
  download(new Blob([JSON.stringify(payload)], { type: 'application/json' }), `checkchoice-backup-${stamp}.json`);
  return { exams: exams.length, results: results.length };
}

export async function readBackup(file) {
  const text = await file.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('ไฟล์นี้ไม่ใช่ไฟล์สำรองของ CheckChoice'); }
  if (!data || data.app !== 'checkchoice' || !Array.isArray(data.exams)) throw new Error('ไฟล์นี้ไม่ใช่ไฟล์สำรองของ CheckChoice');
  return data;
}

export async function restoreBackup(data) {
  const blobs = [];
  for (const f of data.files || []) blobs.push({ id: f.id, type: f.type, blob: await dataURLToBlob(f.data) });
  await db.putMany('templates', Array.isArray(data.templates) ? data.templates.filter((t) => t && typeof t.id === 'string') : []);
  await db.putMany('exams', data.exams);
  await db.putMany('results', data.results || []);
  await db.putMany('blobs', blobs);
  return { exams: data.exams.length, results: (data.results || []).length };
}
