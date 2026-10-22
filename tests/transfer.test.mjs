// ทดสอบการแปลงชุดข้อสอบเป็นลิงก์และถอดกลับ (ใช้ส่งเฉลยไปเครื่องอื่น)
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OMR = require(path.join(root, 'js/omr/core.js'));
const { encodeExam, decodeExam, importLink } = await import(path.join(root, 'js/transfer.js'));

let failures = 0;
const check = (cond, msg) => { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } };
const throws = (fn, msg) => { try { fn(); check(false, msg); } catch (e) { check(true, `${msg} (${e.message})`); } };

const tpl = OMR.TEMPLATES[0];
const key = 'BCDBCBACBDACADCADCBCABCABACBCDBDADBADCDBABCAD'.split('').map((c) => 'ABCDE'.indexOf(c));
while (key.length < 60) key.push(null);
key[7] = null; // ข้อที่ไม่มีเฉลย
const exam = {
  id: 'ex_3f9a1c2b7d4e5f60', courseCode: '04-012-301', courseName: 'เทคโนโลยีสารสนเทศ',
  examName: 'สอบกลางภาค 1/2569', template: tpl, questionCount: 45, maxStudentNo: 120, key,
};

console.log('แปลงไป-กลับ');
const payload = encodeExam(exam);
check(/^[A-Za-z0-9_-]+$/.test(payload), `ลิงก์ใช้ตัวอักษรที่ปลอดภัยใน URL (${payload.length} ตัวอักษร)`);
const back = decodeExam(payload, OMR.TEMPLATES, OMR);
check(back.id === exam.id && back.courseCode === exam.courseCode && back.courseName === exam.courseName && back.examName === exam.examName,
  'รหัส ชื่อวิชา และชื่อการสอบครบถ้วน (ภาษาไทยถูกต้อง)');
check(back.questionCount === 45 && back.maxStudentNo === 120, 'จำนวนข้อและจำนวนเลขที่ถูกต้อง');
check(JSON.stringify(back.key) === JSON.stringify(key), 'เฉลยตรงทุกข้อ รวมข้อที่ไม่มีเฉลย');
check(back.template.id === tpl.id && back.template !== tpl, 'ใช้แบบฟอร์มของเครื่องปลายทาง (คัดลอกใหม่)');
const link = importLink(exam, 'https://checkchoice.vercel.app/');
check(link.startsWith('https://checkchoice.vercel.app/#/import/') && link.length < 600, `ลิงก์สั้นพอสำหรับ QR code (${link.length} ตัวอักษร)`);

console.log('ลิงก์ผิดรูปแบบต้องถูกปฏิเสธ');
const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
throws(() => decodeExam('!!!', OMR.TEMPLATES, OMR), 'ข้อมูลเสีย');
throws(() => decodeExam(enc({ v: 9, t: tpl.id, k: '' }), OMR.TEMPLATES, OMR), 'เวอร์ชันไม่รองรับ');
throws(() => decodeExam(enc({ v: 1, t: 'unknown', k: '' }), OMR.TEMPLATES, OMR), 'แบบฟอร์มไม่รู้จัก');
throws(() => decodeExam(enc({ v: 1, t: tpl.id, k: 'ABZ' }), OMR.TEMPLATES, OMR), 'ตัวเลือกที่ไม่มีจริง');
throws(() => decodeExam(enc({ v: 1, t: tpl.id, k: 'F' }), OMR.TEMPLATES, OMR), 'ตัวเลือกเกินจำนวนในแบบฟอร์ม');
throws(() => decodeExam(enc({ v: 1, t: tpl.id, k: 'A'.repeat(61) }), OMR.TEMPLATES, OMR), 'เฉลยยาวเกินจำนวนข้อ');
const odd = decodeExam(enc({ v: 1, i: '<script>', t: tpl.id, q: 999, m: -5, n: 'ก'.repeat(500), k: 'AB' }), OMR.TEMPLATES, OMR);
check(odd.id === null && odd.questionCount === 60 && odd.maxStudentNo === 100 && odd.courseName.length === 120,
  'ค่าที่ไม่สมเหตุสมผลถูกแทนด้วยค่าปลอดภัย');

console.log('แบบฟอร์มที่เพิ่มเองต้องติดไปกับลิงก์');
{
  const custom = Object.assign(OMR.normalizeTemplate({ blocks: 6, rowsPerBlock: 25, choices: 4, headerRows: 1, order: 'across', aspect: 1.5, name: 'แบบฟอร์มคณะ 150 ข้อ' }),
    { id: 'tpl_abc123def456', custom: true });
  const ex2 = Object.assign({}, exam, { template: custom, key: new Array(150).fill(null).map((_, i) => i % 4), questionCount: 150 });
  const back2 = decodeExam(encodeExam(ex2), OMR.TEMPLATES, OMR);
  const t2 = back2.template;
  check(t2.id === custom.id && t2.custom && t2.blocks === 6 && t2.rowsPerBlock === 25 && t2.choices === 4 && t2.headerRows === 1
    && t2.order === 'across' && t2.name === custom.name && Math.abs(t2.aspect - 1.5) < 0.001, 'โครงตารางและชื่อแบบฟอร์มครบถ้วน');
  check(JSON.stringify(back2.key) === JSON.stringify(ex2.key) && back2.questionCount === 150, 'เฉลย 150 ข้อครบถ้วน');
  const link2 = importLink(ex2, 'https://checkchoice.vercel.app/');
  check(link2.length < 700, `ลิงก์ยังสั้นพอสำหรับ QR code (${link2.length} ตัวอักษร)`);
  throws(() => decodeExam(enc({ v: 1, t: 'tpl_x1y2z3', T: [20, 60, 9, 1, 1, 0, 1, 'x'], k: '' }), OMR.TEMPLATES, OMR), 'แบบฟอร์มที่เกินขนาดถูกปฏิเสธ');
  throws(() => decodeExam(enc({ v: 1, t: 'tpl_x1y2z3', T: ['5', 20, 5, 2, 1, 0, 1.7, 'x'], k: '' }), OMR.TEMPLATES, OMR), 'ค่าที่ไม่ใช่ตัวเลขถูกปฏิเสธ');
}

console.log('เฉลยหลายคำตอบ: การคิดคะแนน');
{
  const it = (choice, flag = null, resolved = true) => ({ choice, flag, resolved });
  check(OMR.isCorrect([0, 2], 0, 'any') && OMR.isCorrect([0, 2], 2, 'any') && !OMR.isCorrect([0, 2], 1, 'any'),
    "'any': ตอบตัวเลือกใดก็ได้ที่เฉลยไว้ได้คะแนน ตัวเลือกอื่นไม่ได้");
  check(!OMR.isCorrect([0, 2], [0, 2], 'any'), "'any': กากบาทหลายช่องไม่ได้คะแนน");
  check(OMR.isCorrect([0, 2], [2, 0], 'all') && !OMR.isCorrect([0, 2], 0, 'all') && !OMR.isCorrect([0, 2], [0, 1, 2], 'all'),
    "'all': ต้องกากบาทครบทุกช่องที่เฉลยและไม่เกิน");
  check(OMR.isCorrect(1, 1, 'all') && !OMR.isCorrect(1, [1, 3], 'all') && OMR.isCorrect(1, 1) && !OMR.isCorrect(null, 1),
    'ข้อที่เฉลยตัวเลือกเดียวตรวจแบบเดิม ข้อที่ไม่มีเฉลยไม่ได้คะแนน');
  const k = [0, [1, 3], [0, 2], null];
  const items = [it(0), it(3), it([0, 2]), it(1)];
  check(OMR.grade(k, items, 4, 'any').correct === 2 && OMR.grade(k, items, 4, 'all').correct === 2
    && OMR.grade(k, items, 4).correct === 2, 'คิดคะแนนรวมตามกติกาที่เลือก');
  check(OMR.grade(k, [it(0), it(null, 'multi', false)], 2, 'all').pending === 1, 'ข้อที่ยังรอยืนยันนับเป็นศูนย์');
  check(JSON.stringify(OMR.packChoices([3, 1, 3])) === '[1,3]' && OMR.packChoices([2]) === 2 && OMR.packChoices([]) === null,
    'รวมตัวเลือกเป็นค่าที่เก็บได้ถูกต้อง');
  const d = OMR.decide([0.2, 0.01, 0.18, 0.01, 0.01]);
  check(d.flag === 'multi' && JSON.stringify(d.marks) === '[0,2]', 'ผลอ่านภาพบอกทุกช่องที่กากบาท (marks)');
}

console.log('เฉลยหลายคำตอบ: ส่งผ่านลิงก์');
{
  const mk = key.slice();
  mk[0] = [0, 2]; mk[9] = [1, 3, 4];
  for (const rule of ['any', 'all']) {
    const back3 = decodeExam(encodeExam(Object.assign({}, exam, { key: mk, multiAnswer: rule })), OMR.TEMPLATES, OMR);
    check(JSON.stringify(back3.key) === JSON.stringify(mk) && back3.multiAnswer === rule, `เฉลยหลายตัวเลือกและกติกา '${rule}' ครบถ้วน`);
  }
  const plain = decodeExam(encodeExam(exam), OMR.TEMPLATES, OMR);
  check(!('multiAnswer' in plain), 'ชุดข้อสอบเดิมไม่มีกติกาเฉลยหลายคำตอบติดไป');
  throws(() => decodeExam(enc({ v: 1, t: tpl.id, k: '(AC)B' }), OMR.TEMPLATES, OMR), 'เฉลยหลายตัวเลือกโดยไม่มีกติกาถูกปฏิเสธ');
  throws(() => decodeExam(enc({ v: 1, t: tpl.id, M: 2, k: '(AA)' }), OMR.TEMPLATES, OMR), 'ตัวเลือกซ้ำถูกปฏิเสธ');
  throws(() => decodeExam(enc({ v: 1, t: tpl.id, M: 2, k: '(AF)' }), OMR.TEMPLATES, OMR), 'ตัวเลือกเกินจำนวนในแบบฟอร์มถูกปฏิเสธ');
  throws(() => decodeExam(enc({ v: 1, t: tpl.id, M: 2, k: '(A' }), OMR.TEMPLATES, OMR), 'วงเล็บไม่ครบถูกปฏิเสธ');
}

console.log(failures ? `\nไม่ผ่าน ${failures} รายการ` : '\nผ่านทั้งหมด');
process.exit(failures ? 1 : 0);
