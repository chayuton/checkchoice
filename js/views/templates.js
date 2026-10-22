// แบบฟอร์มกระดาษคำตอบ: รายการ, เพิ่ม/แก้ไข (ตรวจหาโครงตารางจากรูปกระดาษเปล่า), รายละเอียด และพิมพ์กระดาษเปล่า
import { h, clear, icon, toast, confirmDialog, plural, formatDate } from '../ui.js';
import { appBar, go, setLeaveGuard } from '../nav.js';
import {
  listTemplates, getTemplate, saveTemplate, deleteTemplate, templateUsage, templateSummary, putBlob, getBlob,
} from '../store.js';
import { drawTemplateMap, uniformGrid, templateThumb } from '../template-draw.js';
import { pickImage, fileToCanvas, canvasImageData, canvasToBlob } from '../capture.js';
import { displayToCanvas, blobToImage } from '../overlay.js';
import { initOMR, inferTemplate } from '../omr/client.js';

const OMR = self.OMRCore;

// ---------------------------------------------------------------------------
// รายการแบบฟอร์ม
// ---------------------------------------------------------------------------
export async function templatesView(root) {
  const templates = await listTemplates();
  root.append(appBar({ title: 'แบบฟอร์มกระดาษคำตอบ', back: '#/' }));
  const main = h('main', { class: 'page' });
  root.append(main);
  main.append(
    h('p', { class: 'section-help lead' }, 'แบบฟอร์มคือโครงตารางของกระดาษคำตอบ ถ้ากระดาษที่ใช้มีข้อมากกว่านี้ หรือจัดช่องต่างไป ให้เพิ่มแบบฟอร์มจากรูปกระดาษเปล่า แอปจะนับแถวและคอลัมน์ให้เอง'),
    h('div', { class: 'btn-row' }, h('a', { class: 'btn btn-primary', href: '#/templates/new', id: 'btn-new-template' }, icon('plus'), 'เพิ่มแบบฟอร์มใหม่')));

  const section = (title, list) => h('section', { class: 'course' },
    h('h2', { class: 'course-title' }, title),
    h('ul', { class: 'tpl-list' }, list.map((t) => h('li', null,
      h('a', { class: 'tpl-item', href: `#/templates/${t.id}` },
        templateThumb(t, 120, 84),
        h('span', { class: 'tpl-text' },
          h('span', { class: 'tpl-name' }, t.name),
          h('span', { class: 'tpl-meta' }, templateSummary(t)),
          t.custom ? h('span', { class: 'tpl-date' }, `เพิ่มเมื่อ ${formatDate(t.createdAt)}`) : null))))));

  main.append(section('แบบสำเร็จรูป', templates.filter((t) => !t.custom)));
  const custom = templates.filter((t) => t.custom);
  if (custom.length) main.append(section('แบบที่เพิ่มเอง', custom));
}

// ---------------------------------------------------------------------------
// รายละเอียดแบบฟอร์ม
// ---------------------------------------------------------------------------
export async function templateDetailView(root, id) {
  const t = await getTemplate(id);
  if (!t) { root.append(appBar({ title: 'ไม่พบแบบฟอร์ม', back: '#/templates' })); return; }
  const used = await templateUsage(id);
  root.append(appBar({ title: t.name, back: '#/templates' }));
  const main = h('main', { class: 'page' });
  root.append(main);

  const { cols, rows } = OMR.gridShape(t);
  main.append(h('section', { class: 'form-section' },
    h('dl', { class: 'import-facts facts-4' },
      h('div', null, h('dt', null, 'จำนวนข้อ'), h('dd', null, String(OMR.questionCount(t)))),
      h('div', null, h('dt', null, 'ชุด × ข้อ'), h('dd', null, `${t.blocks} × ${t.rowsPerBlock}`)),
      h('div', null, h('dt', null, 'ตัวเลือก'), h('dd', null, `${t.choiceLabels[0]}–${t.choiceLabels[t.choices - 1]}`)),
      h('div', null, h('dt', null, 'ตาราง'), h('dd', null, `${cols}×${rows}`))),
    h('p', { class: 'section-help' },
      `แถวหัวตาราง ${t.headerRows} แถว, ${t.numberColumn ? 'มีคอลัมน์เลขข้อทุกชุด' : 'ไม่มีคอลัมน์เลขข้อ'}, เลขข้อ${t.order === 'across' ? 'เรียงตามแถว' : 'เรียงลงตามคอลัมน์'}`
      + (t.custom ? (used ? `, ใช้อยู่ใน ${plural(used, 'ชุดข้อสอบ')}` : ', ยังไม่มีชุดข้อสอบที่ใช้') : ''))));

  const fig = h('figure', { class: 'sheet-figure' });
  main.append(fig);
  const canvas = h('canvas', { class: 'sheet-canvas', role: 'img', 'aria-label': 'ผังแบบฟอร์ม' });
  fig.append(canvas, h('figcaption', { class: 'legend' }, 'ช่องสีฟ้าคือคอลัมน์เลขข้อ ตัวเลขคือเลขข้อที่แอปจะอ่าน'));
  const sample = t.custom && t.hasSample ? await getBlob(`tpl:${t.id}:blank`) : null;
  if (sample && t.sampleGeom) {
    const img = await blobToImage(sample);
    const s = t.sampleGeom.scale;
    drawTemplateMap(canvas, t, { image: img, xs: t.sampleGeom.xs.map((x) => x * s), ys: t.sampleGeom.ys.map((y) => y * s), width: img.width, height: img.height });
  } else {
    const W = 1100, H = Math.round(1100 / t.aspect);
    const g = uniformGrid(t, W, H, 8);
    drawTemplateMap(canvas, t, { xs: g.xs, ys: g.ys, width: W, height: H });
  }

  main.append(h('div', { class: 'btn-row' },
    h('a', { class: 'btn btn-primary', href: `#/exam/new/${t.id}`, id: 'btn-use-template' }, icon('plus'), 'สร้างเฉลยด้วยแบบฟอร์มนี้'),
    h('a', { class: 'btn btn-quiet', href: `#/templates/${t.id}/print` }, icon('printer'), 'พิมพ์กระดาษคำตอบเปล่า'),
    t.custom ? h('a', { class: 'btn btn-quiet', href: `#/templates/${t.id}/edit` }, icon('edit'), 'แก้ไข') : null));

  if (t.custom) {
    main.append(h('section', { class: 'form-section danger-zone' },
      h('h2', { class: 'section-title' }, 'ลบแบบฟอร์ม'),
      h('p', { class: 'section-help' }, used
        ? `มี ${plural(used, 'ชุดข้อสอบ')}ใช้แบบฟอร์มนี้อยู่ ชุดข้อสอบเหล่านั้นยังตรวจได้ตามเดิม เพราะเก็บโครงตารางไว้ในตัวเองแล้ว`
        : 'ยังไม่มีชุดข้อสอบใช้แบบฟอร์มนี้'),
      h('button', { type: 'button', class: 'btn btn-danger', onclick: async () => {
        if (!(await confirmDialog(`ลบแบบฟอร์ม "${t.name}"`, { okText: 'ลบแบบฟอร์ม', danger: true }))) return;
        await deleteTemplate(t.id);
        toast('ลบแบบฟอร์มแล้ว');
        go('#/templates');
      } }, icon('trash'), 'ลบแบบฟอร์ม')));
  }
}

// ---------------------------------------------------------------------------
// เพิ่ม/แก้ไขแบบฟอร์ม
// ---------------------------------------------------------------------------
export async function templateEditView(root, id) {
  const existing = id ? await getTemplate(id) : null;
  if (id && (!existing || !existing.custom)) { go('#/templates'); return; }
  const t = existing ? Object.assign({}, existing) : OMR.normalizeTemplate({ blocks: 5, rowsPerBlock: 20, choices: 5, headerRows: 2, numberColumn: true });
  let nameTouched = !!existing;
  let inferred = existing && existing.sampleGeom ? { grid: { cols: existing.sampleGeom.xs.length - 1, rows: existing.sampleGeom.ys.length - 1 }, geom: existing.sampleGeom } : null;
  let photo = null;          // ภาพตารางดัดตรง (canvas) สำหรับวาดผัง
  let photoChanged = false;
  let dirty = false;
  initOMR().catch(() => {});

  setLeaveGuard(() => (dirty ? confirmDialog('ยังไม่ได้บันทึกแบบฟอร์ม ต้องการออกจากหน้านี้หรือไม่', { okText: 'ออกโดยไม่บันทึก', danger: true }) : true));

  root.append(appBar({ title: existing ? 'แก้ไขแบบฟอร์ม' : 'เพิ่มแบบฟอร์มใหม่', back: existing ? `#/templates/${id}` : '#/templates' }));
  const main = h('main', { class: 'page page-form' });
  root.append(main);

  // ---------------------------------------------------------------- จากรูป
  const status = h('p', { class: 'key-status', role: 'status', 'aria-live': 'polite' });
  const btnShoot = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => fromPhoto(true) }, icon('camera'), 'ถ่ายรูปกระดาษเปล่า');
  const btnPick = h('button', { type: 'button', class: 'btn btn-quiet', id: 'btn-pick-blank', onclick: () => fromPhoto(false) }, icon('image'), 'เลือกรูปจากเครื่อง');
  main.append(h('section', { class: 'form-section' },
    h('h2', { class: 'section-title' }, '1. รูปกระดาษคำตอบเปล่า'),
    h('p', { class: 'section-help' }, 'ถ่ายกระดาษที่ยังไม่ได้กากบาท ให้เห็นตารางครบทั้ง 4 มุม และหัวตาราง (A B C …) อยู่ด้านบน แอปจะนับชุด ข้อ และตัวเลือกให้ ถ้าไม่มีรูปจะกรอกตัวเลขเองในข้อ 2 ก็ได้'),
    h('div', { class: 'btn-row' }, btnShoot, btnPick), status));

  // ---------------------------------------------------------------- ตัวเลข
  const num = (key, label, lo, hi, hint) => {
    const input = h('input', { class: 'input input-num', type: 'number', inputmode: 'numeric', min: lo, max: hi, value: String(t[key]), id: `t-${key}` });
    input.addEventListener('input', () => {
      const v = Math.round(Number(input.value));
      if (Number.isFinite(v) && v >= lo && v <= hi) { t[key] = v; changed(); }
    });
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('span', { class: 'field-hint' }, hint) : null);
  };
  const fName = h('input', { class: 'input', id: 't-name', value: t.name, maxlength: 80 });
  fName.addEventListener('input', () => { nameTouched = true; t.name = fName.value; dirty = true; });
  const fNumber = h('input', { type: 'checkbox', id: 't-numberColumn', checked: t.numberColumn });
  fNumber.addEventListener('change', () => { t.numberColumn = fNumber.checked; changed(); });
  const fOrder = h('select', { class: 'input', id: 't-order' },
    h('option', { value: 'down', selected: t.order !== 'across' }, 'เรียงลงตามคอลัมน์ทีละชุด'),
    h('option', { value: 'across', selected: t.order === 'across' }, 'เรียงไปทางขวาทีละแถว'));
  fOrder.addEventListener('change', () => { t.order = fOrder.value; changed(); });
  const summary = h('p', { class: 'key-summary' });
  const mismatch = h('p', { class: 'notice notice-warn', hidden: true });

  main.append(h('section', { class: 'form-section' },
    h('h2', { class: 'section-title' }, '2. โครงสร้างแบบฟอร์ม'),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'ชื่อแบบฟอร์ม'), fName),
    h('div', { class: 'field-row' },
      num('blocks', 'จำนวนชุด (คอลัมน์ใหญ่)', ...OMR.LIMITS.blocks),
      num('rowsPerBlock', 'จำนวนข้อต่อชุด', ...OMR.LIMITS.rowsPerBlock)),
    h('div', { class: 'field-row' },
      num('choices', 'ตัวเลือกต่อข้อ', ...OMR.LIMITS.choices, 'เช่น 4 = A–D, 5 = A–E'),
      num('headerRows', 'แถวหัวตาราง', ...OMR.LIMITS.headerRows, 'แถว A–E และ ก–จ นับเป็น 2 แถว')),
    h('label', { class: 'switch field' }, fNumber, h('span', null, 'มีคอลัมน์ "ข้อ" อยู่ซ้ายสุดของทุกชุด')),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'ลำดับเลขข้อ'), fOrder),
    summary, mismatch));

  // ---------------------------------------------------------------- ผัง
  const canvas = h('canvas', { class: 'sheet-canvas', id: 'tpl-preview', role: 'img', 'aria-label': 'ผังแบบฟอร์มทับบนรูป' });
  main.append(h('section', { class: 'form-section' },
    h('h2', { class: 'section-title' }, '3. ตรวจผัง'),
    h('p', { class: 'section-help' }, 'เลขสีน้ำเงินคือเลขข้อที่แอปจะอ่าน ต้องตรงกับเลขข้อที่พิมพ์บนกระดาษ ถ้าไม่ตรงให้แก้ตัวเลขในข้อ 2'),
    h('figure', { class: 'sheet-figure' }, canvas)));

  const btnSave = h('button', { type: 'button', class: 'btn btn-primary btn-large', id: 'btn-save-template', onclick: save }, icon('check'), 'บันทึกแบบฟอร์ม');
  root.append(h('div', { class: 'action-bar' }, btnSave));

  function changed() {
    dirty = true;
    if (!nameTouched) { t.name = OMR.defaultName(t); fName.value = t.name; }
    render();
  }

  function render() {
    const errs = OMR.validateTemplate(t);
    const { cols, rows } = OMR.gridShape(t);
    summary.textContent = errs.length ? errs.join(' ') : `รวม ${OMR.questionCount(t)} ข้อ ตาราง ${cols} คอลัมน์ × ${rows} แถว`;
    summary.className = errs.length ? 'key-summary warn' : 'key-summary';
    btnSave.disabled = errs.length > 0;
    let drawn = false;
    if (photo && inferred) {
      const s = inferred.geom.scale;
      drawn = drawTemplateMap(canvas, t, { image: photo, xs: inferred.geom.xs.map((x) => x * s), ys: inferred.geom.ys.map((y) => y * s), width: photo.width, height: photo.height });
      mismatch.hidden = drawn;
      mismatch.textContent = `จำนวนช่องไม่ตรงกับเส้นที่พบในรูป (พบ ${inferred.grid.cols} คอลัมน์ × ${inferred.grid.rows} แถว แต่แบบฟอร์มนี้มี ${cols} × ${rows})`;
    }
    if (!drawn) {
      const W = 1100, H = Math.round(1100 / (t.aspect || OMR.sheetLayout(t).aspect));
      const g = uniformGrid(t, W, H, 8);
      drawTemplateMap(canvas, t, { xs: g.xs, ys: g.ys, width: W, height: H });
    }
  }

  async function fromPhoto(capture) {
    const file = await pickImage({ capture });
    if (!file) return;
    btnShoot.disabled = btnPick.disabled = true;
    status.className = 'key-status busy';
    status.textContent = 'กำลังนับแถวและคอลัมน์… (ครั้งแรกต้องโหลดตัวอ่านภาพ อาจใช้เวลาสักครู่)';
    try {
      const c = await fileToCanvas(file);
      const res = await inferTemplate(canvasImageData(c));
      if (!res.ok) throw new Error(res.error === 'not_found'
        ? 'หาตารางในรูปไม่พบ ถ่ายให้เห็นตารางครบทั้ง 4 มุมและให้ตารางเต็มภาพมากที่สุด'
        : 'พบกรอบตารางแต่นับเส้นไม่ได้ ลองถ่ายใหม่ให้ตรงและชัดขึ้น');
      photo = displayToCanvas(res.display);
      photoChanged = true;
      inferred = { grid: res.grid, geom: { xs: res.grid.xs, ys: res.grid.ys, scale: res.display.scale } };
      Object.assign(t, res.template);
      for (const k of ['blocks', 'rowsPerBlock', 'choices', 'headerRows']) document.getElementById(`t-${k}`).value = String(t[k]);
      fNumber.checked = t.numberColumn;
      fOrder.value = t.order;
      status.className = res.warnings.length ? 'key-status error' : 'key-status ok';
      status.textContent = res.warnings.length
        ? res.warnings.join(' ')
        : `พบตาราง ${res.grid.cols} คอลัมน์ × ${res.grid.rows} แถว: ${t.blocks} ชุด ชุดละ ${t.rowsPerBlock} ข้อ ตัวเลือก ${t.choices} ตัว ตรวจผังในข้อ 3 ว่าเลขข้อตรงกับกระดาษ`;
      changed();
      canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      status.className = 'key-status error';
      status.textContent = err.message || String(err);
    } finally {
      btnShoot.disabled = btnPick.disabled = false;
    }
  }

  async function save() {
    if (OMR.validateTemplate(t).length) return;
    btnSave.disabled = true;
    try {
      const rec = Object.assign({}, t);
      if (photoChanged && inferred) {
        rec.aspect = inferred.grid.W / inferred.grid.H;
        rec.sampleGeom = inferred.geom;
        rec.hasSample = true;
      }
      const saved = await saveTemplate(rec);
      if (photoChanged && photo) await putBlob(`tpl:${saved.id}:blank`, await canvasToBlob(photo, 'image/jpeg', 0.85));
      dirty = false;
      setLeaveGuard(null);
      toast('บันทึกแบบฟอร์มแล้ว', 'ok');
      go(`#/templates/${saved.id}`);
    } catch (err) {
      toast(`บันทึกไม่สำเร็จ: ${err.message || err}`, 'error');
      btnSave.disabled = false;
    }
  }

  if (existing && existing.hasSample && existing.sampleGeom) {
    const b = await getBlob(`tpl:${existing.id}:blank`);
    if (b) photo = await blobToImage(b);
  }
  render();
}

// ---------------------------------------------------------------------------
// พิมพ์กระดาษคำตอบเปล่า (ขนาดช่องคงที่ อ่านด้วยแอปได้แม่น)
// ---------------------------------------------------------------------------
export async function templatePrintView(root, id) {
  const t = await getTemplate(id);
  if (!t) { go('#/templates'); return; }
  const L = OMR.sheetLayout(t);
  const { cols, rows } = OMR.gridShape(t);
  const per = t.choices + (t.numberColumn ? 1 : 0);
  document.body.classList.add('printing');
  const pageStyle = h('style', null, `@page { size: A4 ${L.orientation}; margin: 10mm; }`);
  document.head.appendChild(pageStyle);

  const table = h('table', { class: 'answer-sheet', style: { width: `${L.tableW}mm` } });
  const colgroup = h('colgroup', null, Array.from({ length: cols }, () => h('col', { style: { width: `${L.cellW}mm` } })));
  const tbody = h('tbody');
  for (let r = 0; r < rows; r++) {
    const tr = h('tr', { style: { height: `${L.cellH}mm` } });
    for (let c = 0; c < cols; c++) {
      const b = Math.floor(c / per);
      const k = c % per - (t.numberColumn ? 1 : 0);
      let text = '';
      let cls = '';
      if (r < t.headerRows) {
        cls = 'hd';
        if (k < 0) text = r === 0 ? 'ข้อ' : '';
        else text = r === 0 ? t.choiceLabels[k] : (r === 1 ? t.thaiLabels[k] : '');
      } else if (k < 0) {
        cls = 'no';
        const rr = r - t.headerRows;
        text = String(t.order === 'across' ? rr * t.blocks + b + 1 : b * t.rowsPerBlock + rr + 1);
      }
      tr.append(h('td', { class: cls }, text));
    }
    tbody.append(tr);
  }
  table.append(colgroup, tbody);

  const sheet = h('article', { class: `sheet-print sheet-${L.orientation}` },
    h('h1', null, `กระดาษคำตอบปรนัย ${OMR.questionCount(t)} ข้อ`),
    h('div', { class: 'sheet-fields' },
      h('span', null, 'ชื่อ - นามสกุล ', h('i', { class: 'dots w60' })),
      h('span', null, 'เลขที่ ', h('i', { class: 'dots w15' }))),
    h('div', { class: 'sheet-fields' },
      h('span', null, 'รายวิชา ', h('i', { class: 'dots w40' })),
      h('span', null, 'สอบวันที่ ', h('i', { class: 'dots w25' }))),
    table,
    h('p', { class: 'sheet-note' }, 'กากบาท (X) ในช่องที่เลือกด้วยปากกาสีเข้ม ถ้าต้องการเปลี่ยนคำตอบ ให้ระบายช่องเดิมให้ทึบแล้วกากบาทช่องใหม่'));
  const stage = h('div', { class: 'sheet-stage' }, sheet);

  root.append(
    h('div', { class: 'print-tools no-print' },
      h('a', { class: 'btn btn-quiet', href: `#/templates/${id}` }, icon('back'), 'กลับ'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => window.print() }, icon('printer'), 'พิมพ์ / บันทึกเป็น PDF'),
      h('p', { class: 'hint' }, `กระดาษ A4 แนว${L.orientation === 'landscape' ? 'นอน' : 'ตั้ง'} ตั้งค่าการพิมพ์เป็นขนาดจริง (100%) ไม่ย่อให้พอดีหน้า`)),
    stage);

  // ตัวอย่างบนจอย่อให้พอดีความกว้าง (ตอนพิมพ์ใช้ขนาดจริงเสมอ ดู @media print ใน app.css)
  const printMQ = window.matchMedia ? window.matchMedia('print') : null;
  const fit = () => {
    if (printMQ && printMQ.matches) return;
    sheet.style.zoom = '';
    const natural = sheet.offsetWidth;
    const avail = stage.clientWidth;
    // เผื่อ 4px เพราะเส้นขอบไม่ย่อตาม zoom (อย่างน้อย 1 พิกเซลจอ)
    if (natural > avail && avail > 4) sheet.style.zoom = String(Math.floor(((avail - 4) / natural) * 1000) / 1000);
  };
  const refit = () => requestAnimationFrame(fit);
  fit();
  window.addEventListener('resize', refit);
  window.addEventListener('afterprint', refit);
  if (printMQ && printMQ.addEventListener) printMQ.addEventListener('change', refit);
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', refit);

  return () => {
    window.removeEventListener('resize', refit);
    window.removeEventListener('afterprint', refit);
    if (printMQ && printMQ.removeEventListener) printMQ.removeEventListener('change', refit);
    if (document.fonts && document.fonts.removeEventListener) document.fonts.removeEventListener('loadingdone', refit);
    document.body.classList.remove('printing');
    pageStyle.remove();
  };
}
