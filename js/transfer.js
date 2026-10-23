// แปลงชุดข้อสอบ (รายวิชา + เฉลย) เป็นลิงก์สั้น ๆ เพื่อส่งไปอีกเครื่องโดยไม่ต้องมีเซิร์ฟเวอร์
// ลิงก์มีเฉพาะข้อมูลชุดข้อสอบและเฉลย ไม่มีรูปหรือผลตรวจของนักศึกษา
//
// รูปแบบข้อมูลหลัง #/import/
//  แบบย่อ (ตั้งแต่ 1.6.0): "2" + base32 (A–Z, 2–7) ของ JSON ที่บีบอัดด้วย deflate ทุกตัวอักษรอยู่ในโหมด
//    Alphanumeric ของ QR code จึงได้ QR ที่เล็กและสแกนง่ายกว่าเดิมมาก (ชุด 150 ข้อจาก 89 เหลือ 69 ช่อง)
//  แบบเดิม (1.5.0 และก่อนหน้า): base64url ของ JSON (ขึ้นต้นด้วย "eyJ") ยังรับได้เหมือนเดิม
import { deflateSync, inflateSync } from '../vendor/fflate.mjs';

const VERSION = 1;
const LETTERS = 'ABCDEFGH';
const COMPACT = '2';
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const MAX_PAYLOAD = 8000;     // ความยาวสูงสุดที่รับ (ลิงก์ที่ยาวที่สุดจริงไม่ถึง 1,500 ตัวอักษร)
const MAX_JSON = 64 * 1024;   // ขนาดสูงสุดหลังคลายการบีบอัด

function toBase32(bytes) {
  let out = '', buf = 0, bits = 0;
  for (let i = 0; i < bytes.length; i++) {
    buf = (buf << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) { bits -= 5; out += B32[(buf >>> bits) & 31]; }
    buf &= (1 << bits) - 1;
  }
  if (bits) out += B32[(buf << (5 - bits)) & 31];
  return out;
}

function fromBase32(s) {
  const out = new Uint8Array(Math.floor((s.length * 5) / 8));
  let buf = 0, bits = 0, j = 0;
  for (let i = 0; i < s.length; i++) {
    const v = B32.indexOf(s[i]);
    if (v < 0) throw new Error('base32');
    buf = (buf << 5) | v;
    bits += 5;
    if (bits >= 8) { bits -= 8; out[j++] = (buf >>> bits) & 255; buf &= (1 << bits) - 1; }
  }
  return out;
}

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

/** เฉลยหนึ่งข้อเป็นข้อความ: ไม่มี '-', ตัวเดียว 'A', หลายตัวเลือก '(AC)' */
function keyToken(v) {
  const set = (Array.isArray(v) ? v : v == null ? [] : [v]).filter((c) => Number.isInteger(c) && c >= 0 && c < LETTERS.length);
  const uniq = [...new Set(set)].sort((a, b) => a - b);
  if (!uniq.length) return '-';
  const letters = uniq.map((c) => LETTERS[c]).join('');
  return uniq.length === 1 ? letters : `(${letters})`;
}

/** ข้อมูลชุดข้อสอบที่ใส่ในลิงก์ (ชื่อฟิลด์สั้นเพื่อให้ลิงก์สั้น) */
export function examData(exam) {
  const key = exam.key.map(keyToken).join('').replace(/-+$/, '');
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
  // กติกาเฉลยหลายคำตอบ: 1 = ตอบตัวเลือกใดก็ได้ที่เฉลย, 2 = ต้องกากบาทครบทุกตัวเลือก
  if (exam.multiAnswer === 'any') data.M = 1;
  else if (exam.multiAnswer === 'all') data.M = 2;
  // แบบฟอร์มที่อาจารย์เพิ่มเอง: แนบโครงตารางไปด้วย เครื่องปลายทางจะได้มีแบบฟอร์มนี้
  const t = exam.template;
  if (!t.builtin) {
    data.T = [t.blocks, t.rowsPerBlock, t.choices, t.headerRows, t.numberColumn ? 1 : 0, t.order === 'across' ? 1 : 0,
      Math.round((t.aspect || 0) * 1000) / 1000, t.name || ''];
  }
  return data;
}

/** ข้อมูลหลัง #/import/ แบบย่อ */
export function encodeExam(exam) {
  return COMPACT + toBase32(deflateSync(new TextEncoder().encode(JSON.stringify(examData(exam))), { level: 9 }));
}

/** ลิงก์แบบเดิม (1.5.0 และก่อนหน้า) ใช้ทดสอบว่ายังรับลิงก์เก่าได้ */
export function encodeExamLegacy(exam) {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(examData(exam))));
}

/** ข้อมูลหลัง #/import/ ใช้โหมด Alphanumeric ของ QR code ได้ (0–9 A–Z) */
export const isQRAlphanumeric = (payload) => /^[0-9A-Z]+$/.test(payload);

/** ถอดลิงก์กลับเป็นชุดข้อสอบ ตรวจทุกค่าก่อนใช้ (ลิงก์มาจากภายนอก)
 *  core: OMRCore (ใช้สร้างและตรวจแบบฟอร์มที่แนบมาในลิงก์) */
export function decodeExam(payload, templates, core) {
  let data;
  try {
    if (typeof payload !== 'string' || !payload || payload.length > MAX_PAYLOAD) throw new Error('length');
    const bytes = payload[0] === COMPACT ? inflateSync(fromBase32(payload.slice(1))) : fromBase64Url(payload);
    if (bytes.length > MAX_JSON) throw new Error('size');
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (e) {
    throw new Error('ลิงก์นี้ไม่ถูกต้องหรือไม่ครบ ลองสแกน QR code หรือคัดลอกลิงก์ใหม่');
  }
  if (!data || typeof data !== 'object' || data.v !== VERSION) throw new Error('ลิงก์นี้มาจากแอปเวอร์ชันที่ไม่รองรับ');
  let tpl = templates.find((t) => t.id === data.t && t.builtin);
  if (!tpl && Array.isArray(data.T) && core) {
    const [blocks, rowsPerBlock, choices, headerRows, numberColumn, across, aspect, name] = data.T;
    const raw = { blocks, rowsPerBlock, choices, headerRows, numberColumn: numberColumn === 1, order: across === 1 ? 'across' : 'down', aspect, name };
    const ints = [blocks, rowsPerBlock, choices, headerRows].every(Number.isInteger);
    const cand = core.normalizeTemplate(raw);
    if (!ints || core.validateTemplate(cand).length || cand.blocks !== blocks || cand.rowsPerBlock !== rowsPerBlock
      || cand.choices !== choices || cand.headerRows !== headerRows) {
      throw new Error('ข้อมูลแบบฟอร์มในลิงก์ไม่ถูกต้อง');
    }
    const id = typeof data.t === 'string' && /^tpl_[A-Za-z0-9]{6,40}$/.test(data.t) ? data.t : null;
    tpl = Object.assign(cand, { id, custom: true });
  }
  if (!tpl) throw new Error('ไม่รู้จักแบบฟอร์มกระดาษคำตอบในลิงก์นี้');
  const total = tpl.blocks * tpl.rowsPerBlock;
  const keyStr = typeof data.k === 'string' ? data.k : '';
  const badKey = () => new Error('ข้อมูลเฉลยในลิงก์ไม่ถูกต้อง');
  if (!/^(?:[A-H-]|\([A-H]{2,8}\))*$/.test(keyStr)) throw badKey();
  const tokens = keyStr.match(/\([A-H]{2,8}\)|[A-H-]/g) || [];
  if (tokens.length > total) throw badKey();
  const key = new Array(total).fill(null);
  tokens.forEach((tok, i) => {
    if (tok === '-') return;
    const idxs = tok.replace(/[()]/g, '').split('').map((ch) => LETTERS.indexOf(ch));
    if (idxs.some((x) => x < 0 || x >= tpl.choices) || new Set(idxs).size !== idxs.length) throw badKey();
    idxs.sort((a, b) => a - b);
    key[i] = idxs.length === 1 ? idxs[0] : idxs;
  });
  const multi = data.M === 1 ? 'any' : data.M === 2 ? 'all' : null;
  if (!multi && key.some(Array.isArray)) throw badKey();
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
    ...(multi ? { multiAnswer: multi } : {}),
  };
}

export function importLink(exam, base) {
  return `${base}#/import/${encodeExam(exam)}`;
}

/**
 * ดึงข้อมูลชุดข้อสอบจากข้อความที่สแกนจาก QR code หรือที่อาจารย์วางมา
 * รับได้ทั้งลิงก์เต็ม (จากเว็บไหนก็ได้ ใช้เฉพาะส่วนหลัง #/import/) ข้อความที่มีลิงก์ปนอยู่
 * ลิงก์ที่ถูกเข้ารหัส % และส่วนข้อมูลล้วน คืน null ถ้าไม่ใช่ (ต้องตรวจต่อด้วย decodeExam)
 */
export function extractImportPayload(text) {
  if (typeof text !== 'string') return null;
  let s = text.trim();
  if (!s || s.length > 20000) return null;
  if (/%23|%2F/i.test(s)) {
    try { s = decodeURIComponent(s); } catch (e) { /* ใช้ข้อความเดิม */ }
  }
  const m = s.match(/#\/import\/([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(s) ? s : null;
}
