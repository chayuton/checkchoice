// หน้าแรก: เลือก "เปิดจากคลังเฉลย" หรือ "สร้างเฉลยใหม่" + ชุดข้อสอบที่ใช้ล่าสุด + เครื่องมือ
import { h, icon, penX, plural, formatDate } from '../ui.js';
import { appBar, go } from '../nav.js';
import { listExams, listResults, listTemplates, examTitle } from '../store.js';
import { install, isStandalone, platform } from '../pwa.js';
import { transferButton } from '../transfer-ui.js';
import { limitedNotice } from '../env.js';
import { deleteExamsWithConfirm, trashButton } from '../delete-ui.js';

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

/** ภาพกระดาษคำตอบย่อส่วน ใช้เป็นสัญลักษณ์ของปุ่มสร้างเฉลย */
function miniSheet(marks) {
  return h('span', { class: 'mini-sheet mini-sheet-sm', 'aria-hidden': 'true' },
    marks.map((m, r) => h('span', { class: 'mini-row' },
      h('span', { class: 'mini-no' }, String(r + 1)),
      [0, 1, 2, 3].map((c) => h('span', { class: 'mini-cell' }, m === c ? penX(r * 4 + c) : null)))));
}

/** ภาพตั้งกระดาษซ้อนกัน ใช้เป็นสัญลักษณ์ของคลังเฉลย */
function stackIcon(n) {
  return h('span', { class: 'stack', 'aria-hidden': 'true' },
    h('span', { class: 'stack-sheet s3' }), h('span', { class: 'stack-sheet s2' }),
    h('span', { class: 'stack-sheet s1' }, h('span', { class: 'stack-count' }, String(n))));
}

export async function homeView(root) {
  const [exams, templates] = await Promise.all([listExams(), listTemplates()]);
  const counts = await Promise.all(exams.map((e) => listResults(e.id).then((r) => r.length)));
  const countOf = new Map(exams.map((e, i) => [e.id, counts[i]]));
  const courses = new Set(exams.map((e) => `${e.courseCode}|${e.courseName}`));
  const confirmedSheets = counts.reduce((a, b) => a + b, 0);

  root.append(appBar({
    actions: [h('a', { class: 'icon-btn', href: '#/settings', 'aria-label': 'ตั้งค่าและสำรองข้อมูล' }, icon('gear'))],
  }));
  const main = h('main', { class: 'page page-home' });
  root.append(main);
  const limited = limitedNotice();
  if (limited) main.append(limited);
  const hint = installHint();
  if (hint) main.append(hint);

  main.append(
    h('h1', { class: 'home-title' }, 'จะตรวจข้อสอบชุดไหน'),
    h('div', { class: 'start-choices' },
      h('a', { class: 'choice', href: '#/library', id: 'choice-library' },
        stackIcon(exams.length),
        h('span', { class: 'choice-text' },
          h('span', { class: 'choice-title' }, 'เปิดจากคลังเฉลย'),
          h('span', { class: 'choice-meta' }, exams.length
            ? `${plural(exams.length, 'ชุดข้อสอบ')} ใน ${plural(courses.size, 'รายวิชา')}`
            : 'ยังไม่มีเฉลยในเครื่องนี้'))),
      h('a', { class: 'choice choice-new', href: '#/exam/new', id: 'choice-new' },
        miniSheet([1, 3, 0]),
        h('span', { class: 'choice-text' },
          h('span', { class: 'choice-title' }, 'สร้างเฉลยใหม่'),
          h('span', { class: 'choice-meta' }, 'เลือกแบบฟอร์มกระดาษคำตอบ แล้วถ่ายรูปใบเฉลย')))));

  // ชุดข้อสอบที่ใช้ล่าสุด
  if (exams.length) {
    const recent = exams.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 3);
    main.append(h('section', { class: 'home-section' },
      h('div', { class: 'section-head' },
        h('h2', { class: 'home-h2' }, 'ใช้ล่าสุด'),
        h('a', { class: 'link', href: '#/library' }, 'ดูทั้งหมด')),
      h('ul', { class: 'exam-list exam-list-boxed' }, recent.map((e) => {
        const t = examTitle(e);
        return h('li', { class: 'exam-item' },
          h('a', { class: 'exam-main', href: `#/exam/${e.id}` },
            h('span', { class: 'exam-name' }, t.exam),
            h('span', { class: 'exam-meta' }, `${t.course || 'ไม่ระบุรายวิชา'}, ${plural(e.questionCount, 'ข้อ')}, ตรวจแล้ว ${plural(countOf.get(e.id) || 0, 'คน')}`),
            h('span', { class: 'exam-date' }, `แก้ไขล่าสุด ${formatDate(e.updatedAt)}`)),
          h('div', { class: 'exam-actions' },
            h('a', { class: 'btn btn-primary btn-small', href: `#/exam/${e.id}/scan` }, icon('camera'), 'ตรวจกระดาษ'),
            h('a', { class: 'btn btn-quiet btn-small', href: `#/exam/${e.id}/results` }, icon('table'), 'ผลคะแนน'),
            transferButton(e, 'btn btn-quiet btn-small'),
            trashButton(`ลบชุดข้อสอบ ${t.exam}`, async () => {
              if (await deleteExamsWithConfirm([e])) go('#/');
            })));
      }))));
  }

  // เครื่องมือ
  const custom = templates.filter((t) => t.custom).length;
  main.append(h('section', { class: 'home-section' },
    h('h2', { class: 'home-h2' }, 'เครื่องมือ'),
    h('ul', { class: 'tool-list' },
      h('li', null, h('a', { href: '#/templates', id: 'tool-templates' },
        icon('table'), h('span', { class: 'tool-text' },
          h('span', { class: 'tool-title' }, 'แบบฟอร์มกระดาษคำตอบ'),
          h('span', { class: 'tool-meta' }, `แบบสำเร็จรูป ${templates.length - custom} แบบ${custom ? `, เพิ่มเอง ${custom} แบบ` : ''} เพิ่มแบบที่มีข้อมากขึ้นได้`)),
        icon('next', 'icon chevron'))),
      h('li', null, h('a', { href: '#/training', id: 'tool-training' },
        icon('image'), h('span', { class: 'tool-text' },
          h('span', { class: 'tool-title' }, 'ข้อมูลสำหรับ Train'),
          h('span', { class: 'tool-meta' }, `กระดาษที่ตรวจและยืนยันแล้ว ${plural(confirmedSheets, 'แผ่น')} ส่งออกไว้ฝึกโมเดลภายหลังได้`)),
        icon('next', 'icon chevron'))),
      h('li', null, h('a', { href: '#/settings' },
        icon('gear'), h('span', { class: 'tool-text' },
          h('span', { class: 'tool-title' }, 'ตั้งค่าและสำรองข้อมูล'),
          h('span', { class: 'tool-meta' }, 'ติดตั้งแอป ดาวน์โหลดไฟล์สำรอง และกู้คืน')),
        icon('next', 'icon chevron'))))));
}
