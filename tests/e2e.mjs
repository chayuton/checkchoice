// ทดสอบทั้งระบบบนเบราว์เซอร์จริง (Chromium) — รันด้วย `npm run test:e2e`
// สร้างชุดข้อสอบจากรูปใบเฉลย ตรวจกระดาษ 3 แผ่นด้วยการเลือกรูป, 1 แผ่นด้วยกล้องสด (ถ้ากำหนด FAKE_VIDEO)
// ส่งออก Excel/ไฟล์สำรอง และทดสอบการเปิดแบบออฟไลน์
// รับชุดข้อสอบจากเครื่องอื่น: สแกน QR code ด้วยกล้องจำลองในแอป รูปถ่าย QR code และวางลิงก์
import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = process.env.E2E_OUT || path.join(root, 'test-results');
mkdirSync(out, { recursive: true });
const fx = (n) => path.join(root, 'tests/fixtures', n);

const TRUTH = {
  key: 'BCDBCBACBDACADC' + 'ADCBCABCABACBCD' + 'BDADBADCDBABCAD' + 'ACBDCACDADBADBD',
  2: 'BCDBABADBABCADC' + 'CBCADABCAAADBCD' + 'CAABBDAADBBBDAD' + 'DBBCDCBDADBCBDC',
  5: 'CCABCCAACBAADDA' + 'BCBAABBDBBCCBDC' + 'ABBDCCBBDDCABBB' + 'CCBABBCDABBCBDA',
  11: 'BCBDABACBAACAAC' + 'DCBDBBBDDBCCBCD' + 'DCACDACCBBBBDAD' + 'DDAADCABADDAAAB',
};
const scoreFor = (no, n = 60) => [...TRUTH[no].slice(0, n)].filter((c, i) => c === TRUTH.key[i]).length;

// ---------------------------------------------------------------- QR code ที่ "ส่งมาจากอีกเครื่อง"
const require = createRequire(import.meta.url);
const OMR = require(path.join(root, 'js/omr/core.js'));
const { importLink, encodeExamLegacy } = await import(pathToFileURL(path.join(root, 'js/transfer.js')).href);
const { qrImage, cameraShot, readJPEG, writeJPEG, writeY4M } = await import(pathToFileURL(path.join(root, 'tests/qr-photo.mjs')).href);
const sentExam = {
  id: 'ex_e2esent00000001', courseCode: '04-012-399', courseName: 'สัมมนาเทคโนโลยี', examName: 'สอบย่อยที่ส่งมา',
  template: OMR.TEMPLATES[0], questionCount: 60, maxStudentNo: 40, key: [...TRUTH.key].map((c) => 'ABCDE'.indexOf(c)),
};
const sentLink = importLink(sentExam, 'https://checkchoice.vercel.app/');
// รูปถ่ายหน้าจอที่มี QR code (ถือเอียงเล็กน้อย) และรูป QR code ของเว็บอื่น
const qrPhoto = path.join(out, 'qr-photo.jpg');
writeJPEG(qrPhoto, cameraShot(qrImage(sentLink), { W: 2000, H: 1500, cover: 0.42, tilt: 0.07, rotate: -5, blur: 1, noise: 4, seed: 21 }));
const otherQrPhoto = path.join(out, 'qr-other.jpg');
writeJPEG(otherQrPhoto, cameraShot(qrImage('https://example.com/menu?table=12'), { W: 1600, H: 1200, cover: 0.45, seed: 22 }));
const keyOnPage = (p) => p.$$eval('.answer-grid .grid-row:not(.grid-head)', (rows) => rows.map((r) => {
  const i = [...r.querySelectorAll('.cell-choice')].findIndex((c) => c.classList.contains('sel'));
  return i < 0 ? '-' : 'ABCDE'[i];
}).join(''));

// ---------------------------------------------------------------- เว็บเซิร์ฟเวอร์ไฟล์นิ่ง
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.txt': 'text/plain',
};
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let p = path.normalize(path.join(root, decodeURIComponent(u.pathname)));
  if (!p.startsWith(root)) { res.writeHead(403).end(); return; }
  if (existsSync(p) && statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!existsSync(p)) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

let failures = 0;
const check = (cond, msg) => { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } };

const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
if (process.env.FAKE_VIDEO) args.push(`--use-file-for-fake-video-capture=${process.env.FAKE_VIDEO}`);
// ต้องใช้ locale แบบ UTF-8 ไม่เช่นนั้น Chromium จะเปลี่ยนชื่อไฟล์ภาษาไทยที่ดาวน์โหลดเป็น "download"
const browser = await chromium.launch({ args, env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  acceptDownloads: true, locale: 'th-TH', permissions: ['camera'],
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
const chooseFile = async (buttonText, file) => {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: buttonText }).click()]);
  await chooser.setFiles(file);
};

try {
  console.log('จำลอง iPhone ที่เปิดโหมดล็อกดาวน์: ไม่มี IndexedDB, WebAssembly, JIT และกล้องสด');
  {
    // --jitless ปิด JIT และ WebAssembly ของ V8 ทั้งในหน้าเว็บและ worker เหมือนโหมดล็อกดาวน์ของ Safari
    const lockBrowser = await chromium.launch({ args: ['--js-flags=--jitless'], env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
    const ctx = await lockBrowser.newContext({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'th-TH',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    });
    await ctx.addInitScript(() => {
      // ?exclude=1 จำลองการปิดโหมดล็อกดาวน์เฉพาะเว็บนี้ (กลับมามี IndexedDB)
      if (new URLSearchParams(location.search).has('exclude')) return;
      Object.defineProperty(window, 'indexedDB', { get: () => undefined, configurable: true });
      if (navigator.mediaDevices) Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: undefined, configurable: true });
    });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    const pick = async (buttonText, file) => {
      const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.getByRole('button', { name: buttonText }).click()]);
      await chooser.setFiles(file);
    };
    await p.goto(base);
    await p.locator('#limited-notice').waitFor({ timeout: 60000 });
    const note = await p.locator('#limited-notice').innerText();
    check(/โหมดล็อกดาวน์/.test(note) && /ช้าลง/.test(note) && /กล้องสด/.test(note), 'เปิดแอปได้ในโหมดจำกัด พร้อมบอกว่าขาดอะไร');
    await p.getByRole('button', { name: 'วิธีใช้เต็มความสามารถ' }).click();
    check(/การตั้งค่าเว็บไซต์/.test(await p.locator('#limited-notice').innerText()), 'บอกวิธีปิดโหมดล็อกดาวน์เฉพาะเว็บนี้ (ไม่ต้องปิดทั้งเครื่อง)');
    await p.screenshot({ path: path.join(out, '00-lockdown-home.png'), fullPage: true });

    await p.locator('#choice-new').click();
    await p.locator('#f-code').fill('04-012-301');
    await p.locator('#f-name').fill('เทคโนโลยีสารสนเทศ');
    await p.locator('#f-exam').fill('สอบย่อย');
    let t0 = Date.now();
    await pick('เลือกรูปจากเครื่อง', fx('key.jpg'));
    await p.locator('.key-status.ok, .key-status.error').first().waitFor({ timeout: 240000 });
    const keyMs = Date.now() - t0;
    const lkKey = await p.$$eval('.answer-grid .grid-row:not(.grid-head)', (rows) => rows.map((r) => {
      const i = [...r.querySelectorAll('.cell-choice')].findIndex((c) => c.classList.contains('sel'));
      return i < 0 ? '-' : 'ABCDE'[i];
    }).join(''));
    check(lkKey === TRUTH.key, `อ่านใบเฉลยด้วยตัวอ่านภาพสำรองถูกทุกข้อ (${(keyMs / 1000).toFixed(1)} วินาที ไม่มี JIT)`);
    await p.getByRole('button', { name: 'บันทึกแล้วเริ่มตรวจ' }).click();
    await p.locator('#student-no').waitFor();
    const lkExam = p.url().split('#/exam/')[1].split('/')[0];
    check(await p.locator('.segmented').isHidden(), 'ซ่อนโหมดกล้องสดเมื่อเบราว์เซอร์ไม่ให้ใช้กล้องสด');
    t0 = Date.now();
    await pick('เลือกรูปจากเครื่อง', fx('student-02.jpg'));
    await p.locator('.score-big').waitFor({ timeout: 240000 });
    const scanMs = Date.now() - t0;
    const lkScore = Number(await p.locator('.score-big').textContent());
    check(lkScore === scoreFor(2), `ตรวจกระดาษได้ ${lkScore} คะแนน (คาดไว้ ${scoreFor(2)}) ใช้เวลา ${(scanMs / 1000).toFixed(1)} วินาที`);
    await p.screenshot({ path: path.join(out, '00-lockdown-review.png'), fullPage: true });
    await p.locator('#btn-save').click();
    await p.getByText('บันทึกเลขที่ 1 แล้ว').waitFor();

    await p.reload();
    await p.goto(base + `#/exam/${lkExam}/results`);
    await p.locator('.score-table').waitFor();
    const lkRows = await p.$$eval('.score-table tbody tr', (trs) => trs.map((tr) => [tr.cells[0].textContent.trim(), tr.cells[1].textContent.trim()]));
    check(JSON.stringify(lkRows) === JSON.stringify([['1', `${scoreFor(2)}/60`]]), `โหลดหน้าใหม่แล้วข้อมูลยังอยู่ (ที่เก็บสำรอง) ${JSON.stringify(lkRows)}`);
    await p.goto(base + `#/exam/${lkExam}/result/1`);
    await p.locator('.score-big').waitFor();
    check(await p.locator('.sheet-figure').count() === 1, 'รูปกระดาษที่ตรวจแล้วยังอยู่ (Cache Storage)');
    await p.goto(base + '#/settings');
    await p.locator('#device-status').waitFor();
    check(/สำรอง/.test(await p.locator('#device-status').innerText()), 'หน้าตั้งค่าบอกว่าใช้ที่เก็บและตัวอ่านภาพสำรอง');

    // รับชุดข้อสอบจากรูปถ่าย QR code: โหมดนี้ไม่มีกล้องสด และอ่าน QR ด้วย jsQR โดยไม่มี JIT
    await p.goto(base + '#/receive');
    await p.locator('#btn-qr-photo').waitFor();
    check(await p.locator('#qr-scan-box').count() === 0 && /btn-primary/.test(await p.locator('#btn-qr-photo').getAttribute('class')),
      'หน้ารับชุดข้อสอบไม่แสดงกล้องสด และเน้นปุ่มถ่ายรูป QR code แทน');
    await p.screenshot({ path: path.join(out, '00-lockdown-receive.png'), fullPage: true });
    t0 = Date.now();
    await pick('เลือกรูปจากเครื่อง', qrPhoto);
    await p.waitForURL(/#\/import\//, { timeout: 120000 });
    const qrMs = Date.now() - t0;
    await p.locator('#btn-import').click();
    await p.locator('#student-no').waitFor();
    check(p.url().includes(`#/exam/${sentExam.id}/scan`), `อ่าน QR code จากรูปถ่ายแล้วนำเข้าชุดข้อสอบได้ (${(qrMs / 1000).toFixed(1)} วินาที ไม่มี JIT)`);

    // ปิดโหมดล็อกดาวน์เฉพาะเว็บนี้: ข้อมูลในที่เก็บสำรองย้ายเข้า IndexedDB
    await p.goto(base + '?exclude=1#/');
    await p.locator('#choice-new').waitFor({ timeout: 60000 });
    const moved = await p.evaluate(() => localStorage.getItem('cc.db.v1.exams') === null);
    check(moved && await p.locator('.exam-item').count() === 2, 'ปิดโหมดล็อกดาวน์เฉพาะเว็บแล้ว ข้อมูลย้ายเข้าที่เก็บปกติครบ (2 ชุดข้อสอบ)');
    await p.goto(base + `?exclude=1#/exam/${lkExam}/result/1`);
    await p.locator('.score-big').waitFor();
    check(await p.locator('.sheet-figure').count() === 1, 'รูปกระดาษย้ายมาด้วย');
    check(errs.length === 0, `ไม่มีข้อผิดพลาดในโหมดจำกัด${errs.length ? ': ' + errs.join(' | ') : ''}`);
    await lockBrowser.close();
  }

  console.log('เบราว์เซอร์ที่ไม่ให้เว็บเก็บข้อมูลเลย');
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'th-TH' });
    await ctx.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', { get: () => undefined, configurable: true });
      Object.defineProperty(window, 'localStorage', { get: () => { throw new DOMException('blocked', 'SecurityError'); }, configurable: true });
    });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(base);
    await p.getByText('เบราว์เซอร์นี้ยังใช้ CheckChoice ไม่ได้').waitFor();
    check(/คุกกี้/.test(await p.locator('#env-help').innerText()), 'แสดงหน้าบอกสาเหตุและวิธีแก้ แทนข้อความผิดพลาด');
    check(errs.length === 0, `ไม่มีข้อผิดพลาดที่ไม่ได้จัดการ${errs.length ? ': ' + errs.join(' | ') : ''}`);
    await p.screenshot({ path: path.join(out, '00-env-help.png'), fullPage: true });
    await ctx.close();
  }

  console.log('อัปเดตจากเวอร์ชันเก่าขณะที่อีกแท็บยังเปิดแอปเดิมค้างไว้');
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'th-TH' });
    const old = await ctx.newPage();
    await old.goto(base + 'icons/icon-192.png');
    // จำลองแท็บของแอปเวอร์ชัน 1.1.0: ฐานข้อมูลเวอร์ชัน 1 ที่ไม่ปิดการเชื่อมต่อเมื่อมีเวอร์ชันใหม่
    await old.evaluate(() => new Promise((resolve, reject) => {
      const r = indexedDB.open('checkchoice', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('exams', { keyPath: 'id' });
        d.createObjectStore('results', { keyPath: 'id' }).createIndex('examId', 'examId', { unique: false });
        d.createObjectStore('blobs', { keyPath: 'id' });
      };
      r.onsuccess = () => { window.oldDb = r.result; resolve(); };
      r.onerror = () => reject(r.error);
    }));
    const p = await ctx.newPage();
    await p.goto(base);
    await p.locator('#db-blocked').waitFor({ timeout: 20000 });
    check(true, 'แจ้งให้ปิดแท็บเวอร์ชันเก่า แทนการค้างเป็นหน้าว่าง');
    await p.screenshot({ path: path.join(out, '00b-db-blocked.png') });
    await old.close();
    await p.locator('#choice-new').waitFor({ timeout: 20000 });
    const stores = await p.evaluate(() => new Promise((resolve) => {
      const r = indexedDB.open('checkchoice');
      r.onsuccess = () => { const d = r.result; const v = [d.version, [...d.objectStoreNames].join(',')]; d.close(); resolve(v); };
    }));
    check(await p.locator('#db-blocked').count() === 0 && stores[0] === 2 && /templates/.test(stores[1]),
      `ปิดแท็บเก่าแล้วแอปเปิดต่อเอง ฐานข้อมูลเป็นเวอร์ชัน ${stores[0]} (${stores[1]})`);
    await ctx.close();
  }

  console.log('หน้าแรก');
  await page.goto(base);
  await page.locator('#choice-new').waitFor();
  const libMeta = await page.locator('#choice-library').innerText();
  check(/เปิดจากคลังเฉลย/.test(libMeta) && /ยังไม่มีเฉลย/.test(libMeta), 'หน้าแรกมีทางเลือก "เปิดจากคลังเฉลย" และ "สร้างเฉลยใหม่"');
  await shot('01-home-empty');

  console.log('สร้างชุดข้อสอบจากรูปใบเฉลย');
  await page.locator('#choice-new').click();
  await page.locator('#f-template').waitFor();
  check(await page.locator('#f-template option').count() >= 3, 'เลือกแบบฟอร์มได้อย่างน้อย 3 แบบ (60/100/120 ข้อ)');
  await page.locator('#f-code').fill('04-012-301');
  await page.locator('#f-name').fill('เทคโนโลยีสารสนเทศ');
  await page.locator('#f-exam').fill('สอบกลางภาค 1/2569');
  await chooseFile('เลือกรูปจากเครื่อง', fx('key.jpg'));
  await page.locator('.key-status.ok').waitFor({ timeout: 90000 });
  const summary = await page.locator('.key-summary').textContent();
  check(/มีเฉลยแล้ว 60 จาก 60 ข้อ/.test(summary), `อ่านเฉลยได้ครบ (${summary.trim()})`);
  const keyFromGrid = await page.$$eval('.answer-grid .grid-row:not(.grid-head)', (rows) => rows.map((r) => {
    const cells = [...r.querySelectorAll('.cell-choice')];
    const i = cells.findIndex((c) => c.classList.contains('sel'));
    return i < 0 ? '-' : 'ABCDE'[i];
  }).join(''));
  check(keyFromGrid === TRUTH.key, 'ตารางเฉลยตรงกับใบเฉลยทุกข้อ');
  await shot('02-key-read');
  await page.getByRole('button', { name: 'บันทึกแล้วเริ่มตรวจ' }).click();
  await page.locator('#student-no').waitFor();
  check(page.url().includes('/scan'), 'บันทึกแล้วไปหน้าตรวจ');
  const examId = page.url().split('#/exam/')[1].split('/')[0];

  console.log('ส่งชุดข้อสอบไปอีกเครื่องด้วย QR code / ลิงก์');
  await page.goto(base + `#/exam/${examId}`);
  await page.locator('#btn-transfer').click();
  await page.locator('#transfer-dialog').waitFor();
  const link = await page.locator('#transfer-link').inputValue();
  check(link.startsWith(base + '#/import/'), `สร้างลิงก์สำหรับเครื่องอื่น (${link.length} ตัวอักษร)`);
  await page.locator('#transfer-dialog .qr-canvas').screenshot({ path: path.join(out, 'qr.png') });
  await page.screenshot({ path: path.join(out, '02b-transfer.png') });
  const dec = spawnSync('python3', ['-c',
    // เติมขอบขาวรอบภาพเหมือนพื้นที่รอบ QR ที่กล้องมือถือเห็นจริง
    'import cv2,sys; im=cv2.imread(sys.argv[1]); im=cv2.copyMakeBorder(im,40,40,40,40,cv2.BORDER_CONSTANT,value=(255,255,255)); t,_,_=cv2.QRCodeDetector().detectAndDecode(im); print(t)',
    path.join(out, 'qr.png')], { encoding: 'utf8' });
  if (dec.status === 0) check(dec.stdout.trim() === link, 'QR code สแกนได้และได้ลิงก์เดียวกัน');
  check(/#\/import\/2[0-9A-Z]+$/.test(link), 'ลิงก์แบบย่อ (ตัวพิมพ์ใหญ่และตัวเลขล้วน ใช้โหมด Alphanumeric ของ QR code)');
  await page.locator('#btn-qr-zoom').click();
  await page.locator('#qr-full').waitFor();
  const fullSize = await page.locator('#qr-full canvas').evaluate((c) => c.getBoundingClientRect().width);
  await page.screenshot({ path: path.join(out, '02b-qr-full.png') });
  await page.locator('#qr-full').click();
  await page.locator('#qr-full').waitFor({ state: 'detached' });
  check(fullSize > 300 && await page.locator('#transfer-dialog').isVisible(),
    `แตะ QR code แล้วขยายเต็มจอ (${Math.round(fullSize)} px) แตะอีกครั้งกลับมาที่กล่องเดิม`);
  // กล้องมือถืออีกเครื่องที่เล็งมายัง QR บนหน้าจอนี้ (มือสั่นเล็กน้อย เอียง เบลอ และมีสัญญาณรบกวน)
  const qrOnScreen = readJPEG(await page.locator('#transfer-dialog .qr-canvas').screenshot({ type: 'jpeg', quality: 92 }));
  const camVideo = path.join(out, 'qr-camera.y4m');
  writeY4M(camVideo, [0, 1, 2, 3, 4, 5].map((i) => cameraShot(qrOnScreen,
    { W: 1280, H: 720, cover: 0.5 + i * 0.01, rotate: 4 - i, tilt: 0.05, offset: [0.003 * i, -0.002 * i], blur: 1, noise: 3, seed: 30 + i })));
  await page.getByRole('button', { name: 'เสร็จแล้ว' }).click();
  {
    // อีกเครื่องหนึ่ง = context ใหม่ที่ไม่มีข้อมูลใด ๆ
    const other = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'th-TH' });
    const p2 = await other.newPage();
    await p2.goto(link);
    await p2.locator('#btn-import').waitFor();
    await p2.screenshot({ path: path.join(out, '02c-import.png'), fullPage: true });
    await p2.locator('#btn-import').click();
    await p2.locator('#student-no').waitFor();
    check(p2.url().includes(`#/exam/${examId}/scan`), 'นำเข้าแล้วไปหน้าตรวจของชุดข้อสอบเดียวกัน');
    await p2.goto(base + `#/exam/${examId}`);
    await p2.locator('.answer-grid').waitFor();
    const key2 = await p2.$$eval('.answer-grid .grid-row:not(.grid-head)', (rows) => rows.map((r) => {
      const i = [...r.querySelectorAll('.cell-choice')].findIndex((c) => c.classList.contains('sel'));
      return i < 0 ? '-' : 'ABCDE'[i];
    }).join(''));
    check(key2 === TRUTH.key, 'เครื่องปลายทางได้เฉลยครบ 60 ข้อ ตรงกับต้นฉบับ');
    await p2.goto(link);
    await p2.locator('#btn-import').waitFor();
    check((await p2.locator('#btn-import').innerText()).includes('อัปเดต'), 'เปิดลิงก์ซ้ำ แอปรู้ว่ามีชุดข้อสอบนี้แล้ว');
    await other.close();
  }

  console.log('รับชุดข้อสอบด้วยการสแกน QR code ในแอป (มือถืออีกเครื่อง กล้องจำลองเล็งที่ QR บนหน้าจอ)');
  {
    const camBrowser = await chromium.launch({
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${camVideo}`],
      env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
    });
    const ctx = await camBrowser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'th-TH', permissions: ['camera'] });
    // จดสตรีมกล้องทุกตัวที่แอปเปิด เพื่อตรวจว่าปิดกล้องแล้วหลังสแกนติด
    await ctx.addInitScript(() => {
      const md = navigator.mediaDevices;
      if (!md || !md.getUserMedia) return;
      const orig = md.getUserMedia.bind(md);
      window.__ccStreams = [];
      md.getUserMedia = async (c) => { const st = await orig(c); window.__ccStreams.push(st); return st; };
    });
    const p3 = await ctx.newPage();
    const errs3 = [];
    p3.on('pageerror', (e) => errs3.push(e.message));
    p3.on('console', (m) => { if (m.type() === 'error') errs3.push(m.text()); });
    await p3.goto(base);
    await p3.locator('#choice-receive').click();
    await p3.locator('#qr-scan-box').waitFor();
    const t0 = Date.now();
    await p3.waitForURL(/#\/import\//, { timeout: 30000 });
    const ms = Date.now() - t0;
    await p3.locator('#btn-import').waitFor();
    check(ms < 30000, `สแกน QR code ด้วยกล้องในแอปติดใน ${(ms / 1000).toFixed(1)} วินาที แล้วไปหน้านำเข้าเอง`);
    check(await p3.evaluate(() => window.__ccStreams.length > 0
      && window.__ccStreams.every((st) => st.getTracks().every((t) => t.readyState === 'ended'))), 'ปิดกล้องทันทีหลังสแกนติด');
    await p3.screenshot({ path: path.join(out, '02d-scanned-import.png'), fullPage: true });
    await p3.locator('#btn-import').click();
    await p3.locator('#student-no').waitFor();
    check(p3.url().includes(`#/exam/${examId}/scan`), 'นำเข้าแล้วพร้อมตรวจกระดาษบนมือถือเครื่องนี้');
    await p3.goto(base + `#/exam/${examId}`);
    await p3.locator('.answer-grid').waitFor();
    check(await keyOnPage(p3) === TRUTH.key, 'มือถือที่สแกนได้เฉลยครบ 60 ข้อ ตรงกับต้นฉบับ');
    check(errs3.length === 0, `ไม่มีข้อผิดพลาดระหว่างสแกน${errs3.length ? ': ' + errs3.join(' | ') : ''}`);
    await camBrowser.close();
  }

  console.log('รับชุดข้อสอบด้วยลิงก์และรูปภาพ');
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'th-TH', permissions: ['camera'] });
    const p4 = await ctx.newPage();
    const errs4 = [];
    p4.on('pageerror', (e) => errs4.push(e.message));
    p4.on('console', (m) => { if (m.type() === 'error') errs4.push(m.text()); });
    const statusText = () => p4.locator('#receive-status').textContent();
    const pickQR = async (file) => {
      const [chooser] = await Promise.all([p4.waitForEvent('filechooser'), p4.locator('#btn-qr-pick').click()]);
      await chooser.setFiles(file);
    };
    await p4.goto(base + '#/receive');
    await p4.locator('#receive-link').waitFor();
    await p4.locator('#receive-link').fill('https://example.com/abc');
    await p4.locator('#btn-open-link').click();
    check(/ไม่ใช่ลิงก์ชุดข้อสอบ/.test(await statusText()), 'วางลิงก์เว็บอื่น: บอกว่าไม่ใช่ลิงก์ชุดข้อสอบ');
    await p4.locator('#receive-link').fill(link.slice(0, -15));
    await p4.locator('#btn-open-link').click();
    check(/ไม่ถูกต้องหรือไม่ครบ/.test(await statusText()), 'วางลิงก์ที่คัดลอกมาไม่ครบ: บอกให้คัดลอกใหม่');
    await pickQR(otherQrPhoto);
    await p4.waitForFunction(() => /ไม่ใช่ชุดข้อสอบของ CheckChoice/.test(document.getElementById('receive-status').textContent), null, { timeout: 30000 });
    check(p4.url().endsWith('#/receive'), 'รูป QR code ของเว็บอื่น: บอกว่าไม่ใช่ชุดข้อสอบ และยังอยู่หน้าเดิม');
    await p4.locator('#receive-link').fill(`ชุดข้อสอบกลางภาค ${link} ส่งจาก CheckChoice`);
    await p4.locator('#btn-open-link').click();
    await p4.waitForURL(/#\/import\//);
    await p4.locator('#btn-import').waitFor();
    check(/สอบกลางภาค 1\/2569/.test(await p4.locator('main').innerText()), 'วางข้อความที่มีลิงก์ปนอยู่ (คัดลอกจาก LINE) แล้วเปิดหน้านำเข้าได้');
    await p4.goto(base + '#/receive');
    await pickQR(qrPhoto);
    await p4.waitForURL(/#\/import\//, { timeout: 30000 });
    await p4.locator('#btn-import').waitFor();
    check(/สอบย่อยที่ส่งมา/.test(await p4.locator('main').innerText()), 'เลือกรูปถ่าย QR code แล้วเปิดหน้านำเข้าชุดข้อสอบที่ถูกต้อง');
    await p4.goto(base + '#/import/' + encodeExamLegacy(sentExam));
    await p4.locator('#btn-import').waitFor();
    check(/สอบย่อยที่ส่งมา/.test(await p4.locator('main').innerText()), 'ลิงก์แบบเดิมจากแอปเวอร์ชันก่อนยังนำเข้าได้');
    check(errs4.length === 0, `ไม่มีข้อผิดพลาด${errs4.length ? ': ' + errs4.join(' | ') : ''}`);
    await ctx.close();
  }
  {
    // ตัวอ่าน QR ของเบราว์เซอร์ (BarcodeDetector เช่น Chrome บน Android) จำลองให้อ่านเจอในเฟรมที่ 3
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'th-TH', permissions: ['camera'] });
    await ctx.addInitScript((text) => {
      window.__bdCalls = [];
      window.BarcodeDetector = class {
        static async getSupportedFormats() { return ['qr_code', 'ean_13']; }
        async detect(src) {
          window.__bdCalls.push(src && src.tagName);
          return window.__bdCalls.length >= 3 ? [{ rawValue: text, format: 'qr_code' }] : [];
        }
      };
    }, sentLink);
    const p5 = await ctx.newPage();
    await p5.goto(base + '#/receive');
    await p5.waitForURL(/#\/import\//, { timeout: 15000 });
    const calls = await p5.evaluate(() => window.__bdCalls);
    check(calls.length >= 3 && calls.every((t) => t === 'VIDEO'), `ใช้ตัวอ่าน QR ของเบราว์เซอร์กับภาพจากกล้องเมื่อมี (${calls.length} เฟรม)`);
    await ctx.close();
  }
  {
    // iPhone: ลิงก์ที่เปิดใน Safari (เช่น สแกนด้วยแอปกล้อง) บอกวิธีพาชุดข้อสอบเข้าแอปบนหน้าจอโฮม
    const iosUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    const opts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'th-TH', userAgent: iosUA };
    const safari = await browser.newContext(opts);
    const p6 = await safari.newPage();
    await p6.goto(importLink(sentExam, base));
    await p6.locator('#btn-import').waitFor();
    check(await p6.locator('#ios-app-note').isVisible() && await p6.locator('#btn-copy-import-link').isVisible(),
      'iPhone (Safari): บอกว่า Safari เก็บข้อมูลแยกจากแอปบนหน้าจอโฮม พร้อมปุ่มคัดลอกลิงก์ไปวางในแอป');
    await p6.screenshot({ path: path.join(out, '02e-import-ios-safari.png'), fullPage: true });
    const app = await browser.newContext(opts);
    await app.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
    const p7 = await app.newPage();
    await p7.goto(importLink(sentExam, base));
    await p7.locator('#btn-import').waitFor();
    check(await p7.locator('#ios-app-note').count() === 0, 'เปิดในแอปบนหน้าจอโฮมแล้ว ไม่แสดงคำแนะนำนี้');
    await safari.close();
    await app.close();
  }
  console.log('ลบทั้งรายวิชาในที่เก็บสำรอง (เบราว์เซอร์ที่ไม่มี IndexedDB)');
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'th-TH' });
    await ctx.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { get: () => undefined, configurable: true }); });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(link);
    await p.locator('#btn-import').click();
    await p.locator('#student-no').waitFor();
    const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.getByRole('button', { name: 'เลือกรูปจากเครื่อง' }).click()]);
    await chooser.setFiles(fx('student-02.jpg'));
    await p.locator('.score-big').waitFor({ timeout: 90000 });
    await p.locator('#btn-save').click();
    await p.getByText('บันทึกเลขที่ 1 แล้ว').waitFor();
    // ชุดที่สองของวิชาเดียวกัน (แตะเฉลยเอง 1 ข้อ)
    await p.goto(base + '#/exam/new');
    await p.locator('#f-code').fill('04-012-301');
    await p.locator('#f-name').fill('เทคโนโลยีสารสนเทศ');
    await p.locator('#f-exam').fill('สอบย่อย 2');
    await p.locator('#f-count').fill('1');
    await p.locator('.answer-grid .cell-choice').first().click();
    await p.getByRole('button', { name: 'บันทึกแล้วเริ่มตรวจ' }).click();
    await p.locator('#student-no').waitFor();
    await p.goto(base + '#/library');
    await p.locator('.course-delete').waitFor();
    check(await p.locator('.library-list .exam-item').count() === 2, 'คลังเฉลยมี 2 ชุดในวิชาเดียวกัน');
    await p.locator('.course-delete').click();
    const dlg = await p.locator('dialog').innerText();
    check(/ลบทุกชุดข้อสอบของวิชานี้/.test(dlg) && /สอบย่อย 2/.test(dlg) && /ผลตรวจ 1 คน/.test(dlg), 'ลบทั้งวิชา: กล่องยืนยันบอกชื่อทุกชุดและจำนวนผลตรวจ');
    await p.locator('dialog').getByRole('button', { name: 'ลบทั้ง 2 ชุด', exact: true }).click();
    await p.getByText('ได้พื้นที่คืนประมาณ').waitFor();
    await p.locator('.empty').waitFor();
    const leftover = await p.evaluate(async () => {
      const exams = Object.keys(JSON.parse(localStorage.getItem('cc.db.v1.exams') || '{}')).length;
      const results = Object.keys(JSON.parse(localStorage.getItem('cc.db.v1.results') || '{}')).length;
      const files = (await (await caches.open('cc-files-v1')).keys()).map((r) => decodeURIComponent(r.url)).filter((u) => /__files\/(res|key):/.test(u)).length;
      return { exams, results, files };
    });
    check(leftover.exams === 0 && leftover.results === 0 && leftover.files === 0,
      `ลบข้อมูลและรูปในที่เก็บสำรองหมด (${JSON.stringify(leftover)})`);
    check(errs.length === 0, `ไม่มีข้อผิดพลาด${errs.length ? ': ' + errs.join(' | ') : ''}`);
    await ctx.close();
  }

  await page.goto(base + `#/exam/${examId}/scan`);
  await page.locator('#student-no').waitFor();

  console.log('ตรวจกระดาษด้วยการเลือกรูป');
  for (const no of [2, 5, 11]) {
    await page.locator('#student-no').selectOption(String(no));
    await chooseFile('เลือกรูปจากเครื่อง', fx(`student-${String(no).padStart(2, '0')}.jpg`));
    await page.locator('.score-big').waitFor({ timeout: 90000 });
    const provisional = Number(await page.locator('.score-big').textContent());
    const pendingRows = await page.locator('.grid-row.is-pending').count();
    if (no === 5) {
      check(pendingRows === 4 && provisional === 17, `เลขที่ 5 ติดธง ${pendingRows} ข้อ คะแนนชั่วคราว ${provisional}`);
      check(await page.locator('#btn-save').isDisabled(), 'ปุ่มบันทึกกดไม่ได้จนกว่าจะยืนยันครบ');
      await shot('03-review-pending');
      for (let k = 0; k < 4; k++) await page.locator('.grid-row.is-pending .confirm').first().click();
    }
    const finalScore = Number(await page.locator('.score-big').textContent());
    check(finalScore === scoreFor(no), `เลขที่ ${no} ได้ ${finalScore} คะแนน (คาดไว้ ${scoreFor(no)})`);
    await page.locator('#btn-save').click();
    await page.locator('.toast.show').waitFor();
    await page.locator('.score-big').waitFor({ state: 'detached' });
  }
  const selected = await page.locator('#student-no').inputValue();
  check(selected === '12', `เลื่อนไปเลขที่ถัดไปที่ยังไม่ตรวจอัตโนมัติ (${selected})`);
  await shot('04-scan-photo');

  if (process.env.FAKE_VIDEO) {
    console.log('ตรวจด้วยกล้องสด (วิดีโอจำลอง)');
    await page.getByRole('tab', { name: 'กล้องสด' }).click();
    await page.locator('.live-pill').waitFor();
    await page.waitForTimeout(1500);
    await shot('05-live');
    await page.locator('.score-big').waitFor({ timeout: 90000 });
    const s = Number(await page.locator('.score-big').textContent());
    check(s === scoreFor(11), `กล้องสดถ่ายอัตโนมัติและอ่านได้ ${s} คะแนน`);
    await shot('06-live-review');
    await page.locator('#btn-save').click();
    await page.locator('.toast.show').waitFor();
    await page.getByRole('tab', { name: 'ถ่ายรูป' }).click();
  }

  console.log('ผลคะแนนและการส่งออก');
  await page.goto(base + `#/`);
  await page.locator('.exam-item').first().waitFor();
  const examHref = await page.locator('.exam-main').first().getAttribute('href');
  check(examHref === `#/exam/${examId}`, 'หน้าแรกแสดงชุดข้อสอบที่สร้าง');
  await page.goto(base + `#/exam/${examId}/results`);
  await page.locator('.score-table').waitFor();
  const rows = await page.$$eval('.score-table tbody tr', (trs) => trs.map((tr) => [tr.cells[0].textContent.trim(), tr.cells[1].textContent.trim()]));
  const want = [['2', `${scoreFor(2)}/60`], ['5', `${scoreFor(5)}/60`], ['11', `${scoreFor(11)}/60`]];
  if (process.env.FAKE_VIDEO) want.push(['12', `${scoreFor(11)}/60`]);
  check(JSON.stringify(rows) === JSON.stringify(want), `ตารางคะแนน ${JSON.stringify(rows)}`);
  await shot('07-results');

  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'ส่งออก Excel' }).click()]);
  const xlsxPath = path.join(out, 'scores.xlsx');
  await dl.saveAs(xlsxPath);
  check(dl.suggestedFilename().endsWith('.xlsx'), `ดาวน์โหลด ${dl.suggestedFilename()}`);

  await page.goto(base + `#/exam/${examId}/print`);
  await page.locator('.report-table').waitFor();
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: path.join(out, 'report.pdf'), format: 'A4', printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  check(true, 'สร้าง PDF จากหน้ารายงานได้');

  await page.goto(base + `#/exam/${examId}/result/5`);
  await page.locator('.score-big').waitFor();
  await page.waitForTimeout(300);
  await shot('08-result-5');
  check(Number(await page.locator('.score-big').textContent()) === scoreFor(5), 'เปิดผลที่บันทึกของเลขที่ 5 ได้ถูกต้อง');

  console.log('เปลี่ยนจำนวนข้อเป็น 40 แล้วคะแนนคิดใหม่');
  await page.goto(base + `#/exam/${examId}`);
  await page.locator('#f-count').fill('40');
  await page.getByRole('button', { name: 'บันทึกชุดข้อสอบ' }).click();
  await page.locator('.exam-item').first().waitFor();
  await page.goto(base + `#/exam/${examId}/results`);
  await page.locator('.score-table').waitFor();
  const rows40 = await page.$$eval('.score-table tbody tr', (trs) => trs.map((tr) => tr.cells[1].textContent.trim()));
  check(rows40[0] === `${scoreFor(2, 40)}/40` && rows40[1] === `${scoreFor(5, 40)}/40`, `คะแนนแบบ 40 ข้อ ${JSON.stringify(rows40)}`);

  console.log('คลังเฉลย');
  await page.goto(base + '#/');
  await page.locator('#choice-library').click();
  await page.locator('#library-search').waitFor();
  await page.locator('#library-search').fill('กลางภาค');
  check(await page.locator('.library-list .exam-item').count() === 1, 'ค้นหาในคลังเฉลยเจอชุดข้อสอบ');
  await page.locator('#library-search').fill('ไม่มีวิชานี้');
  check(await page.locator('.library-list .notice').count() === 1, 'ค้นหาไม่เจอแสดงข้อความแจ้ง');
  await page.locator('#library-search').fill('');
  await shot('11-library');

  const synth = JSON.parse(readFileSync(fx('synth-truth.json'), 'utf8'));
  const readTplFields = () => page.$$eval(['#t-blocks', '#t-rowsPerBlock', '#t-choices', '#t-headerRows'].join(','),
    (els) => els.map((e) => e.value).join(','));
  const gridLetters = () => page.$$eval('.answer-grid .grid-row:not(.grid-head)', (rows) => rows.map((r) => {
    const i = [...r.querySelectorAll('.cell-choice')].findIndex((c) => c.classList.contains('sel'));
    return i < 0 ? '-' : 'ABCDEFGH'[i];
  }).join(''));

  console.log('เพิ่มแบบฟอร์ม 100 ข้อจากรูปกระดาษเปล่า');
  await page.goto(base + '#/templates');
  await page.locator('#btn-new-template').click();
  await page.locator('#t-blocks').waitFor();
  await chooseFile('เลือกรูปจากเครื่อง', fx('synth-grid-100x5-blank.jpg'));
  await page.locator('.key-status.ok').waitFor({ timeout: 90000 });
  const vals = await readTplFields();
  check(vals === '5,20,5,2', `นับโครงตารางจากรูปได้ ชุด/ข้อ/ตัวเลือก/หัวตาราง = ${vals}`);
  await page.locator('#t-name').fill('กระดาษคำตอบคณะ 100 ข้อ');
  await shot('12-template-wizard');
  await page.locator('#btn-save-template').click();
  await page.locator('#btn-use-template').waitFor();
  const tplId = page.url().split('#/templates/')[1];
  check(/^tpl_/.test(tplId), 'บันทึกแบบฟอร์มใหม่แล้ว');
  await shot('13-template-detail');

  console.log('สร้างเฉลยและตรวจกระดาษ 100 ข้อด้วยแบบฟอร์มใหม่');
  await page.locator('#btn-use-template').click();
  await page.locator('#f-template').waitFor();
  check(await page.locator('#f-template').inputValue() === tplId, 'หน้าสร้างเฉลยเลือกแบบฟอร์มใหม่ไว้ให้แล้ว');
  await page.locator('#f-code').fill('04-012-302');
  await page.locator('#f-name').fill('การเขียนโปรแกรม');
  await page.locator('#f-exam').fill('สอบปลายภาค 1/2569');
  await chooseFile('เลือกรูปจากเครื่อง', fx('synth-grid-100x5-key.jpg'));
  await page.locator('.key-status.ok').waitFor({ timeout: 90000 });
  const key100 = await gridLetters();
  const T100 = synth['grid-100x5'];
  check(key100 === T100.key, `อ่านเฉลย 100 ข้อตรงทุกข้อ (${[...key100].filter((c, i) => c === T100.key[i]).length}/100)`);
  await page.getByRole('button', { name: 'บันทึกแล้วเริ่มตรวจ' }).click();
  await page.locator('#student-no').waitFor();
  const exam100 = page.url().split('#/exam/')[1].split('/')[0];
  await page.locator('#student-no').selectOption('1');
  await chooseFile('เลือกรูปจากเครื่อง', fx('synth-grid-100x5-student.jpg'));
  await page.locator('.score-big').waitFor({ timeout: 90000 });
  const bulk = page.locator('.chip-action');
  if (await bulk.count()) await bulk.click();
  for (let guard = 0; guard < 60 && await page.locator('.grid-row.is-pending .confirm').count(); guard++) {
    await page.locator('.grid-row.is-pending .confirm').first().click();
  }
  const s100 = Number(await page.locator('.score-big').textContent());
  const want100 = [...T100.student].filter((c, i) => c === T100.key[i]).length;
  check(s100 === want100 && (await page.locator('.score-of').textContent()).includes('100'),
    `กระดาษ 100 ข้อได้ ${s100}/100 คะแนน (คาดไว้ ${want100})`);
  await shot('14-review-100');
  await page.locator('#btn-save').click();
  await page.getByText('บันทึกเลขที่ 1 แล้ว').waitFor();

  console.log('ส่งเฉลยที่ใช้แบบฟอร์มใหม่ไปอีกเครื่อง');
  await page.goto(base + `#/exam/${exam100}`);
  await page.locator('#btn-transfer').click();
  await page.locator('#transfer-dialog').waitFor();
  const link100 = await page.locator('#transfer-link').inputValue();
  await page.getByRole('button', { name: 'เสร็จแล้ว' }).click();
  {
    const other = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'th-TH' });
    const p2 = await other.newPage();
    await p2.goto(link100);
    await p2.locator('#btn-import').click();
    await p2.locator('#student-no').waitFor();
    await p2.goto(base + '#/templates');
    await p2.locator('.tpl-item').first().waitFor();
    check(await p2.getByText('กระดาษคำตอบคณะ 100 ข้อ').count() === 1, 'เครื่องปลายทางได้แบบฟอร์มที่เพิ่มเองไปด้วย');
    await other.close();
  }

  console.log('เฉลยหลายคำตอบในข้อเดียว');
  {
    // กระดาษจำลอง 100 ข้อ: นักศึกษากากบาท 2 ช่องในข้อ 1 (B,C) 7 (B,D) 24 (C,D) และ 47 (A,D)
    const MULTI = { 1: 'BC', 7: 'BD', 24: 'CD' };
    const rowSel = (q) => page.$$eval(`#q-${q} .cell-choice`, (cells) => cells.map((c, i) => (c.classList.contains('sel') ? 'ABCDE'[i] : '')).join(''));
    const setKey = async (q, want) => {
      const have = await rowSel(q);
      for (const L of 'ABCDE') {
        if (have.includes(L) !== want.includes(L)) await page.locator(`#q-${q} .cell-choice`).nth('ABCDE'.indexOf(L)).click();
      }
    };
    await page.goto(base + '#/exam/new');
    await page.locator('#f-template').selectOption('grid-100x5');
    await page.locator('#f-code').fill('04-012-303');
    await page.locator('#f-name').fill('สถิติเบื้องต้น');
    await page.locator('#f-exam').fill('สอบย่อยเฉลยหลายคำตอบ');
    await page.locator('#f-multi').selectOption('all');
    check(/ครบทุกช่องที่เฉลย/.test(await page.locator('#multi-hint').textContent()), 'เลือกกติกา "ต้องกากบาทครบทุกตัวเลือกที่เฉลย" แล้วมีคำอธิบาย');
    await chooseFile('เลือกรูปจากเครื่อง', fx('synth-grid-100x5-key.jpg'));
    await page.locator('.key-status.ok').waitFor({ timeout: 90000 });
    for (const [q, want] of Object.entries(MULTI)) await setKey(q, want);
    const sel = await Promise.all(Object.keys(MULTI).map(rowSel));
    check(JSON.stringify(sel) === JSON.stringify(Object.values(MULTI)), `แตะเลือกเฉลยได้หลายช่องในข้อเดียว (${sel.join(', ')})`);
    check(/เฉลยหลายตัวเลือก 3 ข้อ/.test(await page.locator('.key-summary').textContent())
      && await page.locator('.grid-row.is-multi').count() === 3, 'สรุปจำนวนข้อที่เฉลยหลายตัวเลือก และทำเครื่องหมายที่ข้อนั้น');
    await shot('15a-multi-key');
    await page.getByRole('button', { name: 'บันทึกแล้วเริ่มตรวจ' }).click();
    await page.locator('#student-no').waitFor();
    const examMulti = page.url().split('#/exam/')[1].split('/')[0];
    await page.locator('#student-no').selectOption('1');
    await chooseFile('เลือกรูปจากเครื่อง', fx('synth-grid-100x5-student.jpg'));
    await page.locator('.score-big').waitFor({ timeout: 90000 });
    const T = synth['grid-100x5'];
    const flagCount = Object.keys(T.flags).length;
    const pendingNow = await page.locator('.grid-row.is-pending').count();
    check(pendingNow === flagCount - 3, `ข้อที่กากบาทครบตามเฉลยหลายตัวเลือกไม่ต้องยืนยัน (รอยืนยัน ${pendingNow} จาก ${flagCount} ข้อ)`);
    check(await page.locator('#q-47.is-pending').count() === 1, 'ข้อที่เฉลยตัวเลือกเดียวแต่กากบาท 2 ช่อง ยังให้อาจารย์ยืนยัน');
    check(await page.locator('#q-1.is-right').count() === 1 && (await rowSel(1)) === 'BC', 'ข้อ 1 กากบาท B,C ตรงกับเฉลย ได้คะแนน');
    const bulk2 = page.locator('.chip-action');
    if (await bulk2.count()) await bulk2.click();
    for (let guard = 0; guard < 60 && await page.locator('.grid-row.is-pending .confirm').count(); guard++) {
      await page.locator('.grid-row.is-pending .confirm').first().click();
    }
    // คะแนนที่คาด: ข้อที่ตอบช่องเดียวตรงเฉลย + 3 ข้อที่กากบาทครบตามเฉลยหลายตัวเลือก
    const keyArr = [...T.key].map((c, i) => (MULTI[i + 1] ? MULTI[i + 1] : c));
    const wantAll = [...T.student].filter((c, i) => c === keyArr[i]).length + 3;
    const gotAll = Number(await page.locator('.score-big').textContent());
    check(gotAll === wantAll, `กติกา "กากบาทครบ" ได้ ${gotAll}/100 คะแนน (คาดไว้ ${wantAll})`);
    await shot('15b-multi-review');
    await page.locator('#btn-save').click();
    await page.getByText('บันทึกเลขที่ 1 แล้ว').waitFor();

    // เปลี่ยนเป็น "ตอบตัวเลือกใดก็ได้ที่เฉลย": กากบาท 2 ช่องไม่ได้คะแนน แต่ตอบช่องเดียวที่อยู่ในเฉลยได้คะแนน
    await page.goto(base + `#/exam/${examMulti}`);
    await page.locator('#f-multi').waitFor();
    check(await page.locator('#f-multi').inputValue() === 'all' && (await rowSel(7)) === 'BD', 'เปิดชุดข้อสอบอีกครั้ง กติกาและเฉลยหลายตัวเลือกยังอยู่');
    await page.locator('#f-multi').selectOption('any');
    await page.getByRole('button', { name: 'บันทึกชุดข้อสอบ' }).click();
    await page.getByText(/คิดใหม่ตามเฉลยที่แก้/).waitFor();
    await page.goto(base + `#/exam/${examMulti}/results`);
    await page.locator('.score-table').waitFor();
    const anyScore = await page.$eval('.score-table tbody tr', (tr) => tr.cells[1].textContent.trim());
    const singleIn = [...T.student].filter((c, i) => MULTI[i + 1] && MULTI[i + 1].includes(c)).length;
    const wantAny = wantAll - 3 + singleIn;
    check(anyScore === `${wantAny}/100`, `เปลี่ยนเป็นกติกา "ตอบตัวเลือกใดก็ได้" คะแนนคิดใหม่เป็น ${anyScore} (คาดไว้ ${wantAny}/100)`);

    // ส่งไปเครื่องอื่น: เฉลยหลายตัวเลือกและกติกาติดไปด้วย
    await page.goto(base + `#/exam/${examMulti}`);
    await page.locator('#btn-transfer').click();
    await page.locator('#transfer-dialog').waitFor();
    const linkM = await page.locator('#transfer-link').inputValue();
    await page.getByRole('button', { name: 'เสร็จแล้ว' }).click();
    const other = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'th-TH' });
    const p2 = await other.newPage();
    await p2.goto(linkM);
    await p2.locator('#btn-import').waitFor();
    check(/ตอบตัวเลือกใดก็ได้/.test(await p2.locator('.import-facts').innerText()), 'หน้านำเข้าบอกกติกาเฉลยหลายคำตอบ');
    await p2.locator('#btn-import').click();
    await p2.locator('#student-no').waitFor();
    await p2.goto(base + `#/exam/${examMulti}`);
    await p2.locator('#q-24').waitFor();
    const sel24 = await p2.$$eval('#q-24 .cell-choice', (cells) => cells.map((c, i) => (c.classList.contains('sel') ? 'ABCDE'[i] : '')).join(''));
    check(sel24 === 'CD' && await p2.locator('#f-multi').inputValue() === 'any', 'เครื่องปลายทางได้เฉลยหลายตัวเลือกและกติกาครบ');
    await other.close();
  }

  console.log('พิมพ์กระดาษคำตอบเปล่า 120 ข้อ แล้วอ่านกลับด้วยตัวช่วยเพิ่มแบบฟอร์ม');
  await page.goto(base + '#/templates/grid-120x4/print');
  await page.locator('.answer-sheet').waitFor();
  const dims = await page.$$eval('.answer-sheet tr', (trs) => [trs.length, trs[0].cells.length]);
  check(dims[0] === 32 && dims[1] === 20, `ตารางสำหรับพิมพ์ ${dims[1]} คอลัมน์ × ${dims[0]} แถว`);
  await page.waitForTimeout(300);
  const fits = await page.$eval('.sheet-stage', (s) => s.scrollWidth <= s.clientWidth + 1);
  check(fits, 'ตัวอย่างกระดาษบนมือถือย่อให้พอดีจอ ไม่ต้องเลื่อนซ้ายขวา');
  await shot('16-print-preview');
  // จับภาพที่ความละเอียดใกล้เคียงกระดาษที่พิมพ์จริง
  await page.setViewportSize({ width: 1100, height: 1700 });
  await page.waitForTimeout(300);
  await page.locator('.sheet-print').screenshot({ path: path.join(out, 'print-120.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ media: 'print' });
  const sheetPdf = path.join(out, 'sheet-120.pdf');
  await page.pdf({ path: sheetPdf, preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  const pdfPages = (readFileSync(sheetPdf, 'latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  check(pdfPages === 1, `พิมพ์ได้ใน A4 หน้าเดียว (${pdfPages} หน้า)`);
  await page.goto(base + '#/templates/new');
  await page.locator('#t-blocks').waitFor();
  await chooseFile('เลือกรูปจากเครื่อง', path.join(out, 'print-120.png'));
  await page.locator('.key-status.ok, .key-status.error').first().waitFor({ timeout: 90000 });
  const vals2 = await readTplFields();
  check(vals2 === '4,30,4,2', `อ่านกระดาษที่แอปพิมพ์กลับมาได้โครงเดิม (${vals2})`);
  await page.evaluate(() => { location.hash = '#/'; });
  await page.getByRole('button', { name: 'ออกโดยไม่บันทึก' }).click();
  await page.locator('#choice-new').waitFor();
  check(true, 'ออกจากหน้าที่ยังไม่บันทึก มีกล่องยืนยันก่อน');

  console.log('ข้อมูลสำหรับ Train');
  await page.goto(base + '#/training');
  await page.locator('#training-stats').waitFor();
  await shot('15-training');
  const [ds] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-export-dataset').click()]);
  const dsPath = path.join(out, 'dataset.zip');
  await ds.saveAs(dsPath);
  const mk = spawnSync('python3', [path.join(root, 'tools/make_cells.py'), dsPath, path.join(out, 'cells')], { encoding: 'utf8' });
  // ชุดกลางภาค (เฉลย + 3 แผ่น) + 100 ข้อ (เฉลย + 1 แผ่น) + เฉลยหลายคำตอบ (เฉลย + 1 แผ่น) + กระดาษเปล่าของแบบฟอร์มที่เพิ่ม
  check(mk.status === 0 && /จาก 9 ภาพ/.test(mk.stdout), `ส่งออกชุดข้อมูลและตัดช่องได้: ${(mk.stdout || mk.stderr).trim()}`);
  {
    const csv = readFileSync(path.join(out, 'cells', 'cells.csv'), 'utf8').split('\n').map((l) => l.split(','));
    const q1 = csv.filter((c) => c[1] === 'mark' && c[3] === 'result' && c[5] === '1' && /res_ex_/.test(c[2]));
    const multiSheet = q1.filter((c) => q1.filter((d) => d[2] === c[2]).length === 2);
    check(multiSheet.length === 2, 'ข้อที่กากบาทหลายช่องได้ป้าย mark ทุกช่องในชุดข้อมูล');
  }

  console.log('สำรองข้อมูล');
  await page.goto(base + '#/settings');
  const [bk] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'ดาวน์โหลดไฟล์สำรอง' }).click()]);
  const bkPath = path.join(out, 'backup.json');
  await bk.saveAs(bkPath);
  check(statSync(bkPath).size > 50000, `ไฟล์สำรองมีรูปและข้อมูล (${Math.round(statSync(bkPath).size / 1024)} KB)`);
  await shot('09-settings');

  console.log('เปิดแบบออฟไลน์');
  await page.goto(base);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(1500);
  await context.setOffline(true);
  await page.reload();
  await page.locator('.exam-item').first().waitFor({ timeout: 15000 });
  check(true, 'เปิดแอปและเห็นข้อมูลได้ขณะออฟไลน์');
  // ตัวอ่าน QR code (worker และ jsQR) ต้องมาจากแคชของแอป ใช้ได้แม้ไม่มีอินเทอร์เน็ต
  await page.goto(base + '#/receive');
  await chooseFile('เลือกรูปจากเครื่อง', qrPhoto);
  await page.waitForURL(/#\/import\//, { timeout: 30000 });
  await page.locator('#btn-import').waitFor();
  check(/สอบย่อยที่ส่งมา/.test(await page.locator('main').innerText()), 'อ่าน QR code จากรูปได้ขณะออฟไลน์');
  await context.setOffline(false);
  await shot('10-home');

  console.log('ลบชุดข้อสอบที่ไม่ใช้แล้ว (ปุ่มถังขยะในคลังเฉลย)');
  await page.goto(base + '#/library');
  await page.locator('#library-storage:not([hidden])').waitFor();
  const before = await page.locator('.library-list .exam-item').count();
  const row100 = page.locator(`.exam-item[data-exam-id="${exam100}"]`);
  const sizeText = (await row100.locator('.exam-size').textContent()).trim();
  check(/(KB|MB)$/.test(sizeText), `แต่ละชุดบอกขนาดพื้นที่ที่ใช้ (${sizeText})`);
  await row100.locator('.btn-trash').click();
  await page.locator('dialog .dialog-details').waitFor();
  const dlgText = await page.locator('dialog').innerText();
  check(/ผลตรวจ 1 คน/.test(dlgText) && /ได้พื้นที่คืนประมาณ/.test(dlgText), 'กล่องยืนยันบอกสิ่งที่จะถูกลบและพื้นที่ที่ได้คืน');
  check(await page.evaluate(() => document.activeElement && document.activeElement.textContent.trim() === 'ยกเลิก'), 'กล่องยืนยันโฟกัสที่ปุ่มยกเลิก กด Enter โดยไม่ตั้งใจจะไม่ลบ');
  await shot('17-delete-confirm');
  await page.locator('dialog').getByRole('button', { name: 'ยกเลิก', exact: true }).click();
  check(await page.locator('.library-list .exam-item').count() === before, 'กดยกเลิกแล้วไม่มีอะไรถูกลบ');
  await row100.locator('.btn-trash').click();
  await page.locator('dialog').getByRole('button', { name: 'ลบชุดข้อสอบ', exact: true }).click();
  await page.getByText('ได้พื้นที่คืนประมาณ').waitFor();
  await page.locator(`.exam-item[data-exam-id="${exam100}"]`).waitFor({ state: 'detached' });
  const left = await page.evaluate((id) => new Promise((resolve) => {
    const r = indexedDB.open('checkchoice');
    r.onsuccess = () => {
      const d = r.result;
      const tx = d.transaction(['exams', 'results', 'blobs'], 'readonly');
      const res = {};
      tx.objectStore('exams').get(id).onsuccess = (e) => { res.exam = !!e.target.result; };
      tx.objectStore('results').getAll().onsuccess = (e) => { res.results = e.target.result.filter((x) => x.examId === id).length; };
      tx.objectStore('blobs').getAllKeys().onsuccess = (e) => { res.images = e.target.result.filter((k) => String(k).includes(id)).length; };
      tx.oncomplete = () => { d.close(); resolve(res); };
    };
  }), exam100);
  check(!left.exam && left.results === 0 && left.images === 0, `ลบชุดข้อสอบ ผลตรวจ และรูปทั้งหมดของชุดนั้น (${JSON.stringify(left)})`);
  check(await page.locator('.library-list .exam-item').count() === before - 1, 'รายการในคลังเฉลยลดลง 1 ชุด');
  await shot('18-library-after-delete');
  await page.goto(base + '#/');
  await page.locator('.exam-item .btn-trash').first().waitFor();
  check(await page.locator('.exam-item .btn-trash').count() === await page.locator('.exam-item').count(), 'รายการใช้ล่าสุดบนหน้าแรกมีปุ่มถังขยะทุกแถว');

  check(errors.length === 0, `ไม่มีข้อผิดพลาดในคอนโซล${errors.length ? ': ' + errors.join(' | ') : ''}`);
} catch (err) {
  failures++;
  console.error(err);
  await shot('error').catch(() => {});
} finally {
  await browser.close();
  server.close();
}

console.log(failures ? `\nไม่ผ่าน ${failures} รายการ` : '\nผ่านทั้งหมด');
process.exit(failures ? 1 : 0);
