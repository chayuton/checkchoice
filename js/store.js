// ข้อมูลชุดข้อสอบและผลตรวจ
import { db } from './db.js';

const OMR = self.OMRCore;
export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export function newId(prefix) {
  const rnd = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
  return `${prefix}_${rnd.replace(/-/g, '').slice(0, 16)}`;
}

// ---------------------------------------------------------------------------
// แบบฟอร์มกระดาษคำตอบ: แบบสำเร็จรูปในแอป + แบบที่อาจารย์เพิ่มเอง (เก็บในเครื่อง)
// ---------------------------------------------------------------------------
const copy = (x) => JSON.parse(JSON.stringify(x));

export async function listTemplates() {
  const custom = await db.getAll('templates').catch(() => []);
  custom.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  return [...OMR.TEMPLATES.map(copy), ...custom];
}

export async function getTemplate(id) {
  const builtin = OMR.TEMPLATES.find((t) => t.id === id);
  return builtin ? copy(builtin) : db.get('templates', id);
}

export async function saveTemplate(t) {
  const now = new Date().toISOString();
  const rec = OMR.normalizeTemplate(t);
  if (!rec.id) { rec.id = newId('tpl'); rec.createdAt = now; }
  rec.custom = true;
  delete rec.builtin;
  rec.updatedAt = now;
  await db.put('templates', rec);
  return rec;
}

export async function deleteTemplate(id) {
  await db.delete('templates', id);
  await db.delete('blobs', `tpl:${id}:blank`).catch(() => {});
}

/** จำนวนชุดข้อสอบที่ใช้แบบฟอร์มนี้ */
export async function templateUsage(id) {
  return (await listExams()).filter((e) => e.template && e.template.id === id).length;
}

export function templateSummary(t) {
  const n = OMR.questionCount(t);
  return `${n} ข้อ: ${t.blocks} ชุด × ${t.rowsPerBlock} ข้อ, ตัวเลือก ${t.choiceLabels[0]}–${t.choiceLabels[t.choices - 1]}`;
}

export function blankExam(template) {
  const t = template ? copy(template) : copy(OMR.TEMPLATES[0]);
  return {
    id: null,
    courseCode: '',
    courseName: '',
    examName: '',
    template: t,
    questionCount: OMR.questionCount(t),
    maxStudentNo: 100,
    key: new Array(OMR.questionCount(t)).fill(null),
    hasKeyImage: false,
    createdAt: null,
    updatedAt: null,
  };
}

export const listExams = () => db.getAll('exams');
export const getExam = (id) => db.get('exams', id);

export async function saveExam(exam) {
  const now = new Date().toISOString();
  if (!exam.id) { exam.id = newId('ex'); exam.createdAt = now; }
  exam.updatedAt = now;
  await db.put('exams', exam);
  return exam;
}

export const deleteExam = (id) => db.deleteExamCascade(id);

/**
 * พื้นที่ที่แต่ละชุดข้อสอบใช้ (โดยประมาณ): Map examId → { bytes, results, keyImages, sheetImages }
 * นับข้อมูลชุดข้อสอบ ผลตรวจ รูปใบเฉลย และรูปกระดาษที่ตรวจแล้ว
 */
export async function storageByExam() {
  const [exams, results, sizes] = await Promise.all([db.getAll('exams'), db.getAll('results'), db.blobSizes().catch(() => [])]);
  const out = new Map();
  for (const e of exams) out.set(e.id, { bytes: JSON.stringify(e).length, results: 0, keyImages: 0, sheetImages: 0 });
  // รูปของชุดข้อสอบมีรหัสขึ้นต้นด้วย key:<examId>: (ใบเฉลย) หรือ res:<examId>: (กระดาษที่ตรวจแล้ว)
  for (const b of sizes) {
    const m = /^(key|res):([^:]+):/.exec(b.id);
    const rec = m && out.get(m[2]);
    if (!rec) continue;
    rec.bytes += b.size;
    if (m[1] === 'key') rec.keyImages++; else rec.sheetImages++;
  }
  for (const r of results) {
    const rec = out.get(r.examId);
    if (!rec) continue;
    rec.results++;
    rec.bytes += JSON.stringify(r).length;
  }
  return out;
}

export const resultId = (examId, no) => `${examId}:${no}`;
export const listResults = (examId) => db.getAllByIndex('results', 'examId', examId)
  .then((rs) => rs.sort((a, b) => a.studentNo - b.studentNo));
export const getResult = (examId, no) => db.get('results', resultId(examId, no));

export async function saveResult(result, imageBlob) {
  const now = new Date().toISOString();
  result.id = resultId(result.examId, result.studentNo);
  if (!result.createdAt) result.createdAt = now;
  result.updatedAt = now;
  if (imageBlob) {
    result.imageId = `res:${result.id}`;
    await putBlob(result.imageId, imageBlob);
  }
  await db.put('results', result);
  return result;
}

export const deleteResult = (result) => db.deleteResult(result);

export const putBlob = (id, blob) => db.put('blobs', { id, blob, type: blob.type });
export const getBlob = (id) => db.get('blobs', id).then((r) => (r ? r.blob : null));

/** คะแนนของผลตรวจ คิดจากเฉลยปัจจุบัน (ถ้าแก้เฉลยภายหลัง คะแนนจะเปลี่ยนตาม) */
export function scoreOf(exam, result) {
  return OMR.grade(exam.key, result.items, exam.questionCount);
}

export function letterOf(choice, template) {
  if (choice == null) return '';
  const labels = (template && template.choiceLabels) || LETTERS;
  return labels[choice] || '?';
}

export function examTitle(exam) {
  const course = [exam.courseCode, exam.courseName].filter(Boolean).join(' ');
  return { course, exam: exam.examName || 'ไม่มีชื่อการสอบ' };
}

/** สร้างรายการคำตอบจากผลอ่านภาพ */
export function itemsFromDecisions(decisions) {
  return decisions.map((d) => ({
    choice: d.choice,
    flag: d.flag,
    cancelled: d.cancelled,
    resolved: !d.flag,
    edited: false,
  }));
}

/** ข้อที่ยังต้องยืนยัน (เฉพาะข้อที่อยู่ในจำนวนข้อสอบ) */
export function pendingQuestions(items, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const it = items[i];
    if (it && it.flag && !it.resolved) out.push(i + 1);
  }
  return out;
}
