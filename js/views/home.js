// หน้าแรก: คลังเฉลย แยกตามรายวิชา
import { h, icon, penX, plural, formatDate } from '../ui.js';
import { appBar } from '../nav.js';
import { listExams, listResults, examTitle } from '../store.js';
import { install, isStandalone, platform } from '../pwa.js';
import { transferButton } from '../transfer-ui.js';

function emptyState() {
  // ภาพกระดาษคำตอบย่อส่วน เป็นตัวอย่างว่าแอปทำอะไร
  const mini = h('div', { class: 'mini-sheet', 'aria-hidden': 'true' },
    [0, 1, 2, 3].map((r) => h('div', { class: 'mini-row' },
      h('span', { class: 'mini-no' }, String(r + 1)),
      [0, 1, 2, 3, 4].map((c) => h('span', { class: 'mini-cell' }, [1, 2, 0, 3][r] === c ? penX(r * 5 + c) : null)))));
  return h('section', { class: 'empty' }, mini,
    h('h2', null, 'ยังไม่มีชุดข้อสอบ'),
    h('p', null, 'สร้างชุดข้อสอบของรายวิชา ถ่ายรูปใบเฉลย แล้วเริ่มถ่ายกระดาษคำตอบของนักศึกษาเพื่อตรวจ'),
    h('a', { class: 'btn btn-primary btn-large', href: '#/exam/new' }, icon('plus'), 'สร้างชุดข้อสอบ'));
}

function installHint() {
  if (isStandalone()) return null;
  try { if (localStorage.getItem('cc.hideInstall') === '1') return null; } catch (e) { /* ignore */ }
  const p = platform();
  if (p === 'desktop') return null;
  const box = h('aside', { class: 'install-hint' });
  const dismiss = h('button', { class: 'link-btn', onclick: () => {
    try { localStorage.setItem('cc.hideInstall', '1'); } catch (e) { /* ignore */ }
    box.remove();
  } }, 'ไม่ต้องแสดงอีก');
  const text = p === 'ios'
    ? 'เพิ่มแอปไว้ที่หน้าจอหลัก: แตะปุ่มแชร์ใน Safari แล้วเลือก "เพิ่มไปยังหน้าจอโฮม" ข้อมูลที่บันทึกจะอยู่ครบเมื่อเปิดจากไอคอนนี้'
    : 'ติดตั้งแอปไว้ที่หน้าจอหลัก เพื่อเปิดได้เร็วและใช้งานได้แม้ไม่มีอินเทอร์เน็ต';
  box.append(h('p', null, text));
  const actions = h('div', { class: 'install-actions' });
  const addBtn = () => {
    if (install.prompt && !actions.querySelector('.btn')) {
      actions.prepend(h('button', { class: 'btn btn-small btn-primary', onclick: async () => {
        const ev = install.prompt;
        install.prompt = null;
        ev.prompt();
        await ev.userChoice;
        box.remove();
      } }, 'ติดตั้งแอป'));
    }
  };
  addBtn();
  install.listeners.add(addBtn);
  actions.append(dismiss);
  box.append(actions);
  return box;
}

export async function homeView(root) {
  const exams = await listExams();
  const counts = await Promise.all(exams.map((e) => listResults(e.id).then((r) => r.length)));
  const countOf = new Map(exams.map((e, i) => [e.id, counts[i]]));

  root.append(appBar({
    actions: [h('a', { class: 'icon-btn', href: '#/settings', 'aria-label': 'ตั้งค่าและสำรองข้อมูล' }, icon('gear'))],
  }));
  const main = h('main', { class: 'page' });
  root.append(main);
  const hint = installHint();
  if (hint) main.append(hint);

  if (!exams.length) {
    main.append(emptyState());
    return;
  }

  // จัดกลุ่มตามรายวิชา เรียงตามที่แก้ไขล่าสุด
  const groups = new Map();
  exams.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  for (const e of exams) {
    const k = `${(e.courseCode || '').trim()}|${(e.courseName || '').trim()}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }

  main.append(h('div', { class: 'page-head' },
    h('h1', { class: 'page-title' }, 'คลังเฉลย'),
    h('a', { class: 'btn btn-primary', href: '#/exam/new' }, icon('plus'), 'สร้างชุดข้อสอบ')));

  for (const list of groups.values()) {
    const t = examTitle(list[0]);
    main.append(h('section', { class: 'course' },
      h('h2', { class: 'course-title' }, t.course || 'ไม่ระบุรายวิชา'),
      h('ul', { class: 'exam-list' }, list.map((e) => {
        const n = countOf.get(e.id) || 0;
        return h('li', { class: 'exam-item' },
          h('a', { class: 'exam-main', href: `#/exam/${e.id}` },
            h('span', { class: 'exam-name' }, examTitle(e).exam),
            h('span', { class: 'exam-meta' },
              `${plural(e.questionCount, 'ข้อ')}, ตรวจแล้ว ${plural(n, 'คน')}`),
            h('span', { class: 'exam-date' }, `แก้ไขล่าสุด ${formatDate(e.updatedAt)}`)),
          h('div', { class: 'exam-actions' },
            h('a', { class: 'btn btn-primary btn-small', href: `#/exam/${e.id}/scan` }, icon('camera'), 'ตรวจกระดาษ'),
            h('a', { class: 'btn btn-quiet btn-small', href: `#/exam/${e.id}/results` }, icon('table'), 'ผลคะแนน'),
            transferButton(e, 'btn btn-quiet btn-small')));
      }))));
  }
}
