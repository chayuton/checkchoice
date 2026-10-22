// หน้ารายงานผลคะแนนสำหรับพิมพ์หรือบันทึกเป็น PDF (ใช้ตัวพิมพ์ของเบราว์เซอร์ ภาษาไทยจึงแสดงถูกต้อง)
import { h, icon } from '../ui.js';
import { getExam, listResults, examTitle } from '../store.js';
import { scoreRows } from '../export.js';

export async function printView(root, id) {
  const exam = await getExam(id);
  if (!exam) { location.replace('#/'); return; }
  const results = await listResults(id);
  const t = examTitle(exam);
  const rows = scoreRows(exam, results);
  const now = new Date();
  const dateText = now.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
  const xs = rows.map((r) => r.correct);
  const mean = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

  document.body.classList.add('printing');
  root.append(
    h('div', { class: 'print-tools no-print' },
      h('a', { class: 'btn btn-quiet', href: `#/exam/${id}/results` }, icon('back'), 'กลับ'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => window.print() }, icon('printer'), 'พิมพ์ / บันทึกเป็น PDF'),
      h('p', { class: 'hint' }, 'ในหน้าต่างพิมพ์ เลือกเครื่องพิมพ์ "บันทึกเป็น PDF" เพื่อได้ไฟล์ PDF')),
    h('article', { class: 'report' },
      h('h1', null, 'รายงานผลคะแนนสอบ'),
      h('table', { class: 'report-meta' }, h('tbody', null,
        h('tr', null, h('th', null, 'รายวิชา'), h('td', null, t.course)),
        h('tr', null, h('th', null, 'การสอบ'), h('td', null, t.exam)),
        h('tr', null, h('th', null, 'จำนวนข้อ'), h('td', null, `${exam.questionCount} ข้อ`)),
        h('tr', null, h('th', null, 'จำนวนผู้สอบ'), h('td', null, `${rows.length} คน`)),
        rows.length ? h('tr', null, h('th', null, 'คะแนนเฉลี่ย'),
          h('td', null, `${mean.toLocaleString('th-TH', { maximumFractionDigits: 2 })} สูงสุด ${Math.max(...xs)} ต่ำสุด ${Math.min(...xs)}`)) : null)),
      h('table', { class: 'report-table' },
        h('thead', null, h('tr', null,
          h('th', null, 'เลขที่'), h('th', null, 'จำนวนข้อที่ถูก'), h('th', null, 'จำนวนข้อทั้งหมด'), h('th', null, 'หมายเหตุ'))),
        h('tbody', null, rows.map((r) => h('tr', null,
          h('td', null, String(r.no)), h('td', null, String(r.correct)), h('td', null, String(r.total)), h('td', null, r.note))))),
      h('p', { class: 'report-foot' }, `พิมพ์เมื่อ ${dateText} จาก CheckChoice`)));

  return () => document.body.classList.remove('printing');
}
