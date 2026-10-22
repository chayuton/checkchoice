// ตรวจกระดาษคำตอบ: เลือกเลขที่ ถ่ายรูปหรือใช้กล้องสด ตรวจทาน ยืนยัน และบันทึก
import { h, clear, icon, toast, confirmDialog, numberDialog } from '../ui.js';
import { appBar, setLeaveGuard } from '../nav.js';
import {
  getExam, saveExam, listResults, saveResult, scoreOf, examTitle, itemsFromDecisions,
} from '../store.js';
import { reviewPanel } from '../review-panel.js';
import { displayToCanvas } from '../overlay.js';
import { pickImage, fileToCanvas, canvasImageData, canvasToBlob, LiveCamera } from '../capture.js';
import { initOMR, readSheet, omrEngine, workLongSide } from '../omr/client.js';
import { requestPersistence, platform } from '../pwa.js';
import { transferButton } from '../transfer-ui.js';
import { capabilities } from '../env.js';

export function errorMessage(res) {
  if (res.error === 'not_found') return 'หาตารางคำตอบไม่พบ ถ่ายให้เห็นตารางครบทั้ง 4 มุม ให้ตารางเต็มภาพมากที่สุด และวางกระดาษบนพื้นเรียบ';
  if (res.error === 'grid') return 'พบกรอบตารางแต่แบ่งช่องไม่ได้ ลองถ่ายใหม่ให้ตรงขึ้น ไม่ให้มีเงาหรือนิ้วบังเส้นตาราง';
  if (res.error === 'opencv') {
    if (/WebAssembly/.test(res.message || '')) return res.message;
    return `โหลดตัวอ่านภาพไม่สำเร็จ ตรวจการเชื่อมต่ออินเทอร์เน็ตแล้วลองอีกครั้ง (${res.message || ''})`;
  }
  return `อ่านภาพไม่สำเร็จ: ${res.message || res.error || 'ไม่ทราบสาเหตุ'}`;
}

function loadPref(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
function savePref(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

export async function scanView(root, id) {
  const exam = await getExam(id);
  if (!exam) {
    root.append(appBar({ title: 'ไม่พบชุดข้อสอบ', back: '#/' }));
    return;
  }
  const results = new Map((await listResults(id)).map((r) => [r.studentNo, r]));
  const t = examTitle(exam);
  const keyCount = exam.key.slice(0, exam.questionCount).filter((v) => v != null).length;

  // กล้องสดต้องใช้ getUserMedia และตัวอ่านภาพที่เร็วพอ (โหมดล็อกดาวน์ของ iPhone ปิดทั้งสองอย่าง)
  const liveOk = LiveCamera.supported() && capabilities().wasm;
  let mode = liveOk ? loadPref('cc.mode', 'photo') : 'photo';
  let autoCapture = loadPref('cc.auto', '1') === '1';
  let current = null;   // ผลที่รอตรวจทาน { no, panel, display, geom }
  let camera = null;
  let busy = false;
  let saving = false;   // กำลังบันทึก: ออกจากหน้าได้ การบันทึกจะทำต่อจนเสร็จ
  let alive = true;     // หน้านี้ยังแสดงอยู่ (ถ้าออกไปแล้วไม่ต้องอัปเดตหน้าจอหรือเปิดกล้อง)

  const nextUnscanned = (from) => {
    for (let n = from; n <= exam.maxStudentNo; n++) if (!results.has(n)) return n;
    for (let n = 1; n < from; n++) if (!results.has(n)) return n;
    return Math.min(from, exam.maxStudentNo);
  };
  let selectedNo = nextUnscanned(1);

  setLeaveGuard(() => (current && !saving ? confirmDialog(`ผลตรวจเลขที่ ${current.no} ยังไม่ได้บันทึก ต้องการทิ้งผลนี้หรือไม่`, {
    okText: 'ทิ้งผลนี้', danger: true,
  }) : true));

  root.append(appBar({
    title: t.exam, subtitle: t.course, back: '#/',
    actions: [h('a', { class: 'icon-btn', href: `#/exam/${id}/results`, 'aria-label': 'ผลคะแนน' }, icon('table'))],
  }));
  const main = h('main', { class: 'page page-scan' });
  root.append(main);

  if (!keyCount) {
    main.append(h('p', { class: 'notice notice-error' }, 'ชุดข้อสอบนี้ยังไม่มีเฉลย ',
      h('a', { href: `#/exam/${id}` }, 'กำหนดเฉลยก่อน')));
  } else if (platform() === 'desktop') {
    main.append(h('div', { class: 'notice desktop-hint' },
      h('p', null, 'ตรวจด้วยมือถือสะดวกกว่า ส่งชุดข้อสอบนี้ไปมือถือด้วย QR code แล้วถ่ายกระดาษจากมือถือได้เลย'),
      transferButton(exam, 'btn btn-quiet btn-small')));
  }

  // ---------------------------------------------------------------- เลขที่
  const noSelect = h('select', { class: 'input no-select', id: 'student-no', 'aria-label': 'เลขที่นักศึกษา' });
  const progress = h('span', { class: 'progress-text' });
  function renderNoOptions() {
    clear(noSelect);
    for (let n = 1; n <= exam.maxStudentNo; n++) {
      const r = results.get(n);
      const label = r ? `${n}  ✓ ${scoreOf(exam, r).correct} คะแนน` : String(n);
      noSelect.append(h('option', { value: String(n), selected: n === selectedNo }, label));
    }
    progress.textContent = `ตรวจแล้ว ${results.size} คน`;
  }
  noSelect.addEventListener('change', () => {
    selectedNo = Number(noSelect.value);
    if (current) { current.no = selectedNo; showReview(); }
    else if (mode === 'photo') renderCapture();
  });
  const addNo = h('button', { type: 'button', class: 'icon-btn icon-btn-outline', 'aria-label': 'เพิ่มจำนวนเลขที่', onclick: async () => {
    const n = await numberDialog('เพิ่มเลขที่ให้ถึงเลขที่', {
      title: 'เพิ่มจำนวนเลขที่', value: exam.maxStudentNo + 10, min: exam.maxStudentNo + 1, max: 999, okText: 'เพิ่ม',
    });
    if (!n) return;
    const first = exam.maxStudentNo + 1;
    exam.maxStudentNo = n;
    await saveExam(exam);
    selectedNo = first;
    renderNoOptions();
    toast(`เพิ่มเลขที่ถึง ${n} แล้ว`);
  } }, icon('plus'));
  renderNoOptions();

  main.append(h('div', { class: 'no-bar' },
    h('label', { class: 'no-label', for: 'student-no' }, 'เลขที่'),
    noSelect, addNo, progress));

  // ---------------------------------------------------------------- โหมดรับภาพ
  const modeTabs = h('div', { class: 'segmented', role: 'tablist', 'aria-label': 'วิธีรับภาพ' });
  const captureArea = h('div', { class: 'capture-area' });
  const reviewArea = h('div', { class: 'review-area' });
  const status = h('p', { class: 'scan-status', role: 'status', 'aria-live': 'polite' });
  main.append(modeTabs, status, captureArea, reviewArea);

  const actionBar = h('div', { class: 'action-bar', hidden: true });
  root.append(actionBar);

  function setStatus(text, kind = '') {
    status.textContent = text || '';
    status.className = `scan-status ${kind}`;
  }

  function renderTabs() {
    modeTabs.hidden = !liveOk;
    if (!liveOk) { clear(modeTabs); return; }
    clear(modeTabs).append(
      h('button', { type: 'button', role: 'tab', 'aria-selected': mode === 'photo' ? 'true' : 'false', class: mode === 'photo' ? 'on' : '',
        onclick: () => switchMode('photo') }, icon('camera'), 'ถ่ายรูป'),
      h('button', { type: 'button', role: 'tab', 'aria-selected': mode === 'live' ? 'true' : 'false', class: mode === 'live' ? 'on' : '',
        onclick: () => switchMode('live') }, icon('video'), 'กล้องสด'));
  }

  function switchMode(m) {
    if (busy) return;
    mode = m;
    savePref('cc.mode', m);
    renderTabs();
    renderCapture();
  }

  function stopCamera() {
    if (camera) { camera.stop(); camera = null; }
  }

  function renderCapture() {
    stopCamera();
    clear(captureArea);
    captureArea.hidden = !!current;
    if (current) return;
    if (mode === 'photo') {
      captureArea.append(h('div', { class: 'photo-box' },
        h('button', { type: 'button', class: 'btn btn-primary btn-large', id: 'btn-shoot', onclick: () => fromFile(true) },
          icon('camera'), `ถ่ายรูปเลขที่ ${selectedNo}`),
        h('button', { type: 'button', class: 'btn btn-quiet', id: 'btn-pick', onclick: () => fromFile(false) },
          icon('image'), 'เลือกรูปจากเครื่อง'),
        h('p', { class: 'hint' }, 'ถ่ายให้เห็นตารางครบทั้ง 4 มุม ถือกล้องขนานกับกระดาษ และไม่ให้มีเงาบัง')));
      setStatus('');
      return;
    }
    // กล้องสด
    const video = h('video', { class: 'live-video', playsinline: true, muted: true, autoplay: true });
    const overlay = h('canvas', { class: 'live-overlay' });
    const pill = h('div', { class: 'live-pill' }, 'กำลังเปิดกล้อง…');
    const autoBox = h('input', { type: 'checkbox', checked: autoCapture, id: 'auto-capture', onchange: (e) => {
      autoCapture = e.target.checked;
      savePref('cc.auto', autoCapture ? '1' : '0');
      if (camera) camera.autoCapture = autoCapture;
    } });
    const shutter = h('button', { type: 'button', class: 'shutter', 'aria-label': 'ถ่ายภาพ', onclick: () => camera && camera.capture() });
    const torchBtn = h('button', { type: 'button', class: 'icon-btn icon-btn-outline', hidden: true, 'aria-label': 'ไฟฉาย', 'aria-pressed': 'false',
      onclick: async () => {
        const on = torchBtn.getAttribute('aria-pressed') !== 'true';
        try { await camera.setTorch(on); torchBtn.setAttribute('aria-pressed', on ? 'true' : 'false'); } catch (e) { /* ignore */ }
      } }, icon('flash'));
    captureArea.append(
      h('div', { class: 'live-box' }, video, overlay, pill),
      h('div', { class: 'live-controls' },
        h('label', { class: 'switch' }, autoBox, h('span', null, 'ถ่ายอัตโนมัติเมื่อภาพนิ่ง')),
        shutter, torchBtn));
    const texts = {
      search: 'เล็งกล้องให้เห็นตารางทั้งหมด',
      hold: 'จับตารางได้แล้ว ถือนิ่ง ๆ',
      ready: 'ภาพนิ่งแล้ว กดปุ่มถ่าย',
      capturing: 'กำลังถ่าย…',
    };
    camera = new LiveCamera(video, overlay, {
      template: exam.template,
      autoCapture,
      onStatus: (s) => { pill.textContent = texts[s] || ''; pill.dataset.state = s; },
      onCapture: (canvas) => process(canvas),
    });
    camera.start().then(() => {
      if (camera && camera.torchSupported) torchBtn.hidden = false;
    }).catch((err) => {
      pill.textContent = 'เปิดกล้องไม่ได้';
      setStatus(err && err.name === 'NotAllowedError'
        ? 'ไม่ได้รับอนุญาตให้ใช้กล้อง เปิดสิทธิ์กล้องให้เว็บนี้ในการตั้งค่าเบราว์เซอร์ หรือใช้โหมดถ่ายรูป'
        : `เปิดกล้องไม่ได้: ${(err && err.message) || err} ใช้โหมดถ่ายรูปแทนได้`, 'error');
    });
  }

  async function fromFile(capture) {
    const file = await pickImage({ capture });
    if (!file) return;
    try {
      const canvas = await fileToCanvas(file, await workLongSide());
      await process(canvas);
    } catch (err) {
      setStatus(err.message || String(err), 'error');
    }
  }

  async function process(canvas) {
    if (busy) return;
    busy = true;
    const eng = omrEngine();
    setStatus(eng && eng.lite ? 'กำลังอ่านคำตอบ… (ตัวอ่านภาพสำรอง อาจใช้เวลา 10–30 วินาที)' : 'กำลังอ่านคำตอบ…', 'busy');
    captureArea.classList.add('is-busy');
    try {
      const res = await readSheet(canvasImageData(canvas), exam.template);
      if (!res.ok) {
        setStatus(errorMessage(res), 'error');
        if (camera) setTimeout(() => camera && camera.resume(), 1500);
        return;
      }
      current = {
        no: selectedNo,
        display: displayToCanvas(res.display),
        geom: { xs: res.xs, ys: res.ys, scale: res.display.scale },
        items: itemsFromDecisions(res.decisions),
        densities: res.densities.map((row) => row.map((v) => Math.round(v * 10000) / 10000)),
        ms: res.ms,
      };
      setStatus(res.warning === 'orientation'
        ? 'บอกทิศของกระดาษไม่ได้ชัดเจน ตรวจดูภาพว่าหัวตาราง (A–E) อยู่ด้านบน ถ้าไม่ใช่ให้ถ่ายใหม่' : '',
      res.warning ? 'error' : '');
      showReview();
    } catch (err) {
      setStatus(`อ่านภาพไม่สำเร็จ: ${err.message || err}`, 'error');
      if (camera) camera.resume();
    } finally {
      busy = false;
      captureArea.classList.remove('is-busy');
    }
  }

  function showReview() {
    stopCamera();
    captureArea.hidden = true;
    modeTabs.hidden = true;
    const existing = results.get(current.no);
    const panel = reviewPanel({
      exam, items: current.items, image: current.display, geom: current.geom, studentNo: current.no,
      existing: existing ? String(scoreOf(exam, existing).correct) : null,
      onChange: (items) => { current.items = items; renderActions(); },
    });
    current.panel = panel;
    clear(reviewArea).append(panel.el);
    renderActions();
    window.scrollTo({ top: 0 });
  }

  function renderActions() {
    if (!current) { actionBar.hidden = true; return; }
    const pending = current.panel.pending().length;
    actionBar.hidden = false;
    clear(actionBar).append(
      h('button', { type: 'button', class: 'btn btn-quiet', onclick: discard }, 'ถ่ายใหม่'),
      h('button', { type: 'button', class: 'btn btn-primary btn-large', id: 'btn-save', disabled: pending > 0, onclick: save },
        pending ? `ยืนยันอีก ${pending} ข้อ` : [icon('check'), `บันทึกเลขที่ ${current.no}`]));
  }

  async function discard() {
    current = null;
    clear(reviewArea);
    actionBar.hidden = true;
    modeTabs.hidden = !liveOk;
    renderCapture();
  }

  async function save() {
    if (!current || current.panel.pending().length) return;
    const no = current.no;
    const old = results.get(no);
    if (old) {
      const ok = await confirmDialog(`เลขที่ ${no} มีผลตรวจเดิมอยู่แล้ว ต้องการแทนที่ด้วยผลใหม่หรือไม่`, { okText: 'แทนที่ผลเดิม' });
      if (!ok) return;
    }
    const btn = document.getElementById('btn-save');
    if (btn) btn.disabled = true;
    saving = true;
    try {
      const blob = await canvasToBlob(current.display, 'image/jpeg', 0.8);
      const rec = await saveResult({
        examId: exam.id,
        studentNo: no,
        items: current.panel.items,
        geom: current.geom,
        densities: current.densities,       // ค่าหมึกของแต่ละช่อง เก็บไว้เป็นข้อมูลสำหรับ Train
        createdAt: old ? old.createdAt : null,
      }, blob);
      results.set(no, rec);
      requestPersistence();
      const sc = scoreOf(exam, rec);
      toast(`บันทึกเลขที่ ${no} แล้ว ได้ ${sc.correct}/${sc.total} คะแนน`, 'ok');
      current = null;
      if (!alive) return;
      selectedNo = nextUnscanned(no + 1);
      renderNoOptions();
      clear(reviewArea);
      actionBar.hidden = true;
      modeTabs.hidden = !liveOk;
      renderCapture();
    } catch (err) {
      toast(`บันทึกไม่สำเร็จ: ${err.message || err}`, 'error');
      if (btn) btn.disabled = false;
    } finally {
      saving = false;
    }
  }

  renderTabs();
  renderCapture();
  setStatus('กำลังเตรียมตัวอ่านภาพ…', 'busy');
  initOMR().then(() => { if (!busy && !current) setStatus(''); })
    .catch((err) => setStatus(errorMessage({ error: 'opencv', message: err.message }), 'error'));

  return () => { alive = false; stopCamera(); };
}
