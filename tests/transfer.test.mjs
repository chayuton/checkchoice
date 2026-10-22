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
const back = decodeExam(payload, OMR.TEMPLATES);
check(back.id === exam.id && back.courseCode === exam.courseCode && back.courseName === exam.courseName && back.examName === exam.examName,
  'รหัส ชื่อวิชา และชื่อการสอบครบถ้วน (ภาษาไทยถูกต้อง)');
check(back.questionCount === 45 && back.maxStudentNo === 120, 'จำนวนข้อและจำนวนเลขที่ถูกต้อง');
check(JSON.stringify(back.key) === JSON.stringify(key), 'เฉลยตรงทุกข้อ รวมข้อที่ไม่มีเฉลย');
check(back.template.id === tpl.id && back.template !== tpl, 'ใช้แบบฟอร์มของเครื่องปลายทาง (คัดลอกใหม่)');
const link = importLink(exam, 'https://checkchoice.vercel.app/');
check(link.startsWith('https://checkchoice.vercel.app/#/import/') && link.length < 600, `ลิงก์สั้นพอสำหรับ QR code (${link.length} ตัวอักษร)`);

console.log('ลิงก์ผิดรูปแบบต้องถูกปฏิเสธ');
const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
throws(() => decodeExam('!!!', OMR.TEMPLATES), 'ข้อมูลเสีย');
throws(() => decodeExam(enc({ v: 9, t: tpl.id, k: '' }), OMR.TEMPLATES), 'เวอร์ชันไม่รองรับ');
throws(() => decodeExam(enc({ v: 1, t: 'unknown', k: '' }), OMR.TEMPLATES), 'แบบฟอร์มไม่รู้จัก');
throws(() => decodeExam(enc({ v: 1, t: tpl.id, k: 'ABZ' }), OMR.TEMPLATES), 'ตัวเลือกที่ไม่มีจริง');
throws(() => decodeExam(enc({ v: 1, t: tpl.id, k: 'F' }), OMR.TEMPLATES), 'ตัวเลือกเกินจำนวนในแบบฟอร์ม');
throws(() => decodeExam(enc({ v: 1, t: tpl.id, k: 'A'.repeat(61) }), OMR.TEMPLATES), 'เฉลยยาวเกินจำนวนข้อ');
const odd = decodeExam(enc({ v: 1, i: '<script>', t: tpl.id, q: 999, m: -5, n: 'ก'.repeat(500), k: 'AB' }), OMR.TEMPLATES);
check(odd.id === null && odd.questionCount === 60 && odd.maxStudentNo === 100 && odd.courseName.length === 120,
  'ค่าที่ไม่สมเหตุสมผลถูกแทนด้วยค่าปลอดภัย');

console.log(failures ? `\nไม่ผ่าน ${failures} รายการ` : '\nผ่านทั้งหมด');
process.exit(failures ? 1 : 0);
