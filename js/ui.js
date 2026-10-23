// เครื่องมือสร้างหน้าจอ (ไม่ใช้เฟรมเวิร์ก)
const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden', 'indeterminate']);

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (PROPS.has(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c) el.appendChild(c);
  return el;
}

/** กากบาทแบบลายมือปากกาลูกลื่น (เอียงต่างกันเล็กน้อยตามเลขข้อ) */
export function penX(seed = 0, cls = 'pen-x') {
  const j = (n) => ((Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
  const a = (k) => (j(k) - 0.5) * 3;
  return svg('svg', { class: cls, viewBox: '0 0 24 24', 'aria-hidden': 'true' },
    svg('path', { d: `M${5 + a(1)} ${5 + a(2)} Q12 ${11 + a(3)} ${19 + a(4)} ${19 + a(5)}` }),
    svg('path', { d: `M${19 + a(6)} ${5 + a(7)} Q${12 + a(8)} 12 ${5 + a(9)} ${19 + a(10)}` }));
}

/** ไอคอนเส้นเรียบ ๆ */
const ICONS = {
  back: 'M15 5l-7 7 7 7',
  plus: 'M12 5v14M5 12h14',
  gear: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-1.8 1l-.3 2H11l-.3-2a7 7 0 0 1-1.8-1l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-2.1L5 10.3l2-3.4 1.9.7a7 7 0 0 1 1.8-1l.3-2h4l.3 2a7 7 0 0 1 1.8 1l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 2.1z',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.5h.01',
  video: 'M3 7h12v10H3zM15 10l6-3v10l-6-3',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  close: 'M6 6l12 12M18 6L6 18',
  table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  printer: 'M7 9V4h10v5M7 17H4v-7h16v7h-3M7 14h10v6H7z',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  next: 'M9 5l7 7-7 7',
  flash: 'M13 3L5 14h6l-1 7 8-11h-6z',
  send: 'M4 11.5L20 4l-6.5 16-2.8-6.7zM10.7 13.3L20 4',
  qr: 'M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M7.5 7.5h3.5v3.5H7.5zM13 7.5h3.5v3.5H13zM7.5 13h3.5v3.5H7.5zM14.5 14.5h.01M16.5 16.5h.01M14.5 16.5h.01M16.5 14.5h.01',
};
export function icon(name, cls = 'icon') {
  return svg('svg', { class: cls, viewBox: '0 0 24 24', 'aria-hidden': 'true' },
    svg('path', { d: ICONS[name] || '' }));
}

// ---------------------------------------------------------------------------
// ข้อความแจ้งเตือนสั้น ๆ
// ---------------------------------------------------------------------------
let toastTimer = null;
export function toast(message, kind = 'info') {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(el);
  }
  el.className = `toast toast-${kind} show`;
  el.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), kind === 'error' ? 6000 : 3200);
}

// ---------------------------------------------------------------------------
// กล่องโต้ตอบ
// ---------------------------------------------------------------------------
function openDialog(build) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'dialog' });
    const close = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    append(dlg, [build(close)]);
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    document.body.appendChild(dlg);
    if (dlg.showModal) dlg.showModal();
    else dlg.setAttribute('open', '');
  });
}

/**
 * กล่องยืนยัน details: รายการบรรทัดย่อยใต้ข้อความ, note: ข้อความเพิ่มเติมท้ายกล่อง
 * danger: ปุ่มยืนยันสีแดง และโฟกัสที่ปุ่มยกเลิก (กด Enter โดยไม่ตั้งใจจะไม่ลบ)
 */
export function confirmDialog(message, { title = '', okText = 'ตกลง', cancelText = 'ยกเลิก', danger = false, details = null, note = '' } = {}) {
  return openDialog((close) => h('form', { method: 'dialog', onsubmit: (e) => { e.preventDefault(); close(true); } },
    title ? h('h2', { class: 'dialog-title' }, title) : null,
    h('p', { class: 'dialog-text' }, message),
    details && details.length ? h('ul', { class: 'dialog-details' }, details.map((d) => h('li', null, d))) : null,
    note ? h('p', { class: 'dialog-note' }, note) : null,
    h('div', { class: 'dialog-actions' },
      h('button', { type: 'button', class: 'btn btn-quiet', autofocus: danger, onclick: () => close(false) }, cancelText),
      h('button', { type: 'submit', class: danger ? 'btn btn-danger' : 'btn btn-primary', autofocus: !danger }, okText)),
  )).then((v) => v === true);
}

export function numberDialog(message, { title = '', value = 0, min = 1, max = 9999, okText = 'ตกลง' } = {}) {
  return openDialog((close) => {
    const input = h('input', { type: 'number', inputmode: 'numeric', min, max, value: String(value), class: 'input', required: true,
      oninput: (e) => e.target.setCustomValidity('') });
    return h('form', { onsubmit: (e) => {
      e.preventDefault();
      const n = Math.round(Number(input.value));
      if (!Number.isFinite(n) || n < min || n > max) { input.setCustomValidity(`ใส่ตัวเลข ${min}–${max}`); input.reportValidity(); return; }
      close(n);
    } },
      title ? h('h2', { class: 'dialog-title' }, title) : null,
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, message), input),
      h('div', { class: 'dialog-actions' },
        h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => close(null) }, 'ยกเลิก'),
        h('button', { type: 'submit', class: 'btn btn-primary' }, okText)));
  });
}

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' +
    d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

export function plural(n, unit) {
  return `${n.toLocaleString('th-TH')} ${unit}`;
}

/** ขนาดไฟล์อ่านง่าย เช่น 820 KB, 5.2 MB */
export function formatBytes(n) {
  if (!(n > 0)) return '0 KB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024)).toLocaleString('th-TH')} KB`;
  return `${(n / 1048576).toLocaleString('th-TH', { maximumFractionDigits: 1 })} MB`;
}
