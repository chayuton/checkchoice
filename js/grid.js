// ตารางคำตอบที่หน้าตาเหมือนกระดาษคำตอบจริง ใช้ทั้งแก้เฉลยและตรวจทานคำตอบนักศึกษา
import { h, penX, icon } from './ui.js';

const OMR = self.OMRCore;

/**
 * mode 'key':    แตะช่องเพื่อเลือก/ยกเลิกเฉลย  -> onChange(newKey)
 * mode 'review': แตะช่องเพื่อแก้คำตอบนักศึกษา, ปุ่ม "ยืนยัน" สำหรับข้อที่ติดธง -> onChange(newItems)
 */
export function answerGrid({ template, count, mode, key, items, onChange }) {
  const wrap = h('div', { class: `answer-grid mode-${mode}` });
  wrap.style.setProperty('--choices', String(template.choices));
  const labels = template.choiceLabels;
  const thai = template.thaiLabels || [];
  const per = template.rowsPerBlock;
  const review = mode === 'review';

  for (let start = 1; start <= count; start += per) {
    const end = Math.min(count, start + per - 1);
    const block = h('div', { class: 'grid-block', role: 'group', 'aria-label': `ข้อ ${start}–${end}` });
    const head = h('div', { class: 'grid-row grid-head' },
      h('div', { class: 'cell cell-no' }, 'ข้อ'),
      labels.slice(0, template.choices).map((l, i) => h('div', { class: 'cell cell-head' },
        h('span', { class: 'head-latin' }, l), thai[i] ? h('span', { class: 'head-thai' }, thai[i]) : null)),
      review ? h('div', { class: 'cell cell-status cell-head' }, 'ผล') : null);
    block.appendChild(head);

    for (let q = start; q <= end; q++) {
      const i = q - 1;
      const it = review ? (items[i] || { choice: null, flag: 'blank', resolved: false }) : null;
      const chosen = review ? it.choice : key[i];
      const pending = review && it.flag && !it.resolved;
      const k = key ? key[i] : null;
      const ok = review && !pending && k != null && chosen === k;
      const row = h('div', {
        class: ['grid-row', pending ? 'is-pending' : '', review && !pending ? (ok ? 'is-right' : 'is-wrong') : '',
          review && it.edited ? 'is-edited' : ''].join(' '),
        id: `q-${q}`,
      });
      row.appendChild(h('div', { class: 'cell cell-no' }, String(q)));
      for (let c = 0; c < template.choices; c++) {
        const isSel = chosen === c;
        const isKey = review && k === c;
        const isCancel = review && it.cancelled === c;
        const cls = ['cell', 'cell-choice', isSel ? 'sel' : '', isKey ? 'key' : '', isCancel ? 'cancelled' : ''].join(' ');
        const btn = h('button', {
          type: 'button',
          class: cls,
          'aria-pressed': isSel ? 'true' : 'false',
          'aria-label': `ข้อ ${q} ตัวเลือก ${labels[c]}${isKey ? ' (เฉลย)' : ''}${isCancel ? ' (ระบายยกเลิก)' : ''}`,
          onclick: () => {
            if (review) {
              const next = items.map((x) => Object.assign({}, x));
              const cur = next[i] || { choice: null, flag: 'blank' };
              const same = cur.choice === c && (!cur.flag || cur.resolved);
              next[i] = Object.assign(cur, { choice: same ? null : c, resolved: true, edited: true });
              onChange(next);
            } else {
              const next = key.slice();
              next[i] = next[i] === c ? null : c;
              onChange(next);
            }
          },
        }, isCancel ? h('span', { class: 'scribble', 'aria-hidden': 'true' }) : null, isSel ? penX(q * 7 + c) : null);
        row.appendChild(btn);
      }
      if (review) {
        let status;
        if (pending) {
          status = h('button', {
            type: 'button',
            class: 'cell cell-status confirm',
            title: OMR.FLAG_TEXT[it.flag] || 'ยืนยัน',
            'aria-label': `ยืนยันข้อ ${q} (${OMR.FLAG_TEXT[it.flag] || ''})`,
            onclick: () => {
              const next = items.map((x) => Object.assign({}, x));
              next[i] = Object.assign(next[i], { resolved: true });
              onChange(next);
            },
          }, 'ยืนยัน');
        } else if (k == null) {
          status = h('div', { class: 'cell cell-status muted', title: 'ไม่มีเฉลย' }, '–');
        } else {
          status = h('div', { class: `cell cell-status ${ok ? 'right' : 'wrong'}`, 'aria-label': ok ? 'ถูก' : 'ผิด' },
            icon(ok ? 'check' : 'close', 'icon mark-icon'));
        }
        row.appendChild(status);
      }
      block.appendChild(row);
    }
    wrap.appendChild(block);
  }
  return wrap;
}

/** รายการข้อที่ต้องยืนยัน แตะเพื่อเลื่อนไปที่ข้อนั้น */
export function pendingList(items, count, onBulkBlank) {
  const rows = [];
  let blanks = 0;
  for (let i = 0; i < count; i++) {
    const it = items[i];
    if (it && it.flag && !it.resolved) {
      if (it.flag === 'blank') blanks++;
      rows.push({ q: i + 1, flag: it.flag });
    }
  }
  if (!rows.length) return null;
  const nonBlank = rows.filter((r) => r.flag !== 'blank');
  return h('div', { class: 'pending-box' },
    h('p', { class: 'pending-title' }, `ตรวจเองอีก ${rows.length} ข้อ ก่อนบันทึก`),
    h('div', { class: 'pending-chips' },
      nonBlank.map((r) => h('a', { class: 'chip chip-flag', href: `#q-${r.q}`, onclick: (e) => {
        e.preventDefault();
        const el = document.getElementById(`q-${r.q}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } }, `ข้อ ${r.q} ${OMR.FLAG_TEXT[r.flag]}`)),
      blanks ? h('button', { type: 'button', class: 'chip chip-action', onclick: onBulkBlank },
        `ยืนยันว่าไม่ได้ตอบ ${blanks} ข้อ`) : null));
}
