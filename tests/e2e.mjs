// ทดสอบทั้งระบบบนเบราว์เซอร์จริง (Chromium) — รันด้วย `npm run test:e2e`
// สร้างชุดข้อสอบจากรูปใบเฉลย ตรวจกระดาษ 3 แผ่นด้วยการเลือกรูป, 1 แผ่นด้วยกล้องสด (ถ้ากำหนด FAKE_VIDEO)
// ส่งออก Excel/ไฟล์สำรอง และทดสอบการเปิดแบบออฟไลน์
import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

    // ปิดโหมดล็อกดาวน์เฉพาะเว็บนี้: ข้อมูลในที่เก็บสำรองย้ายเข้า IndexedDB
    await p.goto(base + '?exclude=1#/');
    await p.locator('#choice-new').waitFor({ timeout: 60000 });
    const moved = await p.evaluate(() => localStorage.getItem('cc.db.v1.exams') === null);
    check(moved && await p.locator('.exam-item').count() === 1, 'ปิดโหมดล็อกดาวน์เฉพาะเว็บแล้ว ข้อมูลย้ายเข้าที่เก็บปกติครบ');
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
  check(mk.status === 0 && /จาก 8 ภาพ/.test(mk.stdout), `ส่งออกชุดข้อมูลและตัดช่องได้: ${(mk.stdout || mk.stderr).trim()}`);

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
  await context.setOffline(false);
  await shot('10-home');

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
