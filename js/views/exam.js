// สร้าง/แก้ไขชุดข้อสอบ และกำหนดเฉลยจากรูปถ่ายหรือแตะเลือกเอง
import { h, clear, icon, toast, confirmDialog } from '../ui.js';
import { appBar, go, setLeaveGuard } from '../nav.js';
import {
  blankExam, getExam, saveExam, deleteExam, listExams, listResults, putBlob, getBlob, examTitle,
} from '../store.js';
import { answerGrid } from '../grid.js';
import { drawSheet, displayToCanvas, blobToImage } from '../overlay.js';
import { pickImage, fileToCanvas, canvasImageData, canvasToBlob } from '../capture.js';
import { initOMR, readSheet } from '../omr/client.js';
import { requestPersistence } from '../pwa.js';
import { openTransferDialog } from '../transfer-ui.js';
import { errorMessage } from './scan.js';

const OMR = self.OMRCore;

export async function examView(root, id) {
  const isNew = !id;
  const stored = isNew ? null : await getExam(id);
  if (!isNew && !stored) {
    root.append(appBar({ title: 'ไม่พบชุดข้อสอบ', back: '#/' }),
      h('main', { class: 'page' }, h('p', { class: 'notice notice-error' }, 'ชุดข้อสอบนี้ถูกลบไปแล้ว')));
    return;
  }
  const exam = stored ? JSON.parse(JSON.stringify(stored)) : blankExam();
  const resultsCount = isNew ? 0 : (await listResults(id)).length;
  const others = await listExams();
  initOMR().catch(() => {});

  let dirty = false;
  let countTouched = !isNew;
  let keyFlags = new Set();         // ข้อที่อ่านเฉลยไม่ชัด รอครูแตะแก้
  let keyImage = null;              // ภาพตาราง (สำหรับวาดกรอบ)
  let keyGeom = exam.keyGeom || null;
  let newOriginal = null;           // canvas ภาพต้นฉบับใหม่ที่ยังไม่บันทึก
  let newTable = null;              // canvas ภาพตารางใหม่
  const markDirty = () => { dirty = true; };

  setLeaveGuard(() => (dirty ? confirmDialog('ยังไม่ได้บันทึกการเปลี่ยนแปลง ต้องการออกจากหน้านี้หรือไม่', {
    okText: 'ออกโดยไม่บันทึก', danger: true,
  }) : true));

  const t = examTitle(exam);
  root.append(appBar({
    title: isNew ? 'สร้างชุดข้อสอบ' : t.exam,
    subtitle: isNew ? null : t.course,
    back: '#/',
  }));
  const main = h('main', { class: 'page page-form' });
  root.append(main);

  // ---------------------------------------------------------------- ข้อมูลรายวิชา
  const courses = [...new Map(others.map((e) => [`${e.courseCode}|${e.courseName}`, e])).values()];
  const dlCodes = h('datalist', { id: 'dl-codes' }, courses.filter((e) => e.courseCode).map((e) => h('option', { value: e.courseCode }, e.courseName)));
  const dlNames = h('datalist', { id: 'dl-names' }, courses.filter((e) => e.courseName).map((e) => h('option', { value: e.courseName })));

  const fCode = h('input', { class: 'input', id: 'f-code', value: exam.courseCode, list: 'dl-codes', autocomplete: 'off', placeholder: 'เช่น 04-000-101', maxlength: 40 });
  const fName = h('input', { class: 'input', id: 'f-name', value: exam.courseName, list: 'dl-names', autocomplete: 'off', placeholder: 'เช่น เทคโนโลยีสารสนเทศเบื้องต้น', maxlength: 120 });
  const fExam = h('input', { class: 'input', id: 'f-exam', value: exam.examName, autocomplete: 'off', placeholder: 'เช่น สอบกลางภาค 1/2569', maxlength: 120 });
  const maxQ = OMR.questionCount(exam.template);
  const fCount = h('input', { class: 'input input-num', id: 'f-count', type: 'number', inputmode: 'numeric', min: 1, max: maxQ, value: String(exam.questionCount) });
  const fMaxNo = h('input', { class: 'input input-num', id: 'f-maxno', type: 'number', inputmode: 'numeric', min: 1, max: 999, value: String(exam.maxStudentNo) });
  const fTemplate = h('select', { class: 'input', id: 'f-template', disabled: OMR.TEMPLATES.length < 2 },
    OMR.TEMPLATES.map((tp) => h('option', { value: tp.id, selected: tp.id === exam.template.id }, tp.name)));

  fCode.addEventListener('input', () => {
    exam.courseCode = fCode.value.trim(); markDirty();
    const match = courses.find((e) => e.courseCode === exam.courseCode);
    if (match && !fName.value.trim()) { fName.value = match.courseName; exam.courseName = match.courseName; }
  });
  fName.addEventListener('input', () => { exam.courseName = fName.value.trim(); markDirty(); });
  fExam.addEventListener('input', () => { exam.examName = fExam.value.trim(); markDirty(); });
  fCount.addEventListener('input', () => {
    const n = Math.round(Number(fCount.value));
    if (n >= 1 && n <= maxQ) { exam.questionCount = n; countTouched = true; markDirty(); renderKey(); }
  });
  fMaxNo.addEventListener('input', () => {
    const n = Math.round(Number(fMaxNo.value));
    if (n >= 1 && n <= 999) { exam.maxStudentNo = n; markDirty(); }
  });

  const field = (label, input, hint) => h('label', { class: 'field' },
    h('span', { class: 'field-label' }, label), input, hint ? h('span', { class: 'field-hint' }, hint) : null);

  main.append(h('section', { class: 'form-section' },
    h('h2', { class: 'section-title' }, 'รายวิชาและการสอบ'),
    dlCodes, dlNames,
    h('div', { class: 'field-row' },
      field('รหัสวิชา', fCode),
      field('ชื่อวิชา', fName)),
    field('ชื่อการสอบ', fExam),
    field('แบบฟอร์มกระดาษคำตอบ', fTemplate),
    h('div', { class: 'field-row' },
      field('จำนวนข้อสอบ', fCount, `ตรวจข้อ 1 ถึงข้อนี้ (สูงสุด ${maxQ})`),
      field('จำนวนเลขที่', fMaxNo, 'เพิ่มภายหลังได้ในหน้าตรวจ'))));

  // ---------------------------------------------------------------- เฉลย
  const keyStatus = h('p', { class: 'key-status', role: 'status', 'aria-live': 'polite' });
  const sheetCanvas = h('canvas', { class: 'sheet-canvas', role: 'img', 'aria-label': 'ภาพใบเฉลยพร้อมกรอบคำตอบที่อ่านได้' });
  const sheetFig = h('figure', { class: 'sheet-figure', hidden: true }, sheetCanvas);
  const keySummary = h('p', { class: 'key-summary' });
  const gridSlot = h('div', { class: 'grid-slot' });
  const originalLink = h('p', { class: 'original-link' });

  const busyBtn = (b, on) => { b.disabled = on; };
  const btnShoot = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => takeKey(true) }, icon('camera'), 'ถ่ายรูปใบเฉลย');
  const btnPick = h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => takeKey(false) }, icon('image'), 'เลือกรูปจากเครื่อง');

  main.append(h('section', { class: 'form-section' },
    h('h2', { class: 'section-title' }, 'เฉลย'),
    h('p', { class: 'section-help' }, 'ถ่ายรูปใบเฉลยที่กากบาทไว้ ให้เห็นตารางครบทั้ง 4 มุม หรือแตะช่องในตารางด้านล่างเพื่อกำหนดเฉลยเอง'),
    h('div', { class: 'btn-row' }, btnShoot, btnPick),
    keyStatus, sheetFig, originalLink, keySummary, gridSlot));

  function renderKey() {
    // นับข้อที่มีเฉลย
    let have = 0;
    for (let i = 0; i < exam.questionCount; i++) if (exam.key[i] != null) have++;
    keySummary.textContent = `มีเฉลยแล้ว ${have} จาก ${exam.questionCount} ข้อ` +
      (keyFlags.size ? ` อ่านไม่ชัด ${keyFlags.size} ข้อ (แถบสีเหลือง) แตะช่องที่ถูกต้องเพื่อแก้` : '');
    keySummary.className = keyFlags.size ? 'key-summary warn' : 'key-summary';
    const grid = answerGrid({
      template: exam.template, count: exam.questionCount, mode: 'key', key: exam.key,
      onChange: (next) => {
        next.forEach((v, i) => { if (v !== exam.key[i]) keyFlags.delete(i + 1); });
        exam.key = next;
        markDirty();
        renderKey();
      },
    });
    keyFlags.forEach((q) => { const row = grid.querySelector(`#q-${q}`); if (row) row.classList.add('is-pending'); });
    clear(gridSlot).append(grid);
    if (keyImage && keyGeom) {
      sheetFig.hidden = false;
      drawSheet(sheetCanvas, keyImage, keyGeom, exam.template, { count: exam.questionCount, key: exam.key, mode: 'key' });
    }
  }

  async function takeKey(capture) {
    const file = await pickImage({ capture });
    if (!file) return;
    busyBtn(btnShoot, true); busyBtn(btnPick, true);
    keyStatus.className = 'key-status busy';
    keyStatus.textContent = 'กำลังอ่านใบเฉลย… (ครั้งแรกต้องโหลดตัวอ่านภาพ อาจใช้เวลาสักครู่)';
    try {
      const canvas = await fileToCanvas(file);
      const res = await readSheet(canvasImageData(canvas), exam.template);
      if (!res.ok) throw new Error(errorMessage(res));
      newOriginal = canvas;
      newTable = displayToCanvas(res.display);
      keyImage = newTable;
      keyGeom = { xs: res.xs, ys: res.ys, scale: res.display.scale };
      exam.key = res.decisions.map((d) => d.choice);
      keyFlags = new Set(res.decisions.map((d, i) => (d.flag && d.flag !== 'blank' ? i + 1 : 0)).filter(Boolean));
      const last = OMR.lastMarkedQuestion(res.decisions);
      let note = '';
      if (!countTouched && last > 0) {
        exam.questionCount = last;
        fCount.value = String(last);
        note = ` พบเฉลยถึงข้อ ${last} จึงตั้งจำนวนข้อสอบเป็น ${last} ข้อ (แก้ได้)`;
      }
      keyStatus.className = res.warning ? 'key-status error' : 'key-status ok';
      keyStatus.textContent = res.warning === 'orientation'
        ? 'อ่านได้ แต่บอกทิศของกระดาษไม่ชัดเจน ตรวจดูภาพว่าหัวตาราง (A–E) อยู่ด้านบน ถ้าไม่ใช่ให้ถ่ายใหม่'
        : `อ่านใบเฉลยแล้ว ตรวจดูให้ถูกต้องก่อนบันทึก${note}`;
      markDirty();
      renderKey();
      sheetFig.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      keyStatus.className = 'key-status error';
      keyStatus.textContent = err.message || String(err);
    } finally {
      busyBtn(btnShoot, false); busyBtn(btnPick, false);
    }
  }

  // โหลดภาพเฉลยเดิม
  if (!isNew && exam.hasKeyImage) {
    getBlob(`key:${exam.id}:table`).then(async (b) => {
      if (!b || newTable) return;
      keyImage = await blobToImage(b);
      renderKey();
    });
    getBlob(`key:${exam.id}:original`).then((b) => {
      if (!b) return;
      const url = URL.createObjectURL(b);
      clear(originalLink).append(h('a', { href: url, target: '_blank', rel: 'noopener', class: 'link' }, icon('image'), 'ดูภาพใบเฉลยต้นฉบับ'));
    });
  }
  renderKey();

  // ---------------------------------------------------------------- บันทึก / ลบ
  async function save() {
    if (!exam.courseName && !exam.courseCode) {
      toast('ใส่รหัสวิชาหรือชื่อวิชา เพื่อระบุว่าเป็นเฉลยของวิชาใด', 'error');
      (fName.value ? fCode : fName).focus();
      return;
    }
    const missing = [];
    for (let i = 0; i < exam.questionCount; i++) if (exam.key[i] == null) missing.push(i + 1);
    if (missing.length === exam.questionCount) {
      toast('ยังไม่มีเฉลย ถ่ายรูปใบเฉลยหรือแตะเลือกคำตอบในตาราง', 'error');
      return;
    }
    if (keyFlags.size) {
      const ok = await confirmDialog(`ยังมีข้อที่อ่านไม่ชัด ${keyFlags.size} ข้อ (ข้อ ${[...keyFlags].sort((a, b) => a - b).join(', ')}) ยืนยันว่าเฉลยถูกต้องแล้วหรือไม่`,
        { okText: 'เฉลยถูกต้องแล้ว' });
      if (!ok) return;
    }
    if (missing.length) {
      const ok = await confirmDialog(`ข้อ ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ' …' : ''} ยังไม่มีเฉลย ข้อที่ไม่มีเฉลยจะไม่นับคะแนน บันทึกต่อหรือไม่`,
        { okText: 'บันทึกต่อ' });
      if (!ok) return;
    }
    btnSave.disabled = true;
    try {
      const keyChanged = stored && JSON.stringify(stored.key) !== JSON.stringify(exam.key);
      if (newOriginal) exam.hasKeyImage = true;
      exam.keyGeom = keyGeom;
      await saveExam(exam);
      if (newOriginal) {
        await putBlob(`key:${exam.id}:original`, await canvasToBlob(newOriginal, 'image/jpeg', 0.85));
        await putBlob(`key:${exam.id}:table`, await canvasToBlob(newTable, 'image/jpeg', 0.82));
      }
      requestPersistence();
      dirty = false;
      setLeaveGuard(null);
      toast(keyChanged && resultsCount ? `บันทึกแล้ว คะแนนของ ${resultsCount} คนคิดใหม่ตามเฉลยที่แก้` : 'บันทึกชุดข้อสอบแล้ว');
      go(isNew ? `#/exam/${exam.id}/scan` : '#/');
    } catch (err) {
      toast(`บันทึกไม่สำเร็จ: ${err.message || err}`, 'error');
      btnSave.disabled = false;
    }
  }

  const btnSave = h('button', { type: 'button', class: 'btn btn-primary btn-large', onclick: save },
    icon('check'), isNew ? 'บันทึกแล้วเริ่มตรวจ' : 'บันทึกชุดข้อสอบ');
  root.append(h('div', { class: 'action-bar' },
    isNew ? null : h('a', { class: 'btn btn-quiet', href: `#/exam/${id}/scan` }, icon('camera'), 'ตรวจกระดาษ'),
    btnSave));

  if (!isNew) {
    main.append(h('section', { class: 'form-section' },
      h('h2', { class: 'section-title' }, 'ใช้ชุดข้อสอบนี้บนเครื่องอื่น'),
      h('p', { class: 'section-help' }, 'ข้อมูลเก็บแยกในแต่ละเครื่อง ถ้าสร้างเฉลยบนคอมพิวเตอร์แล้วจะตรวจด้วยมือถือ ให้ส่งชุดข้อสอบนี้ไปด้วย QR code หรือลิงก์'),
      h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-quiet', id: 'btn-transfer', onclick: () => {
        if (dirty) { toast('บันทึกการแก้ไขก่อน แล้วค่อยส่งไปเครื่องอื่น', 'error'); return; }
        openTransferDialog(exam).catch((err) => toast(err.message || String(err), 'error'));
      } }, icon('send'), 'ส่งไปมือถือ / เครื่องอื่น'))));
    main.append(h('section', { class: 'form-section danger-zone' },
      h('h2', { class: 'section-title' }, 'ลบชุดข้อสอบ'),
      h('p', { class: 'section-help' }, `ลบชุดข้อสอบนี้พร้อมผลตรวจ ${resultsCount} คนและรูปทั้งหมดออกจากเครื่อง`),
      h('button', { type: 'button', class: 'btn btn-danger', onclick: async () => {
        const ok = await confirmDialog(`ลบ "${t.exam}" และผลตรวจทั้งหมด ลบแล้วกู้คืนไม่ได้ ยกเว้นมีไฟล์สำรอง`, { okText: 'ลบชุดข้อสอบ', danger: true });
        if (!ok) return;
        await deleteExam(exam.id);
        dirty = false;
        setLeaveGuard(null);
        toast('ลบชุดข้อสอบแล้ว');
        go('#/');
      } }, icon('trash'), 'ลบชุดข้อสอบ')));
  }
}
