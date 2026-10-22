// ทดสอบทั้งระบบบนเบราว์เซอร์จริง (Chromium) — รันด้วย `npm run test:e2e`
// สร้างชุดข้อสอบจากรูปใบเฉลย ตรวจกระดาษ 3 แผ่นด้วยการเลือกรูป, 1 แผ่นด้วยกล้องสด (ถ้ากำหนด FAKE_VIDEO)
// ส่งออก Excel/ไฟล์สำรอง และทดสอบการเปิดแบบออฟไลน์
import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
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
  console.log('เบราว์เซอร์ที่ไม่มี IndexedDB/WebAssembly (จำลอง iPhone ที่เปิดโหมดล็อกดาวน์)');
  {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'th-TH',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    });
    await ctx.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', { get: () => undefined, configurable: true });
      Object.defineProperty(window, 'WebAssembly', { value: undefined, configurable: true, writable: true });
    });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(base);
    await p.getByText('เบราว์เซอร์นี้ยังใช้ CheckChoice ไม่ได้').waitFor();
    const text = await p.locator('#env-help').innerText();
    check(/IndexedDB/.test(text) && /WebAssembly/.test(text) && /โหมดล็อกดาวน์/.test(text),
      'แสดงหน้าบอกสาเหตุและวิธีปิดโหมดล็อกดาวน์ แทนข้อความผิดพลาด');
    check(errs.length === 0, `ไม่มีข้อผิดพลาดที่ไม่ได้จัดการ${errs.length ? ': ' + errs.join(' | ') : ''}`);
    await p.screenshot({ path: path.join(out, '00-env-help.png'), fullPage: true });
    await ctx.close();
  }

  console.log('หน้าแรก');
  await page.goto(base);
  await page.getByText('ยังไม่มีชุดข้อสอบ').waitFor();
  check(true, 'แสดงหน้าว่างพร้อมปุ่มสร้างชุดข้อสอบ');
  await shot('01-home-empty');

  console.log('สร้างชุดข้อสอบจากรูปใบเฉลย');
  await page.getByRole('link', { name: 'สร้างชุดข้อสอบ' }).first().click();
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
