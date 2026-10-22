// คลังเฉลย: ชุดข้อสอบทั้งหมดในเครื่อง แยกตามรายวิชา ค้นหาได้ และลบชุดที่ไม่ใช้แล้วเพื่อคืนพื้นที่
import { h, icon, clear, plural, formatDate, formatBytes } from '../ui.js';
import { appBar, go } from '../nav.js';
import { listExams, listResults, examTitle, storageByExam } from '../store.js';
import { transferButton } from '../transfer-ui.js';
import { deleteExamsWithConfirm, trashButton } from '../delete-ui.js';

export async function libraryView(root) {
  const exams = await listExams();
  const counts = await Promise.all(exams.map((e) => listResults(e.id).then((r) => r.length)));
  const countOf = new Map(exams.map((e, i) => [e.id, counts[i]]));

  root.append(appBar({
    title: 'คลังเฉลย', back: '#/',
    actions: [h('a', { class: 'icon-btn', href: '#/exam/new', 'aria-label': 'สร้างเฉลยใหม่' }, icon('plus'))],
  }));
  const main = h('main', { class: 'page' });
  root.append(main);

  if (!exams.length) {
    main.append(h('section', { class: 'empty' },
      h('h2', null, 'ยังไม่มีเฉลยในคลัง'),
      h('p', null, 'สร้างเฉลยใหม่ หรือรับชุดข้อสอบจากเครื่องอื่นด้วย QR code ที่เครื่องนั้น'),
      h('a', { class: 'btn btn-primary btn-large', href: '#/exam/new' }, icon('plus'), 'สร้างเฉลยใหม่')));
    return;
  }

  const search = h('input', {
    class: 'input search-input', type: 'search', id: 'library-search', autocomplete: 'off',
    placeholder: 'ค้นหารหัสวิชา ชื่อวิชา หรือชื่อการสอบ', 'aria-label': 'ค้นหาในคลังเฉลย',
  });
  const list = h('div', { class: 'library-list' });
  const countText = h('p', { class: 'section-help' });
  const storageText = h('p', { class: 'section-help storage-summary', id: 'library-storage', hidden: true });
  main.append(h('div', { class: 'search-bar' }, search), countText, storageText, list);

  exams.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  let usage = null;          // Map examId → { bytes, ... } (คำนวณหลังแสดงรายการ)
  const sizeSpans = new Map();

  const remove = async (group) => {
    if (await deleteExamsWithConfirm(group)) go('#/library');
  };

  function render() {
    const q = search.value.trim().toLowerCase();
    const shown = exams.filter((e) => !q || [e.courseCode, e.courseName, e.examName].join(' ').toLowerCase().includes(q));
    countText.textContent = q ? `พบ ${plural(shown.length, 'ชุดข้อสอบ')}` : `ทั้งหมด ${plural(exams.length, 'ชุดข้อสอบ')}`;
    const groups = new Map();
    for (const e of shown) {
      const k = `${(e.courseCode || '').trim()}|${(e.courseName || '').trim()}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }
    clear(list);
    sizeSpans.clear();
    if (!shown.length) {
      list.append(h('p', { class: 'notice' }, 'ไม่พบชุดข้อสอบที่ตรงกับคำค้นหา'));
      return;
    }
    for (const group of groups.values()) {
      const course = examTitle(group[0]).course || 'ไม่ระบุรายวิชา';
      list.append(h('section', { class: 'course' },
        h('div', { class: 'course-head' },
          h('h2', { class: 'course-title' }, course),
          // ลบทั้งรายวิชา (เมื่อมีมากกว่าหนึ่งชุด) เช่น เมื่อจบภาคเรียน
          group.length > 1 ? h('button', {
            type: 'button', class: 'link-btn course-delete', onclick: () => remove(group),
            'aria-label': `ลบทุกชุดข้อสอบของวิชา ${course}`,
          }, icon('trash'), `ลบทั้งวิชา (${group.length} ชุด)`) : null),
        h('ul', { class: 'exam-list' }, group.map((e) => {
          const size = h('span', { class: 'exam-size' });
          sizeSpans.set(e.id, size);
          if (usage && usage.has(e.id)) size.textContent = ` · ${formatBytes(usage.get(e.id).bytes)}`;
          const t = examTitle(e);
          return h('li', { class: 'exam-item', dataset: { examId: e.id } },
            h('a', { class: 'exam-main', href: `#/exam/${e.id}` },
              h('span', { class: 'exam-name' }, t.exam),
              h('span', { class: 'exam-meta' },
                `${plural(e.questionCount, 'ข้อ')}, ${e.template ? e.template.name : ''}, ตรวจแล้ว ${plural(countOf.get(e.id) || 0, 'คน')}`, size),
              h('span', { class: 'exam-date' }, `แก้ไขล่าสุด ${formatDate(e.updatedAt)}`)),
            h('div', { class: 'exam-actions' },
              h('a', { class: 'btn btn-primary btn-small', href: `#/exam/${e.id}/scan` }, icon('camera'), 'ตรวจกระดาษ'),
              h('a', { class: 'btn btn-quiet btn-small', href: `#/exam/${e.id}/results` }, icon('table'), 'ผลคะแนน'),
              transferButton(e, 'btn btn-quiet btn-small'),
              trashButton(`ลบชุดข้อสอบ ${t.exam}`, () => remove([e]))));
        }))));
    }
  }
  search.addEventListener('input', render);
  render();

  // ขนาดพื้นที่ที่แต่ละชุดใช้ ช่วยตัดสินใจว่าจะลบชุดไหน
  storageByExam().then((u) => {
    usage = u;
    let total = 0;
    for (const e of exams) total += (u.get(e.id) || { bytes: 0 }).bytes;
    for (const [id, span] of sizeSpans) if (u.has(id)) span.textContent = ` · ${formatBytes(u.get(id).bytes)}`;
    storageText.textContent = `ชุดข้อสอบในเครื่องนี้ใช้พื้นที่รวมประมาณ ${formatBytes(total)} ลบชุดที่ไม่ใช้แล้วได้ด้วยปุ่มถังขยะ`;
    storageText.hidden = false;
  }).catch(() => {});
}
