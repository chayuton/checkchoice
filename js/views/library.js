// คลังเฉลย: ชุดข้อสอบทั้งหมดในเครื่อง แยกตามรายวิชา ค้นหาได้
import { h, icon, clear, plural, formatDate } from '../ui.js';
import { appBar } from '../nav.js';
import { listExams, listResults, examTitle } from '../store.js';
import { transferButton } from '../transfer-ui.js';

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
  main.append(h('div', { class: 'search-bar' }, search), countText, list);

  exams.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

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
    if (!shown.length) {
      list.append(h('p', { class: 'notice' }, 'ไม่พบชุดข้อสอบที่ตรงกับคำค้นหา'));
      return;
    }
    for (const group of groups.values()) {
      list.append(h('section', { class: 'course' },
        h('h2', { class: 'course-title' }, examTitle(group[0]).course || 'ไม่ระบุรายวิชา'),
        h('ul', { class: 'exam-list' }, group.map((e) => h('li', { class: 'exam-item' },
          h('a', { class: 'exam-main', href: `#/exam/${e.id}` },
            h('span', { class: 'exam-name' }, examTitle(e).exam),
            h('span', { class: 'exam-meta' },
              `${plural(e.questionCount, 'ข้อ')}, ${e.template ? e.template.name : ''}, ตรวจแล้ว ${plural(countOf.get(e.id) || 0, 'คน')}`),
            h('span', { class: 'exam-date' }, `แก้ไขล่าสุด ${formatDate(e.updatedAt)}`)),
          h('div', { class: 'exam-actions' },
            h('a', { class: 'btn btn-primary btn-small', href: `#/exam/${e.id}/scan` }, icon('camera'), 'ตรวจกระดาษ'),
            h('a', { class: 'btn btn-quiet btn-small', href: `#/exam/${e.id}/results` }, icon('table'), 'ผลคะแนน'),
            transferButton(e, 'btn btn-quiet btn-small')))))));
    }
  }
  search.addEventListener('input', render);
  render();
}
