// ตั้งค่า: ติดตั้งแอป สำรอง/กู้คืนข้อมูล พื้นที่จัดเก็บ และเกี่ยวกับแอป
import { h, icon, toast, confirmDialog } from '../ui.js';
import { appBar, go } from '../nav.js';
import { backupAll, readBackup, restoreBackup } from '../export.js';
import { install, isStandalone, platform, requestPersistence, APP_VERSION, REPO_URL } from '../pwa.js';

function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    input.addEventListener('cancel', () => { resolve(null); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}

export async function settingsView(root) {
  root.append(appBar({ title: 'ตั้งค่าและสำรองข้อมูล', back: '#/' }));
  const main = h('main', { class: 'page page-form' });
  root.append(main);

  // ---------------------------------------------------------------- ติดตั้ง
  const p = platform();
  const installBox = h('section', { class: 'form-section' }, h('h2', { class: 'section-title' }, 'ติดตั้งเป็นแอป'));
  if (isStandalone()) {
    installBox.append(h('p', { class: 'section-help' }, 'กำลังเปิดจากไอคอนบนหน้าจอหลักอยู่แล้ว'));
  } else {
    const steps = {
      ios: 'ใน Safari แตะปุ่มแชร์ (สี่เหลี่ยมมีลูกศรชี้ขึ้น) แล้วเลือก "เพิ่มไปยังหน้าจอโฮม" ควรเปิดแอปจากไอคอนนี้เสมอ เพื่อไม่ให้ข้อมูลถูกล้างเมื่อไม่ได้ใช้นาน',
      android: 'แตะปุ่ม "ติดตั้งแอป" ด้านล่าง หรือเปิดเมนู ⋮ ของ Chrome แล้วเลือก "ติดตั้งแอป" / "เพิ่มลงในหน้าจอหลัก"',
      desktop: 'ใน Chrome หรือ Edge กดไอคอนติดตั้งที่ช่องที่อยู่เว็บ หรือใช้งานผ่านเบราว์เซอร์ต่อไปก็ได้',
    };
    installBox.append(h('p', { class: 'section-help' }, steps[p]));
    const slot = h('div', { class: 'btn-row' });
    const addBtn = () => {
      if (!install.prompt || slot.firstChild) return;
      slot.append(h('button', { type: 'button', class: 'btn btn-primary', onclick: async () => {
        const ev = install.prompt;
        install.prompt = null;
        ev.prompt();
        await ev.userChoice;
        slot.textContent = '';
      } }, icon('download'), 'ติดตั้งแอป'));
    };
    addBtn();
    install.listeners.add(addBtn);
    installBox.append(slot);
  }
  main.append(installBox);

  // ---------------------------------------------------------------- สำรองข้อมูล
  main.append(h('section', { class: 'form-section' },
    h('h2', { class: 'section-title' }, 'สำรองและกู้คืนข้อมูล'),
    h('p', { class: 'section-help' }, 'ข้อมูลทั้งหมดเก็บอยู่ในเครื่องนี้เท่านั้น ควรดาวน์โหลดไฟล์สำรองเก็บไว้หลังตรวจเสร็จแต่ละครั้ง และใช้ไฟล์นี้ย้ายข้อมูลไปเครื่องอื่นได้'),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn btn-primary', onclick: async (e) => {
        e.currentTarget.disabled = true;
        const btn = e.currentTarget;
        try {
          const r = await backupAll();
          toast(`ดาวน์โหลดไฟล์สำรองแล้ว (${r.exams} ชุดข้อสอบ, ${r.results} ผลตรวจ)`, 'ok');
        } catch (err) { toast(`สำรองไม่สำเร็จ: ${err.message || err}`, 'error'); }
        finally { btn.disabled = false; }
      } }, icon('download'), 'ดาวน์โหลดไฟล์สำรอง'),
      h('button', { type: 'button', class: 'btn btn-quiet', onclick: async () => {
        const file = await pickFile('application/json,.json');
        if (!file) return;
        try {
          const data = await readBackup(file);
          const ok = await confirmDialog(`กู้คืน ${data.exams.length} ชุดข้อสอบ และ ${(data.results || []).length} ผลตรวจ จากไฟล์นี้ ชุดข้อสอบที่มีอยู่แล้วจะถูกแทนที่ด้วยข้อมูลในไฟล์`, { okText: 'กู้คืนข้อมูล' });
          if (!ok) return;
          const r = await restoreBackup(data);
          toast(`กู้คืนแล้ว ${r.exams} ชุดข้อสอบ ${r.results} ผลตรวจ`, 'ok');
          go('#/');
        } catch (err) { toast(err.message || String(err), 'error'); }
      } }, 'กู้คืนจากไฟล์'))));

  // ---------------------------------------------------------------- พื้นที่จัดเก็บ
  const storageText = h('p', { class: 'section-help' }, 'กำลังตรวจสอบ…');
  main.append(h('section', { class: 'form-section' },
    h('h2', { class: 'section-title' }, 'พื้นที่จัดเก็บ'), storageText));
  (async () => {
    const persisted = await requestPersistence();
    let usage = '';
    try {
      const est = await navigator.storage.estimate();
      usage = `ใช้พื้นที่ประมาณ ${(est.usage / 1048576).toFixed(1)} MB`;
    } catch (e) { /* ignore */ }
    storageText.textContent = `${usage}${usage ? ' ' : ''}${persisted ? 'เบราว์เซอร์จะเก็บข้อมูลไว้ถาวร' : 'เบราว์เซอร์อาจล้างข้อมูลเมื่อพื้นที่เหลือน้อย ควรสำรองข้อมูลเป็นประจำ'}`;
  })();

  // ---------------------------------------------------------------- เกี่ยวกับ
  main.append(h('section', { class: 'form-section' },
    h('h2', { class: 'section-title' }, 'เกี่ยวกับ CheckChoice'),
    h('p', { class: 'section-help' }, `เวอร์ชัน ${APP_VERSION} อ่านกระดาษคำตอบบนเครื่องนี้ทั้งหมด รูปและคะแนนไม่ถูกส่งไปที่เซิร์ฟเวอร์ใด`),
    h('p', { class: 'section-help' }, 'ใช้ OpenCV.js (Apache 2.0), SheetJS (Apache 2.0) และฟอนต์ IBM Plex Sans Thai Looped (SIL OFL 1.1)'),
    h('p', null, h('a', { class: 'link', href: REPO_URL, target: '_blank', rel: 'noopener' }, 'ซอร์สโค้ดบน GitHub'))));
}
