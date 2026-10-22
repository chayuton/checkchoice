// ดู/แก้ผลตรวจที่บันทึกแล้วของเลขที่หนึ่ง
import { h, clear, icon, toast, confirmDialog } from '../ui.js';
import { appBar, go, setLeaveGuard } from '../nav.js';
import { getExam, getResult, saveResult, deleteResult, getBlob, examTitle, scoreOf } from '../store.js';
import { reviewPanel } from '../review-panel.js';
import { blobToImage } from '../overlay.js';

export async function resultView(root, id, no) {
  const exam = await getExam(id);
  const result = exam ? await getResult(id, no) : null;
  const back = `#/exam/${id}/results`;
  if (!exam || !result) {
    root.append(appBar({ title: 'ไม่พบผลตรวจ', back }));
    return;
  }
  const t = examTitle(exam);
  const blob = result.imageId ? await getBlob(result.imageId) : null;
  const image = blob ? await blobToImage(blob) : null;
  const original = JSON.stringify(result.items);
  let items = result.items;
  let dirty = false;

  setLeaveGuard(() => (dirty ? confirmDialog('ยังไม่ได้บันทึกการแก้ไข ต้องการออกจากหน้านี้หรือไม่', {
    okText: 'ออกโดยไม่บันทึก', danger: true,
  }) : true));

  root.append(appBar({ title: `เลขที่ ${no}`, subtitle: `${t.course} ${t.exam}`, back }));
  const main = h('main', { class: 'page' });
  root.append(main);
  const actionBar = h('div', { class: 'action-bar' });
  root.append(actionBar);

  const panel = reviewPanel({
    exam, items, image, geom: result.geom, studentNo: no,
    onChange: (next) => { items = next; dirty = JSON.stringify(next) !== original; renderActions(); },
  });
  main.append(panel.el);
  if (!image) main.prepend(h('p', { class: 'notice' }, 'ไม่มีรูปกระดาษของเลขที่นี้'));

  function renderActions() {
    const pending = panel.pending().length;
    clear(actionBar).append(
      h('button', { type: 'button', class: 'btn btn-quiet', onclick: remove }, icon('trash'), 'ลบผลนี้'),
      h('button', { type: 'button', class: 'btn btn-primary btn-large', disabled: !dirty || pending > 0, onclick: save },
        pending ? `ยืนยันอีก ${pending} ข้อ` : [icon('check'), 'บันทึกการแก้ไข']));
  }

  async function save() {
    try {
      result.items = items;
      await saveResult(result);
      dirty = false;
      setLeaveGuard(null);
      toast(`บันทึกเลขที่ ${no} แล้ว ได้ ${scoreOf(exam, result).correct} คะแนน`, 'ok');
      go(back);
    } catch (err) {
      toast(`บันทึกไม่สำเร็จ: ${err.message || err}`, 'error');
    }
  }

  async function remove() {
    const ok = await confirmDialog(`ลบผลตรวจของเลขที่ ${no} พร้อมรูปกระดาษ`, { okText: 'ลบผลนี้', danger: true });
    if (!ok) return;
    await deleteResult(result);
    dirty = false;
    setLeaveGuard(null);
    toast(`ลบผลของเลขที่ ${no} แล้ว`);
    go(back);
  }

  renderActions();
}
