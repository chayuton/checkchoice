// ข้อมูลชุดข้อสอบและผลตรวจ
import { db } from './db.js';

const OMR = self.OMRCore;
export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export function newId(prefix) {
  const rnd = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
  return `${prefix}_${rnd.replace(/-/g, '').slice(0, 16)}`;
}

export function templateById(id) {
  return OMR.TEMPLATES.find((t) => t.id === id) || OMR.TEMPLATES[0];
}

export function blankExam() {
  const t = OMR.TEMPLATES[0];
  return {
    id: null,
    courseCode: '',
    courseName: '',
    examName: '',
    template: JSON.parse(JSON.stringify(t)),
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
