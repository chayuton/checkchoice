// รับชุดข้อสอบจากเครื่องอื่น: สแกน QR code ด้วยกล้องในแอป ถ่าย/เลือกรูปที่มี QR code หรือวางลิงก์
// ข้อมูลที่ได้ตรวจแบบเดียวกับลิงก์นำเข้า แล้วไปหน้า "รับชุดข้อสอบ" ให้อาจารย์ดูและยืนยันก่อนบันทึก
//
// ทำไมต้องสแกนในแอป: iPhone ที่เพิ่มแอปไว้บนหน้าจอโฮมเก็บข้อมูลแยกจาก Safari ถ้าสแกนด้วยแอปกล้อง
// ลิงก์จะเปิดใน Safari และชุดข้อสอบจะไปอยู่ใน Safari ไม่ใช่ในแอปที่ใช้ตรวจ
import { h, icon } from '../ui.js';
import { appBar, go } from '../nav.js';
import { extractImportPayload, decodeExam } from '../transfer.js';
import { QrScanner, decodeImageFile } from '../qr-scan.js';
import { pickImage } from '../capture.js';
import { examTitle } from '../store.js';

const OMR = self.OMRCore;

const NOT_OURS = {
  qr: 'QR code นี้ไม่ใช่ชุดข้อสอบของ CheckChoice ให้สแกน QR code ที่ขึ้นเมื่อกด "ส่งไปมือถือ / เครื่องอื่น" ที่เครื่องต้นทาง',
  link: 'ข้อความนี้ไม่ใช่ลิงก์ชุดข้อสอบของ CheckChoice (ลิงก์ที่ถูกต้องมี #/import/ อยู่ด้วย) คัดลอกลิงก์จากเครื่องต้นทางมาใหม่',
};

const PILL = {
  starting: 'กำลังเปิดกล้อง…',
  scanning: 'เล็งให้ QR code อยู่ในกรอบ',
  found: 'พบชุดข้อสอบแล้ว',
  error: 'เปิดกล้องไม่ได้',
};

const SLOW_HINT = 'ถ้าสแกนไม่ติด: ขยับเข้าใกล้ให้ QR code เต็มกรอบ เพิ่มความสว่างหน้าจอเครื่องต้นทาง หรือแตะที่ QR code บนเครื่องต้นทางเพื่อขยาย';

/** ตรวจข้อความที่สแกนหรือวางมา คืน { payload, exam } หรือ { error } */
export function checkReceived(text, source = 'qr') {
  const payload = extractImportPayload(text);
  if (!payload) return { error: NOT_OURS[source === 'link' ? 'link' : 'qr'] };
  try {
    return { payload, exam: decodeExam(payload, OMR.TEMPLATES, OMR) };
  } catch (err) {
    // เป็นลิงก์ของแอปแต่ข้อมูลเสียหรือมาจากเวอร์ชันที่ไม่รองรับ: บอกสาเหตุตามจริง
    return { error: /import/i.test(text) ? err.message : NOT_OURS[source === 'link' ? 'link' : 'qr'] };
  }
}

function cameraError(err) {
  const name = err && err.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'ไม่ได้รับอนุญาตให้ใช้กล้อง เปิดสิทธิ์กล้องให้เว็บนี้ในการตั้งค่าเบราว์เซอร์ หรือถ่ายรูป QR code แทน';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') {
    return 'ไม่พบกล้องในเครื่องนี้ ใช้รูปที่มี QR code หรือวางลิงก์แทน';
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return 'กล้องถูกแอปอื่นใช้อยู่ ปิดแอปนั้นแล้วกด "เปิดกล้องอีกครั้ง" หรือถ่ายรูป QR code แทน';
  }
  return `เปิดกล้องไม่ได้: ${(err && err.message) || err} ใช้รูปที่มี QR code หรือวางลิงก์แทน`;
}

export async function receiveView(root) {
  root.append(appBar({ title: 'รับชุดข้อสอบจากเครื่องอื่น', back: '#/' }));
  const main = h('main', { class: 'page page-receive' });
  root.append(main);

  const liveOk = QrScanner.supported();
  let alive = true;       // หน้านี้ยังแสดงอยู่
  let done = false;       // พบชุดข้อสอบแล้ว กำลังไปหน้านำเข้า
  let busy = false;       // กำลังอ่านรูป
  let paused = false;     // ปิดกล้องสดไว้ระหว่างถ่ายรูป QR code
  let failed = false;     // เปิดกล้องไม่ได้ (รอผู้ใช้กดเปิดอีกครั้ง)
  let scanner = null;
  let slowTimer = null;
  let lastBad = { text: null, at: 0 };

  const status = h('p', { class: 'receive-status', id: 'receive-status', role: 'status', 'aria-live': 'polite' });
  const setStatus = (text, kind) => {
    status.textContent = text || '';
    status.className = `receive-status${kind ? ` ${kind}` : ''}`;
  };

  function accept(res) {
    if (done || !alive) return;
    done = true;
    stopScanner();
    box.dataset.state = 'found';
    pill.textContent = PILL.found;
    try { if (navigator.vibrate) navigator.vibrate(60); } catch (e) { /* ignore */ }
    setStatus(`พบชุดข้อสอบ ${examTitle(res.exam).exam} กำลังเปิด…`, 'ok');
    go(`#/import/${res.payload}`);
  }

  /** source: 'live' | 'image' | 'link' */
  function handleText(text, source) {
    const res = checkReceived(text, source === 'link' ? 'link' : 'qr');
    if (res.payload) { accept(res); return; }
    // กล้องเห็น QR อันเดิมซ้ำ ๆ ไม่ต้องแจ้งซ้ำทุกเฟรม
    const now = Date.now();
    if (source === 'live' && lastBad.text === text && now - lastBad.at < 4000) return;
    lastBad = { text, at: now };
    setStatus(res.error, 'error');
  }

  // ---------------------------------------------------------------- กล้องสด
  const video = h('video', { class: 'qr-video', playsinline: true, muted: true, autoplay: true, 'aria-label': 'ภาพจากกล้อง' });
  const pill = h('div', { class: 'live-pill', id: 'qr-pill' }, PILL.starting);
  const box = h('div', { class: 'qr-scan-box', id: 'qr-scan-box' },
    video,
    h('div', { class: 'qr-guide', 'aria-hidden': 'true' },
      ['tl', 'tr', 'bl', 'br'].map((p) => h('span', { class: `qr-corner ${p}` }))),
    pill);
  const btnRetry = h('button', { type: 'button', class: 'btn btn-quiet', id: 'btn-camera-retry', hidden: true, onclick: () => {
    failed = false;
    paused = false;
    setStatus('');
    startScanner();
  } }, icon('camera'), 'เปิดกล้องอีกครั้ง');

  function startScanner() {
    if (!liveOk || !alive || done || busy || paused || failed || scanner || document.hidden) return;
    btnRetry.hidden = true;
    const s = new QrScanner(video, {
      onState: (st) => { box.dataset.state = st; pill.textContent = PILL[st] || ''; },
      onText: (text) => handleText(text, 'live'),
      onError: (err) => scannerFailed(err),
    });
    scanner = s;
    s.start().then(() => {
      clearTimeout(slowTimer);
      slowTimer = setTimeout(() => {
        if (scanner === s && !done && !status.textContent) setStatus(SLOW_HINT);
      }, 15000);
    }).catch((err) => { if (scanner === s) scannerFailed(err); });
  }

  function stopScanner() {
    clearTimeout(slowTimer);
    if (scanner) { scanner.stop(); scanner = null; }
  }

  function scannerFailed(err) {
    stopScanner();
    if (!alive || done) return;
    failed = true;
    box.dataset.state = 'error';
    pill.textContent = PILL.error;
    btnRetry.hidden = false;
    setStatus(err && err.name ? cameraError(err) : ((err && err.message) || String(err)), 'error');
  }

  // แอปถูกพับไว้: ปิดกล้อง (ไฟกล้องจะได้ดับ) แล้วเปิดใหม่เมื่อกลับมา
  const onVisibility = () => {
    if (document.hidden) stopScanner();
    else startScanner();
  };
  document.addEventListener('visibilitychange', onVisibility);

  // ---------------------------------------------------------------- รูปภาพ
  const btnPhoto = h('button', { type: 'button', class: liveOk ? 'btn btn-quiet' : 'btn btn-primary', id: 'btn-qr-photo',
    onclick: () => fromImage(true) }, icon('camera'), 'ถ่ายรูป QR code');
  const btnPick = h('button', { type: 'button', class: 'btn btn-quiet', id: 'btn-qr-pick',
    onclick: () => fromImage(false) }, icon('image'), 'เลือกรูปจากเครื่อง');

  function resumeLive() {
    paused = false;
    startScanner();
  }

  async function fromImage(capture) {
    if (capture && scanner) {
      // มือถือใช้กล้องพร้อมกันสองที่ไม่ได้: ปิดกล้องสดก่อนเปิดกล้องถ่ายรูป
      // (แสดงปุ่มเปิดกล้องอีกครั้งไว้ เผื่อเบราว์เซอร์ไม่แจ้งเมื่อผู้ใช้ยกเลิกการถ่าย)
      stopScanner();
      paused = true;
      btnRetry.hidden = false;
    }
    const file = await pickImage({ capture });
    if (!alive || done) return;
    if (!file) { resumeLive(); return; }
    busy = true;
    btnPhoto.disabled = btnPick.disabled = true;
    setStatus('กำลังอ่าน QR code จากรูป…', 'busy');
    try {
      const text = await decodeImageFile(file);
      if (!alive) return;
      if (text) handleText(text, 'image');
      else setStatus('ไม่พบ QR code ในรูปนี้ ถ่ายให้ QR code อยู่กลางภาพ ชัด เต็มกรอบ และไม่มีแสงสะท้อน', 'error');
    } catch (err) {
      if (alive) setStatus(err.message || String(err), 'error');
    } finally {
      btnPhoto.disabled = btnPick.disabled = false;
      busy = false;
      if (alive && !done) resumeLive();
    }
  }

  // ---------------------------------------------------------------- ลิงก์
  const linkInput = h('input', {
    class: 'input', id: 'receive-link', type: 'text', inputmode: 'url', autocomplete: 'off', autocapitalize: 'off',
    spellcheck: 'false', placeholder: 'วางลิงก์ชุดข้อสอบที่นี่', 'aria-label': 'ลิงก์ชุดข้อสอบ',
  });
  const openLink = () => {
    const text = linkInput.value.trim();
    if (!text) { setStatus('วางลิงก์ชุดข้อสอบในช่องก่อน', 'error'); linkInput.focus(); return; }
    handleText(text, 'link');
  };
  const canReadClipboard = !!(navigator.clipboard && navigator.clipboard.readText);
  const btnPaste = canReadClipboard ? h('button', { type: 'button', class: 'btn btn-quiet', id: 'btn-paste-link', onclick: async () => {
    try {
      const text = (await navigator.clipboard.readText() || '').trim();
      if (!text) { setStatus('ยังไม่ได้คัดลอกลิงก์ กดค้างที่ลิงก์ใน LINE หรืออีเมลแล้วเลือกคัดลอกก่อน', 'error'); return; }
      linkInput.value = text;
      openLink();
    } catch (e) {
      setStatus('วางอัตโนมัติไม่ได้ กดค้างในช่องด้านบนแล้วเลือก "วาง"', 'error');
      linkInput.focus();
    }
  } }, 'วางลิงก์ที่คัดลอกไว้') : null;

  // ---------------------------------------------------------------- หน้าจอ
  main.append(h('p', { class: 'receive-intro' },
    'ที่เครื่องต้นทาง เปิดชุดข้อสอบแล้วกด ', h('strong', null, 'ส่งไปมือถือ / เครื่องอื่น'),
    ' จะมี QR code ขึ้นมา ', liveOk ? 'เล็งกล้องด้านล่างไปที่ QR code นั้น' : 'ถ่ายรูป QR code นั้น'));
  if (liveOk) main.append(box, h('div', { class: 'receive-under' }, status, btnRetry));

  main.append(h('section', { class: 'form-section receive-section' },
    h('h2', { class: 'section-title' }, liveOk ? 'สแกนไม่ได้? ใช้รูปแทน' : 'ถ่ายรูป QR code'),
    h('p', { class: 'section-help' }, liveOk
      ? 'ถ่ายรูป QR code บนหน้าจอเครื่องต้นทาง หรือเลือกภาพหน้าจอที่มี QR code'
      : 'เบราว์เซอร์นี้เปิดกล้องในหน้าเว็บไม่ได้ (เช่น iPhone ที่เปิดโหมดล็อกดาวน์) ถ่ายรูป QR code บนหน้าจอเครื่องต้นทาง หรือเลือกภาพหน้าจอที่มี QR code'),
    h('div', { class: 'btn-row' }, btnPhoto, btnPick),
    liveOk ? null : status));

  main.append(h('section', { class: 'form-section receive-section' },
    h('h2', { class: 'section-title' }, 'ได้รับเป็นลิงก์'),
    h('p', { class: 'section-help' }, 'ได้ลิงก์ชุดข้อสอบทาง LINE หรืออีเมล: คัดลอกลิงก์แล้ววางที่นี่ ชุดข้อสอบจะเข้าแอปนี้โดยตรง'),
    h('form', { class: 'paste-row', onsubmit: (e) => { e.preventDefault(); openLink(); } },
      linkInput,
      h('button', { type: 'submit', class: 'btn btn-quiet', id: 'btn-open-link' }, 'เปิดลิงก์')),
    btnPaste ? h('div', { class: 'btn-row' }, btnPaste) : null));

  main.append(h('p', { class: 'section-help receive-note' },
    'QR code และลิงก์มีเฉพาะรายวิชา เฉลย และแบบฟอร์ม ถ้าต้องการย้ายผลตรวจและรูปด้วย ใช้ไฟล์สำรองที่ ',
    h('a', { class: 'link', href: '#/settings' }, 'ตั้งค่า → สำรองและกู้คืนข้อมูล')));

  startScanner();

  return () => {
    alive = false;
    stopScanner();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
