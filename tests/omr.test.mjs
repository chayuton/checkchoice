// ชุดทดสอบแกนอ่านกระดาษคำตอบ: รันด้วย `npm test`
// ใช้ OpenCV.js ตัวเดียวกับในเว็บแอป และรูปถ่ายกระดาษจริงใน tests/fixtures
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
function loadCv() {
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

function read(cv, file, extra) {
  const mat = loadImage(cv, file);
  try {
    const t0 = Date.now();
    const res = OMR.readSheet(cv, mat, OMR.TEMPLATES[0], extra);
    res.ms = Date.now() - t0;
    return res;
  } finally {
    mat.delete();
  }
}

const letter = (d) => (d.choice == null ? (d.flag === 'blank' ? '-' : '?') : LETTERS[d.choice]);

const { cv } = await loadCv();
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
    const r = OMR.readSheet(cv, rot, tpl);
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
