// รับชุดข้อสอบจากลิงก์/QR code ที่ส่งมาจากอีกเครื่อง
import { h, icon, toast } from '../ui.js';
import { appBar, go } from '../nav.js';
import { getExam, saveExam, examTitle, letterOf, getTemplate, saveTemplate } from '../store.js';
import { decodeExam } from '../transfer.js';
import { requestPersistence } from '../pwa.js';

const OMR = self.OMRCore;

export async function importView(root, payload) {
  root.append(appBar({ title: 'รับชุดข้อสอบ', back: '#/' }));
  const main = h('main', { class: 'page page-form' });
  root.append(main);

  let incoming;
  try {
    incoming = decodeExam(payload, OMR.TEMPLATES, OMR);
  } catch (err) {
    main.append(h('p', { class: 'notice notice-error' }, err.message),
      h('a', { class: 'btn btn-quiet', href: '#/' }, 'ไปหน้าแรก'));
    return;
  }

  const existing = incoming.id ? await getExam(incoming.id) : null;
  const t = examTitle(incoming);
  const have = incoming.key.slice(0, incoming.questionCount).filter((v) => v != null).length;
  const keyChanged = existing && JSON.stringify(existing.key) !== JSON.stringify(incoming.key);

  const preview = h('p', { class: 'key-preview' },
    incoming.key.slice(0, incoming.questionCount).map((c, i) => `${i + 1}${letterOf(c, incoming.template) || '–'}`).join('  '));

  main.append(h('section', { class: 'form-section' },
    h('h2', { class: 'section-title' }, t.exam),
    h('p', { class: 'section-help' }, t.course || 'ไม่ระบุรายวิชา'),
    incoming.template.custom ? h('p', { class: 'section-help' }, `แบบฟอร์ม: ${incoming.template.name} (จะเพิ่มลงในเครื่องนี้ด้วย)`) : null,
    h('dl', { class: 'import-facts' },
      h('div', null, h('dt', null, 'จำนวนข้อสอบ'), h('dd', null, `${incoming.questionCount} ข้อ`)),
      h('div', null, h('dt', null, 'มีเฉลย'), h('dd', null, `${have} ข้อ`)),
      h('div', null, h('dt', null, 'จำนวนเลขที่'), h('dd', null, `${incoming.maxStudentNo}`))),
    h('details', { class: 'key-details' }, h('summary', null, 'ดูเฉลยทั้งหมด'), preview),
    existing ? h('p', { class: 'notice notice-warn' },
      keyChanged
        ? 'เครื่องนี้มีชุดข้อสอบนี้อยู่แล้ว ถ้านำเข้า เฉลยจะถูกแทนที่ด้วยฉบับนี้ และคะแนนที่ตรวจไว้จะคิดใหม่ตามเฉลยใหม่ (ผลตรวจเดิมไม่หาย)'
        : 'เครื่องนี้มีชุดข้อสอบนี้อยู่แล้ว และเฉลยตรงกัน') : null));

  const btn = h('button', { type: 'button', class: 'btn btn-primary btn-large', id: 'btn-import', onclick: async () => {
    btn.disabled = true;
    try {
      // แบบฟอร์มที่อาจารย์เพิ่มเองบนเครื่องต้นทาง: เพิ่มลงในเครื่องนี้ด้วย
      if (incoming.template.custom) {
        const local = incoming.template.id ? await getTemplate(incoming.template.id) : null;
        if (!local) {
          const saved = await saveTemplate(Object.assign({}, incoming.template, { createdAt: new Date().toISOString() }));
          incoming.template = Object.assign({}, saved);
        }
      }
      const exam = existing
        ? Object.assign(existing, {
          courseCode: incoming.courseCode, courseName: incoming.courseName, examName: incoming.examName,
          questionCount: incoming.questionCount, key: incoming.key,
          maxStudentNo: Math.max(existing.maxStudentNo || 0, incoming.maxStudentNo),
        })
        : Object.assign({ hasKeyImage: false, createdAt: new Date().toISOString(), updatedAt: null }, incoming);
      await saveExam(exam);
      requestPersistence();
      toast(existing ? 'อัปเดตชุดข้อสอบแล้ว' : 'นำเข้าชุดข้อสอบแล้ว พร้อมตรวจ', 'ok');
      go(`#/exam/${exam.id}/scan`);
    } catch (err) {
      toast(`นำเข้าไม่สำเร็จ: ${err.message || err}`, 'error');
      btn.disabled = false;
    }
  } }, icon('check'), existing ? 'อัปเดตชุดข้อสอบ' : 'นำเข้าชุดข้อสอบ');
  root.append(h('div', { class: 'action-bar' }, h('a', { class: 'btn btn-quiet', href: '#/' }, 'ยกเลิก'), btn));
}
