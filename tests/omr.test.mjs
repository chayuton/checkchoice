// ชุดทดสอบแกนอ่านกระดาษคำตอบ: รันด้วย `npm test`
// ใช้ OpenCV.js ตัวเดียวกับในเว็บแอป และรูปถ่ายกระดาษจริงใน tests/fixtures
// --lite ใช้ตัวอ่านภาพสำรอง (js/omr/cvlite.js) ด้วยค่าเดียวกับในแอป แทน OpenCV.js
// OMR_BACKEND=lite / OMR_OPTS='{"workLongSide":1600}' กำหนดเองได้
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const jpeg = require('jpeg-js');
const OMR = require(path.join(root, 'js/omr/core.js'));

const LETTERS = 'ABCDE';
const TRUTH = {
  'key.jpg': 'BCDBCBACBDACADC' + 'ADCBCABCABACBCD' + 'BDADBADCDBABCAD' + 'ACBDCACDADBADBD',
  'student-02.jpg': 'BCDBABADBABCADC' + 'CBCADABCAAADBCD' + 'CAABBDAADBBBDAD' + 'DBBCDCBDADBCBDC',
  'student-05.jpg': 'CCABCCAACBAADDA' + 'BCBAABBDBBCCBDC' + 'ABBDCCBBDDCABBB' + 'CCBABBCDABBCBDA',
  'student-11.jpg': 'BCBDABACBAACAAC' + 'DCBDBBBDDBCCBCD' + 'DCACDACCBBBBDAD' + 'DDAADCABADDAAAB',
};
const EXPECTED_FLAGS = {
  'student-05.jpg': { 3: 'changed', 25: 'changed', 50: 'changed', 51: 'changed' },
};
const EXPECTED_SCORES = { 'student-02.jpg': 32, 'student-05.jpg': 18, 'student-11.jpg': 26 };

// โมดูล OpenCV.js มีเมธอด then ของ Emscripten จึงห่อไว้ในออบเจกต์ ไม่ให้ await วนไม่รู้จบ
const LITE = process.argv.includes('--lite') || process.env.OMR_BACKEND === 'lite';

function loadCv() {
  if (LITE) return Promise.resolve({ cv: require(path.join(root, 'js/omr/cvlite.js')) });
  const mod = require(path.join(root, 'vendor/opencv.js'));
  if (mod && mod.Mat) return Promise.resolve({ cv: mod });
  return new Promise((resolve) => { mod.onRuntimeInitialized = () => resolve({ cv: mod }); });
}

function loadImage(cv, file) {
  const raw = jpeg.decode(readFileSync(file), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
  const mat = new cv.Mat(raw.height, raw.width, cv.CV_8UC4);
  mat.data.set(raw.data);
  return mat;
}

let failures = 0;
function check(cond, msg) {
  if (cond) console.log('  ✓ ' + msg);
  else { failures++; console.log('  ✗ ' + msg); }
}

const BASE = process.env.OMR_OPTS ? JSON.parse(process.env.OMR_OPTS) : process.argv.includes('--lite') ? OMR.LITE_OPTS : {};

function read(cv, file, extra) {
  const mat = loadImage(cv, file);
  try {
    const t0 = Date.now();
    const res = OMR.readSheet(cv, mat, OMR.TEMPLATES[0], Object.assign({}, BASE, extra));
    res.ms = Date.now() - t0;
    return res;
  } finally {
    mat.delete();
  }
}

const letter = (d) => (d.choice == null ? (d.flag === 'blank' ? '-' : '?') : LETTERS[d.choice]);

const { cv } = await loadCv();
console.log(`ตัวอ่านภาพ: ${cv.lite ? 'สำรอง (JavaScript ล้วน)' : 'OpenCV.js'}${Object.keys(BASE).length ? ' ' + JSON.stringify(BASE) : ''}`);
const tpl = OMR.TEMPLATES[0];
const fx = (n) => path.join(root, 'tests/fixtures', n);
const extraDir = process.env.EXTRA_FIXTURES; // รูปเพิ่มเติม (เช่น ภาพหมุน/มืด) สำหรับทดสอบความทนทาน

console.log('ใบเฉลย');
const keyRes = read(cv, fx('key.jpg'));
check(keyRes.ok, `อ่านใบเฉลยได้ (${keyRes.ms} ms)`);
const keyLetters = keyRes.decisions.map(letter).join('');
check(keyLetters === TRUTH['key.jpg'], `เฉลยถูกครบ 60 ข้อ (${keyLetters})`);
check(keyRes.decisions.every((d) => !d.flag), 'ใบเฉลยไม่มีข้อติดธง');
check(OMR.lastMarkedQuestion(keyRes.decisions) === 60, 'เสนอจำนวนข้อ = 60');
const key = keyRes.decisions.map((d) => d.choice);

console.log('กระดาษเปล่า');
const blank = read(cv, fx('blank.jpg'));
check(blank.ok, `อ่านกระดาษเปล่าได้ (${blank.ms} ms)`);
check(blank.decisions.every((d) => d.flag === 'blank'), 'ทุกข้อเป็น "ไม่ได้ตอบ"');
const maxBlankInk = Math.max(...blank.densities.flat());
check(maxBlankInk < OMR.DEFAULTS.minInk, `หมึกในช่องว่างสูงสุด ${maxBlankInk.toFixed(3)} ต่ำกว่าเกณฑ์`);

for (const name of ['student-02.jpg', 'student-05.jpg', 'student-11.jpg']) {
  console.log(name);
  const r = read(cv, fx(name));
  check(r.ok, `อ่านได้ (${r.ms} ms)`);
  if (!r.ok) continue;
  const got = r.decisions.map(letter).join('');
  check(got === TRUTH[name], `คำตอบตรงทุกข้อ (${got})`);
  const flags = {};
  r.decisions.forEach((d, i) => { if (d.flag) flags[i + 1] = d.flag; });
  const want = EXPECTED_FLAGS[name] || {};
  check(JSON.stringify(flags) === JSON.stringify(want), `ข้อที่ติดธง ${JSON.stringify(flags)}`);
  const items = r.decisions.map((d) => ({ choice: d.choice, flag: d.flag, resolved: false }));
  const provisional = OMR.grade(key, items, 60);
  const confirmed = OMR.grade(key, items.map((it) => Object.assign({}, it, { resolved: true })), 60);
  check(confirmed.correct === EXPECTED_SCORES[name],
    `คะแนนหลังยืนยัน ${confirmed.correct}/60 (ชั่วคราว ${provisional.correct}, รอยืนยัน ${provisional.pending})`);
}

console.log('จำนวนข้อน้อยกว่าแบบฟอร์ม (40 ข้อ)');
{
  const r = read(cv, fx('student-05.jpg'));
  const items = r.decisions.map((d) => ({ choice: d.choice, flag: d.flag, resolved: true }));
  const g40 = OMR.grade(key, items, 40);
  const manual = [...TRUTH['student-05.jpg'].slice(0, 40)].filter((c, i) => c === TRUTH['key.jpg'][i]).length;
  check(g40.total === 40 && g40.correct === manual, `ตรวจเฉพาะข้อ 1–40 ได้ ${g40.correct}/40`);
}

console.log('ภาพหมุน 90°/180°/270° (แอปต้องหมุนกลับให้เอง ไม่อ่านคำตอบสลับข้อ)');
for (const name of ['key.jpg', 'student-05.jpg', 'blank.jpg']) {
  for (const [label, code] of [['90°', cv.ROTATE_90_CLOCKWISE], ['180°', cv.ROTATE_180], ['270°', cv.ROTATE_90_COUNTERCLOCKWISE]]) {
    const mat = loadImage(cv, fx(name));
    const rot = new cv.Mat();
    cv.rotate(mat, rot, code);
    mat.delete();
    const r = OMR.readSheet(cv, rot, tpl, BASE);
    rot.delete();
    const got = r.ok ? r.decisions.map(letter).join('') : '';
    const want = name === 'blank.jpg' ? '-'.repeat(60) : TRUTH[name];
    check(r.ok && got === want && !r.warning,
      `${name} หมุน ${label}: ${r.ok ? `${[...got].filter((c, i) => c === want[i]).length}/60` : 'อ่านไม่ได้'}` +
      (r.orientation ? ` (หัวตาราง ${r.orientation.top.toFixed(2)} / ท้ายตาราง ${r.orientation.bottom.toFixed(2)})` : ''));
  }
}
{
  const r = read(cv, fx('student-02.jpg'));
  check(r.orientation && r.orientation.upright && r.rotation === 0,
    `ภาพปกติไม่ถูกหมุน (หัวตาราง ${r.orientation.top.toFixed(2)} / ท้ายตาราง ${r.orientation.bottom.toFixed(2)})`);
}

console.log('ตรวจหาโครงตารางจากรูปกระดาษเปล่า (ใช้ตอนเพิ่มแบบฟอร์มใหม่)');
const shapeOf = (t) => `${t.blocks}×${t.rowsPerBlock} ตัวเลือก ${t.choices} หัวตาราง ${t.headerRows}${t.numberColumn ? ' มีคอลัมน์เลขข้อ' : ''}`;
{
  const mat = loadImage(cv, fx('blank.jpg'));
  const r = OMR.inferTemplate(cv, mat, BASE);
  mat.delete();
  check(r.ok && shapeOf(r.template) === shapeOf(tpl), `กระดาษจริง 60 ข้อ: ${r.ok ? shapeOf(r.template) : r.error}`);
}
const synth = JSON.parse(readFileSync(fx('synth-truth.json'), 'utf8'));
for (const [id, T] of Object.entries(synth)) {
  const t = OMR.TEMPLATES.find((x) => x.id === id);
  const mat = loadImage(cv, fx(`synth-${id}-blank.jpg`));
  const r = OMR.inferTemplate(cv, mat, BASE);
  mat.delete();
  check(r.ok && shapeOf(r.template) === shapeOf(t), `กระดาษจำลอง ${id}: ${r.ok ? shapeOf(r.template) : r.error}`);
}

console.log('อ่านกระดาษจำลองที่มีข้อมากกว่า 60 ข้อ');
for (const [id, T] of Object.entries(synth)) {
  const t = OMR.TEMPLATES.find((x) => x.id === id);
  for (const kind of ['key', 'student']) {
    const mat = loadImage(cv, fx(`synth-${id}-${kind}.jpg`));
    const r = OMR.readSheet(cv, mat, t, BASE);
    mat.delete();
    const got = r.ok ? r.decisions.map(letter).join('') : '';
    const want = T[kind];
    const n = [...got].filter((c, i) => c === want[i]).length;
    check(r.ok && got === want, `${id} ${kind === 'key' ? 'ใบเฉลย' : 'นักศึกษา'}: ${r.ok ? `${n}/${want.length}` : 'อ่านไม่ได้'}`);
    if (kind === 'student' && r.ok) {
      const flags = {};
      r.decisions.forEach((d, i) => { if (d.flag) flags[i + 1] = d.flag; });
      check(JSON.stringify(flags) === JSON.stringify(T.flags), `${id} ข้อที่ติดธงตรงกับที่จำลองไว้ (${Object.keys(flags).length} ข้อ)`);
    }
  }
}

console.log('ลำดับเลขข้อและการตรวจแบบฟอร์ม');
{
  const across = OMR.normalizeTemplate({ blocks: 4, rowsPerBlock: 25, choices: 4, headerRows: 1, order: 'across' });
  const pos = [1, 2, 5, 100].map((q) => OMR.cellOf(across, q, 0));
  check(JSON.stringify(pos) === JSON.stringify([{ row: 1, col: 1 }, { row: 1, col: 6 }, { row: 2, col: 1 }, { row: 25, col: 16 }]),
    'เลขข้อเรียงตามแถว (1 2 3 4 / 5 6 7 8 …) จับคู่ช่องถูกต้อง');
  const down = OMR.normalizeTemplate({ blocks: 4, rowsPerBlock: 25, choices: 4, headerRows: 1 });
  check(OMR.cellOf(down, 26, 0).col === 6 && OMR.cellOf(down, 26, 0).row === 1, 'เลขข้อเรียงลงตามคอลัมน์ (ข้อ 26 อยู่ต้นชุดที่ 2)');
  check(OMR.validateTemplate(down).length === 0, 'แบบฟอร์ม 100 ข้อผ่านการตรวจ');
  check(OMR.validateTemplate(OMR.normalizeTemplate({ blocks: 10, rowsPerBlock: 60, choices: 5, headerRows: 1 })).length > 0,
    'แบบฟอร์มเกิน 300 ข้อถูกปฏิเสธ');
  const n = OMR.normalizeTemplate({ blocks: '3', rowsPerBlock: 99, choices: 1, headerRows: -2 });
  check(n.blocks === 3 && n.rowsPerBlock === 60 && n.choices === 2 && n.headerRows === 0, 'ค่าที่กรอกเกินช่วงถูกปรับให้อยู่ในช่วงที่รองรับ');
}

if (extraDir) {
  const { readdirSync } = await import('node:fs');
  console.log('รูปทดสอบความทนทาน: ' + extraDir);
  for (const f of readdirSync(extraDir).filter((f) => f.endsWith('.jpg')).sort()) {
    const r = read(cv, path.join(extraDir, f));
    const base = f.split('__')[0] + '.jpg';
    const got = r.ok ? r.decisions.map(letter).join('') : '';
    const truth = TRUTH[base];
    const n = r.ok ? [...got].filter((c, i) => c === truth[i]).length : 0;
    check(r.ok && got === truth, `${f}: ${r.ok ? n + '/60' : 'อ่านไม่ได้ (' + r.error + ')'}`);
  }
}

console.log(failures ? `\nไม่ผ่าน ${failures} รายการ` : '\nผ่านทั้งหมด');
process.exit(failures ? 1 : 0);
