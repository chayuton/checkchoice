// แปลงชุดข้อสอบ (รายวิชา + เฉลย) เป็นลิงก์สั้น ๆ เพื่อส่งไปอีกเครื่องโดยไม่ต้องมีเซิร์ฟเวอร์
// ลิงก์มีเฉพาะข้อมูลชุดข้อสอบและเฉลย ไม่มีรูปหรือผลตรวจของนักศึกษา
const VERSION = 1;
const LETTERS = 'ABCDEFGH';

function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s) {
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeExam(exam) {
  const key = exam.key.map((c) => (c == null ? '-' : LETTERS[c])).join('').replace(/-+$/, '');
  const data = {
    v: VERSION,
    i: exam.id,
    c: exam.courseCode || '',
    n: exam.courseName || '',
    e: exam.examName || '',
    t: exam.template.id,
    q: exam.questionCount,
    m: exam.maxStudentNo,
    k: key,
  };
  return toBase64Url(new TextEncoder().encode(JSON.stringify(data)));
}

/** ถอดลิงก์กลับเป็นชุดข้อสอบ ตรวจทุกค่าก่อนใช้ (ลิงก์มาจากภายนอก) */
export function decodeExam(payload, templates) {
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
  } catch (e) {
    throw new Error('ลิงก์นี้ไม่ถูกต้องหรือไม่ครบ ลองสแกน QR code หรือคัดลอกลิงก์ใหม่');
  }
  if (!data || typeof data !== 'object' || data.v !== VERSION) throw new Error('ลิงก์นี้มาจากแอปเวอร์ชันที่ไม่รองรับ');
  const tpl = templates.find((t) => t.id === data.t);
  if (!tpl) throw new Error('ไม่รู้จักแบบฟอร์มกระดาษคำตอบในลิงก์นี้');
  const total = tpl.blocks * tpl.rowsPerBlock;
  const keyStr = typeof data.k === 'string' ? data.k : '';
  if (!/^[A-H-]*$/.test(keyStr) || keyStr.length > total) throw new Error('ข้อมูลเฉลยในลิงก์ไม่ถูกต้อง');
  const key = new Array(total).fill(null);
  for (let i = 0; i < keyStr.length; i++) {
    if (keyStr[i] === '-') continue;
    const idx = LETTERS.indexOf(keyStr[i]);
    if (idx < 0 || idx >= tpl.choices) throw new Error('ข้อมูลเฉลยในลิงก์ไม่ถูกต้อง');
    key[i] = idx;
  }
  const text = (x, max) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
  const int = (x, lo, hi, d) => (Number.isInteger(x) && x >= lo && x <= hi ? x : d);
  return {
    id: typeof data.i === 'string' && /^ex_[A-Za-z0-9]{6,40}$/.test(data.i) ? data.i : null,
    courseCode: text(data.c, 40),
    courseName: text(data.n, 120),
    examName: text(data.e, 120),
    template: JSON.parse(JSON.stringify(tpl)),
    questionCount: int(data.q, 1, total, total),
    maxStudentNo: int(data.m, 1, 999, 100),
    key,
  };
}

export function importLink(exam, base) {
  return `${base}#/import/${encodeExam(exam)}`;
}
