// ทดสอบการรับชุดข้อสอบด้วย QR code: แยกลิงก์จากข้อความที่สแกนหรือวางมา และอ่าน QR code
// จากภาพจำลองการถ่ายหน้าจอด้วยมือถือ ด้วย jsQR ตัวเดียวกับในแอป (vendor/jsqr.min.js)
// ขั้นตอนอ่านเลียนแบบ js/qr-scan.js: กล้องสดตัดกลางเฟรมเป็นสี่เหลี่ยมจัตุรัส ย่อไม่เกิน 1200 px
// รูปถ่ายย่อเหลือด้านยาว 2000 px แล้วลองอ่านที่ 1200, 1500 และ 900 px
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { qrImage, cameraShot, resize, crop } from './qr-photo.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OMR = require(path.join(root, 'js/omr/core.js'));
const jsQR = require(path.join(root, 'vendor/jsqr.min.js'));
const { importLink, decodeExam, extractImportPayload } = await import(pathToFileURL(path.join(root, 'js/transfer.js')).href);

let failures = 0;
const check = (cond, msg) => { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } };

const BASE = 'https://checkchoice.vercel.app/';

console.log('แยกลิงก์ชุดข้อสอบจากข้อความ');
{
  const p = 'eyJ2IjoxLCJpIjoiZXhfMTIzNDU2Nzg5MCJ9';
  check(extractImportPayload(`${BASE}#/import/${p}`) === p, 'ลิงก์เต็ม');
  check(extractImportPayload(`http://192.168.1.20:8080/index.html#/import/${p}`) === p, 'ลิงก์จากเครื่องอื่นหรือที่อยู่อื่นก็ได้ (ใช้เฉพาะส่วนข้อมูล)');
  check(extractImportPayload(`  ลิงก์ชุดข้อสอบ: ${BASE}#/import/${p}\nส่งจาก CheckChoice `) === p, 'ข้อความที่มีลิงก์ปนอยู่ (คัดลอกมาจาก LINE)');
  check(extractImportPayload(`${BASE}%23%2Fimport%2F${p}`) === p, 'ลิงก์ที่ถูกเข้ารหัส %');
  check(extractImportPayload(p) === p, 'เฉพาะส่วนข้อมูล');
  check(extractImportPayload('https://example.com/menu') === null, 'ลิงก์เว็บอื่นไม่ใช่ชุดข้อสอบ');
  check(extractImportPayload('WIFI:S:Office;T:WPA;P:secret;;') === null && extractImportPayload('') === null
    && extractImportPayload(null) === null && extractImportPayload('สวัสดี') === null, 'ข้อความอื่น ๆ ไม่ใช่ชุดข้อสอบ');
}

// ---------------------------------------------------------------- ชุดข้อสอบตัวอย่าง (ลิงก์สั้นถึงยาวที่สุด)
const keyFrom = (s, letters = 'ABCDE') => [...s].map((c) => letters.indexOf(c));
const tpl60 = OMR.TEMPLATES[0];
const key60 = keyFrom('BCDBCBACBDACADCADCBCABCABACBCDBDADBADCDBABCADACBDCACDADBADBD');
const custom150 = Object.assign(OMR.normalizeTemplate({ blocks: 6, rowsPerBlock: 25, choices: 4, headerRows: 1, aspect: 1.5, name: 'แบบฟอร์มคณะ 150 ข้อ' }),
  { id: 'tpl_abc123def456', custom: true });
const key150 = Array.from({ length: 150 }, (_, i) => (i % 17 === 3 ? [i % 4, (i + 1) % 4].sort() : (i * 7) % 4));
const custom300 = Object.assign(OMR.normalizeTemplate({ blocks: 10, rowsPerBlock: 30, choices: 5, headerRows: 2, aspect: 1.9, name: 'กระดาษคำตอบมาตรฐานคณะวิทยาศาสตร์ 300 ข้อ' }),
  { id: 'tpl_bigsheet300xyz', custom: true });
const key300 = Array.from({ length: 300 }, (_, i) => (i % 11 === 5 ? [i % 5, (i + 2) % 5].sort() : (i * 3 + 1) % 5));
const EXAMS = [
  { label: '60 ข้อ', exam: { id: 'ex_3f9a1c2b7d4e5f60', courseCode: '04-012-301', courseName: 'เทคโนโลยีสารสนเทศ', examName: 'สอบกลางภาค 1/2569',
    template: tpl60, questionCount: 60, maxStudentNo: 45, key: key60 } },
  { label: '150 ข้อ แบบฟอร์มเพิ่มเอง เฉลยหลายคำตอบ', exam: { id: 'ex_7c1d2e3f4a5b6c7d', courseCode: '04-012-302', courseName: 'การเขียนโปรแกรมคอมพิวเตอร์',
    examName: 'สอบปลายภาค 1/2569', template: custom150, questionCount: 150, maxStudentNo: 120, key: key150, multiAnswer: 'all' } },
  { label: '300 ข้อ ชื่อยาวที่สุด (QR หนาแน่นที่สุด)', exam: { id: 'ex_9e8d7c6b5a4f3e2d', courseCode: '04-012-303-SEC-01-2569',
    courseName: 'ระเบียบวิธีวิจัยทางวิทยาศาสตร์และเทคโนโลยีสำหรับนักศึกษาระดับปริญญาตรีชั้นปีที่สาม ภาคการศึกษาที่หนึ่ง',
    examName: 'สอบปลายภาค ภาคการศึกษาที่ 1 ปีการศึกษา 2569 (ชุด ก) สำหรับนักศึกษาทุกกลุ่มเรียน', template: custom300, questionCount: 300,
    maxStudentNo: 200, key: key300, multiAnswer: 'any' } },
];

const read = (img, inversion) => {
  const r = jsQR(img.data, img.width, img.height, { inversionAttempts: inversion });
  return r ? r.data : null;
};

/** ขั้นตอนเดียวกับกล้องสดในแอป: กลางเฟรม (สี่เหลี่ยมจัตุรัส) ย่อไม่เกิน 1200 px */
function liveRead(frame) {
  const side = Math.min(frame.width, frame.height);
  const c = crop(frame, Math.round((frame.width - side) / 2), Math.round((frame.height - side) / 2), side, side);
  return read(resize(c, 1200), 'dontInvert');
}

/** ขั้นตอนเดียวกับการเลือกรูปในแอป (ส่วนที่ใช้ jsQR) */
function photoRead(photo) {
  const img = resize(photo, 2000);
  const long = Math.max(img.width, img.height);
  for (const s of [...new Set([1200, 1500, 900].map((x) => Math.min(x, long)))]) {
    const t = read(resize(img, s), 'dontInvert');
    if (t) return t;
  }
  return null;
}

const LIVE = [
  { name: 'กล้อง 1280×720 QR ครึ่งกรอบ', opts: { W: 1280, H: 720, cover: 0.5, seed: 1 } },
  { name: 'กล้อง 1920×1080 QR เล็ก (ถือห่าง)', opts: { W: 1920, H: 1080, cover: 0.42, seed: 2 } },
  { name: 'กล้อง 1280×720 ถือเอียงและหมุน', opts: { W: 1280, H: 720, cover: 0.72, tilt: 0.12, rotate: -9, seed: 3 } },
  { name: 'กล้อง 1920×1080 ไม่อยู่กลางกรอบ และเบลอ', opts: { W: 1920, H: 1080, cover: 0.6, offset: [0.04, 0.03], blur: 2, seed: 4 } },
  { name: 'มือถือแนวตั้ง 1080×1920', opts: { W: 1080, H: 1920, cover: 0.62, rotate: 3, seed: 5 } },
];

for (const { label, exam } of EXAMS) {
  const link = importLink(exam, BASE);
  const qr = qrImage(link);
  console.log(`ชุดข้อสอบ ${label}: ลิงก์ ${link.length} ตัวอักษร, QR ${qr.modules}×${qr.modules} ช่อง`);
  const back = decodeExam(extractImportPayload(link), OMR.TEMPLATES, OMR);
  check(JSON.stringify(back.key) === JSON.stringify(exam.key) && back.courseName === exam.courseName && (back.multiAnswer || null) === (exam.multiAnswer || null),
    'ลิงก์ถอดกลับได้ชุดข้อสอบเดิม');
  for (const sc of LIVE) {
    const t0 = Date.now();
    const text = liveRead(cameraShot(qr, sc.opts));
    check(text === link, `${sc.name}: อ่านได้ตรงทุกตัวอักษร (${Date.now() - t0} ms รวมสร้างภาพ)`);
  }
  const t1 = Date.now();
  const photo = cameraShot(qr, { W: 2000, H: 1500, cover: 0.35, tilt: 0.08, rotate: 6, blur: 2, noise: 6, seed: 9 });
  check(photoRead(photo) === link, `รูปถ่ายหน้าจอ 2000×1500 (QR 35% ของภาพ เบลอ): อ่านได้ (${Date.now() - t1} ms รวมสร้างภาพ)`);
}

console.log('QR ที่ไม่ใช่ชุดข้อสอบ');
{
  const text = read(resize(cameraShot(qrImage('https://example.com/menu?table=12'), { W: 1280, H: 720, cover: 0.5, seed: 7 }), 1000), 'dontInvert');
  check(text === 'https://example.com/menu?table=12' && extractImportPayload(text) === null, 'อ่านได้แต่ไม่ถือเป็นชุดข้อสอบ');
}

console.log(failures ? `\nไม่ผ่าน ${failures} รายการ` : '\nผ่านทั้งหมด');
process.exit(failures ? 1 : 0);
