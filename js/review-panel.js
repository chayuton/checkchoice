// แผงตรวจทานผลการอ่านกระดาษหนึ่งแผ่น: คะแนน ภาพตาราง ข้อที่ต้องยืนยัน และตารางคำตอบ
import { h, clear } from './ui.js';
import { answerGrid, pendingList } from './grid.js';
import { drawSheet } from './overlay.js';
import { pendingQuestions } from './store.js';

const OMR = self.OMRCore;

export function reviewPanel({ exam, items, image, geom, studentNo, existing, onChange }) {
  let state = items;
  const el = h('section', { class: 'review', 'aria-label': `ผลตรวจเลขที่ ${studentNo}` });
  const scoreBox = h('div', { class: 'score-box' });
  const canvas = h('canvas', { class: 'sheet-canvas', role: 'img', 'aria-label': 'ภาพตารางคำตอบพร้อมผลการอ่าน' });
  const pendingSlot = h('div');
  const gridSlot = h('div', { class: 'grid-slot' });
  const sheetWrap = image ? h('figure', { class: 'sheet-figure' }, canvas,
    h('figcaption', { class: 'legend' },
      h('span', { class: 'lg lg-right' }, 'ถูก'),
      h('span', { class: 'lg lg-wrong' }, 'ผิด'),
      h('span', { class: 'lg lg-key' }, 'เฉลย'),
      h('span', { class: 'lg lg-flag' }, 'ต้องยืนยัน'))) : null;
  el.append(scoreBox, existing ? h('p', { class: 'notice notice-warn' },
    `เลขที่ ${studentNo} ตรวจไปแล้ว ได้ ${existing} คะแนน ถ้าบันทึกจะแทนที่ผลเดิม`) : '', sheetWrap || '', pendingSlot, gridSlot);

  function render() {
    const g = OMR.grade(exam.key, state, exam.questionCount, exam.multiAnswer);
    clear(scoreBox).append(
      h('div', { class: 'score-who' }, `เลขที่ ${studentNo}`),
      h('div', { class: 'score-num' },
        h('span', { class: 'score-big' }, String(g.correct)),
        h('span', { class: 'score-of' }, `/${g.total}`)),
      h('div', { class: g.pending ? 'score-note pending' : 'score-note ready' },
        g.pending ? `คะแนนชั่วคราว ข้อที่ต้องยืนยันยังนับเป็นศูนย์ (${g.pending} ข้อ)` : 'ยืนยันครบแล้ว พร้อมบันทึก'));
    if (image) drawSheet(canvas, image, geom, exam.template, { count: exam.questionCount, key: exam.key, items: state, mode: 'review', multi: exam.multiAnswer });
    clear(pendingSlot);
    const pl = pendingList(state, exam.questionCount, () => {
      update(state.map((it, i) => (i < exam.questionCount && it.flag === 'blank' && !it.resolved
        ? Object.assign({}, it, { resolved: true }) : it)));
    });
    if (pl) pendingSlot.appendChild(pl);
    clear(gridSlot).appendChild(answerGrid({
      template: exam.template, count: exam.questionCount, mode: 'review', key: exam.key, items: state,
      multi: exam.multiAnswer, onChange: update,
    }));
  }

  function update(next) {
    state = next;
    render();
    if (onChange) onChange(state);
  }

  render();
  return {
    el,
    get items() { return state; },
    pending: () => pendingQuestions(state, exam.questionCount),
  };
}
