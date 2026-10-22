// ผลคะแนนทั้งห้อง ส่งออก Excel และพิมพ์/บันทึก PDF
import { h, icon, toast } from '../ui.js';
import { appBar } from '../nav.js';
import { getExam, listResults, examTitle } from '../store.js';
import { exportExcel, scoreRows } from '../export.js';

function stats(rows) {
  if (!rows.length) return null;
  const xs = rows.map((r) => r.correct);
  const sum = xs.reduce((a, b) => a + b, 0);
  return { n: xs.length, mean: sum / xs.length, max: Math.max(...xs), min: Math.min(...xs) };
}

export async function resultsView(root, id) {
  const exam = await getExam(id);
  if (!exam) { root.append(appBar({ title: 'ไม่พบชุดข้อสอบ', back: '#/' })); return; }
  const results = await listResults(id);
  const t = examTitle(exam);
  const rows = scoreRows(exam, results);
  const st = stats(rows);

  root.append(appBar({ title: `ผลคะแนน ${t.exam}`, subtitle: t.course, back: '#/' }));
  const main = h('main', { class: 'page' });
  root.append(main);

  if (!rows.length) {
    main.append(h('section', { class: 'empty' },
      h('h2', null, 'ยังไม่มีผลตรวจ'),
      h('p', null, 'ถ่ายกระดาษคำตอบของนักศึกษาทีละแผ่น ผลคะแนนจะแสดงที่นี่'),
      h('a', { class: 'btn btn-primary btn-large', href: `#/exam/${id}/scan` }, icon('camera'), 'เริ่มตรวจกระดาษ')));
    return;
  }

  const fmt = (n) => n.toLocaleString('th-TH', { maximumFractionDigits: 2 });
  main.append(h('dl', { class: 'stats' },
    h('div', null, h('dt', null, 'ตรวจแล้ว'), h('dd', null, `${st.n} คน`)),
    h('div', null, h('dt', null, 'เฉลี่ย'), h('dd', null, `${fmt(st.mean)}/${exam.questionCount}`)),
    h('div', null, h('dt', null, 'สูงสุด'), h('dd', null, String(st.max))),
    h('div', null, h('dt', null, 'ต่ำสุด'), h('dd', null, String(st.min)))));

  const btnExcel = h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
    btnExcel.disabled = true;
    try { await exportExcel(exam, results); toast('ส่งออกไฟล์ Excel แล้ว'); }
    catch (err) { toast(`ส่งออกไม่สำเร็จ: ${err.message || err}`, 'error'); }
    finally { btnExcel.disabled = false; }
  } }, icon('download'), 'ส่งออก Excel');
  main.append(h('div', { class: 'btn-row' },
    btnExcel,
    h('a', { class: 'btn btn-quiet', href: `#/exam/${id}/print` }, icon('printer'), 'PDF / พิมพ์'),
    h('a', { class: 'btn btn-quiet', href: `#/exam/${id}/scan` }, icon('camera'), 'ตรวจต่อ')));

  // เลขที่ที่ยังไม่ได้ตรวจ (ถึงเลขที่สูงสุดที่ตรวจแล้ว)
  const maxDone = Math.max(...rows.map((r) => r.no));
  const done = new Set(rows.map((r) => r.no));
  const missing = [];
  for (let n = 1; n <= maxDone; n++) if (!done.has(n)) missing.push(n);
  if (missing.length) {
    main.append(h('p', { class: 'notice' }, `ยังไม่ได้ตรวจเลขที่ ${missing.join(', ')}`));
  }

  main.append(h('table', { class: 'score-table' },
    h('thead', null, h('tr', null,
      h('th', { scope: 'col' }, 'เลขที่'),
      h('th', { scope: 'col', class: 'num' }, 'ข้อที่ถูก'),
      h('th', { scope: 'col' }, 'หมายเหตุ'),
      h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'ดูกระดาษ')))),
    h('tbody', null, rows.map((r) => h('tr', { class: r.pending ? 'is-pending' : '' },
      h('td', null, String(r.no)),
      h('td', { class: 'num' }, h('strong', null, String(r.correct)), `/${r.total}`),
      h('td', { class: 'note' }, r.note),
      h('td', { class: 'go' }, h('a', { class: 'link', href: `#/exam/${id}/result/${r.no}`, 'aria-label': `ดูกระดาษเลขที่ ${r.no}` },
        'ดูกระดาษ', icon('next'))))))));
}
